import { useEffect, useRef, useState } from "react";
import { TICK_RATE, type ClientMsg, type GameState, type Input, type RoomView } from "@bomb-arena/engine";
import { audio } from "../game/audio";
import { Effects } from "../game/effects";
import { diffGame, type GameEvent } from "../game/events";
import { combineInputs, useControls, type GamepadReader, type TouchPad } from "../game/controls";
import { GameFrame } from "../game/GameFrame";
import { feel } from "../game/haptics";
import { hudKey } from "../game/hud";
import { PredictedView, Predictor } from "../game/predict";
import { mapInfo, musicFor } from "../game/mapInfo";
import { Keyboard, PLAYER_KEYS } from "../game/input";
import { HudPlayer } from "../game/PlayerStats";
import { PingBadge } from "../game/PingBadge";
import { Podium } from "../game/Podium";
import { canvasSize, render } from "../game/render";
import { MatchTimer, showsScore } from "../game/MatchTimer";
import { playSounds } from "../game/sfx";
import type { SnapshotBuffer } from "../game/snapshots";
import { loadSprites, type Sprites, type TileTheme } from "../game/sprites";
import { TEAM_NAMES, startTags, victorLabel } from "../game/teams";

interface Props {
  room: RoomView;
  me: string;
  buffer: SnapshotBuffer;
  send: (msg: ClientMsg) => void;
  ping: number | null;
  onLeave: () => void;
}

/** how often to offer the server an input while our clock isn't lined up with it yet, in ms */
const SYNC_RETRY_MS = 250;

/** Online, everything controls the same bomber: WASD, arrows, the first gamepad and the touch controls. */
function mergedInput(kb: Keyboard, pads: GamepadReader, touch: TouchPad): Input {
  return combineInputs(kb.poll(0), kb.poll(1), pads.poll(0), touch.poll());
}

export function OnlineGame({ room, me, buffer, send, ping, onLeave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sprites, setSprites] = useState<Sprites | null>(null);
  const [hud, setHud] = useState<{ game: GameState; resultsIn: number } | null>(null);
  const { pads, touch } = useControls();
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
    // who to point out as the match starts: known from its first snapshot (the teams are in it)
    let tags: Record<string, string> | null = null;

    /** Sends what the controls say when it's news, or (until an input is acknowledged) every so often. */
    const pushInput = (now: number) => {
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
    };
    // frames stop in a hidden tab (another tab, another app): the server would keep the last direction
    // walking until we came back, so let go of the controls and say so now
    const standStill = () => {
      if (!document.hidden) return;
      keyboard.release();
      touch.release();
      pushInput(performance.now());
    };
    if (playing) document.addEventListener("visibilitychange", standStill);

    const react = (events: GameEvent[], theme: TileTheme) => {
      playSounds(events, me);
      effects.spawn(events, theme);
      feel(events, me);
    };

    const frame = (now: number) => {
      if (playing) pushInput(now);
      const sample = buffer.sample(now);
      if (sample) {
        const theme = mapInfo(sample.latest.mapId).theme;
        // sounds and effects follow the playback clock, so they line up with the picture
        for (const snap of buffer.takePlayed()) {
          if (prevEvent && snap.tick <= prevEvent.tick) {
            prevEvent = null; // a new round started
            tags = null;
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
        tags ??= playing ? startTags(sample.latest, me) : {};
        render(ctx, shown.view, sprites, now, effects, tags);
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
      document.removeEventListener("visibilitychange", standStill);
    };
  }, [sprites, playing, buffer, me, pads, touch]);

  const game = hud?.game;
  const nameOf = (id: string) => room.members.find((m) => m.id === id)?.name ?? "(saiu)";
  const finished = game?.phase === "finished" ? game : undefined;
  const winner = finished?.players.find((p) => p.id === finished.winner);
  const secondsLeft = hud && hud.resultsIn > 0 ? Math.ceil(hud.resultsIn / TICK_RATE) : null;
  const haunting = game?.phase === "playing" && game.players.some((p) => p.id === me && !p.alive && p.ghost);

  return (
    <GameFrame
      title={`Sala ${room.code}`}
      status={
        <>
          {game && <MatchTimer game={game} />}
          <PingBadge ms={ping} />
        </>
      }
      players={game?.players.map((p) => (
        <HudPlayer
          key={p.id}
          p={p}
          me={p.id === me}
          label={p.id === me ? <>{nameOf(p.id)}<span className="desktop-only"> (você)</span></> : nameOf(p.id)}
        />
      ))}
      notice={
        !playing ? (
          <p className="notice">Partida em andamento — você entra na próxima. Assistindo!</p>
        ) : haunting ? (
          <p className="notice">
            👻 Você virou fantasma: ande pela borda e jogue bombas para dentro com{" "}
            <span className="desktop-only">Espaço ou Enter</span>
            <span className="phone-only">o 💣</span>.
          </p>
        ) : null
      }
      canvasRef={canvasRef}
      size={game ? canvasSize(game) : null}
      overlay={
        finished && (
          <div className="overlay podium-overlay">
            <h2>{winner ? `${winner.team !== null ? TEAM_NAMES[winner.team] : nameOf(winner.id)} venceu!` : "Empate!"}</h2>
            <Podium game={finished} nameOf={nameOf} />
            {room.lastResult?.seriesWon && <p className="champion-banner">🏆 {victorLabel(room.lastResult)} venceu a série!</p>}
            {showsScore(room) && <p>Placar: {room.members.map((m) => `${m.name} ${m.score}`).join(" · ")}</p>}
            {secondsLeft !== null && <p>Voltando ao lobby em {secondsLeft}s…</p>}
          </div>
        )
      }
      hint={<p>Mover: WASD, setas ou controle · Bomba: Espaço/Enter (A) · Ação: Shift (B) · Pet: E ou / (Y)</p>}
      pad={playing ? touch : null}
      onLeave={onLeave}
    />
  );
}
