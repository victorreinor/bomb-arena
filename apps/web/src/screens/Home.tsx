import { useEffect, useState } from "react";
import { MAX_MEMBERS, isValidRoomCode, normalizeRoomCode } from "@bomberman/engine";
import { savedName, saveName } from "../config";
import { audio } from "../game/audio";
import { CapacityPicker, NameField } from "./fields";

interface Props {
  initialCode: string;
  error: string | null;
  onCreate: (name: string, capacity: number) => void;
  onJoin: (name: string, code: string) => void;
  onLocal: () => void;
}

export function Home({ initialCode, error, onCreate, onJoin, onLocal }: Props) {
  const [name, setName] = useState(savedName);
  useEffect(() => audio.playMusic("menu"), []);
  const [code, setCode] = useState(initialCode);
  const [capacity, setCapacity] = useState(MAX_MEMBERS);
  const cleanCode = normalizeRoomCode(code);
  const codeOk = isValidRoomCode(cleanCode);
  const nameOk = name.trim().length > 0;

  const submit = (fn: () => void) => {
    saveName(name.trim());
    fn();
  };

  // opened from an invite link: skip the create-room form entirely
  const [invited, setInvited] = useState(() => isValidRoomCode(normalizeRoomCode(initialCode)));
  if (invited) {
    const inviteCode = normalizeRoomCode(initialCode);
    return (
      <div className="screen">
        <h1 className="title">Bomb Arena</h1>
        <p className="subtitle">Você foi convidado para uma sala</p>
        <div className="room-code" aria-label="Código da sala">{inviteCode}</div>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameOk) submit(() => onJoin(name.trim(), inviteCode));
          }}
        >
          <NameField value={name} onChange={setName} />
          {error && <p className="notice error" role="alert">{error}</p>}
          <button className="primary" type="submit" disabled={!nameOk}>Entrar na sala</button>
        </form>
        <button className="link" onClick={() => setInvited(false)}>Criar minha própria sala</button>
      </div>
    );
  }

  return (
    <div className="screen">
      <h1 className="title">Bomb Arena</h1>
      <p className="subtitle">Até {MAX_MEMBERS} jogadores · online</p>

      <div className="card">
        <NameField value={name} onChange={setName} />

        {error && <p className="notice error" role="alert">{error}</p>}

        <div className="field">
          <span>Jogadores na sala</span>
          <CapacityPicker label="Jogadores na sala" value={capacity} onChange={setCapacity} />
        </div>

        <button className="primary" disabled={!nameOk} onClick={() => submit(() => onCreate(name.trim(), capacity))}>
          Criar sala
        </button>

        <div className="divider">ou entre com um código</div>

        <form
          className="join-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameOk && codeOk) submit(() => onJoin(name.trim(), cleanCode));
          }}
        >
          <input
            className="code-input"
            value={code}
            maxLength={7}
            placeholder="CÓDIGO"
            aria-label="Código da sala"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button type="submit" disabled={!nameOk || !codeOk}>Entrar</button>
        </form>
      </div>

      <button className="link" onClick={onLocal}>Modo local (2 jogadores no mesmo teclado)</button>
    </div>
  );
}
