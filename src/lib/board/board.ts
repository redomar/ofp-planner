/**
 * Airport board and gate screen: the weekly timetable turned into real dated movements, and the
 * boarding sequence of one flight against a clock. Pure, no React.
 *
 * The snapshot has no live data. "Expected" times come from how a flight typically runs against
 * its schedule (tracked OUT vs STD, IN vs STA); anything else (a delay, a gate) is the user's.
 */
import { blockTime, gcNm, isoDay, plannedOut, span } from "../data/flight";
import type { Airport, FlightRow } from "../data/load";

export const MIN = 60_000;
const DAY = 1440 * MIN;
const TAXI_OUT = 12;

export type Side = "dep" | "arr";

/** One dated departure or arrival at the board's airport. */
export interface Movement {
  key: string;
  f: FlightRow;
  /** The other end. */
  other: string;
  /** Departure from the origin (ms, UTC): scheduled, else typical. */
  depMs: number;
  /** Time shown on the board (ms): departure for departures, arrival for arrivals. */
  ms: number;
  /** Whether `ms` is a published schedule time (else typical from tracking). */
  sched: boolean;
  /** How late the flight usually runs against that schedule (min, may be negative); null without both. */
  typical: number | null;
  /** Gate-to-gate (min). */
  block: number | null;
}

const lateness = (a: number | null, s: number | null) => (a == null || s == null ? null : ((a - s + 720 + 1440) % 1440) - 720);

/** Midnight UTC of the day containing ms. */
export const dayStart = (ms: number) => ms - (((ms % DAY) + DAY) % DAY);

/** "2026-10-05" for a UTC ms. */
export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whether a flight operates on the UTC day starting at `day0` (unknown days count as daily). */
const operates = (f: FlightRow, day0: number) => !f.days.length || f.days.includes(isoDay(new Date(day0)));

/**
 * Every departure (or arrival) at `icao` from `fromMs` to `toMs`, soonest first. Arrivals are dated
 * by their departure day plus block, so overnight flights land on the right day. A flight seen
 * under two ids at the same minute (same callsign or number) is listed once.
 */
