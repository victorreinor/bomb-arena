import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { TouchPad } from "./controls";
import { canFullscreen, leaveFullscreen, playSideways, useFullscreen, useMedia } from "./screenMode";
import { ChannelToggles, SettingsFields, usePopover } from "./SoundToggle";
import { TouchControls } from "./TouchControls";

interface Size {
  width: number;
  height: number;
}

interface Props {
  title: string;
  /** a line of key hints, on computers */
  hint?: ReactNode;
  timer: ReactNode;
  players: ReactNode;
  /** news about this player (watching, turned into a ghost, an error); on phones it sits on the board */
  notice?: ReactNode;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** the canvas's size in pixels, once there is a match */
  size: Size | null;
  /** drawn over the board (the podium) */
  overlay?: ReactNode;
  /** phone layout: the board fills the screen, upright or sideways, and the settings move into a menu */
  touch: boolean;
  /** the on-screen controls, while this player is in the match */
  pad: TouchPad | null;
  onLeave: () => void;
}

/** The page around a match, online or local: title bar, players, the board and, on phones, the touch controls. */
export function GameFrame(props: Props) {
  return props.touch ? <PhoneFrame {...props} /> : <DesktopFrame {...props} />;
}

function DesktopFrame({ title, hint, timer, players, notice, canvasRef, size, overlay, onLeave }: Props) {
  return (
    <div className="game-page">
      <div className="game-top">
        <h1>{title}</h1>
        {timer}
        <button className="ghost" onClick={onLeave}>
          Sair
        </button>
      </div>
      {notice}
      <div className="hud">{players}</div>
      <div className="stage" style={{ width: size?.width }}>
        <canvas ref={canvasRef} />
        {overlay}
      </div>
      {hint}
    </div>
  );
}

/**
 * Upright: title bar, players in one row, the board edge to edge, the controls under the thumbs.
 * Sideways: players and d-pad on the left, the board at full height, title bar and buttons on the right.
 * The board takes the biggest size that fits what's left (see styles.css, "phones").
 */
function PhoneFrame({ title, timer, players, notice, canvasRef, size, overlay, pad, onLeave }: Props) {
  const area = useRef<HTMLDivElement>(null);
  const fit = useFit(area, size);
  useEffect(() => {
    // the stylesheet holds the screen still (touch-action), but iPhones pinch-zoom regardless: cancel the gesture itself
    const cancel = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", cancel);
    return () => document.removeEventListener("gesturestart", cancel);
  }, []);
  return (
    <div className="game-page touch">
      <div className="game-top">
        <h1>{title}</h1>
        {timer}
        <SidewaysButton />
        <GameMenu onLeave={onLeave} />
      </div>
      <div className="hud">{players}</div>
      <div className="stage-area" ref={area}>
        <div className="stage" style={fit ?? undefined}>
          <canvas ref={canvasRef} />
          {notice && <div className="stage-notices">{notice}</div>}
          {overlay}
        </div>
      </div>
      {pad && <TouchControls pad={pad} />}
    </div>
  );
}

/** The largest size with `size`'s proportions that fits in the element's box, following it as the phone turns. */
function useFit(ref: RefObject<HTMLElement | null>, size: Size | null): Size | null {
  const [fit, setFit] = useState<Size | null>(null);
  const width = size?.width;
  const height = size?.height;
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box || !width || !height) return;
    const measure = () => {
      const k = Math.min(box.clientWidth / width, box.clientHeight / height);
      setFit({ width: Math.floor(width * k), height: Math.floor(height * k) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [ref, width, height]);
  return fit;
}

/** Turns the screen sideways and full (where the browser allows it); gone once it is full screen. */
function SidewaysButton() {
  const full = useFullscreen();
  const sideways = useMedia("(orientation: landscape)");
  // an app installed on the home screen is already full screen: it only needs turning
  const installed = useMedia("(display-mode: fullscreen)");
  if (!canFullscreen || full || (installed && sideways)) return null;
  return (
    <button className="sideways" onClick={playSideways} title="Jogar com o celular deitado, em tela cheia">
      {sideways ? "⛶ Tela cheia" : "⟳ Deitar"}
    </button>
  );
}

/** During a match on a phone, sound, settings and leaving live behind one button, out of the thumbs' way. */
function GameMenu({ onLeave }: { onLeave: () => void }) {
  const { open, setOpen, ref } = usePopover();
  const full = useFullscreen();
  return (
    <div className="settings-anchor game-menu" ref={ref}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" title="Menu">
        ⚙️
      </button>
      {open && (
        <div className="settings-panel" role="dialog" aria-label="Menu da partida">
          <div className="menu-channels">
            <ChannelToggles />
          </div>
          <SettingsFields />
          {full && <button onClick={leaveFullscreen}>Sair da tela cheia</button>}
          <button className="leave" onClick={onLeave}>
            Sair da partida
          </button>
        </div>
      )}
    </div>
  );
}
