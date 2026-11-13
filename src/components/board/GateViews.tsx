"use client";

import { geoAzimuthalEquidistant, geoDistance, geoInterpolate, geoPath } from "d3-geo";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cityName, dur } from "@/lib/data/flight";
import { routeColor, textOn } from "@/lib/colors";
import { MIN } from "@/lib/board/board";
import type { GateFlight, GateState } from "@/lib/board/gate";
import { goTarget } from "@/lib/board/countdown";
import { ENDING_KEY, endStats, landingFeel, readEnding, routeKey, type EndingRecord } from "@/lib/board/ending";
import { BACKS, layers, layersTo, stepAt, turnsFrom, turnsOf, turnsTo, VIEW_INFO, type Layers, type Look, type LookBack, type ShownView, type Turns } from "@/lib/board/looks";
import { bearing, distNm, fmsArrival, routeBefore, steadyTime, landingText, levelFt, phaseLabel, utcAt, wentAround, viewStage, type ViewStage, startState, type FeedSample, type FeedSource, type FlightPlan, type FlightPhase, type FlightState, type FlightSummary, vsText } from "@/lib/feed/core";
import { useOutlines } from "@/lib/outlines";
import { useTerrain } from "@/lib/terrain";
import { baseLayers, mapRadius } from "../RouteMap";
import { GateScreen, localClock, PLANE, screenNow, WxPicto, type GateWx } from "./GateScreen";

/**
 * The view on screen. A fixed &view= is that view. view=auto: an OBS scene named in the rules
 * gives its view; otherwise the stage of the flight (or the held stage) picks from the stage table.
 */
export function shownTurns(g: Pick<GateState, "view" | "stages" | "scenes" | "hold">, live: FlightState | null, scene: string | null = null, plan: FlightPlan | null = null): { turns: Turns; key: string } {
  if (g.view !== "auto") return { turns: turnsFrom(g.view) ?? turnsOf(layers("full")), key: `view:${g.view}` };
  const stage: ViewStage = g.hold ?? (live ? viewStage(live, plan) : "ready");
  const rule = scene ? g.scenes.find(([n]) => n.trim().toLowerCase() === scene.trim().toLowerCase()) : null;
  const turns = rule ? rule[1][stage] : g.stages[stage];
  // a new stage, scene or rotation starts the rotation from its first step
  return { turns, key: `${rule?.[0] ?? ""}|${stage}|${turnsTo(turns)}` };
}
/** The looks on screen `elapsed` ms after the stage began (its rotation's step; the only look without one). */
export function shownLooks(g: Pick<GateState, "view" | "stages" | "scenes" | "hold">, live: FlightState | null, scene: string | null = null, plan: FlightPlan | null = null, elapsed = 0): Layers {
  return stepAt(shownTurns(g, live, scene, plan).turns, elapsed).ls;
}

/** An airport's own name, short: no "Airport", no city in front (London Heathrow Airport → Heathrow). */
export function shortName(name: string, city: string | null): string {
  const n = name.replace(/ (International )?Airport$/, "");
  return city && n.startsWith(`${city} `) ? n.slice(city.length + 1) : n;
}

/* ---------- what every view says, from the live feed (or the clock without one) ---------- */

type Tone = "go" | "warn" | "stop" | "plain" | "done";
const TONE: Record<FlightPhase, Tone> = {
  boarding: "go",
  doorsClosed: "stop",
  pushback: "done",
  taxi: "done",
  takeoff: "done",
  climb: "go",
  cruise: "go",
  descent: "warn",
  approach: "warn",
  landed: "done",
  taxiIn: "done",
  gate: "done",
};

export interface LiveFacts {
  status: string;
  tone: Tone;
  line: string | null;
  /** "FL360" or "3,200 ft". */
  alt: string | null;
  gs: number | null;
  toGo: number | null;
  /** Minutes to landing, from the distance left and the ground speed. */
  minLeft: number | null;
  arrives: number | null;
  /** Share of the route flown (0–1). */
  flown: number;
  pos: { lat: number; lon: number } | null;
  hdg: number | null;
  /** 1.13.3: the vertical speed, smoothed ("↑ 2,400", "Level"); null on the ground or without a feed. */
  vs: { dir: "up" | "down" | "level"; text: string } | null;
}

