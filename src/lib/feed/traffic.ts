/**
 * 1.17: other traffic at an airport, for the departures board (G10) and the connections card
 * (G10b). Three sources, merged by callsign:
 *   - VATSIM's public data feed and IVAO's whazzup (read only, fetched by the page);
 *   - OFP Tower's `traffic` message: the aircraft in the sim around the airport (MSFS AI, and what
 *     SayIntentions puts in: its traffic and SkyNet simmers), with its `stands` for gates.
 * A network feed wins over the same callsign in the sim. Research and fields: docs/design/fids/SOURCES.md.
 * Imports nothing, so verify loads it in Node.
 */

export type TrafficSource = "AI" | "SI" | "SKY" | "VAT" | "IVAO";

/** One movement on the board. Times are UTC ms. */
export interface TrafficRow {
  callsign: string;
  src: TrafficSource;
  side: "dep" | "arr";
  /** The other end (ICAO), when known. */
  other: string | null;
  /** Scheduled / filed (departures) or estimated (arrivals) time. */
  t: number | null;
  gate: string | null;
  /** The gate comes from a stand the aircraft is parked on, not the sim's assignment. */
  snapped: boolean;
  status: TrafficStatus;
  type: string | null;
}

export type TrafficStatus = "SCHEDULED" | "AT GATE" | "BOARDING" | "PUSHBACK" | "TAXIING" | "DEPARTED" | "EN ROUTE" | "APPROACH" | "LANDED" | "ON BLOCKS";

export interface Stand {
  name: string;
  lat: number;
  lon: number;
  /** Metres. */
  radius: number;
}

export interface TrafficAirport {
  icao: string;
  lat: number;
  lon: number;
  elevFt: number | null;
}

const NM = 1852;
export function distNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return (2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)))) / NM;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 12): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const icao = (v: unknown): string | null => {
  const s = str(v, 4)?.toUpperCase();
  return s && /^[A-Z0-9]{4}$/.test(s) ? s : null;
};
const callsignOf = (v: unknown): string | null => {
  const s = str(v, 10)?.toUpperCase();
  return s && /^[A-Z0-9-]{2,10}$/.test(s) ? s : null;
};

/** A UTC time of day (minutes) as the nearest moment to `now` (yesterday, today or tomorrow). */
export function dayTime(minutes: number, now: number): number {
  const day = Math.floor(now / 86_400_000) * 86_400_000;
  const t = day + minutes * 60_000;
  return [t - 86_400_000, t, t + 86_400_000].reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
}

/** The stand an aircraft on the ground is parked on (within its radius, plus a little). */
export function snapStand(p: { lat: number; lon: number }, stands: Stand[] | null | undefined): string | null {
  let best: { name: string; d: number } | null = null;
  for (const s of stands ?? []) {
    const d = distNm(p, s) * NM;
    if (d <= Math.max(10, s.radius) + 15 && (!best || d < best.d)) best = { name: s.name, d };
  }
  return best?.name ?? null;
}

/** On the ground at the airport: near it, slow, and low. */
const onGroundAt = (p: { lat: number; lon: number; alt: number | null; gs: number | null }, ap: TrafficAirport) =>
  distNm(p, ap) < 4 && (p.gs ?? 0) < 40 && (p.alt == null || ap.elevFt == null || p.alt < ap.elevFt + 300);

/** Status from position and speed, for a feed that gives none (VATSIM). */
function motionStatus(side: "dep" | "arr", p: { lat: number; lon: number; alt: number | null; gs: number | null }, ap: TrafficAirport): TrafficStatus | null {
  const d = distNm(p, ap);
  if (onGroundAt(p, ap)) {
    if ((p.gs ?? 0) < 1) return side === "dep" ? "AT GATE" : "ON BLOCKS";
    return side === "dep" ? "TAXIING" : "LANDED";
  }
  if (side === "dep") return d < 40 ? "DEPARTED" : null;
  return d < 40 ? "APPROACH" : "EN ROUTE";
}

/** Arrival estimate from the distance left and the ground speed. */
const etaFrom = (p: { lat: number; lon: number; gs: number | null }, ap: TrafficAirport, now: number): number | null => (p.gs != null && p.gs > 60 ? now + (distNm(p, ap) / p.gs) * 3_600_000 : null);

/* ---------- VATSIM ---------- */

