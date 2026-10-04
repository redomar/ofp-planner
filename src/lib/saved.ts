/**
 * Favourites, recent flights, the "ready to sim" flight and finder preferences.
 * Each entry keeps enough to show and re-open the flight even if a later snapshot
 * drops it.
 */
import { useMemo } from "react";
import type { FlightRow } from "./data/load";
import type { Sort } from "./data/query";
import { KEYS, readJSON, useStorageVersion, writeJSON } from "./storage";

export interface SavedFlight {
  id: string;
  al: string;
  op: string;
  fn: string;
  cs: string | null;
  o: string;
  d: string;
  std: number | null;
  at: number;
}

const toSaved = (f: FlightRow): SavedFlight => ({ id: f.id, al: f.al, op: f.op, fn: f.fn, cs: f.cs, o: f.o, d: f.d, std: f.std, at: Date.now() });

/* ---------- favourites ---------- */

export const readFavourites = () => readJSON<SavedFlight[]>(KEYS.favourites, []);
export function toggleFavourite(f: FlightRow) {
  const l = readFavourites();
  writeJSON(KEYS.favourites, l.some((x) => x.id === f.id) ? l.filter((x) => x.id !== f.id) : [toSaved(f), ...l]);
}
export function removeFavourite(id: string) {
  writeJSON(KEYS.favourites, readFavourites().filter((x) => x.id !== id));
}

/* ---------- history (most recent first, capped) ---------- */

const HISTORY_MAX = 40;
export const readHistory = () => readJSON<SavedFlight[]>(KEYS.history, []);
export function pushHistory(f: FlightRow) {
  const l = readHistory().filter((x) => x.id !== f.id);
  writeJSON(KEYS.history, [toSaved(f), ...l].slice(0, HISTORY_MAX));
}
export function clearHistory() {
  writeJSON(KEYS.history, []);
}

/* ---------- ready to sim ---------- */

export interface Ready {
  flight: SavedFlight;
  /** Planned departure date, YYYY-MM-DD (UTC). */
  date: string | null;
  /** Chosen type picker value ("af:<id>" or "type:A320"). */
  choice: string | null;
}
export const readReady = () => readJSON<Ready | null>(KEYS.ready, null);
export function setReady(f: FlightRow, date: string | null, choice: string | null) {
  writeJSON(KEYS.ready, { flight: toSaved(f), date, choice } satisfies Ready);
}
export function updateReady(patch: Partial<Omit<Ready, "flight">>) {
  const r = readReady();
  if (r) writeJSON(KEYS.ready, { ...r, ...patch });
}

/* ---------- finder preferences ---------- */

export interface Prefs {
  /** Last airline selection, used when the URL doesn't say. */
  airlines: string[];
  sort: Sort;
  view: "flights" | "places";
  /** Spread random rolls across destinations rather than flights. */
  spread: boolean;
}
export const DEFAULT_PREFS: Prefs = { airlines: ["EZY"], sort: { key: "std", dir: 1 }, view: "flights", spread: true };
export const readPrefs = (): Prefs => ({ ...DEFAULT_PREFS, ...readJSON<Partial<Prefs>>(KEYS.prefs, {}) });
export function writePrefs(p: Partial<Prefs>) {
  writeJSON(KEYS.prefs, { ...readPrefs(), ...p });
}

/** Re-read everything on any storage change. null until the browser has been read. */
export function useSaved() {
  const v = useStorageVersion();
  return useMemo(
    () => (v < 0 ? null : { favourites: readFavourites(), history: readHistory(), ready: readReady(), prefs: readPrefs() }),
    [v],
  );
}
