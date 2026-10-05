/**
 * The gate screen's settings: which flight, which clock, and what the user has set (delay, gate,
 * status, message). They live in the URL, so a saved OBS browser source reopens the same screen,
 * and a controller tab sends live changes to an open screen window over a BroadcastChannel.
 */
import type { AirlineInfo } from "../data/types";
import type { Airport, FlightRow } from "../data/load";
import { blockTime, flightNo, gcNm } from "../data/flight";
import { MIN, taxiOf, type PhaseKey } from "./board";

export interface GateState {
  /** Snapshot flight id. */
  f: string | null;
  /** UTC date of the departure ("YYYY-MM-DD"); null = the next one. */
  d: string | null;
  /** SimBrief username: the screen shows that pilot's latest OFP instead of a snapshot flight. */
  sb: string | null;
  /**
   * Virtual clock: the real time (ms) at which the screen's STD comes round, so the boarding
   * sequence plays out live. null = real time (the flight's real date).
   */
  stdAt: number | null;
  /** Minutes late (the screen shows a new time from 5). */
  delay: number;
  /** Hold the screen on this step instead of following the clock. */
  pin: PhaseKey | null;
  cancelled: boolean;
  gate: string;
  /** The gate before a gate change, shown as "Gate change: 12 → 14". */
  oldGate: string;
  reg: string;
  msg: string;
  /** Transparent around the screen (for an OBS overlay). */
  overlay: boolean;
  /** Rotate the info strip (weather, flight facts, message). */
  rotate: boolean;
}

export const EMPTY_GATE: GateState = {
  f: null,
  d: null,
  sb: null,
  stdAt: null,
  delay: 0,
  pin: null,
  cancelled: false,
  gate: "",
  oldGate: "",
  reg: "",
  msg: "",
  overlay: false,
  rotate: true,
};

