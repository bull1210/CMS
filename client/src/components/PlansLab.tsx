import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FlaskConical, Plus } from 'lucide-react';
import { api, fmtDate, fmtMoney, getUser } from '../api';
import { Badge, Button, Card, Empty, Field, inputCls, Modal } from './ui';

const isClinical = () => ['DOCTOR', 'ADMIN'].includes(getUser()?.role ?? '');

interface ProcedureRef {
  id: number;
  name: string;
  cost: number;
  active: boolean;
}

interface Plan {
  id: number;
  title: string;
  status: string;
  notes?: string;
  createdAt: string;
  decidedAt?: string;
  doctor?: { name: string };
  items: { id: number; toothRefs?: string; phase: number; cost: number; notes?: string; procedure: { name: string } }[];
}

interface LabWork {
  id: number;
  labName: string;
  workType: string;
  toothRefs?: string;
  shade?: string;
  sentAt: string;
  dueAt?: string;
  receivedAt?: string;
  status: string;
  cost: number;
  notes?: string;
}

const WORK_TYPES = ['CROWN', 'BRIDGE', 'DENTURE', 'ALIGNER', 'IMPLANT_PART', 'OTHER'];
const LAB_NEXT: Record<string, string[]> = {
  SENT: ['RECEIVED', 'CANCELLED'],
  RECEIVED: ['FITTED', 'REDO'],
  REDO: ['RECEIVED', 'CANCELLED'],
};

