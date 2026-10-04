import { BELT_DIRS, FLOOR, PET_KINDS, PLAYER_COLORS, type Bomb, type Dir, type PetKind } from "@bomb-arena/engine";

/**
 * The layout of every sprite sheet lives here: the game reads it to draw, and the generator in tools/
 * imports it to paint, so the two can't drift apart.
 */

/** One board tile is TILE_PX x TILE_PX sprite pixels (tiles, items and bombs use cells of that size). */
export const TILE_PX = 16;

/** Each map has its look: one tiles-<theme>.png per theme. */
export const TILE_THEMES = ["garden", "snow", "temple", "factory", "assembly", "space", "ice", "warehouse", "volcano"] as const;
export type TileTheme = (typeof TILE_THEMES)[number];
/**
 * tiles-<theme>.png columns: two floor tones (alternating like a chessboard), each also with a small
 * detail, both tones again in a block's shadow, the fixed block and the brick.
 */
export const TILE_SHEET = ["floorA", "floorB", "floorADetail", "floorBDetail", "shadowA", "shadowB", "hard", "soft"] as const;
export type TileName = (typeof TILE_SHEET)[number];

/**
 * Each theme's key colours, for its brick (or crate, pot, snow block) and its fixed block: the tiles
 * are painted with them and the debris of a broken block flies off in them.
 */
export const THEME_COLORS: Record<TileTheme, { brick: [base: string, lit: string, dim: string, dark: string]; block: [top: string, front: string, accent: string] }> = {
  garden: { brick: ["#df7c43", "#f39d62", "#b65a2c", "#8a4220"], block: ["#b7bccd", "#7a7f97", "#e6e9f2"] },
  snow: { brick: ["#b9d4ee", "#eef6fd", "#98b9db", "#5d7da2"], block: ["#9fd3ea", "#5f9fc2", "#ffffff"] },
  temple: { brick: ["#c4643a", "#ea8d58", "#93421f", "#e7c15e"], block: ["#d3a65e", "#a87c3d", "#f6d595"] },
  factory: { brick: ["#c58b4f", "#e7b47a", "#94602f", "#6b4220"], block: ["#9aa4b8", "#6e778c", "#f2c230"] },
  assembly: { brick: ["#c89a5a", "#e6bd7f", "#9c7038", "#6e4c22"], block: ["#5c6270", "#3c414d", "#ff9a1e"] },
  space: { brick: ["#9a5cf0", "#d2a8ff", "#6a34b8", "#3c1a70"], block: ["#8a92b8", "#5a6188", "#5ff0ff"] },
  ice: { brick: ["#f4f8ff", "#ffffff", "#c8d4ea", "#8a9ab8"], block: ["#8c93a6", "#5e6478", "#ffffff"] },
  warehouse: { brick: ["#c8b48a", "#e6d6b0", "#9c8a62", "#6e5e3e"], block: ["#9aa0aa", "#6a707a", "#f2c230"] },
  volcano: { brick: ["#7a3a2a", "#a65a3a", "#52261a", "#ff7a1a"], block: ["#3a2c44", "#1e1626", "#b58cff"] },
};

/**
 * The tile for the board cell at (x, y). `shaded`: a block stands on the cell above, so its shadow
 * falls here. Details are sprinkled on a fixed fifth of the cells, the same ones every time.
 */
export function tileName(kind: "floor" | "hard" | "soft", shaded: boolean, x: number, y: number): TileName {
  if (kind !== "floor") return kind;
  const b = (x + y) % 2 === 1;
  if (shaded) return b ? "shadowB" : "shadowA";
  const detail = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 5 === 0;
  return detail ? (b ? "floorBDetail" : "floorADetail") : b ? "floorB" : "floorA";
}