const PINS: PhaseKey[] = ["scheduled", "gate", "boarding", "final", "closed", "ready", "pushback", "lineup", "takeoff", "departed"];
const text = (v: string | null, n: number) => (v ?? "").replace(/[^\p{L}\p{N} .,'!?:&()/+-]/gu, "").slice(0, n);

/** ?f=&d=&sb=&in=25&late=15&pin=boarding&cx=1&gate=12&was=9&reg=G-ABCD&msg=…&ov=1&rot=0 */
export function gateFromParams(q: URLSearchParams, now: number): GateState {
  const vin = q.get("in");
  const late = Number(q.get("late"));
  const pin = q.get("pin") as PhaseKey | null;
  return {
    f: q.get("f") || null,
    d: /^\d{4}-\d{2}-\d{2}$/.test(q.get("d") ?? "") ? q.get("d") : null,
    sb: /^[\w.@-]{1,64}$/.test(q.get("sb") ?? "") ? q.get("sb") : null,
    stdAt: vin != null && /^-?\d{1,4}$/.test(vin) ? Math.floor(now / MIN) * MIN + Number(vin) * MIN : null,
    delay: Number.isFinite(late) ? Math.max(0, Math.min(600, Math.round(late))) : 0,
    pin: pin && PINS.includes(pin) ? pin : null,
    cancelled: q.get("cx") === "1",
    gate: text(q.get("gate"), 6),
    oldGate: text(q.get("was"), 6),
    reg: text(q.get("reg"), 10),
    msg: text(q.get("msg"), 120),
    overlay: q.get("ov") === "1",
    rotate: q.get("rot") !== "0",
  };
}

export function gateToParams(g: GateState, now: number, extra: Record<string, string | null> = {}): URLSearchParams {
  const q = new URLSearchParams();
  const set = (k: string, v: string | null | false | undefined) => v && q.set(k, v);
  set("f", g.sb ? null : g.f);
  set("d", g.sb || g.stdAt != null ? null : g.d);
  set("sb", g.sb);
  if (g.stdAt != null) q.set("in", String(Math.round((g.stdAt - now) / MIN)));
  set("late", g.delay ? String(g.delay) : null);
  set("pin", g.pin);
  set("cx", g.cancelled && "1");
  set("gate", g.gate);
  set("was", g.oldGate);
  set("reg", g.reg);
  set("msg", g.msg);
  set("ov", g.overlay && "1");
  set("rot", !g.rotate && "0");
  for (const [k, v] of Object.entries(extra)) set(k, v);
  return q;
}

/* ---------- what the screen shows, from a snapshot flight or a SimBrief OFP ---------- */

export interface GateFlight {
  source: "snapshot" | "simbrief";
  brand: AirlineInfo | null;
  /** Wordmark text: the brand name, or the OFP's airline code. */
  airline: string;
  flightNo: string;
  callsign: string | null;
  from: Airport;
  to: Airport;
  /** Scheduled off-block, real (ms). */
  stdMs: number;
  /** Delay already in the OFP (est_out − sched_out), min. */
  ofpDelay: number;
  block: number | null;
  taxiOut: number;
  types: string[];
  /** Aircraft name from the OFP ("A320-251N"). */
  typeName: string | null;
  reg: string | null;
  pax: number | null;
  /** Initial cruise altitude (ft). */
  cruiseFt: number | null;
  runway: string | null;
  nm: number | null;
  /** How late the flight usually runs (min), from tracking; null without a schedule. */
  typical: number | null;
}

export function fromSnapshot(f: FlightRow, stdMs: number, airports: Map<string, Airport>, brand: AirlineInfo | null): GateFlight | null {
  const from = airports.get(f.o);
  const to = airports.get(f.d);
  if (!from || !to) return null;
  const nm = Math.round(gcNm(from, to));
  return {
    source: "snapshot",
    brand,
    airline: brand?.name ?? f.al,
    flightNo: flightNo(f, brand?.iata ?? null),
    callsign: f.cs,
    from,
    to,
    stdMs,
    ofpDelay: 0,
    block: blockTime(f, nm)?.min ?? null,
    taxiOut: taxiOf(f),
    types: f.types,
    typeName: null,
    reg: null,
    pax: null,
    cruiseFt: null,
    runway: null,
    nm,
    typical: f.std != null && f.out != null ? ((f.out - f.std + 720 + 1440) % 1440) - 720 : null,
  };
}

/* ---------- SimBrief: the pilot's latest OFP (CORS-enabled, by username) ---------- */

export interface SbOfp {
  airline: string;
  fn: string;
  callsign: string | null;
  o: string;
  d: string;
  oPos: [number, number];
  dPos: [number, number];
  oName: string;
  dName: string;
  schedOut: number;
  estOut: number;
  /** Block (min). */
  block: number | null;
  taxiOut: number | null;
  type: string;
  typeName: string | null;
  reg: string | null;
  pax: number | null;
  cruiseFt: number | null;
  runway: string | null;
  nm: number | null;
  generated: string | null;
}

const hms = (v: unknown) => {
  const m = typeof v === "string" ? v.match(/^(\d+):(\d{2})/) : null;
  return m ? +m[1] * 60 + +m[2] : null;
};
const numOr = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export async function fetchOfp(username: string, signal?: AbortSignal): Promise<SbOfp> {
  const r = await fetch(`https://www.simbrief.com/api/xml.fetcher.php?username=${encodeURIComponent(username)}&json=v2`, { signal });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.fetch?.status?.startsWith?.("Error")) throw new Error(j?.fetch?.status?.replace(/^Error:\s*/, "") || `SimBrief replied ${r.status}`);
  const g = j.general ?? {};
  const t = j.times ?? {};
  const o = j.origin ?? {};
  const d = j.destination ?? {};
  const a = j.aircraft ?? {};
  const schedOut = Date.parse(t.sched_out);
  if (!o.icao_code || !d.icao_code || !Number.isFinite(schedOut)) throw new Error("The OFP has no origin, destination or departure time");
  const estOut = Date.parse(t.est_out);
  return {
    airline: String(g.icao_airline || "").toUpperCase(),
    fn: String(g.flight_number || ""),
    callsign: j.atc?.callsign || null,
    o: o.icao_code,
    d: d.icao_code,
    oPos: [Number(o.pos_lat), Number(o.pos_long)],
    dPos: [Number(d.pos_lat), Number(d.pos_long)],
    oName: o.name || o.icao_code,
    dName: d.name || d.icao_code,
    schedOut,
    estOut: Number.isFinite(estOut) ? estOut : schedOut,
    block: hms(t.sched_block) ?? hms(t.est_block),
    taxiOut: hms(t.taxi_out),
    type: String(a.icaocode || a.icao_code || ""),
    typeName: a.name || null,
    reg: a.reg || null,
    pax: numOr(j.weights?.pax_count),
    cruiseFt: numOr(g.initial_altitude),
    runway: o.plan_rwy || null,
    nm: numOr(g.gc_distance),
    generated: j.params?.time_generated ?? null,
  };
}

/** An OFP as the screen's flight: the brand from its airline code (an operator of a brand counts). */
export function fromOfp(o: SbOfp, airports: Map<string, Airport> | null, airlines: Map<string, AirlineInfo>): GateFlight {
  const brand = o.airline ? ([...airlines.values()].find((a) => a.icao === o.airline || a.operators.includes(o.airline) || a.iata === o.airline) ?? null) : null;
  const ap = (icao: string, pos: [number, number], name: string): Airport =>
    airports?.get(icao) ?? { icao, iata: null, name, city: null, country: null, lat: pos[0], lon: pos[1], elevFt: null, tz: null };
  const from = ap(o.o, o.oPos, o.oName);
  const to = ap(o.d, o.dPos, o.dName);
  return {
    source: "simbrief",
    brand,
    airline: brand?.name ?? (o.airline || "SimBrief"),
    flightNo: o.fn ? `${brand?.iata ?? o.airline} ${o.fn}`.trim() : (o.callsign ?? "—"),
    callsign: o.callsign,
    from,
    to,
    stdMs: o.schedOut,
    ofpDelay: Math.max(0, Math.round((o.estOut - o.schedOut) / MIN)),
    block: o.block,
    taxiOut: o.taxiOut ?? 12,
    types: o.type ? [o.type] : [],
    typeName: o.typeName,
    reg: o.reg,
    pax: o.pax,
    cruiseFt: o.cruiseFt,
    runway: o.runway,
    nm: o.nm ?? Math.round(gcNm(from, to)),
    typical: null,
  };
}

/* ---------- live link between the controls and an open screen window ---------- */

export const channelName = (ch: string) => `ofp-planner:gate:${ch}`;
export type GateMessage = { kind: "state"; state: GateState } | { kind: "hello" };
