/**
 * SimBrief dispatch links and the user's saved airframes.
 *
 * Link format (dispatch.simbrief.com "custom" options page, pre-filled from the query):
 *   airline, fltnum, orig, dest, type, callsign, deph, depm (departure hour/minute, UTC)
 * `type` is either an ICAO type ("A320") or a saved SimBrief airframe's internal id
 * ("123456_1700000000000"), which loads that airframe's registration, weights and engines.
 */
import { useMemo } from "react";
import { familyOf, fltnum, plannedOut } from "./data/flight";
import type { FlightRow } from "./data/load";
import { KEYS, readJSON, useStorageVersion, writeJSON } from "./storage";

export interface Airframe {
  id: string;
  /** What the picker shows, e.g. "G-ABCD". */
  name: string;
  /** ICAO type designator it flies as. */
  icao: string;
  /** SimBrief internal airframe id, used as the link's `type`. */
  sbType: string;
  note: string | null;
}

/** Seeded on first run; editable and removable in Settings. */
export const DEFAULT_AIRFRAMES: Airframe[] = [
  { id: "g-abcd", name: "G-ABCD", icao: "A20N", sbType: "123456_1700000000000", note: "A320-251N · LEAP-1A · 180 pax" },
];

export interface AirframePrefs {
  list: Airframe[];
  /** Airframe used automatically when a flight's type is in the same family. */
  preferred: string | null;
}

export function readAirframes(): AirframePrefs {
  return readJSON<AirframePrefs>(KEYS.airframes, { list: DEFAULT_AIRFRAMES, preferred: DEFAULT_AIRFRAMES[0].id });
}
export function writeAirframes(p: AirframePrefs) {
  writeJSON(KEYS.airframes, p);
}
export function useAirframes(): AirframePrefs | null {
  const v = useStorageVersion();
  return useMemo(() => (v < 0 ? null : readAirframes()), [v]);
}

/** A choice in the type picker: the scheduled type, or a saved airframe. */
export interface TypeChoice {
  value: string; // "type:A320" | "af:<id>"
  label: string;
  sbType: string;
  icao: string;
}

export function typeChoices(f: FlightRow, prefs: AirframePrefs | null): TypeChoice[] {
  const sched = (f.types.length ? f.types : ["A320"]).map((t) => ({
    value: `type:${t}`,
    label: `${t} · ${f.typeGuessed ? "airline's usual type" : f.samples ? "as flown" : "as scheduled"}`,
    sbType: t,
    icao: t,
  }));
  const mine = (prefs?.list ?? []).map((a) => ({ value: `af:${a.id}`, label: `${a.name} · ${a.icao} (my airframe)`, sbType: a.sbType, icao: a.icao }));
  return [...mine, ...sched];
}

/** The preferred airframe when it's in the flight's type family, else the first scheduled type. */
export function defaultChoice(f: FlightRow, prefs: AirframePrefs | null): string {
  const pref = prefs?.list.find((a) => a.id === prefs.preferred);
  if (pref && (f.types.length === 0 || f.types.some((t) => familyOf(t) === familyOf(pref.icao)))) return `af:${pref.id}`;
  return `type:${f.types[0] ?? "A320"}`;
}

export interface DispatchInput {
  airline: string;
  fltnum: string;
  orig: string;
  dest: string;
  type: string;
  callsign: string | null;
  /** Departure, UTC minutes after midnight. */
  dep: number | null;
}

export function simbriefUrl(d: DispatchInput): string {
  const p = new URLSearchParams();
  p.set("airline", d.airline);
  p.set("fltnum", d.fltnum);
  p.set("orig", d.orig);
  p.set("dest", d.dest);
  p.set("type", d.type);
  if (d.callsign) p.set("callsign", d.callsign);
  if (d.dep != null) {
    p.set("deph", String(Math.floor(d.dep / 60)));
    p.set("depm", String(d.dep % 60));
  }
  return `https://dispatch.simbrief.com/options/custom?${p.toString()}`;
}

/** Dispatch for a scheduled flight: the operating airline and its own callsign. */
export function flightDispatch(f: FlightRow, sbType: string): DispatchInput {
  return { airline: f.op, fltnum: fltnum(f), orig: f.o, dest: f.d, type: sbType, callsign: f.cs, dep: plannedOut(f) };
}
