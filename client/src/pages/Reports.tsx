import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, BarChart3, CalendarX, ClipboardList, IndianRupee, PhoneCall, UserX, Users, Wallet } from 'lucide-react';
import { api, fmtDate, fmtMoney } from '../api';
import { Card, Empty, PageHeader, Spinner, Stat, inputCls } from '../components/ui';

interface Revenue {
  total: number;
  count: number;
  byDay: { date: string; amount: number }[];
  byMethod: { method: string; amount: number }[];
}
interface TreatmentRow {
  name: string;
  count: number;
  revenue: number;
  completed: number;
}
interface PatientsReport {
  newPatients: number;
  returningPatients: number;
  totalPatients: number;
}
interface ApptReport {
  total: number;
  byStatus: Record<string, number>;
  cancellationRate: number;
  noShowRate: number;
  completionRate: number;
}
interface Pnl {
  revenue: number;
  expenses: number;
  net: number;
  byCategory: { category: string; amount: number }[];
}
interface ReferralRow {
  source: string;
  count: number;
}
interface LeakPatient {
  id: number;
  name: string;
  code: string;
  phone: string;
}
interface Leakage {
  unbilledTreatments: { items: { id: number; patient: LeakPatient; procedure: string; cost: number; performedAt?: string }[]; total: number };
  staleInvoices: { items: { id: number; number: string; patient: LeakPatient; pending: number; createdAt: string }[]; total: number };
  driftingPlanned: { items: { id: number; patient: LeakPatient; procedure: string; cost: number; createdAt: string }[]; total: number };
  overdueFollowUps: { items: { id: number; patient: LeakPatient; procedure?: string | null; estValue: number; dueDate: string }[]; total: number };
}
interface RecallRow {
  id: number;
  code: string;
  name: string;
  phone: string;
  lastVisit: string | null;
  hasPendingTreatment: boolean;
}

