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
  /** Airport codes beside destinations on maps (codes that would overlap are skipped). */
  mapCodes: MapCodes;
  /** Route lines on maps: the shortest way (great circle, straight on these maps) or a constant heading along the grid (rhumb line). */
  mapLines: MapLines;
  /** How the flight card shows departs / arrives. */
  routeHead: RouteHeadStyle;
  /** How the flight card shows a flight's times through the week (A1–A4). */
  week: WeekStyle;
  /** How the flights table marks a time that's different on other days (B1–B3). */
  variesMark: VariesMark;
  /** How the logbook lists flights: a table (rows by month) or ATC flight progress strips. */
  logbook: LogbookStyle;
  /** Logbook table: a punctuality bar per flight (scheduled vs flown) instead of the airports. */
  logBars: boolean;
}
export type WeekStyle = "table" | "grouped" | "tabs" | "timeline";
export type VariesMark = "tag" | "word" | "tilde";
export type MapCodes = "iata" | "icao" | "off";
export type MapLines = "great" | "rhumb";
export type LogbookStyle = "table" | "strips";
export type RouteHeadStyle = "timeline" | "pass" | "board";

export const DEFAULT_DISPLAY: Display = { airlineTag: "solid", flightFirst: true, typeColour: "maker", typeTheme: "full", mapCodes: "iata", mapLines: "great", routeHead: "timeline", week: "table", variesMark: "tag", logbook: "table", logBars: false };

export const readDisplay = (): Display => {
  const d = { ...DEFAULT_DISPLAY, ...readJSON<Partial<Display> & { mapCodes?: MapCodes | boolean }>(KEYS.display, {}) };
  // earlier versions stored a yes/no for codes
  if (typeof d.mapCodes === "boolean") d.mapCodes = d.mapCodes ? "iata" : "off";
  return d as Display;
};
export function writeDisplay(p: Partial<Display>) {
  writeJSON(KEYS.display, { ...readDisplay(), ...p });
}
/** Defaults until the browser's choice has been read (server render, first paint). */
export function useDisplay(): Display {
  const v = useStorageVersion();
  return useMemo(() => (v < 0 ? DEFAULT_DISPLAY : readDisplay()), [v]);
}
