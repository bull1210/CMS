import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, DatabaseBackup, Play, Plus, Settings as SettingsIcon, UserCog } from 'lucide-react';
import { api, getToken, getUser } from '../api';
import { Badge, Button, Card, Empty, Field, inputCls, Modal, PageHeader, Spinner } from '../components/ui';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
}
interface Backup {
  name: string;
  size: number;
  createdAt: string;
}

const SETTING_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'clinic.name', label: 'Clinic name' },
  { key: 'clinic.doctor', label: 'Primary doctor' },
  { key: 'clinic.address', label: 'Address' },
  { key: 'clinic.phone', label: 'Clinic phone' },
  { key: 'billing.taxPercent', label: 'Tax % on invoices' },
  { key: 'reminders.offsets', label: 'Reminder offsets', hint: 'e.g. 7d,3d,1d,2h before appointment' },
  { key: 'messaging.webhookUrl', label: 'SMS/WhatsApp gateway URL', hint: 'Leave empty to log messages locally (console provider)' },
  { key: 'messaging.inboundToken', label: 'Inbound webhook token', hint: 'Shared secret your gateway must send to /api/messages/inbound (?token= or x-webhook-token header). Empty = no check' },
  { key: 'recall.months', label: 'Recall after (months)', hint: 'Invite patients back after this many months without a visit; 0 disables' },
  { key: 'greetings.birthday', label: 'Birthday greetings', hint: 'on / off — automatic birthday wishes via WhatsApp/SMS' },
];

function UserModal({ initial, onClose }: { initial?: User; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    password: '',
    role: initial?.role ?? 'ASSISTANT',
    active: initial?.active ?? true,
  });
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { ...form };
      if (!form.password) delete body.password;
      return initial
        ? api(`/users/${initial.id}`, { method: 'PUT', body })
        : api('/users', { body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'New user'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name *"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Email *"><input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field
          label={initial ? 'New password' : 'Password'}
          required={!initial}
          hint={initial ? 'Leave blank to keep their current password.' : undefined}
        >
          <input type="password" className={inputCls} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="What can they do?">
          <select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {[
              ['DOCTOR', 'Doctor — full clinical access, incl. settings'],
              ['ASSISTANT', 'Assistant — patients, appointments, billing, stock, expenses'],
              ['ADMIN', 'Administrator — settings only'],
            ].map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </Field>
        <label className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" className="rounded w-4 h-4 mt-0.5" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          <span>
            <span className="font-semibold">Allow this person to sign in</span>
            <span className="block text-xs text-slate-500 mt-0.5">Untick to block access immediately without deleting their history.</span>
          </span>
        </label>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!form.name || !form.email || (!initial && !form.password) || save.isPending}>Save</Button>
      </div>
    </Modal>
  );
}

