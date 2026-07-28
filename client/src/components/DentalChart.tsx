import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fmtDate, getUser } from '../api';
import { Badge, Button, Card, Empty, Field, inputCls, Spinner } from './ui';

const isClinical = () => ['DOCTOR', 'ADMIN'].includes(getUser()?.role ?? '');

export interface ToothFinding {
  id: number;
  tooth: string;
  condition: string;
  status: string;
  note?: string;
  createdAt: string;
  resolvedAt?: string;
  createdBy?: { name: string };
}

interface ChartTreatment {
  id: number;
  status: string;
  toothRefs?: string;
  performedAt?: string;
  createdAt: string;
  procedure: { name: string };
}

// Paint priority: structural states first, then pathology, then restorations.
const CONDITION_ORDER = ['MISSING', 'IMPLANT', 'ROOT_CANAL', 'CROWN', 'FRACTURED', 'CARIES', 'FILLED', 'OTHER'];

const CONDITION_STYLES: Record<string, { fill: string; chip: string; label: string }> = {
  CARIES: { fill: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 border-rose-200', label: 'Caries' },
  FILLED: { fill: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Filled' },
  MISSING: { fill: 'bg-slate-300', chip: 'bg-slate-100 text-slate-500 border-slate-200', label: 'Missing' },
  CROWN: { fill: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Crown' },
  ROOT_CANAL: { fill: 'bg-purple-500', chip: 'bg-purple-50 text-purple-700 border-purple-200', label: 'Root canal' },
  IMPLANT: { fill: 'bg-teal-500', chip: 'bg-teal-50 text-teal-700 border-teal-200', label: 'Implant' },
  FRACTURED: { fill: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700 border-orange-200', label: 'Fractured' },
  OTHER: { fill: 'bg-slate-500', chip: 'bg-slate-100 text-slate-600 border-slate-200', label: 'Other' },
};

// FDI arches, patient's right to left as conventionally charted.
const PERMANENT = {
  upper: ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'],
  lower: ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'],
};
const PRIMARY = {
  upper: ['55', '54', '53', '52', '51', '61', '62', '63', '64', '65'],
  lower: ['85', '84', '83', '82', '81', '71', '72', '73', '74', '75'],
};

function toothHasRef(refs: string | undefined, tooth: string) {
  return (refs ?? '')
    .split(',')
    .map((s) => s.trim())
    .includes(tooth);
}

function Tooth({
  tooth,
  findings,
  selected,
  onClick,
}: {
  tooth: string;
  findings: ToothFinding[];
  selected: boolean;
  onClick: () => void;
}) {
  const active = findings.filter((f) => f.status === 'ACTIVE');
  const top = CONDITION_ORDER.find((c) => active.some((f) => f.condition === c));
  const missing = top === 'MISSING';
  return (
    <button
      onClick={onClick}
      title={active.length ? active.map((f) => `${CONDITION_STYLES[f.condition]?.label ?? f.condition}`).join(', ') : 'Healthy'}
      className={`w-9 shrink-0 flex flex-col items-center gap-0.5 group`}
    >
      <span
        className={`w-7 h-9 rounded-md border-2 transition flex items-center justify-center ${
          selected ? 'border-indigo-600 ring-2 ring-indigo-200' : 'border-slate-300 group-hover:border-indigo-400'
        } ${top ? CONDITION_STYLES[top].fill : 'bg-white'} ${missing ? 'opacity-50' : ''}`}
      >
        {missing && <span className="text-white font-bold text-sm">✕</span>}
        {!missing && active.length > 1 && (
          <span className="text-[9px] font-bold text-white bg-slate-900/40 rounded-full px-1">{active.length}</span>
        )}
      </span>
      <span className={`text-[10px] font-semibold ${selected ? 'text-indigo-600' : 'text-slate-500'}`}>{tooth}</span>
    </button>
  );
}

export default function DentalChart({ patientId }: { patientId: number }) {
  const qc = useQueryClient();
  const [dentition, setDentition] = useState<'permanent' | 'primary'>('permanent');
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState({ condition: 'CARIES', note: '' });

  const { data: findings, isLoading } = useQuery<ToothFinding[]>({
    queryKey: ['tooth-findings', patientId],
    queryFn: () => api(`/tooth-findings?patientId=${patientId}`),
  });
  const { data: treatments } = useQuery<ChartTreatment[]>({
    queryKey: ['treatments', patientId],
    queryFn: () => api(`/treatments?patientId=${patientId}`),
  });

  const add = useMutation({
    mutationFn: () =>
      api('/tooth-findings', {
        body: { patientId, tooth: selected, condition: form.condition, note: form.note || undefined },
      }),
    onSuccess: () => {
      setForm({ condition: 'CARIES', note: '' });
      qc.invalidateQueries({ queryKey: ['tooth-findings', patientId] });
      qc.invalidateQueries({ queryKey: ['timeline', patientId] });
    },
  });
  const resolve = useMutation({
    mutationFn: (id: number) => api(`/tooth-findings/${id}`, { method: 'PUT', body: { status: 'RESOLVED' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tooth-findings', patientId] }),
  });

  if (isLoading) return <Spinner />;

  const arch = dentition === 'permanent' ? PERMANENT : PRIMARY;
  const byTooth = (tooth: string) => findings?.filter((f) => f.tooth === tooth) ?? [];
  const selectedFindings = selected ? byTooth(selected) : [];
  const selectedTreatments = selected ? (treatments ?? []).filter((t) => toothHasRef(t.toothRefs, selected)) : [];

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <Card
        title="Dental chart (FDI)"
        className="lg:col-span-2"
        action={
          <div className="flex gap-1 text-xs">
            {(['permanent', 'primary'] as const).map((d) => (
              <button
                key={d}
                onClick={() => {
                  setDentition(d);
                  setSelected(null);
                }}
                className={`px-2.5 py-1 rounded-full font-medium ${
                  dentition === d ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {d === 'permanent' ? 'Adult' : 'Primary'}
              </button>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto pb-2">
          <div className="min-w-fit space-y-1">
            <div className="flex justify-center gap-0.5">
              {arch.upper.map((t) => (
                <Tooth key={t} tooth={t} findings={byTooth(t)} selected={selected === t} onClick={() => setSelected(t === selected ? null : t)} />
              ))}
            </div>
            <div className="border-t border-dashed border-slate-300 mx-8" />
            <div className="flex justify-center gap-0.5">
              {arch.lower.map((t) => (
                <Tooth key={t} tooth={t} findings={byTooth(t)} selected={selected === t} onClick={() => setSelected(t === selected ? null : t)} />
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-slate-100">
          {CONDITION_ORDER.map((c) => (
            <span key={c} className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className={`w-3 h-3 rounded ${CONDITION_STYLES[c].fill}`} />
              {CONDITION_STYLES[c].label}
            </span>
          ))}
        </div>
      </Card>

      <Card title={selected ? `Tooth ${selected}` : 'Select a tooth'}>
        {!selected && <Empty text="Click a tooth to view or chart findings" />}
        {selected && (
          <div className="space-y-4">
            {isClinical() && (
              <div className="space-y-2 pb-3 border-b border-slate-100">
                <Field label="Add finding">
                  <select className={inputCls} value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                    {CONDITION_ORDER.map((c) => (
                      <option key={c} value={c}>{CONDITION_STYLES[c].label}</option>
                    ))}
                  </select>
                </Field>
                <input className={inputCls} placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                <Button onClick={() => add.mutate()} disabled={add.isPending} className="w-full">
                  Chart on tooth {selected}
                </Button>
              </div>
            )}

            <div>
              <div className="text-xs font-bold text-slate-400 uppercase mb-2">Findings</div>
              {!selectedFindings.length && <p className="text-sm text-slate-400">Nothing charted</p>}
              <div className="space-y-2">
                {selectedFindings.map((f) => (
                  <div key={f.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${CONDITION_STYLES[f.condition]?.chip ?? ''}`}>
                        {CONDITION_STYLES[f.condition]?.label ?? f.condition}
                      </span>
                      {f.status === 'RESOLVED' && <Badge value="DONE" />}
                      <span className="text-xs text-slate-400 flex-1">{fmtDate(f.createdAt)}</span>
                      {isClinical() && f.status === 'ACTIVE' && (
                        <button onClick={() => resolve.mutate(f.id)} className="text-[11px] text-indigo-600 hover:underline">
                          resolve
                        </button>
                      )}
                    </div>
                    {f.note && <p className="text-xs text-slate-500 mt-0.5">{f.note}</p>}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-bold text-slate-400 uppercase mb-2">Treatments on this tooth</div>
              {!selectedTreatments.length && <p className="text-sm text-slate-400">None recorded</p>}
              <div className="space-y-1.5">
                {selectedTreatments.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 text-slate-700">{t.procedure.name}</span>
                    <span className="text-xs text-slate-400">{fmtDate(t.performedAt ?? t.createdAt)}</span>
                    <Badge value={t.status} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
