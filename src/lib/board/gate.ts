/**
 * The gate screen's settings: which flight, which clock, and what the user has set (delay, gate,
 * status, message). They live in the URL, so a saved OBS browser source reopens the same screen,
 * and a controller tab sends live changes to an open screen window over a BroadcastChannel.
 */
import type { AirlineInfo } from "../data/types";
import type { Airport, FlightRow } from "../data/load";
import { blockTime, flightNo, gcNm } from "../data/flight";
import { MIN, taxiOf, type PhaseKey } from "./board";
import type { FlightPlan, PlanLeg, ViewStage } from "../feed/core";
import { layers, turnsFrom, turnsOf, turnsTo, type Layers, type ShownView, type Turns } from "./looks";
import { goParam } from "./countdown";

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
  /** 1.13: the airline's name and its code in the flight number as shown, over the data's (Wizz Air Malta, not "Wizz Air"); empty = the data's. */
  an: string;
  ac: string;
  msg: string;
  /** Transparent around the screen (for an OBS overlay). */
  overlay: boolean;
  /** Rotate the info strip (weather, flight facts, message). */
  rotate: boolean;
  /**
   * 1.9: which view of the screen: "auto" follows the aircraft (stages, scenes); anything else is
   * one look (or layers) as a token, "full" by default. 1.12: any look token ("card.s.bl").
   */
  view: string;
  /** view=auto: what shows at each stage of the flight (up to three looks stacked). */
  stages: StageTurns;
  /**
   * view=auto in a named OBS scene (any case): that scene's own looks at each stage, e.g. BRB is the
   * frame whatever the aircraft does. Any other scene uses `stages`.
   */
  scenes: SceneRule[];
  /** Hold the screen on this stage whatever the aircraft does (when the detection gets it wrong). */
  hold: ViewStage | null;
  /**
   * 1.13: the countdown to the stream's start (view "countdown"), as written in the URL: "5m" from
   * when the page loaded, "19:30" (this PC's time) or "19:30Z", "std-30" from the flight's off-block;
   * several joined by commas, the first that gives a time wins. URL only: never relayed by OFP Tower.
   */
  go: string | null;
  /** When the page read `go` (the start of a "5m"). */
  goFrom: number;
  /** 1.13: the ending screen's sign-off line; empty = the default. URL only. */
  bye: string;
  /**
   * 1.15: where the flight comes from, pinned: "fms" the aircraft's FMS (OFP Tower), "ofp" the
   * SimBrief OFP, "tt" the timetable flight (f=), "vatsim" another pilot's filed plan. Null = Auto,
   * the order before 1.15 (OFP, then timetable, then the FMS or the watched pilot's plan).
   */
  fs: FlightSource | null;
  /** 1.15: the airline code the names (an, ac) were given for; they show only on its flights. Empty = any flight (as before). */
  anf: string;
}

export type FlightSource = "fms" | "ofp" | "tt" | "vatsim";
export const FLIGHT_SOURCES: FlightSource[] = ["fms", "ofp", "tt", "vatsim"];

export type { ShownView } from "./looks";
/** 1.14: what each stage shows, one look or a rotation. */
export type StageTurns = Record<ViewStage, Turns>;
export type SceneRule = [string, StageTurns];
const asTurns = (v: ShownView | Layers | Turns): Turns => (typeof v === "string" ? turnsOf(layers(v)) : "alts" in (v[0] as object) ? (v as Turns) : turnsOf(v as Layers));
export const allStages = (v: ShownView | Layers | Turns): StageTurns => {
  const t = asTurns(v);
  return { ready: t, taxi: t, climb: t, cruise: t, approaching: t, arrived: t };
};
export const STAGES: ViewStage[] = ["ready", "taxi", "climb", "cruise", "approaching", "arrived"];
/** Ready, taxi, flying (the climb and the cruise), approaching, arrived. */
const byStage = (r: ShownView, t: ShownView, f: ShownView | Turns, a: ShownView, d: ShownView): StageTurns => ({
  ready: asTurns(r),
  taxi: asTurns(t),
  climb: asTurns(f),
  cruise: asTurns(f),
  approaching: asTurns(a),
  arrived: asTurns(d),
});
/** Sheet 07: the full screen on the ground, the strip while flying. */
export const DEFAULT_STAGES: StageTurns = byStage("full", "full", "strip", "strip", "full");
/** 1.14: the owner's flow: the pill with the phase, now and then the map corner with something to read, the strip. */
const PILLS_TURN: Turns = turnsFrom("line@240>g6a1.mr|g6b.mr.bn.bo|g6a3.mr|g6b.mr.bp.bo@30>strip@120")!;
/** Sheet 07: the scene names that turn the same source into the frame, the map or the card. */
export const DEFAULT_SCENES: SceneRule[] = [
  ["BRB", allStages("frame")],
  ["Map", allStages("map")],
  ["Camera", allStages("card")],
];
/** Starting points for a scene (the Stream studio's "Start from"). */
export const PRESETS: { name: string; note: string; stages: StageTurns }[] = [
  { name: "Classic", note: "the gate screen on the ground, the strip while flying", stages: DEFAULT_STAGES },
  { name: "Mostly sim", note: "the strip at the gate, the pill from push-back, the strip at the gate again", stages: byStage("strip", "pill", "pill", "pill", "strip") },
  { name: "Minimal", note: "just the pill, all flight", stages: allStages("pill") },
  { name: "Map", note: "the moving map all flight, full screen at the gates", stages: byStage("full", "corner", "map", "map", "full") },
  { name: "Route", note: "the map corner with legs, flipping in cruise", stages: byStage("frame", "g6a1", "g6b", "g6a1", "frame") },
  {
    name: "Pills, map now and then",
    note: "the pill with the phase; every 4 min the map corner with the legs, the numbers, the next fix or the plan for 30 s, then the strip for 2 min",
    stages: { ...byStage("strip", "line", PILLS_TURN, "line", "strip"), climb: asTurns("line") },
  },
];

