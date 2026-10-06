import { pickRandom } from "./rng";
import type { MapDef } from "./types";

export const GRID_W = 15;
export const GRID_H = 13;

/**
 * Which spawn the n-th player gets, as an index into the corners (top-left, top-right, bottom-left,
 * bottom-right; spawn digits 1-4): with 2 players they start in opposite corners.
 */
export const SPAWN_ORDER = [0, 3, 1, 2];

const isClassicPillar = (x: number, y: number) => x % 2 === 0 && y % 2 === 0;

/**
 * A `width` x `height` arena walled all round: `#` where `hard` says so, random soft blocks (`o`) elsewhere,
 * and a spawn with a safe L-shaped pocket in each corner listed in `spawns` (all four by default).
 */
function build(hard: (x: number, y: number) => boolean, { width = GRID_W, height = GRID_H, spawns = [0, 1, 2, 3] } = {}): string[] {
  const grid: string[][] = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      row.push(border || hard(x, y) ? "#" : "o");
    }
    grid.push(row);
  }
  const corners = [[1, 1], [width - 2, 1], [1, height - 2], [width - 2, height - 2]];
  for (const i of spawns) {
    const [sx, sy] = corners[i];
    const dx = sx === 1 ? 1 : -1;
    const dy = sy === 1 ? 1 : -1;
    grid[sy][sx] = String(i + 1);
    grid[sy][sx + dx] = ".";
    grid[sy + dy][sx] = ".";
  }
  return grid.map((r) => r.join(""));
}

/** `rows` with some cells swapped for other characters: [x, y, ch] each. */
function mark(rows: string[], cells: [number, number, string][]): string[] {
  const grid = rows.map((r) => [...r]);
  for (const [x, y, ch] of cells) grid[y][x] = ch;
  return grid.map((r) => r.join(""));
}

/** Every cell from (x0, y0) to (x1, y1), corners included, row by row. */
function area(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push([x, y]);
  return cells;
}

/** A spawn point in a map's rows: the digit is its number. */
export const isSpawn = (ch: string) => ch >= "1" && ch <= "9";

/** How many players a map has room for: one per spawn point. */
export const mapSeats = (map: MapDef) => [...map.rows.join("")].filter(isSpawn).length;

const key = (x: number, y: number) => `${x},${y}`;
const setOf = (cells: [number, number][]) => new Set(cells.map(([x, y]) => key(x, y)));

/** Classic Super Bomberman layout: a pillar on every even/even cell. */
export const CLASSIC: MapDef = {
  id: "classic",
  name: "Clássico",
  rows: build(isClassicPillar),
  softDensity: 0.75,
};

/** Simple: very few pillars, lots of room to run. */
export const OPEN_FIELD: MapDef = {
  id: "open",
  name: "Campo Aberto",
  rows: build((x, y) => x % 4 === 0 && y % 4 === 0),
  softDensity: 0.6,
};

const MAZE_EXTRA = setOf([
  [3, 3], [11, 3], [3, 9], [11, 9],
  [5, 5], [9, 5], [7, 7],
]);

/** Complex: classic pillars plus extra walls on crossroads, forcing detours. */
export const MAZE: MapDef = {
  id: "maze",
  name: "Labirinto",
  rows: build((x, y) => isClassicPillar(x, y) || MAZE_EXTRA.has(key(x, y))),
  softDensity: 0.8,
};

const QUADRANT_GAPS = setOf([[7, 3], [7, 9], [3, 6], [11, 6]]);
const QUADRANT_PILLARS = setOf([[3, 3], [11, 3], [3, 9], [11, 9]]);

/** Complex: four rooms split by a wall cross; fights happen at the four doors. */
export const QUADRANTS: MapDef = {
  id: "quadrants",
  name: "Quadrantes",
  rows: build((x, y) => {
    if (QUADRANT_PILLARS.has(key(x, y))) return true;
    const onCross = x === 7 || y === 6;
    return onCross && !QUADRANT_GAPS.has(key(x, y));
  }),
  softDensity: 0.7,
};

/** one-on-one maps only have the corners the first two players get (opposite ones) */
const DUEL_SPAWNS = SPAWN_ORDER.slice(0, 2);

/** One on one, small: the two meet almost at once. */
export const DUEL: MapDef = {
  id: "duel",
  name: "Duelo",
  rows: build(isClassicPillar, { width: 11, height: 9, spawns: DUEL_SPAWNS }),
  softDensity: 0.6,
};

