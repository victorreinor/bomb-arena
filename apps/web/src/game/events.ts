import { ABILITY_FIELDS, DIR_VEC, TILE, borderRing, fallOrder, type AbilityKind, type Dir, type GameState, type PetKind, type Player, type PowerUpKind } from "@bomberman/engine";

/** What a bomber is caught doing for a moment (the sprite strikes the pose) */
export type ActionPose = "kick" | "punch" | "throw" | "place";

export type GameEvent =
  | { type: "bombPlaced"; bombs: { x: number; y: number; power: boolean; remote: boolean }[] }
  | {
      type: "explosion";
      bombs: { x: number; y: number; range: number }[];
      flames: { x: number; y: number }[];
      /** soft blocks that were destroyed */
      blocks: { x: number; y: number }[];
    }
  | { type: "death"; x: number; y: number; color: number }
  | { type: "pickup"; id: string; x: number; y: number; kind: PowerUpKind }
  | { type: "kick"; x: number; y: number; dir: Dir }
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
  | { type: "stun"; x: number; y: number }
  | { type: "pose"; id: string; pose: ActionPose }
  | { type: "haunt"; x: number; y: number }
  | { type: "hurry" }
  | { type: "blockFall"; cells: { x: number; y: number }[] }
  | { type: "finish"; winner: string | null };

/** Which (good) item was just picked up, judged by what improved on the player; null if nothing did. */
function pickedKind(before: Player, after: Player): PowerUpKind | null {
  if (after.bombsMax > before.bombsMax) return "bomb";
  if (after.range > before.range) return "fire";
  if (after.speedLevel > before.speedLevel) return "speed";
  if (after.lineCharges > before.lineCharges) return "line";
  for (const [kind, field] of Object.entries(ABILITY_FIELDS) as [AbilityKind, (typeof ABILITY_FIELDS)[AbilityKind]][]) {
    if (after[field] && !before[field]) return kind;
  }
  return null;
}

/** What happened between two consecutive game states, for sound and visual effects. */
export function diffGame(prev: GameState, next: GameState): GameEvent[] {
  if (next.tick <= prev.tick) return [];
  const events: GameEvent[] = [];

  const placed = next.bombs.filter((b) => !prev.bombs.some((o) => o.id === b.id));
  if (placed.length > 0) {
    events.push({ type: "bombPlaced", bombs: placed.map((b) => ({ x: b.x, y: b.y, power: b.power, remote: b.remote })) });
    // a ghost's bombs come from the wall: only the living crouch to lay one
    for (const owner of new Set(placed.map((b) => b.owner))) {
      if (next.players.some((p) => p.id === owner && p.alive)) events.push({ type: "pose", id: owner, pose: "place" });
    }
  }
  /** whoever stands on the tile just behind (x, y) going `dir`: the one who kicked or punched it */
  const behind = (x: number, y: number, dir: Dir) =>
    next.players.find((p) => p.alive && Math.floor(p.x) === x - DIR_VEC[dir].dx && Math.floor(p.y) === y - DIR_VEC[dir].dy);
  for (const u of next.powerUps) {
    if (!prev.powerUps.some((o) => o.x === u.x && o.y === u.y && o.kind === u.kind)) {
      events.push({ type: "itemDrop", x: u.x, y: u.y, kind: u.kind });
    }
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
    if (b.flight && !before.flight) {
      events.push({ type: "throw", x: b.x, y: b.y });
      const by = before.held ?? behind(b.x, b.y, b.flight.dir)?.id;
      if (by) events.push({ type: "pose", id: by, pose: before.held ? "throw" : "punch" });
    }
    if (before.flight && !b.flight) events.push({ type: "land", x: b.x, y: b.y, power: b.power });
    if (b.held && !before.held) events.push({ type: "lift", x: b.x, y: b.y });
  }

  for (const p of next.players) {
    const before = prev.players.find((o) => o.id === p.id);
    if (!before) continue;
    if (before.alive && !p.alive) {
      events.push({ type: "death", x: before.x, y: before.y, color: p.color });
      if (p.ghost) {
        const tile = borderRing(next.width, next.height)[p.ghost.pos];
        events.push({ type: "haunt", x: tile.x + 0.5, y: tile.y + 0.5 });
      }
      continue;
    }
    if (!p.alive) continue;
    if (p.pet && !before.pet) events.push({ type: "mount", x: p.x, y: p.y, pet: p.pet.kind });
    if (before.pet && !p.pet) events.push({ type: "petLost", x: p.x, y: p.y, pet: before.pet.kind, facing: p.facing });
    if (p.pet && before.pet && p.pet.cooldown > before.pet.cooldown) {
      events.push({ type: "petPower", x: p.x, y: p.y, pet: p.pet.kind, dir: p.facing });
    }
    if (before.jump && !p.jump) events.push({ type: "petLand", x: p.x, y: p.y });
    if (p.stunned > before.stunned) events.push({ type: "stun", x: p.x, y: p.y });
    if (before.vest && !p.vest) events.push({ type: "shield", x: p.x, y: p.y });
    const kind = pickedKind(before, p);
    if (p.disease && !before.disease) events.push({ type: "infected", id: p.id, x: p.x, y: p.y });
    else if (kind) events.push({ type: "pickup", id: p.id, x: p.x, y: p.y, kind });
  }

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
