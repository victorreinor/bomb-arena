/**
 * Generates the original pixel-art spritesheets used by the game into
 * apps/web/public/sprites. Run with `bun run sprites`.
 *
 * Each sheet is a grid of equal cells (16x16 tiles and items, 16x24 bombers, 20x20 mounts; see the
 * client's sprites.ts), so any of these PNGs can be replaced by hand-drawn art with the same layout
 * without touching game code. The bomber and the mounts are drawn in bomber-art.ts and pet-art.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ACCENT, COLOR_CSS } from "../apps/web/src/game/colors";
import { POWERUP_KINDS, type PowerUpKind } from "../packages/engine/src";
import { bomberSheet, emoteSheet } from "./bomber-art";
import { petSheet } from "./pet-art";
import { floorSheet } from "./floor-art";
import { tileSheet } from "./tile-art";
import { BOMB_LOOKS, BOMB_PULSE_FRAMES, TILE_THEMES, type BombLook } from "../apps/web/src/game/sprites";
import { Img, ellipse, encodePng, fromAscii, hex, lighten, shade, upscale, type RGBA } from "./png";

const OUT = join(import.meta.dir, "../apps/web/public/sprites");
mkdirSync(OUT, { recursive: true });

const T = 16;

function save(name: string, img: Img) {
  writeFileSync(join(OUT, name), encodePng(img));
  console.log(`wrote ${name} (${img.w}x${img.h})`);
}

// ------------------------------------------------------------------ tiles

for (const theme of TILE_THEMES) save(`tiles-${theme}.png`, tileSheet(theme));
save("floor.png", floorSheet());

// ------------------------------------------------------------------- bomb

/** Body, rim and the dull side of the shine for each round bomb look. */
const BOMB_COLORS: Record<Exclude<BombLook, "mine">, [body: string, rim: string, dim: string]> = {
  plain: ["#1d1d2b", "#3a3a55", "#9a9ab8"],
  pierce: ["#123352", "#3f86b8", "#8fd0ff"],
  rubber: ["#a8245e", "#ff6fae", "#ffc2dc"],
};

/** The fuse burning down to a spark, top right of a round bomb. */
function fuse(img: Img) {
  img.rect(9, 3, 2, 2, hex("#8a5a2a"));
  img.rect(10, 2, 1, 1, hex("#8a5a2a"));
  img.rect(11, 0, 2, 2, hex("#ffd23a")); // spark
  img.set(12, 1, hex("#ff7a1a"));
  img.set(11, 2, hex("#ff7a1a"));
}

/**
 * One pulse frame of a bomb: round ones of `radius` (the piercing one with a bright band and a spike
 * each side, the rubber one pink), the mine a flat dome whose button lights up on the big frame.
 */
function bombFrame(radius: number, look: BombLook = "plain"): Img {
  const img = new Img(T, T);
  if (look === "mine") {
    const [cx, cy, rx, ry] = [7.5, 11, radius + 1, radius * 0.55 + 0.5];
    ellipse(img, cx, cy, rx, ry, (d, _x, y) => (y > cy + 1 ? null : d > 0.8 || y > cy ? hex("#6a7840") : hex("#3c4426")));
    img.rect(2, 12, 12, 1, hex("#2a2f1a")); // its rim on the ground
    for (const x of [4, 7, 10]) img.set(x, 10, hex("#9aa86a")); // studs
    const top = Math.floor(cy - ry) - 1; // the button sits on top of the dome
    img.rect(7, top, 2, 2, radius === 7 ? hex("#ff8a8a") : hex("#e8404a"));
    img.set(7, top, hex("#ffffff"));
    return img;
  }
  const [body, rim, dim] = BOMB_COLORS[look].map((c) => hex(c));
  const cx = 7.5;
  const cy = 9;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= radius) img.set(x, y, d > radius - 1.2 ? rim : body);
    }
  }
  if (look === "pierce") {
    for (let x = Math.ceil(cx - radius); x <= cx + radius; x++) img.set(x, 10, hex("#8fe8ff"));
    for (const x of [Math.round(cx - radius) - 1, Math.round(cx + radius)]) img.rect(x, 9, 1, 3, hex("#c8d4e0"));
  }
  img.rect(5, 6, 2, 2, hex("#ffffff"));
  img.rect(4, 7, 1, 1, dim);
  fuse(img);
  return img;
}

const PULSE_RADII = [6, 7, 6];
const bomb = new Img(T * BOMB_PULSE_FRAMES, T * BOMB_LOOKS.length);
BOMB_LOOKS.forEach((look, row) => PULSE_RADII.forEach((r, i) => bomb.blit(bombFrame(r, look), i * T, row * T)));
save("bomb.png", bomb);
save("favicon.png", bombFrame(6));

// -------------------------------------------------------------- app icons

/** the bomb stays within this share of the icon, inside the circle launchers may crop a "maskable" icon to */
const ICON_ART_SHARE = 0.62;

// home-screen icons: iOS asks for 180, the web app manifest for 192 and 512
for (const size of [180, 192, 512]) {
  const k = Math.floor((size * ICON_ART_SHARE) / T);
  const icon = new Img(size, size);
  icon.rect(0, 0, size, size, hex(ACCENT)); // like the touch bomb button
  const at = Math.round((size - T * k) / 2);
  icon.blit(upscale(bombFrame(7), k), at, at);
  save(`icon-${size}.png`, icon);
}

// -------------------------------------------------------------- power-ups

