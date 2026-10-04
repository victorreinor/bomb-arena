import { ABILITY_FIELDS, TILE, type AbilityKind, type Dir, type GameState, type Player, type PowerUpKind } from "@bomberman/engine";

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
  }
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
    if (b.slide && !before.slide) events.push({ type: "kick", x: b.x, y: b.y, dir: b.slide });
    if (b.flight && !before.flight) events.push({ type: "throw", x: b.x, y: b.y });
    if (before.flight && !b.flight) events.push({ type: "land", x: b.x, y: b.y, power: b.power });
    if (b.held && !before.held) events.push({ type: "lift", x: b.x, y: b.y });
  }

  for (const p of next.players) {
    const before = prev.players.find((o) => o.id === p.id);
    if (!before) continue;
    if (before.alive && !p.alive) {
      events.push({ type: "death", x: before.x, y: before.y, color: p.color });
      continue;
    }
    if (!p.alive) continue;
    if (before.vest && !p.vest) events.push({ type: "shield", x: p.x, y: p.y });
    const kind = pickedKind(before, p);
    if (p.disease && !before.disease) events.push({ type: "infected", id: p.id, x: p.x, y: p.y });
    else if (kind) events.push({ type: "pickup", id: p.id, x: p.x, y: p.y, kind });
  }

  if (prev.phase === "playing" && next.phase === "finished") events.push({ type: "finish", winner: next.winner });
  return events;
}
