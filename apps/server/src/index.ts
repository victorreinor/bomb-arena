import { TokenBucket, isValidRoomCode } from "@bomb-arena/engine";
import type { Env } from "./room";

export { Room } from "./room";

/**
 * Connection attempts per IP (reconnects included). Only per Worker instance, so it blunts a
 * single flooding client rather than enforcing a global quota.
 */
const connectLimits = new Map<string, TokenBucket>();
const CONNECTS_PER_SECOND = 1;
const CONNECT_BURST = 40;

function allowConnect(ip: string): boolean {
  if (connectLimits.size > 10_000) connectLimits.clear();
  let bucket = connectLimits.get(ip);
  if (!bucket) {
    bucket = new TokenBucket(CONNECTS_PER_SECOND, CONNECT_BURST, Date.now());
    connectLimits.set(ip, bucket);
  }
  return bucket.take(Date.now());
}

/** WebSocket endpoint: /ws/<CODE>?pid=<id>&name=<name>&create=1 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/ws\/([A-Za-z]+)$/);
    if (!match) return new Response("Bomb Arena server", { status: 200 });
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket connection", { status: 426 });
    }
    if (!allowConnect(request.headers.get("CF-Connecting-IP") ?? "local")) {
      return new Response("Too many connections, slow down", { status: 429 });
    }
    const code = match[1].toUpperCase();
    if (!isValidRoomCode(code)) return new Response("Invalid room code", { status: 400 });
    // one Durable Object per room code
    return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
  },
};
