/**
 * Design system tokens.
 *
 * Two ideas carry the whole UI:
 *  1. **Every section owns a colour.** The nav dot, the page header gradient,
 *     card accents and primary buttons on that page all use it, so "where am I"
 *     is answerable without reading a word. Class strings are spelled out in
 *     full (never interpolated) so Tailwind's scanner keeps them.
 *  2. **Nothing shouts in ALL_CAPS_SNAKE.** Status codes stay codes on the
 *     wire; `statusLabel()` is the only thing a human ever sees.
 */

export interface Section {
  key: string;
  /** Tailwind gradient for the page header. */
  header: string;
  /** Solid fill for primary buttons in this section. */
  solid: string;
  /** Left accent bar on cards. */
  accent: string;
  /** Tinted surface for soft panels. */
  tint: string;
  /** Body text in the section colour. */
  text: string;
  /** Icon chip background. */
  chip: string;
  /** Nav dot. */
  dot: string;
  ring: string;
}

export const SECTIONS: Record<string, Section> = {
  dashboard: {
    key: 'dashboard',
    header: 'from-indigo-500 via-indigo-600 to-violet-600',
    solid: 'bg-indigo-600 hover:bg-indigo-700',
    accent: 'bg-indigo-500',
    tint: 'bg-indigo-50',
    text: 'text-indigo-700',
    chip: 'bg-indigo-100 text-indigo-700',
    dot: 'bg-indigo-400',
    ring: 'focus:ring-indigo-500',
  },
  patients: {
    key: 'patients',
    header: 'from-sky-500 via-blue-600 to-indigo-600',
    solid: 'bg-blue-600 hover:bg-blue-700',
    accent: 'bg-blue-500',
    tint: 'bg-blue-50',
    text: 'text-blue-700',
    chip: 'bg-blue-100 text-blue-700',
    dot: 'bg-blue-400',
    ring: 'focus:ring-blue-500',
  },
  appointments: {
    key: 'appointments',
    header: 'from-violet-500 via-purple-600 to-fuchsia-600',
    solid: 'bg-violet-600 hover:bg-violet-700',
    accent: 'bg-violet-500',
    tint: 'bg-violet-50',
    text: 'text-violet-700',
    chip: 'bg-violet-100 text-violet-700',
    dot: 'bg-violet-400',
    ring: 'focus:ring-violet-500',
  },
  procedures: {
    key: 'procedures',
    header: 'from-cyan-500 via-teal-600 to-emerald-600',
    solid: 'bg-teal-600 hover:bg-teal-700',
    accent: 'bg-teal-500',
    tint: 'bg-teal-50',
    text: 'text-teal-700',
    chip: 'bg-teal-100 text-teal-700',
    dot: 'bg-teal-400',
    ring: 'focus:ring-teal-500',
  },
  billing: {
    key: 'billing',
    header: 'from-emerald-500 via-green-600 to-teal-600',
    solid: 'bg-emerald-600 hover:bg-emerald-700',
    accent: 'bg-emerald-500',
    tint: 'bg-emerald-50',
    text: 'text-emerald-700',
    chip: 'bg-emerald-100 text-emerald-700',
    dot: 'bg-emerald-400',
    ring: 'focus:ring-emerald-500',
  },
  inventory: {
    key: 'inventory',
    header: 'from-amber-500 via-orange-500 to-orange-600',
    solid: 'bg-amber-600 hover:bg-amber-700',
    accent: 'bg-amber-500',
    tint: 'bg-amber-50',
    text: 'text-amber-700',
    chip: 'bg-amber-100 text-amber-700',
    dot: 'bg-amber-400',
    ring: 'focus:ring-amber-500',
  },
  expenses: {
    key: 'expenses',
    header: 'from-rose-500 via-pink-600 to-fuchsia-600',
    solid: 'bg-rose-600 hover:bg-rose-700',
    accent: 'bg-rose-500',
    tint: 'bg-rose-50',
    text: 'text-rose-700',
    chip: 'bg-rose-100 text-rose-700',
    dot: 'bg-rose-400',
    ring: 'focus:ring-rose-500',
  },
  reports: {
    key: 'reports',
    header: 'from-teal-500 via-cyan-600 to-sky-600',
    solid: 'bg-cyan-600 hover:bg-cyan-700',
    accent: 'bg-cyan-500',
    tint: 'bg-cyan-50',
    text: 'text-cyan-700',
    chip: 'bg-cyan-100 text-cyan-700',
    dot: 'bg-cyan-400',
    ring: 'focus:ring-cyan-500',
  },
  settings: {
    key: 'settings',
    header: 'from-slate-600 via-slate-700 to-slate-800',
    solid: 'bg-slate-700 hover:bg-slate-800',
    accent: 'bg-slate-500',
    tint: 'bg-slate-50',
    text: 'text-slate-700',
    chip: 'bg-slate-200 text-slate-700',
    dot: 'bg-slate-400',
    ring: 'focus:ring-slate-500',
  },
  platform: {
    key: 'platform',
    header: 'from-violet-600 via-purple-600 to-fuchsia-600',
    solid: 'bg-violet-600 hover:bg-violet-700',
    accent: 'bg-violet-500',
    tint: 'bg-violet-50',
    text: 'text-violet-700',
    chip: 'bg-violet-100 text-violet-700',
    dot: 'bg-violet-400',
    ring: 'focus:ring-violet-500',
  },
};

