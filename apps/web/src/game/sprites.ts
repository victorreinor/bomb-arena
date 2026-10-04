import { PLAYER_COLORS } from "@bomberman/engine";

/** Every sprite sheet is a grid of TILE_PX x TILE_PX cells, and one board tile is one cell. */
export const TILE_PX = 16;

export interface Sprites {
  tiles: HTMLImageElement;
  bomb: HTMLImageElement;
  powerups: HTMLImageElement;
  bombers: HTMLImageElement[];
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

export async function loadSprites(): Promise<Sprites> {
  const [tiles, bomb, powerups, ...bombers] = await Promise.all([
    load("/sprites/tiles.png"),
    load("/sprites/bomb.png"),
    load("/sprites/powerups.png"),
    ...Array.from({ length: PLAYER_COLORS }, (_, i) => load(`/sprites/bomber-${i}.png`)),
  ]);
  return { tiles, bomb, powerups, bombers };
}
