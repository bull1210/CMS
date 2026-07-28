import { Moon, Sun, Sunset, Trash2 } from 'lucide-react';
import { inputCls } from './ui';

export interface Medicine {
  name: string;
  dose?: string;
  frequency?: string;
  duration?: string;
  notes?: string;
}

/* ---------- Frequency ---------------------------------------------------- */

/**
 * Dental prescriptions use "1-0-1" for morning-afternoon-night. That is
 * obvious to a pharmacist and opaque to everyone else, so the UI is three
 * buttons and the shorthand is generated. Anything that is not N-N-N (e.g.
 * "Twice daily", "SOS") stays as free text.
 */
const SLOT_PATTERN = /^([0-9])-([0-9])-([0-9])$/;

export function parseSlots(freq?: string): [boolean, boolean, boolean] | null {
  const m = SLOT_PATTERN.exec((freq ?? '').trim());
  return m ? [m[1] !== '0', m[2] !== '0', m[3] !== '0'] : null;
}

function slotsToFreq(slots: [boolean, boolean, boolean]): string {
  return slots.map((s) => (s ? '1' : '0')).join('-');
}

/** Plain-English rendering of a frequency, for confirmation under the buttons. */
export function describeFrequency(freq?: string, duration?: string): string {
  const slots = parseSlots(freq);
  if (!slots) return freq ? `${freq}${duration ? ` for ${duration}` : ''}` : '';
  const names = ['morning', 'afternoon', 'night'].filter((_, i) => slots[i]);
  if (!names.length) return 'No times chosen yet';
  const times =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const perDay = names.length === 1 ? 'once' : names.length === 2 ? 'twice' : '3 times';
  return `${perDay} a day — ${times}${duration ? `, for ${duration}` : ''}`;
}

const SLOT_META = [
  { label: 'Morning', icon: Sun },
  { label: 'Afternoon', icon: Sunset },
  { label: 'Night', icon: Moon },
] as const;

const DURATIONS = ['3 days', '5 days', '7 days', '10 days', '14 days'];
const NOTE_PRESETS = ['After food', 'Before food', 'At bedtime', 'If in pain'];

/* ---------- Chip --------------------------------------------------------- */

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition active:scale-[0.97] ${
        active
          ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
          : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700'
      }`}
    >
      {children}
    </button>
  );
}

/* ---------- One medicine ------------------------------------------------- */

export function MedicineEditor({
  value,
  index,
  total,
  formulary,
  onChange,
  onRemove,
}: {
  value: Medicine;
  index: number;
  total: number;
  formulary?: Medicine[];
  /**
   * Takes an updater, not a value. Tapping Morning then Night in quick
   * succession fires both handlers before React re-renders; with a plain value
   * the second call would carry the pre-first-click medicine and silently undo
   * the first tap.
   */
  onChange: (update: (prev: Medicine) => Medicine) => void;
  onRemove: () => void;
}) {
  const slots = parseSlots(value.frequency);
  const isCustomFreq = !slots && Boolean(value.frequency);
  const activeSlots: [boolean, boolean, boolean] = slots ?? [false, false, false];

  const set = (patch: Partial<Medicine>) => onChange((prev) => ({ ...prev, ...patch }));

  const toggleSlot = (i: number) =>
    onChange((prev) => {
      const cur = parseSlots(prev.frequency) ?? [false, false, false];
      const next: [boolean, boolean, boolean] = [...cur] as [boolean, boolean, boolean];
      next[i] = !next[i];
      return { ...prev, frequency: slotsToFreq(next) };
    });

  /** Toggle a preset chip off if it is already the value. */
  const togglePreset = (key: 'duration' | 'notes', v: string) =>
    onChange((prev) => ({ ...prev, [key]: prev[key] === v ? '' : v }));

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white p-4 hover:border-slate-300 transition">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Medicine {index + 1}</span>
        <button
          type="button"
          onClick={onRemove}
          disabled={total === 1}
          title={total === 1 ? 'A prescription needs at least one medicine' : 'Remove this medicine'}
          className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 py-1.5 transition
                     text-slate-500 hover:text-rose-700 hover:bg-rose-50
                     disabled:opacity-30 disabled:hover:text-slate-500 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        >
          <Trash2 size={14} /> Remove
        </button>
      </div>

      {/* Name */}
      <label className="block mb-3">
        <span className="block text-sm font-semibold text-slate-700 mb-1.5">Medicine name</span>
        <input
          className={inputCls}
          list="rx-formulary"
          placeholder="Start typing — e.g. Amoxicillin 500mg"
          value={value.name ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange((prev) => {
              const hit = formulary?.find((f) => f.name === v);
              // Naming a medicine from the list means "give the usual dose for
              // this drug", so its schedule replaces whatever is there. Without
              // the overwrite, switching Amoxicillin -> Ibuprofen would leave
              // Ibuprofen carrying Amoxicillin's schedule.
              return hit
                ? { ...prev, name: v, frequency: hit.frequency ?? '', duration: hit.duration ?? '', notes: hit.notes ?? '' }
                : { ...prev, name: v };
            });
          }}
        />
        <span className="block text-xs text-slate-500 mt-1">
          Pick one from your list and its usual dose fills in below — change it if you need to.
        </span>
      </label>

      {/* When to take */}
      <div className="mb-3">
        <span className="block text-sm font-semibold text-slate-700 mb-1.5">When should they take it?</span>
        <div className="flex flex-wrap gap-2">
          {SLOT_META.map((s, i) => (
            <Chip key={s.label} active={!isCustomFreq && activeSlots[i]} onClick={() => toggleSlot(i)}>
              <s.icon size={15} /> {s.label}
            </Chip>
          ))}
          <input
            className={`${inputCls} w-auto grow min-w-40`}
            placeholder="or type it — e.g. Twice daily"
            value={isCustomFreq ? value.frequency ?? '' : ''}
            onChange={(e) => set({ frequency: e.target.value })}
          />
        </div>
        <p className="text-xs font-medium text-indigo-700 bg-indigo-50 rounded-lg px-3 py-1.5 mt-2 inline-block">
          {describeFrequency(value.frequency, value.duration) || 'Choose when they take it'}
          {slots && <span className="text-indigo-400 ml-2">(prints as {value.frequency})</span>}
        </p>
      </div>

      {/* Duration */}
      <div className="mb-3">
        <span className="block text-sm font-semibold text-slate-700 mb-1.5">For how long?</span>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((d) => (
            <Chip key={d} active={value.duration === d} onClick={() => togglePreset('duration', d)}>
              {d}
            </Chip>
          ))}
          <input
            className={`${inputCls} w-auto grow min-w-32`}
            placeholder="or type it"
            value={DURATIONS.includes(value.duration ?? '') ? '' : value.duration ?? ''}
            onChange={(e) => set({ duration: e.target.value })}
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <span className="block text-sm font-semibold text-slate-700 mb-1.5">Anything to add?</span>
        <div className="flex flex-wrap gap-2">
          {NOTE_PRESETS.map((n) => (
            <Chip key={n} active={value.notes === n} onClick={() => togglePreset('notes', n)}>
              {n}
            </Chip>
          ))}
          <input
            className={`${inputCls} w-auto grow min-w-40`}
            placeholder="or type a note"
            value={NOTE_PRESETS.includes(value.notes ?? '') ? '' : value.notes ?? ''}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

/** The shared autocomplete source. Render once per screen that edits medicines. */
export function FormularyDatalist({ formulary }: { formulary?: Medicine[] }) {
  return (
    <datalist id="rx-formulary">
      {formulary?.map((f) => <option key={f.name} value={f.name} />)}
    </datalist>
  );
}