/** Maps a URL path to its section. Longest prefix wins. */
export function sectionForPath(pathname: string): Section {
  if (pathname.startsWith('/patients')) return SECTIONS.patients;
  if (pathname.startsWith('/appointments')) return SECTIONS.appointments;
  if (pathname.startsWith('/procedures')) return SECTIONS.procedures;
  if (pathname.startsWith('/billing')) return SECTIONS.billing;
  if (pathname.startsWith('/inventory')) return SECTIONS.inventory;
  if (pathname.startsWith('/expenses')) return SECTIONS.expenses;
  if (pathname.startsWith('/reports')) return SECTIONS.reports;
  if (pathname.startsWith('/settings')) return SECTIONS.settings;
  if (pathname.startsWith('/platform')) return SECTIONS.platform;
  return SECTIONS.dashboard;
}

/**
 * Plain-English status names. A dentist should never have to decode
 * "NO_SHOW" or "PROPOSED" — those are database values, not English.
 */
const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Booked',
  CONFIRMED: 'Confirmed',
  WAITING: 'In clinic now',
  COMPLETED: 'Done',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
  RESCHEDULED: 'Moved to a new time',
  NO_SHOW: "Didn't come",
  PLANNED: 'Planned',
  IN_PROGRESS: 'Started',
  PROPOSED: 'Waiting for patient',
  ACCEPTED: 'Patient agreed',
  REJECTED: 'Patient declined',
  PAID: 'Paid',
  PARTIAL: 'Part paid',
  PENDING: 'Unpaid',
  UNPAID: 'Unpaid',
  VOID: 'Cancelled',
  OPEN: 'Open',
  OVERDUE: 'Overdue',
  DISMISSED: 'Dismissed',
  SENT: 'Sent',
  QUEUED: 'Sending…',
  FAILED: 'Failed to send',
  ORDERED: 'Sent to lab',
  RECEIVED: 'Back from lab',
  FITTED: 'Fitted',
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
};

export function statusLabel(code?: string): string {
  if (!code) return '';
  return STATUS_LABELS[code] ?? code.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

/** Semantic tone per status — drives badge colour. */
const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'info' | 'mute'> = {
  CONFIRMED: 'good', COMPLETED: 'good', DONE: 'good', PAID: 'good', SENT: 'good',
  ACCEPTED: 'good', RECEIVED: 'good', FITTED: 'good', ACTIVE: 'good',
  WAITING: 'warn', PENDING: 'warn', UNPAID: 'warn', PARTIAL: 'warn', QUEUED: 'warn',
  PROPOSED: 'warn', ORDERED: 'warn',
  NO_SHOW: 'bad', OPEN: 'bad', FAILED: 'bad', OVERDUE: 'bad', REJECTED: 'bad',
  SCHEDULED: 'info', PLANNED: 'info', BOOKED: 'info', IN_PROGRESS: 'info',
  CANCELLED: 'mute', RESCHEDULED: 'mute', VOID: 'mute', DISMISSED: 'mute', ARCHIVED: 'mute',
};

export const TONE_CLASSES = {
  good: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  warn: 'bg-amber-100 text-amber-800 border-amber-200',
  bad: 'bg-rose-100 text-rose-800 border-rose-200',
  info: 'bg-blue-100 text-blue-800 border-blue-200',
  mute: 'bg-slate-100 text-slate-600 border-slate-200',
};

export function statusTone(code?: string) {
  return (code && STATUS_TONE[code]) || 'mute';
}
