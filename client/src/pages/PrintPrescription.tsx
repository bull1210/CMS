import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { Button, Spinner } from '../components/ui';

interface RxFull {
  id: number;
  createdAt: string;
  content: { medicines: { name: string; dose?: string; frequency?: string; duration?: string; notes?: string }[]; advice?: string };
  doctor?: { name: string };
  patient: { id: number; name: string; code: string; dob?: string; gender?: string };
}

export default function PrintPrescription() {
  const { id } = useParams();
  const { data: rx, isLoading } = useQuery<RxFull>({
    queryKey: ['prescription', id],
    queryFn: () => api(`/prescriptions/${id}`),
  });
  const { data: settings } = useQuery<Record<string, string>>({ queryKey: ['settings'], queryFn: () => api('/settings') });

  if (isLoading || !rx) return <Spinner />;

  const age = rx.patient.dob
    ? `${Math.floor((Date.now() - new Date(rx.patient.dob).getTime()) / (365.25 * 86400_000))} yrs`
    : null;

  return (
    <div className="max-w-2xl mx-auto p-8 bg-white min-h-screen">
      <div className="no-print flex justify-between mb-6">
        <Link to={`/patients/${rx.patient.id}`} className="text-sm text-indigo-600 hover:underline">← Back to patient</Link>
        <Button onClick={() => window.print()}>Print / Save PDF</Button>
      </div>

      <div className="border-b-2 border-slate-800 pb-4 mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{settings?.['clinic.name'] ?? 'Clinic'}</h1>
          <p className="text-sm text-slate-500">{settings?.['clinic.address']} · {settings?.['clinic.phone']}</p>
        </div>
        <div className="text-right text-sm text-slate-500">
          <div className="font-semibold text-slate-700">{rx.doctor?.name}</div>
          <div>{fmtDate(rx.createdAt)}</div>
        </div>
      </div>

      <div className="mb-6 text-sm text-slate-600">
        <b className="text-slate-800">{rx.patient.name}</b> · {rx.patient.code}
        {age && ` · ${age}`}
        {rx.patient.gender && ` · ${rx.patient.gender.toLowerCase()}`}
      </div>

      <div className="text-4xl font-serif text-slate-300 mb-4">℞</div>

      <table className="w-full text-sm mb-8">
        <thead>
          <tr className="border-b-2 border-slate-200 text-left text-xs uppercase text-slate-400">
            <th className="py-2">Medicine</th><th>Frequency</th><th>Duration</th><th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rx.content.medicines?.map((m, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="py-2.5 font-medium text-slate-700">{m.name}{m.dose ? ` ${m.dose}` : ''}</td>
              <td className="text-slate-500">{m.frequency ?? '—'}</td>
              <td className="text-slate-500">{m.duration ?? '—'}</td>
              <td className="text-slate-500">{m.notes ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {rx.content.advice && (
        <div className="text-sm text-slate-600 mb-12">
          <div className="text-xs uppercase text-slate-400 font-bold mb-1">Advice</div>
          {rx.content.advice}
        </div>
      )}

      <div className="mt-16 text-right">
        <div className="inline-block border-t border-slate-300 pt-1 px-6 text-sm text-slate-500">
          {rx.doctor?.name ?? 'Doctor'} — Signature
        </div>
      </div>
    </div>
  );
}