const fmsLine = (f: GateFlight) => [`${f.from.iata ?? f.from.icao} → ${f.to.iata ?? f.to.icao}`, f.cruiseFt ? `cruise ${fl(f.cruiseFt)}` : null].filter(Boolean).join(" · ");
const feet = (ft: number) => (ft < 1000 ? `${Math.max(0, Math.round(ft / 10) * 10)} ft` : `${(Math.round(ft / 100) * 100).toLocaleString("en-GB")} ft`);
export const fl = (ft: number) => (ft >= 10_000 ? `FL${String(Math.round(ft / 100)).padStart(3, "0")}` : feet(ft));
/** The aircraft's level as the crew reads it: a flight level from pressure altitude at FL100 and above, the altimeter's feet below. */
export const altText = (s: FeedSample) => (levelFt(s) >= 10_000 ? fl(levelFt(s)) : feet(s.indAlt ?? s.alt));
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m` : `${Math.max(1, Math.round(m))} min`);

/**
 * Distance left along the FMS route (OFP Tower, Fenix): to the fix flown to, then leg by leg to
 * the destination runway; null when there's no plan for this flight. The fix flown to is the FMS's
 * own (plan.active) when it says, else worked out from the position. `total` is what's been flown
 * (great circle from the departure airport) plus what's left: the Fenix drops fixes as they're
 * passed, so the plan alone can't say how long the trip was.
 */
export function routeToGo(f: GateFlight, plan: FlightPlan | null | undefined, pos: { lat: number; lon: number }): { toGo: number; total: number } | null {
  if (!plan || plan.origin !== f.from.icao || plan.destination !== f.to.icao) return null;
  const all = plan.legs.filter((l) => !l.missed);
  if (all.length < 2) return null;
  let next: number;
  if (plan.active && plan.active.to < all.length && !plan.legs.slice(0, plan.active.to).some((l) => l.missed)) next = plan.active.to;
  else {
    // the fix after the nearest, unless the aircraft hasn't reached the nearest yet
    let near = 0;
    all.forEach((l, i) => {
      if (distNm(pos, l) < distNm(pos, all[near])) near = i;
    });
    next = near < all.length - 1 && distNm(pos, all[near + 1]) < distNm(all[near], all[near + 1]) ? near + 1 : near;
  }
  let toGo = distNm(pos, all[next]);
  for (let i = next + 1; i < all.length; i++) toGo += distNm(all[i - 1], all[i]);
  return { toGo, total: distNm(f.from, pos) + toGo };
}

export function liveFacts(f: GateFlight, g: GateState, live: FlightState | null, now: number, plan: FlightPlan | null = null): LiveFacts {
  const t = screenNow(now, f, g);
  const etd = f.stdMs + g.delay * MIN;
  const plannedEta = f.block != null ? etd + f.block * MIN : null;
  const total = f.nm ?? distNm(f.from, f.to);
  const s = live?.last ?? null;
  if (!live || !s) {
    const gone = t > etd;
    return {
      status: g.cancelled ? "Cancelled" : g.delay >= 5 ? "Delayed" : gone ? "Departed" : "On time",
      tone: g.cancelled ? "stop" : g.delay >= 5 ? "warn" : gone ? "done" : "plain",
      line: gone ? (plannedEta ? `Arrives ${localClock(plannedEta, f.to.tz)}` : null) : `Departs ${localClock(etd, f.from.tz)}`,
      alt: null,
      gs: null,
      toGo: null,
      minLeft: null,
      arrives: plannedEta,
      flown: 0,
      pos: null,
      hdg: null,
      vs: null,
    };
  }
  const air = live.stage === "flying" && live.phase !== "landed" && live.phase !== "taxiIn";
  // along the programmed route when there is one (OFP Tower, Fenix), else straight to the airport
  const byRoute = routeToGo(f, plan, s);
  const toGo = Math.round(byRoute?.toGo ?? distNm(s, f.to));
  // the FMS's time at the runway (OFP Tower, Fenix) knows the descent and the approach; else the
  // distance at the ground speed, which takes the cruise speed all the way down
  // after a go-around: no landing time until the next approach (vectors, a hold: nobody knows yet)
  const around = wentAround(live);
  // held against the Fenix's minute rounding (19:57 / 19:58 every 10 s)
  const fmsOn = steadyTime(`${f.from.icao}-${f.to.icao}`, air && !around ? fmsArrival(plan, f.to, s.t) : null, s.t);
  const minLeft = around ? null : fmsOn != null ? Math.max(0, (fmsOn - s.t) / MIN) : air && s.gs > 60 ? (toGo / s.gs) * 60 : null;
  // no time while going round: the schedule's would read as a fresh estimate
  const arrives = live.stamps.on ?? (minLeft != null ? s.t + minLeft * MIN : around ? null : plannedEta);
  const flown = live.stage === "arrived" || !air ? (live.stamps.on != null ? 1 : 0) : Math.min(1, Math.max(0, 1 - toGo / Math.max(1, byRoute?.total ?? total)));
  const rate = landingText(live.stamps);
  const z = (ms: number | null) => (ms == null ? null : localClock(ms, f.to.tz));
  // the level programmed in the aircraft (OFP Tower, Fenix) over the planned one
  const cruiseFt = plan?.cruiseFt ?? f.cruiseFt;
  const line: Record<FlightPhase, string | null> = {
    // an FMS flight has no schedule: its plan instead
    boarding: f.source === "fms" ? fmsLine(f) : `Off-block ${localClock(etd, f.from.tz)}`,
    doorsClosed: f.source === "fms" ? fmsLine(f) : `Off-block ${localClock(etd, f.from.tz)}`,
    pushback: live.stamps.out != null ? `Off-block ${localClock(live.stamps.out, f.from.tz)}` : null,
    taxi: f.runway ? `Runway ${f.runway}` : live.stamps.out != null ? `Off-block ${localClock(live.stamps.out, f.from.tz)}` : null,
    takeoff: f.runway ? `Runway ${f.runway}` : null,
    climb: around ? (live.trend === "up" ? `Passing ${altText(s)}` : `${altText(s)} · for another approach`) : `Passing ${altText(s)}${cruiseFt ? ` for ${fl(cruiseFt)}` : ""}`,
    cruise: around ? `${altText(s)} · for another approach` : minLeft != null ? `Landing in ${mins(minLeft)}` : null,
    descent: around ? `${altText(s)} · for another approach` : minLeft != null ? `Landing in ${mins(minLeft)}` : null,
    approach: minLeft != null ? `${mins(minLeft)} to landing` : null,
    landed: [z(live.stamps.on), rate].filter(Boolean).join(" · ") || null,
    taxiIn: [z(live.stamps.on) && `Landed ${z(live.stamps.on)}`, rate].filter(Boolean).join(" · ") || null,
    gate: [z(live.stamps.in) && `On stand ${z(live.stamps.in)}`, rate].filter(Boolean).join(" · ") || null,
  };
  return {
    status: phaseLabel(live),
    tone: TONE[live.phase],
    line: line[live.phase],
    // on the ground: GND and the ground speed (0 kt parked), rather than dashes
    alt: air ? altText(s) : "GND",
    gs: Math.round(s.gs),
    // on the ground after landing there's nothing left to fly
    toGo: live.stage === "arrived" || live.stamps.on != null ? null : toGo,
    minLeft,
    arrives,
    flown,
    pos: { lat: s.lat, lon: s.lon },
    hdg: s.hdg,
    vs: air ? vsText(live.vsAvg ?? s.vs) : null,
  };
}

const SOURCE: Record<FeedSource, string | null> = { link: "MSFS", replay: "Replay", vatsim: "VATSIM", clock: null };

/* ---------- the moving map, in the airline's colours ---------- */

/** Near the end the map closes in on the destination: this far out (nm), and at least this wide. */
const NEAR_NM = 150;
const NEAR_MIN_ACROSS_NM = 60;
/** Within this distance of the destination (nm) the map closes in to FINAL_ACROSS_NM across. */
const FINAL_NM = 10;
const FINAL_ACROSS_NM = 40;
/** A short FMS route (London City → Heathrow) is still shown at least this wide (nm). */
const ROUTE_MIN_ACROSS_NM = 40;
/** Runways are drawn this long (m): longer than most, so they read on the map. */
const RUNWAY_M = 7000;

/**
 * A runway as on a chart: asphalt with white edges, a dashed centre line, the threshold markings
 * across it at the threshold end and the runway number just past them, small. a = threshold.
 */
function Runway({ a, b, number, width }: { a: [number, number]; b: [number, number]; number: string; width: number }) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // across the runway
  const px = -uy;
  const py = ux;
  const at = (along: number, across = 0): [number, number] => [a[0] + ux * along + px * across, a[1] + uy * along + py * across];
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const keys = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((k) => k * width * 0.14);
  const keyLen = Math.min(width * 1.2, len * 0.12);
  const num = at(keyLen + width * 0.75);
  const c0 = at(keyLen + width * 1.5);
  const c1 = at(len - width * 0.6);
  return (
    <g className="gm-rwy">
      <line className="gm-rwy-edge" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={width} />
      <line className="gm-rwy-body" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={width * 0.82} />
      {c1 && len > keyLen + width * 3 && <line className="gm-rwy-mark" x1={c0[0]} y1={c0[1]} x2={c1[0]} y2={c1[1]} strokeWidth={width * 0.07} strokeDasharray={`${width * 0.5} ${width * 0.35}`} />}
      {keys.map((k) => {
        const s0 = at(width * 0.12, k);
        const s1 = at(keyLen, k);
        return <line key={k} className="gm-rwy-mark" x1={s0[0]} y1={s0[1]} x2={s1[0]} y2={s1[1]} strokeWidth={width * 0.08} />;
      })}
      {number && (
        <text className="gm-rwy-num" x={num[0]} y={num[1]} fontSize={width * 0.62} textAnchor="middle" dominantBaseline="central" transform={`rotate(${ang + 90} ${num[0]} ${num[1]})`}>
          {number}
        </text>
      )}
    </g>
  );
}

/**
 * The moving map in the airline's colours: sea, land, coastline, dashed borders and a 5° grid
 * (as the design sheet), the route, the line flown and the aircraft at its heading. With the
 * FMS plan (OFP Tower, Fenix) the route is the one programmed: waypoints as small dots (Δ for an
 * overfly), ← / → for a required turn, altitude constraints in Airbus magenta, the missed
 * approach faded. Within NEAR_NM of the destination it closes in on the destination, the
 * aircraft and the fixes still ahead, so the runway and the approach show.
 */
export function GateMap({
  f,
  facts,
  W,
  H,
  label,
  trail = [],
  plan = null,
  near = false,
  final = false,
}: {
  f: GateFlight;
  facts: LiveFacts;
  W: number;
  H: number;
  label: string;
  trail?: [number, number][];
  plan?: FlightPlan | null;
  near?: boolean;
  /** Within FINAL_NM of the destination: closer still, on the runway and the last fixes. */
  final?: boolean;
}) {
  const outlines = useOutlines();
  const terrain = useTerrain();
  const from: [number, number] = [f.from.lon, f.from.lat];
  const to: [number, number] = [f.to.lon, f.to.lat];
  const lon = facts.pos?.lon;
  const lat = facts.pos?.lat;
  const pos = useMemo<[number, number] | null>(() => (lon != null && lat != null ? [lon, lat] : null), [lon, lat]);
  // the FMS route, when it is this flight's
  const fromIcao = f.from.icao;
  const toIcao = f.to.icao;
  const legs = useMemo(() => (plan && plan.origin === fromIcao && plan.destination === toIcao && plan.legs.length >= 2 ? plan.legs : null), [plan, fromIcao, toIcao]);
  const routeLegs = useMemo(() => legs?.filter((l) => !l.missed) ?? null, [legs]);
  // which leg the aircraft is nearest: the fixes after it are still ahead
  const nearest = useMemo(() => {
    if (!routeLegs || !pos) return -1;
    let best = -1;
    let d = Infinity;
    routeLegs.forEach((l, i) => {
      const x = geoDistance([l.lon, l.lat], pos);
      if (x < d) {
        d = x;
        best = i;
      }
    });
    return best;
  }, [routeLegs, pos]);
  // when near, the view follows the aircraft in steps of about 15 nm (so the chart isn't redrawn every second)
  const posKey = (near || (routeLegs && (f.nm ?? 999) < 400)) && pos ? `${Math.round(pos[0] * 4)},${Math.round(pos[1] * 4)}` : "";
  const geo = useMemo(() => {
    const view = (pts: [number, number][], centre: [number, number], minAcrossRad: number | null) => {
      const proj = geoAzimuthalEquidistant()
        .rotate([-centre[0], -centre[1]])
        .fitExtent(
          [
            [W * 0.12, H * 0.14],
            [W * 0.88, H * 0.86],
          ],
          { type: "Feature", properties: {}, geometry: { type: "MultiPoint", coordinates: pts } },
        );
      // everything at one point (the aircraft parked at its destination): no extent to fit
      if (!Number.isFinite(proj.scale()) || !proj.translate().every(Number.isFinite)) {
        proj.scale((W * 0.76) / (minAcrossRad ?? 0.03)).translate([W / 2, H / 2]);
        return proj;
      }
      if (minAcrossRad != null && proj.scale() > (W * 0.76) / minAcrossRad) {
        // zoomed out to the minimum width: keep what it frames in the middle (the fit's offset was for the tighter zoom)
        const [x0, y0] = proj([centre[0], centre[1]])!;
        const xs = pts.map((p) => proj(p)![0]);
        const ys = pts.map((p) => proj(p)![1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2 - x0;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2 - y0;
        const k2 = (W * 0.76) / minAcrossRad / proj.scale();
        proj.scale(proj.scale() * k2).translate([W / 2 - cx * k2, H / 2 - cy * k2]);
      }
      return proj;
    };
    let proj;
    let reach;
    // a short hop (London City → Heathrow) stays fitted to the whole route and the aircraft all the
    // way, as at the gate: it's smaller than the near view. Anything longer closes in near the end.
    const short = !!routeLegs && routeLegs.length <= 24 && (f.nm ?? 999) < NEAR_NM;
    const R = 3440.065;
    if (final) {
      // the last miles: the destination's runway, the aircraft and the fixes left, about 40 nm across
      const rw = (plan?.runways ?? []).filter((r) => r.airport === f.to.icao).flatMap((r) => [r.start, r.end]);
      const ahead = (routeLegs ?? []).slice(Math.max(0, nearest)).map((l): [number, number] => [l.lon, l.lat]);
      const pts: [number, number][] = [to, ...rw, ...ahead, ...(pos ? [pos] : [])].filter((p) => geoDistance(p, to) * R < 25);
      proj = view(pts, to, FINAL_ACROSS_NM / R);
      reach = 0.03;
    } else if (near && !short) {
      const ahead = (routeLegs ?? []).slice(Math.max(0, nearest)).map((l): [number, number] => [l.lon, l.lat]);
      const rw = (plan?.runways ?? []).filter((r) => r.airport === f.to.icao).flatMap((r) => [r.start, r.end]);
      const pts: [number, number][] = [to, ...rw, ...ahead, ...(pos ? [pos] : [])].filter((p) => geoDistance(p, to) * R < NEAR_NM * 1.4);
      proj = view(pts, to, NEAR_MIN_ACROSS_NM / R);
      reach = 0.06;
    } else {
      const span = geoDistance(from, to);
      const pts: [number, number][] = routeLegs ? [...routeLegs.map((l): [number, number] => [l.lon, l.lat]), ...(pos ? [pos] : [])] : [0, 0.25, 0.5, 0.75, 1].map((k) => geoInterpolate(from, to)(k));
      // a whole FMS route is fitted as it is (at least ROUTE_MIN_ACROSS_NM); a plain line at least ~260 nm across
      proj = view(pts, geoInterpolate(from, to)(0.5), routeLegs ? ROUTE_MIN_ACROSS_NM / 3440.065 : 0.075);
      reach = span / 2;
    }
    proj.clipAngle(mapRadius(reach)).clipExtent([
      [0, 0],
      [W, H],
    ]);
    return { proj, path: geoPath(proj) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on what moves the view, not array identity
  }, [from[0], from[1], to[0], to[1], W, H, near, final, posKey, routeLegs, nearest, plan, f.nm]);
  const base = useMemo(() => baseLayers(geo.proj, geo.path, W, H, outlines, terrain), [geo, W, H, outlines, terrain]);
  const line = (a: [number, number], b: [number, number]) => geo.path({ type: "LineString", coordinates: [0, 0.2, 0.4, 0.6, 0.8, 1].map((k) => geoInterpolate(a, b)(k)) }) ?? "";
  const lineThrough = (pts: [number, number][]) => (pts.length > 1 ? (geo.path({ type: "LineString", coordinates: pts }) ?? "") : "");
  // stroke widths as on the design sheet's 1120-wide map, scaled to this one
  const k = W / 1120;
  // the line flown: from the departure through where the aircraft has been to where it is. The
  // trail starts when the page opened; before that (a page reloaded in flight) along the route
  const flownPath = pos ? lineThrough([from, ...routeBefore(routeLegs ?? f.route ?? null, trail[0] ?? pos), ...trail, pos]) : "";
  const pf = geo.proj(from);
  const pt = geo.proj(to);
  const pp = pos ? geo.proj(pos) : null;
  const inView = (p: [number, number] | null): p is [number, number] => !!p && p[0] > 0 && p[0] < W && p[1] > 0 && p[1] < H;
  // the plane points along the screen's own north at that spot (azimuthal: close enough to the heading)
  const hdg = facts.hdg ?? 0;
  const dot = (p: [number, number] | null, code: string, right: boolean) =>
    p && (
      <g>
        <circle className="gm-ap" cx={p[0]} cy={p[1]} r={W * 0.009} />
        <text className="gm-code" x={p[0] + (right ? 1 : -1) * W * 0.02} y={p[1] + W * 0.008} textAnchor={right ? "start" : "end"} fontSize={W * 0.032}>
          {code}
        </text>
      </g>
    );
  const right = (pt?.[0] ?? 0) >= (pf?.[0] ?? 0);
  // runways drawn RUNWAY_M long from the threshold along the course OFP Tower gives (stylised, not true length)
  const rwys = legs
    ? (plan?.runways ?? []).flatMap((r) => {
        const a = geo.proj(r.start);
        const b0 = geo.proj(r.end);
        if (!a || !b0) return [];
        const d = Math.hypot(b0[0] - a[0], b0[1] - a[1]) || 1;
        const len = (RUNWAY_M / 6371000) * geo.proj.scale();
        const b: [number, number] = [a[0] + ((b0[0] - a[0]) / d) * len, a[1] + ((b0[1] - a[1]) / d) * len];
        return [{ ...r, a, b }];
      })
    : [];
  // an airport with its runway drawn: no dot, and its code set off to the side, never on the bar
  const codeBy = (icao: string, p: [number, number] | null, code: string, right: boolean) => {
    const r = rwys.find((x) => x.airport === icao);
    if (!r || !p) return dot(p, code, right);
    const ux = r.b[0] - r.a[0];
    const uy = r.b[1] - r.a[1];
    const d = Math.hypot(ux, uy) || 1;
    // perpendicular, on the upper side, clear of the bar's width
    const flip = ux / d > 0 ? -1 : 1;
    const nx = (-uy / d) * flip;
    const ny = (ux / d) * flip;
    const mx = (r.a[0] + r.b[0]) / 2 + nx * W * 0.035;
    const my = (r.a[1] + r.b[1]) / 2 + ny * W * 0.035;
    return (
      <text className="gm-code" x={mx} y={my} textAnchor="middle" fontSize={W * 0.032}>
        {code}
      </text>
    );
  };
  const routeFits = !!routeLegs && routeLegs.length <= 24 && (f.nm ?? 999) < 400;
  // the fixes to name: the next few ahead (all ahead when near), not the airports themselves
  const named =
    routeLegs?.filter((l, i) => {
      if (l.pseudo || l.id.startsWith(f.from.icao) || l.id.startsWith(f.to.icao)) return false;
      if (nearest < 0) return i > 0 && i < routeLegs.length - 1;
      // the whole route fits on screen (near the end, or a short FMS route): every fix ahead; else the next 5
      return i > nearest && i <= nearest + (near || routeFits ? 24 : 5);
    }) ?? [];
  // the route with its turns (OFP Tower's turn geometry): fly-by fixes as rounded corners that start
  // leadNm early, fly-overs through the fix and then a swing outside it; straight lines otherwise
  const turnedRoute = useMemo(() => {
    if (!routeLegs) return "";
    const P = routeLegs.map((l) => geo.proj([l.lon, l.lat]));
    if (P.some((p) => !p)) return lineThrough(routeLegs.map((l) => [l.lon, l.lat]));
    const pts = P as [number, number][];
    const pxPerNm = geo.proj.scale() / 3440.065;
    const unit = (a: [number, number], b: [number, number]): [number, number] => {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
    };
    const at = (p: [number, number], u: [number, number], k: number) => `${(p[0] + u[0] * k).toFixed(1)},${(p[1] + u[1] * k).toFixed(1)}`;
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const t = routeLegs[i].turn;
      if (!t || i === pts.length - 1) {
        d += `L${p[0].toFixed(1)},${p[1].toFixed(1)}`;
        continue;
      }
      const uIn = unit(pts[i - 1], p);
      const uOut = unit(p, pts[i + 1]);
      const legIn = Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      const legOut = Math.hypot(pts[i + 1][0] - p[0], pts[i + 1][1] - p[1]);
      const r = t.radiusNm * pxPerNm;
      if (t.style === "flyby") {
        const lead = Math.min((t.leadNm ?? t.radiusNm) * pxPerNm, legIn * 0.45, legOut * 0.45);
        d += `L${at(p, uIn, -lead)}Q${p[0].toFixed(1)},${p[1].toFixed(1)} ${at(p, uOut, lead)}`;
      } else {
        // over the fix, carry on along the inbound course while turning, then join the outbound leg
        const out = Math.min(2 * r, legOut * 0.6);
        d += `L${p[0].toFixed(1)},${p[1].toFixed(1)}Q${at(p, uIn, Math.min(r * 1.5, legOut * 0.5))} ${at(p, uOut, out)}`;
      }
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the projection and the legs are what it draws
  }, [routeLegs, geo]);
  const missed = legs && routeLegs ? [routeLegs[routeLegs.length - 1], ...legs.filter((l) => l.missed)].map((l): [number, number] => [l.lon, l.lat]) : [];
  return (
    <svg className="gm" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid slice">
      <rect className="gm-sea" width={W} height={H} />
      <path className="gm-grid" d={base.minor} strokeWidth={1.5 * k} />
      <path className="gm-land" d={base.land} />
      <path className="gm-coast" d={base.coast} strokeWidth={3 * k} />
      <path className="gm-borders" d={base.borders} strokeWidth={3.4 * k} strokeDasharray={`${7 * k} ${6 * k}`} />
      {routeLegs ? (
        <>
          <path className="gm-togo" d={turnedRoute} strokeWidth={W * 0.004} strokeDasharray={`${W * 0.002} ${W * 0.012}`} />
          {missed.length > 1 && <path className="gm-missed" d={lineThrough(missed)} strokeWidth={W * 0.003} strokeDasharray={`${W * 0.01} ${W * 0.008}`} />}
          {pos && <path className="gm-flown" d={flownPath} strokeWidth={W * 0.006} />}
        </>
      ) : pos ? (
        <>
          <path className="gm-togo" d={line(pos, to)} strokeWidth={W * 0.004} strokeDasharray={`${W * 0.002} ${W * 0.012}`} />
          <path className="gm-flown" d={flownPath} strokeWidth={W * 0.006} />
        </>
      ) : (
        <path className="gm-togo" d={line(from, to)} strokeWidth={W * 0.004} strokeDasharray={`${W * 0.002} ${W * 0.012}`} />
      )}
      {/* runways above the map and the route, under the fixes, codes and aircraft: stylised 5 km bars from the threshold (OFP Tower), pure white, no text on them */}
      {rwys.map((r) => (
        <Runway key={`${r.role}-${r.runway}`} a={r.a} b={r.b} number={r.runway} width={W * 0.011} />
      ))}
      {named.map((l, i) => {
        const p = geo.proj([l.lon, l.lat]);
        if (!inView(p)) return null;
        const r = W * 0.0045;
        const overfly = l.flags.includes("overfly");
        const turn = l.flags.includes("turnLeft") ? " ←" : l.flags.includes("turnRight") ? " →" : "";
        const fs = W * 0.016;
        return (
          <g key={`${l.id}-${i}`} className="gm-wpt">
            {overfly ? <path d={`M${p[0]},${p[1] - r * 1.6}L${p[0] + r * 1.5},${p[1] + r}L${p[0] - r * 1.5},${p[1] + r}Z`} strokeWidth={k} /> : <circle cx={p[0]} cy={p[1]} r={r} strokeWidth={k} />}
            <text x={p[0] + r * 2.2} y={p[1] + fs * 0.35} fontSize={fs}>
              {/* a runway fix (EGLL09R) as its runway */}
              {l.id.startsWith(f.to.icao) && l.id.length > 4 ? l.id.slice(4) : l.id}
              {turn}
            </text>
            {l.alt && (
              <g className="gm-alt">
                <rect x={p[0] + r * 2} y={p[1] + fs * 0.6} width={fs * 0.62 * l.alt.text.length + fs * 0.6} height={fs * 1.15} rx={fs * 0.2} />
                <text x={p[0] + r * 2 + fs * 0.3} y={p[1] + fs * 1.48} fontSize={fs * 0.85}>
                  {l.alt.text}
                </text>
              </g>
            )}
          </g>
        );
      })}
      {inView(pf) || !near ? codeBy(f.from.icao, pf, f.from.iata ?? f.from.icao, !right) : null}
      {codeBy(f.to.icao, pt, f.to.iata ?? f.to.icao, right)}
      {pp && (
        <g transform={`translate(${pp[0]} ${pp[1]}) rotate(${hdg}) scale(${(W * 0.055) / 64}) translate(-32 -32)`}>
          <path className="gm-plane" d={PLANE} />
        </g>
      )}
    </svg>
  );
}

/* ---------- small parts shared by the views ---------- */

function Brand({ f }: { f: GateFlight }) {
  return (
    <span className="gv-brand">
      <svg className="gv-picto" viewBox="0 0 64 64" aria-hidden="true">
        <path d={PLANE} />
      </svg>
      <span>{f.airline}</span>
    </span>
  );
}

function Status({ facts, small }: { facts: LiveFacts; small?: boolean }) {
  return (
    <div className={`gv-status gs-${facts.tone}${small ? " is-small" : ""}`} aria-live="polite">
      <b>{facts.status}</b>
      {facts.line && <small>{facts.line}</small>}
    </div>
  );
}

function Tile({ k, v, unit }: { k: string; v: ReactNode; unit?: string }) {
  return (
    <div className="gv-tile">
      <small>{k}</small>
      <b className="mono">
        {v ?? "—"}
        {v != null && unit && <i> {unit}</i>}
      </b>
    </div>
  );
}

/** BRU ——✈······ DUB, with the distance to go over the plane. */
function Progress({ f, facts, showToGo = true }: { f: GateFlight; facts: LiveFacts; showToGo?: boolean }) {
  return (
    <div className="gv-prog" style={{ "--p": facts.flown } as CSSProperties}>
      <b className="mono">{f.from.iata ?? f.from.icao}</b>
      <span className="gv-prog-line" aria-hidden="true">
        <i />
        <svg viewBox="0 0 64 64">
          <path d={PLANE} />
        </svg>
        {showToGo && facts.toGo != null && <em className="mono">{facts.toGo.toLocaleString("en-GB")} nm to go</em>}
      </span>
      <b className="mono">{f.to.iata ?? f.to.icao}</b>
    </div>
  );
}

const ident = (f: GateFlight) => (
  <span className="gv-ident mono">
    {f.flightNo}
    {f.callsign && f.callsign.replace(/\s/g, "") !== f.flightNo.replace(/\s/g, "") && <span> · {f.callsign}</span>}
  </span>
);


/** "15:09Z" from a time (ms). */
const zClock = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)}Z`;