export default function Settings() {
  const isAdmin = getUser()?.role === 'ADMIN';
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery<Record<string, string>>({ queryKey: ['settings'], queryFn: () => api('/settings') });
  const [form, setForm] = useState<Record<string, string>>({});
  const [savedMsg, setSavedMsg] = useState('');
  const [schedulerMsg, setSchedulerMsg] = useState('');
  const [editUser, setEditUser] = useState<User | 'new' | null>(null);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const { data: users } = useQuery<User[]>({ queryKey: ['users'], queryFn: () => api('/users'), enabled: isAdmin });
  const { data: backups } = useQuery<Backup[]>({ queryKey: ['backups'], queryFn: () => api('/backup'), enabled: isAdmin });

  const saveSettings = useMutation({
    mutationFn: () => api('/settings', { method: 'PUT', body: form }),
    onSuccess: () => {
      setSavedMsg('Saved ✓');
      setTimeout(() => setSavedMsg(''), 2000);
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  const runBackup = useMutation({
    mutationFn: () => api('/backup', { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  });
  const runScheduler = useMutation({
    mutationFn: () => api<{ sent: number }>('/messages/run-scheduler', { method: 'POST', body: {} }),
    onSuccess: (r) => {
      setSchedulerMsg(`Scheduler ran — ${r.sent} message(s) sent.`);
      setTimeout(() => setSchedulerMsg(''), 4000);
    },
  });

  if (isLoading) return <Spinner label="Loading settings…" />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={SettingsIcon}
        title="Settings"
        subtitle={
          isAdmin
            ? 'Clinic details, staff logins and backups. Changes here affect the whole clinic.'
            : 'Clinic details and backups. Only an administrator can change these.'
        }
      />

      <Card
        icon={Building2}
        title="Clinic details & messaging"
        hint="Your clinic name and address appear on every printed bill and prescription."
        action={isAdmin && savedMsg ? <span className="text-sm font-semibold text-emerald-600">{savedMsg}</span> : undefined}
      >
        <div className="grid md:grid-cols-2 gap-4">
          {SETTING_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <input
                className={inputCls}
                value={form[f.key] ?? ''}
                disabled={!isAdmin}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
              {f.hint && <span className="text-[11px] text-slate-400">{f.hint}</span>}
            </Field>
          ))}
        </div>
        {isAdmin && (
          <div className="mt-4">
            <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>Save settings</Button>
          </div>
        )}
      </Card>

      <Card
        title="Automated reminders"
        action={
          <Button variant="secondary" onClick={() => runScheduler.mutate()} disabled={runScheduler.isPending}>
            <span className="flex items-center gap-1.5"><Play size={14} />Run scheduler now</span>
          </Button>
        }
      >
        <p className="text-sm text-slate-500">
          The scheduler runs automatically every 15 minutes: appointment reminders at the configured offsets,
          a will-you-attend questionnaire one day before each appointment, and follow-up nudges for due treatments.
        </p>
        {schedulerMsg && <p className="text-sm text-emerald-600 mt-2">{schedulerMsg}</p>}
      </Card>

      {isAdmin && (
        <>
          <Card
            title="Users"
            action={<Button variant="ghost" onClick={() => setEditUser('new')}><span className="flex items-center gap-1"><Plus size={14} />Add user</span></Button>}
          >
            {!users?.length && <Empty text="No users" />}
            <div className="space-y-2">
              {users?.map((u) => (
                <div key={u.id} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                  <UserCog size={16} className="text-slate-300" />
                  <span className="text-sm font-medium text-slate-700 flex-1">{u.name}</span>
                  <span className="text-xs text-slate-400">{u.email}</span>
                  <Badge value={u.role} />
                  <Badge value={u.active ? 'ACTIVE' : 'INACTIVE'} />
                  <Button variant="ghost" onClick={() => setEditUser(u)}>Edit</Button>
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="Backups"
            action={
              <Button onClick={() => runBackup.mutate()} disabled={runBackup.isPending}>
                <span className="flex items-center gap-1.5"><DatabaseBackup size={15} />{runBackup.isPending ? 'Backing up…' : 'Backup now'}</span>
              </Button>
            }
          >
            <p className="text-sm text-slate-500 mb-3">
              Automatic daily backup at 01:30. Each backup zips the SQLite database and every uploaded document.
              Restore instructions are in <code className="text-xs bg-slate-100 px-1 rounded">server/RESTORE.md</code>.
            </p>
            {!backups?.length && <Empty text="No backups yet" />}
            <div className="space-y-1.5">
              {backups?.map((b) => (
                <div key={b.name} className="flex items-center gap-3 text-sm py-1.5 border-b border-slate-50 last:border-0">
                  <span className="font-mono text-xs text-slate-600 flex-1">{b.name}</span>
                  <span className="text-xs text-slate-400">{(b.size / 1024).toFixed(0)} KB</span>
                  <button
                    className="text-indigo-600 text-xs hover:underline"
                    onClick={async () => {
                      const res = await fetch(`/api/backup/${b.name}/download`, {
                        headers: { Authorization: `Bearer ${getToken()}` },
                      });
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = b.name;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download
                  </button>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {editUser && <UserModal initial={editUser === 'new' ? undefined : editUser} onClose={() => setEditUser(null)} />}
    </div>
  );
}
