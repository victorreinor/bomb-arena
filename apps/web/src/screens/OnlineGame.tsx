import { useEffect, useRef, useState } from "react";
import { TICK_RATE, type ClientMsg, type GameState, type Input, type RoomView } from "@bomberman/engine";
import { audio } from "../game/audio";
import { Effects } from "../game/effects";
import { diffGame, type GameEvent } from "../game/events";
import { combineInputs, useControls, type GamepadReader, type TouchPad } from "../game/controls";
import { feel } from "../game/haptics";
import { hudKey } from "../game/hud";
import { PredictedView, Predictor } from "../game/predict";
import { mapInfo, musicFor } from "../game/mapInfo";
import { Keyboard, PLAYER_KEYS } from "../game/input";
import { TouchControls } from "../game/TouchControls";
import { HudPlayer } from "../game/PlayerStats";
import { Podium, podiumEntries } from "../game/Podium";
import { canvasSize, render } from "../game/render";
import { MatchTimer, showsScore } from "../game/MatchTimer";
import { playSounds } from "../game/sfx";
import type { SnapshotBuffer } from "../game/snapshots";
import { loadSprites, type Sprites, type TileTheme } from "../game/sprites";

interface Props {
  room: RoomView;
  me: string;
  buffer: SnapshotBuffer;
  send: (msg: ClientMsg) => void;
  onLeave: () => void;
}

/** how often to offer the server an input while our clock isn't lined up with it yet, in ms */
const SYNC_RETRY_MS = 250;

/** Online, everything controls the same bomber: WASD, arrows, the first gamepad and the touch controls. */
function mergedInput(kb: Keyboard, pads: GamepadReader, touch: TouchPad): Input {
  return combineInputs(kb.poll(0), kb.poll(1), pads.poll(0), touch.poll());
}

export function OnlineGame({ room, me, buffer, send, onLeave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sprites, setSprites] = useState<Sprites | null>(null);
  const [hud, setHud] = useState<{ game: GameState; resultsIn: number } | null>(null);
  const { pads, touch, showTouch } = useControls();
  const sendRef = useRef(send);
  sendRef.current = send;

  const self = room.members.find((m) => m.id === me);
  const playing = !!self?.inGame;

  useEffect(() => {
    loadSprites().then(setSprites, console.error);
  }, []);

  useEffect(() => {
    if (!sprites || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const keyboard = new Keyboard(PLAYER_KEYS);
    const detach = keyboard.attach();
    let lastDx = 0;
    let lastDy = 0;
    let lastSentAt = -Infinity;
    let sized = false;
    let raf = 0;
    let lastHudKey = "";
    let lastLatest: GameState | null = null;
    let lastResultsIn = -2;
    const effects = new Effects();
    let prevEvent: GameState | null = null;
    // our own bomber runs ahead of the snapshots (see predict.ts); everything else plays back from them
    const predictor = new Predictor(me);
    const predicted = new PredictedView(me);

    const react = (events: GameEvent[], theme: TileTheme) => {
      playSounds(events, me);
      effects.spawn(events, theme);
      feel(events, me);
    };

    const frame = (now: number) => {
      if (playing) {
        const input = mergedInput(keyboard, pads, touch);
        const changed = input.dx !== lastDx || input.dy !== lastDy || input.bomb || input.action || input.pet;
        // until the server has acknowledged an input our clock isn't lined up and nothing is predicted:
        // keep offering it one, so the first step of the match already responds at once
        if (changed || (!predictor.synced && now - lastSentAt > SYNC_RETRY_MS)) {
          lastDx = input.dx;
          lastDy = input.dy;
          lastSentAt = now;
          sendRef.current({ t: "input", ...input, seq: predictor.record(input, now) });
        }
      }
      const sample = buffer.sample(now);
      if (sample) {
        const theme = mapInfo(sample.latest.mapId).theme;
        // sounds and effects follow the playback clock, so they line up with the picture
        for (const snap of buffer.takePlayed()) {
          if (prevEvent && snap.tick <= prevEvent.tick) {
            prevEvent = null; // a new round started
            effects.clear();
            predictor.reset();
          }
          if (prevEvent) react(predicted.withoutOwn(diffGame(prevEvent, snap)), theme);
          prevEvent = snap;
        }
        const shown = predicted.apply(sample.view, playing ? predictor.predict(sample.latest, buffer.acks, now) : null, now);
        react(shown.events, theme);
        if (!sized) {
          const size = canvasSize(sample.latest);
          canvas.width = size.width;
          canvas.height = size.height;
          sized = true;
        }
        render(ctx, shown.view, sprites, now, effects);
        // snapshots arrive at 30 Hz but frames at 60: only look at the HUD when there is something new
        if (sample.latest !== lastLatest || buffer.resultsIn !== lastResultsIn) {
          lastLatest = sample.latest;
          lastResultsIn = buffer.resultsIn;
          const key = hudKey(sample.latest, buffer.resultsIn);
          if (key !== lastHudKey) {
            lastHudKey = key;
            setHud({ game: sample.latest, resultsIn: buffer.resultsIn });
            audio.playMusic(musicFor(sample.latest)); // follows the state: also right after joining mid-match
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      detach();
    };
  }, [sprites, playing, buffer, me, pads, touch]);

  const game = hud?.game;
  const nameOf = (id: string) => room.members.find((m) => m.id === id)?.name ?? "(saiu)";
  const finished = game?.phase === "finished" ? game : undefined;
  const winner = finished?.players.find((p) => p.id === finished.winner);
  const podium = finished ? podiumEntries(finished, nameOf) : [];
  const secondsLeft = hud && hud.resultsIn > 0 ? Math.ceil(hud.resultsIn / TICK_RATE) : null;

  return (
    <div className="game-page">
      <div className="game-top">
        <h1>Sala {room.code}</h1>
        {game && <MatchTimer game={game} />}
        <button className="ghost" onClick={onLeave}>Sair</button>
      </div>
      {!playing && <p className="notice">Partida em andamento — você entra na próxima. Assistindo!</p>}
      {game?.players.some((p) => p.id === me && !p.alive && p.ghost) && game.phase === "playing" && (
        <p className="notice">👻 Você virou fantasma: ande pela borda e jogue bombas para dentro com Espaço ou Enter.</p>
      )}
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
            {room.lastResult?.seriesWon && <p className="champion-banner">🏆 {room.lastResult.winnerName} venceu a série!</p>}
            {showsScore(room) && (
              <p>Placar: {room.members.map((m) => `${m.name} ${m.score}`).join(" · ")}</p>
            )}
            {secondsLeft !== null && <p>Voltando ao lobby em {secondsLeft}s…</p>}
          </div>
        )}
      </div>
      {showTouch && playing && <TouchControls pad={touch} />}
      <p>Mover: WASD, setas ou controle · Bomba: Espaço/Enter (A) · Ação: Shift (B) · Pet: E ou / (Y)</p>
    </div>
  );
}