/** One icon per power-up; the sheet's column order comes from POWERUP_KINDS, like the client's. */
const ICONS: Record<PowerUpKind, { bg: string; rows: string[] }> = {
  bomb: {
    bg: "#2f6fdf",
    rows: ["....Y...", "...Y....", "..KKKK..", ".KKKKKK.", ".KWKKKK.", ".KKKKKK.", "..KKKK..", "........"],
  },
  fire: {
    bg: "#d9402e",
    rows: ["...O....", "..OO.O..", "..OOOO..", ".OOYYOO.", ".OYYYYO.", ".OYWWYO.", "..OYYO..", "...OO..."],
  },
  speed: {
    bg: "#e8a928",
    rows: [".KKK....", ".KWW....", ".KWW....", ".KWWK...", ".KWWWKK.", ".KWWWWWK", ".KKKKKKK", "........"],
  },
  kick: {
    bg: "#7a5a2a",
    rows: ["......Y.", ".....N..", "..KKKKK.", "W.KKWKKK", "WW.KKKKK", "W.KKKKKK", "..KKKKK.", "........"],
  },
  punch: {
    bg: "#b8302e",
    rows: ["..KKKK..", ".KRRRRK.", "KRRWRRRK", "KRRRRRRK", "KRRRRRRK", ".KRRRRK.", "..KWWK..", "..KKKK.."],
  },
  glove: {
    bg: "#c98a1e",
    rows: [".K.K.K..", "KYKYKYK.", "KYYYYYYK", "KYYYYYYK", ".KYYYYYK", "..KYYYK.", "..KBBBK.", "..KKKKK."],
  },
  remote: {
    bg: "#4a5a7a",
    rows: ["......R.", "......K.", ".KKKKKK.", "KGGGGGGK", "KGRRGYGK", "KGRRGGGK", "KGGGGGGK", ".KKKKKK."],
  },
  bombPass: {
    bg: "#2a8a9a",
    rows: ["....Y...", "...N....", "..KKKK..", ".KKWKKK.", "LLLLLLLL", ".KKKKKK.", "..KKKK..", "........"],
  },
  wallPass: {
    bg: "#6a4a2a",
    rows: ["NNNNNNNN", "NOOONOON", "LLLLLLLL", "NNONNNON", "NOOONOON", "NNNNNNNN", "........", "........"],
  },
  vest: {
    bg: "#3a5ac8",
    rows: [".KKKKKK.", "KBBBBBBK", "KBWBBBBK", "KBWBBBBK", ".KBBBBK.", ".KBBBBK.", "..KBBK..", "...KK..."],
  },
  skull: {
    bg: "#5a2a7a",
    rows: ["..KKKK..", ".KWWWWK.", "KWWWWWWK", "KWKWWKWK", "KWWWWWWK", ".KWKKWK.", "..KWWK..", "...KK..."],
  },
  line: {
    bg: "#c9602a",
    rows: ["........", "Y..Y..Y.", "KK.KK.KK", "KK.KK.KK", "........", "WWWWWWWW", "........", "........"],
  },
  egg: {
    bg: "#2f8a5a",
    rows: ["...KK...", "..KWWK..", ".KWRWWK.", ".KWWWBK.", "KWWWWWWK", "KWBWWRWK", ".KWWWWK.", "..KKKK.."],
  },
  power: {
    bg: "#a82a2a",
    rows: [".....Y..", "....N...", "..RRRR..", ".RRWRRR.", "RRWRRRRR", "RRRRRRRR", ".RRRRRR.", "..RRRR.."],
  },
  pierce: {
    bg: "#1f6f9a",
    rows: ["NNNNNNNN", "NONNNONN", "YYYYYYW.", "YYYYYYYW", "YYYYYYW.", "NNNONNNO", "NNNNNNNN", "........"],
  },
  rubber: {
    bg: "#7a2a5a",
    rows: ["....Y...", "...N....", "..PPPP..", ".PPWPPP.", ".PPPPPP.", ".PPPPPP.", "..PPPP..", "L......L"],
  },
  mine: {
    bg: "#4a5a2a",
    rows: ["........", "........", "...RR...", "..KRWK..", ".KKKKKK.", "KGGGGGGK", "KKKKKKKK", "NNNNNNNN"],
  },
};
const ICON_PALETTE: Record<string, RGBA> = {
  K: hex("#15151f"),
  W: hex("#ffffff"),
  Y: hex("#ffe14a"),
  O: hex("#ff8a1e"),
  R: hex("#e8404a"),
  B: hex("#3f7bff"),
  L: hex("#8fd0ff"),
  G: hex("#9aa0b8"),
  N: hex("#8a5a2a"),
  P: hex("#ff6fae"),
};

const powerups = new Img(T * POWERUP_KINDS.length, T);
POWERUP_KINDS.map((kind) => ICONS[kind]).forEach((icon, i) => {
  const cell = new Img(T, T);
  cell.rect(1, 1, 14, 14, shade(hex(icon.bg), 0.55));
  cell.rect(2, 2, 12, 12, hex(icon.bg));
  cell.rect(2, 2, 12, 1, lighten(hex(icon.bg), 0.4));
  cell.blit(fromAscii(icon.rows, ICON_PALETTE), 4, 4);
  powerups.blit(cell, i * T, 0);
});
save("powerups.png", powerups);

// ----------------------------------------------------------------- bomber

COLOR_CSS.forEach((c, i) => {
  save(`bomber-${i}.png`, bomberSheet(c));
  save(`bomber-emotes-${i}.png`, emoteSheet(c));
});

// -------------------------------------------------------------------- pets

save("pets.png", petSheet());
