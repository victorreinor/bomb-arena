import { useEffect, useReducer, useRef, useState } from "react";
import { CHANNELS, audio, type Channel } from "./audio";
import { buzz, canVibrate } from "./haptics";
import { setHaptics, setReduceMotion, settings } from "./settings";

const LABEL: Record<Channel, { icon: string; name: string; key: string; volume: string }> = {
  music: { icon: "🎵", name: "Música", key: "M", volume: "Volume da música" },
  sfx: { icon: "💥", name: "Efeitos", key: "N", volume: "Volume dos efeitos" },
};

/** Quick switches for music and sound effects, plus a panel with volumes and motion comfort. */
export function SoundToggle() {
  // the audio engine and settings own the values; this only re-renders after changing them
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const toggle = (ch: Channel) => {
    audio.setMuted(ch, !audio.muted[ch]);
    refresh();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === "KeyM") toggle("music");
      else if (e.code === "KeyN") toggle("sfx");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="sound-controls">
      {CHANNELS.map((ch) => {
        const off = audio.muted[ch];
        const l = LABEL[ch];
        return (
          <button
            key={ch}
            className={off ? "off" : ""}
            onClick={() => toggle(ch)}
            aria-pressed={!off}
            title={`${off ? "Ligar" : "Desligar"} ${l.name.toLowerCase()} (${l.key})`}
          >
            {l.icon}
            <span>{l.name}</span>
          </button>
        );
      })}
      <div className="settings-anchor" ref={panelRef}>
        <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" title="Ajustes">
          ⚙️
        </button>
        {open && (
          <div className="settings-panel" role="dialog" aria-label="Ajustes">
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
          </div>
        )}
      </div>
    </div>
  );
}
