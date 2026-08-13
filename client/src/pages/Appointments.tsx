import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Search, User, Filter } from 'lucide-react';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { api, fmtTime, getUser } from '../api';
import { Badge, Button, Empty, Field, inputCls, Modal, PageHeader, Spinner } from '../components/ui';
import { SlotWarnings, useSlotChecks } from './PatientDetail';
import { statusLabel } from '../theme';

const APPT_TYPES: { value: string; label: string; hint: string }[] = [
  { value: 'CONSULTATION', label: 'Consultation', hint: 'First look / check-up' },
  { value: 'FOLLOW_UP', label: 'Follow-up', hint: 'Checking on earlier treatment' },
  { value: 'PROCEDURE', label: 'Treatment', hint: 'Actual dental work' },
  { value: 'EMERGENCY', label: 'Emergency', hint: 'Urgent, in pain' },
];

interface Appt {
  id: number;
  startsAt: string;
  endsAt: string;
  type: string;
  status: string;
  notes?: string;
  patient: { id: number; name: string; code: string; phone: string };
  doctor?: { id: number; name: string };
  createdAt: string;
  createdBy?: { name: string };
}
interface PatientLite {
  id: number;
  name: string;
  code: string;
}

const STATUS_FLOW: Record<string, string[]> = {
  SCHEDULED: ['CONFIRMED', 'WAITING', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['WAITING', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  WAITING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: ['SCHEDULED'],
  NO_SHOW: ['SCHEDULED'],
};

function NewAppointmentModal({ date, initialTime, initialDoctorId, onClose }: { date: Date; initialTime?: string; initialDoctorId?: number | ''; onClose: () => void }) {
  const qc = useQueryClient();
  const user = getUser();
  const [search, setSearch] = useState('');
  const [patientId, setPatientId] = useState(0);
  const [doctorId, setDoctorId] = useState<number | ''>(initialDoctorId !== undefined ? initialDoctorId : (user?.role === 'DOCTOR' ? user.id : ''));
  const { data } = useQuery<{ items: PatientLite[] }>({
    queryKey: ['patients', search, 1],
    queryFn: () => api(`/patients?q=${encodeURIComponent(search)}&pageSize=8`),
    enabled: search.length >= 2,
  });
  const { data: settings } = useQuery<Record<string, string>>({ queryKey: ['settings'], queryFn: () => api('/settings') });
  const { data: users } = useQuery<{ id: number; name: string; role: string; active: boolean }[]>({ queryKey: ['users'], queryFn: () => api('/users') });
  const doctors = users?.filter(u => u.role === 'DOCTOR' && u.active) || [];
  const intervalStr = settings?.['appointments.interval'];
  const interval = intervalStr ? parseInt(intervalStr, 10) : 5;
  const safeInterval = isNaN(interval) || interval <= 0 ? 5 : interval;
  
  const [form, setForm] = useState({
    date: format(date, 'yyyy-MM-dd'),
    time: initialTime || '10:00',
    durationMin: 30,
    type: 'CONSULTATION',
    notes: '',
  });
  const [ignoreWH, setIgnoreWH] = useState(false);

  const wh = useMemo(() => {
    try { return settings?.['clinic.workingHours'] ? JSON.parse(settings['clinic.workingHours']) : null; }
    catch { return null; }
  }, [settings?.['clinic.workingHours']]);

  const closures = useMemo(() => {
    try { return settings?.['clinic.closures'] ? JSON.parse(settings['clinic.closures']) : {}; }
    catch { return {}; }
  }, [settings?.['clinic.closures']]);

  const doctorClosures = useMemo(() => {
    try { return settings?.['doctor.closures'] ? JSON.parse(settings['doctor.closures']) : {}; }
    catch { return {}; }
  }, [settings?.['doctor.closures']]);

  const timeOptions = useMemo(() => {
    const opts = [];
    const [y, m, d] = form.date.split('-').map(Number);
    const dayOfWeek = new Date(y, m - 1, d).getDay();
    const dayConf = wh?.[dayOfWeek];
    const isExplicitClosure = !!closures[form.date] || (doctorId ? !!doctorClosures[doctorId]?.[form.date] : false);

    for (let h = 0; h < 24; h++) {
      for (let min = 0; min < 60; min += safeInterval) {
        const timeStr = `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
        
        if (isExplicitClosure) continue; // STRICTLY block explicit closures

        if (!ignoreWH) {
          if (dayConf) {
            if (dayConf.closed) continue;
            const inMorn = timeStr >= dayConf.morning[0] && timeStr <= dayConf.morning[1];
            const inEve = timeStr >= dayConf.evening[0] && timeStr <= dayConf.evening[1];
            if (!inMorn && !inEve) continue;
          }
        }
        opts.push(timeStr);
      }
    }
    return opts;
  }, [safeInterval, form.date, wh, closures, ignoreWH]);
  const [error, setError] = useState('');
  const slot = useSlotChecks(`${form.date}T${form.time}:00`, form.durationMin, doctorId, patientId > 0 ? patientId : undefined);
  
  const { data: followUps } = useQuery<any[]>({ 
    queryKey: ['followups', patientId], 
    queryFn: () => api(`/followups?patientId=${patientId}&status=PENDING`),
    enabled: patientId > 0
  });
  const [mismatchPrompt, setMismatchPrompt] = useState<{task: any, oldDoc: string, newDoc: string} | null>(null);

  const save = useMutation({
    mutationFn: (vars?: { closeMismatchFollowUpId?: number }) =>
      api('/appointments', {
        body: {
          patientId,
          doctorId: Number(doctorId),
          startsAt: new Date(`${form.date}T${form.time}:00`).toISOString(),
          durationMin: form.durationMin,
          type: form.type,
          notes: form.notes || undefined,
          closeMismatchFollowUpId: vars?.closeMismatchFollowUpId,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  const selected = data?.items.find((p) => p.id === patientId);

  const handleBookClick = () => {
    if (patientId > 0 && followUps?.length) {
      const rescheduleTask = followUps.find(f => f.note?.includes('RESCHEDULE:'));
      if (rescheduleTask) {
        const match = rescheduleTask.note.match(/Doctor ID:\s*(\d+)/);
        const originalDocId = match && match[1] ? parseInt(match[1], 10) : null;
        
        if (originalDocId && originalDocId !== Number(doctorId)) {
          const oldDoc = doctors.find(d => d.id === originalDocId)?.name || `ID ${originalDocId}`;
          const newDoc = doctors.find(d => d.id === Number(doctorId))?.name || `ID ${doctorId}`;
          setMismatchPrompt({ task: rescheduleTask, oldDoc, newDoc });
          return;
        }
      }
    }
    save.mutate({});
  };

  if (mismatchPrompt) {
    return (
      <Modal title="Pending Reschedule Task Detected" onClose={() => setMismatchPrompt(null)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            This patient has a pending reschedule task with <strong>Dr. {mismatchPrompt.oldDoc}</strong>. 
            You are booking this new appointment with <strong>Dr. {mismatchPrompt.newDoc}</strong>.
          </p>
          <p className="text-sm text-slate-600">
            What would you like to do with the pending reschedule task?
          </p>
          {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-200">{error}</div>}
          <div className="flex gap-3 pt-2">
            <Button
              className="flex-1"
              variant="secondary"
              onClick={() => save.mutate({})}
              disabled={save.isPending}
            >
              Keep Task Pending
            </Button>
            <Button
              className="flex-1"
              onClick={() => save.mutate({ closeMismatchFollowUpId: mismatchPrompt.task.id })}
              disabled={save.isPending}
            >
              Close Task Automatically
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Book an appointment" hint="Step 1: find the patient. Step 2: pick the day and time." onClose={onClose}>
      <div className="space-y-4">
        <Field label="Which patient?" required hint={selected ? undefined : 'Start typing their name or phone number.'}>
          {selected ? (
            <div className="flex items-center justify-between gap-2 bg-violet-50 border-2 border-violet-200 rounded-xl px-3.5 py-2.5">
              <span className="flex items-center gap-2 text-sm font-semibold text-violet-900">
                <User size={16} /> {selected.name}
                <span className="text-xs font-normal text-violet-600">{selected.code}</span>
              </span>
              <button
                className="text-xs font-semibold text-violet-700 hover:text-violet-900 underline"
                onClick={() => setPatientId(0)}
              >
                Choose someone else
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={17} className="absolute left-3.5 top-3 text-slate-400 pointer-events-none" />
                <input
                  className={`${inputCls} pl-11`}
                  placeholder="Type a name or phone number…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
              {search.length >= 2 && data && data.items.length === 0 && (
                <p className="text-sm text-slate-500 mt-2">
                  No patient found. Register them from the Patients screen first.
                </p>
              )}
              {data && data.items.length > 0 && (
                <div className="border-2 border-slate-200 rounded-xl mt-2 divide-y divide-slate-100 max-h-44 overflow-y-auto">
                  {data.items.map((p) => (
                    <button
                      key={p.id}
                      className="block w-full text-left px-3.5 py-2.5 text-sm hover:bg-violet-50 transition"
                      onClick={() => setPatientId(p.id)}
                    >
                      <span className="font-semibold text-slate-800">{p.name}</span>
                      <span className="text-xs text-slate-500 ml-2">{p.code}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </Field>
        
        {user?.role !== 'DOCTOR' && (
          <Field label="Which doctor?" required>
            <select className={inputCls} value={doctorId} onChange={e => setDoctorId(e.target.value ? Number(e.target.value) : '')}>
              <option value="" disabled>Select a doctor</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>Dr. {d.name}</option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Which day?"><input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="What time?">
            <select className={inputCls} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}>
              {timeOptions.length > 0 ? (
                timeOptions.map((t) => <option key={t} value={t}>{t}</option>)
              ) : (
                <option value="" disabled>No slots (Closed?)</option>
              )}
            </select>
          </Field>
          <Field label="How long will it take?">
            <select className={inputCls} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })}>
              {[15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} minutes</option>)}
            </select>
          </Field>
          <Field label="What kind of visit?">
            <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {APPT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label} — {t.hint}</option>)}
            </select>
          </Field>
        </div>
        
        <label className="flex items-center gap-2 text-sm text-slate-600 mt-2 mb-4 cursor-pointer">
          <input type="checkbox" checked={ignoreWH} onChange={(e) => setIgnoreWH(e.target.checked)} />
          Show all times (book outside working hours)
        </label>

        <Field label="Notes" hint="Anything you want to remember about this visit. Optional.">
          <input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Wants to discuss cost first" />
        </Field>
        <SlotWarnings slot={slot} />
        {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-100">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="lg" onClick={handleBookClick} disabled={!patientId || !doctorId || save.isPending}>
          <CalendarPlus size={17} />
          {save.isPending ? 'Booking…' : slot.clash || slot.inPast ? 'Book anyway' : 'Book appointment'}
        </Button>
      </div>
    </Modal>
  );
}

function ApptChip({ appt, onSelect }: { appt: Appt; onSelect: (a: Appt) => void }) {
  const tone =
    appt.status === 'COMPLETED' ? 'bg-emerald-100 border-emerald-300 text-emerald-900'
    : appt.status === 'CANCELLED' || appt.status === 'NO_SHOW' ? 'bg-slate-100 border-slate-200 text-slate-400 line-through'
    : appt.status === 'WAITING' ? 'bg-amber-100 border-amber-400 text-amber-900 ring-2 ring-amber-200'
    : appt.type === 'EMERGENCY' ? 'bg-rose-100 border-rose-400 text-rose-900'
    : appt.status === 'CONFIRMED' ? 'bg-violet-100 border-violet-300 text-violet-900'
    : 'bg-white border-violet-200 text-violet-800';
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onSelect(appt); }}
      title={`${appt.patient.name} · ${statusLabel(appt.status)} — click to update`}
      className={`block w-full text-left text-[11px] font-medium rounded-lg border px-2 py-1.5 mb-1 truncate
                  hover:shadow-md hover:-translate-y-px transition-all ${tone}`}
    >
      <b>{fmtTime(appt.startsAt)}</b> {appt.patient.name}
    </button>
  );
}

export default function Appointments() {
  const user = getUser();
  const [newApptData, setNewApptData] = useState<{ date: Date, time?: string, doctorId?: number | '' } | null>(null);
  const [anchor, setAnchor] = useState<Date>(startOfDay(new Date()));
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');
  const [closingDate, setClosingDate] = useState<string | null>(null);
  const [closureReason, setClosureReason] = useState('');
  const [selected, setSelected] = useState<Appt | null>(null);
  const [filterDocId, setFilterDocId] = useState<number | ''>(user?.role === 'DOCTOR' ? user.id : '');
  const qc = useQueryClient();
  const { data: users } = useQuery<{ id: number; name: string; role: string; active: boolean }[]>({ queryKey: ['users'], queryFn: () => api('/users') });
  const doctors = users?.filter(u => u.role === 'DOCTOR' && u.active) || [];

  const range = useMemo(() => {
    if (view === 'day') return { from: anchor, to: addDays(anchor, 1) };
    if (view === 'week') {
      const from = startOfWeek(anchor, { weekStartsOn: 1 });
      return { from, to: addDays(from, 7) };
    }
    return {
      from: startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }),
      to: addDays(endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }), 1),
    };
  }, [view, anchor]);

  const { data: appts, isLoading } = useQuery<Appt[]>({
    queryKey: ['appointments', range.from.toISOString(), range.to.toISOString(), filterDocId],
    queryFn: () => api(`/appointments?from=${range.from.toISOString()}&to=${range.to.toISOString()}${filterDocId ? `&doctorId=${filterDocId}` : ''}`),
  });

  const { data: settings } = useQuery<Record<string, string>>({ queryKey: ['settings'], queryFn: () => api('/settings') });
  
  const intervalStr = settings?.['appointments.interval'];
  const interval = intervalStr ? parseInt(intervalStr, 10) : 15;
  const safeInterval = isNaN(interval) || interval <= 0 ? 15 : interval;

  const wh = useMemo(() => {
    try { return settings?.['clinic.workingHours'] ? JSON.parse(settings['clinic.workingHours']) : null; }
    catch { return null; }
  }, [settings?.['clinic.workingHours']]);

  const closures = useMemo(() => {
    try { return settings?.['clinic.closures'] ? JSON.parse(settings['clinic.closures']) : {}; }
    catch { return {}; }
  }, [settings?.['clinic.closures']]);

  const doctorClosures = useMemo<Record<string, Record<string, string>>>(() => {
    try { return settings?.['doctor.closures'] ? JSON.parse(settings['doctor.closures']) : {}; }
    catch { return {}; }
  }, [settings?.['doctor.closures']]);

  const setClosure = useMutation({
    mutationFn: async ({ date, comment }: { date: string; comment: string | null }) => {
      if (filterDocId) {
        const next = { ...(doctorClosures[filterDocId] || {}) };
        if (comment) next[date] = comment;
        else delete next[date];
        await api('/settings/doctor-closures', { method: 'PUT', body: { doctorId: filterDocId, closures: JSON.stringify(next) } });
      } else {
        const next = { ...closures };
        if (comment) next[date] = comment;
        else delete next[date];
        await api('/settings/closures', { method: 'PUT', body: { closures: JSON.stringify(next) } });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status, reason }: { id: number; status: string; reason?: string }) =>
      api(`/appointments/${id}/status`, { method: 'PUT', body: { status, reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      setSelected(null);
    },
  });

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let d = range.from; d < range.to; d = addDays(d, 1)) out.push(d);
    return out;
  }, [range]);

  const byDay = (d: Date) => {
    const filtered = appts?.filter((a) => {
      if (a.status === 'RESCHEDULED' || a.status === 'CANCELLED') return false;
      const dKey = format(d, 'yyyy-MM-dd');
      const explicitClinicClosure = closures[dKey];
      const explicitDoctorClosure = filterDocId ? doctorClosures[filterDocId]?.[dKey] : null;
      if (explicitClinicClosure) return false;
      if (explicitDoctorClosure) return false;

      const isSame = isSameDay(new Date(a.startsAt), d);
      const docMatch = filterDocId ? a.doctor?.id === filterDocId : true;
      return isSame && docMatch;
    });
    return filtered || [];
  };
  const step = (dir: 1 | -1) =>
    setAnchor(view === 'day' ? addDays(anchor, dir) : view === 'week' ? addDays(anchor, 7 * dir) : addMonths(anchor, dir));

  return (
    <div>
      <PageHeader
        icon={CalendarDays}
        title="Appointments"
        subtitle="Your clinic calendar. Click any appointment to mark the patient as arrived or done."
        actions={
          <div className="flex items-center gap-4">
            {user?.role !== 'DOCTOR' && (
              <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 shadow-sm h-10">
                <Filter size={16} className="text-slate-400" />
                <select
                  className="bg-transparent text-sm font-medium text-slate-700 focus:outline-none cursor-pointer"
                  value={filterDocId}
                  onChange={e => setFilterDocId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">All Doctors</option>
                  {doctors.map(d => (
                    <option key={d.id} value={d.id}>Dr. {d.name}</option>
                  ))}
                </select>
              </div>
            )}
            <button
              onClick={() => setNewApptData({ date: anchor })}
              className="inline-flex items-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur text-white
                        font-semibold rounded-xl px-4 py-2.5 text-sm transition active:scale-[0.97]"
            >
              <CalendarPlus size={17} /> Book appointment
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex rounded-xl border-2 border-slate-200 overflow-hidden bg-white shadow-sm">
          {([['day', 'Day'], ['week', 'Week'], ['month', 'Month']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-2 text-sm font-semibold transition ${
                view === v ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => step(-1)} title="Go back"><ChevronLeft size={18} /></Button>
          <span className="text-base font-bold text-slate-700 min-w-40 text-center">
            {view === 'month' ? format(anchor, 'MMMM yyyy') : format(anchor, 'd MMM yyyy')}
          </span>
          <Button variant="secondary" onClick={() => step(1)} title="Go forward"><ChevronRight size={18} /></Button>
          <Button variant="secondary" onClick={() => setAnchor(startOfDay(new Date()))}>Jump to today</Button>
        </div>
      </div>

      {isLoading && <Spinner label="Loading the calendar…" />}

      {!isLoading && view === 'day' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 animate-rise">
          {(() => {
            const dKey = format(anchor, 'yyyy-MM-dd');
            const explicitClinicClosure = closures[dKey];
            const explicitDoctorClosure = filterDocId ? doctorClosures[filterDocId]?.[dKey] : null;
            const anyDoctorClosed = !filterDocId && Object.values(doctorClosures).some(doc => doc[dKey]);

            if (explicitClinicClosure) {
              return <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl font-medium text-sm flex items-center gap-2"><CalendarDays size={18} /> Clinic is closed today: {explicitClinicClosure}</div>;
            } else if (explicitDoctorClosure) {
              return <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-xl font-medium text-sm flex items-center gap-2"><CalendarDays size={18} /> Doctor is marked unavailable today: {explicitDoctorClosure}</div>;
            } else if (anyDoctorClosed) {
               return <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-xl font-medium text-sm flex items-center gap-2"><CalendarDays size={18} /> One or more doctors are unavailable today. Switch to a specific doctor to view details.</div>;
            }
            return null;
          })()}
          
          {(() => {
            let START_HOUR = 8;
            let END_HOUR = 20;
            const dayConf = wh?.[anchor.getDay()];
            if (dayConf && !dayConf.closed) {
              const startHr = parseInt(dayConf.morning?.[0]?.split(':')[0] || '8', 10);
              const endHr = parseInt(dayConf.evening?.[1]?.split(':')[0] || dayConf.morning?.[1]?.split(':')[0] || '20', 10);
              START_HOUR = Math.max(0, startHr - 1);
              END_HOUR = Math.min(24, endHr + 2);
            }
            const HOUR_HEIGHT = 80; // pixels per hour
            
            const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
            
            const formatDoc = (name: string) => (name.startsWith('Dr.') || name.startsWith('Dr ')) ? name : `Dr. ${name}`;

            const columns = filterDocId
              ? [{ id: filterDocId, title: formatDoc(doctors.find(d=>d.id===filterDocId)?.name || ''), appts: byDay(anchor) }]
              : doctors.length > 0
                ? doctors.map(d => ({ id: d.id, title: formatDoc(d.name), appts: byDay(anchor).filter(a => a.doctor?.id === d.id) }))
                : [{ id: 'all', title: 'Clinic', appts: byDay(anchor) }];

            const getStyleForAppt = (startsAt: string, endsAt: string) => {
              const start = new Date(startsAt);
              const end = new Date(endsAt);
              let startMins = start.getHours() * 60 + start.getMinutes();
              let endMins = end.getHours() * 60 + end.getMinutes();
              
              if (endMins < START_HOUR * 60 || startMins > END_HOUR * 60) return { display: 'none' };
              
              startMins = Math.max(START_HOUR * 60, startMins);
              endMins = Math.min(END_HOUR * 60, endMins);
              
              const top = (startMins - START_HOUR * 60) * (HOUR_HEIGHT / 60);
              const height = Math.max(15, (endMins - startMins) * (HOUR_HEIGHT / 60));
              return { top: `${top}px`, height: `${height}px` };
            };

            return (
              <div className="flex overflow-hidden rounded-xl border border-slate-200 shadow-sm bg-slate-50">
                {/* Time Axis */}
                <div className="w-14 sm:w-16 shrink-0 border-r border-slate-200 bg-white flex flex-col pt-8">
                   <div className="relative flex-1" style={{ minHeight: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}>
                     {hours.map((h) => (
                       <div key={h} className="text-right pr-2 text-[10px] sm:text-xs font-bold text-slate-400 absolute w-full" style={{ top: (h - START_HOUR) * HOUR_HEIGHT - 8 }}>
                         {h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`}
                       </div>
                     ))}
                   </div>
                </div>
                
                {/* Doctor Columns */}
                <div className="flex-1 flex overflow-x-auto bg-white">
                  {columns.map((col, idx) => (
                    <div key={col.id} className="flex-1 min-w-[120px] sm:min-w-[150px] border-r border-slate-100 last:border-r-0 flex flex-col">
                      {/* Header */}
                      <div className="h-8 flex items-center justify-center bg-slate-50 border-b border-slate-200 text-xs sm:text-sm font-bold text-slate-700 truncate px-2 sticky top-0 z-20 shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
                        {col.title}
                      </div>
                      
                      {/* Time Grid for this column */}
                      <div className="relative group flex-1" style={{ minHeight: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}>
                        {/* Background grid lines */}
                        <div className="absolute inset-0 pointer-events-none">
                          {hours.map(h => (
                            <div key={h} className="border-b border-slate-100 w-full" style={{ height: HOUR_HEIGHT }} />
                          ))}
                        </div>
                        
                        {/* Explicit visual slots */}
                        <div className="absolute inset-0 z-0 flex flex-col pointer-events-auto">
                          {Array.from({ length: (END_HOUR - START_HOUR) * (60 / safeInterval) }).map((_, i) => {
                            const totalMins = START_HOUR * 60 + i * safeInterval;
                            const hr = Math.floor(totalMins / 60);
                            const mn = totalMins % 60;
                            const timeStr = `${hr.toString().padStart(2, '0')}:${mn.toString().padStart(2, '0')}`;
                            const isOutside = (() => {
                              if (!dayConf || dayConf.closed) return true;
                              const inMorn = timeStr >= dayConf.morning[0] && timeStr < dayConf.morning[1];
                              const inEve = dayConf.evening ? (timeStr >= dayConf.evening[0] && timeStr < dayConf.evening[1]) : false;
                              return !inMorn && !inEve;
                            })();

                            const slotBg = isOutside ? 'bg-slate-100/50 hover:bg-slate-200/50' : 'hover:bg-violet-50';

                            return (
                              <div 
                                key={i}
                                className={`border-b border-slate-100 border-dashed w-full cursor-crosshair transition-colors group/slot relative ${slotBg}`}
                                style={{ height: (safeInterval / 60) * HOUR_HEIGHT }}
                                onClick={() => setNewApptData({ date: anchor, time: timeStr, doctorId: col.id === 'all' ? '' : Number(col.id) })}
                              >
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/slot:opacity-100 text-[10px] font-semibold text-violet-400">
                                  {timeStr} Available
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        
                        {/* Appts */}
                        {col.appts.map(a => {
                           const style = getStyleForAppt(a.startsAt, a.endsAt);
                           if (style.display === 'none') return null;
                           
                           let bg = 'bg-violet-100 border-violet-200 text-violet-800 hover:bg-violet-200 hover:border-violet-300';
                           if (a.status === 'COMPLETED') bg = 'bg-emerald-100 border-emerald-200 text-emerald-800 hover:bg-emerald-200 hover:border-emerald-300';
                           if (a.status === 'WAITING') bg = 'bg-blue-100 border-blue-200 text-blue-800 hover:bg-blue-200 hover:border-blue-300';
                           
                           return (
                              <div
                                key={a.id}
                                className={`absolute left-1 right-1 rounded-md border px-1.5 py-0.5 overflow-hidden shadow-sm transition-all cursor-pointer z-10 text-[10px] sm:text-xs leading-none flex flex-row items-center gap-1.5 ${bg}`}
                                style={style}
                                onClick={() => setSelected(a)}
                                title={`${a.patient.name} (${fmtTime(a.startsAt)} - ${fmtTime(a.endsAt)})`}
                              >
                                <span className="font-bold truncate">{a.patient.name}</span>
                                <span className="truncate font-medium opacity-70 text-[9px] sm:text-[10px] whitespace-nowrap">
                                  {fmtTime(a.startsAt)} - {fmtTime(a.endsAt)}
                                </span>
                              </div>
                            );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* A grid of empty boxes tells a first-time user nothing — say so plainly. */}
      {!isLoading && view !== 'day' && appts?.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm mb-4 animate-rise">
          <Empty
            icon={CalendarDays}
            text={view === 'week' ? 'Nothing booked this week' : 'Nothing booked this month'}
            hint="Your calendar is clear. Book a patient in, or use the arrows above to look at another week."
            action={<Button size="lg" onClick={() => setNewApptData({ date: anchor })}><CalendarPlus size={17} /> Book an appointment</Button>}
          />
        </div>
      )}

      {!isLoading && view !== 'day' && (
        <div className={`grid gap-2 ${view === 'week' ? 'grid-cols-7' : 'grid-cols-7'}`}>
          {view === 'month' &&
            ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="text-xs font-bold text-slate-500 text-center uppercase tracking-wide pb-1">{d}</div>
            ))}
          {days.map((d) => {
            const isToday = isSameDay(d, new Date());
            const dKey = format(d, 'yyyy-MM-dd');
            const isWeeklyOff = wh?.[d.getDay()]?.closed;
            const explicitClinicClosure = closures[dKey];
            const explicitDoctorClosure = filterDocId ? doctorClosures[filterDocId]?.[dKey] : null;
            const anyDoctorClosed = !filterDocId && Object.values(doctorClosures).some(doc => doc[dKey]);
            const explicitClosure = explicitDoctorClosure || explicitClinicClosure || anyDoctorClosed;
            const isDimmedMonth = view === 'month' && !isSameMonth(d, anchor);
            
            let bgCls = 'bg-white hover:border-slate-300';
            if (isToday) bgCls = 'border-violet-400 bg-violet-50/50 ring-2 ring-violet-200';
            else if (explicitClinicClosure) bgCls = 'border-rose-300 bg-rose-50/60';
            else if (explicitDoctorClosure || anyDoctorClosed) bgCls = 'border-amber-300 bg-amber-50/60';
            else if (isWeeklyOff) bgCls = 'border-slate-200 bg-slate-50/70 opacity-90';

            return (
              <div
                key={d.toISOString()}
                className={`rounded-xl border-2 p-2 min-h-28 transition group relative cursor-pointer ${bgCls} ${isDimmedMonth ? 'opacity-40' : ''}`}
                onClick={() => { setAnchor(d); setView('day'); }}
              >
                <div className={`text-xs font-bold mb-1.5 flex flex-wrap items-center justify-between gap-1.5 ${isToday ? 'text-violet-700' : 'text-slate-500'}`}>
                  <div className="flex items-center gap-1.5">
                    {view === 'week' ? format(d, 'EEE d') : format(d, 'd')}
                    {isToday && <span className="bg-violet-600 text-white text-[9px] px-1.5 py-0.5 rounded-full">TODAY</span>}
                  </div>
                  {((view === 'month' && !isDimmedMonth) || view === 'week') && (
                    <div className="relative">
                      <button
                        className="opacity-0 group-hover:opacity-100 text-[9px] font-semibold text-slate-400 hover:text-slate-600 uppercase bg-slate-100 px-1.5 py-0.5 rounded transition"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (explicitClinicClosure && filterDocId) {
                            alert(`Clinic is closed on this day (${explicitClinicClosure}). You must switch to 'All Doctors' to open the clinic.`);
                            return;
                          }
                          if (explicitClosure) {
                            if (window.confirm(`Remove closure for ${format(d, 'MMM d')}?`)) setClosure.mutate({ date: dKey, comment: null });
                          } else {
                            setClosingDate(dKey);
                            setClosureReason('');
                          }
                        }}
                      >
                        {explicitClosure ? 'Open' : (filterDocId ? 'Mark Dr. Off' : 'Mark closed')}
                      </button>
                      {closingDate === dKey && (
                        <div 
                          className="absolute top-full right-0 mt-1 z-20 w-48 bg-white border border-slate-200 shadow-xl rounded-lg p-2 animate-in fade-in slide-in-from-top-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            autoFocus
                            placeholder="Reason for closing..."
                            className="w-full text-xs border-b border-slate-300 focus:border-indigo-500 bg-transparent py-1 outline-none mb-2"
                            value={closureReason}
                            onChange={(e) => setClosureReason(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && closureReason.trim()) {
                                const msg = filterDocId 
                                  ? `This will cancel all appointments for this doctor on ${format(d, 'MMM d')}. Are you sure?` 
                                  : `This will cancel all appointments for the ENTIRE clinic on ${format(d, 'MMM d')}. Are you sure?`;
                                if (window.confirm(msg)) {
                                  setClosure.mutate({ date: dKey, comment: closureReason });
                                  setClosingDate(null);
                                }
                              } else if (e.key === 'Escape') setClosingDate(null);
                            }}
                          />
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                if (closureReason.trim()) {
                                  const msg = filterDocId 
                                    ? `This will cancel all appointments for this doctor on ${format(d, 'MMM d')}. Are you sure?` 
                                    : `This will cancel all appointments for the ENTIRE clinic on ${format(d, 'MMM d')}. Are you sure?`;
                                  if (window.confirm(msg)) {
                                    setClosure.mutate({ date: dKey, comment: closureReason });
                                    setClosingDate(null);
                                  }
                                }
                              }}
                              className="flex-1 text-[10px] font-bold bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 transition"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setClosingDate(null)}
                              className="flex-1 text-[10px] font-bold text-slate-500 hover:text-slate-700 bg-slate-100 px-2 py-1 rounded transition"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {explicitClosure && (
                  <div className="text-[10px] font-semibold text-amber-800 bg-amber-100/80 px-2 py-1 rounded-md mb-2 truncate border border-amber-200/50" title={explicitClosure}>
                    {explicitClosure}
                  </div>
                )}
                {isWeeklyOff && !explicitClosure && (view === 'month' || view === 'week') && (
                  <div className="text-[10px] font-semibold text-slate-400 bg-slate-100/80 px-2 py-1 rounded-md mb-2 truncate">
                    Weekly Off
                  </div>
                )}
                {byDay(d).map((a) => <ApptChip key={a.id} appt={a} onSelect={setSelected} />)}
              </div>
            );
          })}
        </div>
      )}

      {newApptData && <NewAppointmentModal 
        date={newApptData.date} 
        initialTime={newApptData.time} 
        initialDoctorId={newApptData.doctorId} 
        onClose={() => setNewApptData(null)} 
      />}

      {selected && (
        <Modal
          title={selected.patient.name}
          hint={format(new Date(selected.startsAt), "EEEE d MMMM 'at' h:mm a")}
          onClose={() => setSelected(null)}
        >
          {selected.createdBy ? (
            <div className="flex items-center gap-2 mb-4 flex-wrap bg-violet-50 text-violet-800 px-3 py-2 rounded-lg font-medium text-sm">
              <span className="capitalize">{selected.type.replace(/_/g, ' ').toLowerCase()}</span>
              <span>·</span>
              <span>Confirmed - by {selected.createdBy.name} on {format(new Date(selected.createdAt), 'MMM d, h:mm a')}</span>
              {selected.doctor && <span>· with Dr. {selected.doctor.name}</span>}
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <Badge value={selected.status} />
              <span className="text-sm text-slate-600 capitalize">{selected.type.replace(/_/g, ' ').toLowerCase()}</span>
              {selected.doctor && <span className="text-sm text-slate-500">· with Dr. {selected.doctor.name}</span>}
            </div>
          )}
          {selected.notes && (
            <p className="text-sm text-slate-700 mb-4 bg-slate-50 rounded-xl px-3.5 py-2.5">{selected.notes}</p>
          )}
          <Link
            to={`/patients/${selected.patient.id}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 hover:text-violet-900"
          >
            Open {selected.patient.name}'s full record →
          </Link>
          {STATUS_FLOW[selected.status]?.length > 0 && (
            <div className="mt-5 pt-4 border-t border-slate-100">
              <p className="text-sm font-semibold text-slate-700 mb-2.5">What happened with this appointment?</p>
              <UpdateAppointmentStatus 
                 selected={selected} 
                 onUpdate={(status, reason) => setStatus.mutate({ id: selected.id, status, reason })} 
                 isPending={setStatus.isPending} 
              />
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function UpdateAppointmentStatus({ selected, onUpdate, isPending }: { selected: Appt; onUpdate: (status: string, reason?: string) => void; isPending: boolean }) {
  const [status, setStatus] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <select 
          className={inputCls} 
          value={status} 
          onChange={(e) => {
            setStatus(e.target.value);
            setReason(''); // Reset reason when changing status
          }}
        >
          <option value="" disabled>Select new status...</option>
          <option value="WAITING">In Clinic</option>
          <option value="NO_SHOW">No Show</option>
          <option value="COMPLETED">Done</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <Button 
          onClick={() => onUpdate(status, reason === 'Other' ? undefined : reason)} 
          disabled={!status || isPending || (status === 'CANCELLED' && !reason)}
        >
          Update
        </Button>
      </div>
      
      {status === 'CANCELLED' && (
        <div className="mt-2 p-3 bg-red-50 rounded-xl border border-red-100 flex flex-col gap-2 animate-in fade-in slide-in-from-top-2">
          <label className="text-xs font-bold text-red-900 uppercase tracking-wide">Cancellation Reason</label>
          <select className={inputCls} value={reason} onChange={e => setReason(e.target.value)}>
            <option value="" disabled>Select reason...</option>
            <option value="Requested by patient">Requested by patient</option>
            <option value="Cancelled by Clinic">Cancelled by Clinic</option>
          </select>
        </div>
      )}
    </div>
  );
}
