"use client";

import { geoAzimuthalEquidistant, geoDistance, geoInterpolate, geoPath } from "d3-geo";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { cityName } from "@/lib/data/flight";
import { routeColor, textOn } from "@/lib/colors";
import { MIN } from "@/lib/board/board";
import type { GateFlight, GateState, ShownView } from "@/lib/board/gate";
import { distNm, PHASE_LABEL, type FeedSource, type FlightPlan, type FlightPhase, type FlightStage, type FlightState } from "@/lib/feed/core";
import { useOutlines } from "@/lib/outlines";
import { useTerrain } from "@/lib/terrain";
import { baseLayers, mapRadius } from "../RouteMap";
import { GateScreen, localClock, PLANE, screenNow, type GateWx } from "./GateScreen";

/**
 * The view on screen. A fixed &view= is that view. view=auto: an OBS scene named in the rules
 * gives its view; otherwise the stage of the flight (or the held stage) picks from the stage table.
 */
export function shownView(g: Pick<GateState, "view" | "stages" | "scenes" | "hold">, live: FlightState | null, scene: string | null = null): ShownView {
  if (g.view !== "auto") return g.view;
  const rule = scene ? g.scenes.find(([n]) => n.trim().toLowerCase() === scene.trim().toLowerCase()) : null;
  if (rule) return rule[1];
  const stage: FlightStage = g.hold ?? live?.stage ?? "ready";
  return g.stages[stage];
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
}

