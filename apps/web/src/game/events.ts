import {
  ABILITY_FIELDS,
  DIR_VEC,
  TILE,
  borderRing,
  countingDown,
  eruptionsBy,
  fallOrder,
  isPortal,
  liveVents,
  type AbilityKind,
  type Bomb,
  type Dir,
  type GameState,
  type PetKind,
  type Player,
  type PowerUpKind,
} from "@bomberman/engine";
import { warped } from "./snapshots";

/** What a bomber is caught doing for a moment (the sprite strikes the pose) */
export type ActionPose = "kick" | "punch" | "throw" | "place";

export type GameEvent =
  | { type: "bombPlaced"; bombs: { x: number; y: number; power: boolean; remote: boolean; owner: string }[] }
  | {
      type: "explosion";
      bombs: { x: number; y: number; range: number }[];
      flames: { x: number; y: number }[];
      /** soft blocks that were destroyed */
      blocks: { x: number; y: number }[];
    }
  | { type: "death"; id: string; x: number; y: number; color: number }
  | { type: "pickup"; id: string; x: number; y: number; kind: PowerUpKind }
  | { type: "kick"; x: number; y: number; dir: Dir }
  /** a rubber bomb bounced off something and now slides `dir`-wards */
  | { type: "bounce"; x: number; y: number; dir: Dir }
  | { type: "throw"; x: number; y: number }
  | { type: "land"; x: number; y: number; power: boolean }
  | { type: "lift"; x: number; y: number }
  | { type: "itemDrop"; x: number; y: number; kind: PowerUpKind }
  | { type: "shield"; x: number; y: number }
  | { type: "infected"; id: string; x: number; y: number }
  | { type: "mount"; x: number; y: number; pet: PetKind }
  | { type: "petLost"; x: number; y: number; pet: PetKind; facing: Dir }
  | { type: "petPower"; x: number; y: number; pet: PetKind; dir: Dir }
  | { type: "petLand"; x: number; y: number }
  | { type: "stun"; id: string; x: number; y: number }
  | { type: "pose"; id: string; pose: ActionPose }
  | { type: "haunt"; x: number; y: number }
  | { type: "hurry" }
  /** the countdown is over: everyone can move */
  | { type: "go" }
  | { type: "blockFall"; cells: { x: number; y: number }[] }
  /** someone or a bomb went in one end of a portal and came out of the other (centres, in tiles) */
  | { type: "warp"; from: { x: number; y: number }; to: { x: number; y: number } }
  /** a crate was shoved onto (x, y), heading `dir`-wards */
  | { type: "cratePush"; x: number; y: number; dir: Dir }
  /** the lava vents erupted */
  | { type: "eruption"; cells: { x: number; y: number }[] }
  | { type: "finish"; winner: string | null };

/** Whether something happened to us: `me` is our player id; without one the device is shared, so everything counts. */
export const isMine = (id: string | null, me: string | undefined) => me === undefined || id === me;

/** Bombs just laid: the event, and the crouch of each living owner (a ghost's bombs come from the wall). */
export function bombsPlaced(bombs: Bomb[], alive: (id: string) => boolean): GameEvent[] {
  if (bombs.length === 0) return [];
  const events: GameEvent[] = [
    { type: "bombPlaced", bombs: bombs.map((b) => ({ x: b.x, y: b.y, power: b.power, remote: b.remote, owner: b.owner })) },
  ];
  for (const owner of new Set(bombs.map((b) => b.owner))) if (alive(owner)) events.push({ type: "pose", id: owner, pose: "place" });
  return events;
}

/** Which (good) item was just picked up, judged by what improved on the player; null if nothing did. */
function pickedKind(before: Player, after: Player): PowerUpKind | null {
  if (after.bombsMax > before.bombsMax) return "bomb";
  if (after.range > before.range) return "fire";
  if (after.speedLevel > before.speedLevel) return "speed";
  if (after.lineCharges > before.lineCharges) return "line";
  if (after.mineCharges > before.mineCharges) return "mine";
  for (const [kind, field] of Object.entries(ABILITY_FIELDS) as [AbilityKind, (typeof ABILITY_FIELDS)[AbilityKind]][]) {
    if (after[field] && !before[field]) return kind;
  }
  return null;
}

