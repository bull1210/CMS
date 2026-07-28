import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setAuth, AuthUser } from '../api';
import { Button, Field, inputCls } from '../components/ui';
import { PoweredByAatmam } from '../components/Brand';
import { AlertCircle, LogIn, Stethoscope } from 'lucide-react';

/** One-click demo logins — typing an email is the first place a new user stalls. */
const DEMO = [
  { role: 'Doctor', email: 'doctor@clinic.local', password: 'doctor123', cls: 'from-indigo-500 to-violet-600' },
  { role: 'Assistant', email: 'assistant@clinic.local', password: 'assistant123', cls: 'from-sky-500 to-blue-600' },
  { role: 'Admin', email: 'admin@clinic.local', password: 'admin123', cls: 'from-slate-600 to-slate-800' },
];

export default function Login() {
  const [email, setEmail] = useState('doctor@clinic.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function signIn(e?: FormEvent, creds?: { email: string; password: string }) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ token: string; user: AuthUser }>('/auth/login', {
        body: creds ?? { email, password },
      });
      setAuth(res.token, res.user);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 relative overflow-hidden">
      {/* Soft light blooms so the background isn't a flat slab of colour. */}
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/10 rounded-full blur-3xl" aria-hidden />
      <div className="absolute -bottom-32 -right-16 w-[28rem] h-[28rem] bg-sky-300/20 rounded-full blur-3xl" aria-hidden />

      <div className="relative w-full max-w-md animate-rise">
        <div className="text-center mb-6">
          <div className="inline-flex bg-white/20 backdrop-blur rounded-2xl p-4 text-white shadow-lg mb-3">
            <Stethoscope size={34} />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Smile Dental</h1>
          <p className="text-white/80 text-sm mt-1">Everything for your clinic, in one place</p>
        </div>

        <form onSubmit={(e) => signIn(e)} className="bg-white rounded-2xl shadow-2xl p-7 space-y-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Welcome back</h2>
            <p className="text-sm text-slate-500 mt-0.5">Sign in to start your day.</p>
          </div>

          <Field label="Email address" required>
            <input
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="username"
              required
            />
          </Field>
          <Field label="Password" required>
            <input
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              required
            />
          </Field>

          {error && (
            <div className="flex items-start gap-2.5 text-sm bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-3.5 py-2.5">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">{error}</p>
                <p className="text-xs mt-0.5 text-rose-700">Check the email and password, then try again.</p>
              </div>
            </div>
          )}

          <Button type="submit" size="lg" disabled={busy} className="w-full">
            <LogIn size={18} />
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>

          <div className="pt-3 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 text-center mb-2.5">
              Just trying it out? Tap a role to go straight in.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.password);
                    signIn(undefined, { email: d.email, password: d.password });
                  }}
                  className={`bg-gradient-to-br ${d.cls} text-white text-xs font-bold rounded-xl py-2.5
                              shadow-sm hover:shadow-md hover:brightness-110 active:scale-[0.97] transition
                              disabled:opacity-50`}
                >
                  {d.role}
                </button>
              ))}
            </div>
          </div>
        </form>

        <div className="mt-6">
          <PoweredByAatmam variant="dark" />
        </div>
      </div>
    </div>
  );
}