export default function Reports() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const qs = `?from=${from}&to=${to}T23:59:59`;

  const { data: revenue, isLoading } = useQuery<Revenue>({ queryKey: ['r-rev', qs], queryFn: () => api(`/reports/revenue${qs}`) });
  const { data: treatments } = useQuery<TreatmentRow[]>({ queryKey: ['r-tx', qs], queryFn: () => api(`/reports/treatments${qs}`) });
  const { data: patients } = useQuery<PatientsReport>({ queryKey: ['r-pat', qs], queryFn: () => api(`/reports/patients${qs}`) });
  const { data: appts } = useQuery<ApptReport>({ queryKey: ['r-appt', qs], queryFn: () => api(`/reports/appointments${qs}`) });
  const { data: recall } = useQuery<RecallRow[]>({ queryKey: ['r-recall'], queryFn: () => api('/reports/recall') });
  const { data: pnl } = useQuery<Pnl>({ queryKey: ['r-pnl', qs], queryFn: () => api(`/reports/pnl${qs}`) });
  const { data: referrals } = useQuery<ReferralRow[]>({ queryKey: ['r-ref'], queryFn: () => api('/reports/referrals') });
  const { data: leakage } = useQuery<Leakage>({ queryKey: ['r-leak'], queryFn: () => api('/reports/leakage') });
  const leakageTotal = leakage
    ? leakage.unbilledTreatments.total + leakage.staleInvoices.total + leakage.driftingPlanned.total + leakage.overdueFollowUps.total
    : 0;

  const maxDay = Math.max(1, ...(revenue?.byDay.map((d) => d.amount) ?? [1]));

  return (
    <div className="space-y-4">
      <PageHeader
        icon={BarChart3}
        title="Reports"
        subtitle="How the clinic is doing. Pick two dates below to change the period everything is measured over."
      />

      <div className="flex items-center gap-2 text-sm bg-white rounded-2xl border border-slate-200/80 shadow-sm px-4 py-3 w-fit -mt-2">
        <span className="font-semibold text-slate-700">Showing</span>
        <input type="date" className={`${inputCls} w-auto`} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-slate-500 font-medium">to</span>
        <input type="date" className={`${inputCls} w-auto`} value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {isLoading && <Spinner label="Crunching the numbers…" />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Money collected" value={fmtMoney(revenue?.total)} sub={`from ${revenue?.count ?? 0} payments`} icon={IndianRupee} tone="success" />
        <Stat label="New patients" value={patients?.newPatients ?? 0} sub={`${patients?.returningPatients ?? 0} came back · ${patients?.totalPatients ?? 0} in total`} icon={Users} tone="info" />
        <Stat label="Cancelled" value={`${appts?.cancellationRate ?? 0}%`} sub={`of ${appts?.total ?? 0} appointments`} icon={CalendarX} tone={(appts?.cancellationRate ?? 0) > 15 ? 'warn' : 'default'} />
        <Stat label="Didn't turn up" value={`${appts?.noShowRate ?? 0}%`} sub={`${appts?.completionRate ?? 0}% were completed`} icon={UserX} tone={(appts?.noShowRate ?? 0) > 10 ? 'danger' : 'default'} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card icon={IndianRupee} title="Money collected each day" hint="Payments actually received, day by day.">
          {!revenue?.byDay.length && <Empty text="No payments in these dates" hint="Nobody paid a bill between the two dates above. Try a wider range." />}
          <div className="space-y-1.5">
            {revenue?.byDay.map((d) => (
              <div key={d.date} className="flex items-center gap-3 text-sm">
                <span className="text-xs text-slate-400 w-20">{fmtDate(d.date)}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                  <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${(d.amount / maxDay) * 100}%` }} />
                </div>
                <span className="w-20 text-right text-slate-600">{fmtMoney(d.amount)}</span>
              </div>
            ))}
          </div>
          {revenue && revenue.byMethod.length > 0 && (
            <div className="flex gap-4 mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500">
              {revenue.byMethod.map((m) => (
                <span key={m.method}>{m.method.toLowerCase()}: <b>{fmtMoney(m.amount)}</b></span>
              ))}
            </div>
          )}
        </Card>

        <Card icon={ClipboardList} title="Your most common treatments" hint="What you do most, and what it brings in.">
          {!treatments?.length && <Empty text="No treatments in these dates" hint="No treatment was completed in this period." />}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-1">Procedure</th><th className="text-right">Count</th><th className="text-right">Completed</th><th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {treatments?.map((t) => (
                <tr key={t.name} className="border-t border-slate-50">
                  <td className="py-2 text-slate-700">{t.name}</td>
                  <td className="text-right text-slate-600">{t.count}</td>
                  <td className="text-right text-slate-600">{t.completed}</td>
                  <td className="text-right text-slate-600">{fmtMoney(t.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card icon={Wallet} title="Profit and loss" hint="What came in, what went out, and what you kept.">
          <div className="grid grid-cols-3 gap-3 mb-4 text-center">
            <div>
              <div className="text-xs uppercase font-bold text-slate-400">Collections</div>
              <div className="text-lg font-bold text-emerald-600">{fmtMoney(pnl?.revenue)}</div>
            </div>
            <div>
              <div className="text-xs uppercase font-bold text-slate-400">Expenses</div>
              <div className="text-lg font-bold text-rose-600">{fmtMoney(pnl?.expenses)}</div>
            </div>
            <div>
              <div className="text-xs uppercase font-bold text-slate-400">Net</div>
              <div className={`text-lg font-bold ${(pnl?.net ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtMoney(pnl?.net)}</div>
            </div>
          </div>
          {!pnl?.byCategory.length && <Empty text="No expenses in these dates" hint="Nothing was spent in this period, or nothing has been recorded yet." />}
          <div className="space-y-1.5">
            {pnl?.byCategory.map((c) => (
              <div key={c.category} className="flex items-center gap-3 text-sm">
                <span className="text-slate-600 w-28">{c.category.replace('_', ' ').toLowerCase()}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-rose-400 h-full rounded-full"
                    style={{ width: `${(c.amount / Math.max(1, pnl.expenses)) * 100}%` }}
                  />
                </div>
                <span className="w-20 text-right text-slate-600">{fmtMoney(c.amount)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card icon={Users} title="How patients found you" hint="Taken from &quot;How did they hear about us?&quot; when registering.">
          {!referrals?.length && <Empty text="No referral information yet" hint="Fill in &quot;How did they hear about us?&quot; when registering patients and this will show which sources bring you the most business." />}
          <div className="space-y-1.5">
            {referrals?.map((r) => {
              const max = Math.max(1, ...(referrals?.map((x) => x.count) ?? [1]));
              return (
                <div key={r.source} className="flex items-center gap-3 text-sm">
                  <span className="text-slate-600 w-32 truncate">{r.source.replace(/_/g, ' ').toLowerCase()}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                    <div className="bg-indigo-400 h-full rounded-full" style={{ width: `${(r.count / max) * 100}%` }} />
                  </div>
                  <span className="w-10 text-right text-slate-600">{r.count}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card tone="warn" icon={AlertTriangle} title={`Money you are missing out on — ${fmtMoney(leakageTotal)}`} hint="Treatment you did but never billed, bills nobody chased, and agreed treatment nobody booked.">
        {leakage && leakageTotal === 0 && <Empty celebrate text="Nothing is slipping through!" hint="Every treatment is billed, every bill collected, and everyone has a next appointment." />}
        {leakage && leakageTotal > 0 && (
          <div className="grid lg:grid-cols-2 gap-x-8 gap-y-5">
            {leakage.unbilledTreatments.items.length > 0 && (
              <div>
                <div className="text-xs font-bold uppercase text-rose-600 mb-1.5">
                  Completed but never invoiced · {fmtMoney(leakage.unbilledTreatments.total)}
                </div>
                {leakage.unbilledTreatments.items.slice(0, 6).map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-sm py-1 border-b border-slate-50 last:border-0">
                    <Link to={`/patients/${t.patient.id}`} className="flex-1 text-slate-700 hover:text-indigo-600">{t.patient.name}</Link>
                    <span className="text-xs text-slate-500">{t.procedure}</span>
                    <span className="text-slate-600 font-medium">{fmtMoney(t.cost)}</span>
                  </div>
                ))}
              </div>
            )}
            {leakage.staleInvoices.items.length > 0 && (
              <div>
                <div className="text-xs font-bold uppercase text-rose-600 mb-1.5">
                  Unpaid invoices &gt; 14 days · {fmtMoney(leakage.staleInvoices.total)}
                </div>
                {leakage.staleInvoices.items.slice(0, 6).map((i) => (
                  <div key={i.id} className="flex items-center gap-2 text-sm py-1 border-b border-slate-50 last:border-0">
                    <Link to={`/patients/${i.patient.id}`} className="flex-1 text-slate-700 hover:text-indigo-600">{i.patient.name}</Link>
                    <span className="text-xs text-slate-500">{i.number} · {fmtDate(i.createdAt)}</span>
                    <span className="text-slate-600 font-medium">{fmtMoney(i.pending)}</span>
                  </div>
                ))}
              </div>
            )}
            {leakage.driftingPlanned.items.length > 0 && (
              <div>
                <div className="text-xs font-bold uppercase text-amber-600 mb-1.5">
                  Agreed treatments, nothing booked · {fmtMoney(leakage.driftingPlanned.total)}
                </div>
                {leakage.driftingPlanned.items.slice(0, 6).map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-sm py-1 border-b border-slate-50 last:border-0">
                    <Link to={`/patients/${t.patient.id}`} className="flex-1 text-slate-700 hover:text-indigo-600">{t.patient.name}</Link>
                    <span className="text-xs text-slate-500">{t.procedure}</span>
                    <span className="text-slate-600 font-medium">{fmtMoney(t.cost)}</span>
                  </div>
                ))}
              </div>
            )}
            {leakage.overdueFollowUps.items.length > 0 && (
              <div>
                <div className="text-xs font-bold uppercase text-amber-600 mb-1.5">
                  Follow-ups overdue &gt; 7 days · est. {fmtMoney(leakage.overdueFollowUps.total)}
                </div>
                {leakage.overdueFollowUps.items.slice(0, 6).map((f) => (
                  <div key={f.id} className="flex items-center gap-2 text-sm py-1 border-b border-slate-50 last:border-0">
                    <Link to={`/patients/${f.patient.id}`} className="flex-1 text-slate-700 hover:text-indigo-600">{f.patient.name}</Link>
                    <span className="text-xs text-slate-500">{f.procedure ?? 'Review'} · due {fmtDate(f.dueDate)}</span>
                    <a href={`tel:${f.patient.phone}`} className="text-xs text-indigo-600 hover:underline">{f.patient.phone}</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card icon={PhoneCall} title={`Patients worth calling back (${recall?.length ?? 0})`} hint="Nobody has seen them in over 6 months, or they have treatment still outstanding.">
        {!recall?.length && <Empty celebrate text="Everyone is up to date" hint="No patient is overdue for a check-up right now." />}
        {recall && recall.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-1">Patient</th><th>Phone</th><th>Last visit</th><th>Pending treatment</th>
              </tr>
            </thead>
            <tbody>
              {recall.map((r) => (
                <tr key={r.id} className="border-t border-slate-50">
                  <td className="py-2">
                    <Link to={`/patients/${r.id}`} className="font-medium text-slate-700 hover:text-indigo-600">{r.name}</Link>
                    <span className="text-xs text-slate-400 ml-2">{r.code}</span>
                  </td>
                  <td className="text-slate-500">{r.phone}</td>
                  <td className="text-slate-500">{r.lastVisit ? fmtDate(r.lastVisit) : 'never'}</td>
                  <td>{r.hasPendingTreatment ? <span className="text-amber-600 font-medium">yes</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
