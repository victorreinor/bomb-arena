import { useEffect, useState } from "react";
import { audio } from "./audio";

/** Two independent switches: background music and sound effects. */
export function SoundToggle() {
  const [musicOff, setMusicOff] = useState(audio.musicMuted);
  const [sfxOff, setSfxOff] = useState(audio.sfxMuted);

  const toggleMusic = () => {
    audio.setMusicMuted(!audio.musicMuted);
    setMusicOff(audio.musicMuted);
  };
  const toggleSfx = () => {
    audio.setSfxMuted(!audio.sfxMuted);
    setSfxOff(audio.sfxMuted);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === "KeyM") toggleMusic();
      else if (e.code === "KeyN") toggleSfx();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="sound-controls">
      <button
        className={musicOff ? "off" : ""}
        onClick={toggleMusic}
        aria-pressed={!musicOff}
        title={musicOff ? "Ligar música (M)" : "Desligar música (M)"}
      >
        🎵<span>Música</span>
      </button>
      <button
        className={sfxOff ? "off" : ""}
        onClick={toggleSfx}
        aria-pressed={!sfxOff}
        title={sfxOff ? "Ligar efeitos (N)" : "Desligar efeitos (N)"}
      >
        💥<span>Efeitos</span>
      </button>
    </div>
  );
}