/** Whether whatever moved from `a` to `b` in a tick (in `state`) came out of a portal. */
const outOfPortal = (state: GameState, a: { x: number; y: number }, b: { x: number; y: number }) =>
  warped(a, b) && isPortal(state, Math.floor(b.x), Math.floor(b.y));

/** What happened between two consecutive game states, for sound and visual effects. */
export function diffGame(prev: GameState, next: GameState): GameEvent[] {
  if (next.tick <= prev.tick) return [];
  const events: GameEvent[] = [];

  const placed = next.bombs.filter((b) => !prev.bombs.some((o) => o.id === b.id));
  events.push(...bombsPlaced(placed, (id) => next.players.some((p) => p.id === id && p.alive)));
  /** whoever stands on the tile just behind (x, y) going `dir`: the one who kicked or punched it */
  const behind = (x: number, y: number, dir: Dir) =>
    next.players.find((p) => p.alive && Math.floor(p.x) === x - DIR_VEC[dir].dx && Math.floor(p.y) === y - DIR_VEC[dir].dy);
  for (const u of next.powerUps) {
    if (!prev.powerUps.some((o) => o.x === u.x && o.y === u.y && o.kind === u.kind)) {
      events.push({ type: "itemDrop", x: u.x, y: u.y, kind: u.kind });
    }
  }
  // an item gone from under a bomber, with no fire and no falling block there, was taken: even one that
  // added nothing (already at the maximum)
  const takers = new Set<string>();
  for (const u of prev.powerUps) {
    if (next.powerUps.some((o) => o.x === u.x && o.y === u.y && o.kind === u.kind)) continue;
    if (next.flames.some((f) => f.x === u.x && f.y === u.y) || next.tiles[u.y * next.width + u.x] === TILE.HARD) continue;
    const taker = next.players.find((p) => p.alive && Math.floor(p.x) === u.x && Math.floor(p.y) === u.y);
    if (!taker) continue;
    takers.add(taker.id);
    if (u.kind !== "skull") events.push({ type: "pickup", id: taker.id, x: taker.x, y: taker.y, kind: u.kind });
    // a first curse is announced below, as the curse appears; a new one on top of it, here
    else if (prev.players.find((p) => p.id === taker.id)?.disease) events.push({ type: "infected", id: taker.id, x: taker.x, y: taker.y });
  }

  const gone = prev.bombs.filter((b) => !next.bombs.some((o) => o.id === b.id));
  if (gone.length > 0) {
    const flames = next.flames.filter((f) => {
      const before = prev.flames.find((o) => o.x === f.x && o.y === f.y);
      return !before || f.ticksLeft > before.ticksLeft;
    });
    const blocks: { x: number; y: number }[] = [];
    next.tiles.forEach((t, i) => {
      if (t === TILE.EMPTY && prev.tiles[i] === TILE.SOFT) blocks.push({ x: i % next.width, y: Math.floor(i / next.width) });
    });
    events.push({
      type: "explosion",
      bombs: gone.map((b) => ({ x: b.x, y: b.y, range: b.range })),
      flames: flames.map((f) => ({ x: f.x, y: f.y })),
      blocks,
    });
  }

  for (const b of next.bombs) {
    const before = prev.bombs.find((o) => o.id === b.id);
    if (!before) continue;
    if (b.slide && !before.slide) {
      events.push({ type: "kick", x: b.x, y: b.y, dir: b.slide });
      const kicker = behind(b.x, b.y, b.slide);
      if (kicker) events.push({ type: "pose", id: kicker.id, pose: "kick" });
    }
    if (b.slide && before.slide && b.slide !== before.slide) events.push({ type: "bounce", x: b.x, y: b.y, dir: b.slide });
    if (b.flight && !before.flight) {
      events.push({ type: "throw", x: b.x, y: b.y });
      const by = before.held ?? behind(b.x, b.y, b.flight.dir)?.id;
      if (by) events.push({ type: "pose", id: by, pose: before.held ? "throw" : "punch" });
    }
    if (before.flight && !b.flight) events.push({ type: "land", x: b.x, y: b.y, power: b.power });
    if (!b.flight && !before.flight && outOfPortal(next, before, b)) events.push({ type: "warp", from: { x: before.x + 0.5, y: before.y + 0.5 }, to: { x: b.x + 0.5, y: b.y + 0.5 } });
    if (b.held && !before.held) events.push({ type: "lift", x: b.x, y: b.y });
  }

  for (const p of next.players) {
    const before = prev.players.find((o) => o.id === p.id);
    if (!before) continue;
    if (before.alive && !p.alive) {
      events.push({ type: "death", id: p.id, x: before.x, y: before.y, color: p.color });
      if (p.ghost) {
        const tile = borderRing(next.width, next.height)[p.ghost.pos];
        events.push({ type: "haunt", x: tile.x + 0.5, y: tile.y + 0.5 });
      }
      continue;
    }
    if (!p.alive) continue;
    if (!p.jump && !before.jump && outOfPortal(next, before, p)) events.push({ type: "warp", from: { x: before.x, y: before.y }, to: { x: p.x, y: p.y } });
    if (p.pet && !before.pet) events.push({ type: "mount", x: p.x, y: p.y, pet: p.pet.kind });
    if (before.pet && !p.pet) events.push({ type: "petLost", x: p.x, y: p.y, pet: before.pet.kind, facing: p.facing });
    if (p.pet && before.pet && p.pet.cooldown > before.pet.cooldown) {
      events.push({ type: "petPower", x: p.x, y: p.y, pet: p.pet.kind, dir: p.facing });
    }
    if (before.jump && !p.jump) events.push({ type: "petLand", x: p.x, y: p.y });
    if (p.stunned > before.stunned) events.push({ type: "stun", id: p.id, x: p.x, y: p.y });
    if (before.vest && !p.vest) events.push({ type: "shield", x: p.x, y: p.y });
    // an item taken out of sight (snapshots skipped and the bomber walked on) still shows in what improved
    const kind = takers.has(p.id) ? null : pickedKind(before, p);
    if (p.disease && !before.disease) events.push({ type: "infected", id: p.id, x: p.x, y: p.y });
    else if (kind) events.push({ type: "pickup", id: p.id, x: p.x, y: p.y, kind });
  }

  // a crate shoved: it left one cell for the next one over
  next.tiles.forEach((t, i) => {
    if (t !== TILE.CRATE || prev.tiles[i] !== TILE.EMPTY) return;
    const x = i % next.width;
    const y = Math.floor(i / next.width);
    for (const [dir, d] of Object.entries(DIR_VEC) as [Dir, (typeof DIR_VEC)[Dir]][]) {
      const from = (y - d.dy) * next.width + x - d.dx;
      if (prev.tiles[from] === TILE.CRATE && next.tiles[from] === TILE.EMPTY) events.push({ type: "cratePush", x, y, dir });
    }
  });
  if (next.floor && eruptionsBy(next.tick, next.goTick) > eruptionsBy(prev.tick, next.goTick)) {
    const cells = liveVents(next).map((i) => ({ x: i % next.width, y: Math.floor(i / next.width) }));
    events.push({ type: "eruption", cells });
  }

  if (countingDown(prev) && !countingDown(next)) events.push({ type: "go" });
  if (prev.timeLeft !== null && prev.timeLeft > 0 && next.timeLeft === 0) events.push({ type: "hurry" });
  if (next.fallen > prev.fallen) {
    const cells = fallOrder(next.width, next.height)
      .slice(prev.fallen, next.fallen)
      .filter((i) => prev.tiles[i] !== TILE.HARD && next.tiles[i] === TILE.HARD)
      .map((i) => ({ x: i % next.width, y: Math.floor(i / next.width) }));
    if (cells.length > 0) events.push({ type: "blockFall", cells });
  }

  if (prev.phase === "playing" && next.phase === "finished") events.push({ type: "finish", winner: next.winner });
  return events;
}
