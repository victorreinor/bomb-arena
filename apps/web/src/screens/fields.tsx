import { MAX_MEMBERS, MAX_NAME_LENGTH, MIN_MEMBERS } from "@bomberman/engine";

const CAPACITIES = Array.from({ length: MAX_MEMBERS - MIN_MEMBERS + 1 }, (_, i) => MIN_MEMBERS + i);

/** Room sizes to pick from; those below `min` (people already in the room) are disabled. */
export const capacityOptions = (min = MIN_MEMBERS): Option<number>[] =>
  CAPACITIES.map((n) => ({ value: n, label: String(n), disabled: n < min }));

/** "How many players" picker, used when creating a room and by the host in the lobby. */
export function CapacityPicker({ value, onChange, min = MIN_MEMBERS, label }: {
  value: number;
  onChange: (n: number) => void;
  /** smaller sizes are disabled (people already in the room) */
  min?: number;
  label: string;
}) {
  return (
    <OptionPicker
      label={label}
      value={value}
      options={capacityOptions(min)}
      onChange={onChange}
    />
  );
}

export function NameField({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <label className="field">
      <span>Seu nome</span>
      <input value={value} maxLength={MAX_NAME_LENGTH} placeholder="Como te chamam?" onChange={(e) => onChange(e.target.value)} autoFocus />
    </label>
  );
}

/** A row of mutually exclusive buttons (host settings in the lobby). */
export interface Option<V> {
  value: V;
  label: string;
  disabled?: boolean;
}

export function OptionPicker<V extends string | number | boolean>({ label, value, options, onChange }: {
  label: string;
  value: V;
  options: Option<V>[];
  onChange: (value: V) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "selected" : ""}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A room setting, one compact row: the host picks it, everyone else just sees what was picked. */
export function HostSetting<V extends string | number | boolean>({ title, hint, editable, value, options, onChange }: {
  title: string;
  hint?: string;
  editable: boolean;
  value: V;
  options: Option<V>[];
  onChange: (value: V) => void;
}) {
  return (
    <div className="setting">
      <h2 title={hint}>{title}</h2>
      {editable ? (
        <OptionPicker label={title} value={value} options={options} onChange={onChange} />
      ) : (
        <p className="setting-value">{options.find((o) => o.value === value)?.label}</p>
      )}
      {hint && <p className="setting-hint">{hint}</p>}
    </div>
  );
}
