/**
 * The bomber, drawn from parts: a head per view, a torso, legs and arms per pose.
 * Each part is an ASCII stamp carrying its own outline, laid down back to front, so a part in front
 * (an arm over the torso, a glove over the helmet) gets a clean edge where it overlaps.
 *
 * Sheet layout (cell size, views, frame and emote order) comes from the client's sprites.ts, which reads it.
 */
import {
  BOMBER_EMOTES as EMOTES,
  BOMBER_FRAMES as FRAMES,
  BOMBER_H as CELL_H,
  BOMBER_VIEWS as VIEWS,
  BOMBER_W as CELL_W,
  type BomberFrame as Frame,
} from "../apps/web/src/game/sprites";
import { Img, fromAscii, hex, lighten, shade, type RGBA } from "./png";

type Emote = (typeof EMOTES)[number];
type View = (typeof VIEWS)[number];
type Face = "normal" | "dizzy" | "ouch" | "happy" | "sadA" | "sadB";
type Legs = "stand" | "stepA" | "stepB" | "kick" | "crouch" | "sit";
type Arms = "down" | "swingA" | "swingB" | "punch" | "throw" | "up" | "reach" | "hold" | "cheer" | "droop";

// ------------------------------------------------------------------ palette

function palette(color: string): Record<string, RGBA> {
  const c = hex(color);
  return {
    K: hex("#1b1726"),
    C: c,
    H: lighten(c, 0.45),
    D: shade(c, 0.7),
    S: hex("#ffdcbf"),
    E: hex("#1f1d3a"),
    W: hex("#ffffff"),
    g: hex("#c4cae2"),
    P: hex("#ff9db0"),
    R: hex("#ff4d6d"),
    r: hex("#ffb8c6"),
    N: hex("#2f43a0"),
    n: hex("#1f2c6b"),
    F: hex("#8f4c2a"),
    f: hex("#5c2f19"),
    Y: hex("#ffd23a"),
    y: hex("#2b2533"),
    M: hex("#a8323e"),
    T: hex("#7ad0ff"),
  };
}

// ------------------------------------------------------------------ stamps

type Stamp = string[];

/** Lay a stamp down at (x, y); `.` is transparent. */
const put = (img: Img, pal: Record<string, RGBA>, rows: Stamp, x: number, y: number) => img.blit(fromAscii(rows, pal), x, y);

const flip = (rows: Stamp): Stamp => rows.map((r) => [...r].reverse().join(""));

// ------------------------------------------------------------------ head (rows 0-13)

/** Faces are 8x4 stamps laid over the visor (x 4-11, y 8-11). */
const FACES: Record<Face, Stamp> = {
  normal: ["SSSSSSSS", "SWESSWES", "SEESSEES", "SPSSSSPS"],
  dizzy: ["SSSSSSSS", "SEWSSEWS", "SWESSWES", "SSSMMSSS"],
  ouch: ["SWWSSWWS", "SWESSWES", "SSSMMSSS", "SSSMMSSS"],
  happy: ["SSSSSSSS", "SESSSSES", "ESESSESE", "SPSMMSPS"],
  sadA: ["SSSSSSSS", "SEESSEES", "STSSSSTS", "SSSMMSSS"],
  sadB: ["SSSSSSSS", "SEESSEES", "SSSSSSSS", "STSMMSTS"],
};
/** Side faces: 6x4, the eye near the front. */
const SIDE_FACES: Record<Face, Stamp> = {
  normal: ["SSSSSS", "SSSWES", "SSSEES", "SSSSPS"],
  dizzy: ["SSSSSS", "SSSEWS", "SSSWES", "SSSSMS"],
  ouch: ["SSSWWS", "SSSWES", "SSSSMS", "SSSSMS"],
  happy: ["SSSSSS", "SSSSES", "SSSESE", "SSSSMS"],
  sadA: ["SSSSSS", "SSSEES", "SSSSTS", "SSSSMS"],
  sadB: ["SSSSSS", "SSSEES", "SSSSSS", "SSSSTS"],
};

/** Where the face goes: the front one in the visor (down view), the side one at the front (right view). */
const FACE_AT = { x: 4, y: 8 };
const SIDE_FACE_AT = { x: 8, y: 8 };

