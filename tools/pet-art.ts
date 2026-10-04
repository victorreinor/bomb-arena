/**
 * The mounts, original critters each suited to its power: the runner is an emu-ish rhea, the jumper a frog,
 * the pusher an armadillo, the kicker a donkey. Each wears a saddle in its item colour.
 *
 * Shapes are painted on layers and every layer gets its own outline, so parts in front keep a clean edge.
 * A mount is drawn in two layers so the rider can sit between them: the body behind the rider, the head
 * (and anything else meant to show in front of the rider's legs) after.
 *
 * Sheet layout (cell size and columns) comes from the client's sprites.ts, which reads it.
 */
import { PET_KINDS, type PetKind } from "../packages/engine/src";
import { PET_INFO } from "../apps/web/src/game/items";
import { PET_CELL, PET_COLUMNS, PET_ICON_COLUMN, petColumn } from "../apps/web/src/game/sprites";
import { Img, hex, shade, type RGBA } from "./png";

/** a palette key */
type Key = string;

class Layer {
  px: (Key | null)[] = new Array(PET_CELL * PET_CELL).fill(null);
  set(x: number, y: number, k: Key) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < PET_CELL && y < PET_CELL) this.px[y * PET_CELL + x] = k;
  }
  get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < PET_CELL && y < PET_CELL ? this.px[y * PET_CELL + x] : null;
  }
  /** A filled ellipse lit from the top left: `dark` on the far side, `light` near the light (body colours by default). */
  blob(cx: number, cy: number, rx: number, ry: number, base: Key = "B", light: Key = base === "B" ? "L" : base, dark: Key = base === "B" ? "D" : base) {
    for (let y = 0; y < PET_CELL; y++) {
      for (let x = 0; x < PET_CELL; x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny > 1) continue;
        const lit = -(nx * 0.6 + ny * 0.8);
        this.set(x, y, lit > 0.5 ? light : lit < -0.45 ? dark : base);
      }
    }
    return this;
  }
  rect(x: number, y: number, w: number, h: number, k: Key) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, k);
    return this;
  }
  line(x0: number, y0: number, x1: number, y1: number, k: Key, width = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      this.rect(Math.round(x - (width - 1) / 2), Math.round(y - (width - 1) / 2), width, width, k);
    }
    return this;
  }
  /** Pixels written as-is (no outline): eyes, nostrils, markings. */
  dots(points: [number, number, Key][]) {
    for (const [x, y, k] of points) this.set(x, y, k);
    return this;
  }
}

/** Stack layers, each ringed by its own outline. Detail layers (`plain`) go on top without one. */
function compose(layers: Layer[], plain: Layer[] = []): Layer {
  const out = new Layer();
  for (const l of layers) {
    for (let y = 0; y < PET_CELL; y++) {
      for (let x = 0; x < PET_CELL; x++) {
        if (l.get(x, y)) continue;
        if (l.get(x - 1, y) || l.get(x + 1, y) || l.get(x, y - 1) || l.get(x, y + 1)) out.set(x, y, "K");
      }
    }
    l.px.forEach((k, i) => k && (out.px[i] = k));
  }
  for (const l of plain) l.px.forEach((k, i) => k && (out.px[i] = k));
  return out;
}

/** An eye: a two-pixel pupil with a glint above, or (big) set in a 3x3 white, looking ahead when `look` is 1. */
const eye = (l: Layer, x: number, y: number, look: 0 | 1 = 0, big = false) => {
  if (big) l.rect(x - 1, y - 1, 3, 3, "W");
  const px = big ? x + look : x;
  l.set(px, y, "E");
  l.set(px, y + 1, "E");
  if (!big) l.set(x, y - 1, "W");
};

/** Which legs are lifted this step: every other one, swapping each step. */
const lifted = (step: 0 | 1, i: number) => (step === i % 2 ? 1 : 0);

interface Frames {
  downBody: Layer;
  downHead: Layer;
  rightBody: Layer;
  rightHead: Layer;
  up: Layer;
}

/** A saddle seen from the front (a strip either side of the rider), the side and the back. */
const saddleFront = (l: Layer, y: number) => l.rect(4, y, 3, 2, "S").rect(13, y, 3, 2, "S").rect(4, y + 1, 3, 1, "s").rect(13, y + 1, 3, 1, "s");
const saddleSide = (l: Layer, x: number, y: number, w: number) => l.rect(x, y, w, 2, "S").rect(x, y + 2, w, 1, "s").rect(x + 1, y + 3, 2, 2, "s");
const saddleBack = (l: Layer, y: number) => l.rect(5, y, 10, 3, "S").rect(5, y + 2, 10, 1, "s");

// ------------------------------------------------------------------ rhea (runner)

