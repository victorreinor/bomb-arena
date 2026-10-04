/**
 * The special floors and the crate (floor.png): ice, a lava vent (cold and hot), a crate, the frames of
 * a belt running right and, a row per pair, the frames of a portal swirling. The sheet's layout comes
 * from the client's sprites.ts (FLOOR_CELLS, BELT_FRAMES, PORTAL_FRAMES, PORTAL_COLORS).
 */
import { BELT_FRAMES, FLOOR_CELLS, PORTAL_COLORS, PORTAL_FRAMES, TILE_PX as T } from "../apps/web/src/game/sprites";
import { Img, ellipse, hex, lighten, mix, shade } from "./png";

/** Sheer ice laid over the floor: see-through blue, a frame where the slabs meet, streaks of shine. */
function iceCell(): Img {
  const img = new Img(T, T);
  img.rect(0, 0, T, T, hex("#a8d8f8", 200));
  img.rect(0, 0, T, 1, hex("#e8f6ff", 220));
  img.rect(0, 0, 1, T, hex("#d8f0ff", 210));
  img.rect(0, T - 1, T, 1, hex("#6aa7d0", 210));
  img.rect(T - 1, 0, 1, T, hex("#7ab4da", 210));
  for (let i = 0; i < 5; i++) img.set(3 + i, 9 - i, hex("#ffffff", 230));
  for (let i = 0; i < 3; i++) img.set(9 + i, 12 - i, hex("#ffffff", 210));
  for (const [x, y] of [[11, 3], [12, 4], [12, 5]]) img.set(x, y, hex("#6aa7d0", 220)); // a hairline crack
  return img;
}

/** A crater in the rock with lava at the bottom: dull (`hot` false) or glowing, about to blow. */
function ventCell(hot: boolean): Img {
  const img = new Img(T, T);
  ellipse(img, 7.5, 8, 7, 5.5, (d) => (d > 0.78 ? hex("#2a2022") : null));
  ellipse(img, 7.5, 8, 5.4, 4, (d) => {
    if (!hot) return d > 0.6 ? hex("#3a1a14") : hex("#7a2a12");
    return d > 0.7 ? hex("#ff5a1a") : d > 0.35 ? hex("#ffa020") : hex("#fff0a0");
  });
  for (const [x, y] of [[1, 8], [2, 8], [13, 7], [14, 6], [7, 2], [8, 13]]) img.set(x, y, hot ? hex("#ff7a1a") : hex("#5a2414")); // cracks
  return img;
}

/** A sturdy crate: dark planks with a cross brace and a dark outline (it must stand out on a plank floor), steel corners, banded front. */
function crateCell(): Img {
  const img = new Img(T, T);
  const wood = hex("#7c4a24");
  img.rect(0, 0, T, 11, wood);
  for (const y of [3, 7]) img.rect(1, y, T - 2, 1, shade(wood, 0.7));
  for (let i = 0; i < 9; i++) {
    img.set(2 + Math.round(i * 1.4), 1 + i, hex("#a8703e"));
    img.set(13 - Math.round(i * 1.4), 1 + i, hex("#a8703e"));
  }
  img.rect(0, 0, T, 1, hex("#2e1a0c"));
  img.rect(0, 0, 1, 11, hex("#2e1a0c"));
  img.rect(T - 1, 0, 1, 11, hex("#2e1a0c"));
  img.rect(1, 1, T - 2, 1, lighten(wood, 0.3));
  for (const [x, y] of [[1, 1], [12, 1], [1, 7], [12, 7]]) {
    img.rect(x, y, 3, 3, hex("#c8ced8")); // steel corners
    img.set(x + 1, y + 1, hex("#5a606c"));
  }
  img.rect(0, 11, T, 5, hex("#5a3418"));
  img.rect(0, 12, T, 1, hex("#aeb4c0"));
  img.rect(0, 14, T, 1, hex("#aeb4c0"));
  img.rect(0, 11, 1, 5, hex("#2e1a0c"));
  img.rect(T - 1, 11, 1, 5, hex("#2e1a0c"));
  img.rect(0, 15, T, 1, hex("#24140a"));
  return img;
}

/** A belt running right, its chevrons `step` pixels along (they repeat every 8). */
function beltCell(step: number): Img {
  const img = new Img(T, T);
  img.rect(0, 0, T, T, hex("#2a2c33"));
  for (const y of [0, T - 2]) {
    // the rollers along each side
    img.rect(0, y, T, 2, hex("#8a909c"));
    for (let x = (step + 1) % 4; x < T; x += 4) img.set(x, y + (y === 0 ? 1 : 0), hex("#5a606c"));
  }
  const arrow = [[0, 4], [1, 5], [2, 6], [2, 7], [1, 8], [0, 9]];
  for (let c = step - 8; c < T; c += 8) {
    for (const [dx, y] of arrow) {
      for (const x of [c + dx, c + dx + 1]) if (x >= 0 && x < T) img.set(x, y + 1, hex("#f2c230"));
    }
  }
  return img;
}

/** A portal pad of `color`, its swirl turned `frame` steps of PORTAL_FRAMES. */
function portalCell(color: string, frame: number): Img {
  const img = new Img(T, T);
  const c = hex(color);
  ellipse(img, 7.5, 8, 7.4, 6.4, (d) => (d > 0.82 ? hex("#5a606c") : d > 0.7 ? hex("#c0c6d0") : shade(c, 0.35)));
  // four arms curling round the middle
  for (let k = 0; k < 4; k++) {
    for (let t = 0; t < 1; t += 0.08) {
      const a = (k * Math.PI) / 2 + (frame * Math.PI) / (2 * PORTAL_FRAMES) + t * 2.2;
      const rad = 1 + t * 4.4;
      img.set(Math.round(7.5 + Math.cos(a) * rad), Math.round(8 + Math.sin(a) * rad * 0.86), t < 0.5 ? lighten(c, 0.5) : c);
    }
  }
  ellipse(img, 7.5, 8, 1.6, 1.4, () => hex("#ffffff"));
  img.set(7, 8, mix(c, hex("#ffffff"), 0.5));
  return img;
}

export function floorSheet(): Img {
  const sheet = new Img(T * Math.max(FLOOR_CELLS.length + BELT_FRAMES, PORTAL_FRAMES), T * (1 + PORTAL_COLORS.length));
  const cells: Record<(typeof FLOOR_CELLS)[number], Img> = { ice: iceCell(), vent: ventCell(false), ventHot: ventCell(true), crate: crateCell() };
  FLOOR_CELLS.forEach((name, i) => sheet.blit(cells[name], i * T, 0));
  for (let f = 0; f < BELT_FRAMES; f++) sheet.blit(beltCell(f * 2), (FLOOR_CELLS.length + f) * T, 0);
  PORTAL_COLORS.forEach((color, row) => {
    for (let f = 0; f < PORTAL_FRAMES; f++) sheet.blit(portalCell(color, f), f * T, (1 + row) * T);
  });
  return sheet;
}
