import type { Input } from "@bomberman/engine";

export interface KeyBindings {
  up: string;
  down: string;
  left: string;
  right: string;
  bomb: string;
  /** throw / lift / punch / detonate */
  action: string;
}

export const PLAYER_KEYS: KeyBindings[] = [
  { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", bomb: "Space", action: "ShiftLeft" },
  { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", bomb: "Enter", action: "ShiftRight" },
];

type DirKey = "up" | "down" | "left" | "right";

/** Tracks held keys; the most recently pressed direction wins, like on a real d-pad. */
export class Keyboard {
  private stacks: DirKey[][];
  private bombQueued: boolean[];
  private actionQueued: boolean[];
  private lookup = new Map<string, { player: number; action: DirKey | "bomb" | "action" }>();

  constructor(private bindings: KeyBindings[]) {
    this.stacks = bindings.map(() => []);
    this.bombQueued = bindings.map(() => false);
    this.actionQueued = bindings.map(() => false);
    bindings.forEach((b, player) => {
      for (const action of ["up", "down", "left", "right", "bomb", "action"] as const) {
        this.lookup.set(b[action], { player, action });
      }
    });
  }

  attach(): () => void {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
    window.addEventListener("blur", this.reset);
    return () => {
      window.removeEventListener("keydown", this.onDown);
      window.removeEventListener("keyup", this.onUp);
      window.removeEventListener("blur", this.reset);
    };
  }

  private reset = () => {
    this.stacks = this.bindings.map(() => []);
  };

  private onDown = (e: KeyboardEvent) => {
    const hit = this.lookup.get(e.code);
    if (!hit) return;
    e.preventDefault();
    if (e.repeat) return;
    if (hit.action === "bomb") this.bombQueued[hit.player] = true;
    else if (hit.action === "action") this.actionQueued[hit.player] = true;
    else this.stacks[hit.player].push(hit.action);
  };

  private onUp = (e: KeyboardEvent) => {
    const hit = this.lookup.get(e.code);
    if (!hit || hit.action === "bomb" || hit.action === "action") return;
    this.stacks[hit.player] = this.stacks[hit.player].filter((d) => d !== hit.action);
  };

  /** Read the input for one simulation tick (consumes the queued bomb press). */
  poll(player: number): Input {
    const dir = this.stacks[player].at(-1);
    const bomb = this.bombQueued[player];
    const action = this.actionQueued[player];
    this.bombQueued[player] = false;
    this.actionQueued[player] = false;
    return {
      dx: dir === "left" ? -1 : dir === "right" ? 1 : 0,
      dy: dir === "up" ? -1 : dir === "down" ? 1 : 0,
      bomb,
      action,
    };
  }
}