export function fromVatsim(j: unknown, ap: TrafficAirport, now: number, stands?: Stand[] | null): TrafficRow[] {
  const d = (j ?? {}) as { pilots?: unknown[]; prefiles?: unknown[] };
  const out: TrafficRow[] = [];
  const hhmm = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    return /^\d{4}$/.test(s) && Number(s.slice(0, 2)) < 24 && Number(s.slice(2)) < 60 ? Number(s.slice(0, 2)) * 60 + Number(s.slice(2)) : null;
  };
  for (const [list, connected] of [
    [d.pilots ?? [], true],
    [d.prefiles ?? [], false],
  ] as const) {
    for (const raw of list.slice(0, 5000)) {
      const p = raw as Record<string, unknown>;
      const fp = (p.flight_plan ?? null) as Record<string, unknown> | null;
      const cs = callsignOf(p.callsign);
      if (!cs || !fp) continue;
      const dep = icao(fp.departure);
      const arr = icao(fp.arrival);
      const side = dep === ap.icao ? "dep" : arr === ap.icao ? "arr" : null;
      if (!side) continue;
      const type = str(fp.aircraft_short, 8);
      const dt = hhmm(fp.deptime);
      if (!connected) {
        if (side === "dep" && dt != null)
          out.push({
            callsign: cs,
            src: "VAT",
            side,
            other: arr,
            t: dayTime(dt, now),
            gate: null,
            snapped: false,
            status: "SCHEDULED",
            type,
          });
        continue;
      }
      const pos = {
        lat: num(p.latitude) ?? NaN,
        lon: num(p.longitude) ?? NaN,
        alt: num(p.altitude),
        gs: num(p.groundspeed),
      };
      if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) continue;
      const status = motionStatus(side, pos, ap);
      if (!status) continue;
      const ground = onGroundAt(pos, ap);
      const gate = ground ? snapStand(pos, stands) : null;
      let t: number | null;
      if (side === "dep") t = dt != null ? dayTime(dt, now) : null;
      else {
        const ete = hhmm(fp.enroute_time);
        t = ground ? null : etaFrom(pos, ap, now) ?? (dt != null && ete != null ? dayTime(dt, now) + ete * 60_000 : null);
      }
      out.push({
        callsign: cs,
        src: "VAT",
        side,
        other: side === "dep" ? arr : dep,
        t,
        gate,
        snapped: !!gate,
        status,
        type,
      });
    }
  }
  return out;
}

/* ---------- IVAO ---------- */

const IVAO_STATE: Record<string, TrafficStatus> = {
  boarding: "BOARDING",
  departing: "TAXIING",
  "initial climb": "DEPARTED",
  "en route": "EN ROUTE",
  approach: "APPROACH",
  landed: "LANDED",
  "on blocks": "ON BLOCKS",
};

export function fromIvao(j: unknown, ap: TrafficAirport, now: number, stands?: Stand[] | null): TrafficRow[] {
  const pilots = ((j as { clients?: { pilots?: unknown[] } } | null)?.clients?.pilots ?? []) as Record<string, unknown>[];
  const out: TrafficRow[] = [];
  for (const p of pilots.slice(0, 5000)) {
    const cs = callsignOf(p.callsign);
    const fp = (p.flightPlan ?? null) as Record<string, unknown> | null;
    const tr = (p.lastTrack ?? null) as Record<string, unknown> | null;
    if (!cs || !fp) continue;
    const dep = icao(fp.departureId);
    const arr = icao(fp.arrivalId);
    const side = dep === ap.icao ? "dep" : arr === ap.icao ? "arr" : null;
    if (!side) continue;
    const state = typeof tr?.state === "string" ? IVAO_STATE[tr.state.toLowerCase()] : undefined;
    const pos = tr
      ? {
          lat: num(tr.latitude) ?? NaN,
          lon: num(tr.longitude) ?? NaN,
          alt: num(tr.altitude),
          gs: num(tr.groundSpeed),
        }
      : null;
    const hasPos = !!pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lon);
    // a departure that has gone on its way, or an arrival still far out, isn't on this board's side of things
    let status: TrafficStatus | null = state ?? (hasPos ? motionStatus(side, pos!, ap) : null);
    if (side === "dep" && hasPos && distNm(pos!, ap) > 40) status = null;
    if (side === "dep" && (status === "APPROACH" || status === "LANDED" || status === "ON BLOCKS")) status = null;
    if (!status) continue;
    const dt = num(fp.actualDepartureTime) ?? num(fp.departureTime);
    let t: number | null = null;
    if (side === "dep") t = dt != null ? dayTime(Math.round(dt / 60) % 1440, now) : null;
    else if (status !== "LANDED" && status !== "ON BLOCKS") {
      const left = num(tr?.arrivalDistance);
      const gs = hasPos ? pos!.gs : null;
      t = left != null && gs != null && gs > 60 ? now + (left / gs) * 3_600_000 : hasPos ? etaFrom(pos!, ap, now) : null;
    }
    const ground = hasPos && tr?.onGround === true;
    const gate = ground ? snapStand(pos!, stands) : null;
    const type = str((fp.aircraft as Record<string, unknown> | undefined)?.icaoCode, 8) ?? str(fp.aircraftId, 8);
    out.push({
      callsign: cs,
      src: "IVAO",
      side,
      other: side === "dep" ? arr : dep,
      t,
      gate,
      snapped: !!gate,
      status,
      type,
    });
  }
  return out;
}