function rhea(step: 0 | 1): Frames {
  const legs = (xs: number[], top: number) => {
    const l = new Layer();
    xs.forEach((x, i) => l.rect(x, top, 1, 19 - top - lifted(step, i), "O").rect(x - 1, 19 - lifted(step, i), 3, 1, "O"));
    return l;
  };
  // front: a fluffy round body, a small head with a beak low in front
  const fBody = new Layer().blob(10, 11, 7.5, 6);
  fBody.dots([[4, 8, "L"], [6, 7, "L"], [14, 13, "D"], [15, 11, "D"]]);
  saddleFront(fBody, 9);
  const fLegs = legs([7, 12], 15);
  const fNeck = new Layer().rect(8, 13, 4, 4, "B");
  const fHead = new Layer().blob(10, 11.5, 4.2, 3.6);
  const fTuft = new Layer().rect(9, 7, 2, 1, "D").rect(10, 6, 1, 1, "D");
  const fBeak = new Layer().rect(9, 13, 2, 2, "O").rect(9, 15, 2, 1, "o");
  const fEyes = new Layer();
  eye(fEyes, 8, 11, 0, true);
  eye(fEyes, 12, 11, 0, true);
  // side: body with tail feathers, neck up to a head with a beak pointing ahead
  const sBody = new Layer().blob(8.5, 11, 6.5, 4.6);
  sBody.rect(1, 8, 3, 2, "B").rect(0, 7, 2, 2, "L");
  saddleSide(sBody, 6, 7, 6);
  const sLegs = legs([7, 11], 15);
  const sNeck = new Layer().line(14, 11, 16, 6, "B", 2);
  const sHead = new Layer().blob(16.5, 5, 2.8, 2.6);
  const sBeak = new Layer().rect(18, 5, 2, 1, "O").rect(18, 6, 1, 1, "o");
  const sEye = new Layer();
  eye(sEye, 17, 4, 1);
  // back: round body, the head peeking over the top
  const bHead = new Layer().blob(10, 4, 3, 2.6);
  const bBody = new Layer().blob(10, 11, 7.5, 6);
  saddleBack(bBody, 8);
  bBody.rect(8, 15, 4, 2, "L");
  const bLegs = legs([7, 12], 16);
  return {
    downBody: compose([fLegs, fBody]),
    downHead: compose([fNeck, fTuft, fHead, fBeak], [fEyes]),
    rightBody: compose([sLegs, sBody]),
    rightHead: compose([sNeck, sHead, sBeak], [sEye]),
    up: compose([bHead, bLegs, bBody]),
  };
}

// ------------------------------------------------------------------ frog (jumper)

function frog(step: 0 | 1): Frames {
  const squash = step; // the second step crouches before a hop
  const fLegs = new Layer();
  fLegs.blob(3.5, 16 + squash * 0.5, 3, 2.5).blob(16.5, 16 + squash * 0.5, 3, 2.5);
  const fBody = new Layer().blob(10, 12 + squash, 8, 5.5 - squash * 0.5);
  fBody.rect(7, 15, 6, 2, "Y");
  saddleFront(fBody, 9 + squash);
  const fHead = new Layer().blob(10, 15 + squash, 5.5, 3.5);
  const fEyeBulbs = new Layer().blob(6.5, 11 + squash, 2.4, 2.4).blob(13.5, 11 + squash, 2.4, 2.4);
  const fFace = new Layer();
  eye(fFace, 7, 11 + squash, 0, true);
  eye(fFace, 13, 11 + squash, 0, true);
  fFace.rect(7, 16 + squash, 6, 1, "D").dots([[5, 15 + squash, "P"], [14, 15 + squash, "P"]]);
  fFace.rect(8, 17 + squash, 4, 1, "Y");
  const fFeet = new Layer().rect(5, 18, 3, 2, "B").rect(12, 18, 3, 2, "B");

  const sBack = new Layer().blob(6, 15 + squash * 0.5, 4.5, 3.5);
  const sBody = new Layer().blob(10, 12 + squash, 7, 5 - squash * 0.5);
  sBody.rect(10, 15, 6, 2, "Y");
  saddleSide(sBody, 6, 7 + squash, 6);
  const sFront = new Layer().line(15, 15, 16, 19, "B", 2).rect(16, 18, 3, 2, "B");
  const sHead = new Layer().blob(15, 10 + squash, 4, 3.4);
  const sBulb = new Layer().blob(15, 7 + squash, 2.3, 2.3);
  const sFace = new Layer();
  eye(sFace, 15, 7 + squash, 1, true);
  sFace.rect(14, 12 + squash, 5, 1, "D").dots([[17, 11 + squash, "P"]]);

  const bLegs = new Layer().blob(3.5, 16, 3, 2.5).blob(16.5, 16, 3, 2.5);
  const bBody = new Layer().blob(10, 12 + squash, 8, 5.5 - squash * 0.5);
  bBody.dots([[6, 13, "D"], [12, 15, "D"], [14, 12, "D"], [9, 16, "D"]]);
  saddleBack(bBody, 9 + squash);
  const bBulbs = new Layer().blob(6.5, 7 + squash, 2.2, 2.2).blob(13.5, 7 + squash, 2.2, 2.2);
  return {
    downBody: compose([fLegs, fBody]),
    downHead: compose([fHead, fEyeBulbs, fFeet], [fFace]),
    rightBody: compose([sBack, sBody]),
    rightHead: compose([sFront, sHead, sBulb], [sFace]),
    up: compose([bBulbs, bLegs, bBody]),
  };
}

