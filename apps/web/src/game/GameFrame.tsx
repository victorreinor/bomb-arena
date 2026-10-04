import { useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { readPref, writePref } from "../config";
import type { TouchPad } from "./controls";
import { canFullscreen, installedQuery, leaveFullscreen, playSideways, useFullscreen, useMedia } from "./screenMode";
import { ChannelToggles, SettingsFields, SettingsMenu } from "./SoundToggle";
import { TouchControls } from "./TouchControls";

/**
 * Phones get their own layout. Read once: switching layouts mid-match would swap the canvas the game
 * loop draws on. Text that only makes sense with keys (or only on a phone) is marked `desktop-only` (or
 * `phone-only`) and the stylesheet shows the right one, so the screens needn't know which they're on.
 */
const phone = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

interface Props {
  title: ReactNode;
  /** a line of key hints, on computers */
  hint?: ReactNode;
  timer: ReactNode;
  players: ReactNode;
  /** news about this player (watching, turned into a ghost, an error); on phones it sits on the board */
  notice?: ReactNode;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** the canvas's size in pixels, once there is a match */
  size: { width: number; height: number } | null;
  /** drawn over the board (the podium) */
  overlay?: ReactNode;
  /** the on-screen controls (phones), while this player is in the match */
  pad: TouchPad | null;
  onLeave: () => void;
}

/** The page around a match, online or local: title bar, players, the board and, on phones, the touch controls. */
export function GameFrame(props: Props) {
  return phone ? <PhoneFrame {...props} /> : <DesktopFrame {...props} />;
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

/** how long the tip on holding a hand-turned phone stays up, in ms */
const TIP_MS = 7000;

/**
 * Upright: title bar, players in one row, the board edge to edge, the controls under the thumbs.
 * Sideways: players and d-pad on the left, the board at full height, title bar and buttons on the right.
 * The board takes the biggest size that fits what's left (see styles.css, "phones"). Sideways is the
 * phone turned, or, where the browser can't turn the screen for us, the page turned by hand.
 */
function PhoneFrame({ title, timer, players, notice, canvasRef, size, overlay, pad, onLeave }: Props) {
  const landscape = useMedia("(orientation: landscape)");
  const installed = useMedia(installedQuery);
  const full = useFullscreen();
  /** asked to lie down where the browser can't turn the screen (iPhones): the page itself is rotated */
  const [turned, setTurned] = useState(false);
  const [tip, setTip] = useState(false);
  // once the phone itself is sideways the page needn't be, and turned back upright it stays upright
  if (turned && landscape) setTurned(false);

  useEffect(() => {
    // the stylesheet holds the screen still (touch-action), but iPhones pinch-zoom regardless: cancel the gesture itself
    const cancel = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", cancel);
    return () => document.removeEventListener("gesturestart", cancel);
  }, []);
  useEffect(() => {
    if (!tip) return;
    const timer = setTimeout(() => setTip(false), TIP_MS);
    return () => clearTimeout(timer);
  }, [tip]);

  const lieDown = async () => {
    if (await playSideways()) return;
    setTurned(true);
    if (readPref("turnTip")) return; // how to hold the phone is shown once
    writePref("turnTip", "1");
    setTip(true);
  };
  const standUp = () => {
    setTurned(false);
    setTip(false);
  };
  // upright: lie down; turned by hand: stand back up; sideways: full screen, if there is one to have
  const turn = turned
    ? { label: "⟲ Em pé", title: "Voltar o jogo para a tela em pé", act: standUp }
    : !landscape
      ? { label: "⟳ Deitar", title: "Jogar com o celular deitado", act: lieDown }
      : canFullscreen && !full && !installed
        ? { label: "⛶ Tela cheia", title: "Jogar em tela cheia", act: () => void playSideways() }
        : null;

  return (
    <div className={`game-page touch${landscape || turned ? " sideways" : ""}${turned ? " turned" : ""}`}>
      <div className="game-top">
        <h1>{title}</h1>
        {timer}
        {turn && (
          <button onClick={turn.act} title={turn.title}>
            {turn.label}
          </button>
        )}
        {/* during a match on a phone, sound, settings and leaving live behind one button, out of the thumbs' way */}
        <SettingsMenu className="game-menu" label="Menu da partida">
          <div className="menu-channels">
            <ChannelToggles />
          </div>
          <SettingsFields />
          {full && <button onClick={leaveFullscreen}>Sair da tela cheia</button>}
          <button className="leave" onClick={onLeave}>
            Sair da partida
          </button>
        </SettingsMenu>
      </div>
      <div className="hud">{players}</div>
      <div className="stage-area">
        {/* sized by the stylesheet to the biggest that fits the area, from the board's proportions */}
        <div className="stage" style={size ? ({ "--ratio": size.width / size.height } as CSSProperties) : undefined}>
          <canvas ref={canvasRef} />
          {(notice || tip) && (
            <div className="stage-notices">
              {notice}
              {tip && (
                <p className="notice">
                  Deite o celular com o topo para a esquerda.
                  {!installed && " Para tirar as barras do Safari: Compartilhar → Adicionar à Tela de Início."}
                </p>
              )}
            </div>
          )}
          {overlay}
        </div>
      </div>
      {pad && <TouchControls pad={pad} />}
    </div>
  );
}
