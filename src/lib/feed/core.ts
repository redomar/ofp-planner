/**
 * The gate screen's live feed, the part without React or the network: one message shape for every
 * source (OFP Tower, a recorded flight, VATSIM), the reader for recorded flights, and the phase
 * detector that turns samples into what the screen says (the rules table on the 1.9 design sheet
 * 05, to be tuned on the sim PC).
 *
 * This file imports nothing, so scripts/verify.mjs can load it straight into Node and feed it a
 * recorded flight.
 */

/** One reading from the aircraft. Anything a source can't tell is null. */
export interface FeedSample {
  /** UTC time of the reading in sim time (ms). */
  t: number;
  lat: number;
  lon: number;
  /** True altitude (ft above sea level): for the map and heights above an airport, not for flight levels. */
  alt: number;
  /** Pressure altitude (ft, on 1013 hPa / 29.92): flight levels. OFP Tower from the sim; null elsewhere. */
  pressAlt: number | null;
  /** What the altimeter shows on the baro set (ft): altitudes below the transition. */
  indAlt: number | null;
  /** Ground speed (kt). */
  gs: number;
  /** Heading (deg true). */
  hdg: number | null;
  /** Vertical speed (ft/min). */
  vs: number | null;
  onGround: boolean | null;
  parkBrake: boolean | null;
  /** One entry per engine: running. */
  engines: boolean[] | null;
  beacon: boolean | null;
  /** Door positions (0 shut … 100 open). */
  doors: number[] | null;
  seatbelts: boolean | null;
  noSmoking: "off" | "auto" | "on" | null;
  /** Touchdown rate (ft/min, negative = down), only on the reading where the wheels touch. */
  landingRate: number | null;
  /** The sim's own latched touchdown velocity (ft/min, negative), kept for the record. */
  tdSim: number | null;
  /** 1.11, OFP Tower only (null elsewhere): magnetic heading and ground track (deg). */
  hdgMag?: number | null;
  trk?: number | null;
  /** Indicated airspeed (kt) and Mach. */
  ias?: number | null;
  mach?: number | null;
  /** The wind where the aircraft is: [from deg, kt]. */
  wind?: [number, number] | null;
  /** Fuel on board (kg) and the total fuel flow (kg/h). */
  fobKg?: number | null;
  ffKgH?: number | null;
  /** G load (OFP Tower). */
  g?: number | null;
  /** Each wheel contact OFP Tower saw since this reading's last (n = 1 the landing, 2+ bounces; resets above 200 ft). */
  touchdowns?: { n: number; bounce: boolean; landingRate: number | null }[] | null;
  /** The peak G of the landing (contact n), sent a couple of seconds after it. */
  tdPeakG?: { n: number; peakG: number } | null;
}

/**
 * A real position: in range, and not 0,0 ("null island"), which the sim reports while loading and
 * the FMS gives an entry it hasn't resolved yet (the origin before a runway, a typed ident).
 */
export function realPos(lat: number, lon: number): boolean {
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(Math.abs(lat) < 1e-4 && Math.abs(lon) < 1e-4);
}

/** [deg, kt] from a two-number array, else null. */
function windOf(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const d = num(v[0]);
  const k = num(v[1]);
  return d != null && k != null && k >= 0 && k < 400 ? [((d % 360) + 360) % 360, k] : null;
}

export type FeedSource = "link" | "replay" | "vatsim" | "clock";

/* ---------- recorded flights (OFP Tower recorder, .jsonl) ---------- */

