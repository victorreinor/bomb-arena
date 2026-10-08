import { isMine, type GameEvent } from "./events";
import { settings } from "./settings";

/** Short buzzes, in ms (on, off, on...). Phones that can't vibrate (and desktops) just ignore them. */
const PATTERNS = {
  tap: 8,
  place: 14,
  pickup: [10, 30, 16],
  stun: [30, 40, 30],
  death: [70, 50, 110],
  hurrySoon: [60, 90, 60],
  hurry: [150, 80, 150],
} satisfies Record<string, number | number[]>;
export type Buzz = keyof typeof PATTERNS;

export const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

export function buzz(kind: Buzz) {
  if (canVibrate && settings.haptics) navigator.vibrate(PATTERNS[kind]);
}

/**
 * Buzzes for what happens to us (see isMine): our own bombs, items, a bomb on the head, being blown up; and for
 * sudden death on its way and starting, which is everyone's business.
 */
export function feel(events: GameEvent[], me?: string) {
  for (const e of events) {
    if (e.type === "pose" && e.pose === "place" && isMine(e.id, me)) buzz("place");
    else if ((e.type === "pickup" || e.type === "stun" || e.type === "death") && isMine(e.id, me)) buzz(e.type);
    else if (e.type === "hurrySoon" || e.type === "hurry") buzz(e.type);
  }
}
