import { useCallback, useState } from "react";
import { MAX_MEMBERS, randomRoomCode, type BotLevel } from "@bomberman/engine";
import { LocalGame } from "./game/LocalGame";
import { SoundToggle } from "./game/SoundToggle";
import { useRoom, type RoomError } from "./net/useRoom";
import { Home } from "./screens/Home";
import { Lobby } from "./screens/Lobby";
import { OnlineGame } from "./screens/OnlineGame";

type Route =
  | { kind: "home" }
  | { kind: "local"; bots: BotLevel | null }
  | { kind: "room"; code: string; name: string; create: boolean; capacity: number };

function setUrlCode(code: string | null) {
  const url = new URL(location.href);
  if (code) url.searchParams.set("sala", code);
  else url.searchParams.delete("sala");
  history.replaceState(null, "", url);
}

function RoomScreen({ code, name, create, capacity, onLeave, onFatal }: {
  code: string;
  name: string;
  create: boolean;
  capacity: number;
  onLeave: () => void;
  onFatal: (e: RoomError) => void;
}) {
  const { status, room, me, buffer, send } = useRoom({ code, name, create, capacity, onFatal });
  if (!room) return <div className="screen"><p className="notice">Conectando…</p></div>;
  // tell the room we're going (no reconnect grace), then close the connection by leaving the screen
  const leave = () => {
    send({ t: "leave" });
    onLeave();
  };
  if (room.phase === "playing") return <OnlineGame room={room} me={me} buffer={buffer} send={send} onLeave={leave} />;
  return <Lobby room={room} me={me} reconnecting={status === "reconnecting"} send={send} onLeave={leave} />;
}

export function App() {
  return (
    <>
      <SoundToggle />
      <Screens />
    </>
  );
}

function Screens() {
  const [route, setRoute] = useState<Route>({ kind: "home" });
  const [error, setError] = useState<string | null>(null);
  const [initialCode] = useState(() => new URLSearchParams(location.search).get("sala")?.toUpperCase() ?? "");

  const enter = useCallback((name: string, code: string, create: boolean, capacity = MAX_MEMBERS) => {
    setError(null);
    setUrlCode(code);
    setRoute({ kind: "room", code, name, create, capacity });
  }, []);

  const leave = useCallback(() => {
    setUrlCode(null);
    setRoute({ kind: "home" });
  }, []);

  const onFatal = useCallback(
    (e: RoomError) => {
      setRoute((current) => {
        if (current.kind === "room" && current.create && e.code === "exists") {
          // vanishingly rare code collision: just roll another code
          const code = randomRoomCode();
          setUrlCode(code);
          return { ...current, code };
        }
        setUrlCode(null);
        setError(e.message);
        return { kind: "home" };
      });
    },
    [],
  );

  if (route.kind === "local") return <LocalGame bots={route.bots} onLeave={leave} />;
  if (route.kind === "room") {
    return (
      <RoomScreen
        key={`${route.code}:${route.create}`}
        code={route.code}
        name={route.name}
        create={route.create}
        capacity={route.capacity}
        onLeave={leave}
        onFatal={onFatal}
      />
    );
  }
  return (
    <Home
      initialCode={initialCode}
      error={error}
      onCreate={(name, capacity) => enter(name, randomRoomCode(), true, capacity)}
      onJoin={(name, code) => enter(name, code, false)}
      onLocal={(bots) => setRoute({ kind: "local", bots })}
    />
  );
}
