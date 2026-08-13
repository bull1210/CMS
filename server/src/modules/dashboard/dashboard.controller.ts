import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { AuthUser, CurrentUser } from '../../core/auth.guard';

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

@Controller('dashboard')
export class DashboardController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async summary(@CurrentUser() user: AuthUser) {
    const now = new Date();
    const today = startOfDay();
    const tomorrow = new Date(today.getTime() + 86400_000);
    const weekStart = new Date(today.getTime() - ((today.getDay() + 6) % 7) * 86400_000); // Monday
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const docFilter = user.role === 'DOCTOR' ? { doctorId: user.sub } : {};

    const [
      todaysAppointments,
      followUpsDue,
      pendingTreatments,
      revenueToday,
      revenueWeek,
      revenueMonth,
      billedAgg,
      paidAgg,
      unpaidInvoices,
      missedRecent,
      recentMessages,
      labWorksOpen,
      lowStock,
    ] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { startsAt: { gte: today, lt: tomorrow }, ...docFilter },
        include: { patient: { select: { id: true, name: true, code: true, phone: true } } },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.followUp.findMany({
        where: { status: 'PENDING', dueDate: { lte: new Date(now.getTime() + 7 * 86400_000) } },
        include: {
          patient: { select: { id: true, name: true, code: true } },
          procedure: { select: { id: true, name: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 50,
      }),
      this.prisma.treatment.findMany({
        where: { status: { in: ['PLANNED', 'IN_PROGRESS'] }, ...docFilter },
        include: {
          patient: { select: { id: true, name: true, code: true } },
          procedure: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
      this.prisma.payment.aggregate({ where: { paidAt: { gte: today } }, _sum: { amount: true } }),
      this.prisma.payment.aggregate({ where: { paidAt: { gte: weekStart } }, _sum: { amount: true } }),
      this.prisma.payment.aggregate({ where: { paidAt: { gte: monthStart } }, _sum: { amount: true } }),
      this.prisma.invoice.aggregate({ where: { status: { not: 'VOID' } }, _sum: { total: true } }),
      this.prisma.payment.aggregate({ _sum: { amount: true } }),
      this.prisma.invoice.count({ where: { status: { in: ['OPEN', 'PARTIAL'] } } }),
      this.prisma.appointment.findMany({
        where: { status: 'NO_SHOW', startsAt: { gte: new Date(now.getTime() - 7 * 86400_000) } },
        include: { patient: { select: { id: true, name: true, code: true } } },
        take: 20,
      }),
      this.prisma.message.findMany({
        where: { response: { not: null } },
        include: { patient: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.labWork.findMany({
        where: { status: { in: ['SENT', 'REDO'] } },
        include: { patient: { select: { id: true, name: true, code: true } } },
        orderBy: { dueAt: 'asc' },
        take: 20,
      }),
      this.prisma.inventoryItem.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    ]);

    const byStatus = (s: string[]) => todaysAppointments.filter((a) => s.includes(a.status));
    const overdueFollowUps = followUpsDue.filter((f) => f.dueDate < now);
    const lowStockItems = lowStock.filter((i) => i.stockQty <= i.reorderLevel);
    const labOverdue = labWorksOpen.filter((l) => l.dueAt && l.dueAt < now);

    return {
      appointments: {
        total: todaysAppointments.length,
        upcoming: byStatus(['SCHEDULED', 'CONFIRMED']).filter((a) => a.startsAt > now),
        waiting: byStatus(['WAITING']),
        completed: byStatus(['COMPLETED']),
        missed: byStatus(['NO_SHOW', 'CANCELLED']),
        all: todaysAppointments,
      },
      followUpsDue,
      pendingTreatments: {
        count: pendingTreatments.length,
        items: pendingTreatments,
        headline: `${new Set(pendingTreatments.map((t) => t.patientId)).size} patients require a next procedure`,
      },
      revenue: {
        today: revenueToday._sum.amount ?? 0,
        week: revenueWeek._sum.amount ?? 0,
        month: revenueMonth._sum.amount ?? 0,
        outstanding: Math.max(0, (billedAgg._sum.total ?? 0) - (paidAgg._sum.amount ?? 0)),
      },
      alerts: {
        overdueFollowUps: overdueFollowUps.length,
        unpaidInvoices,
        missedAppointments: missedRecent.length,
        pendingTreatments: pendingTreatments.length,
        missedList: missedRecent,
        lowStock: lowStockItems.length,
        labOverdue: labOverdue.length,
      },
      labWorks: { open: labWorksOpen, overdue: labOverdue.length },
      lowStock: lowStockItems,
      recentReplies: recentMessages,
    };
  }
}
