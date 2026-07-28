import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { Roles } from '../../core/auth.guard';

function range(from?: string, to?: string) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86400_000);
  return { start, end };
}

@Roles('DOCTOR', 'ADMIN')
@Controller('reports')
export class ReportsController {
  constructor(private prisma: PrismaService) {}

  /** Revenue by day within a range (payments received). */
  @Get('revenue')
  async revenue(@Query('from') from?: string, @Query('to') to?: string) {
    const { start, end } = range(from, to);
    const payments = await this.prisma.payment.findMany({
      where: { paidAt: { gte: start, lte: end } },
      orderBy: { paidAt: 'asc' },
    });
    const byDay = new Map<string, number>();
    for (const p of payments) {
      const key = p.paidAt.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + p.amount);
    }
    return {
      from: start,
      to: end,
      total: payments.reduce((s, p) => s + p.amount, 0),
      count: payments.length,
      byDay: [...byDay.entries()].map(([date, amount]) => ({ date, amount })),
      byMethod: Object.entries(
        payments.reduce<Record<string, number>>((acc, p) => {
          acc[p.method] = (acc[p.method] ?? 0) + p.amount;
          return acc;
        }, {}),
      ).map(([method, amount]) => ({ method, amount })),
    };
  }

  /** Most performed procedures within a range. */
  @Get('treatments')
  async treatments(@Query('from') from?: string, @Query('to') to?: string) {
    const { start, end } = range(from, to);
    const rows = await this.prisma.treatment.findMany({
      where: { createdAt: { gte: start, lte: end } },
      include: { procedure: { select: { name: true } } },
    });
    const agg = new Map<string, { count: number; revenue: number; completed: number }>();
    for (const t of rows) {
      const cur = agg.get(t.procedure.name) ?? { count: 0, revenue: 0, completed: 0 };
      cur.count++;
      cur.revenue += t.cost;
      if (t.status === 'COMPLETED') cur.completed++;
      agg.set(t.procedure.name, cur);
    }
    return [...agg.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count);
  }

  /** New vs returning patients within a range. */
  @Get('patients')
  async patients(@Query('from') from?: string, @Query('to') to?: string) {
    const { start, end } = range(from, to);
    const [newPatients, appts] = await Promise.all([
      this.prisma.patient.count({ where: { createdAt: { gte: start, lte: end } } }),
      this.prisma.appointment.findMany({
        where: { startsAt: { gte: start, lte: end }, status: 'COMPLETED' },
        include: { patient: { select: { id: true, createdAt: true } } },
      }),
    ]);
    const returning = new Set(
      appts.filter((a) => a.patient.createdAt < start).map((a) => a.patientId),
    ).size;
    const total = await this.prisma.patient.count();
    return { newPatients, returningPatients: returning, totalPatients: total };
  }

  /** Cancellation / no-show rates within a range. */
  @Get('appointments')
  async appointments(@Query('from') from?: string, @Query('to') to?: string) {
    const { start, end } = range(from, to);
    const rows = await this.prisma.appointment.groupBy({
      by: ['status'],
      where: { startsAt: { gte: start, lte: end } },
      _count: true,
    });
    const counts = Object.fromEntries(rows.map((r) => [r.status, r._count]));
    const total = rows.reduce((s, r) => s + r._count, 0);
    const rate = (n?: number) => (total ? Math.round(((n ?? 0) / total) * 1000) / 10 : 0);
    return {
      total,
      byStatus: counts,
      cancellationRate: rate(counts['CANCELLED']),
      noShowRate: rate(counts['NO_SHOW']),
      completionRate: rate(counts['COMPLETED']),
    };
  }

  /** Profit & loss: payments received vs expenses recorded within a range. */
  @Get('pnl')
  async pnl(@Query('from') from?: string, @Query('to') to?: string) {
    const { start, end } = range(from, to);
    const [payments, expenses] = await Promise.all([
      this.prisma.payment.aggregate({ where: { paidAt: { gte: start, lte: end } }, _sum: { amount: true } }),
      this.prisma.expense.findMany({ where: { date: { gte: start, lte: end } } }),
    ]);
    const revenue = payments._sum.amount ?? 0;
    const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);
    const byCategory = Object.entries(
      expenses.reduce<Record<string, number>>((acc, e) => {
        acc[e.category] = (acc[e.category] ?? 0) + e.amount;
        return acc;
      }, {}),
    )
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
    return { from: start, to: end, revenue, expenses: expenseTotal, byCategory, net: revenue - expenseTotal };
  }

  /**
   * Revenue leakage radar — money the clinic has earned or planned but is
   * quietly losing track of:
   *   1. completed treatments that were never invoiced
   *   2. unpaid invoices older than 14 days
   *   3. planned treatments whose patient has nothing booked (work agreed, then drifted)
   *   4. follow-ups overdue by more than a week
   */
  @Get('leakage')
  async leakage() {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - 14 * 86400_000);
    const followUpCutoff = new Date(now.getTime() - 7 * 86400_000);
    const patientSel = { select: { id: true, name: true, code: true, phone: true } };

    const [unbilled, staleInvoices, planned, overdueFollowUps] = await Promise.all([
      this.prisma.treatment.findMany({
        where: {
          status: 'COMPLETED',
          cost: { gt: 0 },
          invoices: { none: {} },
          patient: { active: true },
        },
        include: { patient: patientSel, procedure: { select: { name: true } } },
        orderBy: { performedAt: 'desc' },
      }),
      this.prisma.invoice.findMany({
        where: { status: { in: ['OPEN', 'PARTIAL'] }, createdAt: { lt: staleCutoff } },
        include: { patient: patientSel, payments: { select: { amount: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.treatment.findMany({
        where: {
          status: 'PLANNED',
          patient: {
            active: true,
            appointments: {
              none: { startsAt: { gt: now }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
            },
          },
        },
        include: { patient: patientSel, procedure: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.followUp.findMany({
        where: { status: 'PENDING', dueDate: { lt: followUpCutoff }, patient: { active: true } },
        include: { patient: patientSel, procedure: { select: { name: true, cost: true } } },
        orderBy: { dueDate: 'asc' },
      }),
    ]);

    const stale = staleInvoices.map((inv) => ({
      id: inv.id,
      number: inv.number,
      createdAt: inv.createdAt,
      patient: inv.patient,
      total: inv.total,
      pending: Math.max(0, inv.total - inv.payments.reduce((s, p) => s + p.amount, 0)),
    }));
    const round = (n: number) => Math.round(n * 100) / 100;

    return {
      unbilledTreatments: {
        items: unbilled.map((t) => ({
          id: t.id,
          patient: t.patient,
          procedure: t.procedure.name,
          cost: t.cost,
          performedAt: t.performedAt,
        })),
        total: round(unbilled.reduce((s, t) => s + t.cost, 0)),
      },
      staleInvoices: {
        items: stale,
        total: round(stale.reduce((s, i) => s + i.pending, 0)),
      },
      driftingPlanned: {
        items: planned.map((t) => ({
          id: t.id,
          patient: t.patient,
          procedure: t.procedure.name,
          cost: t.cost,
          createdAt: t.createdAt,
        })),
        total: round(planned.reduce((s, t) => s + t.cost, 0)),
      },
      overdueFollowUps: {
        items: overdueFollowUps.map((f) => ({
          id: f.id,
          patient: f.patient,
          procedure: f.procedure?.name ?? null,
          estValue: f.procedure?.cost ?? 0,
          dueDate: f.dueDate,
        })),
        total: round(overdueFollowUps.reduce((s, f) => s + (f.procedure?.cost ?? 0), 0)),
      },
    };
  }

  /** Where patients come from — marketing attribution. */
  @Get('referrals')
  async referrals() {
    const rows = await this.prisma.patient.groupBy({ by: ['referralSource'], _count: true });
    return rows
      .map((r) => ({ source: r.referralSource ?? 'Unknown', count: r._count }))
      .sort((a, b) => b.count - a.count);
  }

  /** Patients inactive for 6+ months / pending treatment / dues — recall list (AI-ready). */
  @Get('recall')
  async recall() {
    const sixMonthsAgo = new Date(Date.now() - 182 * 86400_000);
    const patients = await this.prisma.patient.findMany({
      where: { active: true },
      include: {
        appointments: { orderBy: { startsAt: 'desc' }, take: 1 },
        treatments: { where: { status: { in: ['PLANNED', 'IN_PROGRESS'] } }, take: 1 },
      },
    });
    return patients
      .filter((p) => {
        const last = p.appointments[0]?.startsAt;
        return !last || last < sixMonthsAgo || p.treatments.length > 0;
      })
      .map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        phone: p.phone,
        lastVisit: p.appointments[0]?.startsAt ?? null,
        hasPendingTreatment: p.treatments.length > 0,
      }));
  }
}
