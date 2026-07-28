import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';

export interface RiskFactor {
  label: string;
  points: number;
}

export interface AppointmentRisk {
  appointmentId: number;
  startsAt: Date;
  status: string;
  type: string;
  patient: { id: number; name: string; code: string; phone: string; whatsapp: string | null };
  score: number; // 0..100
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  factors: RiskFactor[];
}

/**
 * No-show risk scoring. No-shows are the single most common operational pain
 * in small clinics; this ranks upcoming appointments by the probability the
 * chair sits empty, using signals the system already records:
 *
 *   - the patient's own no-show history (strongest predictor)
 *   - the appointment was never confirmed
 *   - reminders/questionnaires sent for it went unanswered
 *   - first-ever visit (no relationship with the clinic yet)
 *   - long booking lead time (booked weeks ago, easily forgotten)
 *
 * Plain, explainable heuristics — every score comes with its reasons, so the
 * front desk knows *why* someone needs a confirmation call. The thresholds can
 * later be tuned (or replaced by a learned model reading the same features).
 */
@Injectable()
export class RiskService {
  constructor(private prisma: PrismaService) {}

  async upcoming(hours = 48): Promise<AppointmentRisk[]> {
    const now = new Date();
    const horizon = new Date(now.getTime() + hours * 3600_000);
    const appointments = await this.prisma.appointment.findMany({
      where: {
        startsAt: { gte: now, lte: horizon },
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        patient: { active: true },
      },
      include: {
        patient: { select: { id: true, name: true, code: true, phone: true, whatsapp: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
    if (!appointments.length) return [];

    const patientIds = [...new Set(appointments.map((a) => a.patientId))];
    const apptIds = appointments.map((a) => a.id);
    const [history, messages] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { patientId: { in: patientIds }, startsAt: { lt: now } },
        select: { patientId: true, status: true },
      }),
      this.prisma.message.findMany({
        where: { refType: 'APPOINTMENT', refId: { in: apptIds }, status: 'SENT' },
        select: { refId: true, response: true, sentAt: true },
      }),
    ]);

    return appointments
      .map((appt) => {
        const past = history.filter((h) => h.patientId === appt.patientId);
        const noShows = past.filter((h) => h.status === 'NO_SHOW').length;
        const completed = past.filter((h) => h.status === 'COMPLETED').length;
        const apptMessages = messages.filter((m) => m.refId === appt.id);
        const unanswered = apptMessages.filter(
          (m) => !m.response && m.sentAt && now.getTime() - m.sentAt.getTime() > 4 * 3600_000,
        ).length;
        const leadDays = (appt.startsAt.getTime() - appt.createdAt.getTime()) / 86400_000;

        const factors: RiskFactor[] = [];
        if (noShows >= 2) factors.push({ label: `${noShows} previous no-shows`, points: 35 });
        else if (noShows === 1) factors.push({ label: '1 previous no-show', points: 20 });
        if (appt.status === 'SCHEDULED') factors.push({ label: 'Not confirmed yet', points: 20 });
        if (unanswered > 0) {
          factors.push({ label: `${unanswered} unanswered reminder${unanswered > 1 ? 's' : ''}`, points: 15 });
        }
        if (completed === 0 && past.length === 0) factors.push({ label: 'First visit', points: 15 });
        if (leadDays > 14) factors.push({ label: `Booked ${Math.round(leadDays)} days ahead`, points: 10 });

        const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0));
        const level: AppointmentRisk['level'] = score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW';
        return {
          appointmentId: appt.id,
          startsAt: appt.startsAt,
          status: appt.status,
          type: appt.type,
          patient: appt.patient,
          score,
          level,
          factors,
        };
      })
      .sort((a, b) => b.score - a.score);
  }
}
