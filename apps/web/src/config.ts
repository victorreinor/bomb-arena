/** WebSocket base URL of the game server (the Cloudflare Worker). */
export function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured.replace(/\/$/, "");
  return `ws://${location.hostname}:8787`;
}

/** Storage that may be missing or throw (private mode, blocked site data); callers handle null. */
export function safeStorage(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

/** Per-tab player id: a refresh keeps the seat, but two tabs are two players. */
export function playerId(): string {
  const store = safeStorage("sessionStorage");
  let id = store?.getItem("pid");
  if (!id) {
    id = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    store?.setItem("pid", id);
  }
  return id;
}

/** A saved preference, or null when unset or storage is unavailable. */
export function readPref(key: string): string | null {
  try {
    return safeStorage("localStorage")?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string) {
  try {
    safeStorage("localStorage")?.setItem(key, value);
  } catch {
    // full or blocked storage: the preference just isn't remembered
  }
}

export function savedName(): string {
  return readPref("name") ?? "";
}

export function saveName(name: string) {
  writePref("name", name);
}
