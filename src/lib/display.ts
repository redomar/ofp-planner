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
  /** Aircraft badge colour: by manufacturer, by the airline that flies it, or none. */
  typeColour: TypeColour;
  /** Aircraft badge theme: a coloured edge on the side, or filled (a tint of the colour, the same recipe for maker and airline). */
  typeTheme: "side" | "full";
  /** Airport codes beside destinations on maps (codes that would overlap are skipped). */
  mapCodes: MapCodes;
  /** Route lines on maps: the shortest way (great circle, straight on these maps) or a constant heading along the grid (rhumb line). */
  mapLines: MapLines;
  /** The flight card's boarding pass: actions on a stub at the side, the OUT · OFF · ON · IN track (default), or city names first. */
  pass: PassStyle;
  /** The times table sits on the back of the pass (a flip button turns it over) instead of always open under the map. */
  passFlip: boolean;
  /** Favourites and recent flights as small tickets instead of plain rows. */
  tickets: boolean;
  /** How the flight card shows a flight's times through the week (A1–A4). */
  week: WeekStyle;
  /** How the flights table marks a time that's different on other days (B1–B3). */
  variesMark: VariesMark;
  /** How the logbook lists flights: a table (rows by month) or ATC flight progress strips. */
  logbook: LogbookStyle;
  /** Logbook table: a punctuality bar per flight (scheduled vs flown) instead of the airports. */
  logBars: boolean;
  /** Which airlines pickers and "all airlines" list: the common ones, or those plus the Extra+ brands. */
  airlines: AirlineSet;
  /** List flights with an airport guessed from the climb-out or descent (Flight.inf). */
  guessed: boolean;
  /** Settings → Display: one row per setting with a sample, or the rows beside one live preview. */
  settingsView: SettingsView;
}
export type TypeColour = "maker" | "airline" | "none";
export type SettingsView = "rows" | "preview";
export type AirlineSet = "common" | "extra";
export type WeekStyle = "table" | "grouped" | "tabs" | "timeline";
export type VariesMark = "tag" | "word" | "tilde";
export type MapCodes = "iata" | "icao" | "off";
export type MapLines = "great" | "rhumb";
export type LogbookStyle = "table" | "strips";
export type PassStyle = "side" | "track" | "city";

export const PASS_STYLES: readonly PassStyle[] = ["side", "track", "city"];

export const DEFAULT_DISPLAY: Display = { airlineTag: "solid", flightFirst: true, typeColour: "maker", typeTheme: "full", mapCodes: "iata", mapLines: "great", pass: "track", passFlip: true, tickets: true, week: "table", variesMark: "tag", logbook: "table", logBars: false, airlines: "common", guessed: false, settingsView: "rows" };

export const readDisplay = (): Display => {
  const stored = readJSON<Partial<Display> & { mapCodes?: MapCodes | boolean; routeHead?: string }>(KEYS.display, {});
  const { routeHead, ...rest } = stored;
  const d = { ...DEFAULT_DISPLAY, ...rest };
  // earlier versions stored a yes/no for codes
  if (typeof d.mapCodes === "boolean") d.mapCodes = d.mapCodes ? "iata" : "off";
  // before 1.8 the card had three styles (timeline, boarding pass, departure board); each maps to a pass
  if (!rest.pass && routeHead) d.pass = routeHead === "pass" ? "side" : "track";
  if (!PASS_STYLES.includes(d.pass)) d.pass = DEFAULT_DISPLAY.pass;
  if (!["maker", "airline", "none"].includes(d.typeColour)) d.typeColour = DEFAULT_DISPLAY.typeColour;
  if (d.settingsView !== "rows" && d.settingsView !== "preview") d.settingsView = DEFAULT_DISPLAY.settingsView;
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

/**
 * Is this airline listed under the current setting? Extra+ brands are hidden unless the setting
 * says "extra", or the airline was named explicitly (a URL, a favourite, a picked filter).
 */
export const listedAirline = (a: { icao: string; extra?: boolean }, set: AirlineSet, named: readonly string[] = []) => !a.extra || set === "extra" || named.includes(a.icao);
/** ICAO codes of the airlines `listedAirline` leaves out, for filtering route counts. */
export const hiddenAirlines = (m: { airlines: { icao: string; extra?: boolean }[] } | null | undefined, set: AirlineSet, named: readonly string[] = []) =>
  new Set((m?.airlines ?? []).filter((a) => !listedAirline(a, set, named)).map((a) => a.icao));
