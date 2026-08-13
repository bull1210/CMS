import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { tenancy } from '../../core/tenancy';
import { MessagingService } from './messaging.service';
import { RemindersScheduler } from './reminders.scheduler';
import { Public } from '../../core/auth.guard';

@Controller('messages')
export class MessagingController {
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
}
