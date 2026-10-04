import { audio } from "./audio";
import type { PetKind } from "@bomberman/engine";
import { isMine, type GameEvent } from "./events";

/** The kicker power has no sound of its own: the bomb it kicks already makes one. */
const PET_SOUND: Record<PetKind, "dash" | "jump" | "push" | null> = { runner: "dash", jumper: "jump", pusher: "push", kicker: null };

/**
 * Plays the sounds for a batch of game events.
 * `me` limits pick-up and win/lose sounds to one player (online); omit it for local play.
 */
export function playSounds(events: GameEvent[], me?: string) {
  let died = false;
  for (const e of events) {
    switch (e.type) {
      case "bombPlaced":
        audio.sfx("place");
        break;
      case "explosion":
        audio.sfx("explosion");
        break;
      case "death":
        if (!died) audio.sfx("death"); // simultaneous deaths share one sound
        died = true;
        break;
      case "pickup":
        if (isMine(e.id, me)) audio.sfx("powerup");
        break;
      case "kick":
        audio.sfx("kick");
        break;
      case "land":
        audio.sfx("land");
        break;
      case "lift":
        audio.sfx("lift");
        break;
      case "throw":
        audio.sfx("throw");
        break;
      case "shield":
        audio.sfx("shield");
        break;
      case "mount":
        audio.sfx("mount");
        break;
      case "petLost":
        audio.sfx("petLost");
        break;
      case "petPower": {
        const sound = PET_SOUND[e.pet];
        if (sound) audio.sfx(sound);
        break;
      }
      case "haunt":
        audio.sfx("haunt", 0.5);
        break;
      case "hurry":
        audio.sfx("hurry");
        break;
      case "go":
        audio.sfx("go");
        break;
      case "blockFall":
        audio.sfx("thud");
        break;
      case "petLand":
        audio.sfx("land");
        break;
      case "stun":
        audio.sfx("bonk");
        break;
      case "infected":
        if (isMine(e.id, me)) audio.sfx("skull");
        break;
      case "finish":
        // let the last blast and death ring out before the jingle
        audio.sfx(e.winner === null ? "draw" : isMine(e.winner, me) ? "win" : "lose", 1.1);
        break;
    }
  }
}
