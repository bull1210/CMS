import { ReactNode, createContext, useContext } from 'react';
import { AlertTriangle, Check, HelpCircle, X, type LucideIcon } from 'lucide-react';
import { SECTIONS, Section, TONE_CLASSES, statusLabel, statusTone } from '../theme';

/**
 * The active section's palette. Layout provides it from the current route, so
 * every Card/Button/PageHeader below picks up the right colour with no props.
 */
const SectionCtx = createContext<Section>(SECTIONS.dashboard);
export const SectionProvider = SectionCtx.Provider;
export const useSection = () => useContext(SectionCtx);

/* ---------- Page header ---------------------------------------------- */

/**
 * The coloured banner at the top of every page. `subtitle` is not decoration —
 * it is the one-line plain-English answer to "what is this screen for?", and
 * every page is expected to supply one.
 */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  const s = useSection();
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${s.header} px-5 py-3.5 mb-4 shadow-lg animate-rise no-print`}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 backdrop-blur rounded-xl p-2.5 text-white shadow-inner">
            <Icon size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">{title}</h1>
            <p className="text-sm text-white/85">{subtitle}</p>
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/* ---------- Card ------------------------------------------------------ */

/**
 * `hint` renders a plain-English explainer under the title. Use it on anything
 * a first-time user might not recognise from the title alone.
 */
export function Card({
  title,
  hint,
  icon: Icon,
  action,
  children,
  className = '',
  tone,
}: {
  title?: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  const s = useSection();
  const accent = tone === 'bad' ? 'bg-rose-500' : tone === 'warn' ? 'bg-amber-500' : tone === 'good' ? 'bg-emerald-500' : s.accent;
  const chip = tone === 'bad' ? 'bg-rose-100 text-rose-700' : tone === 'warn' ? 'bg-amber-100 text-amber-700' : tone === 'good' ? 'bg-emerald-100 text-emerald-700' : s.chip;
  return (
    <div className={`relative bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow overflow-hidden animate-rise ${className}`}>
      <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${accent}`} aria-hidden />
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 pl-5 pr-3 py-2.5 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            {Icon && (
              <span className={`shrink-0 rounded-lg p-1.5 ${chip}`}>
                <Icon size={15} />
              </span>
            )}
            <div className="min-w-0">
              <h3 className="font-bold text-slate-800 leading-tight">{title}</h3>
              {hint && <p className="text-xs text-slate-500 leading-snug">{hint}</p>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className="pl-5 pr-3 py-2.5">{children}</div>
    </div>
  );
}

/* ---------- Badge ----------------------------------------------------- */

/** Shows the plain-English name for a status code, coloured by meaning. */
export function Badge({ value, label }: { value: string; label?: string }) {
  const cls = TONE_CLASSES[statusTone(value)];
  return (
    <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap ${cls}`}>
      {label ?? statusLabel(value)}
    </span>
  );
}

/* ---------- Button ---------------------------------------------------- */

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'md',
  disabled,
  title,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const s = useSection();
  const styles = {
    primary: `${s.solid} text-white shadow-sm hover:shadow-md`,
    secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 shadow-sm',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm',
    success: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }[variant];
  // Comfortably large by default: this is used at arm's length, often by
  // someone who is not quick with a mouse.
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2.5 text-sm', lg: 'px-6 py-3 text-base' }[size];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:ring-2 focus-visible:ring-offset-2 ${s.ring} ${styles} ${sizes} ${className}`}
    >
      {children}
    </button>
  );
}

/* ---------- Modal ----------------------------------------------------- */

/**
 * `footer` pins the action buttons to the bottom of the dialog. Without it a
 * long form pushes Save off-screen and the user has to hunt for it — put every
 * Save/Cancel pair in `footer`, not in `children`.
 */