/** One on one, middle-sized: a little room to build up before the fight. */
export const FACEOFF: MapDef = {
  id: "faceoff",
  name: "Confronto",
  rows: build(isClassicPillar, { width: 13, height: 11, spawns: DUEL_SPAWNS }),
  softDensity: 0.7,
};

/** Belts: a clockwise loop round the middle, carrying people, bombs and items along. */
export const ASSEMBLY: MapDef = {
  id: "assembly",
  name: "Linha de Montagem",
  rows: mark(build(isClassicPillar), [
    ...area(3, 3, 10, 3).map(([x, y]) => [x, y, ">"] as [number, number, string]),
    ...area(11, 3, 11, 8).map(([x, y]) => [x, y, "v"] as [number, number, string]),
    ...area(4, 9, 11, 9).map(([x, y]) => [x, y, "<"] as [number, number, string]),
    ...area(3, 4, 3, 9).map(([x, y]) => [x, y, "^"] as [number, number, string]),
  ]),
  softDensity: 0.7,
};

/**
 * Portals: three pairs that link the far sides of the arena. No bomb can be laid on a portal, so each end
 * has a tile beside it that's always clear: whoever comes out can step off, bomb and step back in.
 */
export const PORTALS: MapDef = {
  id: "portals",
  name: "Portais",
  rows: mark(build(isClassicPillar), [
    [7, 1, "A"], [7, 11, "A"],
    [1, 5, "B"], [13, 7, "B"],
    [5, 5, "C"], [9, 7, "C"],
    [7, 2, "."], [7, 10, "."],
    [2, 5, "."], [12, 7, "."],
    [6, 5, "."], [8, 7, "."],
  ]),
  softDensity: 0.7,
};

/** Ice: a frozen lake in the middle where nobody can steer or stop until something gets in the way. */
export const LAKE: MapDef = {
  id: "lake",
  name: "Lago Congelado",
  rows: mark(
    build(isClassicPillar),
    area(3, 3, 11, 9).filter(([x, y]) => !isClassicPillar(x, y)).map(([x, y]) => [x, y, "~"]),
  ),
  softDensity: 0.75,
};

/** Crates: fireproof cover that anyone can shove about. */
export const WAREHOUSE: MapDef = {
  id: "warehouse",
  name: "Armazém",
  rows: mark(build(isClassicPillar), [
    [5, 3, "="], [9, 3, "="], [3, 5, "="], [11, 5, "="], [7, 5, "="],
    [3, 7, "="], [11, 7, "="], [7, 7, "="], [5, 9, "="], [9, 9, "="],
  ]),
  softDensity: 0.55,
};

/** Lava: vents in a cross through the middle that all erupt every few seconds. */
export const VOLCANO: MapDef = {
  id: "volcano",
  name: "Vulcão",
  rows: mark(build((x, y) => (x === 4 || x === 10) && (y === 4 || y === 8)), [
    [7, 5, "*"], [6, 6, "*"], [7, 6, "*"], [8, 6, "*"], [7, 7, "*"],
    [7, 2, "*"], [7, 10, "*"], [2, 6, "*"], [12, 6, "*"],
  ]),
  softDensity: 0.6,
};

export const MAPS: MapDef[] = [CLASSIC, OPEN_FIELD, MAZE, QUADRANTS, DUEL, FACEOFF, ASSEMBLY, PORTALS, LAKE, WAREHOUSE, VOLCANO];
export const MAP_IDS = ["classic", "open", "maze", "quadrants", "duel", "faceoff", "assembly", "portals", "lake", "warehouse", "volcano"] as const;
export type MapId = (typeof MAP_IDS)[number];

export function getMap(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? CLASSIC;
}

export function isMapId(id: unknown): id is string {
  return typeof id === "string" && MAPS.some((m) => m.id === id);
}

/** What the host picks in place of a map to have one drawn at random for every match. */
export const RANDOM_MAP = "random";

/** One of `maps`, drawn with `dice`: not `last` (the one just played) while there is another to draw. */
export function drawMap(maps: readonly MapDef[], dice: { rng: number }, last: string | null = null): MapDef {
  const fresh = maps.filter((m) => m.id !== last);
  return pickRandom(dice, fresh.length > 0 ? fresh : maps);
}
