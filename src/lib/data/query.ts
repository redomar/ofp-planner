/**
 * The finder's query: what the filter bar holds, how it maps to the URL, and how it
 * filters, sorts, groups and rolls the flights. Pure functions, no React.
 */
import { blockTime, familyOf, gcNm, plannedOut, span, type Block } from "./flight";
import type { Airport, FlightRow } from "./load";
import type { Flight } from "./types";

/** An airport ICAO ("LEMD") or a whole country ("C:ES"). */
export type Place = string;

export interface Query {
  al: string[]; // brand ICAOs; empty = every airline in the snapshot
  dep: Place | null;
  arr: Place | null;
  /** Aircraft families or exact ICAO types; empty = any. */
  types: string[];
  /** Block time range in minutes. */
  minLen: number | null;
  maxLen: number | null;
  /** ISO weekdays; empty = any day. */
  days: number[];
  /** Free text: flight number, callsign, airport. */
  text: string;
  /** Only flights whose `ref` time is at or after this (UTC minutes, same day); null = any time. */
  after: number | null;
  /** Which OOOI time `after` compares against; null = not chosen (compares OUT). */
  ref: Oooi | null;
  /** Prefer the published schedule (STD/STA) over tracked times where both exist. */
  sched: boolean;
}

export type Oooi = "out" | "off" | "on" | "in";
export const OOOI: Oooi[] = ["out", "off", "on", "in"];

/** Typical taxi times (min), used to estimate a missing OOOI time from its neighbour. */
const TAXI_OUT = 12;
const TAXI_IN = 6;
const wrap = (m: number) => ((m % 1440) + 1440) % 1440;

/**
 * A flight's OUT / OFF / ON / IN time (UTC min), pragmatically: the schedule or the tracked
 * median (in the order `sched` asks for), else estimated from the neighbouring time with
 * typical taxi, else from the other end plus block time. null when nothing gives it.
 */
export function oooiTime(f: Flight, ref: Oooi, sched: boolean): number | null {
  const first = <T,>(...v: (T | null | undefined)[]) => v.find((x) => x != null) ?? null;
  const out = sched ? first(f.std, f.out) : first(f.out, f.std);
  const inn = sched ? first(f.sta, f.in) : first(f.in, f.sta);
  switch (ref) {
    case "out":
      return first(out, f.off != null ? wrap(f.off - TAXI_OUT) : null);
    case "off":
      return first(f.off, out != null ? wrap(out + TAXI_OUT) : null);
    case "on":
      return first(f.on, inn != null ? wrap(inn - TAXI_IN) : null);
    case "in":
      return first(inn, f.on != null ? wrap(f.on + TAXI_IN) : null);
  }
}

export const EMPTY_QUERY: Query = { al: [], dep: null, arr: null, types: [], minLen: null, maxLen: null, days: [], text: "", after: null, ref: null, sched: false };

export type SortKey = "flight" | "dep" | "arr" | "std" | "sta" | "block" | "dist" | "type" | "freq";
export interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

/* ---------- URL ---------- */

const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

export function queryFromParams(p: URLSearchParams, fallbackAirlines: string[]): Query {
  const len = p.get("len")?.match(/^(\d*)-(\d*)$/);
  return {
    al: p.has("al") ? list(p.get("al")).map((s) => s.toUpperCase()) : fallbackAirlines,
    dep: p.get("dep")?.toUpperCase() || null,
    arr: p.get("arr")?.toUpperCase() || null,
    types: list(p.get("type")),
    minLen: len?.[1] ? Number(len[1]) : null,
    maxLen: len?.[2] ? Number(len[2]) : null,
    days: list(p.get("days")).map(Number).filter((d) => d >= 1 && d <= 7),
    text: p.get("q") ?? "",
    after: parseClock(p.get("after")),
    ref: (OOOI as string[]).includes(p.get("ref") ?? "") ? (p.get("ref") as Oooi) : null,
    sched: p.get("sched") === "1",
  };
}

