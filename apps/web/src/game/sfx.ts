import { audio } from "./audio";
import type { GameEvent } from "./events";

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
        if (me === undefined || e.id === me) audio.sfx("powerup");
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
      case "infected":
        if (me === undefined || e.id === me) audio.sfx("skull");
        break;
      case "finish":
        audio.stopMusic();
        // let the last blast and death ring out before the jingle
        audio.sfx(e.winner === null ? "draw" : me === undefined || e.winner === me ? "win" : "lose", 1.1);
        break;
    }
  }
}
