import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, TrendingDown, TrendingUp, Trash2, Wallet } from 'lucide-react';
import { api, fmtDate, fmtMoney, getUser } from '../api';
import { Button, ConfirmDialog, Empty, Field, inputCls, Modal, PageHeader, Spinner, Stat } from '../components/ui';

interface Expense {
  id: number;
  date: string;
  category: string;
  description: string;
  amount: number;
  method: string;
  createdBy?: { name: string };
}

interface ExpensesData {
  items: Expense[];
  total: number;
}

interface Pnl {
  revenue: number;
  expenses: number;
  net: number;
  byCategory: { category: string; amount: number }[];
}

const CATEGORIES = ['RENT', 'SALARY', 'LAB', 'MATERIALS', 'EQUIPMENT', 'UTILITIES', 'MARKETING', 'OTHER'];

function ExpenseModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    category: 'MATERIALS',
    description: '',
    amount: '',
    method: 'CASH',
  });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api('/expenses', {
        body: { ...form, amount: Number(form.amount) },
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title="Record expense" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label="Category">
          <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
        </Field>
        <Field label="Description *" className="col-span-2"><input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Amount (₹) *"><input type="number" className={inputCls} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
        <Field label="Paid via">
          <select className={inputCls} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            {[['CASH','Cash'],['CARD','Card'],['UPI','UPI'],['BANK','Bank transfer'],['OTHER','Other']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </div>
      {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!form.description || !Number(form.amount) || save.isPending}>Save</Button>
      </div>
    </Modal>
  );
}

export default function Expenses() {
  const qc = useQueryClient();
  const isAdmin = getUser()?.role === 'ADMIN';
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [show, setShow] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null);
  const qs = `?from=${from}&to=${to}T23:59:59`;

  const { data, isLoading } = useQuery<ExpensesData>({ queryKey: ['expenses', qs], queryFn: () => api(`/expenses${qs}`) });
  const { data: pnl } = useQuery<Pnl>({ queryKey: ['pnl', qs], queryFn: () => api(`/reports/pnl${qs}`) });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/expenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <div>
      <PageHeader
        icon={Wallet}
        title="Expenses"
        subtitle="Money going out — rent, salaries, lab bills, materials. Compare it against what you collected."
        actions={
          <button
            onClick={() => setShow(true)}
            className="inline-flex items-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur text-white
                       font-semibold rounded-xl px-4 py-2.5 text-sm transition active:scale-[0.97]"
          >
            <Plus size={17} /> Record an expense
          </button>
        }
      />

      <div className="flex items-center gap-2 text-sm mb-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm px-4 py-3 w-fit">
        <span className="font-semibold text-slate-700">Showing</span>
        <input type="date" className={`${inputCls} w-auto`} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-slate-500 font-medium">to</span>
        <input type="date" className={`${inputCls} w-auto`} value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
        <Stat label="Money collected" value={fmtMoney(pnl?.revenue)} icon={TrendingUp} tone="success" />
        <Stat label="Money spent" value={fmtMoney(pnl?.expenses)} icon={TrendingDown} tone="danger" />
        <Stat
          label={(pnl?.net ?? 0) >= 0 ? 'Profit' : 'Loss'}
          value={fmtMoney(pnl?.net)}
          sub="Collected minus spent"
          icon={Wallet}
          tone={(pnl?.net ?? 0) >= 0 ? 'success' : 'danger'}
        />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden animate-rise">
        {isLoading && <Spinner label="Adding up expenses…" />}
        {data && data.items.length === 0 && (
          <Empty
            icon={Wallet}
            text="No expenses in these dates"
            hint="Nothing was recorded between the two dates above. Try a wider range, or record an expense."
            action={<Button size="lg" onClick={() => setShow(true)}><Plus size={17} /> Record an expense</Button>}
          />
        )}
        {data && data.items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Via</th>
                <th className="px-4 py-3 text-right">Amount</th>
                {isAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id} className="border-b border-slate-50">
                  <td className="px-4 py-3 text-slate-500">{fmtDate(e.date)}</td>
                  <td className="px-4 py-3 text-slate-600">{e.category.replace('_', ' ').toLowerCase()}</td>
                  <td className="px-4 py-3 text-slate-700">{e.description}</td>
                  <td className="px-4 py-3 text-slate-500">{e.method.toLowerCase()}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-700">{fmtMoney(e.amount)}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setConfirmDelete(e)}
                        className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg p-1.5 transition"
                        title="Delete this expense"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200">
                <td colSpan={4} className="px-4 py-3 text-right text-xs uppercase font-bold text-slate-400">Total</td>
                <td className="px-4 py-3 text-right font-bold text-slate-800">{fmtMoney(data.total)}</td>
                {isAdmin && <td />}
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {show && <ExpenseModal onClose={() => setShow(false)} />}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this expense?"
          message={`“${confirmDelete.description}” for ${fmtMoney(confirmDelete.amount)} will be permanently removed. This cannot be undone.`}
          confirmLabel="Yes, delete it"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            remove.mutate(confirmDelete.id);
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}
