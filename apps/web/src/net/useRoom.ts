import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMsg, ErrorCode, RoomView, ServerMsg } from "@bomberman/engine";
import { playerId, serverUrl } from "../config";
import { SnapshotBuffer } from "../game/snapshots";

export interface RoomError {
  code: ErrorCode | "closed";
  message: string;
}

export type ConnStatus = "connecting" | "open" | "reconnecting";

const MAX_RECONNECTS = 8;

export function useRoom(opts: { code: string; name: string; create: boolean; capacity: number; onFatal: (e: RoomError) => void }) {
  const { code, name, create, capacity, onFatal } = opts;
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [room, setRoom] = useState<RoomView | null>(null);
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
    buffer.clear();

    const fail = (error: RoomError) => {
      if (disposed) return;
      disposed = true;
      fatalRef.current(error);
    };

    const connect = () => {
      const params = new URLSearchParams({ pid: me, name });
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
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as ServerMsg;
        if (msg.t === "welcome") {
          joined = true;
          setStatus("open");
        } else if (msg.t === "room") setRoom(msg.room);
        else if (msg.t === "state") buffer.push(msg.round, msg.resultsIn, msg.game, performance.now());
        else if (msg.t === "error") rejected = { code: msg.code, message: msg.message };
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
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [code, name, create, capacity, me, buffer]);

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { status, room, me, buffer, send };
}
