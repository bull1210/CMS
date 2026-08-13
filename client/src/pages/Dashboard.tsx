import { useState, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  FlaskConical,
  Package,
  PhoneCall,
  Stethoscope,
  Sun,
} from 'lucide-react';
import { api, fmtDate, fmtTime } from '../api';
import { isBefore, startOfDay } from 'date-fns';
import { Badge, Card, Empty, Spinner, Stat } from '../components/ui';
import { statusLabel } from '../theme';

interface DashboardData {
  appointments: {
    total: number;
    upcoming: Appt[];
    waiting: Appt[];
    completed: Appt[];
    missed: Appt[];
    all: Appt[];
  };
  followUpsDue: FollowUp[];
  pendingTreatments: { count: number; headline: string; items: PendingTreatment[] };
  revenue: { today: number; week: number; month: number; outstanding: number };
  alerts: {
    overdueFollowUps: number;
    unpaidInvoices: number;
    missedAppointments: number;
    pendingTreatments: number;
    lowStock: number;
    labOverdue: number;
  };
  labWorks: { open: LabWorkRow[]; overdue: number };
  lowStock: { id: number; name: string; stockQty: number; unit: string }[];
  recentReplies: Reply[];
}
interface LabWorkRow {
  id: number;
  labName: string;
  workType: string;
  status: string;
  dueAt?: string;
  patient: { id: number; name: string };
}
interface Appt {
  id: number;
  startsAt: string;
  status: string;
  type: string;
  patient: { id: number; name: string; code: string };
}
interface FollowUp {
  id: number;
  dueDate: string;
  status: string;
  note?: string;
  patient: { id: number; name: string };
  procedure?: { name: string };
}
interface PendingTreatment {
  id: number;
  status: string;
  patient: { id: number; name: string };
  procedure: { name: string };
}
interface Reply {
  id: number;
  body: string;
  response: string;
  patient?: { id: number; name: string };
}
interface RiskRow {
  appointmentId: number;
  startsAt: string;
  status: string;
  score: number;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  factors: { label: string; points: number }[];
  patient: { id: number; name: string; phone: string };
}

