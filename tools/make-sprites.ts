/**
 * Generates the original pixel-art spritesheets used by the game into
 * apps/web/public/sprites. Run with `bun run sprites`.
 *
 * Every sheet is a grid of 16x16 cells, so any of these PNGs can be replaced by
 * hand-drawn art with the same layout without touching game code.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COLOR_CSS } from "../apps/web/src/game/colors";
import { POWERUP_KINDS, type PowerUpKind } from "../packages/engine/src";
import { Img, encodePng, fromAscii, hex, type RGBA } from "./png";

const OUT = join(import.meta.dir, "../apps/web/public/sprites");
mkdirSync(OUT, { recursive: true });

const T = 16;

function save(name: string, img: Img) {
  writeFileSync(join(OUT, name), encodePng(img));
  console.log(`wrote ${name} (${img.w}x${img.h})`);
}

function shade(c: RGBA, f: number): RGBA {
  const m = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return [m(c[0]), m(c[1]), m(c[2]), c[3]];
}

function lighten(c: RGBA, f: number): RGBA {
  const m = (v: number) => Math.min(255, Math.round(v + (255 - v) * f));
  return [m(c[0]), m(c[1]), m(c[2]), c[3]];
}

// ------------------------------------------------------------------ tiles

function floorTile(shadow: boolean): Img {
  const img = new Img(T, T);
  const base = hex("#58b858");
  const alt = hex("#4fae52");
  img.rect(0, 0, T, T, base);
  img.rect(0, 0, 8, 8, alt);
  img.rect(8, 8, 8, 8, alt);
  img.rect(3, 12, 1, 1, hex("#6cca6a"));
  img.rect(11, 4, 1, 1, hex("#6cca6a"));
  if (shadow) img.rect(0, 0, T, 5, hex("#2f8a45", 150));
  return img;
}

function hardTile(): Img {
  const img = new Img(T, T);
  img.rect(0, 0, T, T, hex("#8a8fa8"));
  img.rect(0, 0, T, 1, hex("#d3d7e6"));
  img.rect(0, 0, 1, T, hex("#d3d7e6"));
  img.rect(0, T - 1, T, 1, hex("#4a4f68"));
  img.rect(T - 1, 0, 1, T, hex("#4a4f68"));
  img.rect(3, 3, 10, 10, hex("#4a4f68"));
  img.rect(4, 4, 9, 9, hex("#a4a9c2"));
  img.rect(4, 4, 9, 1, hex("#c9cde0"));
  img.rect(4, 4, 1, 9, hex("#c9cde0"));
  img.rect(5, 5, 7, 7, hex("#9398b3"));
  return img;
}

function softTile(): Img {
  const img = new Img(T, T);
  const brick = hex("#cf8340");
  const mortar = hex("#6e401c");
  img.rect(0, 0, T, T, brick);
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    img.rect(0, y + 3, T, 1, mortar);
    const off = row % 2 === 0 ? 0 : 4;
    for (let x = off; x < T + 8; x += 8) img.rect(x, y, 1, 4, mortar);
    for (let x = off; x < T; x += 8) img.rect(x + 1, y, 6, 1, lighten(brick, 0.25));
  }
  img.rect(0, 0, T, 1, lighten(brick, 0.3));
  img.rect(0, T - 1, T, 1, mortar);
  return img;
}

const tiles = new Img(T * 4, T);
tiles.blit(floorTile(false), 0, 0);
tiles.blit(floorTile(true), T, 0);
tiles.blit(hardTile(), T * 2, 0);
tiles.blit(softTile(), T * 3, 0);
save("tiles.png", tiles);

// ------------------------------------------------------------------- bomb

function bombFrame(radius: number): Img {
  const img = new Img(T, T);
  const cx = 7.5;
  const cy = 9;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= radius) img.set(x, y, d > radius - 1.2 ? hex("#3a3a55") : hex("#1d1d2b"));
    }
  }
  img.rect(5, 6, 2, 2, hex("#ffffff"));
  img.rect(4, 7, 1, 1, hex("#9a9ab8"));
  img.rect(9, 3, 2, 2, hex("#8a5a2a")); // fuse
  img.rect(10, 2, 1, 1, hex("#8a5a2a"));
  img.rect(11, 0, 2, 2, hex("#ffd23a")); // spark
  img.set(12, 1, hex("#ff7a1a"));
  img.set(11, 2, hex("#ff7a1a"));
  return img;
}

const bomb = new Img(T * 3, T);
[6, 7, 6].forEach((r, i) => bomb.blit(bombFrame(r), i * T, 0));
save("bomb.png", bomb);
save("favicon.png", bombFrame(6));

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
  power: {
    bg: "#a82a2a",
    rows: [".....Y..", "....N...", "..RRRR..", ".RRWRRR.", "RRWRRRRR", "RRRRRRRR", ".RRRRRR.", "..RRRR.."],
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


type Face = "down" | "up" | "left" | "right";
const FACES: Record<Face, string[]> = {
  down: ["SSSSSSSS", "SSKSSKSS", "SSKSSKSS", "SSSSSSSS"],
  up: ["CCCCCCCC", "CCCCCCCC", "CCCCCCCC", "CCCCCCCC"],
  left: ["SSSSSSCC", "SKSSKSCC", "SKSSKSCC", "SSSSSSCC"],
  right: ["CCSSSSSS", "CCSKSSKS", "CCSKSSKS", "CCSSSSSS"],
};

const LEGS = [
  ["...KBBKKKKBBK...", "...KKK....KKK..."], // idle
  ["...KBBKKKKBBK...", "..KKKK....KKK..."], // walk A
  ["...KBBKKKKBBK...", "...KKK....KKKK.."], // walk B
];

const BOMBER_PALETTE = {
  K: hex("#15151f"),
  S: hex("#ffe3c4"),
  B: hex("#3a4a9a"),
  R: hex("#ff5a7a"),
  W: hex("#ffffff"),
  T: hex("#7ad0ff"),
};

/** Same body for every pose; only the 8x4 face and the legs change. */
function bomberFromFace(color: RGBA, faceRows: string[], legs: string[]): Img {
  const head = faceRows.map((interior) => `..KC${interior}CK..`);
  const rows = [
    ".......RR.......",
    "......RRRR......",
    ".......KK.......",
    "....KKKKKKKK....",
    "...KCHHCCCCCK...",
    "..KCCCCCCCCCCK..",
    ...head,
    "...KCCCCCCCCK...",
    "....KKKKKKKK....",
    "...KBBBBBBBBK...",
    "..KBBBBBBBBBBK..",
    ...legs,
  ];
  return fromAscii(rows, { ...BOMBER_PALETTE, C: color, H: lighten(color, 0.55) });
}

