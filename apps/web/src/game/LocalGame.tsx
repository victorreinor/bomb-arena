import { useCallback, useEffect, useRef, useState } from "react";
import {
  CLASSIC,
  DEFAULT_TIME_LIMIT,
  MAPS,
  PET_KINDS,
  TICK_MS,
  TICK_RATE,
  botId,
  botInput,
  botName,
  createGame,
  isBotId,
  minutesToTicks,
  randomSeed,
  step,
  type BotLevel,
  type GameState,
  type PetKind,
} from "@bomberman/engine";
import { audio } from "./audio";
import { BOT_LEVEL_NAMES } from "./botLevels";
import { COLOR_NAMES } from "./colors";
import { Effects } from "./effects";
import { diffGame } from "./events";
import { combineInputs, useControls } from "./controls";
import { hudKey } from "./hud";
import { mapInfo, musicFor } from "./mapInfo";
import { Keyboard, PLAYER_KEYS } from "./input";
import { TouchControls } from "./TouchControls";
import { MatchTimer } from "./MatchTimer";
import { HudPlayer } from "./PlayerStats";
import { Podium, podiumEntries } from "./Podium";
import { canvasSize, render } from "./render";
import { playSounds } from "./sfx";
import { lerpState } from "./snapshots";
import { loadSprites, type Sprites } from "./sprites";

const KEY_HINTS = ["WASD · Espaço · Shift esq. · E (pet)", "Setas · Enter · Shift dir. · / (pet)"];

/** how many bots the practice mode puts against you */
const PRACTICE_BOTS = 3;

const newGame = (bots: BotLevel | null): GameState => {
  // handy for trying things out: ?itens=todos starts with items and pets, ?pet=<kind> picks the pet,
  // ?vinganca=1 turns revenge mode on, ?tempo=<seconds> shortens the clock (to try sudden death)
  const params = new URLSearchParams(location.search);
  const state = createGame({
    // practice against bots on a random map; two people on one keyboard play the classic
    map: bots ? MAPS[Math.floor(Math.random() * MAPS.length)] : CLASSIC,
    revenge: params.get("vinganca") === "1",
    timeLimitTicks: Number(params.get("tempo")) * TICK_RATE || minutesToTicks(DEFAULT_TIME_LIMIT),
    seed: randomSeed(),
    players: bots
      ? [{ id: "p1", color: 0 }, ...Array.from({ length: PRACTICE_BOTS }, (_, i) => ({ id: botId(i + 1), color: i + 1 }))]
        : [
            { id: "p1", color: 0 },
            { id: "p2", color: 2 },
          ],
  });
  if (params.get("itens") === "todos") {
    state.players.forEach((p, i) => {
      Object.assign(p, {
        bombsMax: 4, range: 4, speedLevel: 2, kick: true, punch: true, glove: true, remote: false,
        bombPass: false, wallPass: false, powerBomb: false, vest: true, lineCharges: 2,
      });
      const wanted = params.get("pet") as PetKind | null;
      const kind = wanted && PET_KINDS.includes(wanted) ? wanted : PET_KINDS[i % PET_KINDS.length];
      p.pet = { kind, cooldown: 0, dashTicks: 0 };
    });
  }
  return state;
};

/** Offline play with the shared engine: two people on one keyboard (`bots` null), or one person against bots of that level. */
export function LocalGame({ bots }: { bots: BotLevel | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [round, setRound] = useState(0);
  const [hud, setHud] = useState<GameState | null>(null);
  const [sprites, setSprites] = useState<Sprites | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { pads, touch, showTouch } = useControls();

  useEffect(() => {
    loadSprites().then(setSprites, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!sprites || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const state = newGame(bots);
    const size = canvasSize(state);
    canvas.width = size.width;
    canvas.height = size.height;

    const effects = new Effects();
    const keyboard = new Keyboard(PLAYER_KEYS);
    const detach = keyboard.attach();
    // frozen copies of the last two ticks: diffed for events, interpolated for drawing, shown in the HUD
    let previous = structuredClone(state);
    let current = previous;
    let acc = 0;
    let last = performance.now();
    let raf = 0;
    let lastHudKey = "";

    const frame = (now: number) => {
      acc += Math.min(now - last, 250);
      last = now;
      const ticked = acc >= TICK_MS;
      while (acc >= TICK_MS) {
        // player i: their keys plus the i-th gamepad; the touch controls drive player 1
        const inputs = Object.fromEntries(
          state.players.map((p, i) => [
            p.id,
            bots && isBotId(p.id)
              ? botInput(state, p.id, bots)
              : // against bots both keyboard layouts drive the one human
                combineInputs(keyboard.poll(i), pads.poll(i), i === 0 ? touch.poll() : null, bots ? keyboard.poll(1) : null),
          ]),
        );
        step(state, inputs);
        previous = current;
        current = structuredClone(state);
        const events = diffGame(previous, current);
        playSounds(events);
        effects.spawn(events, mapInfo(current.mapId).theme);
        acc -= TICK_MS;
      }
      render(ctx, lerpState(previous, current, acc / TICK_MS), sprites, now, effects);
      // ticks come at 30 Hz, frames at 60: the HUD can only have changed when a tick ran
      const key = ticked ? hudKey(current) : lastHudKey;
      if (key !== lastHudKey) {
        lastHudKey = key;
        setHud(current);
        audio.playMusic(musicFor(current));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      detach();
    };
  }, [sprites, round, pads, touch, bots]);

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
    if (isBotId(id)) return `🤖 ${botName(id)}`;
    return bots ? "Você" : `J${i + 1} ${COLOR_NAMES[game.players[i].color]}`;
  };
  const podium = finished ? podiumEntries(finished, (id) => label(finished, id)) : [];

  return (
    <div className="game-page">
      <h1>{bots ? `Treino contra bots · ${BOT_LEVEL_NAMES[bots]}` : "Bomb Arena — modo local"}</h1>
      <p>{bots ? "WASD/setas, Espaço/Enter, Shift, E · ou controle." : "Dois jogadores no mesmo teclado."} R reinicia.</p>
      {hud && <MatchTimer game={hud} />}
      {error && <p role="alert">Erro: {error}</p>}
      <div className="hud">
        {hud?.players.map((p, i) => (
          <HudPlayer key={p.id} p={p} label={bots ? label(hud, p.id) : `${label(hud, p.id)} · ${KEY_HINTS[i]}`} />
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
      {showTouch && <TouchControls pad={touch} />}
    </div>
  );
}
