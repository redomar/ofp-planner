/**
 * The logbook: flights you've flown, kept in this browser and moved in and out as JSON.
 * Pure helpers (no React) for the file format, import checks and the derived numbers
 * (block and air time, on-time status, landing grade).
 *
 * File format (version 1):
 *   { "schema": "ofp-planner/logbook", "version": 1, "flights": [LogFlight, …] }
 * A bare array of flights is accepted too. Times are "HH:MM" UTC on `date` (the day of OUT);
 * a later time that is smaller than an earlier one has crossed midnight.
 */
import { KEYS, readJSON, writeJSON } from "./storage";

export const LOG_SCHEMA = "ofp-planner/logbook";
export const LOG_VERSION = 1;

export type LogStatus = "early" | "on-time" | "late" | "delayed" | "cancelled";
export const STATUS_LABEL: Record<LogStatus, string> = { early: "Early", "on-time": "On time", late: "Late", delayed: "Delayed", cancelled: "Cancelled" };

export interface LogFlight {
  /** Stable id; imports with the same id replace the earlier entry. */
  id: string;
  /** UTC date of OUT (or of the flight, if no times), YYYY-MM-DD. */
  date: string;
  from: string;
  to: string;
  /** ATC callsign, e.g. "EZY42" or "EWG15BJ". */
  callsign?: string | null;
  /** Flight number as sold, e.g. "U21042". */
  flight?: string | null;
  /** Operator ICAO ("EZY", "EJU"); taken from the callsign when missing. */
  airline?: string | null;
  /** ICAO type ("A20N") and registration. */
  type?: string | null;
  reg?: string | null;
  /** Simulator or platform ("MSFS24", "X-Plane 12", "VATSIM"). */
  sim?: string | null;
  /** Scheduled off-block and on-block, "HH:MM" UTC. */
  std?: string | null;
  sta?: string | null;
  /** OOOI: off-block, take-off, landing, on-block, "HH:MM" UTC. */
  out?: string | null;
  off?: string | null;
  on?: string | null;
  in?: string | null;
  /** Durations in minutes when the times aren't known (e.g. a tracker that lists only flight time). */
  blockMin?: number | null;
  airMin?: number | null;
  /** Touchdown vertical speed in feet per minute (negative), and g. */
  landingFpm?: number | null;
  landingG?: number | null;
  /** As recorded (e.g. by a tracker). Without it, the status comes from the times. */
  status?: LogStatus | null;
  /** The time a tracker shows for the flight, "HH:MM", zone unknown. */
  started?: string | null;
  cruiseFl?: number | null;
  fuelKg?: number | null;
  pax?: number | null;
  /** Where the entry came from ("manual", "volanta", "simbrief"…). */
  source?: string | null;
  notes?: string | null;
}

export interface LogFile {
  schema: typeof LOG_SCHEMA;
  version: number;
  exportedAt?: string;
  flights: LogFlight[];
}

/* ---------- storage ---------- */

export const readLog = () => readJSON<LogFlight[]>(KEYS.logbook, []);
const byDate = (a: LogFlight, b: LogFlight) => b.date.localeCompare(a.date) || (b.out ?? b.started ?? "").localeCompare(a.out ?? a.started ?? "");
export function writeLog(l: LogFlight[]) {
  writeJSON(KEYS.logbook, [...l].sort(byDate));
}
export function saveFlight(f: LogFlight) {
  writeLog([f, ...readLog().filter((x) => x.id !== f.id)]);
}
export function deleteFlight(id: string) {
  writeLog(readLog().filter((x) => x.id !== id));
}

/** Adds imported flights; the same id replaces. Returns how many were new and how many replaced. */
export function mergeFlights(incoming: LogFlight[]): { added: number; updated: number } {
  const cur = new Map(readLog().map((f) => [f.id, f]));
  let added = 0;
  let updated = 0;
  for (const f of incoming) {
    if (cur.has(f.id)) updated++;
    else added++;
    cur.set(f.id, f);
  }
  writeLog([...cur.values()]);
  return { added, updated };
}

export function exportFile(flights: LogFlight[]): LogFile {
  return { schema: LOG_SCHEMA, version: LOG_VERSION, exportedAt: new Date().toISOString(), flights };
}

/* ---------- import ---------- */

const ICAO = /^[A-Z0-9]{4}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = Object.keys(STATUS_LABEL) as LogStatus[];

/** "HH:MM", "H:MM", "HHMM" or an ISO time ("2026-10-07T15:10:00Z") → "HH:MM"; else null. */
export function clockOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const iso = s.match(/T(\d{2}):(\d{2})/);
  const m = iso ?? s.match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const h = +m[1];
  const min = +m[2];
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null;
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(+v) ? +v : null);
const str = (v: unknown, max = 40) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const upper = (v: unknown, max = 12) => str(v, max)?.toUpperCase() ?? null;

export const defaultId = (f: Pick<LogFlight, "date" | "from" | "to" | "callsign" | "flight" | "out" | "started">) =>
  [f.date, f.callsign ?? f.flight ?? "", f.from, f.to, (f.out ?? f.started ?? "").replace(":", "")].filter(Boolean).join("-");