export interface AheadFix {
  id: string;
  via: string | null;
  /** Along the route from the aircraft (nm). */
  nm: number;
  /** The FMS's time over the fix, else the aircraft's ground speed's ("15:09Z"). */
  eta: string | null;
  /** When (ms), for countdowns; null without a time. */
  at: number | null;
  /** The course into the fix (deg true), from the fix before it (from the aircraft for the next one). */
  crs: number;
  /** The FMS's altitude constraint, as the MCDU shows it ("+FL150"). */
  alt: string | null;
}

export interface RouteAhead {
  passed: { id: string; via: string | null } | null;
  next: AheadFix[];
  /** Every fix to name (no pseudo points), with whether it's behind the aircraft. */
  all: { id: string; lat: number; lon: number; passed: boolean }[];
}

/**
 * The route panel's fixes: the one just passed and the next ones, with the distance along the
 * route and the time over each. From the FMS (OFP Tower, Fenix: its "active" legs), else from the
 * aircraft's position on the FMS route or the SimBrief OFP's; null without a route.
 */
export function routeAhead(f: GateFlight, plan: FlightPlan | null | undefined, s: FeedSample, count = 3): RouteAhead | null {
  type Fix = { id: string; lat: number; lon: number; via: string | null; eta?: string | null; hide?: boolean; alt?: string | null };
  let fixes: Fix[] = [];
  let to = -1;
  if (plan && plan.legs.length > 1) {
    fixes = plan.legs.filter((l) => !l.missed).map((l) => ({ id: l.id, lat: l.lat, lon: l.lon, via: l.via, eta: l.eta, hide: l.pseudo || !l.id, alt: l.alt?.text ?? null }));
    // the Fenix's own "flying to" (its plan keeps the last fix passed first)
    if (plan.active && plan.active.to < fixes.length && !plan.legs.slice(0, plan.active.to).some((l) => l.missed)) to = plan.active.to;
  } else if (f.route && f.route.length > 1) fixes = f.route;
  if (fixes.length < 2) return null;
  if (to < 0) {
    // by position: the fix after the nearest, unless the aircraft hasn't reached the nearest yet
    let near = 0;
    fixes.forEach((x, i) => {
      if (distNm(s, x) < distNm(s, fixes[near])) near = i;
    });
    to = near < fixes.length - 1 && distNm(s, fixes[near + 1]) < distNm(fixes[near], fixes[near + 1]) ? near + 1 : near;
    if (to === 0) to = 1;
  }
  let prev = to - 1;
  while (prev >= 0 && fixes[prev].hide) prev--;
  const next: AheadFix[] = [];
  let nm = distNm(s, fixes[to]);
  // times: the FMS's where it has one; past it, on from its last one at the ground speed
  let fromT = s.t;
  let fromNm = 0;
  let last: { lat: number; lon: number } = s;
  for (let i = to; i < fixes.length && next.length < count; i++) {
    if (i > to) nm += distNm(fixes[i - 1], fixes[i]);
    const fms = fixes[i].eta ? utcAt(fixes[i].eta!, s.t) : null;
    if (fms != null) {
      fromT = fms;
      fromNm = nm;
    }
    if (fixes[i].hide) continue;
    const at = fms ?? (s.gs > 50 ? fromT + ((nm - fromNm) / s.gs) * 3_600_000 : null);
    next.push({ id: fixes[i].id, via: fixes[i].via, nm, eta: at != null ? zClock(at) : null, at, crs: bearing(last, fixes[i]), alt: fixes[i].alt ?? null });
    last = fixes[i];
  }
  const all = fixes.flatMap((x, i) => (x.hide ? [] : [{ id: x.id, lat: x.lat, lon: x.lon, passed: i < to }]));
  return { passed: prev >= 0 ? { id: fixes[prev].id, via: fixes[prev].via } : null, next, all };
}

