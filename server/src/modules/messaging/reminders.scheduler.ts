import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma.service';
import { tenancy } from '../../core/tenancy';
import { RiskService } from '../appointments/risk.service';
import { MessagingService } from './messaging.service';

/**
 * Automated communication engine. Runs every 15 minutes (and on demand from
 * the Settings page). All offsets/templates are configurable via Settings.
 */
@Injectable()
export class RemindersScheduler {
  private log = new Logger('Reminders');

  constructor(
    private prisma: PrismaService,
    private messaging: MessagingService,
    private risk: RiskService,
  ) {}

  @Cron('*/15 * * * *')
  async tick() {
    // Cron has no request (and so no tenant context): fan out over every
    // active clinic and run the existing per-clinic engine inside its scope.
    // Suspended clinics get no automated messages — same spirit as the
    // archived-patient rule one level down.
    try {
      const clinics = await this.prisma.clinic.findMany({
        where: { active: true },
        select: { id: true, name: true },
      });
      let sent = 0;
      for (const clinic of clinics) {
        try {
          const results = await tenancy.runAs(clinic.id, () => this.run());
          sent += results.sent;
        } catch (e) {
          this.log.error(`Scheduler failed for clinic ${clinic.id} (${clinic.name}): ${e}`);
        }
      }
      if (sent > 0) this.log.log(`Sent ${sent} automated messages`);
    } catch (e) {
      this.log.error(`Scheduler run failed: ${e}`);
    }
  }

  async run() {
    let sent = 0;
    sent += await this.appointmentReminders();
    sent += await this.dayBeforeQuestionnaires();
    sent += await this.followUpReminders();
    sent += await this.recallCampaign();
    sent += await this.birthdayGreetings();
    sent += await this.highRiskConfirmations();
    return { sent };
  }

  private async clinicVars() {
    return {
      clinic: await this.messaging.getSetting('clinic.name', 'the clinic'),
      doctor: await this.messaging.getSetting('clinic.doctor', 'the doctor'),
    };
  }

  private fmtWhen(d: Date) {
    return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }

