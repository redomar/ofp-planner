/**
 * The gate screen's live feed, the part without React or the network: one message shape for every
 * source (OFP Link, a recorded flight, VATSIM), the reader for recorded flights, and the phase
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
  /** Altitude (ft, above sea level). */
  alt: number;
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
}

export type FeedSource = "link" | "replay" | "vatsim" | "clock";

/* ---------- recorded flights (OFP Link recorder, .jsonl) ---------- */

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
 * One reading in the shared shape from a recorder line or an OFP Link message (same field names).
 * Version 1 recordings: parking brake unknown, "td" is the sim's touchdown velocity.
 */
export function toSample(r: Record<string, unknown>, t: number, version = 2): FeedSample | null {
  const lat = num(r.lat);
  const lon = num(r.lon);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    t,
    lat,
    lon,
    alt: num(r.alt) ?? 0,
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
}

export interface Stamps {
  out: number | null;
  off: number | null;
  on: number | null;
  in: number | null;
  /** Touchdown rate (ft/min, negative), the one to show. */
  landingRate: number | null;
  /** The sim's latched touchdown velocity, for the record. */
  tdSim: number | null;
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
  /** Seconds parked with engines off after landing (feeds without engine state need a wait). */
  parkedSince: number | null;
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
function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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
  cruiseAbove: 10_000,
  /** On approach: below this height above the destination (ft) and within this distance (nm). */
  approachFt: 3000,
  approachNm: 25,
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

  if (!ground) {
    // airborne
    if (!prev.airborne && prev.last && prev.stamps.out != null && st.stamps.off == null) st.stamps.off = s.t;
    st.airborne = true;
    st.parkedSince = null;
    const trend = s.vs == null ? prev.trend ?? "level" : s.vs > RULE.vertical ? "up" : s.vs < -RULE.vertical ? "down" : "level";
    if (trend !== prev.trend || st.trendSince == null) {
      st.trend = trend;
      st.trendSince = s.t;
    }
    const held = (ms: number) => s.t - st.trendSince! >= ms;
    const to = ctx.to;
    const toGo = to ? distNm(s, to) : null;
    const total = ctx.from && to ? distNm(ctx.from, to) : null;
    const height = to ? s.alt - (to.elev ?? 0) : s.alt;
    if (toGo != null && toGo < RULE.approachNm && height < RULE.approachFt) phase = "approach";
    else if (prev.phase === "cruise" && st.cruiseAlt != null && Math.abs(s.alt - st.cruiseAlt) <= RULE.leaveCruise) phase = "cruise";
    else if (st.trend === "up" && held(RULE.holdFor)) phase = "climb";
    else if (st.trend === "down" && held(RULE.holdFor) && (toGo == null || total == null || toGo < total / 2)) phase = "descent";
    else if (st.trend === "level" && s.alt > RULE.cruiseAbove && held(RULE.levelFor)) phase = "cruise";
    else if (["boarding", "doorsClosed", "pushback", "taxi", "takeoff", "landed", "taxiIn", "gate"].includes(phase)) phase = "climb";
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
  if (phase === "cruise" && st.trend === "level" && (st.cruiseAlt == null || Math.abs(s.alt - st.cruiseAlt) > RULE.leaveCruise)) st.cruiseAlt = s.alt;
  if (ground) st.cruiseAlt = null;
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
