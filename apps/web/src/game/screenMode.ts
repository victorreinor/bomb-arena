import { useCallback, useSyncExternalStore } from "react";

/** Whether the page may go full screen: Android browsers can, iPhones can't (there the page is turned by hand). */
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

export function leaveFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

/** Whether the page runs as an app installed on the home screen (no browser bars). */
export const installedQuery = "(display-mode: standalone), (display-mode: fullscreen)";

const onFullscreenChange = (notify: () => void) => {
  document.addEventListener("fullscreenchange", notify);
  return () => document.removeEventListener("fullscreenchange", notify);
};

export const useFullscreen = () => useSyncExternalStore(onFullscreenChange, () => !!document.fullscreenElement);

/** Whether a media query matches, kept up to date (the phone turning, the app being installed). */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}
