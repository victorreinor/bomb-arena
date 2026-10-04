import { useState } from "react";
import { BUTTONS, emptyInput, type Button, type Input } from "@bomberman/engine";

/** Several sources for one bomber: the first that steers wins, any button press counts. */
export function combineInputs(...sources: (Input | null)[]): Input {
  const out = emptyInput();
  for (const s of sources) {
    if (!s) continue;
    if (out.dx === 0 && out.dy === 0 && (s.dx !== 0 || s.dy !== 0)) {
      out.dx = s.dx;
      out.dy = s.dy;
    }
    for (const b of BUTTONS) out[b] ||= s[b];
  }
  return out;
}

/** A 2-D vector (stick, finger offset) as a single 4-way direction; nothing inside the dead zone. */
export function fourWay(x: number, y: number, deadZone: number): { dx: number; dy: number } {
  if (Math.hypot(x, y) <= deadZone) return { dx: 0, dy: 0 };
  return Math.abs(x) >= Math.abs(y) ? { dx: Math.sign(x), dy: 0 } : { dx: 0, dy: Math.sign(y) };
}

// Standard gamepad layout (https://w3c.github.io/gamepad/#remapping)
const BTN = { A: 0, B: 1, X: 2, Y: 3, RB: 5, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const STICK_DEAD_ZONE = 0.5;

/** Browsers announce a pad on first use; until then there is nothing to poll. Shared by every reader. */
let padSeen = false;
if (typeof window !== "undefined") window.addEventListener("gamepadconnected", () => (padSeen = true));

/**
 * Reads gamepads. Buttons are edge-triggered like the keyboard: holding the bomb button
 * drops one bomb, not one per frame.
 */
export class GamepadReader {
  private previous = new Map<number, boolean[]>();

  /** Input from the `index`-th connected pad, or null if there is none. */
  poll(index: number): Input | null {
    if (!padSeen || !navigator.getGamepads) return null;
    const pad = navigator.getGamepads().filter((p): p is Gamepad => !!p && p.connected)[index];
    if (!pad) return null;

    const down = pad.buttons.map((b) => b.pressed);
    const before = this.previous.get(pad.index) ?? [];
    this.previous.set(pad.index, down);
    const pressed = (...ids: number[]) => ids.some((i) => down[i] && !before[i]);

    const dpad = { dx: down[BTN.LEFT] ? -1 : down[BTN.RIGHT] ? 1 : 0, dy: down[BTN.UP] ? -1 : down[BTN.DOWN] ? 1 : 0 };
    const dir = dpad.dx || dpad.dy ? dpad : fourWay(pad.axes[0] ?? 0, pad.axes[1] ?? 0, STICK_DEAD_ZONE);
    return { ...dir, bomb: pressed(BTN.A), action: pressed(BTN.B, BTN.X), pet: pressed(BTN.Y, BTN.RB) };
  }
}

/** State shared between the on-screen touch controls and the game loop. */
export class TouchPad {
  dx = 0;
  dy = 0;
  private queued: Record<Button, boolean> = { bomb: false, action: false, pet: false };

  press(button: Button) {
    this.queued[button] = true;
  }

  poll(): Input {
    const out = { dx: this.dx, dy: this.dy, ...this.queued };
    this.queued = { bomb: false, action: false, pet: false };
    return out;
  }
}

/** Everything a game screen needs besides the keyboard: gamepads and the touch controls' state. */
export function useControls() {
  const [pads] = useState(() => new GamepadReader());
  const [touch] = useState(() => new TouchPad());
  return { pads, touch };
}
