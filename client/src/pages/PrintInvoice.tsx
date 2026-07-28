import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate, fmtMoney } from '../api';
import { Button, Spinner } from '../components/ui';

interface InvoiceFull {
  id: number;
  number: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  pending: number;
  status: string;
  createdAt: string;
  items: { id: number; description: string; qty: number; unitPrice: number; amount: number }[];
  payments: { id: number; amount: number; method: string; paidAt: string }[];
  patient: { id: number; name: string; code: string; phone: string; address?: string };
}

export default function PrintInvoice() {
  const { id } = useParams();
  const { data: inv, isLoading } = useQuery<InvoiceFull>({
    queryKey: ['invoice', id],
    queryFn: () => api(`/billing/invoices/${id}`),
  });
  const { data: settings } = useQuery<Record<string, string>>({ queryKey: ['settings'], queryFn: () => api('/settings') });

  if (isLoading || !inv) return <Spinner />;

  return (
    <div className="max-w-2xl mx-auto p-8 bg-white min-h-screen">
      <div className="no-print flex justify-between mb-6">
        <Link to={`/patients/${inv.patient.id}`} className="text-sm text-indigo-600 hover:underline">← Back to patient</Link>
        <Button onClick={() => window.print()}>Print / Save PDF</Button>
      </div>

      <div className="border-b-2 border-slate-800 pb-4 mb-6">
        <h1 className="text-2xl font-bold text-slate-800">{settings?.['clinic.name'] ?? 'Clinic'}</h1>
        <p className="text-sm text-slate-500">{settings?.['clinic.address']} · {settings?.['clinic.phone']}</p>
      </div>

      <div className="flex justify-between mb-6">
        <div>
          <div className="text-xs uppercase text-slate-400 font-bold">Billed to</div>
          <div className="font-semibold text-slate-800">{inv.patient.name}</div>
          <div className="text-sm text-slate-500">{inv.patient.code} · {inv.patient.phone}</div>
          {inv.patient.address && <div className="text-sm text-slate-500">{inv.patient.address}</div>}
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-slate-800">{inv.number}</div>
          <div className="text-sm text-slate-500">{fmtDate(inv.createdAt)}</div>
          <div className={`text-sm font-bold mt-1 ${inv.pending > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {inv.status}
          </div>
        </div>
      </div>

      <table className="w-full text-sm mb-6">
        <thead>
          <tr className="border-b-2 border-slate-200 text-left text-xs uppercase text-slate-400">
            <th className="py-2">Description</th>
            <th className="text-center">Qty</th>
            <th className="text-right">Unit price</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((it) => (
            <tr key={it.id} className="border-b border-slate-100">
              <td className="py-2.5 text-slate-700">{it.description}</td>
              <td className="text-center text-slate-500">{it.qty}</td>
              <td className="text-right text-slate-500">{fmtMoney(it.unitPrice)}</td>
              <td className="text-right text-slate-700">{fmtMoney(it.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end mb-8">
        <div className="w-64 space-y-1.5 text-sm">
          <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{fmtMoney(inv.subtotal)}</span></div>
          {inv.discount > 0 && <div className="flex justify-between text-slate-500"><span>Discount</span><span>−{fmtMoney(inv.discount)}</span></div>}
          {inv.tax > 0 && <div className="flex justify-between text-slate-500"><span>Tax</span><span>{fmtMoney(inv.tax)}</span></div>}
          <div className="flex justify-between font-bold text-slate-800 border-t border-slate-200 pt-1.5"><span>Total</span><span>{fmtMoney(inv.total)}</span></div>
          <div className="flex justify-between text-emerald-600"><span>Paid</span><span>{fmtMoney(inv.paid)}</span></div>
          {inv.pending > 0 && <div className="flex justify-between font-bold text-rose-600"><span>Balance due</span><span>{fmtMoney(inv.pending)}</span></div>}
        </div>
      </div>

      {inv.payments.length > 0 && (
        <div className="text-sm">
          <div className="text-xs uppercase text-slate-400 font-bold mb-2">Payment history</div>
          {inv.payments.map((p) => (
            <div key={p.id} className="flex justify-between border-b border-slate-50 py-1 text-slate-600">
              <span>{fmtDate(p.paidAt)} · {p.method.toLowerCase()}</span>
              <span>{fmtMoney(p.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400 mt-10 text-center">Thank you for visiting {settings?.['clinic.name'] ?? 'our clinic'}.</p>
    </div>
  );
}