/** "289°" from a course (deg). */
export const deg = (d: number) => `${String(Math.round(d) % 360 || 360).padStart(3, "0")}°`;

/** The top of descent, estimated (3 nm per 1,000 ft to lose): nm and minutes to it; null when not before it. */
export function descentAhead(f: GateFlight, live: FlightState | null, toGo: number | null): { nm: number; min: number } | null {
  const s = live?.last;
  if (!s || toGo == null || s.gs < 100 || !(live.phase === "cruise" || live.phase === "climb")) return null;
  const nm = toGo - ((levelFt(s) - (f.to.elevFt ?? 0)) / 1000) * 3;
  return nm > 1 ? { nm, min: (nm / s.gs) * 60 } : null;
}

/**
 * Which side a flip card shows at this moment: -1 the front, else the back side's index. From the
 * clock, so every source on the PC turns at the same moment: `every` s on the front, then `hold` s
 * on a back side, the next back side each time round.
 */
export function flipSide(lk: Look, now: number, only = false): number {
  const t = Math.floor(now / 1000);
  if (only) return Math.floor(t / lk.hold) % Math.max(1, lk.backs.length);
  const cyc = lk.every + lk.hold;
  return t % cyc < lk.every ? -1 : Math.floor(t / cyc) % Math.max(1, lk.backs.length);
}

/** Minutes from the reading to a fix: its time over, else at the ground speed. */
const minsTo = (x: AheadFix, s: FeedSample) => (x.at != null ? (x.at - s.t) / MIN : s.gs > 50 ? (x.nm / s.gs) * 60 : null);
const nmText = (nm: number) => `${Math.round(nm).toLocaleString("en-GB")} nm`;

/** The fix passed (struck through), the one flown to (marked) and the ones after it. */
function LegRows({ ahead, rows = 3, passed = true, head = true, from = 0 }: { ahead: RouteAhead | null; rows?: number; passed?: boolean; head?: boolean; from?: number }) {
  if (!ahead || !ahead.next.length) return <div className="gv-legs-none">The route ahead shows once you’re on it</div>;
  return (
    <div className="gv-legs mono" role="table" aria-label="Route ahead">
      {head && (
        <div className="gv-leg is-head" role="row">
          <span>Fix</span>
          <span>Via</span>
          <span>Crs</span>
          <span>Dist</span>
          <span>ETA</span>
        </div>
      )}
      {passed && ahead.passed && from === 0 && (
        <div className="gv-leg is-past" role="row">
          <b>{ahead.passed.id}</b>
          <span>{ahead.passed.via ?? ""}</span>
          <span />
          <span />
          <span />
        </div>
      )}
      {ahead.next.slice(from, from + rows).map((x, i) => (
        <div className={`gv-leg${i + from === 0 ? " is-to" : ""}`} role="row" key={`${x.id}${i}`}>
          <b>{x.id}</b>
          <span>{x.via ?? ""}</span>
          <span>{deg(x.crs)}</span>
          <span>{nmText(x.nm)}</span>
          <span>{x.eta ?? ""}</span>
        </div>
      ))}
    </div>
  );
}

/** The route as a row of arrows: passed, the one flown to (lit), the next two. */
function Ribbon({ ahead, now }: { ahead: RouteAhead | null; now: number | null }) {
  if (!ahead || !ahead.next.length) return <div className="gv-legs-none">The route ahead shows once you’re on it</div>;
  const n0 = ahead.next[0];
  const m0 = now != null && n0.at != null ? Math.max(0, Math.round((n0.at - now) / MIN)) : null;
  return (
    <ol className="gv-ribbon mono" aria-label="Route ahead">
      {ahead.passed && (
        <li className="is-past">
          <b>{ahead.passed.id}</b>
          <small>passed</small>
        </li>
      )}
      {ahead.next.slice(0, 3).map((x, i) => (
        <li key={`${x.id}${i}`} className={i === 0 ? "is-to" : undefined}>
          <b>{x.id}</b>
          <small>{i === 0 ? [nmText(x.nm), m0 != null ? `${m0} min` : x.eta].filter(Boolean).join(" · ") : (x.eta ?? deg(x.crs))}</small>
        </li>
      ))}
    </ol>
  );
}

/** The next fix big, then the two after it. */
function NextBig({ ahead, now }: { ahead: RouteAhead | null; now: number | null }) {
  const n0 = ahead?.next[0];
  if (!ahead || !n0) return <div className="gv-legs-none">The route ahead shows once you’re on it</div>;
  const m0 = now != null && n0.at != null ? Math.max(0, Math.round((n0.at - now) / MIN)) : null;
  return (
    <div className="gv-nextbig">
      <small>Next{n0.via ? ` · ${n0.via}` : ""} · course {deg(n0.crs)}</small>
      <div className="gv-next-main mono">
        <b>{n0.id}</b>
        <span>{[nmText(n0.nm), m0 != null ? `${m0} min` : null, n0.eta].filter(Boolean).join(" · ")}</span>
      </div>
      <LegRows ahead={ahead} head={false} passed={false} rows={2} from={1} />
    </div>
  );
}

/** Passed, now, next, the top of descent (estimated) and the destination, as a line of stops. */
function Timeline({ f, ahead, td, facts, now }: { f: GateFlight; ahead: RouteAhead | null; td: { nm: number; min: number } | null; facts: LiveFacts; now: number | null }) {
  type Row = { k: string; id: string; info: string; at: string; cls: string };
  const rows: Row[] = [];
  if (ahead?.passed) rows.push({ k: "p", id: ahead.passed.id, info: ahead.passed.via ?? "", at: "", cls: "is-past" });
  for (const [i, x] of (ahead?.next.slice(0, 2) ?? []).entries()) rows.push({ k: `n${i}`, id: x.id, info: `${nmText(x.nm)} · ${deg(x.crs)}`, at: x.eta ?? "", cls: i === 0 ? "is-to" : "" });
  if (td && now != null) {
    const r = { k: "td", id: "T/D (est)", info: `in ${Math.round(td.min)} min`, at: zClock(now + td.min * MIN), cls: "is-td" };
    const after = rows.findIndex((x) => x.k.startsWith("n") && (ahead?.next[+x.k.slice(1)]?.nm ?? 0) > td.nm);
    if (after >= 0) rows.splice(after, 0, r);
    else rows.push(r);
  }
  rows.push({ k: "d", id: f.to.iata ?? f.to.icao, info: facts.toGo != null ? nmText(facts.toGo) : "", at: facts.arrives != null ? zClock(facts.arrives) : "", cls: "is-dest" });
  return (
    <ol className="gv-timeline mono" aria-label="Journey">
      {rows.map((r) => (
        <li key={r.k} className={r.cls}>
          <i aria-hidden="true" />
          <b>{r.id}</b>
          <span>{r.info}</span>
          <span>{r.at}</span>
        </li>
      ))}
    </ol>
  );
}

