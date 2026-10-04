import { describe, expect, test } from "bun:test";
import { BASE_SPEED, TICK_RATE, killPlayer, type Bomb, type GameState, type Player } from "@bomb-arena/engine";
import { corridor, makeGame, startedMatch, testBomb } from "../../../packages/engine/test/helpers";
import type { GameEvent } from "../src/game/events";
import { PredictedView, type Prediction } from "../src/game/predict";
import { FRAME_MS, Loopback, type Frame, type Network } from "./loopback";

/** how far a bomber without speed-ups walks in one tick, in tiles */
const TICK_WALK = BASE_SPEED / TICK_RATE;
/** the round trip from Brazil to the server, more or less */
const BRAZIL: Network = { up: 70, down: 70 };

const mine = (f: Frame) => f.shown!.players.find((p) => p.id === "u1")!;
const served = (f: Frame) => f.latest!.players.find((p) => p.id === "u1")!;
const ours = (events: GameEvent[], type: GameEvent["type"]) =>
  events.filter((e) => e.type === type && ("id" in e ? e.id === "u1" : e.type !== "bombPlaced" || e.bombs.some((b) => b.owner === "u1")));

/** A client in a match, a second in so its clock has lined up with the server's. */
function connected(net: Network = BRAZIL) {
  const lb = new Loopback(startedMatch(), "u1", net);
  lb.run(1000);
  return lb;
}

