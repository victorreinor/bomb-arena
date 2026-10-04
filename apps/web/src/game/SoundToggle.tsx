import { useEffect, useReducer, useRef, useState } from "react";
import { CHANNELS, audio, type Channel } from "./audio";
import { buzz, canVibrate } from "./haptics";
import { setHaptics, setReduceMotion, settings } from "./settings";

const LABEL: Record<Channel, { icon: string; name: string; key: string; volume: string }> = {
  music: { icon: "🎵", name: "Música", key: "M", volume: "Volume da música" },
  sfx: { icon: "💥", name: "Efeitos", key: "N", volume: "Volume dos efeitos" },
};

/** The audio engine and the settings own the values: this re-renders after changing one. */
const useRefresh = () => useReducer((n: number) => n + 1, 0)[1];

/** A dropdown's open state; it closes on a tap outside `ref` or on Escape. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  return { open, setOpen, ref };
}

/** One on/off switch per sound channel (music, effects). */
export function ChannelToggles() {
  const refresh = useRefresh();
  return CHANNELS.map((ch) => {
    const off = audio.muted[ch];
    const l = LABEL[ch];
    return (
      <button
        key={ch}
        className={off ? "off" : ""}
        onClick={() => {
          audio.setMuted(ch, !off);
          refresh();
        }}
        aria-pressed={!off}
        title={`${off ? "Ligar" : "Desligar"} ${l.name.toLowerCase()} (${l.key})`}
      >
        {l.icon}
        <span>{l.name}</span>
      </button>
    );
  });
}

/** Volumes and comfort: less shake and flash, vibration. */
export function SettingsFields() {
  const refresh = useRefresh();
  return (
    <>
      {CHANNELS.map((ch) => (
        <label key={ch}>
          <span>{LABEL[ch].volume}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={audio.volume[ch]}
            onChange={(e) => {
              audio.setVolume(ch, Number(e.target.value));
              refresh();
            }}
          />
        </label>
      ))}
      <label className="check">
        <input
          type="checkbox"
          checked={settings.reduceMotion}
          onChange={(e) => {
            setReduceMotion(e.target.checked);
            refresh();
          }}
        />
        <span>Reduzir tremor e clarão</span>
      </label>
      {canVibrate && (
        <label className="check">
          <input
            type="checkbox"
            checked={settings.haptics}
            onChange={(e) => {
              setHaptics(e.target.checked);
              if (e.target.checked) buzz("tap");
              refresh();
            }}
          />
          <span>Vibrar (bomba, item, golpe)</span>
        </label>
      )}
    </>
  );
}

/** Quick switches for music and sound effects, plus a panel with volumes and motion comfort. */
export function SoundToggle() {
  const refresh = useRefresh();
  const { open, setOpen, ref } = usePopover();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const ch = e.code === "KeyM" ? "music" : e.code === "KeyN" ? "sfx" : null;
      if (!ch) return;
      audio.setMuted(ch, !audio.muted[ch]);
      refresh();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh]);

  return (
    <div className="sound-controls">
      <ChannelToggles />
      <div className="settings-anchor" ref={ref}>
        <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" title="Ajustes">
          ⚙️
        </button>
        {open && (
          <div className="settings-panel" role="dialog" aria-label="Ajustes">
            <SettingsFields />
          </div>
        )}
      </div>
    </div>
  );
}