/** The back side of a flip card. */
function BackSide({ back, f, facts, live, plan, ahead, td, dest }: { back: LookBack; f: GateFlight; facts: LiveFacts; live: FlightState | null; plan: FlightPlan | null; ahead: RouteAhead | null; td: { nm: number; min: number } | null; dest: string }) {
  const s = live?.last ?? null;
  const n0 = ahead?.next[0];
  const top = (title: string) => (
    <div className="gv-card-top">
      <span className="mono">
        {f.flightNo} · {title}
      </span>
      <small>{facts.status}</small>
    </div>
  );
  if (back === "plan") {
    const rows = ahead?.next.slice(0, 7) ?? [];
    const tdAt = td ? rows.findIndex((x) => x.nm > td.nm) : -1;
    const v = plan?.vSpeeds;
    const crz = plan?.cruiseFt ?? f.cruiseFt;
    return (
      <>
        {top(`${f.from.icao} → ${f.to.icao}`)}
        <div className="gv-mcdu mono" role="table" aria-label="Flight plan">
          <div className="gv-mcdu-t">F-PLN{plan?.flightNumber ? ` · ${plan.flightNumber}` : ""}</div>
          {ahead?.passed && (
            <div className="gv-mcdu-r is-past" role="row">
              <span>{ahead.passed.id}</span>
              <span>{ahead.passed.via ?? ""}</span>
              <span />
              <span />
            </div>
          )}
          {rows.map((x, i) => (
            <Fragment key={`${x.id}${i}`}>
              {i === tdAt && td && s && <McduTd td={td} t={s.t} crz={crz} />}
              <div className={`gv-mcdu-r${i === 0 ? " is-to" : ""}`} role="row">
                <span>{x.id}</span>
                <span>{i === 0 ? deg(x.crs) : (x.via ?? deg(x.crs))}</span>
                <span>{x.eta?.replace("Z", "") ?? ""}</span>
                <span className={x.alt ? "is-alt" : undefined}>{x.alt ?? (i === 0 ? `${Math.round(x.nm)}NM` : Math.round(x.nm))}</span>
              </div>
            </Fragment>
          ))}
          {tdAt === -1 && td && s && <McduTd td={td} t={s.t} crz={crz} />}
          {!rows.length && <div className="gv-mcdu-r is-past">No plan from the FMS yet</div>}
          <div className="gv-mcdu-r is-dest" role="row">
            <span>{f.to.icao}</span>
            <span />
            <span>{facts.arrives != null ? zClock(facts.arrives).replace("Z", "") : ""}</span>
            <span>{facts.toGo != null ? Math.round(facts.toGo) : ""}</span>
          </div>
        </div>
        <div className="gv-card-facts mono">
          <span>{v ? [v.v1 && `V1 ${v.v1}`, v.vr && `VR ${v.vr}`, v.v2 && `V2 ${v.v2}`].filter(Boolean).join(" · ") : ""}</span>
          <span>{crz ? `CRZ FL${Math.round(crz / 100)}` : ""}</span>
        </div>
      </>
    );
  }
  if (back === "route") {
    const all = ahead?.all ?? [];
    const pts = all.length >= 2 ? all : [];
    const along = pts.reduce<number[]>((acc, x, i) => [...acc, i ? acc[i - 1] + distNm(pts[i - 1], x) : 0], []);
    const total = along.at(-1) || 1;
    const W = 440;
    const xAt = (d: number) => 14 + (d / total) * (W - 28);
    const every = Math.max(1, Math.ceil(pts.length / 9));
    const planeX = 14 + facts.flown * (W - 28);
    // the top of descent is td.nm ahead; what's left of the line (1 − flown) is facts.toGo
    const tdX = td && facts.toGo ? 14 + Math.min(1, facts.flown + (1 - facts.flown) * (td.nm / facts.toGo)) * (W - 28) : null;
    const flownMin = live?.stamps.off != null && s ? Math.round((s.t - live.stamps.off) / MIN) : null;
    const efob = s && inAirOf(live) ? fuelAtDest(s, facts.toGo) : null;
    return (
      <>
        {top(`${f.from.icao} → ${f.to.icao}`)}
        <svg className="gv-routeline" viewBox={`0 0 ${W} 74`} role="img" aria-label={`The route, ${Math.round(facts.flown * 100)}% flown`}>
          <line x1={14} y1={36} x2={W - 14} y2={36} className="is-ahead" />
          <line x1={14} y1={36} x2={planeX} y2={36} className="is-flown" />
          {pts.map((x, i) => (
            <g key={`${x.id}${i}`} className={x.passed ? "is-past" : undefined}>
              <circle cx={xAt(along[i])} cy={36} r={i === 0 || i === pts.length - 1 ? 5 : 2.6} />
              {(i % every === 0 || i === pts.length - 1) && (
                <text x={xAt(along[i])} y={(i / every) % 2 ? 60 : 22} textAnchor="middle">
                  {x.id}
                </text>
              )}
            </g>
          ))}
          {tdX != null && <rect className="is-td" x={tdX - 4.5} y={31.5} width={9} height={9} />}
          <g transform={`translate(${planeX} 36) rotate(90) translate(-11 -11)`}>
            <svg width={22} height={22} viewBox="0 0 64 64" className="is-plane">
              <path d={PLANE} />
            </svg>
          </g>
        </svg>
        <div className="gv-counts is-4">
          <Tile k="Off" v={live?.stamps.off != null ? zClock(live.stamps.off) : null} />
          <Tile k="Flown" v={flownMin != null ? mins(flownMin) : null} />
          <Tile k="Landing" v={facts.arrives != null ? zClock(facts.arrives) : null} />
          <Tile k={`Fuel at ${f.to.iata ?? f.to.icao}`} v={efob != null ? (efob / 1000).toFixed(1) : null} unit="t" />
        </div>
        <div className="gv-card-facts mono">
          <span>{(plan?.cruiseFt ?? f.cruiseFt) ? `CRZ FL${Math.round((plan?.cruiseFt ?? f.cruiseFt)! / 100)}` : ""}</span>
          <span>{plan?.alternate ? `Alt ${plan.alternate}` : ""}</span>
          <span>{dest}</span>
        </div>
      </>
    );
  }
  // by the numbers
  const toNext = n0 && s ? minsTo(n0, s) : null;
  const hd = s?.wind && s.hdg != null ? Math.round(s.wind[1] * Math.cos(((s.wind[0] - s.hdg) * Math.PI) / 180)) : null;
  const drift = s?.trk != null && s.hdgMag != null ? Math.round(((s.trk - s.hdgMag + 540) % 360) - 180) : null;
  const efob = s && inAirOf(live) ? fuelAtDest(s, facts.toGo) : null;
  const flownNm = s ? Math.round(distNm(f.from, s)) : null;
  const inAirMin = live?.stamps.off != null && s ? Math.round((s.t - live.stamps.off) / MIN) : null;
  return (
    <>
      {top("by the numbers")}
      <div className="gv-counts">
        <Tile k={n0 ? `To ${n0.id}` : "Next fix"} v={n0 ? Math.round(n0.nm) : null} unit="nm" />
        <Tile k="To descent · est" v={td ? Math.round(td.nm) : null} unit="nm" />
        <Tile k={`To ${f.to.iata ?? f.to.icao}`} v={facts.toGo} unit="nm" />
      </div>
      <div className="gv-counts-sub mono">
        <span>{toNext != null ? `${Math.max(0, Math.round(toNext))} min · ${deg(n0!.crs)}` : ""}</span>
        <span>{td ? `${Math.round(td.min)} min` : ""}</span>
        <span>{facts.minLeft != null ? mins(facts.minLeft) : ""}</span>
      </div>
      <dl className="gv-kv mono">
        <div>
          <dt>Fuel at {f.to.iata ?? f.to.icao} ≈</dt>
          <dd>{efob != null ? `${efob.toLocaleString("en-GB")} kg` : "—"}</dd>
        </div>
        <div>
          <dt>Burning</dt>
          <dd>{s?.ffKgH != null ? `${(s.ffKgH / 1000).toFixed(1)} t/h` : "—"}</dd>
        </div>
        <div>
          <dt>{hd != null && hd < 0 ? "Tailwind" : "Headwind"}</dt>
          <dd>{hd != null ? `${Math.abs(hd)} kt` : "—"}</dd>
        </div>
        <div>
          <dt>Drift</dt>
          <dd>{drift != null ? `${drift > 0 ? "+" : ""}${drift}°` : "—"}</dd>
        </div>
        <div>
          <dt>Flown</dt>
          <dd>{flownNm != null ? nmText(flownNm) : "—"}</dd>
        </div>
        <div>
          <dt>In the air</dt>
          <dd>{inAirMin != null ? mins(inAirMin) : "—"}</dd>
        </div>
      </dl>
    </>
  );
}

function McduTd({ td, t, crz }: { td: { nm: number; min: number }; t: number; crz: number | null }) {
  return (
    <div className="gv-mcdu-r is-td" role="row">
      <span>(T/D)</span>
      <span>est</span>
      <span>{zClock(t + td.min * MIN).replace("Z", "")}</span>
      <span>{crz ? `FL${Math.round(crz / 100)}` : ""}</span>
    </div>
  );
}

const inAirOf = (live: FlightState | null) => !!live && live.stage === "flying" && live.phase !== "landed" && live.phase !== "taxiIn";

/** Fuel at the destination (kg), estimated: on board less the flow over the time left at this speed; null on the ground or without the figures. */
export function fuelAtDest(s: FeedSample, toGoNm: number | null): number | null {
  if (s.fobKg == null || s.ffKgH == null || toGoNm == null || s.gs < 50 || s.onGround) return null;
  return Math.max(0, Math.round((s.fobKg - s.ffKgH * (toGoNm / s.gs)) / 10) * 10);
}

