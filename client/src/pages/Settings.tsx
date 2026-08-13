import { useEffect, useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, DatabaseBackup, MessageCircle, Play, Plus, Settings as SettingsIcon, UserCog, Palette, Users, Bell, Server } from 'lucide-react';
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

const SETTING_GROUPS: { title: string; fields: { key: string; label: string; hint?: string; type?: 'file' | 'text' | 'workingHours' }[] }[] = [
  {
    title: 'Branding',
    fields: [
      { key: 'clinic.name', label: 'Clinic Name' },
      { key: 'clinic.tagline', label: 'Tag line' },
      { key: 'clinic.logo', label: 'Logo', type: 'file' },
    ],
  },
  {
    title: 'Contact & Location',
    fields: [
      { key: 'clinic.doctor', label: 'Primary Doctor' },
      { key: 'clinic.doctorQual', label: "Doctor's Qualification" },
      { key: 'clinic.doctorReg', label: "Doctor's Registration No." },
      { key: 'clinic.phone', label: 'Clinic Phone' },
      { key: 'clinic.address', label: 'Clinic Address' },
    ],
  },
  {
    title: 'Working Days & Hours',
    fields: [
      { key: 'clinic.workingHours', label: 'Define weekly working days and hours', type: 'workingHours' },
      { key: 'appointments.interval', label: 'Appointment interval' },
    ] as any[],
  },
  {
    title: 'Other Settings',
    fields: [
      { key: 'reminders.offsets', label: 'Reminder offsets' },
      { key: 'greetings.birthday', label: 'Birthday Greetings' },
      { key: 'billing.taxPercent', label: 'Tax % on Invoices' },
      { key: 'recall.months', label: 'Recall after months' },
    ],
  }
];

