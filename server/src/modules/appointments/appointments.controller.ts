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

const STATUSES = ['SCHEDULED', 'CONFIRMED', 'WAITING', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'];
const TYPES = ['CONSULTATION', 'FOLLOW_UP', 'PROCEDURE', 'EMERGENCY'];

const formatDoc = (name: string) => (name.startsWith('Dr.') || name.startsWith('Dr ')) ? name : `Dr. ${name}`;
const formatStatus = (status: string) => {
  if (status === 'WAITING') return 'In Clinic';
  if (status === 'NO_SHOW') return 'No Show';
  return status.charAt(0) + status.slice(1).toLowerCase();
};

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
    @Query('patientId') patientId?: string,
    @Query('excludeId') excludeId?: string,
  ) {
    if (!startsAt) throw new BadRequestException('startsAt is required');
    const start = new Date(startsAt);
    const end = new Date(start.getTime() + (Number(durationMin) || 30) * 60_000);
    const hit = await this.findClash(
      start, 
      end, 
      doctorId ? Number(doctorId) : undefined, 
      patientId ? Number(patientId) : undefined, 
      excludeId ? Number(excludeId) : undefined
    );
    return {
      clash: hit
        ? { id: hit.id, startsAt: hit.startsAt, endsAt: hit.endsAt, patientName: hit.patient?.name ?? null }
        : null,
    };
  }

  /** Active appointments overlapping [start, end), optionally excluding one id. */
  private async checkClosures(start: Date, doctorId: number) {
    const dKey = start.toISOString().slice(0, 10); // get yyyy-MM-dd in UTC but startsAt might be local, better to just use slice(0,10) since startsAt is already ISO format from frontend. Wait, startsAt is Date. To get local yyyy-mm-dd:
    // JS dates are tricky. We can just use the string format if we had it, but we have a Date object.
    // Let's format it properly:
    const tzOffset = start.getTimezoneOffset() * 60000;
    const localISOTime = new Date(start.getTime() - tzOffset).toISOString().slice(0, -1);
    const dateStr = localISOTime.slice(0, 10);
    
    const clinicClosureRow = await this.prisma.setting.findUnique({ where: { key: 'clinic.closures' } });
    if (clinicClosureRow?.value) {
      try {
        const c = JSON.parse(clinicClosureRow.value);
        if (c[dateStr]) throw new BadRequestException(`Cannot book: Clinic is closed on ${dateStr} (${c[dateStr]})`);
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
      }
    }

    const doctorClosureRow = await this.prisma.setting.findUnique({ where: { key: 'doctor.closures' } });
    if (doctorClosureRow?.value) {
      try {
        const c = JSON.parse(doctorClosureRow.value);
        if (c[doctorId]?.[dateStr]) {
          throw new BadRequestException(`Cannot book: Doctor is unavailable on ${dateStr} (${c[doctorId][dateStr]})`);
        }
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
      }
    }
  }

  /** Active appointments overlapping [start, end), optionally excluding one id. */
  private findClash(start: Date, end: Date, doctorId?: number, patientId?: number, excludeId?: number) {
    const orConditions: any[] = [];
    if (doctorId) orConditions.push({ doctorId });
    if (patientId) orConditions.push({ patientId });
    
    return this.prisma.appointment.findFirst({
      where: {
        status: { in: ['SCHEDULED', 'CONFIRMED', 'WAITING'] },
        OR: orConditions.length > 0 ? orConditions : undefined,
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
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('patientId') patientId?: string,
    @Query('status') status?: string,
    @Query('doctorId') doctorId?: string,
  ) {
    const filterDocId = user.role === 'DOCTOR' ? user.sub : (doctorId ? Number(doctorId) : undefined);

    return this.prisma.appointment.findMany({
      where: {
        ...(from && to ? { startsAt: { gte: new Date(from), lt: new Date(to) } } : {}),
        ...(patientId ? { patientId: Number(patientId) } : {}),
        ...(status ? { status } : {}),
        ...(filterDocId ? { doctorId: filterDocId } : {}),
      },
      include: {
        patient: { select: { id: true, name: true, code: true, phone: true, whatsapp: true } },
        doctor: { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
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
      doctorId: number;
      startsAt: string;
      durationMin?: number;
      type?: string;
      notes?: string;
      followUpId?: number;
      closeMismatchFollowUpId?: number;
    },
  ) {
    if (!body?.patientId || !body?.startsAt || !body?.doctorId) {
      throw new BadRequestException('patientId, startsAt, and doctorId are required');
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

    await this.checkClosures(startsAt, body.doctorId);

    const appt = await this.prisma.appointment.create({
      data: {
        patientId: body.patientId,
        doctorId: body.doctorId,
        startsAt,
        endsAt,
        type: body.type ?? 'CONSULTATION',
        notes: body.notes,
        createdById: user.sub,
      },
      include: { 
        patient: { select: { id: true, name: true } },
        doctor: { select: { name: true } }
      },
    });

    const userRow = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { name: true } });
    const creatorName = userRow?.name || `Assistant`;
    const docName = formatDoc(appt.doctor?.name || `ID ${body.doctorId}`);
    const apptTypeStr = (body.type ?? 'CONSULTATION').toLowerCase().replace('_', ' ');

    // Booking an appointment from a pending follow-up marks it BOOKED.
    if (body.followUpId) {
      const fu = await this.prisma.followUp.findUnique({ where: { id: body.followUpId } });
      await this.prisma.followUp.updateMany({
        where: { id: body.followUpId, status: 'PENDING' },
        data: { status: 'BOOKED' },
      });
      
      // If this was a reschedule task, hide the old cancelled appointment by setting it to RESCHEDULED
      if (fu?.note?.includes('Original appt ID: ')) {
        const match = fu.note.match(/Original appt ID:\s*(\d+)/);
        if (match && match[1]) {
          await this.prisma.appointment.updateMany({
            where: { id: parseInt(match[1], 10) },
            data: { status: 'RESCHEDULED' }
          });
        }
      }
    } else {
      // Auto-resolve pending reschedule tasks if booking normally
      const pendingReschedules = await this.prisma.followUp.findMany({
        where: {
          patientId: body.patientId,
          status: 'PENDING',
          note: { contains: 'RESCHEDULE' }
        }
      });
      
      for (const fu of pendingReschedules) {
        const doctorMatch = fu.note?.match(/Doctor ID:\s*(\d+)/);
        const originalDocId = doctorMatch && doctorMatch[1] ? parseInt(doctorMatch[1], 10) : null;
        
        if (originalDocId === body.doctorId || !originalDocId) {
          // Same doctor, auto-close the task
          await this.prisma.followUp.update({
            where: { id: fu.id },
            data: { status: 'BOOKED' }
          });
          
          if (fu.note?.includes('Original appt ID: ')) {
            const match = fu.note.match(/Original appt ID:\s*(\d+)/);
            if (match && match[1]) {
              await this.prisma.appointment.updateMany({
                where: { id: parseInt(match[1], 10) },
                data: { status: 'RESCHEDULED' }
              });
            }
          }
        } else if (body.closeMismatchFollowUpId === fu.id) {
          // Explicitly requested to close mismatch task
          const doctorRow = await this.prisma.user.findUnique({ where: { id: body.doctorId }, select: { name: true } });
          const newDocName = doctorRow ? doctorRow.name : `ID ${body.doctorId}`;
          const resText = `Resolved: New appointment booked under doctor ${newDocName}`;
          await this.prisma.followUp.update({
            where: { id: fu.id },
            data: { 
              status: 'DONE',
              note: fu.note ? `${fu.note}\n${resText}` : resText
            }
          });
          
          if (fu.note?.includes('Original appt ID: ')) {
            const match = fu.note.match(/Original appt ID:\s*(\d+)/);
            if (match && match[1]) {
              await this.prisma.appointment.updateMany({
                where: { id: parseInt(match[1], 10) },
                data: { status: 'RESCHEDULED' }
              });
            }
          }
        }
      }
    }

    await this.timeline.add(
      body.patientId,
      'APPOINTMENT',
      `Appointment scheduled with ${docName} (${apptTypeStr}) by ${creatorName}${body.notes ? `: ${body.notes}` : ''}`,
      startsAt.toLocaleString(),
      'Appointment',
      appt.id,
    );
    await this.audit.log(user.sub, 'CREATE', 'Appointment', appt.id);
    const clash = await this.findClash(startsAt, endsAt, body.doctorId, body.patientId);
    if (clash) {
      const clashMsg = clash.patientId === body.patientId 
        ? `Patient is already booked for another appointment at that time`
        : `Overlaps ${clash.patient?.name ?? 'another appointment'} at that time`;
      return {
        ...appt,
        clashWarning: clashMsg,
      };
    };
    return appt;
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
    if (body.startsAt || body.doctorId) {
      await this.checkClosures(startsAt, body.doctorId ?? current.doctorId!);
    }
    const clash = await this.findClash(
      startsAt, 
      endsAt, 
      body.doctorId ?? current.doctorId ?? undefined, 
      current.patientId, 
      id
    );

    const appt = await this.prisma.appointment.update({
      where: { id },
      data: { startsAt, endsAt, type: body.type, notes: body.notes, doctorId: body.doctorId },
      include: { 
        doctor: { select: { name: true } }
      }
    });

    const userRow = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { name: true } });
    const updaterName = userRow?.name || `Assistant`;
    const docName = formatDoc(appt.doctor?.name || `ID ${appt.doctorId}`);

    if (body.startsAt) {
      await this.timeline.add(appt.patientId, 'APPOINTMENT', `Appointment rescheduled with ${docName} by ${updaterName}`, startsAt.toLocaleString(), 'Appointment', id);
    }
    await this.audit.log(user.sub, 'UPDATE', 'Appointment', id);
    
    let clashWarning = null;
    if (clash) {
      clashWarning = clash.patientId === appt.patientId 
        ? `Patient is already booked for another appointment at that time`
        : `Overlaps ${clash.patient?.name ?? 'another appointment'} at that time`;
    }
    
    return {
      ...appt,
      clashWarning,
    };
  }

  @Put(':id/status')
  async setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status: string; reason?: string },
  ) {
    if (!STATUSES.includes(body?.status) && body?.status !== 'IN_CLINIC') throw new BadRequestException('Invalid status');
    
    // Map IN_CLINIC to WAITING in the DB for backward compatibility, or keep IN_CLINIC if added to ENUM.
    // Let's assume IN_CLINIC is handled by WAITING or we just store IN_CLINIC since it's a string.
    // The schema allows any string.
    const appt = await this.prisma.appointment.update({
      where: { id },
      data: { status: body.status },
      include: { doctor: { select: { name: true } } }
    });
    
    const userRow = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { name: true } });
    const updaterName = userRow?.name || `Assistant`;
    const docName = formatDoc(appt.doctor?.name || `ID ${appt.doctorId}`);
    
    if (body.status === 'CANCELLED') {
      const reasonText = body.reason ? ` (${body.reason})` : '';
      await this.prisma.followUp.create({
        data: {
          patientId: appt.patientId,
          dueDate: appt.startsAt,
          status: 'PENDING',
          note: `RESCHEDULE: Cancelled${reasonText}. Original appt ID: ${appt.id}, Doctor ID: ${appt.doctorId || ''}`,
        }
      });
    }
    
    if (body.status === 'CANCELLED') {
      const reasonMsg = body.reason ? `: ${body.reason}` : '';
      await this.timeline.add(
        appt.patientId,
        'APPOINTMENT',
        `Appointment cancelled with ${docName} by ${updaterName}${reasonMsg}`,
        undefined,
        'Appointment',
        id,
      );
    } else {
      await this.timeline.add(
        appt.patientId,
        'APPOINTMENT',
        `Appointment status changed to '${formatStatus(body.status)}' with ${docName} by ${updaterName}`,
        undefined,
        'Appointment',
        id,
      );
    }

    await this.audit.log(user.sub, 'STATUS', 'Appointment', id, body.status);
    return appt;
  }
}
