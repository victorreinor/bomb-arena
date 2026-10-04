import { useEffect, useState } from "react";

/** Whether the page may go full screen: Android browsers can, iPhones can't (there the layout just follows the phone). */
export const canFullscreen = typeof document !== "undefined" && !!document.fullscreenEnabled;

/** `lock` is missing from TypeScript's DOM types, as only some browsers have it. */
type LockableOrientation = ScreenOrientation & { lock?: (orientation: "landscape") => Promise<void> };

/** Full screen and sideways, even with the phone's auto-rotate off. The browser lets go of both on leaving full screen. */
export async function playSideways() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    await (screen.orientation as LockableOrientation).lock?.("landscape");
  } catch {
    // refused or unsupported: whatever worked stays, and the layout follows the phone anyway
  }
}

export function leaveFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

export function useFullscreen(): boolean {
  const [on, setOn] = useState(() => typeof document !== "undefined" && !!document.fullscreenElement);
  useEffect(() => {
    const update = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  return on;
}

/** Whether a media query matches, kept up to date (the phone turning, the app being installed). */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia !== "undefined" && matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}