export interface Recording {
  version: number;
  title: string | null;
  atcId: string | null;
  samples: FeedSample[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const tri = (v: unknown): FeedSample["noSmoking"] => (v === "off" || v === "on" ? v : v === "auto" || v === "arm" ? "auto" : null);
const down = (v: number | null) => (v == null ? null : -Math.abs(v));

/**
 * One reading in the shared shape from a recorder line or an OFP Tower message (same field names).
 * Version 1 recordings: parking brake unknown, "td" is the sim's touchdown velocity.
 */
export function toSample(r: Record<string, unknown>, t: number, version = 2): FeedSample | null {
  const lat = num(r.lat);
  const lon = num(r.lon);
  if (lat == null || lon == null || !realPos(lat, lon)) return null;
  return {
    t,
    lat,
    lon,
    alt: num(r.alt) ?? 0,
    pressAlt: num(r.pressAlt),
    indAlt: num(r.indAlt),
    gs: num(r.gs) ?? 0,
    hdg: num(r.hdg),
    vs: num(r.vs),
    onGround: bool(r.onGround),
    parkBrake: version === 1 ? null : bool(r.parkBrake),
    engines: Array.isArray(r.engines) ? r.engines.map(Boolean) : null,
    beacon: bool(r.beacon),
    doors: Array.isArray(r.doors) ? r.doors.map((d: unknown) => num(d) ?? 0) : null,
    seatbelts: bool(r.seatbelts),
    noSmoking: tri(r.noSmoking),
    landingRate: version === 1 ? null : num(r.landingRate),
    tdSim: version === 1 ? down(num(r.td)) : num(r.tdSim),
    hdgMag: num(r.hdgMag),
    trk: num(r.trk),
    ias: num(r.ias),
    mach: num(r.mach),
    wind: windOf(r.wind),
    fobKg: num(r.fobKg),
    ffKgH: num(r.ffKgH),
    g: num(r.g),
    touchdowns: Array.isArray(r.touchdowns)
      ? r.touchdowns.slice(0, 10).flatMap((x: Record<string, unknown>) => {
          const n = num(x?.n);
          return n != null && n >= 1 ? [{ n, bounce: x.bounce === true || n > 1, landingRate: num(x.landingRate) }] : [];
        })
      : null,
    tdPeakG: (() => {
      const p = r.tdPeakG as Record<string, unknown> | undefined;
      const n = p ? num(p.n) : null;
      const g = p ? num(p.peakG) : null;
      return n != null && g != null && g > 0 && g < 10 ? { n, peakG: g } : null;
    })(),
  };
}

/* ---------- the flight plan from the aircraft's FMS (OFP Tower, Fenix only for now) ---------- */

export interface PlanLeg {
  id: string;
  lat: number;
  lon: number;
  via: string | null;
  kind: string | null;
  /** overfly (Δ), turnLeft (←), turnRight (→) */
  flags: string[];
  /** The altitude constraint as the MCDU shows it ("+6000" at or above, "-" at or below, else at). */
  alt: { ft: number; type: "at" | "atOrAbove" | "atOrBelow"; text: string } | null;
  /** An altitude-terminated leg ("3000"): a point on the line, not a fix to name. */
  pseudo: boolean;
  /** After the destination runway: the missed approach. */
  missed: boolean;
  /** The turn at this fix as OFP Tower works it out (about 25° bank): fly-by turns start leadNm early, fly-overs swing outside. */
  turn: { style: "flyby" | "flyover"; radiusNm: number; leadNm: number | null } | null;
  /** The FMS's predicted time over the fix, "hh:mm" UTC (1.11). */
  eta: string | null;
  /** The FMS's wind at the fix, [from deg, kt], where it has one. */
  wind: [number, number] | null;
  /** Already flown: OFP Tower keeps the fixes the Fenix drops as it passes them. */
  passed: boolean;
}

export interface FlightPlan {
  source: string;
  origin: string;
  destination: string;
  alternate: string | null;
  flightNumber: string | null;
  cruiseFt: number | null;
  phase: string | null;
  legs: PlanLeg[];
  /** Departure and arrival runways as display lines (OFP Tower: threshold + 5 km along the course, stylised, not true length). */
  runways: { role: "departure" | "arrival"; airport: string; runway: string; start: [number, number]; end: [number, number] }[];
  /** Which legs are the last fix passed and the one flown to (1.11; the Fenix drops passed fixes, so from 0, to 1). */
  active: { from: number; to: number } | null;
  vSpeeds: { v1: number | null; vr: number | null; v2: number | null; vapp: number | null } | null;
}

const icao = (v: unknown) => (typeof v === "string" && /^[A-Z0-9]{4}$/.test(v) ? v : null);
const txt = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

function turnOf(v: unknown): PlanLeg["turn"] {
  const t = v as Record<string, unknown> | null | undefined;
  const r = t ? num(t.radiusNm) : null;
  if (!t || r == null || r <= 0 || r > 10) return null;
  const lead = num(t.leadNm);
  return { style: t.style === "flyover" ? "flyover" : "flyby", radiusNm: r, leadNm: lead != null && lead >= 0 && lead < 20 ? lead : null };
}

function activeOf(v: unknown, n: number): FlightPlan["active"] {
  const a = v as Record<string, unknown> | null | undefined;
  const from = a ? num(a.from) : null;
  const to = a ? num(a.to) : null;
  return from != null && to != null && Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to > from && to < n ? { from, to } : null;
}

function vSpeedsOf(v: unknown): FlightPlan["vSpeeds"] {
  const a = v as Record<string, unknown> | null | undefined;
  if (!a) return null;
  const k = (x: unknown) => {
    const n = num(x);
    return n != null && n > 60 && n < 250 ? Math.round(n) : null;
  };
  const out = { v1: k(a.v1), vr: k(a.vr), v2: k(a.v2), vapp: k(a.vapp) };
  return Object.values(out).some((x) => x != null) ? out : null;
}

/** A "plan" message from OFP Tower, checked field by field; null when it has no origin or destination. */
export function toPlan(m: Record<string, unknown>): FlightPlan | null {
  const origin = icao(m.origin);
  const destination = icao(m.destination);
  if (!origin || !destination) return null;
  const legs: PlanLeg[] = [];
  for (const raw of Array.isArray(m.legs) ? m.legs.slice(0, 200) : []) {
    const l = raw as Record<string, unknown>;
    const lat = num(l.lat);
    const lon = num(l.lon);
    if (lat == null || lon == null || !realPos(lat, lon)) continue;
    const a = l.altConstraint as Record<string, unknown> | undefined;
    const ft = a ? num(a.alt) : null;
    const type = a?.type === "atOrAbove" || a?.type === "atOrBelow" ? a.type : "at";
    legs.push({
      id: txt(l.id, 12) ?? "",
      lat,
      lon,
      via: txt(l.via, 12),
      kind: txt(l.kind, 24),
      flags: Array.isArray(l.flags) ? l.flags.filter((x): x is string => x === "overfly" || x === "turnLeft" || x === "turnRight") : [],
      alt: ft != null ? { ft, type, text: txt(a?.text, 10) ?? String(ft) } : null,
      pseudo: l.pseudo === true,
      missed: l.missed === true,
      turn: turnOf(l.turn),
      eta: typeof l.eta === "string" && /^\d{2}:\d{2}$/.test(l.eta) ? l.eta : null,
      wind: windOf(l.wind),
      passed: l.passed === true,
    });
  }
  return {
    source: txt(m.source, 24) ?? "fms",
    origin,
    destination,
    alternate: icao(m.alternate),
    flightNumber: txt(m.flightNumber, 10)?.toUpperCase() ?? null,
    cruiseFt: num(m.cruiseLevel),
    phase: txt(m.phase, 24),
    legs,
    active: activeOf(m.active, legs.length),
    vSpeeds: vSpeedsOf(m.vSpeeds),
    runways: (Array.isArray(m.runways) ? m.runways.slice(0, 4) : []).flatMap((raw) => {
      const r = raw as Record<string, Record<string, unknown> | unknown>;
      const a = r.start as Record<string, unknown> | undefined;
      const b = r.end as Record<string, unknown> | undefined;
      const pt = (p?: Record<string, unknown>): [number, number] | null => {
        const lat = p ? num(p.lat) : null;
        const lon = p ? num(p.lon) : null;
        return lat != null && lon != null && realPos(lat, lon) ? [lon, lat] : null;
      };
      const s0 = pt(a);
      const e0 = pt(b);
      if (!s0 || !e0) return [];
      return [{ role: r.role === "departure" ? ("departure" as const) : ("arrival" as const), airport: icao(r.airport) ?? "", runway: txt(r.runway, 4) ?? "", start: s0, end: e0 }];
    }),
  };
}

/**
 * A recording as text, one JSON object per line: a header ({"v":1|2,"kind":"ofp-recording",
 * "started":ms,…}), then one reading per second. Times come from the sim clock (zulu, seconds of
 * the UTC day), not the wall clock, so a flight flown at 4x replays in sim time.
 *
 * Version 1 files have two known faults, corrected here: every value lags its line by one reading
 * (shifted back one line), and the parking brake isn't trustworthy (read as unknown). Their "td" is
 * the sim's latched touchdown velocity (positive), kept as tdSim.
 */
export function parseRecording(text: string): Recording {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = JSON.parse(lines[0] ?? "{}");
  if (head.kind !== "ofp-recording") throw new Error("Not an OFP Planner recording");
  const version = num(head.v) ?? 1;
  const started = num(head.started) ?? 0;
  const day = started - (started % 86_400_000);
  const rows = lines.slice(1).map((l) => JSON.parse(l));
  const raw = version === 1 ? rows.slice(1).map((r, i) => ({ ...r, t: rows[i].t, zulu: rows[i].zulu })) : rows;
  let lastZ = -1;
  let wraps = 0;
  const samples: FeedSample[] = [];
  for (const r of raw) {
    const z = num(r.zulu);
    if (z != null && lastZ >= 0 && z < lastZ - 43_200) wraps++;
    if (z != null) lastZ = z;
    const s = toSample(r, z != null ? day + wraps * 86_400_000 + Math.round(z * 1000) : (num(r.t) ?? 0), version);
    if (s) samples.push(s);
  }
  return { version, title: typeof head.title === "string" ? head.title : null, atcId: typeof head.atcId === "string" ? head.atcId : null, samples };
}

/* ---------- the phase detector ---------- */

export type FlightPhase = "boarding" | "doorsClosed" | "pushback" | "taxi" | "takeoff" | "climb" | "cruise" | "descent" | "approach" | "landed" | "taxiIn" | "gate";
/** What view=auto follows: getting ready → push-back and taxi → flying → arrived. */
export type FlightStage = "ready" | "taxi" | "flying" | "arrived";

/**
 * What the Stream grid has a row for (1.11): the detector's stages, with "approaching" cut out of
 * flying: on approach, descending below FL100, the FMS in its approach phase, and the landing roll
 * and taxi in until the gate.
 */
export type ViewStage = "ready" | "taxi" | "flying" | "approaching" | "arrived";

export function viewStage(st: FlightState, plan: FlightPlan | null = null): ViewStage {
  if (st.stage !== "flying") return st.stage;
  const s = st.last;
  if (st.phase === "approach" || st.phase === "landed" || st.phase === "taxiIn") return "approaching";
  // on the way down: below FL100 with the seatbelt sign on (both; unknown sign counts as on), or the FMS in its approach phase
  const belts = s?.seatbelts !== false;
  if (st.phase === "descent" && s && levelFt(s) < 10_000 && belts) return "approaching";
  if (plan && /approach/i.test(plan.phase ?? "") && (st.phase === "descent" || st.phase === "cruise") && belts) return "approaching";
  return "flying";
}

export const STAGE_OF: Record<FlightPhase, FlightStage> = {
  boarding: "ready",
  doorsClosed: "ready",
  pushback: "taxi",
  taxi: "taxi",
  takeoff: "taxi",
  climb: "flying",
  cruise: "flying",
  descent: "flying",
  approach: "flying",
  landed: "flying",
  taxiIn: "flying",
  gate: "arrived",
};

export const PHASE_LABEL: Record<FlightPhase, string> = {
  boarding: "Boarding",
  doorsClosed: "Doors closed",
  pushback: "Pushback",
  taxi: "Taxiing",
  takeoff: "Take-off",
  climb: "Climbing",
  cruise: "Cruising",
  descent: "Descending",
  approach: "On approach",
  landed: "Landed",
  taxiIn: "Taxiing in",
  gate: "At the gate",
};

export interface Place {
  lat: number;
  lon: number;
  /** Field elevation (ft), when known. */
  elev?: number | null;
}

export interface FlightContext {
  from?: Place | null;
  to?: Place | null;
  /** The cruise level (ft): the FMS's when OFP Tower sends the plan, else the flight's. */
  cruiseFt?: number | null;
}

/** The level for flight levels and the cruise: pressure altitude when the source has it, else the altitude. */
export const levelFt = (s: FeedSample) => s.pressAlt ?? s.alt;

export interface Stamps {
  out: number | null;
  off: number | null;
  on: number | null;
  in: number | null;
  /** Touchdown rate (ft/min, negative), the one to show. */
  landingRate: number | null;
  /** The sim's latched touchdown velocity, for the record. */
  tdSim: number | null;
  /** Contacts after the landing within RULE.bounceFor (a bounce or two); null before the landing. */
  bounces?: number | null;
  /** The landing's peak G (OFP Tower). */
  peakG?: number | null;
}

export interface FlightState {
  phase: FlightPhase;
  stage: FlightStage;
  stamps: Stamps;
  /** The latest reading. */
  last: FeedSample | null;
  /** Doors were seen open while parked (so "doors closed" means something). */
  doorsSeenOpen: boolean;
  /** Going up, down or level (beyond ±300 ft/min), and since when (ms): a change only counts once it has lasted. */
  trend: "up" | "down" | "level" | null;
  trendSince: number | null;
  /** The cruise level: within RULE.leaveCruise ft of it the aircraft is cruising, bumps and all. */
  cruiseAlt: number | null;
  /** Ever airborne in this feed (a recording can start in the air). */
  airborne: boolean;
  /** When each phase was first entered (ms), for the times under the steps. */
  entered: Partial<Record<FlightPhase, number>>;
  /** Seconds parked with engines off after landing (feeds without engine state need a wait). */
  parkedSince: number | null;
}

/** "-776 fpm · 1 bounce": the landing as the screens show it; null before one. */
export function landingText(st: Stamps): string | null {
  if (st.landingRate == null) return null;
  const b = st.bounces ?? 0;
  return `${Math.round(st.landingRate)} fpm${b ? ` · ${b} bounce${b > 1 ? "s" : ""}` : ""}`;
}

export const EMPTY_STAMPS: Stamps = { out: null, off: null, on: null, in: null, landingRate: null, tdSim: null };

export const startState = (): FlightState => ({
  phase: "boarding",
  stage: "ready",
  stamps: { ...EMPTY_STAMPS },
  last: null,
  doorsSeenOpen: false,
  trend: null,
  trendSince: null,
  cruiseAlt: null,
  airborne: false,
  entered: {},
  parkedSince: null,
});

const R_NM = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180;
export function distNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/* ---------- rehearsing another route: lay the recording along this flight's line ---------- */

/** The point a fraction f of the way along the great circle from a to b. */
export function alongRoute(a: Place, b: Place, f: number): { lat: number; lon: number } {
  const p1 = rad(a.lat), l1 = rad(a.lon), p2 = rad(b.lat), l2 = rad(b.lon);
  const d = distNm(a, b) / R_NM;
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return { lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI, lon: (Math.atan2(y, x) * 180) / Math.PI };
}

/**
 * A recording from another route, laid along this flight's line so a rehearsal makes sense on its
 * map: each reading moves to the share of the way it had covered (by distance flown), heading along
 * the line; altitude, speed, times and everything else stay as recorded. A recording that started
 * in the air covers the last part of the route (as much of it as the recording flew). A recording
 * that already ends at this flight's destination is returned as it is.
 */
export function fitToRoute(samples: FeedSample[], from: Place, to: Place): FeedSample[] {
  if (samples.length < 2 || distNm(samples[samples.length - 1], to) < 30) return samples;
  const cum = [0];
  for (let i = 1; i < samples.length; i++) cum.push(cum[i - 1] + distNm(samples[i - 1], samples[i]));
  const flown = cum[cum.length - 1] || 1;
  const route = Math.max(1, distNm(from, to));
  const f0 = samples[0].onGround ? 0 : Math.max(0, Math.min(0.9, 1 - flown / route));
  return samples.map((s, i) => {
    const f = Math.min(1, f0 + ((1 - f0) * cum[i]) / flown);
    const p = alongRoute(from, to, f);
    const ahead = alongRoute(from, to, Math.min(1, f + 0.001));
    const moving = s.gs >= 1 && f < 0.999;
    return { ...s, lat: p.lat, lon: p.lon, hdg: moving ? bearing(p, ahead) : s.hdg };
  });
}

/** Thresholds from the rules table. */
export const RULE = {
  /** Moving on the ground (kt). */
  moving: 1,
  /** Taxiing under its own power, nose first, faster than a pushback (kt). */
  taxiOut: 5,
  /** Take-off roll (kt). */
  takeoffGs: 40,
  /** Climbing / descending (ft/min). */
  vertical: 300,
  /** Level this long above FL100 = cruising (ms). */
  levelFor: 120_000,
  /** A climb or descent counts once it has lasted this long (ms of sim time): turbulence doesn't. */
  holdFor: 20_000,
  /** Ft from the cruise level before a climb or descent counts: a step climb (2,000 ft) does, a bump in turbulence doesn't. */
  leaveCruise: 1500,
  /** Ft from the planned cruise level that counts as at it. */
  atCruise: 500,
  cruiseAbove: 10_000,
  /** On approach: below this height above the destination (ft) and within this distance (nm). */
  approachFt: 3000,
  approachNm: 25,
  /** On approach no sooner than this after take-off (ms), unless it has cruised or descended. */
  approachAfter: 180_000,
  /** Contacts this soon after the landing are bounces (ms). */
  bounceFor: 30_000,
  /** Without engine state (VATSIM), parked this long after landing = at the gate (ms). */
  parkedFor: 60_000,
} as const;

/**
 * On the ground? The feed's own flag, else (VATSIM) slow and near a field we know: under 40 kt
 * within 5 nm of the origin or destination, and below 300 ft above it when its elevation is known.
 */
function grounded(s: FeedSample, ctx: FlightContext): boolean {
  if (s.onGround != null) return s.onGround;
  if (s.gs >= RULE.takeoffGs) return false;
  for (const p of [ctx.from, ctx.to]) {
    if (!p || distNm(s, p) > 5) continue;
    return p.elev == null || s.alt - p.elev < 300;
  }
  return s.gs < RULE.takeoffGs && (s.vs == null || Math.abs(s.vs) < 100) && s.alt < 15_000;
}

/** Moving nose first: the track over the ground within 60° of the heading (unknown counts as no). */
function forwards(prev: FeedSample | null, s: FeedSample) {
  if (!prev || s.hdg == null || distNm(prev, s) < 0.0005) return false;
  const d = Math.abs(((bearing(prev, s) - s.hdg + 540) % 360) - 180);
  return d < 60;
}

/**
 * One step of the detector: the state after this reading. Pure, so a recorded flight run through
 * it gives the same phases and stamps every time.
 */
export function step(prev: FlightState, s: FeedSample, ctx: FlightContext = {}): FlightState {
  const st: FlightState = { ...prev, stamps: { ...prev.stamps }, last: s };
  const ground = grounded(s, ctx);
  const enginesKnown = s.engines != null && s.engines.length > 0;
  const enginesOff = enginesKnown && s.engines!.every((e) => !e);
  const moving = s.gs >= RULE.moving;
  let phase = prev.phase;

  // The landing is the FIRST contact: a bounce can put the aircraft back in the air on the reading
  // that has the touchdown rate, so the change to on-ground may only come with the second contact.
  // Contacts within RULE.bounceFor after it are bounces.
  const contact = s.landingRate != null || (s.touchdowns != null && s.touchdowns.length > 0);
  if (prev.airborne && contact) {
    if (st.stamps.on == null) {
      const first = s.touchdowns?.find((x) => x.n === 1);
      st.stamps.on = s.t;
      st.stamps.landingRate = first?.landingRate ?? s.landingRate ?? s.tdSim;
      st.stamps.tdSim = s.tdSim;
      st.stamps.bounces = s.touchdowns ? Math.max(0, ...s.touchdowns.map((x) => x.n - 1)) : 0;
    } else if (s.t - st.stamps.on <= RULE.bounceFor) {
      st.stamps.bounces = s.touchdowns?.length ? Math.max(st.stamps.bounces ?? 0, ...s.touchdowns.map((x) => x.n - 1)) : (st.stamps.bounces ?? 0) + 1;
    }
  }
  if (s.tdPeakG && st.stamps.on != null && s.tdPeakG.n === 1) st.stamps.peakG = s.tdPeakG.peakG;

  if (!ground) {
    // airborne
    if (!prev.airborne && prev.last && prev.stamps.out != null && st.stamps.off == null) st.stamps.off = s.t;
    st.airborne = true;
    st.parkedSince = null;
    const trend = s.vs == null ? prev.trend ?? "level" : s.vs > RULE.vertical ? "up" : s.vs < -RULE.vertical ? "down" : "level";
    if (!prev.last) {
      // joining a flight already in the air (a page opened in cruise, VATSIM without a vertical
      // speed yet): no history, so the first reading counts as held, cruise straight away when level
      st.trend = trend;
      st.trendSince = s.t - RULE.levelFor;
    } else if (trend !== prev.trend || st.trendSince == null) {
      st.trend = trend;
      st.trendSince = s.t;
    }
    const held = (ms: number) => s.t - st.trendSince! >= ms;
    const to = ctx.to;
    const toGo = to ? distNm(s, to) : null;
    const total = ctx.from && to ? distNm(ctx.from, to) : null;
    const height = to ? s.alt - (to.elev ?? 0) : s.alt;
    const lv = levelFt(s);
    // level at the planned cruise level: cruising after a short hold, not the full two minutes
    const atCruise = ctx.cruiseFt != null && Math.abs(lv - ctx.cruiseFt) <= RULE.atCruise;
    // on approach: near and low, but not while still climbing out, and only after some flying
    // (a short hop, London City to Heathrow, starts 20 nm from its destination)
    const settled = ["cruise", "descent", "approach"].includes(prev.phase) || (st.stamps.off != null && s.t - st.stamps.off > RULE.approachAfter);
    if (toGo != null && toGo < RULE.approachNm && height < RULE.approachFt && st.trend !== "up" && (settled || prev.last == null)) phase = "approach";
    else if (prev.phase === "cruise" && st.cruiseAlt != null && Math.abs(lv - st.cruiseAlt) <= RULE.leaveCruise) phase = "cruise";
    else if (st.trend === "up" && held(RULE.holdFor)) phase = "climb";
    else if (st.trend === "down" && held(RULE.holdFor) && (toGo == null || total == null || toGo < total / 2)) phase = "descent";
    else if (st.trend === "level" && lv > RULE.cruiseAbove && (held(RULE.levelFor) || (atCruise && held(RULE.holdFor)))) phase = "cruise";
    else if (["boarding", "doorsClosed", "pushback", "taxi", "takeoff", "landed", "taxiIn", "gate"].includes(phase))
      // just airborne, or joined in the air before any rule above applies: by the trend
      phase = st.trend === "down" && prev.last == null ? "descent" : st.trend === "level" && lv > RULE.cruiseAbove ? "cruise" : "climb";
  } else if (st.airborne && prev.last && !grounded(prev.last, ctx)) {
    // wheels down
    // (a bounce touches more than once: the first contact is ON and its rate is the landing rate)
    phase = "landed";
    if (st.stamps.on == null) {
      st.stamps.on = s.t;
      // without a measured rate, the last airborne reading's vertical speed (the one after contact
      // has already stopped sinking)
      const before = prev.last.vs;
      st.stamps.landingRate = s.landingRate ?? s.tdSim ?? (before != null && before < 0 ? Math.round(before) : null);
      st.stamps.tdSim = s.tdSim;
    }
    st.parkedSince = null;
  } else if (st.airborne) {
    // after landing: taxi in, then at the gate
    if (st.stamps.on == null && s.tdSim != null) st.stamps.tdSim = s.tdSim;
    if (prev.phase === "gate") phase = "gate";
    else if (moving) {
      phase = phase === "landed" && s.gs > 30 ? "landed" : "taxiIn";
      st.parkedSince = null;
    } else {
      const braked = s.parkBrake !== false; // unknown counts: the rule can't be checked
      if (enginesKnown) phase = enginesOff && braked ? "gate" : phase === "landed" ? "taxiIn" : phase;
      else {
        st.parkedSince ??= s.t;
        phase = s.t - st.parkedSince >= RULE.parkedFor ? "gate" : "taxiIn";
      }
    }
    if (phase === "gate" && st.stamps.in == null) st.stamps.in = s.t;
  } else {
    // before take-off
    if (s.doors?.some((d) => d > 5) && !moving) st.doorsSeenOpen = true;
    if (st.stamps.out == null) {
      if (moving) {
        // OUT at the first movement from the stand; most stands push out, so it's a pushback
        // unless the aircraft clearly drives off nose first (a power-out stand)
        st.stamps.out = s.t;
        phase = forwards(prev.last, s) && s.gs > RULE.taxiOut ? "taxi" : "pushback";
      } else {
        const shut = s.doors != null && s.doors.every((d) => d <= 5);
        phase = s.beacon || (shut && st.doorsSeenOpen) ? "doorsClosed" : "boarding";
      }
    } else if (s.gs >= RULE.takeoffGs) phase = "takeoff";
    else if (phase === "pushback") {
      // the push ends when the aircraft moves off nose first under its own power (a stop while
      // the tug disconnects is still the pushback)
      if (moving && forwards(prev.last, s) && s.gs > RULE.taxiOut) phase = "taxi";
    } else if (phase !== "takeoff" || s.gs < 5) phase = "taxi";
  }

  // the cruise level, kept until the aircraft settles at another (a step climb) or lands
  if (phase === "cruise" && st.trend === "level" && (st.cruiseAlt == null || Math.abs(levelFt(s) - st.cruiseAlt) > RULE.leaveCruise)) st.cruiseAlt = levelFt(s);
  if (ground) st.cruiseAlt = null;
  if (phase !== prev.phase || prev.last == null) st.entered = { ...prev.entered, [phase]: prev.entered[phase] ?? s.t };
  st.phase = phase;
  st.stage = STAGE_OF[phase];
  return st;
}

/** Run a whole list of readings through the detector, every state along the way. */
export function detectAll(samples: FeedSample[], ctx: FlightContext = {}): FlightState[] {
  const out: FlightState[] = [];
  let st = startState();
  for (const s of samples) out.push((st = step(st, s, ctx)));
  return out;
}