/** The view param: "auto", or a look token (layers too; 1.14 a rotation); anything else is the full screen. */
export const viewFrom = (v: string | null) => (v === "auto" ? "auto" : v && turnsFrom(v) ? v : "full");

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
  an: "",
  ac: "",
  msg: "",
  overlay: false,
  rotate: true,
  view: "full",
  stages: DEFAULT_STAGES,
  scenes: DEFAULT_SCENES,
  hold: null,
  go: null,
  goFrom: 0,
  bye: "",
  fs: null,
  anf: "",
};

const PINS: PhaseKey[] = ["scheduled", "gate", "boarding", "final", "closed", "ready", "pushback", "lineup", "takeoff", "departed"];
const text = (v: string | null, n: number) => (v ?? "").replace(/[^\p{L}\p{N} .,'!?:&()/+-]/gu, "").slice(0, n);

/**
 * Looks per stage, each a look token (layers joined by ~) or a rotation (1.14, steps joined by >):
 * "a,b,c,d,e,f" ready, taxi, climb, cruise, approaching, arrived (1.14); "a,b,c,d,e" with one for
 * flying, climb and cruise alike (1.11); "a,b,c,d" before 1.11, approaching as flying. Null when
 * it isn't one of those.
 */
export function stagesOf(parts: string[]): StageTurns | null {
  const ls = parts.map(turnsFrom);
  if (ls.some((x) => x == null)) return null;
  const [a, b, c, d, e, f] = ls as Turns[];
  if (parts.length === 4) return { ready: a, taxi: b, climb: c, cruise: c, approaching: c, arrived: d };
  if (parts.length === 5) return { ready: a, taxi: b, climb: c, cruise: c, approaching: d, arrived: e };
  if (parts.length === 6) return { ready: a, taxi: b, climb: c, cruise: d, approaching: e, arrived: f };
  return null;
}
/**
 * The other way, as short as reads the same, so screens from before still read what they can: four
 * while the climb, the cruise and approaching are one; five while the climb and cruise are; else six.
 */
export const stagesText = (v: StageTurns) => {
  const t = (k: ViewStage) => turnsTo(v[k]);
  if (t("climb") !== t("cruise")) return STAGES.map(t).join(",");
  const five = [t("ready"), t("taxi"), t("cruise"), t("approaching"), t("arrived")];
  return (five[3] === five[2] ? [five[0], five[1], five[2], five[4]] : five).join(",");
};

/** st=full,full,strip,strip,full: the looks at each stage. */
function stagesFrom(v: string | null): StageTurns {
  return stagesOf((v ?? "").split(",")) ?? DEFAULT_STAGES;
}
/**
 * sc=BRB:frame;Map:map;Flying:strip,pill,pill,full ("-" or empty = no rules): scene names and their
 * looks, one for the whole flight or one per stage.
 */
function scenesFrom(v: string | null): SceneRule[] {
  if (v == null) return DEFAULT_SCENES;
  if (v === "-" || v === "") return [];
  const out: SceneRule[] = [];
  for (const part of v.split(";").slice(0, 8)) {
    const i = part.lastIndexOf(":");
    const name = text(part.slice(0, i), 40).trim();
    const views = part.slice(i + 1).split(",");
    if (!name) continue;
    if (views.length === 1) {
      const one = turnsFrom(views[0]);
      if (one) out.push([name, allStages(one)]);
    } else {
      const st = stagesOf(views);
      if (st) out.push([name, st]);
    }
  }
  return out;
}
const scenesTo = (sc: SceneRule[]) =>
  sc
    .map(([n, v]) => {
      const vs = STAGES.map((k) => turnsTo(v[k]));
      return `${n.replace(/[;:,]/g, "")}:${vs.every((x) => x === vs[0]) ? vs[0] : stagesText(v)}`;
    })
    .join(";");

/** hold=cruise; "flying" from before 1.14 holds the cruise. */
const holdFrom = (v: string | null): ViewStage | null => (v === "flying" ? "cruise" : STAGES.includes(v as ViewStage) ? (v as ViewStage) : null);

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
    an: text(q.get("an"), 40),
    ac: /^[A-Z0-9]{2,3}$/.test((q.get("ac") ?? "").toUpperCase()) ? (q.get("ac") ?? "").toUpperCase() : "",
    msg: text(q.get("msg"), 120),
    overlay: q.get("ov") === "1",
    rotate: q.get("rot") !== "0",
    view: viewFrom(q.get("view")),
    stages: stagesFrom(q.get("st")),
    scenes: scenesFrom(q.get("sc")),
    hold: holdFrom(q.get("hold")),
    go: goParam(q.get("go")),
    goFrom: now,
    bye: text(q.get("bye"), 140),
    fs: FLIGHT_SOURCES.includes(q.get("fs") as FlightSource) ? (q.get("fs") as FlightSource) : null,
    anf: /^[A-Z0-9]{2,4}$/.test((q.get("anf") ?? "").toUpperCase()) ? (q.get("anf") ?? "").toUpperCase() : "",
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
  set("an", g.an);
  set("ac", g.ac);
  set("anf", (g.an || g.ac) && g.anf);
  set("msg", g.msg);
  set("ov", g.overlay && "1");
  set("rot", !g.rotate && "0");
  set("view", g.view !== "full" && g.view);
  const st = stagesText(g.stages);
  set("st", st !== stagesText(DEFAULT_STAGES) && st);
  const sc = scenesTo(g.scenes);
  set("sc", sc !== scenesTo(DEFAULT_SCENES) && (sc || "-"));
  set("hold", g.hold);
  set("go", g.go);
  set("bye", g.bye);
  set("fs", g.fs);
  for (const [k, v] of Object.entries(extra)) set(k, v);
  return q;
}

/**
 * The Stream settings a panel relays to the screens (OBS) through OFP Tower: always complete, with
 * the stage table and the scenes written out even at their defaults, so a screen can tell a real
 * message from an empty or partial one (those keep the screen's own URL settings).
 */
export function streamSettingsQuery(g: GateState, who: string | null = null): string {
  const q = new URLSearchParams();
  q.set("st", stagesText(g.stages));
  q.set("sc", scenesTo(g.scenes) || "-");
  if (g.hold) q.set("hold", g.hold);
  if (g.delay) q.set("late", String(g.delay));
  if (g.cancelled) q.set("cx", "1");
  if (g.gate) q.set("gate", g.gate);
  if (g.oldGate) q.set("was", g.oldGate);
  if (g.reg) q.set("reg", g.reg);
  if (g.an) q.set("an", g.an);
  if (g.ac) q.set("ac", g.ac);
  if (g.msg) q.set("msg", g.msg);
  if (!g.rotate) q.set("rot", "0");
  // 1.15: the sign-off, the pinned flight source and the names' airline; "sv=2" says they're in it
  // (absent = empty), so a message from an older page (OFP Tower keeps the last one) leaves them be
  q.set("sv", "2");
  if ((g.an || g.ac) && g.anf) q.set("anf", g.anf);
  if (g.bye) q.set("bye", g.bye);
  if (g.fs) q.set("fs", g.fs);
  // the VATSIM callsign the board uses (a watched pilot, or the owner's own for the position)
  if (who) q.set("who", who);
  return q.toString();
}

export type StreamSettings = Pick<GateState, "stages" | "scenes" | "hold" | "delay" | "cancelled" | "gate" | "oldGate" | "reg" | "an" | "ac" | "msg" | "rotate"> & Partial<Pick<GateState, "bye" | "fs" | "anf">>;

/** A relayed settings query, or null when it isn't complete (no stage table: an old, empty or partial message). */
export function streamSettingsFrom(q: string, now: number): StreamSettings | null {
  const p = new URLSearchParams(q);
  if (!p.get("st") || !p.get("sc")) return null;
  const s = gateFromParams(p, now);
  const base = { stages: s.stages, scenes: s.scenes, hold: s.hold, delay: s.delay, cancelled: s.cancelled, gate: s.gate, oldGate: s.oldGate, reg: s.reg, an: s.an, ac: s.ac, msg: s.msg, rotate: s.rotate };
  return p.get("sv") === "2" ? { ...base, bye: s.bye, fs: s.fs, anf: s.anf } : base;
}

/* ---------- what the screen shows, from a snapshot flight or a SimBrief OFP ---------- */

export interface GateFlight {
  /** fms: built from the route in the aircraft's FMS (OFP Tower), with no schedule. */
  source: "snapshot" | "simbrief" | "fms";
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
  /** The OFP's route, fix by fix (SimBrief only): the route panel's fixes without an FMS plan. */
  route?: RouteFix[];
}

export interface RouteFix {
  id: string;
  lat: number;
  lon: number;
  via: string | null;
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
  route: RouteFix[];
}

const hms = (v: unknown) => {
  const m = typeof v === "string" ? v.match(/^(\d+):(\d{2})/) : null;
  return m ? +m[1] * 60 + +m[2] : null;
};
const numOr = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** The OFP's navlog as fixes: no TOC/TOD and other calculated points, no airports. */
function navlogOf(v: unknown): RouteFix[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return list.slice(0, 400).flatMap((raw) => {
    const x = raw as Record<string, unknown>;
    const lat = numOr(x.pos_lat);
    const lon = numOr(x.pos_long);
    const id = typeof x.ident === "string" ? x.ident.trim().slice(0, 12) : "";
    if (lat == null || lon == null || (Math.abs(lat) < 1e-4 && Math.abs(lon) < 1e-4) || !id || x.type === "ltlg" || x.type === "apt" || /^(TOC|TOD)$/.test(id)) return [];
    const via = typeof x.via_airway === "string" && x.via_airway && x.via_airway !== "DCT" ? x.via_airway.slice(0, 12) : null;
    return [{ id, lat, lon, via }];
  });
}

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
    route: navlogOf(j.navlog?.fix),
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
    route: o.route ?? [],
  };
}

