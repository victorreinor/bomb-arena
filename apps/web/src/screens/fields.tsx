import { MAX_MEMBERS, MAX_NAME_LENGTH, MIN_MEMBERS } from "@bomberman/engine";

const CAPACITIES = Array.from({ length: MAX_MEMBERS - MIN_MEMBERS + 1 }, (_, i) => MIN_MEMBERS + i);

/** "How many players" picker, used when creating a room and by the host in the lobby. */
export function CapacityPicker({ value, onChange, min = MIN_MEMBERS, label }: {
  value: number;
  onChange: (n: number) => void;
  /** smaller sizes are disabled (people already in the room) */
  min?: number;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {CAPACITIES.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          className={value === n ? "selected" : ""}
          disabled={n < min}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
    </div>
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