export function movements(flights: FlightRow[], airports: Map<string, Airport> | null, icao: string, side: Side, fromMs: number, toMs: number): Movement[] {
  const out: Movement[] = [];
  const seen = new Set<string>();
  for (const f of flights) {
    if ((side === "dep" ? f.o : f.d) !== icao) continue;
    const dep = plannedOut(f);
    if (dep == null) continue;
    const a = airports?.get(f.o);
    const b = airports?.get(f.d);
    const nm = a && b ? gcNm(a, b) : null;
    const block = blockTime(f, nm)?.min ?? null;
    let arrOff: number | null = null;
    if (side === "arr") {
      const arr = f.sta ?? f.in ?? (f.on != null ? f.on + 6 : null);
      arrOff = arr != null ? span(dep, arr) : block;
      if (arrOff == null) continue;
    }
    for (let d = dayStart(fromMs) - 2 * DAY; d <= toMs; d += DAY) {
      if (!operates(f, d)) continue;
      const depMs = d + dep * MIN;
      const ms = side === "dep" ? depMs : depMs + (arrOff as number) * MIN;
      if (ms < fromMs || ms > toMs) continue;
      const id = `${f.cs ?? `${f.al}${f.fn}`}@${ms}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const sched = side === "dep" ? f.std != null : f.sta != null;
      out.push({
        key: `${f.id}@${ms}`,
        f,
        other: side === "dep" ? f.d : f.o,
        depMs,
        ms,
        sched,
        typical: side === "dep" ? lateness(f.out, f.std) : lateness(f.in, f.sta),
        block,
      });
    }
  }
  return out.sort((x, y) => x.ms - y.ms || x.f.id.localeCompare(y.f.id));
}

/** The next departure of a flight at or after `fromMs` (ms), from its planned off-block. */
export function nextDep(f: FlightRow, fromMs: number): number | null {
  const dep = plannedOut(f);
  if (dep == null) return null;
  for (let d = dayStart(fromMs); d < fromMs + 9 * DAY; d += DAY) {
    const ms = d + dep * MIN;
    if (ms >= fromMs && operates(f, d)) return ms;
  }
  return null;
}

/** Departure of a flight on a given UTC date ("YYYY-MM-DD"), if it runs that day. */
export function depOn(f: FlightRow, date: string): number | null {
  const dep = plannedOut(f);
  const d0 = Date.parse(`${date}T00:00:00Z`);
  if (dep == null || !Number.isFinite(d0) || !operates(f, d0)) return null;
  return d0 + dep * MIN;
}

/* ---------- the boarding sequence ---------- */

export type PhaseKey = "scheduled" | "gate" | "boarding" | "final" | "closed" | "ready" | "pushback" | "lineup" | "takeoff" | "departed";

export interface Phase {
  key: PhaseKey;
  /** On the screen. */
  label: string;
  /** Short, for the board's remarks and the step line. */
  short: string;
  /** Minutes from ETD (off-block) when it starts. */
  at: number;
}

const WIDE = /^(A3[3-5]|A38|B74|B76|B77|B78|A35)/;

/**
 * The gate's steps before and after off-block. Widebodies open the gate and board earlier.
 * Taxi time is the flight's typical OUT→OFF when tracked, else 12 min.
 */
export function phases(types: string[], taxiOut: number): Phase[] {
  const wide = types.some((t) => WIDE.test(t));
  const taxi = Math.max(4, Math.min(40, Math.round(taxiOut)));
  return [
    { key: "scheduled", label: "On time", short: "On time", at: -Infinity },
    { key: "gate", label: "Go to gate", short: "Gate open", at: wide ? -75 : -50 },
    { key: "boarding", label: "Boarding", short: "Boarding", at: wide ? -50 : -35 },
    { key: "final", label: "Final call", short: "Final call", at: -20 },
    { key: "closed", label: "Gate closed", short: "Gate closed", at: -15 },
    { key: "ready", label: "Ready for pushback", short: "Ready", at: -4 },
    { key: "pushback", label: "Pushback · taxiing", short: "Pushback", at: 0 },
    { key: "lineup", label: "Lining up", short: "Line up", at: taxi - 2 },
    { key: "takeoff", label: "Take-off", short: "Take-off", at: taxi },
    { key: "departed", label: "Departed", short: "Departed", at: taxi + 8 },
  ];
}

/** Typical taxi-out of a flight (min). */
export const taxiOf = (f: FlightRow | null) => (f && f.out != null && f.off != null ? span(f.out, f.off) || TAXI_OUT : TAXI_OUT);

/** The step a flight is at, `minToEtd` minutes before off-block (negative = after). */
export function phaseAt(ps: Phase[], minToEtd: number): Phase {
  const t = -minToEtd;
  let cur = ps[0];
  for (const p of ps) if (t >= p.at) cur = p;
  return cur;
}

/** Remarks for a board row at `now`, from the typical time (no user delay on the board). */
export function remark(m: Movement, side: Side, now: number, fmt: (ms: number) => string): { text: string; tone: "plain" | "go" | "warn" | "done" } {
  const late = m.typical != null && m.sched && m.typical >= 10 ? m.typical : 0;
  const t = m.ms + late * MIN;
  if (side === "arr") {
    if (now >= t) return { text: "Landed", tone: "done" };
    if (now >= t - 25 * MIN) return { text: "Approaching", tone: "go" };
    return late ? { text: `Expected ${fmt(t)}`, tone: "warn" } : { text: "On time", tone: "plain" };
  }
  const p = phaseAt(phases(m.f.types, taxiOf(m.f)), (t - now) / MIN);
  if (p.key === "scheduled") return late ? { text: `Expected ${fmt(t)}`, tone: "warn" } : { text: "On time", tone: "plain" };
  if (p.key === "gate" || p.key === "boarding" || p.key === "final") return { text: p.short, tone: "go" };
  if (p.key === "closed" || p.key === "ready") return { text: "Gate closed", tone: "warn" };
  return { text: "Departed", tone: "done" };
}