/* ---------- OFP Tower: the aircraft in the sim ---------- */

const AI_STATE: [RegExp, TrafficStatus][] = [
  [/^(init|sleep|flt plan)$/, "SCHEDULED"],
  [/^(startup|preflight support|clearance)$/, "BOARDING"],
  [/^push ?back/, "PUSHBACK"],
  [/^(pre taxi out|taxi out)$/, "TAXIING"],
  [/^(takeoff|enroute)/, "DEPARTED"],
  [/^(pattern|landing|go around)/, "APPROACH"],
  [/^(rollout|taxi in)$/, "LANDED"],
  [/^(shutdown|postflight support)$/, "ON BLOCKS"],
];

/**
 * OFP Tower's `traffic` message: `{"type":"traffic","airport":"LEMD","aircraft":[…]}`, one entry per
 * aircraft in the sim near the airport. Each: callsign, from, to, etd/eta (UTC epoch s), parking
 * ("Gate G 4, RAMP lrg (18m)" → "G4"), state (AI TRAFFIC STATE), lat, lon, alt, gs, onGround, type,
 * src ("AI" | "SI" | "SKY"; AI when absent). Spec: docs/OFP-LINK.md.
 */
export function fromTower(m: unknown, ap: TrafficAirport, now: number, stands?: Stand[] | null): TrafficRow[] {
  const msg = (m ?? {}) as Record<string, unknown>;
  if (icao(msg.airport) !== ap.icao) return [];
  const out: TrafficRow[] = [];
  for (const raw of (Array.isArray(msg.aircraft) ? msg.aircraft : []).slice(0, 500)) {
    const a = raw as Record<string, unknown>;
    const cs = callsignOf(a.callsign);
    if (!cs) continue;
    const from = icao(a.from);
    const to = icao(a.to);
    const pos = {
      lat: num(a.lat) ?? NaN,
      lon: num(a.lon) ?? NaN,
      alt: num(a.alt),
      gs: num(a.gs),
    };
    const hasPos = Number.isFinite(pos.lat) && Number.isFinite(pos.lon);
    // without a plan: on the ground here it's a departure to come; in the air near here, an arrival
    const side: "dep" | "arr" | null = from === ap.icao ? "dep" : to === ap.icao ? "arr" : !from && !to && hasPos ? (a.onGround === true ? "dep" : null) : null;
    if (!side) continue;
    const st = typeof a.state === "string" ? a.state.toLowerCase().trim() : "";
    let status: TrafficStatus | null = AI_STATE.find(([re]) => re.test(st))?.[1] ?? (hasPos ? motionStatus(side, pos, ap) : null);
    if (side === "dep" && status === "SCHEDULED" && a.onGround === true) status = "AT GATE";
    if (side === "dep" && (status === "APPROACH" || status === "LANDED" || status === "ON BLOCKS")) status = a.onGround === true ? "AT GATE" : null;
    if (!status) continue;
    const parking = str(a.parking, 40);
    const native = parking ? parkingName(parking) : null;
    const snapped = !native && hasPos && a.onGround === true ? snapStand(pos, stands) : null;
    const etd = num(a.etd);
    const eta = num(a.eta);
    const t = side === "dep" ? (etd != null ? etd * 1000 : null) : eta != null ? eta * 1000 : hasPos && a.onGround !== true ? etaFrom(pos, ap, now) : null;
    const src: TrafficSource = a.src === "SI" || a.src === "SKY" ? a.src : "AI";
    out.push({
      callsign: cs,
      src,
      side,
      other: side === "dep" ? to : from,
      t,
      gate: native ?? snapped,
      snapped: !native && !!snapped,
      status,
      type: str(a.type, 8),
    });
  }
  return out;
}

