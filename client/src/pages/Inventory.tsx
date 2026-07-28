import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Package, Plus } from 'lucide-react';
import { api, fmtDate, fmtMoney, getUser } from '../api';
import { Badge, Button, Empty, Field, inputCls, Modal, PageHeader, Spinner } from '../components/ui';

const canManage = () => ['DOCTOR', 'ADMIN'].includes(getUser()?.role ?? '');

interface Item {
  id: number;
  name: string;
  category: string;
  unit: string;
  stockQty: number;
  reorderLevel: number;
  costPerUnit: number;
  expiryDate?: string;
  active: boolean;
  low: boolean;
}

interface Txn {
  id: number;
  delta: number;
  reason: string;
  note?: string;
  createdAt: string;
  createdBy?: { name: string };
}

const CATEGORIES = ['CONSUMABLE', 'MEDICINE', 'INSTRUMENT', 'LAB_MATERIAL', 'OTHER'];

function ItemModal({ initial, onClose }: { initial?: Item; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    category: initial?.category ?? 'CONSUMABLE',
    unit: initial?.unit ?? 'pcs',
    stockQty: '0',
    reorderLevel: String(initial?.reorderLevel ?? 0),
    costPerUnit: String(initial?.costPerUnit ?? 0),
    expiryDate: initial?.expiryDate ? initial.expiryDate.slice(0, 10) : '',
    active: initial?.active ?? true,
  });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        category: form.category,
        unit: form.unit,
        reorderLevel: Number(form.reorderLevel) || 0,
        costPerUnit: Number(form.costPerUnit) || 0,
        expiryDate: form.expiryDate || undefined,
        active: form.active,
        ...(initial ? {} : { stockQty: Number(form.stockQty) || 0 }),
      };
      return initial
        ? api(`/inventory/${initial.id}`, { method: 'PUT', body })
        : api('/inventory', { body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'New inventory item'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name *" className="col-span-2"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Category">
          <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
        </Field>
        <Field label="Unit"><input className={inputCls} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="pcs / box / kg" /></Field>
        {!initial && (
          <Field label="Opening stock"><input type="number" className={inputCls} value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} /></Field>
        )}
        <Field label="Reorder level"><input type="number" className={inputCls} value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} /></Field>
        <Field label="Cost per unit (₹)"><input type="number" className={inputCls} value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: e.target.value })} /></Field>
        <Field label="Expiry date"><input type="date" className={inputCls} value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></Field>
        {initial && (
          <label className="flex items-center gap-2 text-sm text-slate-600 col-span-2">
            <input type="checkbox" className="rounded" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active (unchecked items are hidden from the list)
          </label>
        )}
      </div>
      {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!form.name || save.isPending}>Save</Button>
      </div>
    </Modal>
  );
}