const APPT_ACTIONS: Record<string, string[]> = {
  SCHEDULED: ['CONFIRMED', 'WAITING', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['WAITING', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  WAITING: ['COMPLETED', 'CANCELLED'],
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [resText, setResText] = useState('');
  const setFollowUpStatus = useMutation({
    mutationFn: async ({ id, status, resolution }: { id: number; status: string; resolution?: string }) => {
      await api(`/followups/${id}/status`, { method: 'PUT', body: { status, resolution } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  });
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => api('/dashboard'),
    refetchInterval: 60_000,
  });
  const { data: risk } = useQuery<RiskRow[]>({
    queryKey: ['appt-risk'],
    queryFn: () => api('/appointments/risk?hours=48'),
    refetchInterval: 60_000,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api(`/appointments/${id}/status`, { method: 'PUT', body: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  });

  if (isLoading || !data) return <Spinner label="Getting today ready…" />;

  const nowInClinic = data.appointments.all.filter((a) => a.status === 'WAITING').length;
  
  const urgentOrOverdueCount = data.followUpsDue.filter((f) => {
    const diffHours = (new Date(f.dueDate).getTime() - new Date().getTime()) / 3600000;
    return diffHours <= 48;
  }).length;

  return (
    <div className="space-y-4">
      {/* Greeting hero */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 px-5 py-4 shadow-lg animate-rise no-print">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 backdrop-blur rounded-xl p-2.5 text-white shadow-inner">
              <Sun size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">
                {greeting()} — here's your day
              </h1>
              <p className="text-sm text-white/85">
                {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="flex gap-8 text-white">
            <div className="text-center">
              <div className="text-2xl font-extrabold leading-none">{data.appointments.total}</div>
              <div className="text-xs text-white/80 font-medium mt-0.5">patients today</div>
            </div>
            {nowInClinic > 0 && (
              <div className="text-center">
                <div className="text-2xl font-extrabold leading-none">{nowInClinic}</div>
                <div className="text-xs text-white/80 font-medium mt-0.5">in clinic now</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Appointments today"
          value={data.appointments.total}
          sub={nowInClinic > 0 ? `${nowInClinic} in clinic now` : 'Booked for today'}
          icon={CalendarDays}
          tone="default"
        />
        <Stat
          label="Follow-up calls due"
          value={data.followUpsDue.length}
          sub={urgentOrOverdueCount > 0 ? `${urgentOrOverdueCount} need attention` : 'Patients to check on'}
          icon={PhoneCall}
          tone={urgentOrOverdueCount > 0 ? 'warn' : 'default'}
        />
        <Stat
          label="Treatments in progress"
          value={data.pendingTreatments.count}
          sub="Started, not yet finished"
          icon={Stethoscope}
          tone="default"
        />
        <Stat
          label="Lab cases open"
          value={data.labWorks.open.length}
          sub={data.labWorks.overdue > 0 ? `${data.labWorks.overdue} overdue at the lab` : 'Out at the lab'}
          icon={FlaskConical}
          tone={data.labWorks.overdue > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card
          icon={CalendarDays}
          title={`Today's appointments (${data.appointments.total})`}
          hint="Everyone booked in today. Use “Change” to mark them as arrived or done."
          action={
            <Link to="/appointments" className="text-sm text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1">
              Calendar <ArrowRight size={14} />
            </Link>
          }
        >
          {data.appointments.all.length === 0 ? (
            <Empty
              icon={CalendarDays}
              text="No appointments booked today"
              hint="When you book someone in, they'll appear here with their arrival time."
              action={
                <Link to="/appointments">
                  <span className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white
                                   font-semibold rounded-xl px-4 py-2.5 text-sm shadow-sm transition">
                    <CalendarPlus size={16} /> Book an appointment
                  </span>
                </Link>
              }
            />
          ) : (
            <div className="space-y-0.5">
              {data.appointments.all.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-lg hover:bg-slate-50 transition border-b border-slate-50 last:border-0"
                >
                  <span className="text-sm font-bold text-slate-700 w-16 shrink-0">{fmtTime(a.startsAt)}</span>
                  <Link
                    to={`/patients/${a.patient.id}`}
                    className="flex-1 text-sm text-slate-800 hover:text-indigo-600 font-semibold truncate"
                  >
                    {a.patient.name}
                  </Link>
                  <span className="text-xs text-slate-500 hidden sm:inline">{a.type.replace(/_/g, ' ').toLowerCase()}</span>
                  <Badge value={a.status} />
                  {APPT_ACTIONS[a.status] && (
                    <select
                      className="text-xs border-2 border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 font-medium
                                 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-200 cursor-pointer"
                      value=""
                      title="Update this appointment"
                      onChange={(e) => e.target.value && setStatus.mutate({ id: a.id, status: e.target.value })}
                    >
                      <option value="">Change…</option>
                      {APPT_ACTIONS[a.status].map((s) => (
                        <option key={s} value={s}>{statusLabel(s)}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          icon={PhoneCall}
          title={`Follow-up calls due (${data.followUpsDue.length})`}
          hint="Patients you said you'd check back with after treatment."
        >
          {data.followUpsDue.length === 0 ? (
            <Empty
              celebrate
              text="All caught up!"
              hint="Nobody is waiting to hear back from you right now."
            />
          ) : (
            <div className="space-y-0.5">
              {(() => {
                const now = new Date().getTime();
                return [...data.followUpsDue]
                  .map((f) => {
                    const diffHours = (new Date(f.dueDate).getTime() - now) / 3600000;
                    let urgency = 'normal';
                    if (diffHours < 24) urgency = 'overdue';
                    else if (diffHours <= 48) urgency = 'urgent';
                    return { ...f, diffHours, urgency };
                  })
                  .sort((a, b) => a.diffHours - b.diffHours)
                  .map((f) => (
                  <div
                    key={f.id}
                    className="group flex flex-col py-1.5 px-2 -mx-2 rounded-lg hover:bg-slate-50 transition border-b border-slate-50 last:border-0"
                  >
                    <div className="flex items-center gap-3 w-full">
                      <span
                        className={`text-sm w-20 shrink-0 font-bold ${
                          f.urgency === 'overdue' ? 'text-rose-600' : f.urgency === 'urgent' ? 'text-orange-600' : 'text-slate-600'
                        }`}
                      >
                        {fmtDate(f.dueDate)}
                      </span>
                      <Link
                        to={`/patients/${f.patient.id}`}
                        className="flex-1 text-sm text-slate-800 hover:text-indigo-600 font-semibold truncate"
                      >
                        {f.patient.name}
                      </Link>
                      <span className="text-xs text-slate-500 truncate max-w-[40%]">
                        {f.procedure?.name ?? (f.note?.startsWith('RESCHEDULE:') ? f.note.split('. Original')[0] : f.note)}
                      </span>
                      
                      {f.urgency === 'overdue' && <Badge value="OVERDUE" />}
                      {f.urgency === 'urgent' && <span className="text-[10px] font-bold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded">URGENT</span>}

                      {f.note?.startsWith('RESCHEDULE:') && (
                        <button
                          onClick={() => {
                            const docMatch = f.note?.match(/Doctor ID: (\d+)/);
                            const rescheduleDocId = docMatch && docMatch[1] ? parseInt(docMatch[1], 10) : undefined;
                            navigate(`/patients/${f.patient.id}`, { state: { openReschedule: f.id, rescheduleDocId } });
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-slate-200 rounded text-indigo-600 hover:text-indigo-800 transition ml-auto text-[10px] font-bold uppercase tracking-wide"
                          title="Reschedule Appointment"
                        >
                          Reschedule
                        </button>
                      )}
                      
                      <button
                        onClick={() => {
                          setResolvingId(f.id);
                          setResText('');
                        }}
                        className={`opacity-0 group-hover:opacity-100 p-1.5 hover:bg-slate-200 rounded text-slate-400 hover:text-emerald-600 transition ${!f.note?.startsWith('RESCHEDULE:') ? 'ml-auto' : ''}`}
                        title={f.note?.startsWith('RESCHEDULE:') ? "Close without rescheduling" : "Mark as done"}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                    </div>
                    {resolvingId === f.id && (
                      <div className="mt-2 pl-[5.5rem] pr-2 flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                        <input
                          type="text"
                          placeholder="Resolution note (e.g. rescheduled to 14th Aug)..."
                          className="flex-1 text-sm border-b border-slate-300 focus:border-indigo-500 bg-transparent py-1 outline-none transition-colors"
                          autoFocus
                          value={resText}
                          onChange={(e) => setResText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              setFollowUpStatus.mutate({ id: f.id, status: 'DONE', resolution: resText });
                              setResolvingId(null);
                            } else if (e.key === 'Escape') {
                              setResolvingId(null);
                            }
                          }}
                        />
                        <button
                          onClick={() => {
                            setFollowUpStatus.mutate({ id: f.id, status: 'DONE', resolution: resText });
                            setResolvingId(null);
                          }}
                          className="text-xs font-semibold bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700 transition"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setResolvingId(null)}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ));
              })()}
            </div>
          )}
        </Card>

        <Card
          icon={Stethoscope}
          title="Treatments in progress"
          hint="Started but not finished — these are patients to bring back in."
        >
          {data.pendingTreatments.items.length === 0 ? (
            <Empty celebrate text="Nothing pending" hint="Every treatment you've started has been completed." />
          ) : (
            <>
              <p className="text-sm font-semibold text-indigo-700 mb-2 bg-indigo-50 rounded-lg px-3 py-1.5">
                {data.pendingTreatments.headline}
              </p>
              <div className="space-y-0.5">
                {data.pendingTreatments.items.slice(0, 8).map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-lg hover:bg-slate-50 transition border-b border-slate-50 last:border-0"
                  >
                    <Link
                      to={`/patients/${t.patient.id}`}
                      className="flex-1 text-sm text-slate-800 hover:text-indigo-600 font-semibold truncate"
                    >
                      {t.patient.name}
                    </Link>
                    <span className="text-xs text-slate-500 truncate max-w-[45%]">{t.procedure.name}</span>
                    <Badge value={t.status} />
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        {risk && risk.some((r) => r.level !== 'LOW') && (
          <Card
            tone="warn"
            icon={PhoneCall}
            title="Might not turn up — worth a call"
            hint="Based on their past attendance. A quick reminder call usually fixes it."
          >
            <div className="space-y-0.5">
              {risk.filter((r) => r.level !== 'LOW').slice(0, 8).map((r) => (
                <div key={r.appointmentId} className="py-1.5 px-2 -mx-2 rounded-lg hover:bg-slate-50 transition border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${
                        r.level === 'HIGH' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                      }`}
                      title={r.level === 'HIGH' ? 'High chance of missing' : 'Some chance of missing'}
                    >
                      {r.level === 'HIGH' ? 'Likely' : 'Maybe'}
                    </span>
                    <Link to={`/patients/${r.patient.id}`} className="flex-1 text-sm font-semibold text-slate-800 hover:text-indigo-600 truncate">
                      {r.patient.name}
                    </Link>
                    <span className="text-xs text-slate-500 hidden sm:inline">{fmtTime(r.startsAt)} · {fmtDate(r.startsAt)}</span>
                    <a
                      href={`tel:${r.patient.phone}`}
                      className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-2.5 py-1.5 flex items-center gap-1 transition"
                    >
                      <PhoneCall size={12} /> Call
                    </a>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 ml-[4.5rem]">{r.factors.map((f) => f.label).join(' · ')}</p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {(data.labWorks.open.length > 0 || data.lowStock.length > 0) && (
          <Card icon={FlaskConical} title="Lab work & stock" hint="Cases out at the lab, and supplies running low.">
            {data.labWorks.open.length > 0 && (
              <div className="mb-3">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
                  At the lab ({data.labWorks.open.length})
                </div>
                <div className="space-y-0.5">
                  {data.labWorks.open.slice(0, 6).map((l) => {
                    const overdue = l.dueAt && new Date(l.dueAt) < new Date();
                    return (
                      <div key={l.id} className="flex items-center gap-3 py-1.5 border-b border-slate-50 last:border-0">
                        <Link to={`/patients/${l.patient.id}`} className="flex-1 text-sm text-slate-800 hover:text-indigo-600 font-semibold truncate">
                          {l.patient.name}
                        </Link>
                        <span className="text-xs text-slate-500 truncate">
                          {l.workType.replace(/_/g, ' ').toLowerCase()} · {l.labName}
                        </span>
                        {l.dueAt && (
                          <span className={`text-xs shrink-0 font-semibold ${overdue ? 'text-rose-600' : 'text-slate-500'}`}>
                            {overdue ? 'late — ' : 'due '}{fmtDate(l.dueAt)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {data.lowStock.length > 0 && (
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Running low</div>
                <div className="space-y-0.5">
                  {data.lowStock.slice(0, 6).map((i) => (
                    <div key={i.id} className="flex items-center gap-3 py-1.5 text-sm">
                      <Link to="/inventory" className="flex-1 text-slate-800 hover:text-indigo-600 font-semibold truncate">
                        <Package size={13} className="inline mr-1.5 opacity-50" />
                        {i.name}
                      </Link>
                      <span className="text-xs font-bold text-rose-600 bg-rose-50 rounded-lg px-2 py-1">
                        only {i.stockQty} {i.unit} left
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}

      </div>
    </div>
  );
}
