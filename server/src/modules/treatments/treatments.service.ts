import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { TimelineService } from '../../core/timeline.service';
import { MessagingService } from '../messaging/messaging.service';

export interface TreatmentInput {
  patientId: number;
  procedureId: number;
  status?: string;
  toothRefs?: string;
  notes?: string;
  cost?: number;
  performedAt?: string;
}

const STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

@Injectable()
export class TreatmentsService {
  constructor(
    private prisma: PrismaService,
    private timeline: TimelineService,
    private messaging: MessagingService,
  ) {}

  list(patientId?: number, status?: string) {
    return this.prisma.treatment.findMany({
      where: {
        ...(patientId ? { patientId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        procedure: { include: { followUp: { select: { id: true, name: true } } } },
        doctor: { select: { id: true, name: true } },
        patient: { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(doctorId: number, input: TreatmentInput) {
    if (!input?.patientId || !input?.procedureId) {
      throw new BadRequestException('patientId and procedureId are required');
    }
    const procedure = await this.prisma.procedure.findUniqueOrThrow({
      where: { id: input.procedureId },
    });
    const status = input.status && STATUSES.includes(input.status) ? input.status : 'PLANNED';
    const treatment = await this.prisma.treatment.create({
      data: {
        patientId: input.patientId,
        procedureId: input.procedureId,
        doctorId,
        status,
        toothRefs: input.toothRefs,
        notes: input.notes,
        cost: input.cost ?? procedure.cost,
        performedAt: input.performedAt ? new Date(input.performedAt) : status === 'COMPLETED' ? new Date() : null,
      },
      include: { procedure: true },
    });
    await this.timeline.add(
      input.patientId,
      'TREATMENT',
      `${procedure.name} — ${status.toLowerCase().replace('_', ' ')}`,
      input.notes,
      'Treatment',
      treatment.id,
    );
    if (status === 'COMPLETED') await this.onCompleted(treatment.id);
    return treatment;
  }

  async updateStatus(id: number, status: string, notes?: string) {
    if (!STATUSES.includes(status)) throw new BadRequestException('Invalid status');
    // Terminal states stay terminal: re-completing would re-fire the follow-up
    // engine, and resurrecting cancelled/completed work corrupts history.
    const ALLOWED: Record<string, string[]> = {
      PLANNED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
      IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: ['PLANNED'],
    };
    const current = await this.prisma.treatment.findUniqueOrThrow({ where: { id } });
    if (!ALLOWED[current.status]?.includes(status)) {
      throw new BadRequestException(
        `Cannot change a ${current.status.toLowerCase().replace('_', ' ')} treatment to ${status.toLowerCase().replace('_', ' ')}`,
      );
    }
    const treatment = await this.prisma.treatment.update({
      where: { id },
      data: {
        status,
        notes: notes ?? undefined,
        performedAt: status === 'COMPLETED' ? new Date() : undefined,
      },
      include: { procedure: true },
    });
    await this.timeline.add(
      treatment.patientId,
      'TREATMENT',
      `${treatment.procedure.name} — ${status.toLowerCase().replace('_', ' ')}`,
      notes,
      'Treatment',
      treatment.id,
    );
    if (status === 'COMPLETED') await this.onCompleted(id);
    return treatment;
  }

  /**
   * Smart recommendation engine. When a treatment completes and its procedure
   * defines a next step in the flow, this:
   *  1. creates a PENDING follow-up due after the configured interval
   *     (surfaces on the doctor's dashboard as an alert), and
   *  2. sends the patient a WhatsApp/SMS recommendation.
   */
  private async onCompleted(treatmentId: number) {
    const treatment = await this.prisma.treatment.findUniqueOrThrow({
      where: { id: treatmentId },
      include: { procedure: { include: { followUp: true } }, patient: true },
    });
    const next = treatment.procedure.followUp;
    if (!next) return;

    const existing = await this.prisma.followUp.findFirst({
      where: { sourceTreatmentId: treatmentId, status: { in: ['PENDING', 'BOOKED'] } },
    });
    if (existing) return;

    const days = treatment.procedure.followUpDays ?? 14;
    const dueDate = new Date(Date.now() + days * 86400_000);
    const followUp = await this.prisma.followUp.create({
      data: {
        patientId: treatment.patientId,
        procedureId: next.id,
        sourceTreatmentId: treatmentId,
        dueDate,
        note: `Recommended after ${treatment.procedure.name}`,
      },
    });
    await this.timeline.add(
      treatment.patientId,
      'FOLLOW_UP',
      `Follow-up recommended: ${next.name}`,
      `Due ${dueDate.toDateString()} (${days} days after ${treatment.procedure.name})`,
      'FollowUp',
      followUp.id,
    );

    const doctorName = await this.messaging.getSetting('clinic.doctor', 'your doctor');
    await this.messaging.send({
      patientId: treatment.patientId,
      channel: treatment.patient.whatsapp ? 'WHATSAPP' : 'SMS',
      kind: 'RECOMMENDATION',
      to: treatment.patient.whatsapp || treatment.patient.phone,
      refType: 'FOLLOWUP',
      refId: followUp.id,
      body:
        `Hello ${treatment.patient.name},\n\nBased on your recent ${treatment.procedure.name}, ` +
        `${doctorName} recommends ${next.name} for improved dental health. ` +
        `Reply YES to schedule.`,
    });
  }
}