// ------------------------------------------------------------------ armadillo (pusher)

function armadillo(step: 0 | 1): Frames {
  const bands = (l: Layer, x0: number, x1: number, ys: number[]) => ys.forEach((y) => l.rect(x0, y, x1 - x0, 1, "D"));
  const feet = (xs: number[]) => {
    const l = new Layer();
    xs.forEach((x, i) => l.rect(x, 18 - lifted(step, i), 2, 1 + lifted(step, i), "F"));
    return l;
  };

  const fShell = new Layer().blob(10, 11, 8, 6.5);
  bands(fShell, 3, 18, [8, 11, 14]);
  saddleFront(fShell, 9);
  const fFeet = feet([4, 14]);
  const fHead = new Layer().blob(10, 14, 3.4, 3, "H", "h", "j");
  const fSnout = new Layer().rect(9, 16, 2, 3, "H").rect(9, 18, 2, 1, "P");
  const fEars = new Layer().blob(6.5, 11.5, 1.6, 1.8, "H", "h", "j").blob(13.5, 11.5, 1.6, 1.8, "H", "h", "j");
  const fFace = new Layer();
  eye(fFace, 8, 13);
  eye(fFace, 12, 13);

  const sShell = new Layer().blob(9, 11.5, 7.5, 6);
  for (const x of [5, 8, 11]) sShell.rect(x, 6, 1, 11, "D");
  sShell.rect(1, 16, 16, 1, "D");
  saddleSide(sShell, 6, 6, 5);
  const sTail = new Layer().line(1, 15, 0, 17, "H", 2);
  const sFeet = feet([4, 12]);
  const sHead = new Layer().blob(16, 13, 2.8, 2.6, "H", "h", "j");
  const sSnout = new Layer().rect(17, 14, 3, 2, "H").rect(19, 14, 1, 1, "P");
  const sEar = new Layer().blob(15, 10, 1.4, 1.8, "H", "h", "j");
  const sFace = new Layer();
  eye(sFace, 17, 12, 1);

  const bEars = new Layer().blob(7, 6, 1.5, 1.8, "H", "h", "j").blob(13, 6, 1.5, 1.8, "H", "h", "j");
  const bShell = new Layer().blob(10, 11, 8, 6.5);
  bands(bShell, 3, 18, [7, 10, 13]);
  saddleBack(bShell, 8);
  const bTail = new Layer().rect(9, 17, 2, 3, "H");
  return {
    downBody: compose([fFeet, fShell]),
    downHead: compose([fEars, fHead, fSnout], [fFace]),
    rightBody: compose([sTail, sFeet, sShell]),
    rightHead: compose([sEar, sHead, sSnout], [sFace]),
    up: compose([bEars, bTail, bShell]),
  };
}

// ------------------------------------------------------------------ donkey (kicker)