function NewPlanModal({ patientId, onClose }: { patientId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: procedures } = useQuery<ProcedureRef[]>({ queryKey: ['procedures'], queryFn: () => api('/procedures') });
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ procedureId: 0, toothRefs: '', phase: 1, cost: 0 }]);
  const setItem = (i: number, patch: Partial<(typeof items)[number]>) =>
    setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = useMutation({
    mutationFn: () =>
      api('/plans', {
        body: {
          patientId,
          title,
          notes: notes || undefined,
          items: items
            .filter((i) => i.procedureId)
            .map((i) => ({ ...i, toothRefs: i.toothRefs || undefined })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });

  const total = items.reduce((s, i) => s + (i.procedureId ? i.cost : 0), 0);

  return (
    <Modal title="New treatment plan" onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Field label="Plan title *"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Full mouth rehabilitation" /></Field>
        <Field label="Notes"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <table className="w-full text-sm mb-2">
        <thead>
          <tr className="text-xs text-slate-400 text-left">
            <th className="py-1">Procedure</th><th className="w-24">Tooth</th><th className="w-16">Phase</th><th className="w-28">Cost ₹</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className="pr-2 py-1">
                <select
                  className={inputCls}
                  value={it.procedureId}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    const proc = procedures?.find((p) => p.id === id);
                    setItem(i, { procedureId: id, cost: proc?.cost ?? it.cost });
                  }}
                >
                  <option value={0}>Choose a treatment…</option>
                  {procedures?.filter((p) => p.active).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </td>
              <td className="pr-2"><input className={inputCls} value={it.toothRefs} onChange={(e) => setItem(i, { toothRefs: e.target.value })} placeholder="16" /></td>
              <td className="pr-2"><input type="number" min={1} className={inputCls} value={it.phase} onChange={(e) => setItem(i, { phase: Number(e.target.value) || 1 })} /></td>
              <td><input type="number" className={inputCls} value={it.cost} onChange={(e) => setItem(i, { cost: Number(e.target.value) || 0 })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => setItems([...items, { procedureId: 0, toothRefs: '', phase: 1, cost: 0 }])}>+ Procedure</Button>
        <span className="text-sm font-bold text-slate-700">Estimate: {fmtMoney(total)}</span>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!title || !items.some((i) => i.procedureId) || save.isPending}>
          Save plan
        </Button>
      </div>
    </Modal>
  );
}

function NewLabWorkModal({ patientId, onClose }: { patientId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    labName: '',
    workType: 'CROWN',
    toothRefs: '',
    shade: '',
    dueAt: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
    cost: '',
    notes: '',
  });
  const save = useMutation({
    mutationFn: () =>
      api('/labworks', {
        body: {
          patientId,
          labName: form.labName,
          workType: form.workType,
          toothRefs: form.toothRefs || undefined,
          shade: form.shade || undefined,
          dueAt: form.dueAt || undefined,
          cost: form.cost === '' ? undefined : Number(form.cost),
          notes: form.notes || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });
  return (
    <Modal title="Send work to lab" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Lab name *"><input className={inputCls} value={form.labName} onChange={(e) => setForm({ ...form, labName: e.target.value })} /></Field>
        <Field label="Work type">
          <select className={inputCls} value={form.workType} onChange={(e) => setForm({ ...form, workType: e.target.value })}>
            {WORK_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </Field>
        <Field label="Tooth (FDI)"><input className={inputCls} value={form.toothRefs} onChange={(e) => setForm({ ...form, toothRefs: e.target.value })} placeholder="16" /></Field>
        <Field label="Shade"><input className={inputCls} value={form.shade} onChange={(e) => setForm({ ...form, shade: e.target.value })} placeholder="A2" /></Field>
        <Field label="Expected by"><input type="date" className={inputCls} value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></Field>
        <Field label="Lab cost (₹)"><input type="number" className={inputCls} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
        <Field label="Notes" className="col-span-2"><input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!form.labName || save.isPending}>Save</Button>
      </div>
    </Modal>
  );
}

export default function PlansLab({ patientId }: { patientId: number }) {
  const qc = useQueryClient();
  const [showPlan, setShowPlan] = useState(false);
  const [showLab, setShowLab] = useState(false);

  const { data: plans } = useQuery<Plan[]>({
    queryKey: ['plans', patientId],
    queryFn: () => api(`/plans?patientId=${patientId}`),
  });
  const { data: labWorks } = useQuery<LabWork[]>({
    queryKey: ['labworks', patientId],
    queryFn: () => api(`/labworks?patientId=${patientId}`),
  });

  const setPlanStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api(`/plans/${id}/status`, { method: 'PUT', body: { status } }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const setLabStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api(`/labworks/${id}`, { method: 'PUT', body: { status } }),
    onSuccess: () => qc.invalidateQueries(),
  });

  const now = new Date();

  return (
    <div className="space-y-6">
      <Card
        title="Treatment plans & estimates"
        action={isClinical() && (
          <Button variant="ghost" onClick={() => setShowPlan(true)}>
            <span className="flex items-center gap-1"><Plus size={14} />New plan</span>
          </Button>
        )}
      >
        {!plans?.length && <Empty text="No treatment plans" />}
        <div className="space-y-4">
          {plans?.map((plan) => {
            const total = plan.items.reduce((s, i) => s + i.cost, 0);
            const phases = [...new Set(plan.items.map((i) => i.phase))].sort((a, b) => a - b);
            return (
              <div key={plan.id} className="border border-slate-100 rounded-lg p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="font-semibold text-sm text-slate-700 flex-1">{plan.title}</span>
                  <span className="text-sm font-bold text-slate-700">{fmtMoney(total)}</span>
                  <Badge value={plan.status} />
                </div>
                {phases.map((phase) => (
                  <div key={phase} className="mb-1.5">
                    {phases.length > 1 && <div className="text-[11px] font-bold text-slate-400 uppercase">Phase {phase}</div>}
                    {plan.items.filter((i) => i.phase === phase).map((i) => (
                      <div key={i.id} className="flex items-center gap-2 text-sm py-0.5">
                        <span className="flex-1 text-slate-600">
                          {i.procedure.name}
                          {i.toothRefs && <span className="text-xs text-slate-400 ml-1">#{i.toothRefs}</span>}
                        </span>
                        <span className="text-slate-500">{fmtMoney(i.cost)}</span>
                      </div>
                    ))}
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-slate-50">
                  <span className="text-xs text-slate-400 flex-1">
                    {fmtDate(plan.createdAt)}{plan.doctor && ` · ${plan.doctor.name}`}{plan.notes && ` · ${plan.notes}`}
                  </span>
                  <Link to={`/print/estimate/${plan.id}`} className="text-xs text-indigo-600 hover:underline font-medium">
                    Print estimate
                  </Link>
                  {isClinical() && plan.status === 'PROPOSED' && (
                    <>
                      <Button className="text-xs" onClick={() => setPlanStatus.mutate({ id: plan.id, status: 'ACCEPTED' })}>
                        Patient accepted → create treatments
                      </Button>
                      <Button variant="secondary" className="text-xs" onClick={() => setPlanStatus.mutate({ id: plan.id, status: 'CANCELLED' })}>
                        Cancel
                      </Button>
                    </>
                  )}
                  {isClinical() && plan.status === 'ACCEPTED' && (
                    <Button variant="secondary" className="text-xs" onClick={() => setPlanStatus.mutate({ id: plan.id, status: 'COMPLETED' })}>
                      Mark completed
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        title="Lab work"
        action={isClinical() && (
          <Button variant="ghost" onClick={() => setShowLab(true)}>
            <span className="flex items-center gap-1"><FlaskConical size={14} />Send to lab</span>
          </Button>
        )}
      >
        {!labWorks?.length && <Empty text="No lab work" />}
        <div className="space-y-2">
          {labWorks?.map((lw) => {
            const overdue = lw.dueAt && ['SENT', 'REDO'].includes(lw.status) && new Date(lw.dueAt) < now;
            return (
              <div key={lw.id} className={`border rounded-lg p-3 ${overdue ? 'border-rose-200 bg-rose-50/40' : 'border-slate-100'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-700 flex-1">
                    {lw.workType.replace('_', ' ').toLowerCase()}
                    {lw.toothRefs && <span className="text-xs text-slate-400 ml-1">#{lw.toothRefs}</span>}
                    <span className="text-xs text-slate-400 ml-2">→ {lw.labName}</span>
                  </span>
                  {lw.cost > 0 && <span className="text-xs text-slate-500">{fmtMoney(lw.cost)}</span>}
                  <Badge value={lw.status} />
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <span className="text-xs text-slate-400 flex-1">
                    Sent {fmtDate(lw.sentAt)}
                    {lw.dueAt && (
                      <span className={overdue ? 'text-rose-600 font-semibold' : ''}> · expected {fmtDate(lw.dueAt)}{overdue ? ' (overdue)' : ''}</span>
                    )}
                    {lw.shade && ` · shade ${lw.shade}`}
                    {lw.notes && ` · ${lw.notes}`}
                  </span>
                  {isClinical() && LAB_NEXT[lw.status]?.map((s) => (
                    <button
                      key={s}
                      onClick={() => setLabStatus.mutate({ id: lw.id, status: s })}
                      className="text-[11px] border border-slate-200 rounded px-2 py-0.5 hover:bg-slate-50 text-slate-600"
                    >
                      {s.toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {showPlan && <NewPlanModal patientId={patientId} onClose={() => setShowPlan(false)} />}
      {showLab && <NewLabWorkModal patientId={patientId} onClose={() => setShowLab(false)} />}
    </div>
  );
}
