import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { TimelineService } from '../../core/timeline.service';
import { AuthUser, CurrentUser } from '../../core/auth.guard';
import { AuditService } from '../../core/audit.service';
import { RiskService } from './risk.service';

const STATUSES = ['SCHEDULED', 'CONFIRMED', 'WAITING', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
const TYPES = ['CONSULTATION', 'FOLLOW_UP', 'PROCEDURE', 'EMERGENCY'];

@Controller('appointments')
export class AppointmentsController {
  constructor(
    private prisma: PrismaService,
    private timeline: TimelineService,
    private audit: AuditService,
    private risk: RiskService,
  ) {}

  /** No-show risk scores for upcoming appointments (default 48h horizon). */
  @Get('risk')
  riskList(@Query('hours') hours?: string) {
    return this.risk.upcoming(Math.min(Number(hours) || 48, 24 * 14));
  }

  /**
   * Pre-flight overlap check so the booking form can warn BEFORE committing,
   * rather than the user discovering a double-booking after the fact.
   */
  @Get('clash')
  async clash(
    @Query('startsAt') startsAt: string,
    @Query('durationMin') durationMin?: string,
    @Query('doctorId') doctorId?: string,
    @Query('excludeId') excludeId?: string,
  ) {
    if (!startsAt) throw new BadRequestException('startsAt is required');
    const start = new Date(startsAt);
    const end = new Date(start.getTime() + (Number(durationMin) || 30) * 60_000);
    const hit = await this.findClash(start, end, doctorId ? Number(doctorId) : undefined, excludeId ? Number(excludeId) : undefined);
    return {
      clash: hit
        ? { id: hit.id, startsAt: hit.startsAt, endsAt: hit.endsAt, patientName: hit.patient?.name ?? null }
        : null,
    };
  }

  /** Active appointments overlapping [start, end), optionally excluding one id. */
  private findClash(start: Date, end: Date, doctorId?: number, excludeId?: number) {
    return this.prisma.appointment.findFirst({
      where: {
        status: { in: ['SCHEDULED', 'CONFIRMED', 'WAITING'] },
        ...(doctorId ? { doctorId } : {}),
        ...(excludeId ? { id: { not: excludeId } } : {}),
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
      include: { patient: { select: { name: true } } },
    });
  }

  /** Calendar feed: all appointments intersecting [from, to). */
  @Get()
  list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('patientId') patientId?: string,
    @Query('status') status?: string,
  ) {
    return this.prisma.appointment.findMany({
      where: {
        ...(from && to ? { startsAt: { gte: new Date(from), lt: new Date(to) } } : {}),
        ...(patientId ? { patientId: Number(patientId) } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        patient: { select: { id: true, name: true, code: true, phone: true, whatsapp: true } },
        doctor: { select: { id: true, name: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      patientId: number;
      doctorId?: number;
      startsAt: string;
      durationMin?: number;
      type?: string;
      notes?: string;
      followUpId?: number;
    },
  ) {
    if (!body?.patientId || !body?.startsAt) {
      throw new BadRequestException('patientId and startsAt are required');
    }
    if (body.type && !TYPES.includes(body.type)) throw new BadRequestException('Invalid type');

    // Scheduling a future visit for an archived patient is almost always the
    // wrong patient picked — archive means "no more activity". Block it; the
    // user can re-activate the chart first if they really mean to.
    const patient = await this.prisma.patient.findUnique({
      where: { id: body.patientId },
      select: { active: true, name: true },
    });
    if (!patient) throw new BadRequestException('Patient not found');
    if (!patient.active) {
      throw new BadRequestException(
        `${patient.name} is archived. Re-activate the patient before booking a new appointment.`,
      );
    }

    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(startsAt.getTime() + (body.durationMin ?? 30) * 60_000);

    const clash = await this.findClash(startsAt, endsAt, body.doctorId);

    const appt = await this.prisma.appointment.create({
      data: {
        patientId: body.patientId,
        doctorId: body.doctorId,
        startsAt,
        endsAt,
        type: body.type ?? 'CONSULTATION',
        notes: body.notes,
      },
      include: { patient: { select: { id: true, name: true } } },
    });

    // Booking an appointment from a pending follow-up marks it BOOKED.
    if (body.followUpId) {
      await this.prisma.followUp.updateMany({
        where: { id: body.followUpId, status: 'PENDING' },
        data: { status: 'BOOKED' },
      });
    }

    await this.timeline.add(
      body.patientId,
      'APPOINTMENT',
      `Appointment scheduled (${appt.type.toLowerCase().replace('_', ' ')})`,
      startsAt.toLocaleString(),
      'Appointment',
      appt.id,
    );
    await this.audit.log(user.sub, 'CREATE', 'Appointment', appt.id);
    return {
      ...appt,
      clashWarning: clash ? `Overlaps ${clash.patient?.name ?? 'another appointment'} at that time` : null,
    };
  }

  @Put(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: { startsAt?: string; durationMin?: number; type?: string; notes?: string; doctorId?: number },
  ) {
    const current = await this.prisma.appointment.findUniqueOrThrow({ where: { id } });
    const startsAt = body.startsAt ? new Date(body.startsAt) : current.startsAt;
    const duration = body.durationMin
      ? body.durationMin * 60_000
      : current.endsAt.getTime() - current.startsAt.getTime();
    const endsAt = new Date(startsAt.getTime() + duration);

    // Rescheduling could drop the appointment onto an occupied slot; the
    // original create checked for this but the reschedule path did not.
    const clash =
      body.startsAt || body.durationMin
        ? await this.findClash(startsAt, endsAt, body.doctorId ?? current.doctorId ?? undefined, id)
        : null;

    const appt = await this.prisma.appointment.update({
      where: { id },
      data: { startsAt, endsAt, type: body.type, notes: body.notes, doctorId: body.doctorId },
    });
    if (body.startsAt) {
      await this.timeline.add(appt.patientId, 'APPOINTMENT', 'Appointment rescheduled', startsAt.toLocaleString(), 'Appointment', id);
    }
    await this.audit.log(user.sub, 'UPDATE', 'Appointment', id);
    return {
      ...appt,
      clashWarning: clash ? `Overlaps ${clash.patient?.name ?? 'another appointment'} at that time` : null,
    };
  }

  @Put(':id/status')
  async setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status: string },
  ) {
    if (!STATUSES.includes(body?.status)) throw new BadRequestException('Invalid status');
    const appt = await this.prisma.appointment.update({
      where: { id },
      data: { status: body.status },
    });
    await this.timeline.add(
      appt.patientId,
      'APPOINTMENT',
      `Appointment ${body.status.toLowerCase().replace('_', ' ')}`,
      undefined,
      'Appointment',
      id,
    );
    await this.audit.log(user.sub, 'STATUS', 'Appointment', id, body.status);
    return appt;
  }
}
