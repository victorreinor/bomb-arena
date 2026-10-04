import { useEffect, useRef, useState } from "react";
import { TICK_RATE, type ClientMsg, type GameState, type Input, type RoomView } from "@bomberman/engine";
import { audio } from "../game/audio";
import { Effects } from "../game/effects";
import { diffGame } from "../game/events";
import { Keyboard, PLAYER_KEYS } from "../game/input";
import { HudPlayer } from "../game/PlayerStats";
import { Podium, podiumEntries } from "../game/Podium";
import { canvasSize, render } from "../game/render";
import { playSounds } from "../game/sfx";
import type { SnapshotBuffer } from "../game/snapshots";
import { loadSprites, type Sprites } from "../game/sprites";

interface Props {
  room: RoomView;
  me: string;
  buffer: SnapshotBuffer;
  send: (msg: ClientMsg) => void;
}

/** Player fields that change every tick but are not shown in the HUD. */
const NOT_IN_HUD = new Set(["x", "y", "moving", "facing", "passing", "invuln", "holding"]);

/** Everything the HUD shows, as a string: the HUD only re-renders when this changes. */
function hudKey(game: GameState, resultsIn: number): string {
  const seconds = resultsIn > 0 ? Math.ceil(resultsIn / TICK_RATE) : -1;
  return `${game.phase}|${seconds}|${JSON.stringify(game.players, (k, v) => (NOT_IN_HUD.has(k) ? undefined : v))}`;
}

/** WASD and arrows both control the same bomber online. */
function mergedInput(kb: Keyboard): Input {
  const a = kb.poll(0);
  const b = kb.poll(1);
  const horizontal = a.dx !== 0 || a.dy !== 0 ? a : b;
  return { dx: horizontal.dx, dy: horizontal.dy, bomb: a.bomb || b.bomb, action: a.action || b.action };
}

export function OnlineGame({ room, me, buffer, send }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sprites, setSprites] = useState<Sprites | null>(null);
  const [hud, setHud] = useState<{ game: GameState; resultsIn: number } | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  const self = room.members.find((m) => m.id === me);
  const playing = !!self?.inGame;

  useEffect(() => {
    loadSprites().then(setSprites, console.error);
    audio.playMusic("battle");
  }, []);

  useEffect(() => {
    if (!sprites || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const keyboard = new Keyboard(PLAYER_KEYS);
    const detach = keyboard.attach();
    let lastDx = 0;
    let lastDy = 0;
    let sized = false;
    let raf = 0;
    let lastHudKey = "";
    const effects = new Effects();
    let prevEvent: GameState | null = null;

    const frame = (now: number) => {
      if (playing) {
        const input = mergedInput(keyboard);
        if (input.dx !== lastDx || input.dy !== lastDy || input.bomb || input.action) {
          lastDx = input.dx;
          lastDy = input.dy;
          sendRef.current({ t: "input", ...input });
        }
      }
      const sample = buffer.sample(now);
      if (sample) {
        // sounds and effects follow the playback clock, so they line up with the picture
        for (const snap of buffer.takePlayed()) {
          if (prevEvent && snap.tick <= prevEvent.tick) {
            prevEvent = null; // a new round started
            effects.clear();
          }
          if (prevEvent) {
            const events = diffGame(prevEvent, snap);
            playSounds(events, me);
            effects.spawn(events);
          }
          prevEvent = snap;
        }
        if (!sized) {
          const size = canvasSize(sample.latest);
          canvas.width = size.width;
          canvas.height = size.height;
          sized = true;
        }
        render(ctx, sample.view, sprites, now, effects);
        const key = hudKey(sample.latest, buffer.resultsIn);
        if (key !== lastHudKey) {
          lastHudKey = key;
          setHud({ game: sample.latest, resultsIn: buffer.resultsIn });
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      detach();
    };
  }, [sprites, playing, buffer, me]);

  const game = hud?.game;
  const nameOf = (id: string) => room.members.find((m) => m.id === id)?.name ?? "—";
  const finished = game?.phase === "finished" ? game : undefined;
  const winner = finished?.players.find((p) => p.id === finished.winner);
  const podium = finished ? podiumEntries(finished, nameOf) : [];
  const secondsLeft = hud && hud.resultsIn > 0 ? Math.ceil(hud.resultsIn / TICK_RATE) : null;

  return (
    <div className="game-page">
      <h1>Sala {room.code}</h1>
      {!playing && <p className="notice">Partida em andamento — você entra na próxima. Assistindo!</p>}
      <div className="hud">
        {game?.players.map((p) => (
          <HudPlayer key={p.id} p={p} label={`${nameOf(p.id)}${p.id === me ? " (você)" : ""}`} />
        ))}
      </div>
      <div className="stage" style={{ width: game ? canvasSize(game).width : undefined }}>
        <canvas ref={canvasRef} />
        {finished && (
          <div className="overlay podium-overlay">
            <h2>{winner ? `${nameOf(winner.id)} venceu!` : "Empate!"}</h2>
            <Podium entries={podium} />
            {secondsLeft !== null && <p>Voltando ao lobby em {secondsLeft}s…</p>}
          </div>
        )}
      </div>
      <p>Mover: WASD ou setas · Bomba: Espaço ou Enter · Ação (soco, luva, remoto): Shift</p>
    </div>
  );
}