/** A round helmet in the player's colour with the antenna ball, the face in a visor. */
const HEAD: Record<View, Stamp> = {
  down: [
    "......KRRK......",
    "......KrRK......",
    ".......KK.......",
    ".....KKCCKK.....",
    "...KKCHHCCCKK...",
    "..KCHHCCCCCCDK..",
    ".KCHCCCCCCCCCDK.",
    ".KCCKKKKKKKKCDK.",
    ".KCKSSSSSSSSKDK.",
    ".KCKSSSSSSSSKDK.",
    ".KCKSSSSSSSSKDK.",
    ".KCKSSSSSSSSKDK.",
    "..KDKKKKKKKKDK..",
    "...KKDDDDDDKK...",
  ],
  up: [
    "......KRRK......",
    "......KrRK......",
    ".......KK.......",
    ".....KKCCKK.....",
    "...KKCCCCCCKK...",
    "..KCCHCCCCCCDK..",
    ".KCCHCCCCCCCCDK.",
    ".KCHCCCCCCCCCDK.",
    ".KCCCCCCCCCCCDK.",
    ".KCCCCCCCCCCCDK.",
    ".KCCCCCCCCCCDDK.",
    ".KDCCCCCCCCCDDK.",
    "..KDDCCCCCCDDK..",
    "...KKDDDDDDKK...",
  ],
  right: [
    ".......KRRK.....",
    ".......KrRK.....",
    "........KK......",
    ".....KKKCCKK....",
    "...KKCHHCCCCKK..",
    "..KCHHCCCCCCCCK.",
    ".KCHCCCCCCCCCCK.",
    ".KCCCCCCKKKKKKK.",
    ".KCCCCCKSSSSSSK.",
    ".KCHCCCKSSSSSSK.",
    ".KCCCCCKSSSSSSK.",
    ".KDCCCCKSSSSSSK.",
    "..KDCCCKKKKKKK..",
    "...KKDDDDDDKK...",
  ],
};

// ------------------------------------------------------------------ torso (rows 14-18)

const TORSO: Record<View, Stamp> = {
  down: [
    "....KKKKKKKK....",
    "...KCHCWWCCDK...",
    "...KCCCWgCCDK...",
    "...KyyyYYyyyK...",
    "...KNNNNNNNnK...",
  ],
  up: [
    "....KKKKKKKK....",
    "...KCCCCCCDDK...",
    "...KCCCCCCDDK...",
    "...KyyyyyyyyK...",
    "...KNNNNNNNnK...",
  ],
  right: [
    ".....KKKKKKK....",
    "....KCCHHCCWK...",
    "....KCCHCCCgK...",
    "....KyyyyyYYK...",
    "....KNNNNNNnK...",
  ],
};

// ------------------------------------------------------------------ legs (bottom rows, anchored at y 19)

const FRONT_STEP = [
  "....KNNKKNNK....",
  "....KNnKKFFFK...",
  "...KFFFKKFFfK...",
  "...KFFfKKKKKK...",
  "...KKKKK........",
];
const FRONT_LEGS: Record<Legs, Stamp> = {
  stand: [
    "....KNNKKNNK....",
    "....KNnKKNnK....",
    "...KFFFKKFFFK...",
    "...KFFfKKFFfK...",
    "...KKKKKKKKKK...",
  ],
  stepA: FRONT_STEP,
  stepB: flip(FRONT_STEP),
  kick: [
    "....KNNKKFFFK...",
    "....KNnKKFFfK...",
    "...KFFFKKKKKK...",
    "...KFFfK........",
    "...KKKKK........",
  ],
  crouch: [
    "................",
    "................",
    "..KNNNK..KNNNK..",
    "..KFFFFKKFFFFK..",
    "..KKKKKKKKKKKK..",
  ],
  sit: [
    "..KKNNKKKKNNKK..",
    ".KNNNK....KNNNK.",
    ".KFFFK....KFFFK.",
    ".KKKKK....KKKKK.",
    "................",
  ],
};

const SIDE_LEGS: Record<Legs, Stamp> = {
  stand: [
    ".....KNNNnK.....",
    ".....KNNNnK.....",
    "....KFFFFFFK....",
    "....KFFFFFfFK...",
    "....KKKKKKKKK...",
  ],
  stepA: [
    "....KnNKNNK.....",
    "...KnnK.KNNK....",
    "..KffFK..KFFFK..",
    "..KfffFK.KFFFfK.",
    "..KKKKKK.KKKKKK.",
  ],
  stepB: [
    "....KNNKnnK.....",
    "...KNNK.KnnK....",
    "..KFFFK..KffFK..",
    "..KFFFfK.KfffFK.",
    "..KKKKKK.KKKKKK.",
  ],
  kick: [
    "....KNNNNNNKFFK.",
    ".....KNNKKKKFFfK",
    ".....KnnK..KKKK.",
    "....KffffK......",
    "....KKKKKK......",
  ],
  crouch: [
    "................",
    "................",
    "....KNNNNNNK....",
    "...KFFFKFFFFK...",
    "...KKKKKKKKKK...",
  ],
  sit: [
    "....KNNNNNNK....",
    "....KNNNNNNNK...",
    ".........KNNK...",
    "........KFFFFK..",
    "........KKKKKK..",
  ],
};

