import { useEffect, useState } from "react";
import { MAPS, MIN_MEMBERS, PLAYER_COLORS, canStart, getMap, type ClientMsg, type MemberView, type RoomView } from "@bomberman/engine";
import { audio } from "../game/audio";
import { ItemIcon } from "../game/ItemIcon";
import { ITEM_INFO } from "../game/items";
import { COLOR_CSS, COLOR_NAMES } from "../game/colors";
import { CapacityPicker } from "./fields";

const MAP_HINT: Record<string, string> = {
  classic: "o original",
  open: "simples",
  maze: "complexo",
  quadrants: "complexo",
};

interface Props {
  room: RoomView;
  me: string;
  reconnecting: boolean;
  send: (msg: ClientMsg) => void;
  onLeave: () => void;
}

export function Lobby({ room, me, reconnecting, send, onLeave }: Props) {
  const [copied, setCopied] = useState(false);
  useEffect(() => audio.playMusic("menu"), []);
  const self = room.members.find((m) => m.id === me);
  const isHost = room.hostId === me;
  const connected = room.members.filter((m) => m.connected);
  const startable = canStart(room);
  const link = `${location.origin}${location.pathname}?sala=${room.code}`;
  const taken = new Map<number, MemberView>(room.members.map((m) => [m.color, m]));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copie o link:", link);
    }
  };

  const result = room.lastResult;

  return (
    <div className="screen">
      <h1 className="title">Sala</h1>
      <div className="room-code" aria-label="Código da sala">{room.code}</div>
      <div className="row">
        <button onClick={copy}>{copied ? "Link copiado!" : "Copiar link de convite"}</button>
        <button className="ghost" onClick={onLeave}>Sair</button>
      </div>
      {reconnecting && <p className="notice">Reconectando…</p>}
      {result && (
        <p className="notice">
          Última partida: {result.winnerName ? `${result.winnerName} venceu!` : "empate"}
        </p>
      )}

      <div className="card">
        <h2>Jogadores ({room.members.length}/{room.capacity})</h2>
        <ul className="members">
          {room.members.map((m) => (
            <li key={m.id} className={m.connected ? "" : "offline"}>
              <span className="hud-chip" style={{ background: COLOR_CSS[m.color] }} />
              <span className="member-name">
                {m.name}
                {m.id === me && " (você)"}
                {m.id === room.hostId && " 👑"}
              </span>
              <span className="member-state">
                {!m.connected ? "desconectado" : m.id === room.hostId || m.ready ? "pronto" : "aguardando"}
              </span>
            </li>
          ))}
        </ul>

        {self && (
          <>
            <h2>Sua cor</h2>
            <div className="swatches">
              {Array.from({ length: PLAYER_COLORS }, (_, c) => {
                const owner = taken.get(c);
                const mine = owner?.id === me;
                return (
                  <button
                    key={c}
                    className={`swatch${mine ? " selected" : ""}`}
                    style={{ background: COLOR_CSS[c] }}
                    disabled={!!owner && !mine}
                    title={owner && !mine ? `${COLOR_NAMES[c]} (em uso por ${owner.name})` : COLOR_NAMES[c]}
                    aria-label={COLOR_NAMES[c]}
                    aria-pressed={mine}
                    onClick={() => send({ t: "color", color: c })}
                  />
                );
              })}
            </div>
          </>
        )}

        <h2>Mapa</h2>
        {isHost ? (
          <select value={room.mapId} onChange={(e) => send({ t: "map", mapId: e.target.value })}>
            {MAPS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {MAP_HINT[m.id] ?? ""}
              </option>
            ))}
          </select>
        ) : (
          <p className="muted">{getMap(room.mapId).name} (escolhido pelo anfitrião)</p>
        )}

        {isHost && (
          <>
            <h2>Vagas na sala</h2>
            <CapacityPicker
              label="Vagas na sala"
              value={room.capacity}
              min={room.members.length}
              onChange={(capacity) => send({ t: "capacity", capacity })}
            />
          </>
        )}

        <details className="legend">
          <summary>Itens e controles</summary>
          <p className="muted">Mover: WASD ou setas · Bomba: Espaço/Enter · Ação: Shift</p>
          <ul>
            {(Object.keys(ITEM_INFO) as (keyof typeof ITEM_INFO)[]).map((kind) => (
              <li key={kind}>
                <ItemIcon kind={kind} size={28} />
                <span>
                  <b>{ITEM_INFO[kind].name}</b>
                  <span className="desc">{ITEM_INFO[kind].desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>

        <div className="actions">
          {isHost ? (
            <button className="primary" disabled={!startable} onClick={() => send({ t: "start" })}>
              {connected.length < MIN_MEMBERS ? `Aguardando jogadores (${connected.length}/${room.capacity})…` : startable ? "Iniciar partida" : "Aguardando todos ficarem prontos…"}
            </button>
          ) : (
            <button className={self?.ready ? "" : "primary"} onClick={() => send({ t: "ready", ready: !self?.ready })}>
              {self?.ready ? "Cancelar pronto" : "Estou pronto"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
