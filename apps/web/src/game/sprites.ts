import { PET_KINDS, PLAYER_COLORS, type Dir, type PetKind } from "@bomberman/engine";

/** Every sprite sheet is a grid of TILE_PX x TILE_PX cells, and one board tile is one cell. */
export const TILE_PX = 16;

/** tiles.png columns */
export const TILE_COL = { floor: 0, floorShadow: 1, hard: 2, soft: 3 } as const;

/** pets.png: one row per PET_KINDS, columns down0, down1, right0, right1, up0, up1 (left = right mirrored) */
export const PET_SHEET_COLS = 6;
const PET_VIEW: Record<Dir, number> = { down: 0, right: 1, left: 1, up: 2 };

/** Draws one pet frame with its top-left at (dx, dy). */
export function drawPetSprite(ctx: CanvasRenderingContext2D, sheet: CanvasImageSource, kind: PetKind, facing: Dir, frame: number, dx: number, dy: number) {
  const sx = (PET_VIEW[facing] * 2 + frame) * TILE_PX;
  const sy = PET_KINDS.indexOf(kind) * TILE_PX;
  if (facing !== "left") return ctx.drawImage(sheet, sx, sy, TILE_PX, TILE_PX, dx, dy, TILE_PX, TILE_PX);
  ctx.save();
  ctx.translate(dx + TILE_PX, dy);
  ctx.scale(-1, 1);
  ctx.drawImage(sheet, sx, sy, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
  ctx.restore();
}

export interface Sprites {
  tiles: HTMLImageElement;
  bomb: HTMLImageElement;
  powerups: HTMLImageElement;
  bombers: HTMLImageElement[];
  /** one row per PET_KINDS: down0, down1, right0, right1, up0, up1 */
  pets: HTMLImageElement;
}

const images = new Map<string, Promise<HTMLImageElement>>();

/** Loads an image once; later calls share the same promise. */
export function load(src: string): Promise<HTMLImageElement> {
  let image = images.get(src);
  if (!image) {
    image = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load ${src}`));
      img.src = src;
    });
    images.set(src, image);
  }
  return image;
}

export async function loadSprites(): Promise<Sprites> {
  const [tiles, bomb, powerups, pets, ...bombers] = await Promise.all([
    load("/sprites/tiles.png"),
    load("/sprites/bomb.png"),
    load("/sprites/powerups.png"),
    load("/sprites/pets.png"),
    ...Array.from({ length: PLAYER_COLORS }, (_, i) => load(`/sprites/bomber-${i}.png`)),
  ]);
  return { tiles, bomb, powerups, pets, bombers };
}
