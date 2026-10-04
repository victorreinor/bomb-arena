import { useEffect, useRef, type PointerEvent } from "react";
import { fourWay, type TouchPad } from "./controls";
import { buzz } from "./haptics";

/** On-screen d-pad and buttons for phones; they write into a TouchPad the game loop reads. */
export function TouchControls({ pad }: { pad: TouchPad }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // iPhones turn a held or double touch into text selection, the magnifier or a zoom; the controls run on
    // pointer events, which carry on regardless. (React's touch listeners are passive, so this one is native.)
    const el = root.current;
    if (!el) return;
    const hold = (e: TouchEvent) => e.preventDefault();
    el.addEventListener("touchstart", hold, { passive: false });
    return () => el.removeEventListener("touchstart", hold);
  }, []);

  /**
   * The finger's offset from the d-pad's centre, in the d-pad's own coordinates (offsetX/Y undo any
   * transform, so this holds on a page turned by hand too). It is the target throughout: it captures the
   * pointer, and the arrows let touches through.
   */
  const steer = (e: PointerEvent<HTMLDivElement>) => {
    const { clientWidth: w, clientHeight: h } = e.currentTarget;
    const dir = fourWay(e.nativeEvent.offsetX - w / 2, e.nativeEvent.offsetY - h / 2, w * 0.12);
    pad.dx = dir.dx;
    pad.dy = dir.dy;
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
    <div className="touch-controls" ref={root}>
      <div
        className="touch-dpad"
        aria-label="Direcional"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          steer(e);
        }}
        onPointerMove={(e) => e.buttons > 0 && steer(e)}
        onPointerUp={() => pad.release()}
        onPointerCancel={() => pad.release()}
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
