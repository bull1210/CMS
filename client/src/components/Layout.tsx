import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ClipboardList,
  IndianRupee,
  LayoutDashboard,
  LogOut,
  Package,
  Search,
  Settings as SettingsIcon,
  Stethoscope,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { api, clearAuth, getUser } from '../api';
import { SECTIONS, sectionForPath } from '../theme';
import { SectionProvider } from './ui';
import { PoweredByAatmam } from './Brand';

interface SearchResults {
  patients: { id: number; code: string; name: string; phone: string }[];
  diagnoses: { id: number; diagnosis: string; patient: { id: number; name: string } }[];
  procedures: { id: number; procedure: { name: string }; patient: { id: number; name: string } }[];
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery<SearchResults>({
    queryKey: ['search', q],
    queryFn: () => api(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const go = (patientId: number) => {
    setOpen(false);
    setQ('');
    navigate(`/patients/${patientId}`);
  };

  const hasResults =
    data && (data.patients.length > 0 || data.diagnoses.length > 0 || data.procedures.length > 0);

  const row = 'w-full text-left px-4 py-3 hover:bg-indigo-50 border-b border-slate-50 last:border-0 transition';

  return (
    <div className="relative w-full max-w-xl" ref={boxRef}>
      <Search size={18} className="absolute left-3.5 top-3 text-slate-400 pointer-events-none" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search for a patient by name or phone number…"
        className="w-full pl-11 pr-3 py-2.5 rounded-xl border-2 border-slate-200 text-sm bg-white transition
                   hover:border-slate-300 focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500"
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute top-14 left-0 right-0 bg-white border border-slate-200 rounded-2xl shadow-2xl z-40 max-h-96 overflow-y-auto animate-pop">
          {!hasResults && (
            <div className="p-6 text-center">
              <p className="text-sm font-semibold text-slate-600">Nothing found for “{q}”</p>
              <p className="text-xs text-slate-500 mt-1">Try part of the name, or the phone number.</p>
            </div>
          )}
          {data?.patients.map((p) => (
            <button key={`p${p.id}`} onClick={() => go(p.id)} className={row}>
              <span className="font-semibold text-slate-800">{p.name}</span>
              <span className="text-xs text-slate-500 ml-2">{p.code} · {p.phone}</span>
            </button>
          ))}
          {data?.diagnoses.map((d) => (
            <button key={`d${d.id}`} onClick={() => go(d.patient.id)} className={row}>
              <span className="text-slate-700">{d.diagnosis}</span>
              <span className="text-xs text-slate-500 ml-2">Diagnosis · {d.patient.name}</span>
            </button>
          ))}
          {data?.procedures.map((t) => (
            <button key={`t${t.id}`} onClick={() => go(t.patient.id)} className={row}>
              <span className="text-slate-700">{t.procedure.name}</span>
              <span className="text-xs text-slate-500 ml-2">Treatment · {t.patient.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * `desc` shows as a tooltip — a plain-English answer to "what is this?"
 * `roles` lists who sees the tab. Nav gating is cosmetic — the server is the
 * real enforcer — but it keeps each role's screen focused:
 *   • admin     → Settings only
 *   • assistant → Home, Patients, Appointments, Billing, Stock, Expenses
 *   • doctor    → everything, incl. Treatments and Settings
 */
type Role = 'DOCTOR' | 'ASSISTANT' | 'ADMIN';
const nav: {
  to: string;
  label: string;
  desc: string;
  icon: typeof LayoutDashboard;
  section: string;
  end?: boolean;
  roles: Role[];
}[] = [
  { to: '/', label: 'Home', desc: "Today at a glance — who's coming and what needs doing", icon: LayoutDashboard, section: 'dashboard', end: true, roles: ['DOCTOR', 'ASSISTANT'] },
  { to: '/patients', label: 'Patients', desc: 'All patient records and their history', icon: Users, section: 'patients', roles: ['DOCTOR', 'ASSISTANT'] },
  { to: '/appointments', label: 'Appointments', desc: 'The appointment calendar', icon: CalendarDays, section: 'appointments', roles: ['DOCTOR', 'ASSISTANT'] },
  { to: '/procedures', label: 'Treatments', desc: 'The list of treatments you offer and their prices', icon: ClipboardList, section: 'procedures', roles: ['DOCTOR'] },
  { to: '/billing', label: 'Billing', desc: 'Bills and payments', icon: IndianRupee, section: 'billing', roles: ['DOCTOR', 'ASSISTANT'] },
  { to: '/inventory', label: 'Stock', desc: 'Materials and supplies you keep in the clinic', icon: Package, section: 'inventory', roles: ['DOCTOR', 'ASSISTANT'] },
  { to: '/expenses', label: 'Expenses', desc: 'Money going out — rent, salaries, supplies', icon: Wallet, section: 'expenses', roles: ['DOCTOR', 'ASSISTANT'] },
  { to: '/settings', label: 'Settings', desc: 'Clinic details, staff logins and backups', icon: SettingsIcon, section: 'settings', roles: ['DOCTOR', 'ADMIN'] },
];

export default function Layout() {
  const user = getUser();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const section = sectionForPath(pathname);
  const visibleNav = nav.filter((n) => n.roles.includes((user?.role ?? '') as Role));

  const ROLE_LABELS: Record<string, string> = { DOCTOR: 'Doctor', ADMIN: 'Administrator', ASSISTANT: 'Assistant' };
  const roleLabel = ROLE_LABELS[user?.role ?? ''] ?? user?.role;

  const { data: settings } = useQuery<Record<string, string>>({
    queryKey: ['settings'],
    queryFn: () => api('/settings'),
  });

  useEffect(() => {
    if (settings?.['clinic.theme'] && settings['clinic.theme'] !== 'default') {
      document.documentElement.dataset.theme = settings['clinic.theme'];
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [settings?.['clinic.theme']]);

  return (
    <SectionProvider value={section}>
      <div className="min-h-screen flex">
        <aside className="w-64 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-800 text-slate-300 flex flex-col fixed inset-y-0 no-print shadow-2xl">
          <Link to="/" className="flex items-center gap-3 px-5 py-6 text-white hover:opacity-90 transition">
            {settings?.['clinic.logo'] ? (
              <img src={settings['clinic.logo']} alt="Clinic Logo" className="w-10 h-10 rounded-xl object-cover bg-white shadow-lg" />
            ) : (
              <div className="bg-gradient-to-br from-indigo-400 to-violet-500 p-2.5 rounded-xl shadow-lg">
                <Stethoscope size={20} />
              </div>
            )}
            <div>
              <div className="font-bold text-base leading-tight">{settings?.['clinic.name'] || 'Smile Dental'}</div>
              <div className="text-[11px] text-slate-400">{settings?.['clinic.tagline'] || 'Clinic management'}</div>
            </div>
          </Link>

          <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
            {visibleNav.map(({ to, label, desc, icon: Icon, end, section: key }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={desc}
                className={({ isActive }) =>
                  `group flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold transition-all ${
                    isActive
                      ? 'bg-white/10 text-white shadow-inner'
                      : 'text-slate-400 hover:bg-white/5 hover:text-white'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`w-1.5 h-7 rounded-full transition-all ${
                        isActive ? SECTIONS[key].dot : 'bg-transparent group-hover:bg-slate-600'
                      }`}
                    />
                    <Icon size={19} className={isActive ? 'text-white' : ''} />
                    {label}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="px-4 py-4 border-t border-white/10 m-3 mt-0 rounded-xl bg-white/5">
            <div className="flex items-center gap-2.5">
              <span className="bg-gradient-to-br from-indigo-400 to-violet-500 rounded-full p-2 text-white shrink-0">
                <User size={15} />
              </span>
              <div className="min-w-0">
                <div className="text-sm text-white font-semibold truncate">{user?.name}</div>
                <div className="text-xs text-slate-400">{roleLabel}</div>
              </div>
            </div>
            <button
              onClick={() => {
                clearAuth();
                navigate('/login');
              }}
              className="mt-3 w-full flex items-center justify-center gap-2 text-xs font-semibold text-slate-300
                         hover:text-white bg-white/5 hover:bg-white/10 rounded-lg py-2 transition"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>

          <div className="px-4 pb-4 pt-1 no-print">
            <PoweredByAatmam variant="dark" />
          </div>
        </aside>

        <div className="flex-1 ml-64 min-w-0">
          <header className="bg-white/80 backdrop-blur border-b border-slate-200 px-6 py-3 flex items-center gap-4 sticky top-0 z-30 no-print">
            {user?.role !== 'ADMIN' && <GlobalSearch />}
          </header>
          <main className="px-5 py-4">
            <Outlet />
          </main>
        </div>
      </div>
    </SectionProvider>
  );
}