  private parseOffsets(raw: string): { label: string; ms: number }[] {
    // "7d,3d,1d,2h" -> offsets before the appointment at which to remind
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const m = s.match(/^(\d+)([dh])$/i);
        if (!m) return null;
        const n = Number(m[1]);
        return { label: s, ms: m[2].toLowerCase() === 'd' ? n * 86400_000 : n * 3600_000 };
      })
      .filter((x): x is { label: string; ms: number } => !!x);
  }

  private async appointmentReminders() {
    const now = Date.now();
    const offsets = this.parseOffsets(
      await this.messaging.getSetting('reminders.offsets', '3d,1d,2h'),
    );
    if (!offsets.length) return 0;
    const horizon = Math.max(...offsets.map((o) => o.ms));
    const appointments = await this.prisma.appointment.findMany({
      where: {
        startsAt: { gte: new Date(now), lte: new Date(now + horizon) },
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        patient: { active: true },
      },
      include: { patient: true, doctor: true },
    });
    const { clinic, doctor } = await this.clinicVars();
    let sent = 0;
    for (const appt of appointments) {
      for (const offset of offsets) {
        const remindAt = appt.startsAt.getTime() - offset.ms;
        if (remindAt > now) continue; // not yet time for this offset
        const kind = `REMINDER_${offset.label.toUpperCase()}`;
        if (await this.messaging.alreadySent(kind, 'APPOINTMENT', appt.id)) continue;
        const when = this.fmtWhen(appt.startsAt);
        const docName = appt.doctor?.name ?? doctor;
        await this.messaging.send({
          patientId: appt.patientId,
          channel: appt.patient.whatsapp ? 'WHATSAPP' : 'SMS',
          kind,
          to: appt.patient.whatsapp || appt.patient.phone,
          refType: 'APPOINTMENT',
          refId: appt.id,
          template: { key: 'reminder', params: [appt.patient.name, docName, clinic, when] },
          body:
            `Hello ${appt.patient.name},\n\nThis is a reminder for your appointment with ` +
            `${docName} on ${when}.\n\nReply:\n1 = Confirm\n2 = Reschedule\n3 = Cancel`,
        });
        sent++;
      }
    }
    return sent;
  }

  private async dayBeforeQuestionnaires() {
    const now = Date.now();
    const appointments = await this.prisma.appointment.findMany({
      where: {
        startsAt: { gte: new Date(now), lte: new Date(now + 86400_000) },
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        patient: { active: true },
      },
      include: { patient: true },
    });
    const { clinic, doctor } = await this.clinicVars();
    let sent = 0;
    for (const appt of appointments) {
      if (await this.messaging.alreadySent('QUESTIONNAIRE', 'APPOINTMENT', appt.id)) continue;
      await this.messaging.send({
        patientId: appt.patientId,
        channel: appt.patient.whatsapp ? 'WHATSAPP' : 'SMS',
        kind: 'QUESTIONNAIRE',
        to: appt.patient.whatsapp || appt.patient.phone,
        refType: 'APPOINTMENT',
        refId: appt.id,
        template: { key: 'reminder', params: [appt.patient.name, doctor, clinic, this.fmtWhen(appt.startsAt)] },
        body: `Hello ${appt.patient.name},\n\nWill you attend tomorrow's appointment?\n\nReply:\nYES\nNO\nRESCHEDULE`,
      });
      sent++;
    }
    return sent;
  }

  private async followUpReminders() {
    const soon = new Date(Date.now() + 3 * 86400_000);
    const followUps = await this.prisma.followUp.findMany({
      where: { status: 'PENDING', dueDate: { lte: soon }, patient: { active: true } },
      include: { patient: true, procedure: true },
    });
    const { doctor } = await this.clinicVars();
    let sent = 0;
    for (const fu of followUps) {
      // At most one nudge per follow-up per week.
      if (await this.messaging.alreadySent('FOLLOW_UP', 'FOLLOWUP', fu.id, 7)) continue;
      const treatment = fu.procedure?.name ?? 'your follow-up treatment';
      await this.messaging.send({
        patientId: fu.patientId,
        channel: fu.patient.whatsapp ? 'WHATSAPP' : 'SMS',
        kind: 'FOLLOW_UP',
        to: fu.patient.whatsapp || fu.patient.phone,
        refType: 'FOLLOWUP',
        refId: fu.id,
        template: { key: 'followup', params: [fu.patient.name, treatment, doctor] },
        body:
          `Hello ${fu.patient.name},\n\n${treatment} recommended by ${doctor} is due. ` +
          `Please book an appointment. Reply YES to schedule.`,
      });
      sent++;
    }
    return sent;
  }

  /**
   * Re-care recall: patients whose last completed visit is older than
   * `recall.months` (and who have nothing booked and no pending follow-up —
   * those already get nudges) are invited back for a check-up. At most one
   * recall message per patient per 60 days. Set recall.months to 0 to disable.
   */
  private async recallCampaign() {
    const months = Number(await this.messaging.getSetting('recall.months', '6'));
    if (!months || months <= 0 || Number.isNaN(months)) return 0;
    const now = new Date();
    const cutoff = new Date(Date.now() - months * 30 * 86400_000);
    const patients = await this.prisma.patient.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        phone: true,
        whatsapp: true,
        appointments: { select: { startsAt: true, status: true } },
        followUps: { where: { status: 'PENDING' }, select: { id: true }, take: 1 },
      },
    });
    const { clinic, doctor } = await this.clinicVars();
    let sent = 0;
    for (const p of patients) {
      if (p.followUps.length) continue;
      const completed = p.appointments.filter((a) => a.status === 'COMPLETED' && a.startsAt < now);
      if (!completed.length) continue;
      const lastVisit = completed.reduce((m, a) => (a.startsAt > m ? a.startsAt : m), completed[0].startsAt);
      if (lastVisit >= cutoff) continue;
      const hasUpcoming = p.appointments.some(
        (a) => a.startsAt > now && !['CANCELLED', 'NO_SHOW'].includes(a.status),
      );
      if (hasUpcoming) continue;
      if (await this.messaging.alreadySent('RECALL', 'PATIENT', p.id, 60)) continue;
      await this.messaging.send({
        patientId: p.id,
        channel: p.whatsapp ? 'WHATSAPP' : 'SMS',
        kind: 'RECALL',
        to: p.whatsapp || p.phone,
        refType: 'PATIENT',
        refId: p.id,
        template: { key: 'recall', params: [p.name, String(months), clinic] },
        body:
          `Hello ${p.name},\n\nIt has been over ${months} months since your last visit to ${clinic}. ` +
          `${doctor} recommends a routine check-up and cleaning. Reply YES to book an appointment.`,
      });
      sent++;
    }
    return sent;
  }

  /**
   * Appointments the risk engine flags HIGH within 24h get one extra, more
   * personal confirmation request beyond the standard reminders. One per
   * appointment, ever (kind RISK_CONFIRM is deduped like everything else).
   */
  private async highRiskConfirmations() {
    const risky = (await this.risk.upcoming(24)).filter((r) => r.level === 'HIGH');
    if (!risky.length) return 0;
    const { clinic, doctor } = await this.clinicVars();
    let sent = 0;
    for (const r of risky) {
      if (await this.messaging.alreadySent('RISK_CONFIRM', 'APPOINTMENT', r.appointmentId)) continue;
      const when = r.startsAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
      await this.messaging.send({
        patientId: r.patient.id,
        channel: r.patient.whatsapp ? 'WHATSAPP' : 'SMS',
        kind: 'RISK_CONFIRM',
        to: r.patient.whatsapp || r.patient.phone,
        refType: 'APPOINTMENT',
        refId: r.appointmentId,
        template: { key: 'reminder', params: [r.patient.name, doctor, clinic, when] },
        body:
          `Hello ${r.patient.name},\n\n${doctor} has reserved ${when} especially for you. ` +
          `Can we count on you? A quick reply helps us plan the day.\n\nReply:\n1 = Yes, I'll be there\n2 = Reschedule\n3 = Cancel`,
      });
      sent++;
    }
    return sent;
  }

  /** Birthday wishes, once per patient per year. Turn off with greetings.birthday = off. */
  private async birthdayGreetings() {
    const enabled = (await this.messaging.getSetting('greetings.birthday', 'on')).toLowerCase();
    if (enabled === 'off') return 0;
    const today = new Date();
    const patients = await this.prisma.patient.findMany({
      where: { dob: { not: null }, active: true },
      select: { id: true, name: true, dob: true, phone: true, whatsapp: true },
    });
    const { clinic } = await this.clinicVars();
    let sent = 0;
    for (const p of patients) {
      const dob = p.dob;
      if (!dob || dob.getDate() !== today.getDate() || dob.getMonth() !== today.getMonth()) continue;
      // 300-day window = at most once per birthday-year without risking a skip.
      if (await this.messaging.alreadySent('BIRTHDAY', 'PATIENT', p.id, 300)) continue;
      await this.messaging.send({
        patientId: p.id,
        channel: p.whatsapp ? 'WHATSAPP' : 'SMS',
        kind: 'BIRTHDAY',
        to: p.whatsapp || p.phone,
        refType: 'PATIENT',
        refId: p.id,
        body: `Happy birthday, ${p.name}! 🎂\n\nWishing you a wonderful year ahead — keep smiling!\n— ${clinic}`,
      });
      sent++;
    }
    return sent;
  }
}