/** Operator ICAO from a callsign ("EZY42" → "EZY"). */
export const airlineOf = (callsign: string | null | undefined) => callsign?.match(/^([A-Z]{3})\d/)?.[1] ?? null;

/** One flight from untrusted JSON, or the reason it was skipped. */
export function cleanFlight(raw: unknown): LogFlight | string {
  if (!raw || typeof raw !== "object") return "not an object";
  const r = raw as Record<string, unknown>;
  const from = upper(r.from, 4);
  const to = upper(r.to, 4);
  const date = typeof r.date === "string" ? r.date.slice(0, 10) : null;
  if (!from || !ICAO.test(from) || !to || !ICAO.test(to)) return "from / to must be ICAO codes";
  if (!date || !DATE.test(date)) return "date must be YYYY-MM-DD";
  const callsign = upper(r.callsign, 10);
  const status = typeof r.status === "string" ? (r.status.toLowerCase().replace(/[\s_]+/g, "-") as LogStatus) : null;
  const fpm = num(r.landingFpm);
  const f: LogFlight = {
    id: "",
    date,
    from,
    to,
    callsign,
    flight: upper(r.flight, 10),
    airline: upper(r.airline, 3) ?? airlineOf(callsign),
    type: upper(r.type, 4),
    reg: upper(r.reg, 10),
    sim: str(r.sim, 24),
    std: clockOf(r.std),
    sta: clockOf(r.sta),
    out: clockOf(r.out),
    off: clockOf(r.off),
    on: clockOf(r.on),
    in: clockOf(r.in),
    blockMin: num(r.blockMin),
    airMin: num(r.airMin),
    landingFpm: fpm == null ? null : -Math.abs(Math.round(fpm)),
    landingG: num(r.landingG),
    status: status && STATUSES.includes(status) ? status : null,
    started: clockOf(r.started),
    cruiseFl: num(r.cruiseFl),
    fuelKg: num(r.fuelKg),
    pax: num(r.pax),
    source: str(r.source, 24),
    notes: str(r.notes, 500),
  };
  f.id = str(r.id, 80) ?? defaultId(f);
  return f;
}

/** Parses a logbook file (or a bare array). Bad entries are skipped and counted. */
export function parseLogFile(text: string): { flights: LogFlight[]; skipped: { index: number; why: string }[] } | { error: string } {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return { error: "This isn't valid JSON." };
  }
  const list = Array.isArray(j) ? j : j && typeof j === "object" && Array.isArray((j as LogFile).flights) ? (j as LogFile).flights : null;
  if (!list) return { error: `Expected { "schema": "${LOG_SCHEMA}", "flights": [...] } or a list of flights.` };
  const flights: LogFlight[] = [];
  const skipped: { index: number; why: string }[] = [];
  list.forEach((raw, index) => {
    const f = cleanFlight(raw);
    if (typeof f === "string") skipped.push({ index, why: f });
    else flights.push(f);
  });
  return { flights, skipped };
}

/* ---------- derived ---------- */

const mins = (t: string | null | undefined) => (t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);
/** b − a in minutes, across midnight when b is earlier on the clock. */
const span = (a: string | null | undefined, b: string | null | undefined) => {
  const x = mins(a);
  const y = mins(b);
  return x == null || y == null ? null : (y - x + 1440) % 1440;
};
/** b − a in minutes, signed, the nearer way round the clock (for delays). */
const diff = (a: string | null | undefined, b: string | null | undefined) => {
  const x = mins(a);
  const y = mins(b);
  if (x == null || y == null) return null;
  const d = (((y - x) % 1440) + 1440) % 1440;
  return d > 720 ? d - 1440 : d;
};

export const blockOf = (f: LogFlight) => span(f.out, f.in) ?? f.blockMin ?? null;
export const airOf = (f: LogFlight) => span(f.off, f.on) ?? f.airMin ?? null;
/** Minutes late off-block / on-block against the schedule (negative = early). */
export const depDelay = (f: LogFlight) => diff(f.std, f.out);
export const arrDelay = (f: LogFlight) => diff(f.sta, f.in);

/** Early / on time / late from the arrival (15 min either side counts as on time); delayed when it left 15+ min late but made it up. */
export function statusOf(f: LogFlight): LogStatus | null {
  if (f.status === "cancelled") return "cancelled";
  const a = arrDelay(f);
  const d = depDelay(f);
  if (a != null) return a < -15 ? "early" : a > 15 ? "late" : d != null && d > 15 ? "delayed" : "on-time";
  if (d != null) return d > 15 ? "delayed" : "on-time";
  return f.status ?? null;
}
export const STATUS_TONE: Record<LogStatus, string> = { early: "b-blue", "on-time": "b-green", late: "b-red", delayed: "b-amber", cancelled: "b-ink" };

/** Landing grade by touchdown rate. */
export function landingGrade(fpm: number | null | undefined): { label: string; tone: string } | null {
  if (fpm == null) return null;
  const v = Math.abs(fpm);
  if (v < 120) return { label: "Butter", tone: "b-green" };
  if (v < 250) return { label: "Smooth", tone: "b-green" };
  if (v < 400) return { label: "Firm", tone: "b-ink" };
  if (v < 600) return { label: "Hard", tone: "b-amber" };
  return { label: "Very hard", tone: "b-red" };
}
