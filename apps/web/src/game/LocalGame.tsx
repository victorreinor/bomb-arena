import { useCallback, useEffect, useRef, useState } from "react";
import { CLASSIC, TICK_MS, createGame, randomSeed, step, type GameState } from "@bomberman/engine";
import { audio } from "./audio";
import { COLOR_NAMES } from "./colors";
import { Effects } from "./effects";
import { diffGame } from "./events";
import { Keyboard, PLAYER_KEYS } from "./input";
import { HudPlayer } from "./PlayerStats";
import { Podium, podiumEntries } from "./Podium";
import { canvasSize, render } from "./render";
import { playSounds } from "./sfx";
import { lerpState } from "./snapshots";
import { loadSprites, type Sprites } from "./sprites";

const KEY_HINTS = ["WASD + Espaço + Shift esq.", "Setas + Enter + Shift dir."];

const newGame = (): GameState => {
  const state = createGame({
    map: CLASSIC,
    seed: randomSeed(),
    players: [
      { id: "p1", color: 0 },
      { id: "p2", color: 2 },
    ],
  });
  // handy for trying things out: open the local mode with ?itens=todos
  if (new URLSearchParams(location.search).get("itens") === "todos") {
    for (const p of state.players) {
      Object.assign(p, {
        bombsMax: 4, range: 4, speedLevel: 2, kick: true, punch: true, glove: true, remote: false,
        bombPass: false, wallPass: false, powerBomb: false, vest: true, lineCharges: 2,
      });
    }
  }
  return state;
};

/** Phase 1 sandbox: two humans on one keyboard, running the shared engine locally. */
export function LocalGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [round, setRound] = useState(0);
  const [hud, setHud] = useState<GameState | null>(null);
  const [sprites, setSprites] = useState<Sprites | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSprites().then(setSprites, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!sprites || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const state = newGame();
    const size = canvasSize(state);
    canvas.width = size.width;
    canvas.height = size.height;

    audio.playMusic("battle");
    const effects = new Effects();
    const keyboard = new Keyboard(PLAYER_KEYS);
    const detach = keyboard.attach();
    // frozen copies of the last two ticks: diffed for events, interpolated for drawing, shown in the HUD
    let previous = structuredClone(state);
    let current = previous;
    let acc = 0;
    let last = performance.now();
    let raf = 0;
    let lastHudTick = -Infinity;
    let hudPhase: GameState["phase"] | null = null;

    const frame = (now: number) => {
      acc += Math.min(now - last, 250);
      last = now;
      while (acc >= TICK_MS) {
        const inputs = Object.fromEntries(state.players.map((p, i) => [p.id, keyboard.poll(i)]));
        step(state, inputs);
        previous = current;
        current = structuredClone(state);
        const events = diffGame(previous, current);
        playSounds(events);
        effects.spawn(events);
        acc -= TICK_MS;
      }
      render(ctx, lerpState(previous, current, acc / TICK_MS), sprites, now, effects);
      // a few HUD refreshes per second while playing, and once when the match ends
      if ((current.phase === "playing" && current.tick - lastHudTick >= 6) || current.phase !== hudPhase) {
        lastHudTick = current.tick;
        hudPhase = current.phase;
        setHud(current);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      detach();
    };
  }, [sprites, round]);

  const restart = useCallback(() => setRound((r) => r + 1), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyR") restart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [restart]);

  const finished = hud?.phase === "finished" ? hud : undefined;
  const winner = finished?.players.find((p) => p.id === finished.winner);
  const label = (game: GameState, id: string) => {
    const i = game.players.findIndex((p) => p.id === id);
    return `J${i + 1} ${COLOR_NAMES[game.players[i].color]}`;
  };
  const podium = finished ? podiumEntries(finished, (id) => label(finished, id)) : [];

  return (
    <div className="game-page">
      <h1>Bomb Arena — modo local</h1>
      <p>Teste da Fase 1: dois jogadores no mesmo teclado. R reinicia.</p>
      {error && <p role="alert">Erro: {error}</p>}
      <div className="hud">
        {hud?.players.map((p, i) => (
          <HudPlayer key={p.id} p={p} label={`${label(hud, p.id)} · ${KEY_HINTS[i]}`} />
        ))}
      </div>
      <div className="stage" style={{ width: hud ? canvasSize(hud).width : undefined }}>
        <canvas ref={canvasRef} />
        {finished && (
          <div className="overlay podium-overlay">
            <h2>{winner ? `${COLOR_NAMES[winner.color]} venceu!` : "Empate!"}</h2>
            <Podium entries={podium} />
            <button onClick={restart}>Jogar de novo (R)</button>
          </div>
        )}
      </div>
    </div>
  );
}
