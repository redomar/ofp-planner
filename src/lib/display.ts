/**
 * How flights and aircraft are labelled (Settings → Display). Stored per browser.
 */
import { useMemo } from "react";
import { KEYS, readJSON, useStorageVersion, writeJSON } from "./storage";

export type AirlineTagStyle = "solid" | "tint" | "split" | "edge";
export interface Display {
  /** Airline name tag in the flights table. */
  airlineTag: AirlineTagStyle;
  /** Flight number first, then the airline tag (default), or the other way round. */
  flightFirst: boolean;
  /** Aircraft badge colour: by manufacturer or by the airline that flies it. */
  typeColour: "maker" | "airline";
  /** Aircraft badge theme: a coloured edge on the side, or fully coloured. */
  typeTheme: "side" | "full";
}

export const DEFAULT_DISPLAY: Display = { airlineTag: "solid", flightFirst: true, typeColour: "maker", typeTheme: "full" };

export const readDisplay = (): Display => ({ ...DEFAULT_DISPLAY, ...readJSON<Partial<Display>>(KEYS.display, {}) });
export function writeDisplay(p: Partial<Display>) {
  writeJSON(KEYS.display, { ...readDisplay(), ...p });
}
/** Defaults until the browser's choice has been read (server render, first paint). */
export function useDisplay(): Display {
  const v = useStorageVersion();
  return useMemo(() => (v < 0 ? DEFAULT_DISPLAY : readDisplay()), [v]);
}