describe("Predictor over a pretend network", () => {
  test("our bomber answers the controls at once, long before the server's answer comes back", () => {
    const lb = connected();
    const pressed = lb.now;
    lb.hold(1, 0);
    const frames = lb.run(400);
    const moves = frames.find((f) => mine(f).x > 1.5);
    const answered = frames.find((f) => served(f).x > 1.5);
    expect(moves!.now - pressed).toBeLessThanOrEqual(3 * FRAME_MS);
    expect(answered!.now - pressed).toBeGreaterThanOrEqual(BRAZIL.up + BRAZIL.down);
  });

  test.each([
    ["Brazil", BRAZIL],
    ["nearby", { up: 20, down: 45 }],
    ["lopsided, with late snapshots", { up: 110, down: 40, jitter: (tick: number) => (tick % 7 === 0 ? 60 : 0) }],
    ["every player in full, as before protocol 2", { ...BRAZIL, protocol: 1 as const }],
  ] as const)("agrees with the server (%s): never more than a tick's walk off, and ends exactly where the server has us", (_, net) => {
    const lb = connected(net);
    const frames: Frame[] = [];
    for (const [dx, dy, ms] of [[1, 0, 1500], [0, 1, 300], [-1, 0, 500], [0, 0, 1000]]) {
      lb.hold(dx, dy);
      frames.push(...lb.run(ms));
    }
    expect(frames.every((f) => f.prediction !== null)).toBe(true);
    const corrections = frames.map((f) => Math.hypot(f.prediction!.correction.x, f.prediction!.correction.y));
    expect(Math.max(...corrections)).toBeLessThanOrEqual(TICK_WALK + 1e-9);

    const end = frames.at(-1)!;
    const server = lb.room.game!.players.find((p) => p.id === "u1")!;
    expect(server.x).not.toBe(1.5); // it did go somewhere
    expect(end.prediction!.player.x).toBeCloseTo(server.x, 9);
    expect(end.prediction!.player.y).toBeCloseTo(server.y, 9);
    expect(mine(end).x).toBeCloseTo(server.x, 3); // the eased correction has faded out on screen too
  });

  test.each([
    ["riding a belt and walking against it", "assembly", [4.5, 3.5], [[0, 0, 1000], [-1, 0, 1000], [0, 1, 400], [1, 0, 600]]],
    ["through a portal", "portals", [5.5, 1.5], [[1, 0, 900], [0, -1, 500], [-1, 0, 700]]],
    ["sliding across the ice", "lake", [2.5, 3.5], [[1, 0, 300], [0, 0, 2500], [0, 1, 500], [-1, 0, 400]]],
    ["shoving crates", "warehouse", [3.5, 3.5], [[1, 0, 2500], [0, 1, 500]]],
  ] as const)("agrees with the server %s", (_, mapId, at, moves) => {
    const room = startedMatch({ mapId });
    const me = room.game!.players.find((p) => p.id === "u1")!;
    [me.x, me.y] = at;
    const lb = new Loopback(room, "u1", BRAZIL);
    lb.run(1000);
    const frames: Frame[] = [];
    for (const [dx, dy, ms] of [...moves, [0, 0, 3000] as const]) {
      lb.hold(dx, dy);
      frames.push(...lb.run(ms));
    }
    expect(frames.every((f) => f.prediction !== null)).toBe(true);
    const corrections = frames.map((f) => Math.hypot(f.prediction!.correction.x, f.prediction!.correction.y));
    expect(Math.max(...corrections)).toBeLessThanOrEqual(TICK_WALK + 1e-9);
    expect([me.x, me.y]).not.toEqual(at);
    expect(frames.at(-1)!.prediction!.player.x).toBeCloseTo(me.x, 9);
    expect(frames.at(-1)!.prediction!.player.y).toBeCloseTo(me.y, 9);
  });

  test("a crate we shove moves on screen with our bomber, not a round trip later", () => {
    const room = startedMatch({ mapId: "warehouse" });
    const me = room.game!.players.find((p) => p.id === "u1")!;
    [me.x, me.y] = [3.5, 3.5];
    const lb = new Loopback(room, "u1", BRAZIL);
    lb.run(1000);
    lb.hold(1, 0);
    const frames = lb.run(1500);
    const crateAt = (f: Frame, x: number) => f.shown!.tiles[3 * f.shown!.width + x] === 3;
    const shown = frames.findIndex((f) => !crateAt(f, 5));
    const played = frames.findIndex((f) => !crateAt({ ...f, shown: f.latest }, 5));
    expect(shown).toBeGreaterThan(0);
    expect(played - shown).toBeGreaterThanOrEqual(6); // the server's word on it comes a good 100 ms later
    // and the bomber is never drawn inside it (a hair over, from easing a correction, at most)
    for (const f of frames) {
      const p = mine(f);
      expect(f.shown!.tiles[Math.floor(p.y) * f.shown!.width + Math.floor(p.x + 0.38 - 0.1)]).not.toBe(3);
    }
  });

  test("a bomb shows up and sounds the moment it is laid, once, on the cell where the server puts it", () => {
    const lb = connected();
    lb.hold(1, 0);
    lb.run(500);
    lb.press("bomb");
    const pressed = lb.now;
    const frames = lb.run(1000);

    const placed = frames.filter((f) => ours(f.events, "bombPlaced").length > 0);
    expect(placed).toHaveLength(1); // ours, not again when the server's report of it plays back
    expect(placed[0].now - pressed).toBeLessThanOrEqual(2 * FRAME_MS);
    const [server] = lb.room.game!.bombs.filter((b) => b.owner === "u1");
    const event = ours(placed[0].events, "bombPlaced")[0] as Extract<GameEvent, { type: "bombPlaced" }>;
    expect([event.bombs[0].x, event.bombs[0].y]).toEqual([server.x, server.y]);
    const later = frames.slice(frames.indexOf(placed[0]));
    expect(later.every((f) => f.shown!.bombs.some((b) => b.x === server.x && b.y === server.y))).toBe(true);
  });

  test("an item vanishes as we walk onto it and stays gone, with one pickup sound", () => {
    const lb = connected();
    lb.room.game!.powerUps.push({ x: 4, y: 1, kind: "fire" });
    lb.run(300); // the item reaches the screen
    lb.hold(1, 0);
    const frames = lb.run(1500);

    const item = (f: Frame) => f.shown!.powerUps.some((u) => u.x === 4 && u.y === 1);
    const onIt = frames.findIndex((f) => Math.floor(mine(f).x) === 4);
    expect(onIt).toBeGreaterThan(0);
    expect(item(frames[onIt - 1])).toBe(true);
    expect(frames.slice(onIt).some(item)).toBe(false);
    expect(frames.flatMap((f) => ours(f.events, "pickup"))).toHaveLength(1);
    expect(lb.room.game!.players.find((p) => p.id === "u1")!.range).toBe(3); // the server agrees: it was ours
  });

  test("through the countdown our bomber stands still, and it sets off without a jump when play starts", () => {
    const lb = new Loopback(startedMatch({ inCountdown: true }), "u1", BRAZIL);
    lb.hold(1, 0); // keys held down from the start
    const frames = lb.run(3500);
    const go = frames.findIndex((f) => f.latest !== null && f.latest.tick > f.latest.goTick);
    expect(go).toBeGreaterThan(0);
    // lined up with the server before the countdown is over, and still until "Go!"
    expect(frames[go - 1].prediction).not.toBeNull();
    const before = frames.slice(0, go).filter((f) => f.prediction && f.prediction.player.x !== 1.5);
    expect(before.every((f) => f.latest!.tick >= f.latest!.goTick - 5)).toBe(true); // at most the ticks just ahead
    const after = frames.slice(go).map((f) => Math.hypot(f.prediction!.correction.x, f.prediction!.correction.y));
    expect(Math.max(...after)).toBeLessThanOrEqual(TICK_WALK + 1e-9);
  });

  test("an older server that never acknowledges inputs: nothing is predicted, the playback shows what the server did", () => {
    const lb = new Loopback(startedMatch(), "u1", { ...BRAZIL, noAcks: true });
    lb.run(1000);
    lb.hold(1, 0);
    const frames = lb.run(1000);
    expect(frames.every((f) => f.prediction === null)).toBe(true);
    expect(served(frames.at(-1)!).x).toBeGreaterThan(2); // it still walks, a round trip late
  });

  test("when snapshots stop coming the prediction gives up, and picks up again once they're back", () => {
    let stalled = 0;
    const lb = connected({ ...BRAZIL, jitter: (tick) => (tick === stalled ? 1200 : 0) });
    stalled = lb.room.game!.tick + 10;
    lb.hold(1, 0);
    const frames = lb.run(2500);
    const lost = frames.findIndex((f) => f.prediction === null);
    expect(lost).toBeGreaterThan(0);
    expect(frames.at(-1)!.prediction).not.toBeNull();
  });

  test("a bomber that is out isn't predicted", () => {
    const lb = connected();
    killPlayer(lb.room.game!, lb.room.game!.players.find((p) => p.id === "u1")!, "left");
    lb.room.game!.phase = "playing"; // keep the match going regardless
    const frames = lb.run(300);
    expect(frames.at(-1)!.prediction).toBeNull();
  });
});