const THEMES = [
  { id: 'default', name: 'Classic Blue', hex: '#6366f1' },
  { id: 'slate', name: 'Graphite', hex: '#64748b' },
  { id: 'sky', name: 'Cerulean', hex: '#0ea5e9' },
  { id: 'teal', name: 'Mint', hex: '#14b8a6' },
  { id: 'emerald', name: 'Emerald', hex: '#10b981' },
  { id: 'ruby', name: 'Ruby', hex: '#f43f5e' },
  { id: 'amber', name: 'Amber', hex: '#f59e0b' },
  { id: 'purple', name: 'Amethyst', hex: '#a855f7' },
  { id: 'cyan', name: 'Aqua', hex: '#06b6d4' },
  { id: 'neutral', name: 'Monochrome', hex: '#737373' },
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

function WorkingHoursEditor({ value, onChange, disabled }: { value?: string; onChange: (v: string) => void; disabled?: boolean }) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const defaultHours = () => {
    const out: any = {};
    for (let i = 0; i < 7; i++) {
      out[i] = { morning: ['09:00', '13:00'], evening: ['17:00', '21:00'], closed: i === 0 };
    }
    return out;
  };
  
  const [hours, setHours] = useState<Record<string, any>>(() => {
    try { return value ? JSON.parse(value) : defaultHours(); } 
    catch { return defaultHours(); }
  });

  const update = (day: number, field: string, val: any) => {
    const next = { ...hours, [day]: { ...hours[day], [field]: val } };
    setHours(next);
    onChange(JSON.stringify(next));
  };
  
  const updateShift = (day: number, shift: 'morning' | 'evening', idx: 0 | 1, val: string) => {
    const nextShift = [...hours[day][shift]];
    nextShift[idx] = val;
    update(day, shift, nextShift);
  };

  const timeOptions = useMemo(() => {
    const opts = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        opts.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
      }
    }
    return opts;
  }, []);

  return (
    <div className="space-y-2 mt-2 -mx-2 bg-slate-50 p-3 rounded-xl border border-slate-200 col-span-1 md:col-span-2">
      {days.map((day, i) => (
        <div key={i} className="flex items-center gap-3 text-sm">
          <div className="w-12 font-medium text-slate-700">{day}</div>
          <label className="flex items-center gap-1.5 cursor-pointer text-slate-600">
            <input type="checkbox" checked={hours[i]?.closed} onChange={(e) => update(i, 'closed', e.target.checked)} disabled={disabled} />
            Closed
          </label>
          {!hours[i]?.closed && (
            <div className="flex flex-wrap items-center gap-4 flex-1">
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-400 w-9">Morn:</span>
                <select className="border rounded px-1 py-0.5 text-xs bg-white" value={hours[i]?.morning[0]} onChange={(e) => updateShift(i, 'morning', 0, e.target.value)} disabled={disabled}>
                  {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="text-slate-400">-</span>
                <select className="border rounded px-1 py-0.5 text-xs bg-white" value={hours[i]?.morning[1]} onChange={(e) => updateShift(i, 'morning', 1, e.target.value)} disabled={disabled}>
                  {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-400 w-9">Eve:</span>
                <select className="border rounded px-1 py-0.5 text-xs bg-white" value={hours[i]?.evening[0]} onChange={(e) => updateShift(i, 'evening', 0, e.target.value)} disabled={disabled}>
                  {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="text-slate-400">-</span>
                <select className="border rounded px-1 py-0.5 text-xs bg-white" value={hours[i]?.evening[1]} onChange={(e) => updateShift(i, 'evening', 1, e.target.value)} disabled={disabled}>
                  {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * WhatsApp Cloud API connection — per-clinic credentials, the two values to
 * paste into Meta's webhook form, and a one-click test send. See
 * docs/superpowers/specs/2026-08-13-whatsapp-integration-design.md.
 */
function WhatsAppCard({ settings }: { settings?: Record<string, string> }) {
  const qc = useQueryClient();
  const parseTemplates = (raw?: string) => {
    try { return { reminder: 'appointment_reminder', recall: 'recall_due', followup: 'follow_up_due', ...JSON.parse(raw || '{}') }; }
    catch { return { reminder: 'appointment_reminder', recall: 'recall_due', followup: 'follow_up_due' }; }
  };
  const [wa, setWa] = useState(() => ({
    phoneNumberId: settings?.['whatsapp.phoneNumberId'] ?? '',
    accessToken: settings?.['whatsapp.accessToken'] ?? '',
    verifyToken: settings?.['whatsapp.verifyToken'] ?? '',
    appSecret: settings?.['whatsapp.appSecret'] ?? '',
    lang: settings?.['whatsapp.lang'] ?? 'en',
    templates: parseTemplates(settings?.['whatsapp.templates']),
  }));
  const [saved, setSaved] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PUT',
        body: {
          'whatsapp.phoneNumberId': wa.phoneNumberId.trim(),
          'whatsapp.accessToken': wa.accessToken.trim(),
          'whatsapp.verifyToken': wa.verifyToken.trim(),
          'whatsapp.appSecret': wa.appSecret.trim(),
          'whatsapp.lang': wa.lang.trim() || 'en',
          'whatsapp.templates': JSON.stringify(wa.templates),
        },
      }),
    onSuccess: () => {
      setSaved('Saved ✓');
      setTimeout(() => setSaved(''), 2000);
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  const test = useMutation({
    mutationFn: () =>
      api<{ status: string; error?: string }>('/messages/test-whatsapp', { body: { to: testTo } }),
    onSuccess: (m) =>
      setTestResult(m.status === 'SENT' ? 'Sent ✓ — check the phone!' : `Failed: ${m.error ?? 'unknown error'}`),
    onError: (e) => setTestResult(`Failed: ${e.message}`),
  });

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200';
  const connected = !!(wa.phoneNumberId && wa.accessToken);
  const webhookUrl = `${location.origin}/api/messages/whatsapp`;

  return (
    <Card
      icon={MessageCircle}
      title="WhatsApp"
      hint="Connect this clinic's WhatsApp number so reminders and recall messages actually reach patients."
      collapsible
      action={
        <span className={`text-xs font-bold px-2 py-1 rounded-lg ${connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {connected ? 'Connected' : 'Not set up'}
        </span>
      }
    >
      <p className="text-sm text-slate-500 mb-4">
        Values come from your Meta developer app (WhatsApp → API Setup). Leave empty to keep sending
        through the generic gateway / console. Reminders outside WhatsApp's 24-hour reply window are
        sent with your approved templates — the names below must match WhatsApp Manager exactly.
      </p>
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Phone Number ID"><input className={input} value={wa.phoneNumberId} onChange={(e) => setWa({ ...wa, phoneNumberId: e.target.value })} /></Field>
        <Field label="Permanent access token"><input type="password" className={input} value={wa.accessToken} onChange={(e) => setWa({ ...wa, accessToken: e.target.value })} /></Field>
        <Field label="Verify token" hint="Any secret string you invent — paste the same one into Meta's webhook form.">
          <input className={input} value={wa.verifyToken} onChange={(e) => setWa({ ...wa, verifyToken: e.target.value })} />
        </Field>
        <Field label="App secret" hint="Optional but recommended — lets the server verify events really come from Meta.">
          <input type="password" className={input} value={wa.appSecret} onChange={(e) => setWa({ ...wa, appSecret: e.target.value })} />
        </Field>
        <Field label="Reminder template name"><input className={input} value={wa.templates.reminder} onChange={(e) => setWa({ ...wa, templates: { ...wa.templates, reminder: e.target.value } })} /></Field>
        <Field label="Recall template name"><input className={input} value={wa.templates.recall} onChange={(e) => setWa({ ...wa, templates: { ...wa.templates, recall: e.target.value } })} /></Field>
        <Field label="Follow-up template name"><input className={input} value={wa.templates.followup} onChange={(e) => setWa({ ...wa, templates: { ...wa.templates, followup: e.target.value } })} /></Field>
        <Field label="Template language code" hint='"en", "en_US", "ta", "hi"…'>
          <input className={input} value={wa.lang} onChange={(e) => setWa({ ...wa, lang: e.target.value })} />
        </Field>
      </div>

      <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm">
        <div className="font-semibold text-slate-700 mb-1">Paste into Meta → WhatsApp → Configuration → Webhook</div>
        <div className="text-slate-600">Callback URL: <code className="text-xs bg-white px-1.5 py-0.5 rounded border border-slate-200">{webhookUrl}</code></div>
        <div className="text-slate-600 mt-1">Verify token: <code className="text-xs bg-white px-1.5 py-0.5 rounded border border-slate-200">{wa.verifyToken || '(set one above first)'}</code></div>
        <div className="text-xs text-slate-400 mt-1.5">Subscribe to the <b>messages</b> webhook field. The URL must be reachable from the internet (hosted server or tunnel).</div>
      </div>

      <div className="flex flex-wrap items-end gap-3 mt-4">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save WhatsApp settings</Button>
        {saved && <span className="text-sm font-semibold text-emerald-600 self-center">{saved}</span>}
        <div className="flex-1" />
        <Field label="Send a test to (with country code)" className="w-56">
          <input className={input} placeholder="+91 98…" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        </Field>
        <Button variant="secondary" onClick={() => { setTestResult(''); test.mutate(); }} disabled={!testTo || !connected || test.isPending}>
          {test.isPending ? 'Sending…' : 'Send test'}
        </Button>
      </div>
      {testResult && (
        <p className={`text-sm mt-2 ${testResult.startsWith('Sent') ? 'text-emerald-600' : 'text-rose-600'}`}>{testResult}</p>
      )}
    </Card>
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
  const [showSysSettingsPrompt, setShowSysSettingsPrompt] = useState(false);
  const [sysSettingsPassword, setSysSettingsPassword] = useState('');

  useEffect(() => {
    if (settings) {
      setForm((prev) => (Object.keys(prev).length === 0 ? settings : prev));
    }
  }, [settings]);

  const { data: users } = useQuery<User[]>({ queryKey: ['users'], queryFn: () => api('/users'), enabled: isAdmin });

  const saveSettings = useMutation({
    mutationFn: () => api('/settings', { method: 'PUT', body: form }),
    onSuccess: () => {
      setSavedMsg('Saved ✓');
      setTimeout(() => setSavedMsg(''), 2000);
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  const runScheduler = useMutation({
    mutationFn: () => api<{ sent: number }>('/messages/run-scheduler', { method: 'POST', body: {} }),
    onSuccess: (r) => {
      setSchedulerMsg(`Scheduler ran — ${r.sent} message(s) sent.`);
      setTimeout(() => setSchedulerMsg(''), 4000);
    },
  });
  const applyTheme = useMutation({
    mutationFn: (themeId: string) => api('/settings', { method: 'PUT', body: { 'clinic.theme': themeId } }),
    onMutate: (themeId) => {
      // Optimistically apply the theme immediately so the UI feels snappy and it doesn't take 2 clicks.
      if (themeId && themeId !== 'default') {
        document.documentElement.dataset.theme = themeId;
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setSavedMsg('Theme applied ✓');
      setTimeout(() => setSavedMsg(''), 2000);
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
        title="Clinic Configuration"
        hint="Your clinic name and address appear on every printed bill and prescription."
        collapsible
        action={isAdmin && savedMsg ? <span className="text-sm font-semibold text-emerald-600">{savedMsg}</span> : undefined}
      >
        <div className="space-y-6">
          {SETTING_GROUPS.map((group) => (
            <details key={group.title} className="group mb-4 border border-slate-200 rounded-xl overflow-hidden bg-white">
              <summary className="font-semibold bg-slate-50 hover:bg-slate-100 px-4 py-3 cursor-pointer select-none list-none flex justify-between items-center transition-colors border-b border-slate-100">
                {group.title}
                <span className="text-slate-400 text-[10px] uppercase tracking-wider group-open:hidden">Show</span>
                <span className="text-slate-400 text-[10px] uppercase tracking-wider hidden group-open:block">Hide</span>
              </summary>
              <div className="p-4 grid md:grid-cols-2 gap-6">
                {group.fields.map((f) => (
                  <div key={f.key} className={f.type === 'workingHours' ? 'md:col-span-2' : ''}>
                    <Field label={f.label}>
                      {f.type === 'file' ? (
                        <>
                          <input
                            type="file"
                            accept="image/jpeg, image/png, image/webp"
                            disabled={!isAdmin}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const data = new FormData();
                              data.append('file', file);
                              try {
                                await api('/settings/logo', { formData: data });
                                qc.invalidateQueries({ queryKey: ['settings'] });
                                setSavedMsg('Logo uploaded ✓');
                                setTimeout(() => setSavedMsg(''), 2000);
                              } catch (err: any) {
                                alert(err.message || 'Failed to upload logo');
                              }
                            }}
                            className="text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                          />
                          <span className="text-[11px] text-slate-400">JPG, PNG or WEBP up to 5MB. Will update the top-left menu immediately.</span>
                        </>
                      ) : f.type === 'workingHours' ? (
                        <WorkingHoursEditor
                          value={form[f.key]}
                          onChange={(val) => setForm({ ...form, [f.key]: val })}
                          disabled={!isAdmin}
                        />
                      ) : (
                        <>
                          <div className={f.key === 'appointments.interval' ? 'flex items-center gap-2' : ''}>
                            <input
                              className={inputCls}
                              value={form[f.key] ?? ''}
                              disabled={!isAdmin}
                              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                            />
                            {f.key === 'appointments.interval' && <span className="text-sm text-slate-500 font-medium">mins</span>}
                          </div>
                          {f.hint && <span className="text-[11px] text-slate-400">{f.hint}</span>}
                        </>
                      )}
                    </Field>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
        {isAdmin && (
          <div className="mt-4">
            <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>Save settings</Button>
          </div>
        )}
      </Card>

      {isAdmin && (
        <Card
          icon={Users}
          title="Users"
          hint="Manage staff accounts, roles, and login access across the clinic."
          collapsible
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
      )}

      <Card
        icon={Palette}
        title="Appearance"
        hint="Choose a color theme for the application."
        collapsible
      >
        <div className="space-y-4">
          <Field label="Color Theme">
            <div className="flex flex-wrap items-center gap-4">
              {THEMES.map((theme) => {
                const isActive = (form['clinic.theme'] || 'default') === theme.id;
                return (
                  <button
                    key={theme.id}
                    onClick={() => setForm({ ...form, 'clinic.theme': theme.id })}
                    className={`flex flex-col items-center gap-2 p-2 rounded-xl transition ${isActive ? 'bg-slate-100 shadow-sm ring-1 ring-slate-200' : 'hover:bg-slate-50 opacity-70 hover:opacity-100'}`}
                    disabled={!isAdmin}
                  >
                    <div className={`w-10 h-10 rounded-full ${isActive ? 'ring-2 ring-offset-2 ring-slate-800' : ''}`} style={{ backgroundColor: theme.hex }} />
                    <span className="text-xs font-medium text-slate-700">{theme.name}</span>
                  </button>
                );
              })}
            </div>
          </Field>
          {isAdmin && (
            <div className="mt-2">
              <Button onClick={() => applyTheme.mutate(form['clinic.theme'] || 'default')} disabled={applyTheme.isPending}>Apply theme</Button>
            </div>
          )}
        </div>
      </Card>

      <Card
        icon={Bell}
        title="Automated reminders"
        hint="Configure your clinic's automated background tasks and messaging schedules."
        collapsible
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

      {isAdmin && <WhatsAppCard settings={settings} />}

      {isAdmin && (
        <Card icon={DatabaseBackup} title="Backups" hint="Your data is backed up automatically." collapsible>
          <p className="text-sm text-slate-500">
            The platform takes an automatic backup of all data (including every uploaded document) daily at
            01:30. To restore or export your clinic's data, contact Aatmam support.
          </p>
        </Card>
      )}

      {isAdmin && (
        <Card
          icon={Server}
          title="System Settings"
          hint="Advanced configuration for your external messaging gateways and webhooks."
          collapsible
          action={savedMsg ? <span className="text-sm font-semibold text-emerald-600">{savedMsg}</span> : undefined}
        >
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="SMS/WhatsApp gateway URL">
              <input
                className={inputCls}
                value={form['messaging.webhookUrl'] ?? ''}
                onChange={(e) => setForm({ ...form, 'messaging.webhookUrl': e.target.value })}
              />
              <span className="text-[11px] text-slate-400">Leave empty to log messages locally (console provider)</span>
            </Field>
            <Field label="Inbound webhook token">
              <input
                className={inputCls}
                value={form['messaging.inboundToken'] ?? ''}
                onChange={(e) => setForm({ ...form, 'messaging.inboundToken': e.target.value })}
              />
              <span className="text-[11px] text-slate-400">Shared secret your gateway must send to /api/messages/inbound (?token= or x-webhook-token header). Empty = no check</span>
            </Field>
          </div>
          <div className="mt-4">
            <Button onClick={() => setShowSysSettingsPrompt(true)} disabled={saveSettings.isPending}>Save system settings</Button>
          </div>
        </Card>
      )}

      {editUser && <UserModal initial={editUser === 'new' ? undefined : editUser} onClose={() => setEditUser(null)} />}

      {showSysSettingsPrompt && (
        <Modal title="Super User Authorization" onClose={() => setShowSysSettingsPrompt(false)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Please enter the super user password to save these system settings.</p>
            <Field label="Super User Password">
              <input
                type="password"
                className={inputCls}
                value={sysSettingsPassword}
                onChange={(e) => setSysSettingsPassword(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (sysSettingsPassword === 'DentCarePro') {
                      saveSettings.mutate();
                      setShowSysSettingsPrompt(false);
                      setSysSettingsPassword('');
                    } else {
                      alert('Incorrect password');
                    }
                  }
                }}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="secondary" onClick={() => setShowSysSettingsPrompt(false)}>Cancel</Button>
            <Button onClick={() => {
              if (sysSettingsPassword === 'DentCarePro') {
                saveSettings.mutate();
                setShowSysSettingsPrompt(false);
                setSysSettingsPassword('');
              } else {
                alert('Incorrect password');
              }
            }}>Authorize & Save</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
