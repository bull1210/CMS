import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, UserPlus, Users } from 'lucide-react';
import { api, ApiError, fmtDate, fmtMoney } from '../api';
import { Button, Empty, Field, Hint, inputCls, Modal, PageHeader, Spinner } from '../components/ui';

export interface Patient {
  id: number;
  code: string;
  name: string;
  gender?: string;
  dob?: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  emergencyContact?: string;
  referralSource?: string;
  active: boolean;
  inactiveReason?: string;
  medicalHistory: Record<string, unknown>;
  dentalHistory: Record<string, unknown>;
  createdAt: string;
  /** Money still owed (Σ non-VOID invoices − Σ payments); present on list rows. */
  outstanding?: number;
}

export function PatientForm({
  initial,
  onSaved,
  onClose,
}: {
  initial?: Patient;
  onSaved: (p: Patient) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    gender: initial?.gender ?? '',
    dob: initial?.dob ? initial.dob.slice(0, 10) : '',
    phone: initial?.phone ?? '',
    whatsapp: initial?.whatsapp ?? '',
    email: initial?.email ?? '',
    address: initial?.address ?? '',
    emergencyContact: initial?.emergencyContact ?? '',
    referralSource: initial?.referralSource ?? '',
  });
  const [medical, setMedical] = useState({
    diabetes: Boolean(initial?.medicalHistory?.diabetes),
    bloodPressure: Boolean(initial?.medicalHistory?.bloodPressure),
    heartConditions: Boolean(initial?.medicalHistory?.heartConditions),
    smoking: Boolean(initial?.medicalHistory?.smoking),
    pregnancy: Boolean(initial?.medicalHistory?.pregnancy),
    allergies: String(initial?.medicalHistory?.allergies ?? ''),
    medications: String(initial?.medicalHistory?.medications ?? ''),
    notes: String(initial?.medicalHistory?.notes ?? ''),
  });
  const [dentalNotes, setDentalNotes] = useState(String(initial?.dentalHistory?.notes ?? ''));
  const [archived, setArchived] = useState(initial ? !initial.active : false);
  const [inactiveReason, setInactiveReason] = useState(initial?.inactiveReason ?? 'OTHER');
  const [error, setError] = useState('');
  const [duplicate, setDuplicate] = useState(false);

  const save = useMutation({
    mutationFn: ({ force }: { force?: boolean } = {}) => {
      const body = {
        ...form,
        dob: form.dob || undefined,
        medicalHistory: medical,
        dentalHistory: { notes: dentalNotes },
        ...(initial ? { active: !archived, inactiveReason: archived ? inactiveReason : null } : {}),
        ...(force ? { force: true } : {}),
      };
      return initial
        ? api<Patient>(`/patients/${initial.id}`, { method: 'PUT', body })
        : api<Patient>('/patients', { body });
    },
    onSuccess: onSaved,
    onError: (e) => {
      setError(e.message);
      setDuplicate(e instanceof ApiError && e.status === 409);
    },
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <Modal
      title={initial ? `Edit ${initial.name}` : 'Register a new patient'}
      hint={initial ? 'Update their details below.' : 'Only the name and phone number are required — you can fill in the rest later.'}
      onClose={onClose}
      wide
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Full name" required><input className={inputCls} value={form.name} onChange={set('name')} placeholder="e.g. Rajesh Kumar" /></Field>
        <Field label="Phone number" required hint="Used for appointment reminders."><input className={inputCls} value={form.phone} onChange={set('phone')} placeholder="e.g. 9876543210" /></Field>
        <Field label="WhatsApp number" hint="Leave blank if it's the same as the phone number."><input className={inputCls} value={form.whatsapp} onChange={set('whatsapp')} placeholder="Same as phone" /></Field>
        <Field label="Email"><input className={inputCls} value={form.email} onChange={set('email')} placeholder="Optional" /></Field>
        <Field label="Date of birth" hint="Lets the system send birthday wishes."><input type="date" className={inputCls} value={form.dob} onChange={set('dob')} /></Field>
        <Field label="Gender">
          <select className={inputCls} value={form.gender} onChange={set('gender')}>
            <option value="">Not specified</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
          </select>
        </Field>
        <Field label="Address" className="col-span-2"><input className={inputCls} value={form.address} onChange={set('address')} placeholder="Optional" /></Field>
        <Field label="Emergency contact" hint="Someone to call if there's a problem."><input className={inputCls} value={form.emergencyContact} onChange={set('emergencyContact')} placeholder="Optional" /></Field>
        <Field label="How did they hear about us?" hint="Shows you which sources bring in patients.">
          <select className={inputCls} value={form.referralSource} onChange={set('referralSource')}>
            <option value="">Not specified</option>
            <option value="WALK_IN">Walk-in</option>
            <option value="GOOGLE">Google / online search</option>
            <option value="FRIEND_FAMILY">Friend or family</option>
            <option value="DOCTOR_REFERRAL">Doctor referral</option>
            <option value="SOCIAL_MEDIA">Social media</option>
            <option value="OTHER">Other</option>
          </select>
        </Field>
      </div>

      <div className="mt-6 mb-3">
        <h4 className="font-bold text-slate-800">Medical history</h4>
        <p className="text-sm text-slate-500">Tick anything that applies. This warns you before treatment.</p>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {(
          [
            ['diabetes', 'Diabetes'],
            ['bloodPressure', 'Blood pressure'],
            ['heartConditions', 'Heart conditions'],
            ['smoking', 'Smoking'],
            ['pregnancy', 'Pregnancy'],
          ] as const
        ).map(([key, label]) => (
          <label
            key={key}
            className={`flex items-center gap-2.5 text-sm font-medium rounded-xl border-2 px-3 py-2.5 cursor-pointer transition ${
              medical[key]
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            <input
              type="checkbox"
              checked={medical[key]}
              onChange={(e) => setMedical({ ...medical, [key]: e.target.checked })}
              className="rounded w-4 h-4 accent-amber-600"
            />
            {label}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Allergies" hint="Especially any drug allergies."><input className={inputCls} value={medical.allergies} onChange={(e) => setMedical({ ...medical, allergies: e.target.value })} placeholder="e.g. Penicillin" /></Field>
        <Field label="Medicines they already take"><input className={inputCls} value={medical.medications} onChange={(e) => setMedical({ ...medical, medications: e.target.value })} placeholder="e.g. Blood thinners" /></Field>
        <Field label="Other medical notes" className="col-span-2"><input className={inputCls} value={medical.notes} onChange={(e) => setMedical({ ...medical, notes: e.target.value })} placeholder="Anything else worth knowing before treatment" /></Field>
        <Field label="Past dental treatment" className="col-span-2">
          <textarea className={inputCls} rows={2} value={dentalNotes} onChange={(e) => setDentalNotes(e.target.value)} placeholder="Previous treatments, other clinics, existing crowns or dentures…" />
        </Field>
      </div>

      {initial && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <label className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" className="rounded w-4 h-4 mt-0.5 accent-slate-600" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            <span>
              <span className="font-semibold">Archive this patient</span>
              <span className="block text-xs text-slate-500 mt-0.5">
                Keeps all their history, but stops every automatic reminder and message. Use this instead of deleting.
              </span>
            </span>
          </label>
          {archived && (
            <select className={`${inputCls} mt-2 max-w-60`} value={inactiveReason} onChange={(e) => setInactiveReason(e.target.value)}>
              <option value="MOVED_AWAY">Moved away</option>
              <option value="SWITCHED_CLINIC">Switched clinic</option>
              <option value="DECEASED">Deceased</option>
              <option value="OTHER">Other</option>
            </select>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4">
          <Hint tone="warn">
            <span className="font-semibold">{error}</span>
            {duplicate && !initial && (
              <span className="block mt-1">
                If this is a family member sharing the same phone, use “Add anyway” below.
              </span>
            )}
          </Hint>
        </div>
      )}
      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-100">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        {duplicate && !initial && (
          <Button variant="danger" onClick={() => save.mutate({ force: true })} disabled={save.isPending}>
            Add anyway — same phone
          </Button>
        )}
        <Button size="lg" onClick={() => save.mutate({})} disabled={save.isPending || !form.name || !form.phone}>
          {save.isPending ? 'Saving…' : initial ? 'Save changes' : 'Save patient'}
        </Button>
      </div>
    </Modal>
  );
}

export default function Patients() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery<{ items: Patient[]; total: number; pageSize: number }>({
    queryKey: ['patients', q, page],
    queryFn: () => api(`/patients?q=${encodeURIComponent(q)}&page=${page}`),
  });

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHeader
        icon={Users}
        title={`Patients${data ? ` (${data.total})` : ''}`}
        subtitle="Everyone registered at the clinic. Click any row to open their full record."
        actions={
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur text-white
                       font-semibold rounded-xl px-4 py-2.5 text-sm transition active:scale-[0.97]"
          >
            <UserPlus size={17} /> Add new patient
          </button>
        }
      />

      <div className="relative mb-4 max-w-md">
        <Search size={18} className="absolute left-3.5 top-3 text-slate-400 pointer-events-none" />
        <input
          className={`${inputCls} pl-11`}
          placeholder="Type a name, phone number or patient ID…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden animate-rise">
        {isLoading && <Spinner label="Loading patients…" />}
        {data && data.items.length === 0 && (
          <Empty
            icon={q ? Search : Users}
            text={q ? `No patient matches “${q}”` : 'No patients yet'}
            hint={
              q
                ? 'Try just the first few letters of their name, or their phone number.'
                : 'Your patient list is empty. Register the first patient to get started.'
            }
            action={
              <Button size="lg" onClick={() => setShowForm(true)}>
                <Plus size={17} /> {q ? 'Register this patient' : 'Register the first patient'}
              </Button>
            }
          />
        )}
        {data && data.items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 font-bold">Patient ID</th>
                <th className="px-4 py-3 font-bold">Name</th>
                <th className="px-4 py-3 font-bold">Phone</th>
                <th className="px-4 py-3 font-bold">Gender</th>
                <th className="px-4 py-3 font-bold text-right">Due</th>
                <th className="px-4 py-3 font-bold">Registered on</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-slate-50 last:border-0 hover:bg-blue-50/60 cursor-pointer transition"
                  onClick={() => navigate(`/patients/${p.id}`)}
                >
                  <td className="px-4 py-3.5 font-mono text-xs text-slate-500">{p.code}</td>
                  <td className="px-4 py-3.5">
                    <Link
                      to={`/patients/${p.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold text-slate-800 hover:text-blue-600"
                    >
                      {p.name}
                    </Link>
                    {!p.active && (
                      <span className="ml-2 text-[11px] font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                        Archived
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">{p.phone}</td>
                  <td className="px-4 py-3.5 text-slate-600 capitalize">{p.gender?.toLowerCase() ?? '—'}</td>
                  <td className="px-4 py-3.5 text-right">
                    {p.outstanding && p.outstanding > 0 ? (
                      <span className="font-semibold text-rose-600 bg-rose-50 rounded-lg px-2 py-1">
                        {fmtMoney(p.outstanding)}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">{fmtDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div className="flex justify-center items-center gap-3 mt-5">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</Button>
          <span className="text-sm text-slate-600 font-medium">Page {page} of {pages}</span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</Button>
        </div>
      )}

      {showForm && (
        <PatientForm
          onClose={() => setShowForm(false)}
          onSaved={(p) => {
            setShowForm(false);
            qc.invalidateQueries({ queryKey: ['patients'] });
            navigate(`/patients/${p.id}`);
          }}
        />
      )}
    </div>
  );
}
