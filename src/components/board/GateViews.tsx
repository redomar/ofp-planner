"use client";

import { geoAzimuthalEquidistant, geoDistance, geoInterpolate, geoPath } from "d3-geo";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { cityName } from "@/lib/data/flight";
import { routeColor, textOn } from "@/lib/colors";
import { MIN } from "@/lib/board/board";
import type { GateFlight, GateState, ShownView } from "@/lib/board/gate";
import { distNm, PHASE_LABEL, type FeedSource, type FlightPhase, type FlightStage, type FlightState } from "@/lib/feed/core";
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

export const fl = (ft: number) => (ft >= 10_000 ? `FL${String(Math.round(ft / 100)).padStart(3, "0")}` : `${(Math.round(ft / 100) * 100).toLocaleString("en-GB")} ft`);
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m` : `${Math.max(1, Math.round(m))} min`);

export function liveFacts(f: GateFlight, g: GateState, live: FlightState | null, now: number): LiveFacts {
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
  const toGo = Math.round(distNm(s, f.to));
  const minLeft = air && s.gs > 60 ? (toGo / s.gs) * 60 : null;
  const arrives = live.stamps.on ?? (minLeft != null ? s.t + minLeft * MIN : plannedEta);
  const flown = live.stage === "arrived" || !air ? (live.stamps.on != null ? 1 : 0) : Math.min(1, Math.max(0, 1 - toGo / Math.max(1, total)));
  const rate = live.stamps.landingRate != null ? `${Math.round(live.stamps.landingRate)} fpm` : null;
  const z = (ms: number | null) => (ms == null ? null : localClock(ms, f.to.tz));
  const line: Record<FlightPhase, string | null> = {
    boarding: `Off-block ${localClock(etd, f.from.tz)}`,
    doorsClosed: `Off-block ${localClock(etd, f.from.tz)}`,
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
    alt: air ? fl(s.alt) : null,
    gs: live.stage === "ready" ? null : Math.round(s.gs),
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

export function GateMap({ f, facts, W, H, label, trail = [] }: { f: GateFlight; facts: LiveFacts; W: number; H: number; label: string; trail?: [number, number][] }) {
  const outlines = useOutlines();
  const terrain = useTerrain();
  const from: [number, number] = [f.from.lon, f.from.lat];
  const to: [number, number] = [f.to.lon, f.to.lat];
  const geo = useMemo(() => {
    const mid = geoInterpolate(from, to)(0.5);
    const span = geoDistance(from, to);
    const route = { type: "LineString" as const, coordinates: [0, 0.25, 0.5, 0.75, 1].map((k) => geoInterpolate(from, to)(k)) };
    const proj = geoAzimuthalEquidistant()
      .rotate([-mid[0], -mid[1]])
      .fitExtent(
        [
          [W * 0.12, H * 0.14],
          [W * 0.88, H * 0.86],
        ],
        { type: "Feature", properties: {}, geometry: route },
      );
    if (span < 0.075) proj.scale(proj.scale() * (span / 0.075));
    proj.clipAngle(mapRadius(span / 2)).clipExtent([
      [0, 0],
      [W, H],
    ]);
    return { proj, path: geoPath(proj) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ends are what matter, not the array identity
  }, [from[0], from[1], to[0], to[1], W, H]);
  const base = useMemo(() => baseLayers(geo.proj, geo.path, W, H, outlines, terrain), [geo, W, H, outlines, terrain]);
  const pos: [number, number] | null = facts.pos ? [facts.pos.lon, facts.pos.lat] : null;
  const line = (a: [number, number], b: [number, number]) => geo.path({ type: "LineString", coordinates: [0, 0.2, 0.4, 0.6, 0.8, 1].map((k) => geoInterpolate(a, b)(k)) }) ?? "";
  // stroke widths as on the design sheet's 1120-wide map, scaled to this one
  const k = W / 1120;
  // the line flown: from the departure through where the aircraft has been to where it is
  const flownPath = pos ? (geo.path({ type: "LineString", coordinates: [from, ...trail, pos] }) ?? "") : "";
  const pf = geo.proj(from);
  const pt = geo.proj(to);
  const pp = pos ? geo.proj(pos) : null;
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
  return (
    <svg className="gm" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid slice">
      <rect className="gm-sea" width={W} height={H} />
      <path className="gm-grid" d={base.minor} strokeWidth={1.5 * k} />
      <path className="gm-land" d={base.land} />
      <path className="gm-coast" d={base.coast} strokeWidth={3 * k} />
      <path className="gm-borders" d={base.borders} strokeWidth={3.4 * k} strokeDasharray={`${7 * k} ${6 * k}`} />
      {pos ? (
        <>
          <path className="gm-togo" d={line(pos, to)} strokeWidth={W * 0.004} strokeDasharray={`${W * 0.002} ${W * 0.012}`} />
          <path className="gm-flown" d={flownPath} strokeWidth={W * 0.006} />
        </>
      ) : (
        <path className="gm-togo" d={line(from, to)} strokeWidth={W * 0.004} strokeDasharray={`${W * 0.002} ${W * 0.012}`} />
      )}
      {dot(pf, f.from.iata ?? f.from.icao, !right)}
      {dot(pt, f.to.iata ?? f.to.icao, right)}
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
}

/**
 * The gate screen in one of its views. Every view sits on the same 16:9 canvas (container units);
 * the views drawn over the sim leave everything outside their panels transparent.
 */
export function GateViewScreen(p: ViewProps) {
  const view = shownView(p.state, p.live, p.scene ?? null);
  if (view === "full") return <GateScreen flight={p.flight} state={p.state} now={p.now} wx={p.wx} live={p.live} source={SOURCE[p.source]} />;
  const f = p.flight;
  const bg = routeColor(f.brand);
  const ink = textOn(bg);
  const accent = f.brand?.colors.secondary && /^#[0-9a-f]{6}$/i.test(f.brand.colors.secondary) && f.brand.colors.secondary.toLowerCase() !== bg.toLowerCase() ? f.brand.colors.secondary : ink;
  const facts = liveFacts(f, p.state, p.live, p.now);
  const t = screenNow(p.now, f, p.state);
  const dest = cityName(f.to) ?? f.to.name;
  const style = { "--gs-bg": bg, "--gs-ink": ink, "--gs-accent": accent } as CSSProperties;
  const label = `Gate screen: ${f.flightNo} to ${dest}`;
  // with a feed, the aircraft's own time (a replay runs in the recording's sim time)
  const clock = <span className="gv-clock mono">{new Date(p.live?.last?.t ?? t).toISOString().slice(11, 16)}Z</span>;
  const mapLabel = `Map: ${f.from.iata ?? f.from.icao} to ${f.to.iata ?? f.to.icao}${facts.toGo != null ? `, ${facts.toGo} nm to go` : ""}`;
  const arrives = facts.arrives != null ? localClock(facts.arrives, f.to.tz) : null;

  if (view === "map" || view === "mapwin") {
    return (
      <div className={`gv gv-map${view === "mapwin" ? " is-win" : ""}`} style={style} role="region" aria-label={label}>
        <div className="gv-map-pic">
          <GateMap f={f} facts={facts} W={1100} H={1080} label={mapLabel} trail={p.trail} />
        </div>
        <div className="gv-rail">
          <div className="gv-rail-top">
            <Brand f={f} />
            {clock}
          </div>
          {ident(f)}
          <div className="gv-dest">{dest}</div>
          {view === "map" && <div className="gv-sub">from {cityName(f.from) ?? f.from.name}{f.typeName ? ` · ${f.typeName}` : ""}</div>}
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
          <div className="gv-dest">{dest}</div>
          <div className="gv-frame-map">
            <GateMap f={f} facts={facts} W={600} H={560} label={mapLabel} trail={p.trail} />
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
              <span>{p.live?.stamps.off != null ? `off ${localClock(p.live.stamps.off, f.from.tz)}` : `std ${localClock(f.stdMs, f.from.tz)}`}</span>
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
            <GateMap f={f} facts={facts} W={800} H={520} label={mapLabel} trail={p.trail} />
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
