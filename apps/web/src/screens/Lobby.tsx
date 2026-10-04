import { useEffect, useState } from "react";
import {
  BEST_OF_OPTIONS,
  DEFAULT_BOT_LEVEL,
  MIN_MEMBERS,
  PLAYER_COLORS,
  TIME_LIMIT_OPTIONS,
  canStart,
  getMap,
  mapSeats,
  tooManyForMap,
  type BotLevel,
  type ClientMsg,
  type MemberView,
  type RoomView,
} from "@bomb-arena/engine";
import { audio } from "../game/audio";
import { BOT_LEVEL_NAMES, BOT_LEVEL_OPTIONS, nextBotLevel } from "../game/botLevels";
import { ItemIcon, PetIcon } from "../game/ItemIcon";
import { ITEM_INFO, PET_INFO } from "../game/items";
import { COLOR_CSS, COLOR_NAMES } from "../game/colors";
import { PingBadge } from "../game/PingBadge";
import { bestOfLabel, showsScore, timeLimitLabel } from "../game/MatchTimer";
import { HostSetting, OptionPicker, capacityOptions } from "./fields";
import { MapPicker } from "./MapPicker";

interface Props {
  room: RoomView;
  me: string;
  reconnecting: boolean;
  send: (msg: ClientMsg) => void;
  ping: number | null;
  onLeave: () => void;
}

export function Lobby({ room, me, reconnecting, send, ping, onLeave }: Props) {
  const [copied, setCopied] = useState(false);
  const [newBotLevel, setNewBotLevel] = useState<BotLevel>(DEFAULT_BOT_LEVEL);
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
  const showScore = showsScore(room);

  /** What the host's start button says: why it can't start yet, or that it can. */
  const startLabel = () => {
    if (connected.length < MIN_MEMBERS) return `Aguardando jogadores (${connected.length}/${room.capacity})…`;
    if (tooManyForMap(room)) return `Esse mapa é para ${mapSeats(getMap(room.mapId))} jogadores`;
    return startable ? "Iniciar partida" : "Aguardando todos ficarem prontos…";
  };

  return (
    <div className="lobby">
      <header className="lobby-header">
        <div className="lobby-title">
          <span className="lobby-label">Sala</span>
          <span className="room-code" aria-label="Código da sala">
            {room.code}
          </span>
        </div>
        <div className="row">
          <PingBadge ms={ping} />
          <button className={copied ? "copied" : ""} onClick={copy}>
            {copied ? "Link copiado!" : "Copiar link de convite"}
          </button>
          <button className="ghost" onClick={onLeave}>
            Sair
          </button>
        </div>
      </header>
      {reconnecting && <p className="notice">Reconectando…</p>}
      {result?.seriesWon ? (
        <p className="notice champion">🏆 {result.winnerName} venceu a série! O placar recomeça na próxima partida.</p>
      ) : (
        result && <p className="notice">Última partida: {result.winnerName ? `${result.winnerName} venceu!` : "empate"}</p>
      )}

      <div className="lobby-grid">
        <section className="card">
          <h2>
            Jogadores ({room.members.length}/{room.capacity})
          </h2>
          <ul className="members">
            {room.members.map((m) => (
              <li key={m.id} className={m.connected ? "" : "offline"}>
                <span className="hud-chip" style={{ background: COLOR_CSS[m.color] }} />
                <span className="member-name">
                  {m.bot && "🤖 "}
                  {m.name}
                  {m.id === me && " (você)"}
                  {m.id === room.hostId && " 👑"}
                </span>
                {m.bot &&
                  (isHost ? (
                    <button
                      className="ghost tag"
                      title="Trocar o nível"
                      onClick={() => send({ t: "botLevel", id: m.id, level: nextBotLevel(m.bot!) })}
                    >
                      {BOT_LEVEL_NAMES[m.bot]}
                    </button>
                  ) : (
                    <span className="tag">{BOT_LEVEL_NAMES[m.bot]}</span>
                  ))}
                {showScore && (
                  <span className="member-score" title="Vitórias">
                    🏆 {m.score}
                  </span>
                )}
                {isHost && m.id !== me && (
                  <button
                    className="ghost remove-member"
                    onClick={() => send(m.bot ? { t: "removeBot", id: m.id } : { t: "kick", id: m.id })}
                    title={m.bot ? "Remover bot" : `Tirar ${m.name} da sala`}
                  >
                    ✕
                  </button>
                )}
                {/* keyed by the state, so a change replays its little pop */}
                <span key={`${m.connected}-${m.ready}`} className={`member-state${m.connected && m.ready ? " is-ready" : ""}`}>
                  {!m.connected ? "desconectado" : m.ready ? "pronto" : "aguardando"}
                </span>
              </li>
            ))}
          </ul>
          {isHost && room.members.length < room.capacity && (
            <div className="add-bot-row">
              <button className="add-bot" onClick={() => send({ t: "addBot", level: newBotLevel })}>
                + Adicionar bot
              </button>
              <OptionPicker label="Nível do bot" value={newBotLevel} options={BOT_LEVEL_OPTIONS} onChange={setNewBotLevel} />
            </div>
          )}

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

          <details className="legend">
            <summary>Itens, pets e controles</summary>
            <p className="muted">Mover: WASD ou setas · Bomba: Espaço/Enter · Ação: Shift · Pet: E ou / · ou controle</p>
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
            <h3>Pets (saem do ovo; aguentam um golpe por você)</h3>
            <ul>
              {(Object.keys(PET_INFO) as (keyof typeof PET_INFO)[]).map((kind) => (
                <li key={kind}>
                  <PetIcon kind={kind} size={28} />
                  <span>
                    <b>{PET_INFO[kind].name}</b>
                    <span className="desc">{PET_INFO[kind].desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </section>

        <section className="card">
          <h2>Mapa</h2>
          <MapPicker selected={room.mapId} editable={isHost} onSelect={(mapId) => send({ t: "map", mapId })} />
          <div className="settings">
            <HostSetting
              title="Série"
              editable={isHost}
              value={room.bestOf}
              options={BEST_OF_OPTIONS.map((n) => ({ value: n as number, label: bestOfLabel(n) }))}
              onChange={(n) => send({ t: "bestOf", n })}
            />
            <HostSetting
              title="Tempo"
              hint="Quando acaba, vem o sudden death: blocos caem em espiral até sobrar um."
              editable={isHost}
              value={room.timeLimit}
              options={TIME_LIMIT_OPTIONS.map((m) => ({ value: m as number, label: timeLimitLabel(m) }))}
              onChange={(minutes) => send({ t: "timeLimit", minutes })}
            />
            <HostSetting
              title="Vingança"
              hint="Quem morre vira fantasma na borda e joga bombas para dentro."
              editable={isHost}
              value={room.revenge}
              options={[
                { value: false, label: "Desligada" },
                { value: true, label: "Ligada" },
              ]}
              onChange={(on) => send({ t: "revenge", on })}
            />
            <HostSetting
              title="Vagas"
              editable={isHost}
              value={room.capacity}
              options={capacityOptions(room.members.length)}
              onChange={(capacity) => send({ t: "capacity", capacity })}
            />
          </div>
        </section>
      </div>

      <div className="lobby-start">
        {isHost ? (
          <button className="primary" disabled={!startable} onClick={() => send({ t: "start" })}>
            {startLabel()}
          </button>
        ) : (
          <button className={self?.ready ? "" : "primary"} onClick={() => send({ t: "ready", ready: !self?.ready })}>
            {self?.ready ? "Cancelar pronto" : "Estou pronto"}
          </button>
        )}
      </div>
    </div>
  );
}
