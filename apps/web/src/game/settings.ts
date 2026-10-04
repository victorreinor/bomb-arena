import { readPref, writePref } from "../config";

/** Comfort settings, remembered per browser. Reduced motion defaults to the OS preference; vibration is on. */
export const settings = {
  reduceMotion:
    readPref("reduceMotion") !== null
      ? readPref("reduceMotion") === "1"
      : typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  haptics: readPref("haptics") !== "0",
};

export function setHaptics(on: boolean) {
  settings.haptics = on;
  writePref("haptics", on ? "1" : "0");
}

/** The stylesheet stills interface animations under this class. */
function applyMotionClass() {
  if (typeof document !== "undefined") document.documentElement.classList.toggle("reduce-motion", settings.reduceMotion);
}
applyMotionClass();

export function setReduceMotion(on: boolean) {
  settings.reduceMotion = on;
  writePref("reduceMotion", on ? "1" : "0");
  applyMotionClass();
}