export function queryToParams(q: Query, extra: Record<string, string | null> = {}): URLSearchParams {
  const p = new URLSearchParams();
  p.set("al", q.al.join(","));
  if (q.dep) p.set("dep", q.dep);
  if (q.arr) p.set("arr", q.arr);
  if (q.types.length) p.set("type", q.types.join(","));
  if (q.minLen != null || q.maxLen != null) p.set("len", `${q.minLen ?? ""}-${q.maxLen ?? ""}`);
  if (q.days.length) p.set("days", q.days.join(","));
  if (q.text) p.set("q", q.text);
  if (q.after != null) p.set("after", `${String(Math.floor(q.after / 60)).padStart(2, "0")}${String(q.after % 60).padStart(2, "0")}`);
  if (q.ref) p.set("ref", q.ref);
  if (q.sched) p.set("sched", "1");
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p;
}

/** "1803", "18:03", "18.03", "9:5" → minutes; null when it isn't a valid 24 h time. */
export function parseClock(v: string | null | undefined): number | null {
  const m = v?.trim().match(/^(\d{1,2})[:.h]?(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/* ---------- enrichment (distance and block once per flight) ---------- */

export interface Row {
  f: FlightRow;
  nm: number | null;
  block: Block | null;
}

const cache = new WeakMap<FlightRow, Row>();
export function enrich(f: FlightRow, airports: Map<string, Airport> | null): Row {
  const hit = cache.get(f);
  if (hit && (hit.nm != null || !airports)) return hit;
  const a = airports?.get(f.o);
  const b = airports?.get(f.d);
  const nm = a && b ? Math.round(gcNm(a, b)) : null;
  const row = { f, nm, block: blockTime(f, nm) };
  cache.set(f, row);
  return row;
}

/* ---------- filtering ---------- */

export function placeMatches(place: Place | null, icao: string, airports: Map<string, Airport> | null): boolean {
  if (!place) return true;
  if (place.startsWith("C:")) return airports?.get(icao)?.country === place.slice(2);
  return icao === place;
}

function typeMatches(want: string[], types: string[]): boolean {
  if (!want.length) return true;
  return types.some((t) => want.includes(t) || want.includes(familyOf(t)));
}

/** Everything except the airline filter (the dataset already holds only those airlines). */
export function filterRows(rows: Row[], q: Query, airports: Map<string, Airport> | null): Row[] {
  const text = q.text.trim().toUpperCase().replace(/\s+/g, "");
  return rows.filter(({ f, block }) => {
    if (!placeMatches(q.dep, f.o, airports)) return false;
    if (!placeMatches(q.arr, f.d, airports)) return false;
    if (!typeMatches(q.types, f.types)) return false;
    if (q.minLen != null && (block == null || block.min < q.minLen)) return false;
    if (q.maxLen != null && (block == null || block.min > q.maxLen)) return false;
    if (q.days.length && f.days.length && !q.days.some((d) => f.days.includes(d))) return false;
    if (q.after != null) {
      const t = oooiTime(f, q.ref ?? "out", q.sched);
      if (t == null || t < q.after) return false;
    }
    if (text) {
      const n = f.fn ?? "";
      const hay = `${f.al}${n} ${f.op}${n} ${f.cs ?? ""} ${f.o} ${f.d} ${n}`;
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}

/* ---------- sorting ---------- */

const num = (v: number | null | undefined) => (v == null ? Number.POSITIVE_INFINITY : v);
export function sortRows(rows: Row[], s: Sort, airportName: (icao: string) => string): Row[] {
  const k = s.key;
  const val = (r: Row): number | string => {
    switch (k) {
      case "flight":
        return r.f.fn ? `${r.f.al}${r.f.fn.padStart(5, "0")}` : `${r.f.al}~${r.f.cs ?? ""}`;
      case "dep":
        return airportName(r.f.o);
      case "arr":
        return airportName(r.f.d);
      case "std":
        return num(r.f.std ?? r.f.out ?? r.f.off);
      case "sta":
        return num(r.f.sta ?? r.f.in ?? r.f.on);
      case "block":
        return num(r.block?.min);
      case "dist":
        return num(r.nm);
      case "type":
        return r.f.types[0] ?? "~";
      case "freq":
        // most frequent first when ascending; unknown days last
        return r.f.days.length ? 8 - r.f.days.length : 9;
    }
  };
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return c * s.dir;
  });
}

/* ---------- destinations ---------- */

export interface Destination {
  icao: string;
  flights: Row[];
  airlines: string[];
  types: string[];
  /** For each type, the airline that flies it most here (for airline-coloured badges). */
  typeAirline: Record<string, string>;
  nm: number | null;
  /** Shortest and longest block time among its flights. */
  minBlock: number | null;
  maxBlock: number | null;
  /** Departures per week (sum of operating days; unknown days count as daily). */
  weekly: number;
}

/** Groups flights by the free end: destinations when the origin is fixed, else origins. */
export function groupByOtherEnd(rows: Row[], side: "d" | "o"): Destination[] {
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.f[side];
    let l = by.get(k);
    if (!l) by.set(k, (l = []));
    l.push(r);
  }
  return [...by.entries()].map(([icao, flights]) => {
    const blocks = flights.map((r) => r.block?.min).filter((x): x is number => x != null);
    const typeCount = new Map<string, number>();
    const byTypeAl = new Map<string, Map<string, number>>();
    for (const r of flights)
      for (const t of r.f.types) {
        typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
        const m = byTypeAl.get(t) ?? new Map<string, number>();
        m.set(r.f.al, (m.get(r.f.al) ?? 0) + 1);
        byTypeAl.set(t, m);
      }
    const typeAirline: Record<string, string> = {};
    for (const [t, m] of byTypeAl) typeAirline[t] = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return {
      icao,
      flights,
      airlines: [...new Set(flights.map((r) => r.f.al))],
      types: [...typeCount.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
      typeAirline,
      nm: flights[0].nm,
      minBlock: blocks.length ? Math.min(...blocks) : null,
      maxBlock: blocks.length ? Math.max(...blocks) : null,
      weekly: flights.reduce((n, r) => n + (r.f.days.length || 7), 0),
    };
  });
}

/* ---------- random ---------- */

/**
 * A random flight from `rows`. With `spreadByEnd`, every destination (or origin) is
 * equally likely rather than every flight, so a hub's busiest route doesn't dominate a
 * "random destination from X" roll. `avoid` skips the current pick when there's a choice.
 */
export function roll(rows: Row[], opts: { spreadBy?: "d" | "o" | null; avoid?: string | null } = {}): Row | null {
  let pool = rows;
  if (opts.avoid && pool.length > 1) pool = pool.filter((r) => r.f.id !== opts.avoid);
  if (!pool.length) return null;
  if (opts.spreadBy) {
    const ends = [...new Set(pool.map((r) => r.f[opts.spreadBy!]))];
    const avoidEnd = opts.avoid ? rows.find((r) => r.f.id === opts.avoid)?.f[opts.spreadBy] : null;
    const choices = ends.length > 1 && avoidEnd ? ends.filter((e) => e !== avoidEnd) : ends;
    const end = choices[Math.floor(Math.random() * choices.length)];
    pool = pool.filter((r) => r.f[opts.spreadBy!] === end);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---------- next leg ---------- */

/** When the aircraft is on blocks at the destination (UTC min): scheduled, observed IN, or ON plus taxi-in. */
function arrivesAt(f: FlightRow): number | null {
  if (f.sta != null) return f.sta;
  if (f.in != null) return f.in;
  if (f.on != null) return (f.on + 6) % 1440;
  return null;
}

/**
 * An onward flight for `f` among `from` (flights departing f's destination): departing
 * 35 min to 8 h after it arrives, same airline and not straight back first, then any
 * airline that fits the turnaround, then anything from there.
 */
export function pickNextLeg(from: Row[], f: FlightRow, spread: boolean): Row | null {
  const arrive = arrivesAt(f);
  const fits = (r: Row) => {
    const out = plannedOut(r.f);
    if (arrive == null || out == null) return true;
    const gap = span(arrive, out);
    return gap >= 35 && gap <= 8 * 60;
  };
  const pools = [
    from.filter((r) => r.f.al === f.al && fits(r) && r.f.d !== f.o),
    from.filter((r) => r.f.al === f.al && fits(r)),
    from.filter((r) => fits(r)),
    from,
  ];
  const pool = pools.find((p) => p.length) ?? [];
  return roll(pool, { spreadBy: spread ? "d" : null });
}
