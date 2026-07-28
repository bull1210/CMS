import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Search, User } from 'lucide-react';
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
import { api, fmtTime } from '../api';
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
  doctor?: { name: string };
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

function NewAppointmentModal({ date, onClose }: { date: Date; onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [patientId, setPatientId] = useState(0);
  const { data } = useQuery<{ items: PatientLite[] }>({
    queryKey: ['patients', search, 1],
    queryFn: () => api(`/patients?q=${encodeURIComponent(search)}&pageSize=8`),
    enabled: search.length >= 2,
  });
  const [form, setForm] = useState({
    date: format(date, 'yyyy-MM-dd'),
    time: '10:00',
    durationMin: 30,
    type: 'CONSULTATION',
    notes: '',
  });
  const [error, setError] = useState('');
  const slot = useSlotChecks(`${form.date}T${form.time}:00`, form.durationMin);
  const save = useMutation({
    mutationFn: () =>
      api('/appointments', {
        body: {
          patientId,
          startsAt: new Date(`${form.date}T${form.time}:00`).toISOString(),
          durationMin: form.durationMin,
          type: form.type,
          notes: form.notes || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  const selected = data?.items.find((p) => p.id === patientId);
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
        <div className="grid grid-cols-2 gap-4">
          <Field label="Which day?"><input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="What time?"><input type="time" className={inputCls} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></Field>
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
        <Field label="Notes" hint="Anything you want to remember about this visit. Optional.">
          <input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Wants to discuss cost first" />
        </Field>
        <SlotWarnings slot={slot} />
        {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-100">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="lg" onClick={() => save.mutate()} disabled={!patientId || save.isPending}>
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
      onClick={() => onSelect(appt)}
      title={`${appt.patient.name} · ${statusLabel(appt.status)} — click to update`}
      className={`block w-full text-left text-[11px] font-medium rounded-lg border px-2 py-1.5 mb-1 truncate
                  hover:shadow-md hover:-translate-y-px transition-all ${tone}`}
    >
      <b>{fmtTime(appt.startsAt)}</b> {appt.patient.name}
    </button>
  );
}

export default function Appointments() {
  const [view, setView] = useState<'day' | 'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(startOfDay(new Date()));
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<Appt | null>(null);
  const qc = useQueryClient();

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
    queryKey: ['appointments', range.from.toISOString(), range.to.toISOString()],
    queryFn: () => api(`/appointments?from=${range.from.toISOString()}&to=${range.to.toISOString()}`),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api(`/appointments/${id}/status`, { method: 'PUT', body: { status } }),
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

  const byDay = (d: Date) => appts?.filter((a) => isSameDay(new Date(a.startsAt), d)) ?? [];
  const step = (dir: 1 | -1) =>
    setAnchor(view === 'day' ? addDays(anchor, dir) : view === 'week' ? addDays(anchor, 7 * dir) : addMonths(anchor, dir));

  return (
    <div>
      <PageHeader
        icon={CalendarDays}
        title="Appointments"
        subtitle="Your clinic calendar. Click any appointment to mark the patient as arrived or done."
        actions={
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur text-white
                       font-semibold rounded-xl px-4 py-2.5 text-sm transition active:scale-[0.97]"
          >
            <CalendarPlus size={17} /> Book appointment
          </button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex rounded-xl border-2 border-slate-200 overflow-hidden bg-white shadow-sm">
          {([['day', 'One day'], ['week', 'This week'], ['month', 'Whole month']] as const).map(([v, label]) => (
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
          {byDay(anchor).length === 0 ? (
            <Empty
              icon={CalendarDays}
              text={`Nothing booked for ${format(anchor, 'EEEE d MMMM')}`}
              hint="A free day. Book someone in, or use the arrows above to look at another day."
              action={<Button size="lg" onClick={() => setShowNew(true)}><CalendarPlus size={17} /> Book an appointment</Button>}
            />
          ) : (
            <div className="space-y-2">
              {byDay(anchor).map((a) => (
                <div key={a.id} className="flex items-center gap-3 border-2 border-slate-100 rounded-xl p-3 hover:border-violet-200 hover:bg-violet-50/40 transition">
                  <span className="text-sm font-bold text-slate-700 w-28 shrink-0">
                    {fmtTime(a.startsAt)}–{fmtTime(a.endsAt)}
                  </span>
                  <Link to={`/patients/${a.patient.id}`} className="flex-1 text-sm font-semibold text-slate-800 hover:text-violet-700 truncate">
                    {a.patient.name} <span className="text-xs font-normal text-slate-500">{a.patient.code}</span>
                  </Link>
                  <span className="text-xs text-slate-500 hidden sm:inline">{a.type.replace(/_/g, ' ').toLowerCase()}</span>
                  <Badge value={a.status} />
                  <Button variant="secondary" onClick={() => setSelected(a)}>Update</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* A grid of empty boxes tells a first-time user nothing — say so plainly. */}
      {!isLoading && view !== 'day' && appts?.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm mb-4 animate-rise">
          <Empty
            icon={CalendarDays}
            text={view === 'week' ? 'Nothing booked this week' : 'Nothing booked this month'}
            hint="Your calendar is clear. Book a patient in, or use the arrows above to look at another week."
            action={<Button size="lg" onClick={() => setShowNew(true)}><CalendarPlus size={17} /> Book an appointment</Button>}
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
            return (
              <div
                key={d.toISOString()}
                className={`rounded-xl border-2 p-2 min-h-28 transition ${
                  isToday
                    ? 'border-violet-400 bg-violet-50/50 ring-2 ring-violet-200'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                } ${view === 'month' && !isSameMonth(d, anchor) ? 'opacity-40' : ''}`}
              >
                <div className={`text-xs font-bold mb-1.5 flex items-center gap-1.5 ${isToday ? 'text-violet-700' : 'text-slate-500'}`}>
                  {view === 'week' ? format(d, 'EEE d') : format(d, 'd')}
                  {isToday && <span className="bg-violet-600 text-white text-[9px] px-1.5 py-0.5 rounded-full">TODAY</span>}
                </div>
                {byDay(d).map((a) => <ApptChip key={a.id} appt={a} onSelect={setSelected} />)}
              </div>
            );
          })}
        </div>
      )}

      {showNew && <NewAppointmentModal date={anchor} onClose={() => setShowNew(false)} />}

      {selected && (
        <Modal
          title={selected.patient.name}
          hint={format(new Date(selected.startsAt), "EEEE d MMMM 'at' h:mm a")}
          onClose={() => setSelected(null)}
        >
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Badge value={selected.status} />
            <span className="text-sm text-slate-600 capitalize">{selected.type.replace(/_/g, ' ').toLowerCase()}</span>
            {selected.doctor && <span className="text-sm text-slate-500">· with {selected.doctor.name}</span>}
          </div>
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
              <div className="flex flex-wrap gap-2">
                {STATUS_FLOW[selected.status].map((s) => (
                  <Button
                    key={s}
                    variant={s === 'CANCELLED' || s === 'NO_SHOW' ? 'danger' : s === 'COMPLETED' ? 'success' : 'secondary'}
                    onClick={() => setStatus.mutate({ id: selected.id, status: s })}
                    disabled={setStatus.isPending}
                  >
                    {statusLabel(s)}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