/**
 * Podium poses. happy: closed smiling eyes, arms (white gloves) up; sad: frown, tears,
 * arms hanging. Two frames of each so the CSS can bounce / sob.
 */
function emoteFrame(color: RGBA, mood: "happy" | "sad", variant: 0 | 1): Img {
  const happyFace = ["SSSSSSSS", "SKKSSKKS", "SSSSSSSS", "SKRRRRKS"];
  const sadFace =
    variant === 0
      ? ["SSKSSKSS", "STKSSKTS", "SSSKKSSS", "STKSSKTS"]
      : ["SSKSSKSS", "SSKSSKSS", "STSKKSTS", "SSKSSKSS"];
  const body = bomberFromFace(color, mood === "happy" ? happyFace : sadFace, mood === "happy" && variant === 1 ? LEGS[1] : LEGS[0]);
  const K = BOMBER_PALETTE.K;
  const B = BOMBER_PALETTE.B;
  const W = BOMBER_PALETTE.W;
  const tear = BOMBER_PALETTE.T;

  if (mood === "happy") {
    for (const left of [true, false]) {
      const x = left ? 0 : 14;
      body.rect(x, 3, 2, 3, W); // glove
      body.rect(x, 2, 2, 1, K);
      body.rect(left ? 2 : 13, 3, 1, 2, K);
      body.rect(left ? 1 : 14, 6, 1, 6, B); // raised sleeve
      body.rect(left ? 0 : 15, 6, 1, 6, K);
    }
  } else {
    for (const left of [true, false]) {
      body.rect(left ? 1 : 14, 12, 1, 3, B); // arms hanging
      body.rect(left ? 0 : 15, 12, 1, 3, K);
      body.rect(left ? 0 : 14, 15, 2, 1, W);
    }
    const y = variant === 0 ? 10 : 12; // tears drip down past the chin
    body.set(2, y, tear);
    body.set(13, y, tear);
  }

  if (mood === "happy" && variant === 1) {
    const jumped = new Img(T, T);
    jumped.blit(body, 0, -1);
    return jumped;
  }
  return body;
}

COLOR_CSS.forEach((c, i) => {
  const sheet = new Img(T * 3, T * 4);
  (["down", "up", "left", "right"] as Face[]).forEach((face, row) => {
    LEGS.forEach((legs, col) => sheet.blit(bomberFromFace(hex(c), FACES[face], legs), col * T, row * T));
  });
  save(`bomber-${i}.png`, sheet);
});

COLOR_CSS.forEach((c, i) => {
  const sheet = new Img(T * 4, T);
  sheet.blit(emoteFrame(hex(c), "happy", 0), 0, 0);
  sheet.blit(emoteFrame(hex(c), "happy", 1), T, 0);
  sheet.blit(emoteFrame(hex(c), "sad", 0), T * 2, 0);
  sheet.blit(emoteFrame(hex(c), "sad", 1), T * 3, 0);
  save(`bomber-emotes-${i}.png`, sheet);
});