// ------------------------------------------------------------------ arms (stamps with their own anchor)

interface ArmStamp {
  rows: Stamp;
  x: number;
  y: number;
  /** drawn over the head (hands raised in front of it) rather than under it */
  overHead?: boolean;
}

const FRONT_SWING = [".KCCK......KCDK.", ".KCCK......KWgK.", ".KCCK......KWgK.", ".KWWK.......KK..", ".KWgK...........", "..KK............"];
const FRONT_ARMS: Record<Arms, ArmStamp> = {
  down: {
    x: 0,
    y: 15,
    rows: [".KCCK......KCDK.", ".KCCK......KCDK.", ".KWWK......KWgK.", ".KWgK......KWgK.", "..KK........KK.."],
  },
  swingA: { x: 0, y: 15, rows: FRONT_SWING },
  swingB: { x: 0, y: 15, rows: flip(FRONT_SWING) },
  punch: {
    x: 0,
    y: 14,
    rows: ["..........KKKK..", ".KCCK....KWWWWK.", ".KCCK....KWWWgK.", ".KWWK....KgggK..", ".KWgK.....KKK...", "..KK............"],
  },
  throw: {
    x: 0,
    y: 13,
    rows: ["..KKK......KKK..", ".KWWWK....KWWWK.", ".KWgWK....KWgWK.", "..KCCK....KCDK..", "...KK......KK..."],
  },
  up: {
    x: 0,
    y: 1,
    overHead: true,
    rows: [".KK..........KK.", "KWWK........KWWK", "KWgK........KWgK", ".KCK........KDK.", ".KCK........KDK."],
  },
  reach: {
    x: 0,
    y: 17,
    rows: ["..KCK......KDK..", "..KWWK....KWWK..", "..KWgK....KWgK..", "...KK......KK..."],
  },
  hold: {
    x: 0,
    y: 16,
    rows: ["..KCK......KDK..", "..KCCK....KCDK..", "...KWWK..KWWK...", "...KWgK..KWgK...", "....KK....KK...."],
  },
  cheer: {
    x: 0,
    y: 4,
    overHead: true,
    rows: ["KK............KK", "WWK..........KWW", "WgK..........KWg", "KCK..........KDK", "KCK..........KDK", "KCK..........KDK", ".KCK........KDK.", ".KCK........KDK.", "..KCK......KDK..", "..KCK......KDK.."],
  },
  droop: {
    x: 0,
    y: 15,
    rows: ["..KCK......KDK..", "..KCK......KDK..", "..KCK......KDK..", "..KWWK....KWgK..", "..KWgK....KWgK..", "...KK......KK..."],
  },
};

/** From behind, a punch disappears in front of the body and a throw starts with the hands beside the head. */
const BACK_ARMS: Record<Arms, ArmStamp> = {
  ...FRONT_ARMS,
  punch: { x: 0, y: 15, rows: [".KCCK......KK...", ".KCCK......KDK..", ".KWWK...........", ".KWgK...........", "..KK............"] },
  throw: { ...FRONT_ARMS.up, y: 5 },
};