describe("PredictedView", () => {
  /** a prediction with our bomber (p1) at `x` */
  const at = (game: GameState, x: number, extra: Partial<Prediction> = {}): Prediction => ({
    player: { ...game.players[0], x } as Player,
    correction: { x: 0, y: 0 },
    bombs: [],
    fresh: [],
    taken: [],
    reaching: [],
    tiles: game.tiles,
    ...extra,
  });
  const drawnX = (view: GameState) => view.players.find((p) => p.id === "p1")!.x;

  test("takes over from where the playback drew our bomber, then eases a small correction out and jumps a big one", () => {
    const game = makeGame(corridor("1..........2"));
    const pv = new PredictedView("p1");
    let now = 1000;
    // the playback has us at 1.5; the prediction is already at 1.9: start from 1.5 and glide
    expect(drawnX(pv.apply(game, at(game, 1.9), now).view)).toBeCloseTo(1.5);
    for (let i = 0; i < 30; i++) pv.apply(game, at(game, 1.9), (now += FRAME_MS));
    expect(drawnX(pv.apply(game, at(game, 1.9), (now += FRAME_MS)).view)).toBeCloseTo(1.9, 2);

    const eased = drawnX(pv.apply(game, at(game, 2.2, { correction: { x: 0.3, y: 0 } }), (now += FRAME_MS)).view);
    expect(eased).toBeGreaterThan(2.3);
    expect(eased).toBeLessThan(2.5);
    expect(drawnX(pv.apply(game, at(game, 6, { correction: { x: 2, y: 0 } }), (now += FRAME_MS)).view)).toBe(6);
  });

  test("a bomb only the prediction has is drawn every frame and announced once", () => {
    const game = makeGame(corridor("1..........2"));
    const pv = new PredictedView("p1");
    const bomb: Bomb = { ...testBomb(makeGame(corridor("1..........2")), 3, 1), owner: "p1" };
    const pred = at(game, 3.5, { bombs: [bomb], fresh: [bomb] });
    const first = pv.apply(game, pred, 1000);
    const second = pv.apply(game, pred, 1000 + FRAME_MS);
    for (const shown of [first, second]) expect(shown.view.bombs.map((b) => [b.x, b.y])).toEqual([[3, 1]]);
    expect(first.events.map((e) => e.type)).toEqual(["bombPlaced", "pose"]);
    expect(second.events).toEqual([]);
  });

  test("while predicting it drops the server's late word on our bombs and pick-ups, and nobody else's", () => {
    const game = makeGame(corridor("1..........2"));
    const pv = new PredictedView("p1");
    const events: GameEvent[] = [
      { type: "bombPlaced", bombs: [{ x: 2, y: 1, power: false, remote: false, owner: "p1" }, { x: 9, y: 1, power: false, remote: false, owner: "p2" }] },
      { type: "pose", id: "p1", pose: "place" },
      { type: "pose", id: "p1", pose: "kick" },
      { type: "pickup", id: "p1", x: 2.5, y: 1.5, kind: "fire" },
      { type: "pickup", id: "p2", x: 9.5, y: 1.5, kind: "bomb" },
      { type: "death", id: "p2", x: 9.5, y: 1.5, color: 1 },
    ];
    expect(pv.withoutOwn(events)).toEqual(events); // not predicting yet: everything comes from the server
    pv.apply(game, at(game, 1.5), 1000);
    expect(pv.withoutOwn(events)).toEqual([
      { type: "bombPlaced", bombs: [{ x: 9, y: 1, power: false, remote: false, owner: "p2" }] },
      { type: "pose", id: "p1", pose: "kick" },
      { type: "pickup", id: "p2", x: 9.5, y: 1.5, kind: "bomb" },
      { type: "death", id: "p2", x: 9.5, y: 1.5, color: 1 },
    ]);
  });
});
