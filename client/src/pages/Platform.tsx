import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Power } from 'lucide-react';
import { api, fmtDate } from '../api';
import { Badge, Button, Card, ConfirmDialog, Empty, Field, Modal, PageHeader } from '../components/ui';

interface Clinic {
  id: number;
  name: string;
  slug: string;
  phone?: string | null;
  address?: string | null;
  active: boolean;
  plan: string;
  createdAt: string;
  userCount: number;
  patientCount: number;
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-500';

function NewClinicModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
  });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => api('/platform/clinics', { body: form }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-clinics'] });
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const ready = form.name && form.adminName && form.adminEmail && form.adminPassword;
  return (
    <Modal
      title="Add a clinic"
      hint="Creates the clinic with its default treatment catalogue and its first administrator login."
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!ready || save.isPending}>
            Create clinic
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-200">{error}</div>}
        <Field label="Clinic name *"><input className={inputCls} value={form.name} onChange={set('name')} /></Field>
        <Field label="Phone"><input className={inputCls} value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Address"><input className={inputCls} value={form.address} onChange={set('address')} /></Field>
        <div className="pt-2 border-t border-slate-100 text-xs font-bold text-slate-500 uppercase tracking-wide">
          First administrator
        </div>
        <Field label="Name *"><input className={inputCls} value={form.adminName} onChange={set('adminName')} /></Field>
        <Field label="Email *"><input className={inputCls} value={form.adminEmail} onChange={set('adminEmail')} /></Field>
        <Field label="Password *">
          <input type="password" className={inputCls} value={form.adminPassword} onChange={set('adminPassword')} />
        </Field>
      </div>
    </Modal>
  );
}

export default function Platform() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [toggling, setToggling] = useState<Clinic | null>(null);
  const { data: clinics, isLoading } = useQuery<Clinic[]>({
    queryKey: ['platform-clinics'],
    queryFn: () => api('/platform/clinics'),
  });
  const toggle = useMutation({
    mutationFn: (c: Clinic) =>
      api(`/platform/clinics/${c.id}`, { method: 'PUT', body: { active: !c.active } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-clinics'] });
      setToggling(null);
    },
  });

  return (
    <div>
      <PageHeader
        icon={Building2}
        title="Clinics"
        subtitle="Every clinic on the platform — add a new one, or switch one off."
        actions={
          <Button onClick={() => setShowNew(true)}>
            <Plus size={16} /> Add clinic
          </Button>
        }
      />

      {!isLoading && !clinics?.length && (
        <Empty
          icon={Building2}
          text="No clinics yet"
          hint="Add the first clinic to get started — it gets its own logins, patients and settings, fully separate from every other clinic."
          action={<Button onClick={() => setShowNew(true)}><Plus size={16} /> Add clinic</Button>}
        />
      )}

      <div className="grid md:grid-cols-2 gap-4 items-start">
        {clinics?.map((c) => (
          <Card key={c.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800 truncate">{c.name}</span>
                  <Badge value={c.active ? 'ACTIVE' : 'ARCHIVED'} />
                  <span className="text-[11px] font-bold text-violet-600 bg-violet-50 rounded px-1.5 py-0.5">{c.plan}</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">/{c.slug} · since {fmtDate(c.createdAt)}</div>
                {c.address && <div className="text-xs text-slate-500 mt-1 truncate">{c.address}</div>}
                <div className="text-xs text-slate-600 mt-2">
                  {c.userCount} staff · {c.patientCount} patients
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setToggling(c)} title={c.active ? 'Switch off' : 'Switch on'}>
                <Power size={14} /> {c.active ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {showNew && <NewClinicModal onClose={() => setShowNew(false)} />}
      {toggling && (
        <ConfirmDialog
          title={toggling.active ? `Deactivate ${toggling.name}?` : `Activate ${toggling.name}?`}
          message={
            toggling.active
              ? 'Every login at this clinic stops working immediately. Their data is kept and comes back when you reactivate.'
              : 'Logins at this clinic will work again immediately.'
          }
          confirmLabel={toggling.active ? 'Deactivate' : 'Activate'}
          danger={toggling.active}
          onConfirm={() => toggle.mutate(toggling)}
          onCancel={() => setToggling(null)}
        />
      )}
    </div>
  );
}