const fmsLine = (f: GateFlight) => [`${f.from.iata ?? f.from.icao} → ${f.to.iata ?? f.to.icao}`, f.cruiseFt ? `cruise ${fl(f.cruiseFt)}` : null].filter(Boolean).join(" · ");
export const fl = (ft: number) => (ft >= 10_000 ? `FL${String(Math.round(ft / 100)).padStart(3, "0")}` : `${(Math.round(ft / 100) * 100).toLocaleString("en-GB")} ft`);
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m` : `${Math.max(1, Math.round(m))} min`);

/**
 * Distance left along the FMS route (OFP Link, Fenix): to the next fix ahead, then leg by leg to
 * the destination runway; null when there's no plan for this flight. Also the route's length.
 */
export function routeToGo(f: GateFlight, plan: FlightPlan | null | undefined, pos: { lat: number; lon: number }): { toGo: number; total: number } | null {
  if (!plan || plan.origin !== f.from.icao || plan.destination !== f.to.icao) return null;
  const legs = plan.legs.filter((l) => !l.missed && !l.pseudo);
  if (legs.length < 2) return null;
  const seg = legs.map((l, i) => (i ? distNm(legs[i - 1], l) : 0));
  const total = seg.reduce((a, b) => a + b, 0);
  // the next fix: after the nearest one, unless the aircraft hasn't reached the nearest yet
  let near = 0;
  legs.forEach((l, i) => {
    if (distNm(pos, l) < distNm(pos, legs[near])) near = i;
  });
  const next = near < legs.length - 1 && distNm(pos, legs[near + 1]) < seg[near + 1] ? near + 1 : near;
  let toGo = distNm(pos, legs[next]);
  for (let i = next + 1; i < legs.length; i++) toGo += seg[i];
  return { toGo, total };
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
    };
  }
  const air = live.stage === "flying" && live.phase !== "landed" && live.phase !== "taxiIn";
  // along the programmed route when there is one (OFP Link, Fenix), else straight to the airport
  const byRoute = routeToGo(f, plan, s);
  const toGo = Math.round(byRoute?.toGo ?? distNm(s, f.to));
  const minLeft = air && s.gs > 60 ? (toGo / s.gs) * 60 : null;
  const arrives = live.stamps.on ?? (minLeft != null ? s.t + minLeft * MIN : plannedEta);
  const flown = live.stage === "arrived" || !air ? (live.stamps.on != null ? 1 : 0) : Math.min(1, Math.max(0, 1 - toGo / Math.max(1, byRoute?.total ?? total)));
  const rate = live.stamps.landingRate != null ? `${Math.round(live.stamps.landingRate)} fpm` : null;
  const z = (ms: number | null) => (ms == null ? null : localClock(ms, f.to.tz));
  const line: Record<FlightPhase, string | null> = {
    // an FMS flight has no schedule: its plan instead
    boarding: f.source === "fms" ? fmsLine(f) : `Off-block ${localClock(etd, f.from.tz)}`,
    doorsClosed: f.source === "fms" ? fmsLine(f) : `Off-block ${localClock(etd, f.from.tz)}`,
    pushback: live.stamps.out != null ? `Off-block ${localClock(live.stamps.out, f.from.tz)}` : null,
    taxi: f.runway ? `Runway ${f.runway}` : live.stamps.out != null ? `Off-block ${localClock(live.stamps.out, f.from.tz)}` : null,
    takeoff: f.runway ? `Runway ${f.runway}` : null,
    climb: `Passing ${fl(s.alt)}${f.cruiseFt ? ` for ${fl(f.cruiseFt)}` : ""}`,
    cruise: minLeft != null ? `Landing in ${mins(minLeft)}` : null,
    descent: minLeft != null ? `Landing in ${mins(minLeft)}` : null,
    approach: minLeft != null ? `${mins(minLeft)} to landing` : null,
    landed: [z(live.stamps.on), rate].filter(Boolean).join(" · ") || null,
    taxiIn: [z(live.stamps.on) && `Landed ${z(live.stamps.on)}`, rate].filter(Boolean).join(" · ") || null,
    gate: [z(live.stamps.in) && `On stand ${z(live.stamps.in)}`, rate].filter(Boolean).join(" · ") || null,
  };
  return {
    status: PHASE_LABEL[live.phase],
    tone: TONE[live.phase],
    line: line[live.phase],
    // on the ground: GND and the ground speed (0 kt parked), rather than dashes
    alt: air ? fl(s.alt) : "GND",
    gs: Math.round(s.gs),
    toGo: live.stage === "arrived" ? null : toGo,
    minLeft,
    arrives,
    flown,
    pos: { lat: s.lat, lon: s.lon },
    hdg: s.hdg,
  };
}

const SOURCE: Record<FeedSource, string | null> = { link: "MSFS", replay: "Replay", vatsim: "VATSIM", clock: null };

/* ---------- the moving map, in the airline's colours ---------- */

/** Near the end the map closes in on the destination: this far out (nm), and at least this wide. */
const NEAR_NM = 150;
const NEAR_MIN_ACROSS_NM = 60;
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
 * FMS plan (OFP Link, Fenix) the route is the one programmed: waypoints as small dots (Δ for an
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
}: {
  f: GateFlight;
  facts: LiveFacts;
  W: number;
  H: number;
  label: string;
  trail?: [number, number][];
  plan?: FlightPlan | null;
  near?: boolean;
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
  const posKey = near && pos ? `${Math.round(pos[0] * 4)},${Math.round(pos[1] * 4)}` : "";
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
    if (near) {
      const R = 3440.065;
      const ahead = (routeLegs ?? []).slice(Math.max(0, nearest)).map((l): [number, number] => [l.lon, l.lat]);
      const rw = (plan?.runways ?? []).filter((r) => r.airport === f.to.icao).flatMap((r) => [r.start, r.end]);
      const pts: [number, number][] = [to, ...rw, ...ahead, ...(pos ? [pos] : [])].filter((p) => geoDistance(p, to) * R < NEAR_NM * 1.4);
      proj = view(pts, to, NEAR_MIN_ACROSS_NM / R);
      reach = 0.06;
    } else {
      const span = geoDistance(from, to);
      const pts: [number, number][] = routeLegs ? routeLegs.map((l) => [l.lon, l.lat]) : [0, 0.25, 0.5, 0.75, 1].map((k) => geoInterpolate(from, to)(k));
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
  }, [from[0], from[1], to[0], to[1], W, H, near, posKey, routeLegs, nearest, plan]);
  const base = useMemo(() => baseLayers(geo.proj, geo.path, W, H, outlines, terrain), [geo, W, H, outlines, terrain]);
  const line = (a: [number, number], b: [number, number]) => geo.path({ type: "LineString", coordinates: [0, 0.2, 0.4, 0.6, 0.8, 1].map((k) => geoInterpolate(a, b)(k)) }) ?? "";
  const lineThrough = (pts: [number, number][]) => (pts.length > 1 ? (geo.path({ type: "LineString", coordinates: pts }) ?? "") : "");
  // stroke widths as on the design sheet's 1120-wide map, scaled to this one
  const k = W / 1120;
  // the line flown: from the departure through where the aircraft has been to where it is
  const flownPath = pos ? lineThrough([from, ...trail, pos]) : "";
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
  // runways drawn RUNWAY_M long from the threshold along the course OFP Link gives (stylised, not true length)
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
  // the route with its turns (OFP Link's turn geometry): fly-by fixes as rounded corners that start
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
      {/* runways above the map and the route, under the fixes, codes and aircraft: stylised 5 km bars from the threshold (OFP Link), pure white, no text on them */}
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

/* ---------- the views ---------- */

interface ViewProps {
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
  /** The route programmed in the aircraft's FMS (OFP Link, Fenix). */
  plan?: FlightPlan | null;
}

/**
 * The gate screen in one of its views. Every view sits on the same 16:9 canvas (container units);
 * the views drawn over the sim leave everything outside their panels transparent.
 */
export function GateViewScreen(p: ViewProps) {
  const view = shownView(p.state, p.live, p.scene ?? null);
  if (view === "full") return <GateScreen flight={p.flight} state={p.state} now={p.now} wx={p.wx} live={p.live} source={SOURCE[p.source]} plan={p.plan ?? null} />;
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
  const near = !!p.live && (p.live.stage === "arrived" || (p.live.stage === "flying" && facts.toGo != null && facts.toGo < NEAR_NM));

  if (view === "map" || view === "mapwin") {
    return (
      <div className={`gv gv-map${view === "mapwin" ? " is-win" : ""}`} style={style} role="region" aria-label={label}>
        <div className="gv-map-pic">
          <GateMap f={f} facts={facts} W={1100} H={1080} label={mapLabel} trail={p.trail} plan={p.plan} near={near} />
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
      <div className="gv gv-frame" style={style} role="region" aria-label={label}>
        <div className="gv-window" aria-hidden="true" />
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
          <div className="gv-frame-map">
            <GateMap f={f} facts={facts} W={600} H={560} label={mapLabel} trail={p.trail} plan={p.plan} near={near} />
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

  if (view === "corner") {
    return (
      <div className="gv gv-over" style={style} role="region" aria-label={label}>
        <div className="gv-corner">
          <div className="gv-corner-top">
            <span className="mono">{f.flightNo}</span>
            <b>{dest}</b>
            <small>{facts.status}</small>
          </div>
          <div className="gv-corner-map">
            <GateMap f={f} facts={facts} W={800} H={520} label={mapLabel} trail={p.trail} plan={p.plan} near={near} />
          </div>
          <div className="gv-corner-facts mono">
            <span>{facts.alt ?? "—"}</span>
            <span>{facts.gs != null ? `${facts.gs} kt` : "—"}</span>
            <span>{facts.minLeft != null ? `${mins(facts.minLeft)} to landing` : (facts.line ?? "")}</span>
          </div>
        </div>
      </div>
    );
  }

  if (view === "strip") {
    return (
      <div className="gv gv-over" style={style} role="region" aria-label={label}>
        <div className="gv-strip">
          <div className="gv-strip-id">
            <b className="mono">{f.flightNo}</b>
            <small>{f.airline}</small>
          </div>
          <Progress f={f} facts={facts} showToGo={false} />
          <Tile k="Level" v={facts.alt} />
          <Tile k="Speed" v={facts.gs} unit="kt" />
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
  return (
    <div className="gv gv-over" style={style} role="region" aria-label={label}>
      {view === "pill" ? (
        <div className="gv-pill mono" aria-live="polite">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <path d={PLANE} />
          </svg>
          <span>
            {f.flightNo} · {f.from.iata ?? f.from.icao} → {f.to.iata ?? f.to.icao}
            {togo ? ` · ${togo}` : ` · ${facts.status}`}
          </span>
        </div>
      ) : (
        <div className="gv-card" aria-live="polite">
          <div className="gv-card-top">
            <span className="mono">{f.flightNo}</span>
            <small>{facts.status}</small>
          </div>
          <b className="gv-card-dest">{dest}</b>
          <Progress f={f} facts={facts} showToGo={false} />
          <div className="gv-card-facts mono">
            <span>{facts.alt ?? "—"}</span>
            <span>{facts.gs != null ? `${facts.gs} kt` : "—"}</span>
            <span>{togo ?? ""}</span>
          </div>
        </div>
      )}
    </div>
  );
}