function donkey(step: 0 | 1): Frames {
  const legs = (xs: number[], top: number) => {
    const l = new Layer();
    xs.forEach((x, i) => l.rect(x, top, 2, 18 - top - lifted(step, i), "B").rect(x, 18 - lifted(step, i), 2, 2 - lifted(step, i), "F"));
    return l;
  };

  const fLegs = legs([5, 13], 14);
  const fBody = new Layer().blob(10, 11, 7, 5.5);
  saddleFront(fBody, 9);
  const fEars = new Layer().line(6, 11, 4, 6, "B", 2).line(14, 11, 16, 6, "B", 2);
  const fHead = new Layer().blob(10, 13, 3.6, 3.6);
  const fMuzzle = new Layer().blob(10, 16.5, 3, 2.2, "M", "M", "m");
  const fFace = new Layer();
  eye(fFace, 8, 12);
  eye(fFace, 12, 12);
  fFace.dots([[9, 17, "m"], [11, 17, "m"], [4, 7, "P"], [16, 7, "P"], [9, 9, "N"], [10, 9, "N"], [11, 9, "N"]]);
  const fFrontLegs = legs([7, 11], 16);

  const sLegs = legs([4, 12], 13);
  const sBody = new Layer().blob(8.5, 11, 7, 4.6);
  sBody.rect(0, 9, 2, 1, "B").rect(0, 10, 1, 4, "N");
  saddleSide(sBody, 5, 6, 6);
  const sNeck = new Layer().line(14, 10, 16, 6, "B", 3);
  const sMane = new Layer().line(13, 8, 15, 4, "N", 1);
  const sHead = new Layer().blob(17, 6.5, 2.6, 2.4);
  const sMuzzle = new Layer().rect(17, 7, 3, 3, "M").rect(19, 9, 1, 1, "m");
  const sEars = new Layer().line(15, 4, 14, 0, "B", 2).line(17, 4, 17, 1, "B", 1);
  const sFace = new Layer();
  eye(sFace, 17, 5, 1);
  sFace.dots([[14, 1, "P"]]);

  const bEars = new Layer().line(8, 5, 6, 0, "B", 2).line(12, 5, 14, 0, "B", 2);
  const bHead = new Layer().blob(10, 5, 3, 2.6);
  const bLegs = legs([5, 13], 14);
  const bBody = new Layer().blob(10, 11, 7, 5.5);
  saddleBack(bBody, 8);
  const bTail = new Layer().rect(10, 15, 1, 3, "N");
  return {
    downBody: compose([fLegs, fBody]),
    downHead: compose([fEars, fHead, fMuzzle, fFrontLegs], [fFace]),
    rightBody: compose([sLegs, sBody]),
    rightHead: compose([sEars, sNeck, sHead, sMuzzle], [sMane, sFace]),
    up: compose([bEars, bHead, bLegs, bBody], [bTail]),
  };
}

// ------------------------------------------------------------------ sheet

const BUILDERS: Record<PetKind, (step: 0 | 1) => Frames> = { runner: rhea, jumper: frog, pusher: armadillo, kicker: donkey };

const NATURAL: Record<PetKind, Record<string, string>> = {
  runner: { B: "#9a8a76", L: "#c5b8a3", D: "#6e6150", O: "#f0a23a", o: "#b8701e" },
  jumper: { B: "#5cbf4c", L: "#9be27c", D: "#3a8a33", Y: "#f3e7a2" },
  pusher: { B: "#a7906e", L: "#cdb894", D: "#7a6448", H: "#e3b9a0", h: "#f3d3bf", j: "#bf9178", F: "#6b5440" },
  kicker: { B: "#9b98a8", L: "#c6c3d1", D: "#6f6c7c", M: "#ece4d6", m: "#b7ad9c", N: "#4b4757", F: "#3d3a46" },
};

function palette(kind: PetKind): Record<string, RGBA> {
  const saddle = hex(PET_INFO[kind].color);
  const base: Record<string, RGBA> = {
    K: hex("#1b1726"),
    W: hex("#ffffff"),
    E: hex("#1f1d3a"),
    P: hex("#ff8fa6"),
    S: saddle,
    s: shade(saddle, 0.7),
  };
  for (const [k, v] of Object.entries(NATURAL[kind])) base[k] = hex(v);
  return base;
}

function toImg(layer: Layer, pal: Record<string, RGBA>): Img {
  const img = new Img(PET_CELL, PET_CELL);
  layer.px.forEach((k, i) => {
    if (!k) return;
    const c = pal[k];
    if (!c) throw new Error(`no colour for '${k}'`);
    img.set(i % PET_CELL, Math.floor(i / PET_CELL), c);
  });
  return img;
}

/** One row per PET_KINDS, each wearing a saddle in its item colour. */
export function petSheet(): Img {
  const sheet = new Img(PET_CELL * PET_COLUMNS, PET_CELL * PET_KINDS.length);
  PET_KINDS.forEach((kind, row) => {
    const pal = palette(kind);
    const put = (layer: Layer, col: number) => sheet.blit(toImg(layer, pal), col * PET_CELL, row * PET_CELL);
    ([0, 1] as const).forEach((step) => {
      const f = BUILDERS[kind](step);
      put(f.downBody, petColumn("down", "body", step));
      put(f.downHead, petColumn("down", "head", step));
      put(f.rightBody, petColumn("right", "body", step));
      put(f.rightHead, petColumn("right", "head", step));
      put(f.up, petColumn("up", "body", step));
      if (step === 0) {
        put(f.downBody, PET_ICON_COLUMN);
        put(f.downHead, PET_ICON_COLUMN);
      }
    });
  });
  return sheet;
}
