import { useCallback, useEffect, useRef, useState } from "react";
import { PROTOCOL_VERSION, type ClientMsg, type ErrorCode, type RoomView, type ServerMsg } from "@bomberman/engine";
import { playerId, serverUrl } from "../config";
import { SnapshotBuffer, percentile } from "../game/snapshots";

export interface RoomError {
  code: ErrorCode | "closed";
  message: string;
}

export type ConnStatus = "connecting" | "open" | "reconnecting";

const MAX_RECONNECTS = 8;

const sendOn = (ws: WebSocket | null, msg: ClientMsg) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};
/** how often to measure the round trip to the server, in ms */
const PING_EVERY_MS = 2000;
/** the shown ping is the median of this many recent round trips, so one slow packet doesn't flash red */
const PING_SAMPLES = 5;

export function useRoom(opts: { code: string; name: string; create: boolean; capacity: number; onFatal: (e: RoomError) => void }) {
  const { code, name, create, capacity, onFatal } = opts;
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [room, setRoom] = useState<RoomView | null>(null);
  /** round trip to the server in ms; null until measured (or with a server that doesn't answer pings) */
  const [ping, setPing] = useState<number | null>(null);
  const buffer = useRef(new SnapshotBuffer()).current;
  const wsRef = useRef<WebSocket | null>(null);
  const fatalRef = useRef(onFatal);
  fatalRef.current = onFatal;
  const me = useRef(playerId()).current;

  useEffect(() => {
    let disposed = false;
    let joined = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const trips: number[] = [];
    buffer.clear();
    // nobody looks at the ping of a tab in the background
    const sendPing = () => document.hidden || sendOn(wsRef.current, { t: "ping", at: performance.now() });
    const pinger = setInterval(sendPing, PING_EVERY_MS);

    const fail = (error: RoomError) => {
      if (disposed) return;
      disposed = true;
      fatalRef.current(error);
    };

    const connect = () => {
      const params = new URLSearchParams({ pid: me, name, v: String(PROTOCOL_VERSION) });
      if (create && !joined) {
        params.set("create", "1");
        params.set("max", String(capacity));
      }
      const ws = new WebSocket(`${serverUrl()}/ws/${code}?${params}`);
      wsRef.current = ws;
      let rejected: RoomError | null = null;
      let opened = false;

      ws.onopen = () => {
        opened = true;
        attempt = 0;
        sendPing(); // the first measure right away, not in a couple of seconds
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as ServerMsg;
        if (msg.t === "welcome") {
          joined = true;
          setStatus("open");
        } else if (msg.t === "room") setRoom(msg.room);
        else if (msg.t === "state") buffer.push(msg.round, msg.resultsIn, msg.game, performance.now(), msg.acks);
        else if (msg.t === "pong") {
          trips.push(performance.now() - msg.at);
          if (trips.length > PING_SAMPLES) trips.shift();
          setPing(Math.round(percentile(trips, 0.5)));
        }
        else if (msg.t === "error") {
          // hang up ourselves rather than wait for the server to (it logs an error when it closes first)
          rejected = { code: msg.code, message: msg.message };
          ws.close();
        }
      };
      ws.onclose = (e) => {
        if (disposed || wsRef.current !== ws) return;
        if (rejected) return fail(rejected);
        if (!opened && !joined) {
          // never reached the server at all: say so instead of spinning forever
          return fail({
            code: "closed",
            message: `Não foi possível conectar ao servidor (${serverUrl()}). Ele está rodando? Use "bun run dev:server".`,
          });
        }
        if (++attempt > MAX_RECONNECTS) return fail({ code: "closed", message: "Conexão perdida com o servidor." });
        setStatus("reconnecting");
        timer = setTimeout(connect, Math.min(400 * 2 ** (attempt - 1), 3000));
      };
    };
    connect();

    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(pinger);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [code, name, create, capacity, me, buffer]);

  const send = useCallback((msg: ClientMsg) => sendOn(wsRef.current, msg), []);

  return { status, room, me, buffer, send, ping };
}
