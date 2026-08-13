import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { TimelineService } from '../../core/timeline.service';

/** Template keys the app knows → clinic-configurable Meta template names. */
export type TemplateKey = 'reminder' | 'recall' | 'followup';
const DEFAULT_TEMPLATES: Record<TemplateKey, string> = {
  reminder: 'appointment_reminder',
  recall: 'recall_due',
  followup: 'follow_up_due',
};

export interface OutboundMessage {
  patientId?: number;
  channel?: string; // WHATSAPP | SMS | EMAIL
  kind?: string; // REMINDER | FOLLOW_UP | QUESTIONNAIRE | RECOMMENDATION | RECALL | BIRTHDAY | RISK_CONFIRM | GENERAL
  to: string;
  body: string;
  refType?: string;
  refId?: number;
  /**
   * Approved-template fallback for when the 24h session window is closed
   * (WhatsApp only allows free-form text within 24h of the patient's last
   * inbound message). Kinds without a template simply attempt text and
   * surface Meta's re-engagement error in the message log.
   */
  template?: { key: TemplateKey; params: string[] };
}

/**
 * Provider-abstracted outbound messaging. Every message is persisted first,
 * then dispatched through the configured provider:
 *  - `whatsapp.phoneNumberId` + `whatsapp.accessToken` settings set and
 *    channel WHATSAPP        -> Meta WhatsApp Cloud API (template or text)
 *  - `messaging.webhookUrl` setting set -> HTTP POST (SMS gateways, relays)
 *  - otherwise               -> console provider (logged only), which keeps
 *                               the whole system fully functional offline.
 * All settings are per-clinic (tenant-scoped), so on the SaaS each clinic
 * sends from its own WhatsApp number.
 */
@Injectable()
export class MessagingService {
  private log = new Logger('Messaging');

  constructor(
    private prisma: PrismaService,
    private timeline: TimelineService,
  ) {}

  async getSetting(key: string, fallback = ''): Promise<string> {
    // findFirst (not findUnique): the tenant middleware scopes it to the
    // caller's clinic — settings are per-clinic rows now.
    const row = await this.prisma.setting.findFirst({ where: { key } });
    return row?.value ?? fallback;
  }

  async templateName(key: TemplateKey): Promise<string> {
    try {
      const map = JSON.parse(await this.getSetting('whatsapp.templates', '{}'));
      return map[key] || DEFAULT_TEMPLATES[key];
    } catch {
      return DEFAULT_TEMPLATES[key];
    }
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
    let error: string | undefined;
    let waMessageId: string | undefined;

    const phoneNumberId = await this.getSetting('whatsapp.phoneNumberId');
    const accessToken = await this.getSetting('whatsapp.accessToken');
    const webhookUrl = await this.getSetting('messaging.webhookUrl');

    if (record.channel === 'WHATSAPP' && phoneNumberId && accessToken) {
      const result = await this.sendViaCloudApi(phoneNumberId, accessToken, record.to, msg);
      status = result.ok ? 'SENT' : 'FAILED';
      error = result.error;
      waMessageId = result.waMessageId;
    } else if (webhookUrl) {
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
      data: {
        status,
        error,
        waMessageId,
        sentAt: status === 'SENT' ? new Date() : null,
      },
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

  /**
   * Meta WhatsApp Cloud API. Free-form text inside the 24h session window
   * (patient replied recently), approved template outside it.
   */
  private async sendViaCloudApi(
    phoneNumberId: string,
    accessToken: string,
    to: string,
    msg: OutboundMessage,
  ): Promise<{ ok: boolean; waMessageId?: string; error?: string }> {
    const waTo = to.replace(/[^\d]/g, ''); // Meta wants bare digits incl. country code

    // Session window: any inbound reply from this number in the last 24h.
    const windowOpen = !!(await this.prisma.message.findFirst({
      where: { to, respondedAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
      select: { id: true },
    }));

    let payload: Record<string, unknown>;
    if (!windowOpen && msg.template) {
      payload = {
        messaging_product: 'whatsapp',
        to: waTo,
        type: 'template',
        template: {
          name: await this.templateName(msg.template.key),
          language: { code: await this.getSetting('whatsapp.lang', 'en') },
          components: [
            {
              type: 'body',
              parameters: msg.template.params.map((text) => ({ type: 'text', text })),
            },
          ],
        },
      };
    } else {
      payload = {
        messaging_product: 'whatsapp',
        to: waTo,
        type: 'text',
        text: { body: msg.body },
      };
    }

    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        messages?: { id: string }[];
        error?: { message?: string; code?: number; error_data?: { details?: string } };
      };
      if (!res.ok || data.error) {
        const detail =
          data.error?.error_data?.details || data.error?.message || `HTTP ${res.status}`;
        this.log.warn(`WhatsApp send failed (to=${waTo}): ${detail}`);
        return { ok: false, error: detail.slice(0, 500) };
      }
      return { ok: true, waMessageId: data.messages?.[0]?.id };
    } catch (e) {
      this.log.warn(`WhatsApp send failed (to=${waTo}): ${e}`);
      return { ok: false, error: String(e).slice(0, 500) };
    }
  }

  /** Has a message of this kind already been sent for this ref (within `sinceDays`)? */
  async alreadySent(kind: string, refType: string, refId: number, sinceDays?: number) {
    const where: Record<string, unknown> = { kind, refType, refId, status: { in: ['SENT', 'DELIVERED', 'READ'] } };
    if (sinceDays) where.sentAt = { gte: new Date(Date.now() - sinceDays * 86400_000) };
    return (await this.prisma.message.count({ where })) > 0;
  }

  /**
   * Inbound reply handling (from the Meta webhook or a generic gateway in
   * production; the UI's "record reply" button locally). Interprets
   * questionnaire responses and opens the 24h session window.
   */
  async recordReply(messageId: number, response: string) {
    const message = await this.prisma.message.update({
      where: { id: messageId },
      data: { response, respondedAt: new Date() },
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
