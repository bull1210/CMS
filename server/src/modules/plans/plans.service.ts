import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { TimelineService } from '../../core/timeline.service';

export interface PlanItemInput {
  procedureId: number;
  toothRefs?: string;
  phase?: number;
  cost?: number;
  notes?: string;
}

export interface PlanInput {
  patientId: number;
  title: string;
  notes?: string;
  items: PlanItemInput[];
}

const STATUSES = ['PROPOSED', 'ACCEPTED', 'COMPLETED', 'CANCELLED'];

@Injectable()
export class PlansService {
  constructor(
    private prisma: PrismaService,
    private timeline: TimelineService,
  ) {}

  private include() {
    return {
      items: { include: { procedure: { select: { id: true, name: true, cost: true } } } },
      doctor: { select: { id: true, name: true } },
      patient: { select: { id: true, name: true, code: true, phone: true, address: true } },
    };
  }

  list(patientId?: number) {
    return this.prisma.treatmentPlan.findMany({
      where: patientId ? { patientId } : {},
      include: this.include(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: number) {
    const plan = await this.prisma.treatmentPlan.findUnique({
      where: { id },
      include: this.include(),
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  async create(doctorId: number, input: PlanInput) {
    if (!input?.patientId || !input?.title) {
      throw new BadRequestException('patientId and title are required');
    }
    const items = (input.items ?? []).filter((i) => i?.procedureId);
    if (!items.length) throw new BadRequestException('At least one plan item is required');

    const procedures = await this.prisma.procedure.findMany({
      where: { id: { in: items.map((i) => i.procedureId) } },
    });
    const costOf = (id: number) => procedures.find((p) => p.id === id)?.cost ?? 0;

    const plan = await this.prisma.treatmentPlan.create({
      data: {
        patientId: input.patientId,
        doctorId,
        title: input.title,
        notes: input.notes,
        items: {
          create: items.map((i) => ({
            procedureId: i.procedureId,
            toothRefs: i.toothRefs,
            phase: i.phase && i.phase > 0 ? Math.floor(i.phase) : 1,
            cost: i.cost ?? costOf(i.procedureId),
            notes: i.notes,
          })),
        },
      },
      include: this.include(),
    });
    const total = plan.items.reduce((s, i) => s + i.cost, 0);
    await this.timeline.add(
      input.patientId,
      'TREATMENT',
      `Treatment plan proposed: ${plan.title}`,
      `${plan.items.length} procedures, estimate ₹${total}`,
      'TreatmentPlan',
      plan.id,
    );
    return plan;
  }

  /** ACCEPTED materializes every item as a PLANNED treatment. */
  async setStatus(id: number, status: string) {
    if (!STATUSES.includes(status)) throw new BadRequestException('Invalid status');
    const plan = await this.get(id);
    if (plan.status === status) return plan;

    if (status === 'ACCEPTED') {
      // Atomic claim: flip PROPOSED -> ACCEPTED conditionally so two concurrent
      // accepts (double-click, two devices) can never both create treatments.
      const claimed = await this.prisma.treatmentPlan.updateMany({
        where: { id, status: 'PROPOSED' },
        data: { status: 'ACCEPTED', decidedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Only a proposed plan can be accepted');
      }
      for (const item of plan.items) {
        await this.prisma.treatment.create({
          data: {
            patientId: plan.patientId,
            procedureId: item.procedureId,
            doctorId: plan.doctorId,
            status: 'PLANNED',
            toothRefs: item.toothRefs,
            cost: item.cost,
            notes: `From plan: ${plan.title}${item.notes ? ` — ${item.notes}` : ''}`,
          },
        });
      }
    }

    const updated = await this.prisma.treatmentPlan.update({
      where: { id },
      data: {
        status,
        decidedAt: status === 'CANCELLED' ? new Date() : undefined,
      },
      include: this.include(),
    });
    await this.timeline.add(
      plan.patientId,
      'TREATMENT',
      `Treatment plan ${status.toLowerCase()}: ${plan.title}`,
      status === 'ACCEPTED' ? `${plan.items.length} treatments created` : undefined,
      'TreatmentPlan',
      plan.id,
    );
    return updated;
  }
}
