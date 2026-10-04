import { isValidRoomCode } from "@bomberman/engine";
import type { Env } from "./room";

export { Room } from "./room";

/** WebSocket endpoint: /ws/<CODE>?pid=<id>&name=<name>&create=1 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/ws\/([A-Za-z]+)$/);
    if (!match) return new Response("Bomb Arena server", { status: 200 });
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket connection", { status: 426 });
    }
    const code = match[1].toUpperCase();
    if (!isValidRoomCode(code)) return new Response("Invalid room code", { status: 400 });
    // one Durable Object per room code
    return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
  },
};
