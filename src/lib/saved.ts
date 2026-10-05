/**
 * Favourites, recent flights, the "ready to sim" flight and finder preferences.
 * Each entry keeps enough to show and re-open the flight even if a later snapshot
 * drops it.
 */
import { useMemo } from "react";
import { plannedOut } from "./data/flight";
import type { FlightRow } from "./data/load";
import type { Sort } from "./data/query";
import { KEYS, readJSON, useStorageVersion, writeJSON } from "./storage";

export interface SavedFlight {
  id: string;
  al: string;
  op: string;
  fn: string | null;
  cs: string | null;
  o: string;
  d: string;
  std: number | null;
  at: number;
  /** Planned off-block, UTC min (scheduled or tracked); older entries may lack it. */
  dep?: number | null;
  /** Main aircraft type. */
  type?: string | null;
  days?: number[];
  /** Favourite group name; null/undefined = ungrouped. */
  group?: string | null;
}

const toSaved = (f: FlightRow): SavedFlight => ({
  id: f.id,
  al: f.al,
  op: f.op,
  fn: f.fn,
  cs: f.cs,
  o: f.o,
  d: f.d,
  std: f.std,
  at: Date.now(),
  dep: plannedOut(f),
  type: f.types[0] ?? null,
  days: f.days,
});

/* ---------- favourites ---------- */

export const readFavourites = () => readJSON<SavedFlight[]>(KEYS.favourites, []);
/** Starring adds to the group last chosen (Settings → favourites, or the flight card). */
export function toggleFavourite(f: FlightRow) {
  const l = readFavourites();
  const group = readGroups().includes(readPrefs().lastGroup ?? "") ? readPrefs().lastGroup : null;
  writeJSON(KEYS.favourites, l.some((x) => x.id === f.id) ? l.filter((x) => x.id !== f.id) : [{ ...toSaved(f), group }, ...l]);
}
/** Star or unstar a saved (e.g. recent) flight without loading it. */
export function toggleSavedFavourite(s: SavedFlight) {
  const l = readFavourites();
  const group = readGroups().includes(readPrefs().lastGroup ?? "") ? readPrefs().lastGroup : null;
  writeJSON(KEYS.favourites, l.some((x) => x.id === s.id) ? l.filter((x) => x.id !== s.id) : [{ ...s, group, at: Date.now() }, ...l]);
}
export function moveFavourite(id: string, group: string | null) {
  writeJSON(
    KEYS.favourites,
    readFavourites().map((x) => (x.id === id ? { ...x, group } : x)),
  );
  writePrefs({ lastGroup: group });
}

/* ---------- favourite groups (ordered names) ---------- */

export const readGroups = () => readJSON<string[]>(KEYS.favGroups, []);
const cleanName = (n: string) => n.trim().replace(/\s+/g, " ").slice(0, 40);
/** Adds a group; returns its name, or null if empty or taken. */
export function addGroup(name: string): string | null {
  const n = cleanName(name);
  const g = readGroups();
  if (!n || g.some((x) => x.toLowerCase() === n.toLowerCase())) return null;
  writeJSON(KEYS.favGroups, [...g, n]);
  return n;
}
export function renameGroup(from: string, to: string): boolean {
  const n = cleanName(to);
  const g = readGroups();
  if (!n || (n.toLowerCase() !== from.toLowerCase() && g.some((x) => x.toLowerCase() === n.toLowerCase()))) return false;
  writeJSON(KEYS.favGroups, g.map((x) => (x === from ? n : x)));
  writeJSON(KEYS.favourites, readFavourites().map((x) => (x.group === from ? { ...x, group: n } : x)));
  if (readPrefs().lastGroup === from) writePrefs({ lastGroup: n });
  return true;
}
/** Removes a group; its flights stay favourites, ungrouped. */
export function deleteGroup(name: string) {
  writeJSON(KEYS.favGroups, readGroups().filter((x) => x !== name));
  writeJSON(KEYS.favourites, readFavourites().map((x) => (x.group === name ? { ...x, group: null } : x)));
  if (readPrefs().lastGroup === name) writePrefs({ lastGroup: null });
}
export function moveGroup(name: string, by: -1 | 1) {
  const g = readGroups();
  const i = g.indexOf(name);
  const j = i + by;
  if (i < 0 || j < 0 || j >= g.length) return;
  [g[i], g[j]] = [g[j], g[i]];
  writeJSON(KEYS.favGroups, g);
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
  /** null = unsorted: the order the snapshot lists flights in. */
  sort: Sort | null;
  view: "flights" | "places" | "map";
  /** Spread random rolls across destinations rather than flights. */
  spread: boolean;
  /** Group new favourites go into. */
  lastGroup?: string | null;
}
export const DEFAULT_PREFS: Prefs = { airlines: ["EZY"], sort: null, view: "flights", spread: true };
export const readPrefs = (): Prefs => ({ ...DEFAULT_PREFS, ...readJSON<Partial<Prefs>>(KEYS.prefs, {}) });
export function writePrefs(p: Partial<Prefs>) {
  writeJSON(KEYS.prefs, { ...readPrefs(), ...p });
}

/** Re-read everything on any storage change. null until the browser has been read. */
export function useSaved() {
  const v = useStorageVersion();
  return useMemo(
    () => (v < 0 ? null : { favourites: readFavourites(), groups: readGroups(), history: readHistory(), ready: readReady(), prefs: readPrefs() }),
    [v],
  );
}
