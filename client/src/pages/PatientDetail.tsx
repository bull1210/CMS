import { useRef, useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  BookOpen,
  CalendarPlus,
  FileText,
  FolderOpen,
  ImagePlus,
  MessageSquare,
  Pencil,
  Pill,
  Plus,
  Trash2,
  UserRound,
} from 'lucide-react';
import { api, fmtDate, fmtDateTime, fmtMoney, getUser } from '../api';
import { Badge, Button, Card, Empty, Field, Hint, inputCls, Modal, Spinner } from '../components/ui';
import { FormularyDatalist, MedicineEditor, describeFrequency } from '../components/MedicineEditor';
import { checkAllergies } from '../allergyCheck';
import { statusLabel } from '../theme';
import { Patient, PatientForm } from './Patients';
import DentalChart from '../components/DentalChart';
import PlansLab from '../components/PlansLab';

const isClinical = () => ['DOCTOR', 'ADMIN'].includes(getUser()?.role ?? '');

interface Summary {
  billed: number;
  paid: number;
  outstanding: number;
  pendingFollowUps: { id: number; dueDate: string; procedure?: { id: number; name: string } }[];
  pendingTreatments: number;
  nextAppointment?: { id: number; startsAt: string } | null;
}
interface TimelineEvent {
  id: number;
  type: string;
  title: string;
  detail?: string;
  createdAt: string;
}
interface ProcedureRef {
  id: number;
  name: string;
  cost: number;
  followUp?: { id: number; name: string } | null;
  followUpDays?: number | null;
  active: boolean;
}

const typeColors: Record<string, string> = {
  APPOINTMENT: 'bg-blue-500',
  TREATMENT: 'bg-indigo-500',
  DIAGNOSIS: 'bg-purple-500',
  PAYMENT: 'bg-emerald-500',
  INVOICE: 'bg-amber-500',
  DOCUMENT: 'bg-cyan-500',
  PRESCRIPTION: 'bg-pink-500',
  MESSAGE: 'bg-slate-400',
  FOLLOW_UP: 'bg-orange-500',
  NOTE: 'bg-slate-300',
};