/** Paints one board tile from a theme's sheet at board cell (x, y). */
export function drawTile(g: CanvasRenderingContext2D, sheet: CanvasImageSource, tile: TileName, x: number, y: number) {
  g.drawImage(sheet, TILE_SHEET.indexOf(tile) * TILE_PX, 0, TILE_PX, TILE_PX, x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
}

/**
 * floor.png, the special floors and the crate in 16x16 cells. Row 0: FLOOR_CELLS, then BELT_FRAMES of a
 * belt running right (turned for the other ways), its chevrons stepping along. Then one row per portal
 * pair (PORTAL_COLORS, the pair's letter A, B, C...), PORTAL_FRAMES of it swirling.
 */
export const FLOOR_CELLS = ["ice", "vent", "ventHot", "crate"] as const;
export const BELT_FRAMES = 4;
export const PORTAL_FRAMES = 4;
export const PORTAL_COLORS = ["#5ff0ff", "#ff5fd2", "#b8ff5f", "#ffd23a"] as const;
export const floorSheetUrl = "/sprites/floor.png";

/** Paints one of FLOOR_CELLS from the floor sheet at board cell (x, y). */
export function drawFloorCell(g: CanvasRenderingContext2D, sheet: CanvasImageSource, cell: (typeof FLOOR_CELLS)[number], x: number, y: number) {
  drawCell(g, sheet, FLOOR_CELLS.indexOf(cell) * TILE_PX, 0, TILE_PX, TILE_PX, x * TILE_PX, y * TILE_PX, false);
}

/** Quarter turns from "right" for each belt direction. */
const TURNS: Record<Dir, number> = { right: 0, down: 1, left: 2, up: 3 };

/**
 * Paints a special floor (a FLOOR code) at board cell (x, y), `timeMs` into its animation: ice, a vent
 * (glowing `heat` from 0 to 1, about to erupt), a belt running its way, a portal in its pair's colour.
 */
export function drawFloor(g: CanvasRenderingContext2D, sheet: CanvasImageSource, code: number, x: number, y: number, timeMs: number, heat = 0) {
  if (code === FLOOR.ICE) return drawFloorCell(g, sheet, "ice", x, y);
  if (code === FLOOR.VENT) {
    drawFloorCell(g, sheet, "vent", x, y);
    if (heat <= 0) return;
    g.save();
    g.globalAlpha = Math.min(1, heat);
    drawFloorCell(g, sheet, "ventHot", x, y);
    g.restore();
    return;
  }
  if (code >= FLOOR.PORTAL) {
    const row = 1 + ((code - FLOOR.PORTAL) % PORTAL_COLORS.length);
    const frame = Math.floor(timeMs / 110) % PORTAL_FRAMES;
    return drawCell(g, sheet, frame * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX, x * TILE_PX, y * TILE_PX, false);
  }
  const belt = code - FLOOR.BELT;
  if (belt < 0 || belt >= BELT_DIRS.length) return;
  // 2 tiles a second: the chevrons, 8px apart, step 2px a frame
  const frame = Math.floor(timeMs / 62) % BELT_FRAMES;
  g.save();
  g.translate((x + 0.5) * TILE_PX, (y + 0.5) * TILE_PX);
  g.rotate((TURNS[BELT_DIRS[belt]] * Math.PI) / 2);
  g.drawImage(sheet, (FLOOR_CELLS.length + frame) * TILE_PX, 0, TILE_PX, TILE_PX, -TILE_PX / 2, -TILE_PX / 2, TILE_PX, TILE_PX);
  g.restore();
}

/** Copies one cell of a sheet, mirrored left-right when `flip` (left-facing frames are right ones flipped). */
function drawCell(ctx: CanvasRenderingContext2D, sheet: CanvasImageSource, sx: number, sy: number, w: number, h: number, dx: number, dy: number, flip: boolean) {
  const x = Math.round(dx);
  const y = Math.round(dy);
  if (!flip) return ctx.drawImage(sheet, sx, sy, w, h, x, y, w, h);
  ctx.save();
  ctx.translate(x + w, y);
  ctx.scale(-1, 1);
  ctx.drawImage(sheet, sx, sy, w, h, 0, 0, w, h);
  ctx.restore();
}

/**
 * bomber-<colour>.png: rows BOMBER_VIEWS (left is right mirrored); one column per BOMBER_FRAMES.
 * Cells are taller than a tile: the head rises over the tile behind, as in the 16-bit games.
 */
export const BOMBER_W = 16;
export const BOMBER_H = 24;
export const BOMBER_VIEWS = ["down", "up", "right"] as const;
export const BOMBER_FRAMES = [
  "idle",
  "walkA",
  "walkB",
  "kick",
  "punch",
  "throw",
  "carry",
  "carryWalkA",
  "carryWalkB",
  "place",
  "ride",
  "dizzy",
  "ouch",
] as const;
export type BomberFrame = (typeof BOMBER_FRAMES)[number];
/** bomber-emotes-<colour>.png, used by the podium: happy, happy (hop), sad, sad (tears) */
export const BOMBER_EMOTES = ["happyA", "happyB", "sadA", "sadB"] as const;

/**
 * pets.png: one row per PET_KINDS, PET_COLUMNS columns of PET_CELL square cells (left is right
 * mirrored). A mount comes in two layers so its rider sits between them: the body behind, the head in
 * front. Columns: down body x2 steps, down head x2, right body x2, right head x2, up x2 (seen from
 * behind the head is part of the body), then an icon of the whole critter facing the viewer.
 */
export const PET_CELL = 20;
export const PET_COLUMNS = 11;
export const PET_ICON_COLUMN = 10;
type MountLayer = "body" | "head";
export function petColumn(view: "down" | "right" | "up", layer: MountLayer, step: number): number {
  if (view === "up") return 8 + step;
  return (view === "down" ? 0 : 4) + (layer === "head" ? 2 : 0) + step;
}

/**
 * Where sprites sit relative to a player's centre, in sprite pixels: a standing bomber's boots touch
 * 5px below it; a rider sits 2px higher, on a mount whose cell is centred across and reaches 7px below.
 */
export const ANCHOR = {
  standTop: BOMBER_H - 5,
  rideTop: BOMBER_H - 3,
  mountLeft: PET_CELL / 2,
  mountTop: PET_CELL - 7,
} as const;

/**
 * bomb.png: one row per look, BOMB_PULSE_FRAMES columns each (the bomb swelling as its fuse burns).
 * A bomb with more than one wears the first that applies (see bombLook).
 */
export const BOMB_LOOKS = ["plain", "pierce", "rubber", "mine"] as const;
export type BombLook = (typeof BOMB_LOOKS)[number];
export const BOMB_PULSE_FRAMES = 3;
export const bombLook = (b: Pick<Bomb, "mine" | "pierce" | "rubber">): BombLook =>
  b.mine ? "mine" : b.pierce ? "pierce" : b.rubber ? "rubber" : "plain";

/** Draws one bomber frame with its top-left at (dx, dy). */
export function drawBomber(ctx: CanvasRenderingContext2D, sheet: CanvasImageSource, frame: BomberFrame, facing: Dir, dx: number, dy: number) {
  const row = BOMBER_VIEWS.indexOf(facing === "left" ? "right" : facing);
  drawCell(ctx, sheet, BOMBER_FRAMES.indexOf(frame) * BOMBER_W, row * BOMBER_H, BOMBER_W, BOMBER_H, dx, dy, facing === "left");
}

/** Draws one layer of a mount with its top-left at (dx, dy). */
export function drawMount(ctx: CanvasRenderingContext2D, sheet: CanvasImageSource, kind: PetKind, facing: Dir, step: number, layer: MountLayer, dx: number, dy: number) {
  const view = facing === "left" ? "right" : facing;
  if (view === "up" && layer === "head") return;
  const sx = petColumn(view, layer, step) * PET_CELL;
  drawCell(ctx, sheet, sx, PET_KINDS.indexOf(kind) * PET_CELL, PET_CELL, PET_CELL, dx, dy, facing === "left");
}

export interface Sprites {
  tiles: Record<TileTheme, HTMLImageElement>;
  /** special floors and the crate (see FLOOR_CELLS) */
  floor: HTMLImageElement;
  bomb: HTMLImageElement;
  powerups: HTMLImageElement;
  bombers: HTMLImageElement[];
  pets: HTMLImageElement;
}

const images = new Map<string, Promise<HTMLImageElement>>();
const ready = new Map<string, HTMLImageElement>();

/** An image `load` has already finished, if any. */
export const loaded = (src: string) => ready.get(src);

/** Loads an image once; later calls share the same promise. */
export function load(src: string): Promise<HTMLImageElement> {
  let image = images.get(src);
  if (!image) {
    image = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        ready.set(src, img);
        resolve(img);
      };
      img.onerror = () => reject(new Error(`failed to load ${src}`));
      img.src = src;
    });
    images.set(src, image);
  }
  return image;
}

export const tileSheetUrl = (theme: TileTheme) => `/sprites/tiles-${theme}.png`;

export async function loadSprites(): Promise<Sprites> {
  const [[bomb, powerups, pets, floor], tiles, bombers] = await Promise.all([
    Promise.all(["/sprites/bomb.png", "/sprites/powerups.png", "/sprites/pets.png", floorSheetUrl].map(load)),
    Promise.all(TILE_THEMES.map(async (theme) => [theme, await load(tileSheetUrl(theme))] as const)),
    Promise.all(Array.from({ length: PLAYER_COLORS }, (_, i) => load(`/sprites/bomber-${i}.png`))),
  ]);
  return { tiles: Object.fromEntries(tiles) as Record<TileTheme, HTMLImageElement>, floor, bomb, powerups, pets, bombers };
}
