import { readPref, writePref } from "../config";

/** Visual comfort settings, remembered per browser. Defaults to the OS "reduce motion" preference. */
export const settings = {
  reduceMotion:
    readPref("reduceMotion") !== null
      ? readPref("reduceMotion") === "1"
      : typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
};

export function setReduceMotion(on: boolean) {
  settings.reduceMotion = on;
  writePref("reduceMotion", on ? "1" : "0");
}
