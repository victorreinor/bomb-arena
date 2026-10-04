import { describe, expect, test } from "bun:test";
import { BASE_SPEED, TICK_MS, TICK_RATE, step, toSnapshot, type GameSnapshot, type GameState } from "@bomberman/engine";
import { corridor, makeGame, testBomb } from "../../../packages/engine/test/helpers";
import { SnapshotBuffer, lerpPlayer, lerpState } from "../src/game/snapshots";
import { FRAME_MS } from "./loopback";

/** how far p1 walks per tick: in the walking corridor its x tells which tick the playback is at */
const STEP = BASE_SPEED / TICK_RATE;

/** A snapshot as it comes off the wire (board included when `tiles`). */
const wire = (game: GameState, tiles = true): GameSnapshot => JSON.parse(JSON.stringify(toSnapshot(game, tiles)));

/**
 * p1 walks down a long corridor, a snapshot a tick, each reaching us at `arrival(tick)` (one connection:
 * a late one holds up those behind it). For each frame: the newest tick and the tick the playback is at.
 */
function playback(arrival: (tick: number) => number, ms: number) {
  const game = makeGame(corridor("1" + ".".repeat(60) + "2"));
  const buffer = new SnapshotBuffer();
  const queue: { at: number; snap: GameSnapshot }[] = [];
  for (let last = -Infinity; game.tick < ms / TICK_MS + 10; ) {
    step(game, { p1: { dx: 1 } });
    last = Math.max(last, arrival(game.tick));
    queue.push({ at: last, snap: wire(game, game.tick === 1) });
  }
  const frames: { now: number; newest: number; at: number }[] = [];
  for (let now = FRAME_MS; now <= ms; now += FRAME_MS) {
    while (queue[0].at <= now) {
      const { at, snap } = queue.shift()!;
      buffer.push(1, -1, snap, at);
    }
    const sample = buffer.sample(now);
    if (sample) frames.push({ now, newest: sample.latest.tick, at: (sample.view.players[0].x - 1.5) / STEP });
  }
  return frames;
}

const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
/** how many ticks the playback runs behind the newest snapshot, on average after the first two seconds */
const behind = (frames: ReturnType<typeof playback>) => average(frames.filter((f) => f.now > 2000).map((f) => f.newest - f.at));

describe("SnapshotBuffer", () => {
  test("on a steady connection it plays one tick behind the newest snapshot, moving on smoothly", () => {
    const frames = playback((tick) => tick * TICK_MS + 60, 4000);
    expect(behind(frames)).toBeCloseTo(1, 0);
    for (let i = 1; i < frames.length; i++) expect(frames[i].at).toBeGreaterThanOrEqual(frames[i - 1].at);
  });

  test("when snapshots turn up late now and then it falls further back (three ticks at most) so it never runs dry", () => {
    const frames = playback((tick) => tick * TICK_MS + 60 + (tick % 10 === 0 ? 80 : 0), 4000);
    expect(behind(frames)).toBeGreaterThan(1.8);
    expect(behind(frames)).toBeLessThan(3.2);
    // once it has measured the lateness, the picture never stops to wait for a snapshot
    const settled = frames.filter((f) => f.now > 2000);
    for (let i = 1; i < settled.length; i++) expect(settled[i].at).toBeGreaterThan(settled[i - 1].at);
  });

  test("snapshots without the board are drawn on the last one received; before any board there is nothing to play", () => {
    const game = makeGame(corridor("1.....2"));
    const buffer = new SnapshotBuffer();
    step(game);
    buffer.push(1, -1, wire(game, false), 0);
    expect(buffer.sample(0)).toBeNull();
    step(game);
    buffer.push(1, -1, wire(game, true), 33);
    step(game);
    buffer.push(1, -1, wire(game, false), 66);
    const { latest } = buffer.sample(100)!;
    expect(latest.tick).toBe(3);
    expect(latest.tiles).toEqual(game.tiles);
  });

  test("changes build on the snapshot before, even one too old to show", () => {
    const game = makeGame(corridor("1.....2"));
    const buffer = new SnapshotBuffer();
    step(game);
    buffer.push(1, -1, wire(game), 0);
    let sent = structuredClone({ players: game.players, bombs: game.bombs });
    const changes = (dx: number) => {
      step(game, { p1: { dx } });
      const snap: GameSnapshot = JSON.parse(JSON.stringify(toSnapshot(game, false, sent)));
      sent = structuredClone({ players: game.players, bombs: game.bombs });
      return snap;
    };
    buffer.push(1, -1, changes(0), 33);
    // p1 sets off (it turns and starts moving) in a snapshot that turns up out of place: not shown, but
    // the next changes (only x now) start from it
    const stale = changes(1);
    stale.tick = 1;
    buffer.push(1, -1, stale, 66);
    buffer.push(1, -1, changes(1), 99);
    expect(buffer.sample(1000)!.latest.players).toEqual(game.players);
  });

  test("a snapshot no newer than the newest is dropped", () => {
    const game = makeGame(corridor("1.....2"));
    const buffer = new SnapshotBuffer();
    const snaps = [1, 2, 3].map(() => (step(game), wire(game)));
    for (const snap of [snaps[0], snaps[2], snaps[1], snaps[2]]) buffer.push(1, -1, snap, 0);
    buffer.sample(1000);
    expect(buffer.takePlayed().map((s) => s.tick)).toEqual([1, 3]);
  });

  test("a new round starts over: the old board, snapshots and acknowledgements are forgotten", () => {
    const game = makeGame(corridor("1.....2"));
    const buffer = new SnapshotBuffer();
    step(game);
    buffer.push(1, -1, wire(game), 0, { p1: [5, 1] });
    expect(buffer.acks).toEqual({ p1: [5, 1] });
    const next = makeGame(corridor("1.....2"));
    step(next);
    buffer.push(2, -1, wire(next, false), 33);
    expect(buffer.acks).toEqual({});
    expect(buffer.sample(33)).toBeNull(); // waits for round two's board
  });

  test("hands each snapshot over once, oldest first, as the playback reaches it", () => {
    const game = makeGame(corridor("1" + ".".repeat(30) + "2"));
    const buffer = new SnapshotBuffer();
    const handed: number[] = [];
    for (let now = 0; now < 2000; now += FRAME_MS) {
      while (game.tick * TICK_MS <= now) {
        step(game, { p1: { dx: 1 } });
        buffer.push(1, -1, wire(game), now);
      }
      const playing = (buffer.sample(now)!.view.players[0].x - 1.5) / STEP;
      for (const s of buffer.takePlayed()) {
        expect(s.tick).toBeLessThanOrEqual(playing + 1e-6); // never ahead of the picture
        handed.push(s.tick);
      }
    }
    expect(handed).toEqual(Array.from({ length: handed.length }, (_, i) => i + 1));
    expect(handed.length).toBeGreaterThan(55);
  });
});