function Timeline({ patientId }: { patientId: number }) {
  const { data, isLoading } = useQuery<TimelineEvent[]>({
    queryKey: ['timeline', patientId],
    queryFn: () => api(`/patients/${patientId}/timeline`),
  });
  if (isLoading) return <Spinner />;
  if (!data?.length) return <Empty text="Nothing recorded yet" hint="As you book visits, record treatments and raise bills, every step will appear here automatically." />;
  return (
    <div className="relative pl-6">
      <div className="absolute left-[7px] top-1 bottom-1 w-px bg-slate-200" />
      <div className="space-y-4">
        {data.map((e) => (
          <div key={e.id} className="relative">
            <span className={`absolute -left-[23px] top-1.5 w-3 h-3 rounded-full ${typeColors[e.type] ?? 'bg-slate-300'}`} />
            <div className="text-xs text-slate-400">{fmtDateTime(e.createdAt)}</div>
            <div className="text-sm font-medium text-slate-700">{e.title}</div>
            {e.detail && <div className="text-xs text-slate-500 mt-0.5">{e.detail}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Clinical tab (diagnoses, treatments, follow-ups) ----------------

function DiagnosisModal({ patientId, onClose }: { patientId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: templates } = useQuery<{ name: string; diagnosis: string; symptoms: string; observations: string }[]>({
    queryKey: ['dx-templates'],
    queryFn: () => api('/diagnoses/templates'),
  });
  const [form, setForm] = useState({ symptoms: '', observations: '', diagnosis: '', notes: '' });
  const save = useMutation({
    mutationFn: () => api('/diagnoses', { body: { patientId, ...form } }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });
  return (
    <Modal title="Add diagnosis" onClose={onClose}>
      <Field label="Template" className="mb-3">
        <select
          className={inputCls}
          onChange={(e) => {
            const t = templates?.find((x) => x.name === e.target.value);
            if (t) setForm({ ...form, diagnosis: t.diagnosis, symptoms: t.symptoms, observations: t.observations });
          }}
        >
          <option value="">Start from scratch, or pick a template…</option>
          {templates?.map((t) => <option key={t.name}>{t.name}</option>)}
        </select>
      </Field>
      <div className="space-y-3">
        <Field label="Symptoms"><textarea rows={2} className={inputCls} value={form.symptoms} onChange={(e) => setForm({ ...form, symptoms: e.target.value })} /></Field>
        <Field label="Observations"><textarea rows={2} className={inputCls} value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} /></Field>
        <Field label="Diagnosis *"><input className={inputCls} value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} /></Field>
        <Field label="Notes"><input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!form.diagnosis || save.isPending}>Save</Button>
      </div>
    </Modal>
  );
}

function TreatmentModal({ patientId, onClose }: { patientId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: procedures } = useQuery<ProcedureRef[]>({
    queryKey: ['procedures'],
    queryFn: () => api('/procedures'),
  });
  const [form, setForm] = useState({ procedureId: 0, status: 'PLANNED', toothRefs: '', notes: '', cost: '' });
  const selected = procedures?.find((p) => p.id === form.procedureId);
  const save = useMutation({
    mutationFn: () =>
      api('/treatments', {
        body: {
          patientId,
          procedureId: form.procedureId,
          status: form.status,
          toothRefs: form.toothRefs || undefined,
          notes: form.notes || undefined,
          cost: form.cost === '' ? undefined : Number(form.cost),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });
  return (
    <Modal title="Add treatment" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Procedure *">
          <select
            className={inputCls}
            value={form.procedureId}
            onChange={(e) => {
              const id = Number(e.target.value);
              const proc = procedures?.find((p) => p.id === id);
              setForm({ ...form, procedureId: id, cost: proc ? String(proc.cost) : form.cost });
            }}
          >
            <option value={0}>Choose a treatment…</option>
            {procedures?.filter((p) => p.active).map((p) => (
              <option key={p.id} value={p.id}>{p.name} (₹{p.cost})</option>
            ))}
          </select>
        </Field>
        {selected?.followUp && (
          <p className="text-xs text-indigo-600 bg-indigo-50 rounded-lg px-3 py-2">
            Flow: completing this recommends <b>{selected.followUp.name}</b> after {selected.followUpDays ?? 14} days.
          </p>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {['PLANNED', 'IN_PROGRESS', 'COMPLETED'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </Field>
          <Field label="Tooth (FDI)"><input className={inputCls} value={form.toothRefs} onChange={(e) => setForm({ ...form, toothRefs: e.target.value })} placeholder="16, 17" /></Field>
          <Field label="Cost (₹)"><input type="number" className={inputCls} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!form.procedureId || save.isPending}>Save</Button>
      </div>
    </Modal>
  );
}

interface Treatment {
  id: number;
  status: string;
  toothRefs?: string;
  notes?: string;
  cost: number;
  performedAt?: string;
  createdAt: string;
  procedure: { name: string; followUp?: { name: string } | null };
  doctor?: { name: string };
}
interface Diagnosis {
  id: number;
  symptoms?: string;
  observations?: string;
  diagnosis: string;
  notes?: string;
  createdAt: string;
  doctor?: { name: string };
}

function ClinicalTab({ patientId }: { patientId: number }) {
  const qc = useQueryClient();
  const [showDx, setShowDx] = useState(false);
  const [showTx, setShowTx] = useState(false);
  const { data: diagnoses } = useQuery<Diagnosis[]>({
    queryKey: ['diagnoses', patientId],
    queryFn: () => api(`/diagnoses?patientId=${patientId}`),
  });
  const { data: treatments } = useQuery<Treatment[]>({
    queryKey: ['treatments', patientId],
    queryFn: () => api(`/treatments?patientId=${patientId}`),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api(`/treatments/${id}/status`, { method: 'PUT', body: { status } }),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card
        title="Treatments"
        action={isClinical() && <Button variant="ghost" onClick={() => setShowTx(true)}><span className="flex items-center gap-1"><Plus size={14} />Add</span></Button>}
      >
        {!treatments?.length && <Empty text="No treatments recorded" hint="Once you carry out a treatment on this patient, it will be listed here." />}
        <div className="space-y-3">
          {treatments?.map((t) => (
            <div key={t.id} className="border border-slate-100 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-slate-700 flex-1">
                  {t.procedure.name}
                  {t.toothRefs && <span className="text-xs text-slate-400 ml-1.5">#{t.toothRefs}</span>}
                </span>
                <span className="text-sm text-slate-500">{fmtMoney(t.cost)}</span>
                <Badge value={t.status} />
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {t.performedAt ? `Done ${fmtDate(t.performedAt)}` : `Added ${fmtDate(t.createdAt)}`}
                {t.doctor && ` · ${t.doctor.name}`}
                {t.notes && ` · ${t.notes}`}
              </div>
              {isClinical() && ['PLANNED', 'IN_PROGRESS'].includes(t.status) && (
                <div className="flex gap-2 mt-2">
                  {t.status === 'PLANNED' && (
                    <Button variant="secondary" className="text-xs" onClick={() => setStatus.mutate({ id: t.id, status: 'IN_PROGRESS' })}>Start</Button>
                  )}
                  <Button className="text-xs" onClick={() => setStatus.mutate({ id: t.id, status: 'COMPLETED' })}>
                    Complete{t.procedure.followUp ? ` → recommends ${t.procedure.followUp.name}` : ''}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Diagnoses"
        action={isClinical() && <Button variant="ghost" onClick={() => setShowDx(true)}><span className="flex items-center gap-1"><Plus size={14} />Add</span></Button>}
      >
        {!diagnoses?.length && <Empty text="No diagnoses recorded" hint="Record what you found so the system can suggest the right treatment." />}
        <div className="space-y-3">
          {diagnoses?.map((d) => (
            <div key={d.id} className="border border-slate-100 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm text-slate-700">{d.diagnosis}</span>
                <span className="text-xs text-slate-400">{fmtDate(d.createdAt)}</span>
              </div>
              {d.symptoms && <p className="text-xs text-slate-500 mt-1"><b>Symptoms:</b> {d.symptoms}</p>}
              {d.observations && <p className="text-xs text-slate-500"><b>Observations:</b> {d.observations}</p>}
              {d.notes && <p className="text-xs text-slate-500"><b>Notes:</b> {d.notes}</p>}
            </div>
          ))}
        </div>
      </Card>

      {showDx && <DiagnosisModal patientId={patientId} onClose={() => setShowDx(false)} />}
      {showTx && <TreatmentModal patientId={patientId} onClose={() => setShowTx(false)} />}
    </div>
  );
}

// ---------- Billing tab -----------------------------------------------------

interface Invoice {
  id: number;
  number: string;
  total: number;
  status: string;
  createdAt: string;
  items: { id: number; description: string; qty: number; unitPrice: number; amount: number }[];
  payments: { id: number; amount: number }[];
}
interface Payment {
  id: number;
  amount: number;
  method: string;
  paidAt: string;
  invoice?: { number: string } | null;
}

function InvoiceModal({ patientId, onClose }: { patientId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery<Record<string, string>>({ queryKey: ['settings'], queryFn: () => api('/settings') });
  const [items, setItems] = useState([{ description: '', qty: 1, unitPrice: 0 }]);
  const [discount, setDiscount] = useState(0);
  const taxPercent = Number(settings?.['billing.taxPercent'] ?? 0);
  const subtotal = items.reduce((s, it) => s + it.qty * it.unitPrice, 0);
  const tax = ((subtotal - discount) * taxPercent) / 100;

  const save = useMutation({
    mutationFn: () =>
      api('/billing/invoices', {
        body: { patientId, items: items.filter((i) => i.description), discount, taxPercent },
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });

  return (
    <Modal title="New invoice" onClose={onClose} wide>
      <table className="w-full text-sm mb-3">
        <thead>
          <tr className="text-xs text-slate-400 text-left">
            <th className="py-1">Description</th><th className="w-16">Qty</th><th className="w-28">Unit ₹</th><th className="w-24 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className="pr-2 py-1">
                <input className={inputCls} value={it.description} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              </td>
              <td className="pr-2">
                <input type="number" min={1} className={inputCls} value={it.qty} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} />
              </td>
              <td className="pr-2">
                <input type="number" className={inputCls} value={it.unitPrice} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, unitPrice: Number(e.target.value) } : x)))} />
              </td>
              <td className="text-right text-slate-600">{fmtMoney(it.qty * it.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button variant="secondary" onClick={() => setItems([...items, { description: '', qty: 1, unitPrice: 0 }])}>+ Item</Button>
      <div className="flex justify-end gap-8 mt-4 text-sm">
        <div className="space-y-1 text-right">
          <div>Subtotal: <b>{fmtMoney(subtotal)}</b></div>
          <div>
            Discount ₹:{' '}
            <input type="number" className="w-24 border border-slate-300 rounded px-2 py-0.5" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
          </div>
          <div>Tax ({taxPercent}%): {fmtMoney(tax)}</div>
          <div className="text-lg font-bold">Total: {fmtMoney(subtotal - discount + tax)}</div>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !items.some((i) => i.description)}>Create invoice</Button>
      </div>
    </Modal>
  );
}

function PaymentModal({ patientId, invoices, onClose }: { patientId: number; invoices: Invoice[]; onClose: () => void }) {
  const qc = useQueryClient();
  const openInvoices = invoices.filter((i) => ['OPEN', 'PARTIAL'].includes(i.status));
  const [form, setForm] = useState({ amount: '', method: 'CASH', invoiceId: openInvoices[0]?.id ?? 0, notes: '' });
  // Warn (don't block — advances are legitimate) if the amount exceeds what's
  // owed on the chosen invoice; a common fat-finger that inflates takings.
  const targetInvoice = openInvoices.find((i) => i.id === form.invoiceId);
  const invoiceDue = targetInvoice
    ? targetInvoice.total - targetInvoice.payments.reduce((s, p) => s + p.amount, 0)
    : 0;
  const overpaying = targetInvoice ? Number(form.amount) > invoiceDue + 0.005 : false;
  const save = useMutation({
    mutationFn: () =>
      api('/billing/payments', {
        body: {
          patientId,
          amount: Number(form.amount),
          method: form.method,
          invoiceId: form.invoiceId || undefined,
          notes: form.notes || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });
  return (
    <Modal title="Record payment" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Amount (₹) *"><input type="number" className={inputCls} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
        <Field label="Method">
          <select className={inputCls} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            {[['CASH','Cash'],['CARD','Card'],['UPI','UPI'],['BANK','Bank transfer'],['OTHER','Other']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Against invoice">
          <select className={inputCls} value={form.invoiceId} onChange={(e) => setForm({ ...form, invoiceId: Number(e.target.value) })}>
            <option value={0}>— none (advance) —</option>
            {openInvoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number} · due {fmtMoney(i.total - i.payments.reduce((s, p) => s + p.amount, 0))}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes"><input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        {overpaying && (
          <Hint tone="warn">
            This is more than the <b>{fmtMoney(invoiceDue)}</b> still due on {targetInvoice?.number}. The extra{' '}
            <b>{fmtMoney(Number(form.amount) - invoiceDue)}</b> will sit as advance credit. Recording against
            “none (advance)” instead keeps it clearer.
          </Hint>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!Number(form.amount) || save.isPending}>Record</Button>
      </div>
    </Modal>
  );
}

function BillingTab({ patientId }: { patientId: number }) {
  const [showInvoice, setShowInvoice] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const { data: invoices } = useQuery<Invoice[]>({
    queryKey: ['invoices', patientId],
    queryFn: () => api(`/billing/invoices?patientId=${patientId}`),
  });
  const { data: payments } = useQuery<Payment[]>({
    queryKey: ['payments', patientId],
    queryFn: () => api(`/billing/payments?patientId=${patientId}`),
  });

  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title="Invoices" action={<Button variant="ghost" onClick={() => setShowInvoice(true)}><span className="flex items-center gap-1"><Plus size={14} />New</span></Button>}>
        {!invoices?.length && <Empty text="No bills raised yet" hint="Create a bill once you have completed some treatment for this patient." />}
        <div className="space-y-2">
          {invoices?.map((inv) => {
            const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
            return (
              <div key={inv.id} className="flex items-center gap-3 border border-slate-100 rounded-lg p-3">
                <div className="flex-1">
                  <Link to={`/print/invoice/${inv.id}`} className="text-sm font-medium text-indigo-600 hover:underline">{inv.number}</Link>
                  <div className="text-xs text-slate-400">{fmtDate(inv.createdAt)} · {inv.items.map((i) => i.description).join(', ')}</div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-semibold text-slate-700">{fmtMoney(inv.total)}</div>
                  {paid < inv.total && inv.status !== 'VOID' && <div className="text-xs text-rose-600">due {fmtMoney(inv.total - paid)}</div>}
                </div>
                <Badge value={inv.status} />
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Payments" action={<Button variant="ghost" onClick={() => setShowPayment(true)}><span className="flex items-center gap-1"><Plus size={14} />Record</span></Button>}>
        {!payments?.length && <Empty text="No payments received yet" hint="Record a payment after the patient pays part or all of a bill." />}
        <div className="space-y-2">
          {payments?.map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
              <span className="text-sm font-semibold text-emerald-600">{fmtMoney(p.amount)}</span>
              <span className="text-xs text-slate-400">{p.method.toLowerCase()}</span>
              <span className="text-xs text-slate-400 flex-1">{p.invoice?.number ?? 'advance'}</span>
              <span className="text-xs text-slate-400">{fmtDateTime(p.paidAt)}</span>
            </div>
          ))}
        </div>
      </Card>
      {showInvoice && <InvoiceModal patientId={patientId} onClose={() => setShowInvoice(false)} />}
      {showPayment && invoices && <PaymentModal patientId={patientId} invoices={invoices} onClose={() => setShowPayment(false)} />}
    </div>
  );
}

// ---------- Documents tab ---------------------------------------------------

interface Doc {
  id: number;
  category: string;
  filename: string;
  storedPath: string;
  mimeType: string;
  notes?: string;
  createdAt: string;
  uploadedBy?: { name: string };
}

function DocumentsTab({ patientId }: { patientId: number }) {
  const qc = useQueryClient();
  const [category, setCategory] = useState('XRAY');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [viewer, setViewer] = useState<Doc | null>(null);
  const [error, setError] = useState('');
  const { data: docs } = useQuery<Doc[]>({
    queryKey: ['documents', patientId],
    queryFn: () => api(`/documents?patientId=${patientId}`),
  });

  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file!);
      fd.append('patientId', String(patientId));
      fd.append('category', category);
      fd.append('notes', notes);
      return api('/documents/upload', { formData: fd });
    },
    onSuccess: () => {
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      setNotes('');
      setError('');
      qc.invalidateQueries({ queryKey: ['documents', patientId] });
    },
    onError: (e) => setError(e.message),
  });

  const images = docs?.filter((d) => d.mimeType.startsWith('image/')) ?? [];

  return (
    <div className="space-y-4">
      {isClinical() && (
        <Card title="Upload document">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="File">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition cursor-pointer bg-white hover:bg-slate-50 text-slate-700 border border-slate-300">
                <FolderOpen size={15} />
                Choose file…
                <input
                  ref={fileInput}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </span>
            </Field>
            <span className={`text-sm py-2 max-w-52 truncate ${file ? 'text-slate-700 font-medium' : 'text-slate-400 italic'}`}>
              {file ? file.name : 'no file selected'}
            </span>
            <Field label="Category">
              <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
                {['XRAY', 'PRESCRIPTION', 'SCAN', 'LAB_REPORT', 'INSURANCE', 'CONSENT', 'OTHER'].map((c) => (
                  <option key={c} value={c}>{c.replace('_', ' ')}</option>
                ))}
              </select>
            </Field>
            <Field label="Notes"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Button onClick={() => upload.mutate()} disabled={!file || upload.isPending}>
              <span className="flex items-center gap-1.5"><ImagePlus size={15} />{upload.isPending ? 'Uploading…' : 'Upload'}</span>
            </Button>
          </div>
          {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
        </Card>
      )}

      <Card title="Consent forms">
        <p className="text-xs text-slate-400 mb-2">
          Print, have the patient sign, then upload the signed copy under the CONSENT category.
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['general', 'General treatment'],
              ['extraction', 'Extraction'],
              ['root-canal', 'Root canal'],
              ['implant', 'Implant'],
            ] as const
          ).map(([type, label]) => (
            <Link
              key={type}
              to={`/print/consent/${patientId}/${type}`}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:border-indigo-400 hover:text-indigo-600"
            >
              {label}
            </Link>
          ))}
        </div>
      </Card>

      <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-4">
        {!docs?.length && <div className="col-span-full"><Empty text="No files uploaded yet" hint="Upload X-rays, scans, lab reports or signed consent forms. JPG, PNG and PDF up to 25 MB." /></div>}
        {docs?.map((d) => (
          <div key={d.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {d.mimeType.startsWith('image/') ? (
              <button className="w-full" onClick={() => setViewer(d)}>
                <img src={`/files/${d.storedPath}`} alt={d.filename} className="w-full h-36 object-cover hover:opacity-90" />
              </button>
            ) : (
              <a href={`/files/${d.storedPath}`} target="_blank" rel="noreferrer" className="flex items-center justify-center h-36 bg-slate-50 text-slate-400 hover:text-indigo-500">
                <FileText size={40} />
              </a>
            )}
            <div className="p-3">
              <div className="flex items-center justify-between">
                <Badge value={d.category} />
                <span className="text-[11px] text-slate-400">{fmtDate(d.createdAt)}</span>
              </div>
              <div className="text-xs text-slate-600 mt-1 truncate">{d.filename}</div>
              {d.notes && <div className="text-[11px] text-slate-400 truncate">{d.notes}</div>}
            </div>
          </div>
        ))}
      </div>

      {viewer && (
        <Modal title={`${viewer.category.replace('_', ' ')} — ${viewer.filename}`} onClose={() => setViewer(null)} wide>
          <div className="flex gap-4 overflow-x-auto">
            {/* Selected image large; other images as thumbnails for comparison */}
            <a href={`/files/${viewer.storedPath}`} target="_blank" rel="noreferrer" className="flex-1" title="Open full size">
              <img src={`/files/${viewer.storedPath}`} alt={viewer.filename} className="max-h-[70vh] w-full rounded-lg cursor-zoom-in object-contain" />
            </a>
            <div className="w-32 space-y-2 shrink-0">
              {images.filter((i) => i.id !== viewer.id).map((i) => (
                <button key={i.id} onClick={() => setViewer(i)} className="block w-full">
                  <img src={`/files/${i.storedPath}`} alt={i.filename} className="rounded-md border border-slate-200 hover:border-indigo-400" />
                  <span className="text-[10px] text-slate-400">{fmtDate(i.createdAt)}</span>
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- Prescriptions tab -----------------------------------------------

interface Medicine {
  name: string;
  dose?: string;
  frequency?: string;
  duration?: string;
  notes?: string;
}

interface RxContent {
  medicines: Medicine[];
  advice?: string;
}

interface RxTemplate {
  name: string;
  content: RxContent;
  builtin?: boolean;
}

interface Rx {
  id: number;
  createdAt: string;
  doctor?: { name: string };
  content: RxContent;
}

function PrescriptionsTab({ patientId, allergies }: { patientId: number; allergies: string }) {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [allergyAck, setAllergyAck] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const { data: list } = useQuery<Rx[]>({
    queryKey: ['prescriptions', patientId],
    queryFn: () => api(`/prescriptions?patientId=${patientId}`),
  });
  const { data: templates } = useQuery<RxTemplate[]>({
    queryKey: ['rx-templates'],
    queryFn: () => api('/prescriptions/templates'),
  });
  const { data: formulary } = useQuery<Medicine[]>({
    queryKey: ['rx-formulary'],
    queryFn: () => api('/prescriptions/formulary'),
  });
  const [meds, setMeds] = useState<Medicine[]>([{ name: '' }]);
  const [advice, setAdvice] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api('/prescriptions', { body: { patientId, content: { medicines: meds.filter((m) => m.name), advice } } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescriptions', patientId] });
      setShow(false);
      setMeds([{ name: '' }]);
      setAdvice('');
      setAllergyAck(false);
    },
  });

  // Cross-check the drugs being prescribed against the patient's recorded
  // allergies. A match must be consciously acknowledged before saving.
  const allergyHits = checkAllergies(allergies, meds.map((m) => m.name));
  const blockedByAllergy = allergyHits.length > 0 && !allergyAck;

  return (
    <div className="space-y-4">
      {isClinical() && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setShowLibrary(true)}>
            <span className="flex items-center gap-1.5"><BookOpen size={15} />Rx library</span>
          </Button>
          <Button onClick={() => setShow(true)}><span className="flex items-center gap-1.5"><Pill size={15} />New prescription</span></Button>
        </div>
      )}
      {!list?.length && <Empty text="No prescriptions yet" hint="Use New prescription to write one. Pick a template to fill it in with one click." />}
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {list?.map((rx) => (
          <Card key={rx.id} title={fmtDate(rx.createdAt)} action={<Link className="text-sm text-indigo-600 hover:underline" to={`/print/prescription/${rx.id}`}>Print</Link>}>
            <ul className="text-sm text-slate-700 space-y-1">
              {rx.content.medicines?.map((m, i) => (
                <li key={i}>
                  <b>{m.name}</b>
                  <span className="text-slate-500"> {[m.dose, m.frequency, m.duration, m.notes].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
            {rx.content.advice && <p className="text-xs text-slate-500 mt-2"><b>Advice:</b> {rx.content.advice}</p>}
            {rx.doctor && <p className="text-xs text-slate-400 mt-1">{rx.doctor.name}</p>}
          </Card>
        ))}
      </div>

      {show && (
        <Modal
          title="New prescription"
          hint="Pick a template to fill everything in at once, or type the medicines yourself."
          onClose={() => setShow(false)}
          wide
          footer={
            <div className="flex justify-between items-center gap-2">
              <span className="text-sm text-slate-600">
                {meds.filter((m) => m.name).length || 'No'} medicine
                {meds.filter((m) => m.name).length === 1 ? '' : 's'} on this prescription
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setShow(false)}>Cancel</Button>
                <Button
                  size="lg"
                  onClick={() => save.mutate()}
                  disabled={!meds.some((m) => m.name) || save.isPending || blockedByAllergy}
                >
                  <Pill size={17} /> {save.isPending ? 'Saving…' : 'Save prescription'}
                </Button>
              </div>
            </div>
          }
        >
          {allergyHits.length > 0 && (
            <div className="mb-4 rounded-xl border-2 border-rose-300 bg-rose-50 p-4 animate-pop">
              <div className="flex items-start gap-3">
                <span className="bg-rose-500 text-white rounded-lg p-2 shrink-0">
                  <AlertCircle size={20} />
                </span>
                <div className="min-w-0">
                  <h4 className="font-bold text-rose-900">Allergy warning — please double-check</h4>
                  <p className="text-sm text-rose-800 mt-0.5">
                    This patient's chart records: <span className="font-semibold">“{allergies}”</span>
                  </p>
                  <ul className="mt-2 space-y-1">
                    {allergyHits.map((h) => (
                      <li key={h.medicine} className="text-sm text-rose-900">
                        <span className="font-bold">{h.medicine}</span> — {h.reason}
                      </li>
                    ))}
                  </ul>
                  <label className="flex items-center gap-2 mt-3 text-sm font-semibold text-rose-900 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-rose-600"
                      checked={allergyAck}
                      onChange={(e) => setAllergyAck(e.target.checked)}
                    />
                    I have reviewed this and want to prescribe anyway
                  </label>
                </div>
              </div>
            </div>
          )}
          <Field label="Start from a template" className="mb-4" hint="Optional — this just saves typing. You can edit anything afterwards.">
            <select
              className={inputCls}
              onChange={(e) => {
                const t = templates?.find((x) => x.name === e.target.value);
                if (t) {
                  setMeds(t.content.medicines);
                  setAdvice(t.content.advice ?? '');
                }
              }}
            >
              <option value="">Start from scratch, or pick a template…</option>
              {templates?.map((t) => <option key={t.name}>{t.name}</option>)}
            </select>
          </Field>
          <div className="space-y-3">
            {meds.map((m, i) => (
              <MedicineEditor
                key={i}
                value={m}
                index={i}
                total={meds.length}
                formulary={formulary}
                onChange={(update) => setMeds((prev) => prev.map((x, j) => (j === i ? update(x) : x)))}
                onRemove={() => setMeds((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>
          <FormularyDatalist formulary={formulary} />
          <Button variant="secondary" className="mt-3" onClick={() => setMeds([...meds, { name: '' }])}>
            <Plus size={16} /> Add another medicine
          </Button>
          <Field label="Advice for the patient" className="mt-4" hint="Printed at the bottom of the prescription.">
            <textarea
              rows={2}
              className={inputCls}
              value={advice}
              onChange={(e) => setAdvice(e.target.value)}
              placeholder="e.g. Avoid hot food for 24 hours. Come back if the pain gets worse."
            />
          </Field>
        </Modal>
      )}

      {showLibrary && <RxLibraryModal onClose={() => setShowLibrary(false)} />}
    </div>
  );
}

// ---------- Rx library (templates + medicine master) ------------------------

/**
 * Editor for the clinic's prescription library. Both lists live in Settings as
 * JSON text; built-in templates are read-only and filtered out on save.
 */
function RxLibraryModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [pane, setPane] = useState<'templates' | 'medicines'>('templates');
  const { data: templates } = useQuery<RxTemplate[]>({
    queryKey: ['rx-templates'],
    queryFn: () => api('/prescriptions/templates'),
  });
  const { data: formulary } = useQuery<Medicine[]>({
    queryKey: ['rx-formulary'],
    queryFn: () => api('/prescriptions/formulary'),
  });

  const [drafts, setDrafts] = useState<RxTemplate[] | null>(null);
  const [medDrafts, setMedDrafts] = useState<Medicine[] | null>(null);
  const [savedMsg, setSavedMsg] = useState('');
  const rows = drafts ?? templates ?? [];
  const medRows = medDrafts ?? formulary ?? [];

  // `drafts`/`medDrafts` are non-null only once that pane has unsaved edits.
  const templatesDirty = drafts !== null;
  const medicinesDirty = medDrafts !== null;

  const flash = (msg: string) => {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(''), 2500);
  };

  // Saving keeps the modal open and only clears the pane that was saved. It used
  // to call onClose(), which silently threw away unsaved edits in the other pane.
  const saveTemplates = useMutation({
    mutationFn: () => api('/prescriptions/templates', { method: 'PUT', body: { templates: rows.filter((t) => !t.builtin) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rx-templates'] }); setDrafts(null); flash('Templates saved'); },
  });
  const saveFormulary = useMutation({
    mutationFn: () => api('/prescriptions/formulary', { method: 'PUT', body: { medicines: medRows } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rx-formulary'] }); setMedDrafts(null); flash('Medicines saved'); },
  });

  // Guard the close so unsaved work is never lost without a heads-up.
  const requestClose = () => {
    if (templatesDirty || medicinesDirty) {
      const which = templatesDirty && medicinesDirty ? 'templates and medicines' : templatesDirty ? 'templates' : 'medicines';
      if (!window.confirm(`You have unsaved changes to your ${which}. Close without saving?`)) return;
    }
    onClose();
  };

  // All edits go through functional updates: rapid clicks (two dose chips in a
  // row) would otherwise race and drop the earlier one. `drafts` starts null,
  // so each updater falls back to the fetched templates.
  const patchTpl = (i: number, patch: Partial<RxTemplate>) =>
    setDrafts((prev) => (prev ?? templates ?? []).map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const updateTplMed = (ti: number, mi: number, update: (prev: Medicine) => Medicine) =>
    setDrafts((prev) =>
      (prev ?? templates ?? []).map((t, j) =>
        j === ti
          ? { ...t, content: { ...t.content, medicines: t.content.medicines.map((m, k) => (k === mi ? update(m) : m)) } }
          : t,
      ),
    );

  const tabCls = (active: boolean) =>
    `px-4 py-2.5 text-sm font-semibold rounded-xl transition ${
      active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
    }`;

  const customCount = rows.filter((t) => !t.builtin).length;

  return (
    <Modal
      title="Prescription library"
      hint="Your own templates and medicine list. Saved once, reused on every prescription."
      onClose={requestClose}
      wide
      footer={
        <div className="flex justify-between items-center gap-2">
          <span className="text-sm text-slate-600 flex items-center gap-2">
            {savedMsg && <span className="text-emerald-600 font-semibold">✓ {savedMsg}</span>}
            {!savedMsg && pane === 'templates' && (customCount === 0 ? 'No templates of your own yet' : `${customCount} template${customCount === 1 ? '' : 's'} of your own`)}
            {!savedMsg && pane === 'medicines' && `${medRows.filter((m) => m.name).length} medicine${medRows.filter((m) => m.name).length === 1 ? '' : 's'} in your list`}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={requestClose}>Close</Button>
            {pane === 'templates' ? (
              <Button size="lg" onClick={() => saveTemplates.mutate()} disabled={saveTemplates.isPending || !templatesDirty}>
                {saveTemplates.isPending ? 'Saving…' : templatesDirty ? 'Save templates' : 'Saved'}
              </Button>
            ) : (
              <Button size="lg" onClick={() => saveFormulary.mutate()} disabled={saveFormulary.isPending || !medicinesDirty}>
                {saveFormulary.isPending ? 'Saving…' : medicinesDirty ? 'Save medicines' : 'Saved'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex items-center justify-between gap-2 mb-5">
        <div className="flex gap-1.5 bg-slate-100 rounded-xl p-1.5 w-fit">
          <button className={tabCls(pane === 'templates')} onClick={() => setPane('templates')}>
            Templates {templatesDirty && <span className="text-amber-500">•</span>}
          </button>
          <button className={tabCls(pane === 'medicines')} onClick={() => setPane('medicines')}>
            My medicine list {medicinesDirty && <span className="text-amber-500">•</span>}
          </button>
        </div>
      </div>

      {/* If the OTHER pane has unsaved edits, say so — saving this one won't save that one. */}
      {((pane === 'templates' && medicinesDirty) || (pane === 'medicines' && templatesDirty)) && (
        <div className="mb-4">
          <Hint tone="warn">
            You have unsaved changes in{' '}
            <button
              className="font-semibold underline"
              onClick={() => setPane(pane === 'templates' ? 'medicines' : 'templates')}
            >
              {pane === 'templates' ? 'My medicine list' : 'Templates'}
            </button>
            . Save that tab too before closing.
          </Hint>
        </div>
      )}

      <FormularyDatalist formulary={formulary} />

      {pane === 'templates' && (
        <div className="space-y-4">
          <Hint>
            A template is a whole prescription saved under one name — pick it when writing a
            prescription and every medicine fills in at once.
          </Hint>

          {!rows.length && (
            <Empty
              text="You have not added any templates"
              hint="Templates let you fill a whole prescription with one click. Add your most common ones here."
            />
          )}

          {rows.map((t, ti) => (
            <div
              key={ti}
              className={`rounded-2xl border-2 p-4 ${t.builtin ? 'border-slate-200 bg-slate-50' : 'border-indigo-200 bg-white'}`}
            >
              {t.builtin ? (
                // Read-only: render as text, not a greyed-out form control that
                // invites a click and then does nothing.
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h4 className="font-bold text-slate-800">{t.name}</h4>
                  <span className="text-xs font-semibold text-slate-500 bg-slate-200 px-2.5 py-1 rounded-full whitespace-nowrap">
                    Ready-made — can't be changed
                  </span>
                </div>
              ) : (
                <div className="flex items-end gap-3 mb-3">
                  <div className="grow">
                    <span className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                      Template name
                    </span>
                    <input
                      className={inputCls}
                      value={t.name}
                      placeholder="e.g. After a difficult extraction"
                      onChange={(e) => patchTpl(ti, { name: e.target.value })}
                    />
                  </div>
                  <button
                    title="Delete this template"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-rose-700
                               hover:bg-rose-50 rounded-lg px-2.5 py-2.5 transition whitespace-nowrap"
                    onClick={() => setDrafts(rows.filter((_, j) => j !== ti))}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              )}

              {t.builtin ? (
                // Read-only summary — no point rendering disabled editors.
                <ul className="text-sm text-slate-600 space-y-1 pl-1">
                  {t.content.medicines.map((m, mi) => (
                    <li key={mi}>
                      <b className="text-slate-800">{m.name}</b>
                      <span className="text-slate-500"> — {describeFrequency(m.frequency, m.duration)}</span>
                      {m.notes && <span className="text-slate-500"> · {m.notes}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <div className="space-y-3">
                    {t.content.medicines.map((m, mi) => (
                      <MedicineEditor
                        key={mi}
                        value={m}
                        index={mi}
                        total={t.content.medicines.length}
                        formulary={formulary}
                        onChange={(update) => updateTplMed(ti, mi, update)}
                        onRemove={() =>
                          patchTpl(ti, {
                            content: { ...t.content, medicines: t.content.medicines.filter((_, j) => j !== mi) },
                          })
                        }
                      />
                    ))}
                  </div>
                  <Button
                    variant="secondary"
                    className="mt-3"
                    onClick={() =>
                      patchTpl(ti, { content: { ...t.content, medicines: [...t.content.medicines, { name: '' }] } })
                    }
                  >
                    <Plus size={16} /> Add another medicine
                  </Button>
                </>
              )}

              {t.builtin ? (
                t.content.advice && (
                  <p className="text-sm text-slate-600 mt-3 pt-3 border-t border-slate-200">
                    <span className="font-semibold text-slate-700">Advice:</span> {t.content.advice}
                  </p>
                )
              ) : (
                <Field label="Advice for the patient" className="mt-4">
                  <textarea
                    rows={2}
                    className={inputCls}
                    placeholder="e.g. Avoid hot food for 24 hours."
                    value={t.content.advice ?? ''}
                    onChange={(e) => patchTpl(ti, { content: { ...t.content, advice: e.target.value } })}
                  />
                </Field>
              )}
            </div>
          ))}

          <Button
            variant="secondary"
            size="lg"
            onClick={() =>
              setDrafts([...rows, { name: '', content: { medicines: [{ name: '' }] }, builtin: false }])
            }
          >
            <Plus size={17} /> Add a template
          </Button>
        </div>
      )}

      {pane === 'medicines' && (
        <div className="space-y-3">
          <Hint>
            These are the medicines you prescribe often. They autocomplete as you type a
            prescription, and fill in the dose you set here.
          </Hint>

          {!medRows.length && (
            <Empty
              text="No medicines in your list"
              hint="Add the medicines you prescribe often so they autocomplete as you type."
            />
          )}

          {medRows.map((m, i) => (
            <MedicineEditor
              key={i}
              value={m}
              index={i}
              total={medRows.length + 1 /* never block removal here */}
              onChange={(update) =>
                setMedDrafts((prev) => (prev ?? formulary ?? []).map((x, j) => (j === i ? update(x) : x)))
              }
              onRemove={() => setMedDrafts((prev) => (prev ?? formulary ?? []).filter((_, j) => j !== i))}
            />
          ))}

          <Button variant="secondary" size="lg" onClick={() => setMedDrafts([...medRows, { name: '' }])}>
            <Plus size={17} /> Add a medicine
          </Button>
        </div>
      )}
    </Modal>
  );
}

// ---------- Messages tab ----------------------------------------------------

interface Msg {
  id: number;
  channel: string;
  kind: string;
  body: string;
  status: string;
  response?: string;
  createdAt: string;
}

function MessagesTab({ patientId }: { patientId: number }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const { data: messages } = useQuery<Msg[]>({
    queryKey: ['messages', patientId],
    queryFn: () => api(`/messages?patientId=${patientId}`),
  });
  const send = useMutation({
    mutationFn: () => api('/messages/send', { body: { patientId, body: text } }),
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: ['messages', patientId] });
    },
  });
  const reply = useMutation({
    mutationFn: ({ id, response }: { id: number; response: string }) =>
      api(`/messages/${id}/reply`, { body: { response } }),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <Card title="WhatsApp / SMS log">
      <div className="flex gap-2 mb-4">
        <input className={inputCls} placeholder="Send a message to this patient…" value={text} onChange={(e) => setText(e.target.value)} />
        <Button onClick={() => send.mutate()} disabled={!text || send.isPending}>
          <span className="flex items-center gap-1.5"><MessageSquare size={15} />Send</span>
        </Button>
      </div>
      {!messages?.length && <Empty text="No messages yet" hint="Reminders sent to this patient will appear here, along with anything they reply." />}
      <div className="space-y-3">
        {messages?.map((m) => (
          <div key={m.id} className="border border-slate-100 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Badge value={m.channel} />
              <span className="text-xs text-slate-400">{m.kind.replace(/_/g, ' ').toLowerCase()}</span>
              <span className="text-xs text-slate-400 flex-1">{fmtDateTime(m.createdAt)}</span>
              <Badge value={m.status} />
            </div>
            <p className="text-sm text-slate-600 whitespace-pre-line">{m.body}</p>
            {m.response ? (
              <p className="text-xs mt-2 text-emerald-700 bg-emerald-50 inline-block px-2 py-1 rounded">Reply: {m.response}</p>
            ) : (
              m.status === 'SENT' && (
                <div className="flex gap-2 mt-3 flex-wrap items-center">
                  <span className="text-xs text-slate-500 font-medium">If they replied by phone, record it:</span>
                  {[
                    ['YES', 'Coming', 'hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700'],
                    ['NO', 'Not coming', 'hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700'],
                    ['RESCHEDULE', 'Wants another day', 'hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700'],
                  ].map(([code, label, hover]) => (
                    <button
                      key={code}
                      onClick={() => reply.mutate({ id: m.id, response: code })}
                      className={`text-xs font-semibold border-2 border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-600 transition ${hover}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------- Page ------------------------------------------------------------

const TABS = ['Timeline', 'Dental Chart', 'Clinical', 'Plans & Lab', 'Billing', 'Documents', 'Prescriptions', 'Messages'] as const;
/** Doctor-only tabs — hidden from the assistant's front-desk view. */
const CLINICAL_TABS: (typeof TABS)[number][] = ['Dental Chart', 'Clinical', 'Plans & Lab'];

/** Shown under the tab bar and as a tooltip — one plain sentence per tab. */
const TAB_HINTS: Record<(typeof TABS)[number], string> = {
  Timeline: 'Everything that has ever happened with this patient, newest first.',
  'Dental Chart': 'The tooth map. Click any tooth to record what you found.',
  Clinical: 'Diagnoses you have made and treatments you have carried out.',
  'Plans & Lab': 'Treatment plans you have proposed, and work sent to the dental lab.',
  Billing: 'Bills raised for this patient and payments they have made.',
  Documents: 'X-rays, scans, reports and signed consent forms.',
  Prescriptions: 'Medicines prescribed. Use the Rx library to manage your templates.',
  Messages: 'Every WhatsApp and SMS sent to this patient, and their replies.',
};

export default function PatientDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const patientId = Number(id);
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Timeline');
  const [editing, setEditing] = useState(false);
  // Assistants handle front-desk work only — the clinical record (tooth map,
  // diagnoses/treatments, treatment plans & lab) is for the doctor.
  const visibleTabs = TABS.filter((t) => isClinical() || !CLINICAL_TABS.includes(t));
  const [booking, setBooking] = useState<{ followUpId?: number; procedureName?: string; defaultDoctorId?: number } | null>(
    location.state?.openReschedule ? { followUpId: location.state.openReschedule, defaultDoctorId: location.state.rescheduleDocId } : null
  );
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [resText, setResText] = useState('');

  const { data: patient, isLoading } = useQuery<Patient>({
    queryKey: ['patient', patientId],
    queryFn: () => api(`/patients/${patientId}`),
  });
  const { data: summary } = useQuery<Summary>({
    queryKey: ['patient-summary', patientId],
    queryFn: () => api(`/patients/${patientId}/summary`),
  });

  const setFollowUpStatus = useMutation({
    mutationFn: async ({ id, status, resolution }: { id: number; status: string; resolution?: string }) => {
      await api(`/followups/${id}/status`, { method: 'PUT', body: { status, resolution } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patient-summary', patientId] }),
  });


  if (isLoading || !patient) return <Spinner />;

  const mh = patient.medicalHistory as Record<string, unknown>;
  const flags = [
    mh.diabetes && 'Diabetes',
    mh.bloodPressure && 'BP',
    mh.heartConditions && 'Heart',
    mh.smoking && 'Smoker',
    mh.pregnancy && 'Pregnancy',
    mh.allergies && `Allergy: ${mh.allergies}`,
  ].filter(Boolean) as string[];

  const age = patient.dob
    ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / (365.25 * 86400_000))
    : null;

  return (
    <div className="space-y-4">
      {/* Patient identity banner — always visible so you never lose track of
          whose record is open. */}
      <div className="rounded-2xl bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-600 p-5 shadow-lg animate-rise">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-64">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="bg-white/20 backdrop-blur rounded-xl p-2.5 text-white">
                <UserRound size={24} />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-2xl font-bold text-white tracking-tight">{patient.name}</h1>
                  <span className="font-mono text-xs text-white/70 bg-white/15 px-2 py-0.5 rounded-full">{patient.code}</span>
                  {!patient.active && (
                    <span className="text-[11px] font-bold uppercase bg-slate-800/40 text-white px-2 py-0.5 rounded-full">
                      Archived{patient.inactiveReason ? ` · ${patient.inactiveReason.toLowerCase().replace(/_/g, ' ')}` : ''}
                    </span>
                  )}
                  <button
                    onClick={() => setEditing(true)}
                    title="Edit this patient's details"
                    className="text-white/70 hover:text-white hover:bg-white/20 rounded-lg p-1.5 transition"
                  >
                    <Pencil size={15} />
                  </button>
                </div>
                <div className="text-sm text-white/85 mt-0.5">
                  {[age !== null ? `${age} years old` : null, patient.gender?.toLowerCase(), patient.phone, patient.email]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </div>
            {flags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                <span className="text-xs font-bold text-white/90 py-1">⚠ Careful:</span>
                {flags.map((f) => (
                  <span
                    key={f}
                    className="text-xs font-bold bg-rose-500 text-white px-2.5 py-1 rounded-full flex items-center gap-1 shadow-sm"
                  >
                    <AlertCircle size={12} /> {f}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-3 items-start">
            {summary && summary.outstanding > 0 && (
              <div className="bg-white/95 rounded-xl px-4 py-2.5 text-center shadow-sm">
                <div className="text-[11px] font-bold text-rose-500 uppercase tracking-wide">Owes you</div>
                <div className="text-xl font-extrabold text-rose-600">{fmtMoney(summary.outstanding)}</div>
              </div>
            )}
            {summary?.nextAppointment && (
              <div className="bg-white/95 rounded-xl px-4 py-2.5 text-center shadow-sm">
                <div className="text-[11px] font-bold text-blue-500 uppercase tracking-wide">Next visit</div>
                <div className="text-sm font-bold text-blue-700 mt-1">{fmtDateTime(summary.nextAppointment.startsAt)}</div>
              </div>
            )}
            <button
              onClick={() => setBooking({})}
              className="inline-flex items-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur text-white
                         font-semibold rounded-xl px-4 py-2.5 text-sm transition active:scale-[0.97]"
            >
              <CalendarPlus size={17} /> Book a visit
            </button>
          </div>
        </div>
        {summary && summary.pendingFollowUps.length > 0 && (
          <div className="mt-4 bg-white/95 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 shadow-sm">
            <span className="text-sm font-bold text-amber-800">What this patient needs next:</span>
            {summary.pendingFollowUps.map((f) => (
              <span key={f.id} className="text-sm text-slate-700 flex items-center gap-2">
                <span>
                  {f.procedure?.name ?? 'A review'} <span className="text-slate-500">(due {fmtDate(f.dueDate)})</span>
                </span>
                <button
                  className="text-white bg-blue-600 hover:bg-blue-700 font-semibold px-2.5 py-1 rounded-lg text-xs transition"
                  onClick={() => setBooking({ followUpId: f.id, procedureName: f.procedure?.name })}
                >
                  Book it now
                </button>
                <button
                  onClick={() => {
                    setResolvingId(f.id);
                    setResText('');
                  }}
                  className="text-slate-500 hover:text-emerald-600 font-semibold px-2 py-1 rounded-lg text-xs transition bg-slate-100 hover:bg-emerald-50"
                  title="Mark as done"
                >
                  Mark done
                </button>
                {resolvingId === f.id && (
                  <div className="flex items-center gap-2 ml-2 bg-slate-50 rounded px-2 py-1 border border-slate-200">
                    <input
                      type="text"
                      autoFocus
                      placeholder="Resolution note..."
                      className="text-xs bg-transparent outline-none w-48 border-b border-slate-300 focus:border-indigo-500 transition-colors py-0.5"
                      value={resText}
                      onChange={e => setResText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          setFollowUpStatus.mutate({ id: f.id, status: 'DONE', resolution: resText });
                          setResolvingId(null);
                        } else if (e.key === 'Escape') setResolvingId(null);
                      }}
                    />
                    <button
                      onClick={() => {
                        setFollowUpStatus.mutate({ id: f.id, status: 'DONE', resolution: resText });
                        setResolvingId(null);
                      }}
                      className="text-[10px] font-bold bg-indigo-600 text-white px-2 py-0.5 rounded hover:bg-indigo-700 transition"
                    >
                      Save
                    </button>
                    <button onClick={() => setResolvingId(null)} className="text-[10px] font-bold text-slate-500 hover:text-slate-700">Cancel</button>
                  </div>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-1.5 flex-wrap no-print bg-white rounded-2xl border border-slate-200/80 shadow-sm p-1.5">
        {visibleTabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            title={TAB_HINTS[t]}
            className={`px-4 py-2.5 text-sm font-semibold rounded-xl transition ${
              tab === t
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <p className="text-sm text-slate-500 -mt-2 px-1 no-print">{TAB_HINTS[tab]}</p>

      {tab === 'Timeline' && <Card><Timeline patientId={patientId} /></Card>}
      {tab === 'Dental Chart' && <DentalChart patientId={patientId} />}
      {tab === 'Clinical' && <ClinicalTab patientId={patientId} />}
      {tab === 'Plans & Lab' && <PlansLab patientId={patientId} />}
      {tab === 'Billing' && <BillingTab patientId={patientId} />}
      {tab === 'Documents' && <DocumentsTab patientId={patientId} />}
      {tab === 'Prescriptions' && (
        <PrescriptionsTab patientId={patientId} allergies={String(mh.allergies ?? '')} />
      )}
      {tab === 'Messages' && <MessagesTab patientId={patientId} />}

      {editing && (
        <PatientForm
          initial={patient}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            qc.invalidateQueries({ queryKey: ['patient', patientId] });
          }}
        />
      )}
      {booking && (
        <BookAppointmentModal
          patientId={patientId}
          patientName={patient?.name}
          followUpId={typeof booking === 'object' ? booking.followUpId : undefined}
          procedureName={typeof booking === 'object' ? booking.procedureName : undefined}
          defaultDoctorId={typeof booking === 'object' ? booking.doctorId : undefined}
          onClose={() => {
            if (location.state?.openReschedule) {
              navigate(`/patients/${patientId}`, { replace: true });
            } else {
              setBooking(null);
            }
          }}
        />
      )}
    </div>
  );
}

export function BookAppointmentModal({
  patientId,
  patientName,
  followUpId,
  procedureName,
  defaultDoctorId,
  onClose,
}: {
  patientId: number;
  patientName?: string;
  followUpId?: number;
  procedureName?: string;
  defaultDoctorId?: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const user = getUser();
  const [doctorId, setDoctorId] = useState<number | ''>(defaultDoctorId || (user?.role === 'DOCTOR' ? user.id : ''));
  const { data: users } = useQuery<{ id: number; name: string; role: string; active: boolean }[]>({ queryKey: ['users'], queryFn: () => api('/users') });
  const doctors = users?.filter(u => u.role === 'DOCTOR' && u.active) || [];
  const [form, setForm] = useState({
    date: new Date(Date.now() + 86400_000).toISOString().slice(0, 10),
    time: '10:00',
    durationMin: 30,
    type: followUpId ? 'FOLLOW_UP' : 'CONSULTATION',
    notes: procedureName ?? '',
  });
  const { data: followUps } = useQuery<any[]>({ 
    queryKey: ['followups', patientId], 
    queryFn: () => api(`/followups?patientId=${patientId}&status=PENDING`) 
  });
  const [mismatchPrompt, setMismatchPrompt] = useState<{task: any, oldDoc: string, newDoc: string} | null>(null);
  
  const { data: settings } = useQuery<Record<string, string>>({ queryKey: ['settings'], queryFn: () => api('/settings') });
  const intervalStr = settings?.['appointments.interval'];
  const interval = intervalStr ? parseInt(intervalStr, 10) : 5;
  const safeInterval = isNaN(interval) || interval <= 0 ? 5 : interval;
  
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
  const startsAtIso = `${form.date}T${form.time}:00`;
  const slot = useSlotChecks(startsAtIso, form.durationMin, doctorId, patientId);
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: (vars?: { closeMismatchFollowUpId?: number }) =>
      api('/appointments', {
        body: {
          patientId,
          doctorId: Number(doctorId),
          startsAt: new Date(startsAtIso).toISOString(),
          durationMin: form.durationMin,
          type: form.type,
          notes: form.notes || undefined,
          followUpId,
          closeMismatchFollowUpId: vars?.closeMismatchFollowUpId,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  const handleBookClick = () => {
    if (!followUpId && followUps?.length) {
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
    save.mutate();
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
    <Modal
      title={procedureName ? `Book: ${procedureName}` : `Book appointment${patientName ? ` for ${patientName}` : ''}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleBookClick} disabled={!doctorId || save.isPending}>
            {slot.clash || slot.inPast ? 'Book anyway' : 'Book'}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label="Time">
          <select className={inputCls} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}>
            {timeOptions.length > 0 ? (
              timeOptions.map((t) => <option key={t} value={t}>{t}</option>)
            ) : (
              <option value="" disabled>No slots (Closed?)</option>
            )}
          </select>
        </Field>
        <Field label="Duration (min)">
          <select className={inputCls} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })}>
            {[15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="CONSULTATION">Consultation</option>
            <option value="FOLLOW_UP">Follow-up</option>
            <option value="PROCEDURE">Treatment</option>
            <option value="EMERGENCY">Emergency</option>
          </select>
        </Field>
      </div>

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

      <label className="flex items-center gap-2 text-sm text-slate-600 mt-3 mb-2 cursor-pointer">
        <input type="checkbox" checked={ignoreWH} onChange={(e) => setIgnoreWH(e.target.checked)} />
        Show all times (book outside working hours)
      </label>

      <Field label="Notes" hint="Optional">
        <input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Needs X-ray" />
      </Field>
      <SlotWarnings slot={slot} />
      {error && <Hint tone="warn">{error}</Hint>}
    </Modal>
  );
}

/* ---------- Shared slot validation (clash + past date) --------------------- */

interface SlotState {
  clash: { patientName: string | null; startsAt: string } | null;
  inPast: boolean;
}

/** Live-checks a proposed slot against the server for overlaps, plus past-date. */
export function useSlotChecks(startsAtIso: string, durationMin: number, doctorId?: number | '', patientId?: number, excludeId?: number): SlotState {
  const start = new Date(startsAtIso);
  const valid = !Number.isNaN(start.getTime());
  const inPast = valid && start.getTime() < Date.now();

  const { data } = useQuery<{ clash: SlotState['clash'] }>({
    queryKey: ['appt-clash', startsAtIso, durationMin, doctorId, patientId, excludeId],
    queryFn: () => {
      const q = new URLSearchParams({ startsAt: startsAtIso, durationMin: durationMin.toString() });
      if (doctorId) q.set('doctorId', doctorId.toString());
      if (patientId) q.set('patientId', patientId.toString());
      if (excludeId) q.set('excludeId', excludeId.toString());
      return api(`/appointments/clash?${q.toString()}`);
    },
    enabled: valid,
  });

  return { clash: data?.clash ?? null, inPast };
}

export function SlotWarnings({ slot }: { slot: SlotState }) {
  if (!slot.clash && !slot.inPast) return null;
  return (
    <div className="mt-3 space-y-2">
      {slot.clash && (
        <Hint tone="warn">
          <span className="font-semibold">That time is already taken</span> — overlaps{' '}
          {slot.clash.patientName ?? 'another appointment'} at {fmtDateTime(slot.clash.startsAt)}. You can still
          book if you double-book on purpose.
        </Hint>
      )}
      {slot.inPast && (
        <Hint tone="warn">
          <span className="font-semibold">This time is in the past.</span> Check the date if you meant to book a
          future visit.
        </Hint>
      )}
    </div>
  );
}
