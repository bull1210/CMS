import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { TimelineService } from '../../core/timeline.service';

export interface PatientInput {
  name: string;
  gender?: string;
  dob?: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  emergencyContact?: string;
  referralSource?: string;
  active?: boolean;
  inactiveReason?: string;
  medicalHistory?: Record<string, unknown>;
  dentalHistory?: Record<string, unknown>;
  /** Set true to bypass the duplicate-phone check on create. */
  force?: boolean;
}

@Injectable()
export class PatientsService {
  constructor(
    private prisma: PrismaService,
    private timeline: TimelineService,
  ) {}

  async list(q?: string, page = 1, pageSize = 25) {
    const where = q
      ? {
          OR: [
            { name: { contains: q } },
            { phone: { contains: q } },
            { code: { contains: q } },
            { email: { contains: q } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.patient.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.patient.count({ where }),
    ]);

    // Outstanding = Σ non-VOID invoice totals − Σ payments, computed for just
    // this page's patients in two grouped queries (no N+1). Money is always
    // derived, never stored.
    const ids = items.map((p) => p.id);
    const [billedRows, paidRows] = await Promise.all([
      this.prisma.invoice.groupBy({
        by: ['patientId'],
        where: { patientId: { in: ids }, status: { not: 'VOID' } },
        _sum: { total: true },
      }),
      this.prisma.payment.groupBy({
        by: ['patientId'],
        where: { patientId: { in: ids } },
        _sum: { amount: true },
      }),
    ]);
    const billedBy = new Map(billedRows.map((r) => [r.patientId, r._sum.total ?? 0]));
    const paidBy = new Map(paidRows.map((r) => [r.patientId, r._sum.amount ?? 0]));

    return {
      items: items.map((p) => ({
        ...parsePatient(p),
        outstanding: Math.max(0, (billedBy.get(p.id) ?? 0) - (paidBy.get(p.id) ?? 0)),
      })),
      total,
      page,
      pageSize,
    };
  }

  async get(id: number) {
    const patient = await this.prisma.patient.findUnique({ where: { id } });
    if (!patient) throw new NotFoundException('Patient not found');
    return parsePatient(patient);
  }

  /** Financial + clinical at-a-glance numbers shown as banners on the patient page. */
  async summary(id: number) {
    const [invoices, payments, followUps, plannedTreatments, nextAppointment] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: { patientId: id, status: { not: 'VOID' } },
        _sum: { total: true },
      }),
      this.prisma.payment.aggregate({ where: { patientId: id }, _sum: { amount: true } }),
      this.prisma.followUp.findMany({
        where: { patientId: id, status: 'PENDING' },
        include: { procedure: true },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.treatment.count({
        where: { patientId: id, status: { in: ['PLANNED', 'IN_PROGRESS'] } },
      }),
      this.prisma.appointment.findFirst({
        where: { patientId: id, startsAt: { gte: new Date() }, status: { notIn: ['CANCELLED'] } },
        orderBy: { startsAt: 'asc' },
      }),
    ]);
    const billed = invoices._sum.total ?? 0;
    const paid = payments._sum.amount ?? 0;
    return {
      billed,
      paid,
      outstanding: Math.max(0, billed - paid),
      pendingFollowUps: followUps,
      pendingTreatments: plannedTreatments,
      nextAppointment,
    };
  }

  async create(input: PatientInput) {
    if (!input?.name || !input?.phone) throw new BadRequestException('name and phone are required');

    // Duplicate charts are one of the most common front-desk data mistakes:
    // same person registered twice splits their history and billing. Flag an
    // existing patient with this phone; `force: true` overrides (families do
    // share phones).
    if (!input.force) {
      const existing = await this.prisma.patient.findFirst({
        where: { phone: input.phone.trim() },
        select: { id: true, code: true, name: true },
      });
      if (existing) {
        throw new ConflictException(
          `A patient with this phone already exists: ${existing.name} (${existing.code}). ` +
            'Open their chart, or create anyway if this is a family member sharing the number.',
        );
      }
    }

    // Per-clinic sequential code (every clinic starts at P-0001). Concurrent
    // registrations are safe: the [clinicId, code] unique constraint catches
    // the collision and we retry with the next number — the same sanctioned
    // pattern invoice numbers use. (Id-derived codes would be collision-free
    // but leak cross-tenant volume and skip numbers per clinic.)
    const { force: _force, ...data } = input;
    for (let attempt = 0; ; attempt++) {
      const count = await this.prisma.patient.count(); // tenant-scoped: this clinic only
      try {
        const patient = await this.prisma.patient.create({
          data: {
            code: `P-${String(count + 1 + attempt).padStart(4, '0')}`,
            ...normalize(data),
          } as never,
        });
        await this.timeline.add(patient.id, 'NOTE', 'Patient registered', undefined, 'Patient', patient.id);
        return parsePatient(patient);
      } catch (e) {
        const unique = (e as { code?: string }).code === 'P2002';
        if (!unique || attempt >= 5) throw e;
      }
    }
  }

  async update(id: number, input: Partial<PatientInput>) {
    const { force: _force, ...data } = input;
    const before = await this.prisma.patient.findUnique({ where: { id }, select: { active: true } });
    const patient = await this.prisma.patient.update({
      where: { id },
      data: normalize(data) as never,
    });
    if (input.active !== undefined && before && input.active === before.active) {
      return parsePatient(patient); // no archive-state change — nothing to log
    }
    if (input.active === false) {
      await this.timeline.add(
        id,
        'NOTE',
        `Patient archived${input.inactiveReason ? ` (${input.inactiveReason.toLowerCase().replace(/_/g, ' ')})` : ''}`,
        undefined,
        'Patient',
        id,
      );
    } else if (input.active === true) {
      await this.timeline.add(id, 'NOTE', 'Patient re-activated', undefined, 'Patient', id);
    }
    return parsePatient(patient);
  }

  timelineFor(id: number) {
    return this.timeline.forPatient(id);
  }
}

function normalize(input: Partial<PatientInput>) {
  const data: Record<string, unknown> = { ...input };
  if (input.dob !== undefined) data.dob = input.dob ? new Date(input.dob) : null;
  if (input.medicalHistory !== undefined) data.medicalHistory = JSON.stringify(input.medicalHistory ?? {});
  if (input.dentalHistory !== undefined) data.dentalHistory = JSON.stringify(input.dentalHistory ?? {});
  return data;
}

function parsePatient<T extends { medicalHistory: string; dentalHistory: string }>(p: T) {
  return {
    ...p,
    medicalHistory: safeJson(p.medicalHistory),
    dentalHistory: safeJson(p.dentalHistory),
  };
}

function safeJson(s: string) {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}
