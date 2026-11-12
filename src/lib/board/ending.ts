/**
 * 1.13: the ending screen's numbers. They come from OFP Tower's summary when it has sent one, else
 * from what this page saw itself (the feed's stamps), else from the last ending a page on this PC
 * kept (an OBS source refreshed after the flight, OFP Tower closed): "ofp-planner:ending".
 */
import type { FlightState, FlightSummary } from "../feed/core";
import type { GateFlight } from "./gate";

const MIN = 60_000;
export const ENDING_KEY = "ofp-planner:ending";
/** A kept ending is for this flight only within this long of being kept. */
const KEEP_MS = 24 * 3_600_000;

export interface EndingRecord {
  v: 1;
  /** "LHBP-LIMC": the flight it belongs to. */
  route: string;
  /** When it was kept (ms). */
  at: number;
  summary: FlightSummary | null;
  stamps: { out: number | null; off: number | null; on: number | null; in: number | null; landingRate: number | null; tdSim: number | null; bounces: number | null; peakG: number | null } | null;
  /** The line flown, [lon, lat]. */
  trail: [number, number][];
}

export const routeKey = (f: Pick<GateFlight, "from" | "to">) => `${f.from.icao}-${f.to.icao}`;

/** What to keep from the feed, once the aircraft is down; null before the landing. */
export function endingRecord(f: GateFlight, live: FlightState | null, summary: FlightSummary | null, trail: [number, number][], now: number): EndingRecord | null {
  const st = live?.stamps ?? null;
  if (st?.on == null && !summary?.on) return null;
  return {
    v: 1,
    route: routeKey(f),
    at: now,
    summary,
    stamps: st ? { out: st.out, off: st.off, on: st.on, in: st.in, landingRate: st.landingRate, tdSim: st.tdSim, bounces: st.bounces ?? null, peakG: st.peakG ?? null } : null,
    trail: trail.slice(-4000),
  };
}

/** A kept ending, checked: null when it isn't one, is for another flight, or is old. */
export function readEnding(raw: string | null, f: Pick<GateFlight, "from" | "to">, now: number): EndingRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as EndingRecord;
    if (r?.v !== 1 || r.route !== routeKey(f) || typeof r.at !== "number" || now - r.at > KEEP_MS || now < r.at - 60_000) return null;
    const trail = Array.isArray(r.trail) ? r.trail.filter((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === "number" && Number.isFinite(x))) : [];
    return { ...r, trail, summary: r.summary && typeof r.summary === "object" ? r.summary : null, stamps: r.stamps && typeof r.stamps === "object" ? r.stamps : null };
  } catch {
    return null;
  }
}

export interface EndStats {
  out: number | null;
  off: number | null;
  on: number | null;
  in: number | null;
  /** Block (out → in) and air (off → on) time, min. */
  block: number | null;
  air: number | null;
  fpm: number | null;
  peakG: number | null;
  bounces: number | null;
  maxAltFt: number | null;
  maxGsKt: number | null;
  distanceNm: number | null;
  tripKg: number | null;
  cruiseFfKgH: number | null;
  depRunway: string | null;
  arrRunway: string | null;
  /** The schedule's arrival (on-blocks) and how late (+) or early (−) the flight came in, min. */
  schedIn: number | null;
  late: number | null;
}

/**
 * The ending's figures: OFP Tower's summary over the feed's stamps over a kept ending, field by
 * field; the scheduled arrival from the flight (SimBrief, the Finder).
 */
export function endStats(f: GateFlight, live: FlightState | null, summary: FlightSummary | null, kept: EndingRecord | null, depRunway: string | null = null, arrRunway: string | null = null): EndStats {
  const sum = summary ?? kept?.summary ?? null;
  const st = live?.stamps.on != null || live?.stamps.off != null ? live.stamps : (kept?.stamps ?? null);
  const pick = <T,>(...xs: (T | null | undefined)[]): T | null => xs.find((x) => x != null) ?? null;
  const out = pick(sum?.out, st?.out);
  const off = pick(sum?.off, st?.off);
  const on = pick(sum?.on, st?.on);
  const inn = pick(sum?.in, st?.in);
  const schedIn = f.source === "fms" || f.block == null ? null : f.stdMs + f.block * MIN;
  return {
    out,
    off,
    on,
    in: inn,
    block: out != null && inn != null && inn > out ? Math.round((inn - out) / MIN) : null,
    air: off != null && on != null && on > off ? Math.round((on - off) / MIN) : null,
    fpm: pick(sum?.fpm, st?.landingRate),
    peakG: pick(sum?.peakG, st?.peakG),
    bounces: pick(sum?.bounces, st?.bounces),
    maxAltFt: sum?.maxAltFt ?? null,
    maxGsKt: sum?.maxGsKt ?? null,
    distanceNm: sum?.distanceNm ?? null,
    tripKg: sum?.tripKg ?? null,
    cruiseFfKgH: sum?.cruiseFfKgH ?? null,
    depRunway: pick(sum?.depRunway, depRunway),
    arrRunway: pick(sum?.arrRunway, arrRunway),
    schedIn,
    // more than 12 h out is another day's schedule (an OFP for another date, the sim's own clock): none
    late: schedIn != null && inn != null && Math.abs(inn - schedIn) < 12 * 60 * MIN ? Math.round((inn - schedIn) / MIN) : null,
  };
}

/**
 * How the landing felt from the cabin, from the touchdown rate and G: a word and a line for the
 * passengers. Null without a rate. A bounce is said too.
 */
export function landingFeel(fpm: number | null, g: number | null, bounces: number | null): { word: string; line: string; tone: "go" | "warn" | "stop" } | null {
  if (fpm == null) return null;
  const v = Math.abs(fpm);
  const hard = v >= 600 || (g != null && g >= 1.8);
  const f = hard
    ? { word: "Hard", line: "Everyone in the cabin felt that one", tone: "stop" as const }
    : v >= 400 || (g != null && g >= 1.5)
      ? { word: "Firm", line: "A firm touchdown, felt in every seat", tone: "warn" as const }
      : v >= 200
        ? { word: "Normal", line: "A positive, normal touchdown", tone: "go" as const }
        : v >= 100
          ? { word: "Smooth", line: "A gentle touchdown", tone: "go" as const }
          : { word: "Butter", line: "Most passengers didn't notice it", tone: "go" as const };
  return bounces ? { ...f, line: `${f.line}, and a bounce${bounces > 1 ? ` (${bounces})` : ""}` } : f;
}
