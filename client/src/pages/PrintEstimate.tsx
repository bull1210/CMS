import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate, fmtMoney } from '../api';
import { Button, Spinner } from '../components/ui';

interface PlanFull {
  id: number;
  title: string;
  status: string;
  notes?: string;
  createdAt: string;
  doctor?: { name: string };
  patient: { id: number; name: string; code: string; phone: string; address?: string };
  items: { id: number; toothRefs?: string; phase: number; cost: number; notes?: string; procedure: { name: string } }[];
}

export default function PrintEstimate() {
  const { id } = useParams();
  const { data: plan, isLoading } = useQuery<PlanFull>({
    queryKey: ['plan', id],
    queryFn: () => api(`/plans/${id}`),
  });
  const { data: settings } = useQuery<Record<string, string>>({ queryKey: ['settings'], queryFn: () => api('/settings') });

  if (isLoading || !plan) return <Spinner />;

  const total = plan.items.reduce((s, i) => s + i.cost, 0);
  const phases = [...new Set(plan.items.map((i) => i.phase))].sort((a, b) => a - b);

  return (
    <div className="max-w-2xl mx-auto p-8 bg-white min-h-screen">
      <div className="no-print flex justify-between mb-6">
        <Link to={`/patients/${plan.patient.id}`} className="text-sm text-indigo-600 hover:underline">← Back to patient</Link>
        <Button onClick={() => window.print()}>Print / Save PDF</Button>
      </div>

      <div className="border-b-2 border-slate-800 pb-4 mb-6">
        <h1 className="text-2xl font-bold text-slate-800">{settings?.['clinic.name'] ?? 'Clinic'}</h1>
        <p className="text-sm text-slate-500">{settings?.['clinic.address']} · {settings?.['clinic.phone']}</p>
      </div>

      <div className="flex justify-between mb-6">
        <div>
          <div className="text-xs uppercase text-slate-400 font-bold">Treatment estimate for</div>
          <div className="font-semibold text-slate-800">{plan.patient.name}</div>
          <div className="text-sm text-slate-500">{plan.patient.code} · {plan.patient.phone}</div>
          {plan.patient.address && <div className="text-sm text-slate-500">{plan.patient.address}</div>}
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-slate-800">{plan.title}</div>
          <div className="text-sm text-slate-500">{fmtDate(plan.createdAt)}</div>
          {plan.doctor && <div className="text-sm text-slate-500">{plan.doctor.name}</div>}
        </div>
      </div>

      <table className="w-full text-sm mb-6">
        <thead>
          <tr className="border-b-2 border-slate-200 text-left text-xs uppercase text-slate-400">
            <th className="py-2">Procedure</th>
            <th className="text-center">Tooth</th>
            <th className="text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {phases.map((phase) => (
            <Fragment key={phase}>
              {phases.length > 1 && (
                <tr>
                  <td colSpan={3} className="pt-3 pb-1 text-xs font-bold uppercase text-slate-500">Phase {phase}</td>
                </tr>
              )}
              {plan.items.filter((i) => i.phase === phase).map((i) => (
                <tr key={i.id} className="border-b border-slate-100">
                  <td className="py-2.5 text-slate-700">
                    {i.procedure.name}
                    {i.notes && <span className="text-xs text-slate-400 ml-2">{i.notes}</span>}
                  </td>
                  <td className="text-center text-slate-500">{i.toothRefs ?? '—'}</td>
                  <td className="text-right text-slate-700">{fmtMoney(i.cost)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end mb-8">
        <div className="w-64 text-sm">
          <div className="flex justify-between font-bold text-slate-800 border-t-2 border-slate-300 pt-2 text-base">
            <span>Estimated total</span><span>{fmtMoney(total)}</span>
          </div>
        </div>
      </div>

      {plan.notes && <p className="text-sm text-slate-600 mb-6"><b>Notes:</b> {plan.notes}</p>}

      <p className="text-xs text-slate-500 mb-10">
        This is an estimate, not an invoice. Final charges may vary with clinical findings during treatment.
        Valid for 30 days from the date above.
      </p>

      <div className="grid grid-cols-2 gap-12 mt-16 text-sm text-slate-600">
        <div className="border-t border-slate-400 pt-2">
          Patient signature (acceptance)
          <div className="text-xs text-slate-400 mt-1">Date: ____________</div>
        </div>
        <div className="border-t border-slate-400 pt-2">
          {plan.doctor?.name ?? settings?.['clinic.doctor'] ?? 'Doctor'}
          <div className="text-xs text-slate-400 mt-1">Signature & seal</div>
        </div>
      </div>
    </div>
  );
}