export function Modal({
  title,
  hint,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  hint?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const s = useSection();
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 no-print"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} animate-pop
                    flex flex-col max-h-[90vh] overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-start justify-between gap-4 px-6 py-4 bg-gradient-to-r ${s.header} shrink-0`}>
          <div>
            <h3 className="font-bold text-white text-lg leading-tight">{title}</h3>
            {hint && <p className="text-xs text-white/85 mt-0.5">{hint}</p>}
          </div>
          <button
            onClick={onClose}
            title="Close"
            className="text-white/80 hover:text-white hover:bg-white/20 rounded-lg p-1 transition shrink-0"
          >
            <X size={20} />
          </button>
        </div>
        {/* The only scrolling region — the header and footer stay put. */}
        <div className="p-6 overflow-y-auto grow">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 shrink-0">{footer}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Ask before anything destructive. Deleting should never be one careless click.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Yes, do it',
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 no-print" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-4">
          <span className={`rounded-xl p-3 shrink-0 ${danger ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
            <AlertTriangle size={24} />
          </span>
          <div>
            <h3 className="font-bold text-slate-800 text-lg">{title}</h3>
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={onCancel}>No, go back</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Form fields ----------------------------------------------- */

export function Field({
  label,
  hint,
  required,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-sm font-semibold text-slate-700 mb-1.5">
        {label}
        {required && <span className="text-rose-500 ml-1" title="Required">*</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-slate-500 mt-1 leading-snug">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-xl border-2 border-slate-200 px-3.5 py-2.5 text-sm bg-white transition ' +
  'hover:border-slate-300 focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 ' +
  'disabled:bg-slate-50 disabled:text-slate-400 placeholder:text-slate-400';

/* ---------- Stat tile -------------------------------------------------- */

export function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon?: LucideIcon;
  tone?: 'default' | 'danger' | 'success' | 'warn' | 'info';
}) {
  const s = useSection();
  const tones = {
    default: { bar: s.accent, chip: s.chip, value: 'text-slate-800' },
    success: { bar: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-700', value: 'text-emerald-600' },
    danger: { bar: 'bg-rose-500', chip: 'bg-rose-100 text-rose-700', value: 'text-rose-600' },
    warn: { bar: 'bg-amber-500', chip: 'bg-amber-100 text-amber-700', value: 'text-amber-600' },
    info: { bar: 'bg-blue-500', chip: 'bg-blue-100 text-blue-700', value: 'text-blue-600' },
  }[tone];
  return (
    <div className="relative bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all p-3 overflow-hidden animate-rise">
      <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${tones.bar}`} aria-hidden />
      <div className="flex items-center justify-between gap-2 pl-2">
        <div className="min-w-0">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</div>
          <div className={`text-2xl font-extrabold mt-0.5 tracking-tight ${tones.value}`}>{value}</div>
          {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
        </div>
        {Icon && (
          <span className={`rounded-xl p-2 shrink-0 ${tones.chip}`}>
            <Icon size={18} />
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------- Empty states ---------------------------------------------- */

/**
 * An empty list should never be a dead end. It says what the screen would show,
 * and offers the button that fills it.
 */
export function Empty({
  text,
  hint,
  icon: Icon,
  action,
  celebrate,
}: {
  text: string;
  hint?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  /** Use when empty is *good news* (nothing overdue) rather than "not set up yet". */
  celebrate?: boolean;
}) {
  return (
    <div className="text-center py-5 px-4">
      <div
        className={`inline-flex rounded-xl p-2.5 mb-2 ${
          celebrate ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
        }`}
      >
        {Icon ? <Icon size={22} /> : celebrate ? <Check size={22} /> : <HelpCircle size={22} />}
      </div>
      <p className={`text-sm font-semibold ${celebrate ? 'text-emerald-700' : 'text-slate-600'}`}>{text}</p>
      {hint && <p className="text-xs text-slate-500 mt-0.5 max-w-sm mx-auto leading-relaxed">{hint}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

/* ---------- Misc ------------------------------------------------------- */

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  const s = useSection();
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className={`w-9 h-9 rounded-full border-[3px] border-slate-200 border-t-transparent animate-spin ${s.text}`}
           style={{ borderTopColor: 'currentColor' }} />
      <p className="text-sm text-slate-500 font-medium">{label}</p>
    </div>
  );
}

/** A soft tinted note for inline guidance. */
export function Hint({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const cls = tone === 'warn'
    ? 'bg-amber-50 border-amber-200 text-amber-900'
    : 'bg-blue-50 border-blue-200 text-blue-900';
  return (
    <div className={`flex items-start gap-2.5 text-sm rounded-xl border px-3.5 py-2.5 ${cls}`}>
      <HelpCircle size={16} className="shrink-0 mt-0.5 opacity-70" />
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

/** Section heading inside a page, for grouping related cards. */
export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 mt-2">
      <h2 className="text-lg font-bold text-slate-800">{children}</h2>
      {hint && <p className="text-sm text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}
