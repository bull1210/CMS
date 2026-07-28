import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { TimelineService } from '../../core/timeline.service';

export interface OutboundMessage {
  patientId?: number;
  channel?: string; // WHATSAPP | SMS | EMAIL
  kind?: string; // REMINDER | FOLLOW_UP | QUESTIONNAIRE | RECOMMENDATION | GENERAL
  to: string;
  body: string;
  refType?: string;
  refId?: number;
}

/**
 * Provider-abstracted outbound messaging. Every message is persisted first,
 * then dispatched through the configured provider:
 *  - `messaging.webhookUrl` setting set  -> HTTP POST (works for WhatsApp Cloud
 *    API relays, Twilio functions, or any gateway you put in front)
 *  - otherwise                           -> console provider (logged only),
 *    which keeps the whole system fully functional offline.
 */
@Injectable()
export class MessagingService {
  private log = new Logger('Messaging');

  constructor(
    private prisma: PrismaService,
    private timeline: TimelineService,
  ) {}

  async getSetting(key: string, fallback = ''): Promise<string> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row?.value ?? fallback;
  }

  async send(msg: OutboundMessage) {
    const record = await this.prisma.message.create({
      data: {
        patientId: msg.patientId,
        channel: msg.channel ?? 'WHATSAPP',
        kind: msg.kind ?? 'GENERAL',
        to: msg.to,
        body: msg.body,
        refType: msg.refType,
        refId: msg.refId,
        status: 'QUEUED',
      },
    });

    let status = 'SENT';
    const webhookUrl = await this.getSetting('messaging.webhookUrl');
    if (webhookUrl) {
      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ channel: record.channel, to: record.to, body: record.body }),
        });
        if (!res.ok) status = 'FAILED';
      } catch (e) {
        this.log.warn(`Webhook dispatch failed: ${e}`);
        status = 'FAILED';
      }
    } else {
      this.log.log(`[console:${record.channel}] to=${record.to} :: ${record.body}`);
    }

    const updated = await this.prisma.message.update({
      where: { id: record.id },
      data: { status, sentAt: status === 'SENT' ? new Date() : null },
    });
    if (msg.patientId) {
      await this.timeline.add(
        msg.patientId,
        'MESSAGE',
        `${record.channel} ${record.kind.toLowerCase().replace('_', ' ')} ${status === 'SENT' ? 'sent' : 'failed'}`,
        record.body.slice(0, 200),
        'Message',
        record.id,
      );
    }
    return updated;
  }

  /** Has a message of this kind already been sent for this ref (within `sinceDays`)? */
  async alreadySent(kind: string, refType: string, refId: number, sinceDays?: number) {
    const where: Record<string, unknown> = { kind, refType, refId, status: 'SENT' };
    if (sinceDays) where.sentAt = { gte: new Date(Date.now() - sinceDays * 86400_000) };
    return (await this.prisma.message.count({ where })) > 0;
  }

  /**
   * Inbound reply handling (from a webhook in production; the UI's
   * "record reply" button locally). Interprets questionnaire responses.
   */
  async recordReply(messageId: number, response: string) {
    const message = await this.prisma.message.update({
      where: { id: messageId },
      data: { response },
    });
    const normalized = response.trim().toUpperCase();
    if (message.refType === 'APPOINTMENT' && message.refId) {
      const map: Record<string, string> = {
        YES: 'CONFIRMED', '1': 'CONFIRMED',
        NO: 'CANCELLED', '3': 'CANCELLED',
        CANCEL: 'CANCELLED',
      };
      const newStatus = map[normalized];
      const reschedule = normalized === 'RESCHEDULE' || normalized === '2';
      if (newStatus || reschedule) {
        await this.prisma.appointment.update({
          where: { id: message.refId },
          data: newStatus ? { status: newStatus } : { notes: 'Patient requested reschedule' },
        });
      }
    }
    if (message.patientId) {
      await this.timeline.add(message.patientId, 'MESSAGE', `Patient replied: ${response}`, undefined, 'Message', message.id);
    }
    return message;
  }
}
