/**
 * Flight numbers the user adds for flights the open data only knows by callsign (EJU54LH).
 * Keyed by operator + callsign, so one entry covers every day that callsign flies.
 * Stored in this browser; applied wherever flights are shown, searched or dispatched.
 */
import { useMemo } from "react";
import type { FlightRow } from "./data/load";
import { KEYS, readJSON, useStorageVersion, writeJSON } from "./storage";

export type FnOverrides = Record<string, string>;
const key = (op: string, cs: string) => `${op}:${cs}`;

export const readFnOverrides = () => readJSON<FnOverrides>(KEYS.fnOverrides, {});
/** Stable across unrelated storage changes: a new object only when the numbers themselves change. */
export function useFnOverrides(): FnOverrides {
  const v = useStorageVersion();
  const raw = useMemo(() => (v < 0 ? "{}" : JSON.stringify(readFnOverrides())), [v]);
  return useMemo(() => JSON.parse(raw) as FnOverrides, [raw]);
}

/** 1–4 digits and an optional letter ("1016", "8473A"); null when it isn't one. */
export function cleanFn(v: string): string | null {
  // accepts "1016", "U2 1016", "EZY1016": an airline prefix is dropped
  const s = v.toUpperCase().replace(/\s+/g, "").replace(/^(?:[A-Z]{3}|[A-Z]{2}|[A-Z]\d|\d[A-Z])(?=\d)/, "");
  return /^\d{1,4}[A-Z]?$/.test(s) ? s : null;
}

export function setFnOverride(op: string, cs: string, fn: string | null) {
  const all = readFnOverrides();
  if (fn) all[key(op, cs)] = fn;
  else delete all[key(op, cs)];
  writeJSON(KEYS.fnOverrides, all);
}

/** The user's number for a callsign-only flight, if any. */
export function overrideFor(op: string, cs: string | null, o: FnOverrides): string | null {
  return cs ? (o[key(op, cs)] ?? null) : null;
}

/** The flight with the user's number filled in (only when the data has none). */
export function applyFn<T extends FlightRow>(f: T, o: FnOverrides): T {
  if (f.fn || !f.cs) return f;
  const fn = o[key(f.op, f.cs)];
  return fn ? { ...f, fn, fnUser: true } : f;
}
