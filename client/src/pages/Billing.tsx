import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, FileText, IndianRupee, Receipt, Users } from 'lucide-react';
import { api, fmtDate, fmtMoney } from '../api';
import { Badge, Card, Empty, PageHeader, Spinner, Stat } from '../components/ui';

interface OutstandingRow {
  patientId: number;
  billed: number;
  paid: number;
  outstanding: number;
  patient?: { id: number; name: string; code: string; phone: string };
}
interface Invoice {
  id: number;
  number: string;
  total: number;
  status: string;
  createdAt: string;
  patient: { id: number; name: string; code: string };
  payments: { amount: number }[];
}

export default function Billing() {
  const { data: outstanding, isLoading } = useQuery<OutstandingRow[]>({
    queryKey: ['outstanding'],
    queryFn: () => api('/billing/outstanding'),
  });
  const { data: invoices } = useQuery<Invoice[]>({
    queryKey: ['invoices-all'],
    queryFn: () => api('/billing/invoices'),
  });

  if (isLoading) return <Spinner label="Adding up the money…" />;
  const totalDue = outstanding?.reduce((s, r) => s + r.outstanding, 0) ?? 0;

  return (
    <div>
      <PageHeader
        icon={IndianRupee}
        title="Billing"
        subtitle="Who still owes you money, and every bill you've raised. Bills are created from a patient's record."
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <Stat
          label="Patients who owe money"
          value={outstanding?.length ?? 0}
          icon={Users}
          tone={outstanding?.length ? 'warn' : 'success'}
        />
        <Stat
          label="Total still to collect"
          value={fmtMoney(totalDue)}
          sub="Across all unpaid bills"
          icon={AlertTriangle}
          tone={totalDue > 0 ? 'danger' : 'success'}
        />
        <Stat label="Bills raised" value={invoices?.length ?? 0} icon={Receipt} />
      </div>

      <div className="space-y-4">
        <Card
          icon={AlertTriangle}
          tone={outstanding?.length ? 'warn' : undefined}
          title="Money still to collect"
          hint="Patients whose bills are not fully paid. Click a name to open their record and add a payment."
        >
          {!outstanding?.length ? (
            <Empty celebrate text="Everyone has paid up!" hint="There are no unpaid bills right now." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">
                  <th className="py-2.5 px-3 font-bold">Patient</th>
                  <th className="font-bold">Phone</th>
                  <th className="text-right font-bold">Total billed</th>
                  <th className="text-right font-bold">Paid so far</th>
                  <th className="text-right font-bold px-3">Still owes</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.map((r) => (
                  <tr key={r.patientId} className="border-b border-slate-50 last:border-0 hover:bg-emerald-50/50 transition">
                    <td className="py-3 px-3">
                      <Link to={`/patients/${r.patientId}`} className="font-semibold text-slate-800 hover:text-emerald-700">
                        {r.patient?.name ?? `#${r.patientId}`}
                      </Link>
                      <span className="text-xs text-slate-500 ml-2">{r.patient?.code}</span>
                    </td>
                    <td className="text-slate-600">{r.patient?.phone}</td>
                    <td className="text-right text-slate-600">{fmtMoney(r.billed)}</td>
                    <td className="text-right text-emerald-600 font-medium">{fmtMoney(r.paid)}</td>
                    <td className="text-right font-bold text-rose-600 px-3">{fmtMoney(r.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card
          icon={FileText}
          title="Recent bills"
          hint="The last 20 bills. Click a bill number to open a printable copy."
        >
          {!invoices?.length ? (
            <Empty
              icon={Receipt}
              text="No bills yet"
              hint="Open a patient's record and use the Billing tab to raise their first bill."
            />
          ) : (
            <div className="space-y-1">
              {invoices.slice(0, 20).map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-lg hover:bg-slate-50 transition border-b border-slate-50 last:border-0 text-sm"
                >
                  <Link to={`/print/invoice/${inv.id}`} className="font-semibold text-emerald-700 hover:underline w-32 shrink-0">
                    {inv.number}
                  </Link>
                  <Link to={`/patients/${inv.patient.id}`} className="flex-1 text-slate-800 hover:text-emerald-700 font-medium truncate">
                    {inv.patient.name}
                  </Link>
                  <span className="text-slate-500 text-xs hidden sm:inline">{fmtDate(inv.createdAt)}</span>
                  <span className="font-bold text-slate-800 w-24 text-right">{fmtMoney(inv.total)}</span>
                  <Badge value={inv.status} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