/** The seatbelt sign while it's on (OFP Tower): a small lit sign in the view's corner. */
export function Belt({ live }: { live: FlightState | null }) {
  if (live?.last?.seatbelts !== true) return null;
  return (
    <svg className="gv-belt" viewBox="0 0 24 24" role="img" aria-label="Seatbelt sign on">
      <circle cx="12" cy="4.2" r="2.3" />
      <path d="M8.4 8.2h7.2a1.6 1.6 0 0 1 1.6 1.6v5.4h-2.4v6.6h-5.6v-6.6H6.8V9.8a1.6 1.6 0 0 1 1.6-1.6z" />
      <rect x="4" y="12" width="16" height="2.2" rx="1.1" className="gv-belt-strap" />
      <rect x="10.2" y="11.2" width="3.6" height="3.8" rx="0.6" className="gv-belt-buckle" />
    </svg>
  );
}

/* ---------- the views ---------- */

export interface ViewProps {
  flight: GateFlight;
  state: GateState;
  now: number;
  wx: GateWx | null;
  live: FlightState | null;
  source: FeedSource;
  /** The OBS scene this page is in (only inside an OBS browser source). */
  scene?: string | null;
  /** Where the aircraft has been, for the flown line. */
  trail?: [number, number][];
  /** The route programmed in the aircraft's FMS (OFP Tower, Fenix). */
  plan?: FlightPlan | null;
  /** 1.13, OFP Tower: its summary of the flight, for the ending screen. */
  summary?: FlightSummary | null;
}

/**
 * The gate screen in one of its views. Every view sits on the same 16:9 canvas (container units);
 * the views drawn over the sim leave everything outside their panels transparent.
 */
export function GateViewScreen(p: ViewProps & { back?: number | null; step?: { ls: Layers; key: string; from: number } | null }) {
  const ls = p.step?.ls ?? shownLooks(p.state, p.live, p.scene ?? null, p.plan ?? null);
  const from = p.step?.from ?? null;
  // 1.14: a rotation's step fades in over the one before
  const inner =
    ls.length === 1 ? (
      <LookScreen {...p} look={ls[0]} stepFrom={from} />
    ) : (
      // layers: each on the same 16:9, the first at the bottom
      <div className="gv-stack">
        {ls.map((l, i) => (
          <div className="gv-layer" key={i}>
            <LookScreen {...p} look={l} stepFrom={from} />
          </div>
        ))}
      </div>
    );
  return p.step ? (
    <div className="gv-step" key={p.step.key}>
      {inner}
    </div>
  ) : (
    inner
  );
}

