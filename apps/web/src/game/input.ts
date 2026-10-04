import { BUTTONS, DIR_VEC, type Button, type Dir, type Input } from "@bomb-arena/engine";

const DIRS: Dir[] = ["up", "down", "left", "right"];
const isButton = (key: Dir | Button): key is Button => (BUTTONS as readonly string[]).includes(key);

export interface KeyBindings {
  up: string;
  down: string;
  left: string;
  right: string;
  bomb: string;
  /** throw / lift / punch / detonate */
  action: string;
  /** the mount's power */
  pet: string;
}

export const PLAYER_KEYS: KeyBindings[] = [
  { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", bomb: "Space", action: "ShiftLeft", pet: "KeyE" },
  { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", bomb: "Enter", action: "ShiftRight", pet: "Slash" },
];

const noPresses = (): Record<Button, boolean> => ({ bomb: false, action: false, pet: false });

/** Tracks held keys; the most recently pressed direction wins, like on a real d-pad. Buttons are one-shot. */
export class Keyboard {
  private stacks: Dir[][];
  private queued: Record<Button, boolean>[];
  private lookup = new Map<string, { player: number; key: Dir | Button }>();

  constructor(private bindings: KeyBindings[]) {
    this.stacks = bindings.map(() => []);
    this.queued = bindings.map(noPresses);
    bindings.forEach((b, player) => {
      for (const key of [...DIRS, ...BUTTONS]) this.lookup.set(b[key], { player, key });
    });
  }

  attach(): () => void {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
    window.addEventListener("blur", this.release);
    return () => {
      window.removeEventListener("keydown", this.onDown);
      window.removeEventListener("keyup", this.onUp);
      window.removeEventListener("blur", this.release);
    };
  }

  /** Lets go of every held key (focus lost: their key-ups would never arrive). */
  release = () => {
    this.stacks = this.bindings.map(() => []);
  };

  private onDown = (e: KeyboardEvent) => {
    const hit = this.lookup.get(e.code);
    if (!hit) return;
    e.preventDefault();
    if (e.repeat) return;
    if (isButton(hit.key)) this.queued[hit.player][hit.key] = true;
    else this.stacks[hit.player].push(hit.key);
  };

  private onUp = (e: KeyboardEvent) => {
    const hit = this.lookup.get(e.code);
    if (!hit || isButton(hit.key)) return;
    this.stacks[hit.player] = this.stacks[hit.player].filter((d) => d !== hit.key);
  };

  /** Read the input for one simulation tick (consumes the queued button presses). */
  poll(player: number): Input {
    const dir = this.stacks[player].at(-1);
    const presses = this.queued[player];
    this.queued[player] = noPresses();
    return { ...(dir ? { dx: DIR_VEC[dir].dx, dy: DIR_VEC[dir].dy } : { dx: 0, dy: 0 }), ...presses };
  }
}