function AdjustModal({ item, direction, onClose }: { item: Item; direction: 1 | -1; onClose: () => void }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api(`/inventory/${item.id}/adjust`, {
        body: { delta: direction * Math.abs(Number(qty)), note: note || undefined },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title={`${direction > 0 ? 'Receive' : 'Use'} — ${item.name}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Quantity (${item.unit}) *`}><input type="number" min={0} className={inputCls} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Note"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <p className="text-xs text-slate-400 mt-2">Current stock: {item.stockQty} {item.unit}</p>
      {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!Number(qty) || save.isPending}>
          {direction > 0 ? 'Add to stock' : 'Deduct from stock'}
        </Button>
      </div>
    </Modal>
  );
}

export default function Inventory() {
  const [showItem, setShowItem] = useState<{ initial?: Item } | null>(null);
  const [adjusting, setAdjusting] = useState<{ item: Item; direction: 1 | -1 } | null>(null);
  const [history, setHistory] = useState<Item | null>(null);

  const { data: items, isLoading } = useQuery<Item[]>({
    queryKey: ['inventory'],
    queryFn: () => api('/inventory'),
  });
  const { data: txns } = useQuery<Txn[]>({
    queryKey: ['inventory-txns', history?.id],
    queryFn: () => api(`/inventory/${history!.id}/txns`),
    enabled: !!history,
  });

  const lowCount = items?.filter((i) => i.low).length ?? 0;

  return (
    <div>
      <PageHeader
        icon={Package}
        title="Stock"
        subtitle={
          lowCount > 0
            ? `${lowCount} ${lowCount === 1 ? 'item is' : 'items are'} running low — time to reorder.`
            : 'Materials and supplies you keep in the clinic. Everything is well stocked.'
        }
        actions={
          canManage() && (
            <button
              onClick={() => setShowItem({})}
              className="inline-flex items-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur text-white
                         font-semibold rounded-xl px-4 py-2.5 text-sm transition active:scale-[0.97]"
            >
              <Plus size={17} /> Add an item
            </button>
          )
        }
      />

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden animate-rise">
        {isLoading && <Spinner label="Counting the stock…" />}
        {items && items.length === 0 && (
          <Empty
            icon={Package}
            text="Nothing in stock yet"
            hint="Add the things you use up — gloves, anaesthetic, composite — and the system will warn you before you run out."
            action={
              canManage() ? (
                <Button size="lg" onClick={() => setShowItem({})}><Plus size={17} /> Add your first item</Button>
              ) : undefined
            }
          />
        )}
        {items && items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">In stock</th>
                <th className="px-4 py-3 text-right">Reorder at</th>
                <th className="px-4 py-3 text-right">Unit cost</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className={`border-b border-slate-50 ${i.low ? 'bg-rose-50/40' : ''}`}>
                  <td className="px-4 py-3">
                    <button onClick={() => setHistory(i)} className="font-medium text-slate-700 hover:text-indigo-600 text-left">
                      {i.name}
                    </button>
                    {i.expiryDate && <div className="text-[11px] text-slate-400">expires {fmtDate(i.expiryDate)}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{i.category.replace('_', ' ').toLowerCase()}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${i.low ? 'text-rose-600' : 'text-slate-700'}`}>
                    {i.stockQty} <span className="text-xs font-normal text-slate-400">{i.unit}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">{i.reorderLevel}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{fmtMoney(i.costPerUnit)}</td>
                  <td className="px-4 py-3">{i.low ? <Badge value="LOW STOCK" /> : <Badge value="OK" />}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button title="Receive stock" onClick={() => setAdjusting({ item: i, direction: 1 })} className="p-1.5 rounded-lg border border-slate-200 text-emerald-600 hover:bg-emerald-50"><Plus size={14} /></button>
                      <button title="Use stock" onClick={() => setAdjusting({ item: i, direction: -1 })} className="p-1.5 rounded-lg border border-slate-200 text-rose-600 hover:bg-rose-50"><Minus size={14} /></button>
                      {canManage() && (
                        <button onClick={() => setShowItem({ initial: i })} className="text-xs text-indigo-600 hover:underline px-1">edit</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showItem && <ItemModal initial={showItem.initial} onClose={() => setShowItem(null)} />}
      {adjusting && <AdjustModal item={adjusting.item} direction={adjusting.direction} onClose={() => setAdjusting(null)} />}
      {history && (
        <Modal title={`Stock history — ${history.name}`} onClose={() => setHistory(null)}>
          {!txns?.length && <Empty text="No transactions" />}
          <div className="space-y-1.5">
            {txns?.map((t) => (
              <div key={t.id} className="flex items-center gap-3 text-sm py-1 border-b border-slate-50 last:border-0">
                <span className={`font-semibold w-16 ${t.delta > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {t.delta > 0 ? '+' : ''}{t.delta}
                </span>
                <span className="text-xs text-slate-500 w-20">{t.reason.toLowerCase()}</span>
                <span className="text-xs text-slate-400 flex-1">{t.note}{t.createdBy && ` · ${t.createdBy.name}`}</span>
                <span className="text-xs text-slate-400">{fmtDate(t.createdAt)}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