/** One look: a view at its size and corner. `back` shows a flip card's back side (that index) instead of following its timer. */
function LookScreen(p: ViewProps & { look: Look; back?: number | null; stepFrom?: number | null }) {
  const lk = p.look;
  const view = lk.v;
  if (view === "full") return <GateScreen flight={p.flight} state={p.state} now={p.now} wx={p.wx} live={p.live} source={SOURCE[p.source]} plan={p.plan ?? null} belt={lk.belt} />;
  if (view === "countdown") {
    // the stream's start: from the page loading, a clock time, or the flight's off-block (its delay too)
    const std = p.flight.source === "fms" ? null : (p.state.stdAt ?? p.flight.stdMs) + p.state.delay * MIN;
    const at = goTarget(p.state.go, p.state.goFrom, std, p.now);
    return <GateScreen flight={p.flight} state={p.state} now={p.now} wx={p.wx} live={null} plan={p.plan ?? null} belt={false} countdown={at} />;
  }
  if (view === "ending") return <EndingView {...p} />;
  const at = { "data-size": lk.size, "data-pos": lk.pos } as Record<string, string>;
  const f = p.flight;
  const bg = routeColor(f.brand);
  const ink = textOn(bg);
  const accent = f.brand?.colors.secondary && /^#[0-9a-f]{6}$/i.test(f.brand.colors.secondary) && f.brand.colors.secondary.toLowerCase() !== bg.toLowerCase() ? f.brand.colors.secondary : ink;
  const facts = liveFacts(f, p.state, p.live, p.now, p.plan ?? null);
  const t = screenNow(p.now, f, p.state);
  // two airports in one city (London City → Heathrow): their own names
  const sameCity = cityName(f.to) != null && cityName(f.to) === cityName(f.from);
  const dest = sameCity ? shortName(f.to.name, cityName(f.to)) : (cityName(f.to) ?? f.to.name);
  const style = { "--gs-bg": bg, "--gs-ink": ink, "--gs-accent": accent } as CSSProperties;
  const label = `Gate screen: ${f.flightNo} to ${dest}`;
  // with a feed, the aircraft's own time (a replay runs in the recording's sim time)
  const clock = <span className="gv-clock mono">{new Date(p.live?.last?.t ?? t).toISOString().slice(11, 16)}Z</span>;
  const mapLabel = `Map: ${f.from.iata ?? f.from.icao} to ${f.to.iata ?? f.to.icao}${facts.toGo != null ? `, ${facts.toGo} nm to go` : ""}`;
  const arrives = facts.arrives != null ? localClock(facts.arrives, f.to.tz) : null;
  // the end of the flight: the map closes in on the destination
  const down = p.live?.stamps.on != null; // landed: no distance to go, still at the destination
  const near = !!p.live && (p.live.stage === "arrived" || (p.live.stage === "flying" && (down || (facts.toGo != null && facts.toGo < NEAR_NM))));
  const final = !!p.live && p.live.stage === "flying" && (down || (facts.toGo != null && facts.toGo <= FINAL_NM));
  const sm = p.live?.last ?? null;
  const inAir = !!p.live && p.live.stage === "flying" && p.live.phase !== "landed" && p.live.phase !== "taxiIn";
  const ahd = sm && p.live?.stage !== "arrived" ? routeAhead(f, p.plan, sm, 6) : null;
  const td = descentAhead(f, p.live, facts.toGo);
  const belt = lk.belt && <Belt live={p.live} />;
  let v2: ShownView = view;

  // the cards that flip: the front most of the time, a back side now and then (never near the ground)
  if (VIEW_INFO[view].flip) {
    const steady = !p.live || p.live.stage !== "flying" || ["takeoff", "approach", "landed", "taxiIn"].includes(p.live.phase);
    // 1.14, backs only (a rotation's step): straight to the back sides, from when the step began
    const side = p.back != null ? p.back : !lk.backs.length ? -1 : lk.only ? flipSide(lk, p.now - (p.stepFrom ?? 0), true) : steady ? -1 : flipSide(lk, p.now);
    const back = side >= 0 ? lk.backs[side % lk.backs.length] : null;
    if (back) {
      return (
        <div className="gv gv-over" style={style} {...at} role="region" aria-label={`${label}: ${BACKS.find((b) => b.k === back)?.name}`}>
          <div className={`gv-back gv-turn is-${back}`} key={`b${side}`}>
            <BackSide back={back} f={f} facts={facts} live={p.live} plan={p.plan ?? null} ahead={ahd} td={td} dest={dest} />
          </div>
        </div>
      );
    }
    v2 = view === "g6b" ? "corner" : "card";
  }

  // G6a: the map corner with the route
  if (v2 === "g6a1" || v2 === "g6a2" || v2 === "g6a3") {
    return (
      <div className="gv gv-over" style={style} {...at} role="region" aria-label={label}>
        <div className={`gv-corner is-${v2}`}>
          <div className="gv-corner-top">
            <span className="mono">{f.flightNo}</span>
            <b>{dest}</b>
            {belt}
            <small>{facts.status}</small>
          </div>
          <div className="gv-corner-map">
            <GateMap f={f} facts={facts} W={800} H={v2 === "g6a2" ? 520 : 440} label={mapLabel} trail={p.trail} plan={p.plan} near={near} final={final} />
          </div>
          {v2 === "g6a1" && <LegRows ahead={ahd} />}
          {v2 === "g6a2" && <Ribbon ahead={ahd} now={sm?.t ?? null} />}
          {v2 === "g6a3" && <NextBig ahead={ahd} now={sm?.t ?? null} />}
          <div className="gv-corner-facts mono">
            <span>{facts.alt ?? "—"}</span>
            <span>{facts.gs != null ? `${facts.gs} kt` : "—"}</span>
            <span>{facts.minLeft != null ? <>{mins(facts.minLeft)}<span className="gv-xs-long"> to landing</span></> : (facts.line ?? "")}</span>
          </div>
        </div>
      </div>
    );
  }

  // G7a: the corner card with the route
  if (v2 === "g7a1" || v2 === "g7a2" || v2 === "g7a3") {
    const togo7 = facts.minLeft != null ? <>{mins(facts.minLeft)}<span className="gv-xs-long"> to go</span></> : facts.line;
    const toNext = ahd?.next[0] && sm ? minsTo(ahd.next[0], sm) : null;
    return (
      <div className="gv gv-over" style={style} {...at} role="region" aria-label={label}>
        <div className={`gv-card is-${v2}`}>
          <div className="gv-card-top">
            <span className="mono">{v2 === "g7a3" ? `${f.flightNo} · ${f.from.iata ?? f.from.icao} → ${f.to.iata ?? f.to.icao}` : f.flightNo}</span>
            {belt}
            <small>{facts.status}</small>
          </div>
          {v2 !== "g7a3" && <b className="gv-card-dest">{dest}</b>}
          {v2 === "g7a1" && <Progress f={f} facts={facts} showToGo={false} />}
          {v2 === "g7a1" && <LegRows ahead={ahd} passed={false} />}
          {v2 === "g7a2" && <Timeline f={f} ahead={ahd} td={td} facts={facts} now={sm?.t ?? null} />}
          {v2 === "g7a3" && (
            <>
              <div className="gv-counts">
                <Tile k={ahd?.next[0] ? `Next · ${ahd.next[0].id}` : "Next fix"} v={toNext != null ? Math.max(0, Math.round(toNext)) : null} unit="min" />
                <Tile k="Descent · est" v={td ? Math.round(td.min) : null} unit="min" />
                <Tile k="Landing" v={facts.minLeft != null ? Math.round(facts.minLeft) : null} unit="min" />
              </div>
              <LegRows ahead={ahd} passed={false} head={false} rows={2} />
            </>
          )}
          <div className="gv-card-facts mono">
            <span>{facts.alt ?? "—"}</span>
            <span>{facts.gs != null ? `${facts.gs} kt` : "—"}</span>
            <span>{v2 === "g7a3" && sm && (sm.hdgMag ?? sm.hdg) != null && inAir ? `HDG ${deg((sm.hdgMag ?? sm.hdg)!)}` : (togo7 ?? "")}</span>
          </div>
        </div>
      </div>
    );
  }

  if (view === "route") {
    const s = p.live?.last ?? null;
    const air = !!p.live && p.live.stage === "flying" && p.live.phase !== "landed" && p.live.phase !== "taxiIn";
    const ahead = s && p.live?.stage !== "arrived" ? routeAhead(f, p.plan, s) : null;
    const hdg = s ? (s.hdgMag ?? s.hdg) : null;
    const efob = s && air ? fuelAtDest(s, facts.toGo) : null;
    return (
      <div className="gv gv-map is-route" style={style} {...at} role="region" aria-label={label}>
        <div className="gv-map-pic">
          <GateMap f={f} facts={facts} W={1100} H={1080} label={mapLabel} trail={p.trail} plan={p.plan} near={near} final={final} />
        </div>
        <div className="gv-rail">
          <div className="gv-rail-top">
            <Brand f={f} />
            {clock}
          </div>
          {ident(f)}
          <div className="gv-dest is-small" style={{ "--fit": Math.min(1, 12 / dest.length) } as CSSProperties}>
            {dest}
          </div>
          <ol className="gv-route mono" aria-label="Route ahead">
            {ahead?.passed && (
              <li className="is-passed">
                <b>{ahead.passed.id}</b>
                <span>{ahead.passed.via ?? ""}</span>
                <span />
                <span />
              </li>
            )}
            {ahead?.next.map((x, i) => (
              <li key={`${x.id}${i}`} className={i === 0 ? "is-next" : undefined}>
                <b>{x.id}</b>
                <span>{x.via ?? ""}</span>
                <span>{Math.round(x.nm).toLocaleString("en-GB")} nm</span>
                <span>{x.eta ?? ""}</span>
              </li>
            ))}
            {!ahead && <li className="is-none">{f.source === "simbrief" || p.plan ? "Route ahead after take-off" : "No route: a SimBrief OFP or the FMS plan gives one"}</li>}
          </ol>
          <div className="gv-tiles">
            <Tile k="Level" v={facts.alt} />
            <Tile k="Speed" v={facts.gs} unit="kt" />
            <Tile k="Heading" v={hdg != null && air ? `${String(Math.round(hdg) % 360 || 360).padStart(3, "0")}°` : null} />
            <Tile k="Fuel at dest · est" v={efob != null ? efob.toLocaleString("en-GB") : null} unit="kg" />
          </div>
          <Status facts={facts} />
        </div>
      </div>
    );
  }

  if (view === "map" || view === "mapwin") {
    return (
      <div className={`gv gv-map${view === "mapwin" ? " is-win" : ""}`} style={style} {...at} role="region" aria-label={label}>
        <div className="gv-map-pic">
          <GateMap f={f} facts={facts} W={1100} H={1080} label={mapLabel} trail={p.trail} plan={p.plan} near={near} final={final} />
        </div>
        <div className="gv-rail">
          <div className="gv-rail-top">
            <Brand f={f} />
            {clock}
          </div>
          {ident(f)}
          {sameCity && <div className="gv-dest-city">{cityName(f.to)}</div>}
          <div className="gv-dest" style={{ "--fit": Math.min(1, 10 / dest.length) } as CSSProperties}>
            {dest}
          </div>
          {view === "map" && <div className="gv-sub">from {sameCity ? f.from.name.replace(/ Airport$/, "") : (cityName(f.from) ?? f.from.name)}{f.typeName ? ` · ${f.typeName}` : ""}</div>}
          {view === "mapwin" && <div className="gv-window" aria-hidden="true" />}
          <div className="gv-tiles">
            <Tile k="Altitude" v={facts.alt} />
            <Tile k="Speed" v={facts.gs} unit="kt" />
            {view === "map" && <Tile k="To go" v={facts.toGo?.toLocaleString("en-GB") ?? null} unit="nm" />}
            {view === "map" && <Tile k="Arrives" v={arrives} />}
          </div>
          <Status facts={facts} />
        </div>
      </div>
    );
  }

  if (view === "frame") {
    return (
      <div className="gv gv-frame" style={style} {...at} role="region" aria-label={label}>
        <div className="gv-window" aria-hidden="true" />
        <div className="gv-rail">
          <div className="gv-rail-top">
            <Brand f={f} />
            {lk.belt && <Belt live={p.live} />}
            {clock}
          </div>
          {ident(f)}
          {sameCity && <div className="gv-dest-city">{cityName(f.to)}</div>}
          <div className="gv-dest" style={{ "--fit": Math.min(1, 10 / dest.length) } as CSSProperties}>
            {dest}
          </div>
          <div className="gv-frame-map">
            <GateMap f={f} facts={facts} W={600} H={560} label={mapLabel} trail={p.trail} plan={p.plan} near={near} final={final} />
          </div>
          <div className="gv-tiles">
            <Tile k="Altitude" v={facts.alt} />
            <Tile k="Speed" v={facts.gs} unit="kt" />
          </div>
        </div>
        <div className="gv-under">
          <Status facts={facts} />
          <div className="gv-under-prog">
            <Progress f={f} facts={facts} />
            <div className="gv-under-times mono">
              <span>{p.live?.stamps.off != null ? `off ${localClock(p.live.stamps.off, f.from.tz)}` : f.source === "fms" ? "" : `std ${localClock(f.stdMs, f.from.tz)}`}</span>
              <span>{arrives ? `${p.live?.stamps.on != null ? "on" : "eta"} ${arrives}` : ""}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (v2 === "corner") {
    return (
      <div className="gv gv-over" style={style} {...at} role="region" aria-label={label}>
        <div className="gv-corner">
          <div className="gv-corner-top">
            <span className="mono">{f.flightNo}</span>
            <b>{dest}</b>
            {lk.belt && <Belt live={p.live} />}
            <small>{facts.status}</small>
          </div>
          <div className="gv-corner-map">
            <GateMap f={f} facts={facts} W={800} H={520} label={mapLabel} trail={p.trail} plan={p.plan} near={near} final={final} />
          </div>
          <div className="gv-corner-facts mono">
            <span>{facts.alt ?? "—"}</span>
            <span>{facts.gs != null ? `${facts.gs} kt` : "—"}</span>
            <span>{facts.minLeft != null ? <>{mins(facts.minLeft)}<span className="gv-xs-long"> to landing</span></> : (facts.line ?? "")}</span>
          </div>
        </div>
      </div>
    );
  }

  if (v2 === "strip") {
    return (
      <div className="gv gv-over" style={style} {...at} role="region" aria-label={label}>
        <div className="gv-strip">
          <div className="gv-strip-id">
            <b className="mono">
              {f.flightNo}
              {lk.belt && <Belt live={p.live} />}
            </b>
            <small>{f.airline}</small>
          </div>
          <Progress f={f} facts={facts} showToGo={false} />
          <Tile k="Level" v={facts.alt} />
          <Tile k="Speed" v={facts.gs} unit="kt" />
          {lk.vs && <Tile k="V/S" v={facts.vs?.text ?? null} unit={facts.vs && facts.vs.dir !== "level" ? "fpm" : undefined} />}
          <div className={`gv-strip-st gs-${facts.tone}`} aria-live="polite">
            <small>{facts.minLeft != null ? `${facts.status} · landing in` : facts.status}</small>
            <b className="mono">{facts.minLeft != null ? mins(facts.minLeft) : (facts.line ?? facts.status)}</b>
          </div>
        </div>
      </div>
    );
  }

  // card and pill (G5)
  const togo = facts.minLeft != null ? `${mins(facts.minLeft)} to go` : facts.line;
  // 1.13.3: climbing or descending, the level and the vertical speed ("FL120 ↑2,400")
  const vsBit = lk.vs && facts.vs && facts.vs.dir !== "level" && facts.alt ? ` · ${facts.alt} ${facts.vs.text.replace(" ", "")}` : "";
  if (v2 === "line") {
    // G5b: one row, the phase in its own colour
    return (
      <div className="gv gv-over" style={style} {...at} role="region" aria-label={label}>
        <div className="gv-pill gv-line mono" aria-live="polite">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <path d={PLANE} />
          </svg>
          <span>
            {f.flightNo} · {f.from.iata ?? f.from.icao} → {f.to.iata ?? f.to.icao}
            {togo ? ` · ${togo}` : ""}
            {vsBit}
          </span>
          {lk.belt && <Belt live={p.live} />}
          <b className={`gv-line-phase gs-${facts.tone}`}>{facts.status}</b>
        </div>
      </div>
    );
  }
  return (
    <div className="gv gv-over" style={style} {...at} role="region" aria-label={label}>
      {v2 === "pill" ? (
        <div className="gv-pill mono" aria-live="polite">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <path d={PLANE} />
          </svg>
          <span>
            {f.flightNo} · {f.from.iata ?? f.from.icao} → {f.to.iata ?? f.to.icao}
            {togo ? ` · ${togo}` : ` · ${facts.status}`}
            {vsBit}
          </span>
          {lk.belt && <Belt live={p.live} />}
        </div>
      ) : (
        <div className="gv-card" aria-live="polite">
          <div className="gv-card-top">
            <span className="mono">{f.flightNo}</span>
            {lk.belt && <Belt live={p.live} />}
            <small>{facts.status}</small>
          </div>
          <b className="gv-card-dest">{dest}</b>
          <Progress f={f} facts={facts} showToGo={false} />
          <div className="gv-card-facts mono">
            <span>{facts.alt ?? "—"}</span>
            <span>{facts.gs != null ? `${facts.gs} kt` : "—"}</span>
            <span>{facts.minLeft != null ? <>{mins(facts.minLeft)}<span className="gv-xs-long"> to go</span></> : (togo ?? "")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- examples for the Stream panel: the flight on screen at each stage ---------- */

/**
 * An example of the aircraft at a stage of this flight, for the Stream panel's thumbnails and its
 * phase preview: at the gate, taxiing out, half-way at the cruise level, at the arrival gate.
 * Illustrative only (the panel labels it so); the stream itself follows the live feed.
 */
/* ---------- 1.13: the ending screen ---------- */

/** The default sign-off under the game window. */
export const BYE = "That's the stream for today. Thanks for flying along, catch me next time!";

/**
 * The ending screen: a window for the game top left, the sign-off under it, and on the right the
 * flight's numbers and the route as flown. The numbers come from OFP Tower's summary, else what this
 * page saw, else the ending a page on this PC kept (an OBS source refreshed after the flight).
 */
function EndingView(p: ViewProps) {
  const f = p.flight;
  const key = routeKey(f);
  const [kept, setKept] = useState<EndingRecord | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        setKept(readEnding(window.localStorage.getItem(ENDING_KEY), f, Date.now()));
      } catch {
        setKept(null);
      }
    };
    read();
    // another OBS source on this PC kept it
    const on = (e: StorageEvent) => e.key === ENDING_KEY && read();
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the flight is its route
  }, [key]);
  const plan = p.plan ?? null;
  const rw = (role: "departure" | "arrival") => plan?.runways.find((r) => r.role === role && r.airport === (role === "departure" ? f.from.icao : f.to.icao))?.runway ?? null;
  const x = endStats(f, p.live, p.summary ?? null, kept, rw("departure") ?? f.runway, rw("arrival"));
  const trail = p.trail && p.trail.length > 1 ? p.trail : (kept?.trail ?? []);
  const bg = routeColor(f.brand);
  const ink = textOn(bg);
  const accent = f.brand?.colors.secondary && /^#[0-9a-f]{6}$/i.test(f.brand.colors.secondary) && f.brand.colors.secondary.toLowerCase() !== bg.toLowerCase() ? f.brand.colors.secondary : ink;
  const style = { "--gs-bg": bg, "--gs-ink": ink, "--gs-accent": accent } as CSSProperties;
  const facts = liveFacts(f, p.state, p.live, p.now, plan);
  const fromName = cityName(f.from) ?? f.from.name;
  const toName = cityName(f.to) ?? f.to.name;
  const t = (ms: number | null, tz: string | null) => (ms == null ? null : localClock(ms, tz));
  const kg = (n: number | null) => (n == null ? null : `${Math.round(n).toLocaleString("en-GB")}`);
  const tiles: { k: string; v: string | null; unit?: string; wide?: boolean }[] = [
    { k: "Block time", v: x.block != null ? dur(x.block) : null },
    { k: "In the air", v: x.air != null ? dur(x.air) : null },
    { k: `Take-off${x.depRunway ? ` · ${x.depRunway}` : ""}`, v: t(x.off, f.from.tz) },
    { k: `Touchdown${x.arrRunway ? ` · ${x.arrRunway}` : ""}`, v: t(x.on, f.to.tz) },
    { k: "Landing", v: x.fpm != null ? `${Math.round(x.fpm)}` : null, unit: "fpm" },
    { k: x.bounces ? `G · ${x.bounces} bounce${x.bounces > 1 ? "s" : ""}` : "G", v: x.peakG != null ? x.peakG.toFixed(2) : null, unit: "G" },
    { k: "Top", v: x.maxAltFt != null ? (x.maxAltFt >= 18_000 ? `FL${String(Math.round(x.maxAltFt / 100)).padStart(3, "0")}` : `${Math.round(x.maxAltFt).toLocaleString("en-GB")} ft`) : null },
    { k: "Fastest", v: x.maxGsKt != null ? `${Math.round(x.maxGsKt)}` : null, unit: "kt" },
    { k: "Flown", v: x.distanceNm != null ? `${Math.round(x.distanceNm).toLocaleString("en-GB")}` : null, unit: "nm" },
    { k: "Trip fuel", v: kg(x.tripKg), unit: "kg" },
    { k: "Cruise burn", v: kg(x.cruiseFfKgH), unit: "kg/h" },
    // against the schedule's arrival (SimBrief, the Finder): on time within 2 min
    { k: `On blocks${x.late == null ? "" : Math.abs(x.late) < 3 ? " · on time" : ` · ${x.late < 60 && x.late > -60 ? `${Math.abs(x.late)} min` : dur(Math.abs(x.late))} ${x.late > 0 ? "late" : "early"}`}`, v: t(x.in, f.to.tz) },
  ];
  const shown = tiles.filter((y) => y.v != null);
  // the flight as the passengers had it: the weather they stepped out into, on time or not, the landing
  const feel = landingFeel(x.fpm, x.peakG, x.bounces);
  const wx = p.wx && (p.wx.temp != null || p.wx.text) ? p.wx : null;
  const onTime = x.late == null ? null : Math.abs(x.late) < 3 ? { word: "On time", line: "Right on schedule", tone: "go" } : x.late > 0 ? { word: `${x.late < 60 ? `${x.late} min` : dur(x.late)} late`, line: x.late > 15 ? "A delay the passengers noticed" : "A little behind the schedule", tone: x.late > 15 ? "stop" : "warn" } : { word: `${-x.late < 60 ? `${-x.late} min` : dur(-x.late)} early`, line: "Ahead of the schedule", tone: "go" };
  const label = `Ending screen: ${f.flightNo}, ${fromName} to ${toName}`;
  return (
    <div className="gv gv-end" style={style} data-size="m" data-pos="tl" role="region" aria-label={label}>
      <div className="gv-window" aria-hidden="true" />
      {(wx || onTime || feel) && (
        <ul className="gv-end-pax" aria-label="For the passengers">
          {wx && (
            <li>
              <small>Weather in {toName}</small>
              <b>
                <WxPicto code={wx.code} night={wx.night} />
                {wx.temp != null ? `${Math.round(wx.temp)}°C` : ""}
              </b>
              <span>{wx.text ?? ""}</span>
            </li>
          )}
          {onTime && (
            <li className={`gs-${onTime.tone}`}>
              <small>Arrival</small>
              <b>{onTime.word}</b>
              <span>{onTime.line}</span>
            </li>
          )}
          {feel && (
            <li className={`gs-${feel.tone}`}>
              <small>The landing</small>
              <b>{feel.word}</b>
              <span>{feel.line}</span>
            </li>
          )}
        </ul>
      )}
      <div className="gv-end-bye">
        <b>Flight complete</b>
        <span>{p.state.bye || BYE}</span>
      </div>
      <div className="gv-end-rail">
        <div className="gv-rail-top">
          <Brand f={f} />
          {ident(f)}
        </div>
        <div className="gv-end-route">
          <span>{fromName}</span>
          <i aria-hidden="true">→</i>
          <span>{toName}</span>
        </div>
        <div className="gv-end-map">
          <GateMap f={f} facts={facts} W={700} H={460} label={`Map: the route flown, ${f.from.iata ?? f.from.icao} to ${f.to.iata ?? f.to.icao}`} trail={trail} plan={plan} />
        </div>
        {shown.length ? (
          <dl className="gv-end-stats">
            {shown.map((y) => (
              <div key={y.k}>
                <dt>{y.k}</dt>
                <dd className="mono">
                  {y.v}
                  {y.unit && <i> {y.unit}</i>}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="gv-end-none">The flight&apos;s numbers show here once it has landed (OFP Tower).</p>
        )}
      </div>
    </div>
  );
}

export function sampleLive(f: GateFlight, stage: ViewStage, now: number): FlightState {
  const air = stage === "climb" || stage === "cruise" || stage === "approaching";
  // approaching: about 20 nm out on the way in (half-way on a hop shorter than 40 nm)
  const total = distNm(f.from, f.to);
  const k = stage === "cruise" ? 0.5 : stage === "climb" ? 0.15 : stage === "approaching" ? Math.max(0.5, 1 - 20 / Math.max(1, total)) : 0;
  const at = air ? { lat: f.from.lat + (f.to.lat - f.from.lat) * k, lon: f.from.lon + (f.to.lon - f.from.lon) * k } : stage === "arrived" ? f.to : f.from;
  const cruise = f.cruiseFt ?? 36_000;
  const brg = (Math.atan2(f.to.lon - f.from.lon, f.to.lat - f.from.lat) * 180) / Math.PI;
  const base = startState();
  const t = now;
  const block = (f.block ?? 90) * MIN;
  const alt = stage === "cruise" ? cruise : stage === "climb" ? Math.round(cruise / 2000) * 1000 : stage === "approaching" ? (f.to.elevFt ?? 0) + 4000 : ((stage === "arrived" ? f.to.elevFt : f.from.elevFt) ?? 0);
  const last: FeedSample = {
    t,
    lat: at.lat,
    lon: at.lon,
    alt,
    pressAlt: null,
    indAlt: null,
    gs: stage === "cruise" ? 450 : stage === "climb" ? 330 : stage === "approaching" ? 190 : stage === "taxi" ? 15 : 0,
    hdg: (brg + 360) % 360,
    vs: stage === "approaching" ? -800 : stage === "climb" ? 2200 : 0,
    onGround: !air,
    parkBrake: stage === "ready" || stage === "arrived",
    engines: stage === "ready" ? [false, false] : [stage !== "arrived", stage !== "arrived"],
    beacon: stage !== "arrived",
    doors: [0, 0, 0, 0],
    seatbelts: stage !== "arrived" && stage !== "cruise",
    noSmoking: "auto",
    landingRate: null,
    tdSim: null,
    hdgMag: (brg + 360) % 360,
    fobKg: stage === "cruise" || stage === "climb" ? 5200 : stage === "approaching" ? 3100 : null,
    ffKgH: stage === "cruise" ? 2100 : stage === "climb" ? 3300 : stage === "approaching" ? 900 : null,
  };
  const phase: FlightPhase = stage === "ready" ? "doorsClosed" : stage === "taxi" ? "taxi" : stage === "cruise" ? "cruise" : stage === "climb" ? "climb" : stage === "approaching" ? "approach" : "gate";
  const out = stage === "ready" ? null : t - (stage === "taxi" ? 5 * MIN : stage === "cruise" ? block / 2 : stage === "climb" ? 25 * MIN : stage === "approaching" ? block - 12 * MIN : block);
  return {
    ...base,
    phase,
    stage: air ? "flying" : stage === "ready" || stage === "taxi" || stage === "arrived" ? stage : "flying",
    last,
    cruised: stage === "cruise" || stage === "approaching",
    vsAvg: air ? last.vs : null,
    vsAt: air ? t : null,
    airborne: stage !== "ready" && stage !== "taxi",
    stamps: {
      out,
      off: air || stage === "arrived" ? (out ?? t) + 15 * MIN : null,
      on: stage === "arrived" ? t - 8 * MIN : null,
      in: stage === "arrived" ? t - 2 * MIN : null,
      landingRate: stage === "arrived" ? -180 : null,
      tdSim: null,
    },
  };
}

/**
 * A small 16:9 example of one view over a sample sky (the see-through parts show it). Drawn at
 * 960 px and scaled down as a picture, so it looks exactly like the screen (browsers won't shrink
 * text below a minimum size, which would break the layout at thumbnail width). A flip card shows
 * its front unless `back` names a side (null: it turns with the clock, as on the stream).
 */
export function MiniScreen({ view, back = -1, ...p }: Omit<ViewProps, "state"> & { state: GateState; view: string | Layers; back?: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.15);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setK(e.contentRect.width / 960));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="sp-mini" aria-hidden="true">
      <div className="gs-frame sp-mini-in" style={{ transform: `scale(${k})` }}>
        <GateViewScreen {...p} back={back} state={{ ...p.state, view: typeof view === "string" ? view : layersTo(view) }} />
      </div>
    </div>
  );
}