/** "Gate G 4, RAMP lrg (18m)" → "G4"; "Parking 12" → "12". */
export function parkingName(s: string): string | null {
  const head = s.split(",")[0].trim();
  const m = head.match(/^(?:gate|parking|ramp|stand|dock)\s+(.+)$/i);
  const name = (m ? m[1] : head).replace(/\s+/g, "").toUpperCase();
  return name && name.length <= 6 && /[0-9]/.test(name) ? name : null;
}

/** OFP Tower's `stands` message: the airport's parking places from the sim's scenery. */
export function standsFrom(m: unknown): { airport: string; stands: Stand[] } | null {
  const msg = (m ?? {}) as Record<string, unknown>;
  const airport = icao(msg.airport);
  if (!airport) return null;
  const stands: Stand[] = [];
  for (const raw of (Array.isArray(msg.stands) ? msg.stands : []).slice(0, 2000)) {
    const s = raw as Record<string, unknown>;
    const name = str(s.name, 8)?.toUpperCase().replace(/\s+/g, "");
    const lat = num(s.lat);
    const lon = num(s.lon);
    if (name && lat != null && lon != null)
      stands.push({
        name,
        lat,
        lon,
        radius: Math.max(5, Math.min(60, num(s.radius) ?? 20)),
      });
  }
  return { airport, stands };
}

/* ---------- the board ---------- */

const RANK: Record<TrafficSource, number> = {
  VAT: 0,
  IVAO: 0,
  SKY: 1,
  SI: 2,
  AI: 3,
};

/** One row per callsign: a network feed over the sim's copy (the sim's gate kept if the feed has none). */
export function mergeTraffic(...lists: TrafficRow[][]): TrafficRow[] {
  const by = new Map<string, TrafficRow>();
  for (const r of lists.flat()) {
    const had = by.get(r.callsign);
    if (!had) by.set(r.callsign, r);
    else if (RANK[r.src] < RANK[had.src])
      by.set(r.callsign, {
        ...r,
        gate: r.gate ?? had.gate,
        snapped: r.gate ? r.snapped : had.snapped,
        other: r.other ?? had.other,
        t: r.t ?? had.t,
      });
    else if (!had.gate && r.gate) by.set(r.callsign, { ...had, gate: r.gate, snapped: r.snapped });
  }
  return [...by.values()];
}

const MOVING = (s: TrafficStatus) => (s === "TAXIING" || s === "PUSHBACK" ? 0 : s === "BOARDING" ? 1 : 2);

/**
 * The rows a board shows: one side, from `from` to `to` (rows without a time are put at `now`),
 * gone ones (departed long ago) left out, in time order and the ones without a time last, at most `max`.
 */
export function boardRows(rows: TrafficRow[], side: "dep" | "arr", from: number, to: number, now: number, max: number, skip: (cs: string) => boolean = () => false): TrafficRow[] {
  return rows
    .filter((r) => r.side === side && !skip(r.callsign))
    .map((r) => ({ r, at: r.t ?? now }))
    .filter(({ r, at }) => at <= to && (at >= from || ["AT GATE", "BOARDING", "PUSHBACK", "TAXIING", "LANDED"].includes(r.status)))
    // flights with a time in time order; then those without (SI's parked traffic), moving ones first
    .sort((a, b) => (a.r.t == null ? 1 : 0) - (b.r.t == null ? 1 : 0) || (a.r.t == null ? MOVING(a.r.status) - MOVING(b.r.status) : a.at - b.at) || a.r.callsign.localeCompare(b.r.callsign))
    .slice(0, max)
    .map(({ r }) => r);
}

/**
 * The flight is at its origin (else its destination), for the board's airport: on the ground within
 * 5 nm of one of its airports, that one (a screen opened at the gate after landing, before any
 * take-off was seen); otherwise the origin until take-off. OFP Tower picks its traffic's airport the same way.
 */
export function atOriginOf(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  last: { lat: number; lon: number; gs: number | null; onGround: boolean | null } | null,
  stage: string | null,
): boolean {
  const ground = !!last && (last.onGround ?? (last.gs != null && last.gs < 40));
  if (last && ground) {
    if (distNm(last, to) < 5) return false;
    if (distNm(last, from) < 5) return true;
  }
  return stage == null || stage === "ready" || stage === "taxi";
}

/** The airline for a callsign: its three-letter prefix, as the brand or one of its operators. */
export function airlineOf<T extends { icao: string; operators?: string[] }>(callsign: string, airlines: T[]): T | null {
  const pre = callsign.match(/^([A-Z]{3})\d/)?.[1];
  if (!pre) return null;
  return airlines.find((a) => a.icao === pre) ?? airlines.find((a) => a.operators?.includes(pre)) ?? null;
}