const SIDE_ARMS: Record<Arms, ArmStamp> = {
  down: { x: 5, y: 15, rows: [".KCCK.", ".KCDK.", ".KWWK.", ".KWgK.", "..KK.."] },
  swingA: { x: 6, y: 15, rows: ["KCCK..", ".KCDK.", "..KWWK", "..KWgK", "...KK."] },
  swingB: { x: 2, y: 15, rows: ["..KCCK", ".KCDK.", "KWWK..", "KWgK..", ".KK..."] },
  punch: { x: 6, y: 14, rows: ["......KKK.", "KKKKKKWWWK", "KCCCCKWWgK", ".KKKKKgggK", "......KKK."] },
  throw: { x: 7, y: 11, rows: ["....KKK.", "...KWWWK", "..KCWWgK", ".KCDKKK.", "KCDK....", "KDK....."] },
  up: { x: 6, y: 0, overHead: true, rows: [".KKK.", "KWWWK", "KWWgK", ".KDK."] },
  reach: { x: 8, y: 18, rows: ["KCK...", ".KCK..", ".KWWK.", ".KWgK.", "..KK.."] },
  hold: { x: 7, y: 16, rows: ["KCCK...", ".KCDKK.", "..KWWWK", "..KWggK", "...KKK."] },
  // raised behind the head: only the glove shows above it
  cheer: { x: 3, y: 1, rows: [".KKK.", "KWWWK", "KWWgK", ".KCK.", ".KCK.", ".KCK."] },
  droop: { x: 5, y: 16, rows: [".KCK.", ".KCDK", ".KWWK", ".KWgK", "..KK."] },
};

// ------------------------------------------------------------------ poses

interface Pose {
  legs: Legs;
  arms: Arms;
  /** "normal" unless given */
  face?: Face;
  /** upper body (head, torso, arms) dropped this many pixels: crouching, sitting */
  drop?: number;
  /** the whole bomber off the ground this many pixels: a hop on the podium */
  lift?: number;
}

const POSES: Record<Frame, Pose> = {
  idle: { legs: "stand", arms: "down" },
  walkA: { legs: "stepA", arms: "swingA" },
  walkB: { legs: "stepB", arms: "swingB" },
  kick: { legs: "kick", arms: "swingB" },
  punch: { legs: "stand", arms: "punch" },
  throw: { legs: "stepA", arms: "throw" },
  carry: { legs: "stand", arms: "up" },
  carryWalkA: { legs: "stepA", arms: "up" },
  carryWalkB: { legs: "stepB", arms: "up" },
  place: { legs: "crouch", arms: "reach", drop: 2 },
  ride: { legs: "sit", arms: "hold", drop: 1 },
  dizzy: { legs: "stand", arms: "droop", face: "dizzy" },
  ouch: { legs: "stand", arms: "cheer", face: "ouch" },
};

const EMOTE_POSES: Record<Emote, Pose> = {
  happyA: { legs: "stand", arms: "cheer", face: "happy" },
  happyB: { legs: "stepA", arms: "cheer", face: "happy", lift: 1 },
  sadA: { legs: "stand", arms: "droop", face: "sadA" },
  sadB: { legs: "stand", arms: "droop", face: "sadB" },
};

function drawPose(view: View, pose: Pose, pal: Record<string, RGBA>): Img {
  const img = new Img(CELL_W, CELL_H);
  const { face = "normal", drop = 0, lift = 0 } = pose;
  const d = drop - lift;
  const legs = view === "right" ? SIDE_LEGS[pose.legs] : FRONT_LEGS[pose.legs];
  const arms = (view === "right" ? SIDE_ARMS : view === "up" ? BACK_ARMS : FRONT_ARMS)[pose.arms];

  put(img, pal, legs, 0, 19 - lift);
  put(img, pal, TORSO[view], 0, 14 + d);
  if (!arms.overHead) put(img, pal, arms.rows, arms.x, arms.y + d);
  put(img, pal, HEAD[view], 0, d);
  if (view === "down") put(img, pal, FACES[face], FACE_AT.x, FACE_AT.y + d);
  if (view === "right") put(img, pal, SIDE_FACES[face], SIDE_FACE_AT.x, SIDE_FACE_AT.y + d);
  if (arms.overHead) put(img, pal, arms.rows, arms.x, arms.y + d);
  return img;
}

/** One player's sheet: rows VIEWS, columns FRAMES. */
export function bomberSheet(color: string): Img {
  const pal = palette(color);
  const sheet = new Img(CELL_W * FRAMES.length, CELL_H * VIEWS.length);
  VIEWS.forEach((view, row) => FRAMES.forEach((frame, col) => sheet.blit(drawPose(view, POSES[frame], pal), col * CELL_W, row * CELL_H)));
  return sheet;
}

/** Podium poses, front view: happy, happy (hop), sad, sad (tears falling). */
export function emoteSheet(color: string): Img {
  const pal = palette(color);
  const sheet = new Img(CELL_W * EMOTES.length, CELL_H);
  EMOTES.forEach((emote, col) => sheet.blit(drawPose("down", EMOTE_POSES[emote], pal), col * CELL_W, 0));
  return sheet;
}
