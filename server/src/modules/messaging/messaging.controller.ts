import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../core/prisma.service';
import { tenancy } from '../../core/tenancy';
import { MessagingService } from './messaging.service';
import { RemindersScheduler } from './reminders.scheduler';
import { Public, Roles } from '../../core/auth.guard';

/** Shape of the parts of Meta's webhook payload we consume. */
interface WaWebhookBody {
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: {
          from?: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
        }[];
        statuses?: {
          id?: string;
          status?: string;
          errors?: { title?: string; message?: string }[];
        }[];
      };
    }[];
  }[];
}

@Controller('messages')
export class MessagingController {
  private log = new Logger('WhatsAppWebhook');

  constructor(
    private prisma: PrismaService,
    private messaging: MessagingService,
    private scheduler: RemindersScheduler,
  ) {}

  @Get()
  list(@Query('patientId') patientId?: string, @Query('take') take?: string) {
    return this.prisma.message.findMany({
      where: patientId ? { patientId: Number(patientId) } : {},
      include: { patient: { select: { id: true, name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(take) || 100, 500),
    });
  }

  @Post('send')
  async send(
    @Body() body: { patientId: number; channel?: string; body: string },
  ) {
    if (!body?.patientId || !body?.body) throw new BadRequestException('patientId and body required');
    const patient = await this.prisma.patient.findUniqueOrThrow({ where: { id: body.patientId } });
    return this.messaging.send({
      patientId: patient.id,
      channel: body.channel ?? (patient.whatsapp ? 'WHATSAPP' : 'SMS'),
      to: patient.whatsapp || patient.phone,
      body: body.body,
    });
  }

  /** Manually record a patient reply (or receive one from a gateway UI). */
  @Post(':id/reply')
  reply(@Param('id', ParseIntPipe) id: number, @Body() body: { response: string }) {
    if (!body?.response) throw new BadRequestException('response required');
    return this.messaging.recordReply(id, body.response);
  }

  /**
   * Public webhook for SMS/WhatsApp gateways to push inbound replies:
   * { from: "+91...", body: "YES" }. Matches the latest outbound message
   * to that number that expects a response.
   */
  @Public()
  @Post('inbound')
  async inbound(
    @Body() body: { from: string; body: string },
    @Query('token') queryToken?: string,
    @Headers('x-webhook-token') headerToken?: string,
  ) {
    // This endpoint is public (gateways can't log in) but must not be spoofable:
    // once `messaging.inboundToken` is set, requests need the shared secret.
    // Empty setting keeps local/offline demos working without a gateway.
    if (!body?.from || !body?.body) throw new BadRequestException('from and body required');
    // Public webhook = no tenant context. Match the reply to the most recent
    // outbound message across clinics (privileged), then do all processing
    // inside that message's clinic scope — including the token check, since
    // each clinic may configure its own inbound token.
    const last = await tenancy.runPrivileged(() =>
      this.prisma.message.findFirst({
        where: { to: { contains: body.from.replace(/^\+/, '') }, status: 'SENT', response: null },
        orderBy: { sentAt: 'desc' },
      }),
    );
    if (!last) return { matched: false };
    return tenancy.runAs(last.clinicId, async () => {
      const expected = await this.messaging.getSetting('messaging.inboundToken');
      if (expected && queryToken !== expected && headerToken !== expected) {
        throw new UnauthorizedException('Invalid webhook token');
      }
      await this.messaging.recordReply(last.id, body.body);
      return { matched: true, messageId: last.id };
    });
  }

  @Post('run-scheduler')
  runScheduler() {
    return this.scheduler.run();
  }

  /**
   * Meta webhook subscription handshake. Configured ONCE per Meta app, so it
   * fans in for every clinic — the invented verify token is accepted when it
   * matches ANY clinic's `whatsapp.verifyToken` setting.
   */
  @Public()
  @Get('whatsapp')
  async verifyWhatsAppWebhook(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ) {
    if (mode === 'subscribe' && token) {
      const match = await tenancy.runPrivileged(() =>
        this.prisma.setting.findFirst({ where: { key: 'whatsapp.verifyToken', value: token } }),
      );
      if (match) return res.status(200).send(challenge ?? '');
    }
    return res.status(403).send('Verification failed');
  }

  /**
   * Meta webhook events: patient replies + delivery receipts. Routed to the
   * owning clinic by the payload's phone_number_id; each clinic's events are
   * processed inside its tenant scope. Always answers 200 (Meta hammers
   * non-200 responders with retries); bad signatures are skipped and logged.
   */
  @Public()
  @Post('whatsapp')
  async receiveWhatsAppWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: WaWebhookBody,
  ) {
    for (const entry of body?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!value || !phoneNumberId) continue;

        const owner = await tenancy.runPrivileged(() =>
          this.prisma.setting.findFirst({
            where: { key: 'whatsapp.phoneNumberId', value: phoneNumberId },
            select: { clinicId: true },
          }),
        );
        if (!owner) {
          this.log.warn(`Webhook event for unknown phone_number_id ${phoneNumberId} — ignored`);
          continue;
        }

        await tenancy.runAs(owner.clinicId, async () => {
          const appSecret = await this.messaging.getSetting('whatsapp.appSecret');
          if (appSecret && !this.signatureValid(appSecret, signature, req.rawBody)) {
            this.log.warn(`Invalid webhook signature for clinic ${owner.clinicId} — event skipped`);
            return;
          }

          // Patient replies: match the newest unanswered outbound message to
          // that number; recordReply() interprets YES/1/2/3 and opens the
          // 24h session window via respondedAt.
          for (const m of value.messages ?? []) {
            const text =
              m.text?.body ??
              m.button?.text ??
              m.interactive?.button_reply?.title ??
              m.interactive?.list_reply?.title ??
              '';
            if (!m.from || !text.trim()) continue;
            const last = await this.prisma.message.findFirst({
              where: {
                to: { contains: m.from.slice(-10) },
                status: { in: ['SENT', 'DELIVERED', 'READ'] },
                response: null,
              },
              orderBy: { sentAt: 'desc' },
            });
            if (last) await this.messaging.recordReply(last.id, text.trim());
            else this.log.log(`Reply from unmatched number ${m.from} — ignored`);
          }

          // Delivery receipts: sent -> delivered -> read (never downgrade).
          for (const s of value.statuses ?? []) {
            if (!s.id || !s.status) continue;
            const msg = await this.prisma.message.findFirst({ where: { waMessageId: s.id } });
            if (!msg) continue;
            if (s.status === 'delivered' && msg.status === 'SENT') {
              await this.prisma.message.update({
                where: { id: msg.id },
                data: { status: 'DELIVERED', deliveredAt: new Date() },
              });
            } else if (s.status === 'read' && ['SENT', 'DELIVERED'].includes(msg.status)) {
              await this.prisma.message.update({
                where: { id: msg.id },
                data: { status: 'READ', readAt: new Date(), deliveredAt: msg.deliveredAt ?? new Date() },
              });
            } else if (s.status === 'failed') {
              const detail = s.errors?.[0]?.message || s.errors?.[0]?.title || 'Delivery failed';
              await this.prisma.message.update({
                where: { id: msg.id },
                data: { status: 'FAILED', error: detail.slice(0, 500) },
              });
            }
          }
        });
      }
    }
    return { received: true };
  }

  /**
   * One-click pipe check from the Settings page: sends the reminder template
   * with sample params (templates work outside the 24h window, so this works
   * on a number that has never messaged the clinic). The returned message row
   * carries Meta's verbatim error when something is misconfigured.
   */
  @Roles('DOCTOR', 'ADMIN')
  @Post('test-whatsapp')
  async testWhatsApp(@Body() body: { to: string }) {
    if (!body?.to) throw new BadRequestException('to (phone number) is required');
    const clinic = await this.messaging.getSetting('clinic.name', 'your clinic');
    const doctor = await this.messaging.getSetting('clinic.doctor', 'the doctor');
    return this.messaging.send({
      channel: 'WHATSAPP',
      kind: 'GENERAL',
      to: body.to,
      template: { key: 'reminder', params: ['there', doctor, clinic, 'your next visit'] },
      body: `Test message from ${clinic} — your WhatsApp integration works!`,
    });
  }

  private signatureValid(appSecret: string, signature: string | undefined, raw: Buffer | undefined): boolean {
    if (!signature || !raw) return false;
    try {
      const expected = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
      const a = Buffer.from(signature);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