/**
 * The flight from the aircraft's FMS (OFP Tower with a Fenix) when no Finder flight or OFP is
 * loaded: its ends, flight number and cruise level as programmed. It has no schedule, so the
 * screen shows no scheduled or arrival times; `seenAt` (when the plan first came) stands in for
 * the off-block time the screen's clock needs.
 */
export function fromPlan(p: FlightPlan, seenAt: number, airports: Map<string, Airport> | null, airlines: Map<string, AirlineInfo>): GateFlight {
  const legs = p.legs.filter((l) => !l.missed);
  const ap = (code: string, leg: PlanLeg | undefined): Airport =>
    airports?.get(code) ?? { icao: code, iata: null, name: code, city: null, country: null, lat: leg?.lat ?? 0, lon: leg?.lon ?? 0, elevFt: null, tz: null };
  const from = ap(p.origin, legs[0]);
  const to = ap(p.destination, legs[legs.length - 1]);
  // an airline from the flight number's letters (SWR457 → SWISS), if it's one we know
  const prefix = p.flightNumber?.match(/^([A-Z]{3})\d/)?.[1] ?? null;
  const brand = prefix ? ([...airlines.values()].find((a) => a.icao === prefix || a.operators.includes(prefix)) ?? null) : null;
  let nm = 0;
  for (let i = 1; i < legs.length; i++) nm += gcNm(legs[i - 1], legs[i]);
  return {
    source: "fms",
    brand,
    airline: brand?.name ?? "",
    flightNo: p.flightNumber ?? `${p.origin}–${p.destination}`,
    callsign: p.flightNumber,
    from,
    to,
    stdMs: seenAt,
    ofpDelay: 0,
    block: null,
    taxiOut: 12,
    types: [],
    typeName: null,
    reg: null,
    pax: null,
    cruiseFt: p.cruiseFt,
    runway: null,
    nm: Math.round(nm) || Math.round(gcNm(from, to)),
    typical: null,
  };
}

/* ---------- live link between the controls and an open screen window ---------- */

export const channelName = (ch: string) => `ofp-planner:gate:${ch}`;
export type GateMessage = { kind: "state"; state: GateState } | { kind: "hello" };
