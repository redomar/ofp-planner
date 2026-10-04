/**
 * The finder's query: what the filter bar holds, how it maps to the URL, and how it
 * filters, sorts, groups and rolls the flights. Pure functions, no React.
 */
import { blockTime, familyOf, gcNm, type Block } from "./flight";
import type { Airport, FlightRow } from "./load";

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
}

export const EMPTY_QUERY: Query = { al: [], dep: null, arr: null, types: [], minLen: null, maxLen: null, days: [], text: "" };

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
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p;
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
