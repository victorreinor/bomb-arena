import { useEffect, useState } from "react";

/** Whether the page may go full screen: Android browsers can, iPhones can't (there the layout just follows the phone). */
export const canFullscreen = typeof document !== "undefined" && !!document.fullscreenEnabled;

/** `lock` is missing from TypeScript's DOM types, as only some browsers have it. */
type LockableOrientation = ScreenOrientation & { lock?: (orientation: "landscape") => Promise<void> };

/**
 * Full screen and sideways, even with the phone's auto-rotate off; the browser lets go of both on leaving
 * full screen. Resolves to whether the screen was locked sideways (iPhones can do neither).
 */
export async function playSideways(): Promise<boolean> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    const orientation = screen.orientation as LockableOrientation;
    if (!orientation.lock) return false;
    await orientation.lock("landscape");
    return true;
  } catch {
    // refused or unsupported: whatever worked stays
    return false;
  }
}

/** Whether the page runs as an app installed on the home screen (no browser bars). */
export const installedQuery = "(display-mode: standalone), (display-mode: fullscreen)";

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
