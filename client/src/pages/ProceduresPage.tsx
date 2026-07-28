import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ClipboardList, Pencil, Plus } from 'lucide-react';
import { api, fmtMoney, getUser } from '../api';
import { Badge, Button, Empty, Field, inputCls, Modal, PageHeader, Spinner } from '../components/ui';

interface Procedure {
  id: number;
  name: string;
  description?: string;
  cost: number;
  followUpId?: number | null;
  followUp?: { id: number; name: string } | null;
  followUpDays?: number | null;
  active: boolean;
}

function ProcedureModal({ initial, all, onClose }: { initial?: Procedure; all: Procedure[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    cost: initial?.cost ?? 0,
    followUpId: initial?.followUpId ?? 0,
    followUpDays: initial?.followUpDays ?? 14,
    active: initial?.active ?? true,
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        followUpId: form.followUpId || null,
        followUpDays: form.followUpId ? form.followUpDays : null,
      };
      return initial
        ? api(`/procedures/${initial.id}`, { method: 'PUT', body })
        : api('/procedures', { body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['procedures'] });
      onClose();
    },
  });
  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'New procedure'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name *"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Description"><input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Cost (₹)"><input type="number" className={inputCls} value={form.cost} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Recommended follow-up">
            <select className={inputCls} value={form.followUpId} onChange={(e) => setForm({ ...form, followUpId: Number(e.target.value) })}>
              <option value={0}>— none —</option>
              {all.filter((p) => p.id !== initial?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Suggested after (days)">
            <input type="number" className={inputCls} value={form.followUpDays} disabled={!form.followUpId} onChange={(e) => setForm({ ...form, followUpDays: Number(e.target.value) })} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active
        </label>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!form.name || save.isPending}>Save</Button>
      </div>
    </Modal>
  );
}

export default function ProceduresPage() {
  const canEdit = ['DOCTOR', 'ADMIN'].includes(getUser()?.role ?? '');
  const [editing, setEditing] = useState<Procedure | 'new' | null>(null);
  const { data, isLoading } = useQuery<Procedure[]>({ queryKey: ['procedures'], queryFn: () => api('/procedures') });

  return (
    <div>
      <PageHeader
        icon={ClipboardList}
        title="Treatments you offer"
        subtitle="Your price list. Each treatment can also suggest what usually comes next, so nothing is forgotten."
        actions={
          canEdit && (
            <button
              onClick={() => setEditing('new')}
              className="inline-flex items-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur text-white
                         font-semibold rounded-xl px-4 py-2.5 text-sm transition active:scale-[0.97]"
            >
              <Plus size={17} /> Add a treatment
            </button>
          )
        }
      />
      {isLoading && <Spinner label="Loading treatments…" />}
      {data && data.length === 0 && (
        <Empty
          icon={ClipboardList}
          text="No treatments set up yet"
          hint="Add the treatments you offer and what you charge. You'll pick from this list when treating patients and raising bills."
          action={canEdit ? <Button size="lg" onClick={() => setEditing('new')}><Plus size={17} /> Add your first treatment</Button> : undefined}
        />
      )}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden animate-rise">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="px-4 py-3">Procedure</th>
              <th className="px-4 py-3">Cost</th>
              <th className="px-4 py-3">Treatment flow</th>
              <th className="px-4 py-3">Status</th>
              {canEdit && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {data?.map((p) => (
              <tr key={p.id} className="border-b border-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-700">{p.name}</div>
                  {p.description && <div className="text-xs text-slate-400">{p.description}</div>}
                </td>
                <td className="px-4 py-3 text-slate-600">{fmtMoney(p.cost)}</td>
                <td className="px-4 py-3">
                  {p.followUp ? (
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <ArrowRight size={14} className="text-indigo-400" />
                      {p.followUp.name}
                      <span className="text-xs text-slate-400">after {p.followUpDays ?? 14}d</span>
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3"><Badge value={p.active ? 'ACTIVE' : 'INACTIVE'} /></td>
                {canEdit && (
                  <td className="px-4 py-3 text-right">
                    <button className="text-slate-400 hover:text-indigo-600" onClick={() => setEditing(p)}><Pencil size={15} /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && data && (
        <ProcedureModal initial={editing === 'new' ? undefined : editing} all={data} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