describe("interpolation", () => {
  test("players walk smoothly between two snapshots and so do hops; the rest is the later one's", () => {
    const game = makeGame(corridor("1.....2"));
    const a = { ...game.players[0], x: 2, jump: { fromX: 2, fromY: 1.5, toX: 4, toY: 1.5, ticks: 4, total: 12 } };
    const b = { ...a, x: 3, facing: "right" as const, jump: { ...a.jump, ticks: 5 } };
    const mid = lerpPlayer(a, b, 0.25);
    expect([mid.x, mid.jump!.ticks, mid.facing]).toEqual([2.25, 4.25, "right"]);
  });

  test("kicked bombs glide and thrown ones fly a smooth arc, but a bounce starts its arc afresh", () => {
    const game = makeGame(corridor("1.........2"));
    testBomb(game, 3, 1, { slide: "right" });
    testBomb(game, 6, 1, { flight: { toX: 9, toY: 1, dir: "right", ticks: 2, total: 10 } });
    const next = structuredClone(game);
    next.tick++;
    next.bombs[0].x = 4;
    next.bombs[1].flight!.ticks = 3;
    const [glide, arc] = lerpState(game, next, 0.25).bombs;
    expect(glide.x).toBe(3.25);
    expect(arc.flight!.ticks).toBe(2.25);

    const bounced = structuredClone(next);
    bounced.bombs[1].flight = { toX: 7, toY: 1, dir: "right", ticks: 0, total: 6 };
    expect(lerpState(next, bounced, 0.75).bombs[1].flight).toEqual(bounced.bombs[1].flight);
  });

  test("a carried bomb and everything else snap to the nearer snapshot", () => {
    const game = makeGame(corridor("1.........2"));
    testBomb(game, 1, 1, { held: "p1" });
    game.powerUps.push({ x: 5, y: 1, kind: "bomb" });
    const next = structuredClone(game);
    next.tick++;
    next.bombs[0].x = 2;
    next.powerUps = [];
    expect(lerpState(game, next, 0.4).bombs[0].x).toBe(1);
    expect(lerpState(game, next, 0.4).powerUps).toHaveLength(1);
    expect(lerpState(game, next, 0.6).bombs[0].x).toBe(2);
    expect(lerpState(game, next, 0.6).powerUps).toHaveLength(0);
  });
});
