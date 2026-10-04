import { useRef, type PointerEvent } from "react";
import { fourWay, type TouchPad } from "./controls";
import { buzz } from "./haptics";

/** On-screen d-pad and buttons for phones; they write into a TouchPad the game loop reads. */
export function TouchControls({ pad }: { pad: TouchPad }) {
  /** the d-pad's box, measured once per touch rather than on every move */
  const box = useRef<DOMRect | null>(null);

  const steer = (e: PointerEvent<HTMLDivElement>) => {
    const b = (box.current ??= e.currentTarget.getBoundingClientRect());
    const dir = fourWay(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2), b.width * 0.12);
    pad.dx = dir.dx;
    pad.dy = dir.dy;
  };
  const release = () => {
    pad.dx = pad.dy = 0;
    box.current = null;
  };

  const button = (kind: "bomb" | "action" | "pet", label: string) => (
    <button
      type="button"
      className={`touch-btn touch-${kind}`}
      onPointerDown={(e) => {
        e.preventDefault();
        pad.press(kind);
        buzz("tap");
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="touch-controls">
      <div
        className="touch-dpad"
        aria-label="Direcional"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          box.current = null;
          steer(e);
        }}
        onPointerMove={(e) => e.buttons > 0 && steer(e)}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <span className="arrow up">▲</span>
        <span className="arrow left">◀</span>
        <span className="arrow right">▶</span>
        <span className="arrow down">▼</span>
      </div>
      <div className="touch-buttons">
        {button("pet", "Pet")}
        {button("action", "Ação")}
        {button("bomb", "💣")}
      </div>
    </div>
  );
}
