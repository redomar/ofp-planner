"use client";

import { geoAzimuthalEquidistant, geoDistance, geoGraticule, geoInterpolate, geoPath, type GeoProjection } from "d3-geo";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Airport } from "@/lib/data/load";
import { useDisplay } from "@/lib/display";
import { COUNTRIES, RANGES, SEAS } from "@/lib/maplabels";
import { useOutlines, type Outlines } from "@/lib/outlines";
import { useTerrain, type Terrain } from "@/lib/terrain";

export interface MapRoute {
  key: string;
  from: Airport;
  to: Airport;
  color: string;
  /** Drawn on top, thicker, with the aircraft marker. */
  active?: boolean;
  label?: string;
}

/** Outline lines (flat lon/lat arrays) → GeoJSON, built once per load. */
const geoCache = new WeakMap<Outlines, { coast: GeoJSON.MultiLineString; borders: GeoJSON.MultiLineString }>();
function outlineGeo(o: Outlines) {
  let g = geoCache.get(o);
  if (!g) {
    const ml = (lines: Float32Array[]): GeoJSON.MultiLineString => ({
      type: "MultiLineString",
      coordinates: lines.map((l) => {
        const pts: [number, number][] = [];
        for (let i = 0; i < l.length; i += 2) pts.push([l[i], l[i + 1]]);
        return pts;
      }),
    });
    g = { coast: ml(o.coast), borders: ml(o.borders) };
    geoCache.set(o, g);
  }
  return g;
}

const GRAT_MAJOR = geoGraticule().step([10, 10])();
const GRAT_MINOR = geoGraticule().step([5, 5])();

/**
 * A chart-style map (azimuthal equidistant, centred on the routes so great circles look true):
 * sea-depth wash and dashed depth contours, parchment land with a height tint and contour lines,
 * a 10°/5° grid with degrees on the bottom and left edges, sea / country / range lettering, then
 * the routes in airline colours (cased for 3:1 contrast) and the airports.
 *
 * The SVG is drawn at the element's real pixel size (measured), so lettering and line weights are
 * the same on the small flight-card map and the large destinations map.
 */
export function RouteMap({
  routes,
  height = 300,
  onPick,
  label,
  className,
}: {
  routes: MapRoute[];
  /** Height in CSS px; the width fills the container. */
  height?: number;
  /** Clicking an airport dot (other than the shared end) calls this with its ICAO. */
  onPick?: (icao: string) => void;
  label: string;
  className?: string;
}) {
  const outlines = useOutlines();
  const terrain = useTerrain();
  const display = useDisplay();
  const [hover, setHover] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const [W, setW] = useState(0);
  const H = height;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => {
    if (!routes.length || W < 50) return null;
    const pts: [number, number][] = routes.flatMap((r) => [
      [r.from.lon, r.from.lat],
      [r.to.lon, r.to.lat],
    ]);
    // Centre on the mean of the points on the sphere.
    let x = 0,
      y = 0,
      z = 0;
    for (const [lon, lat] of pts) {
      const l = (lon * Math.PI) / 180;
      const p = (lat * Math.PI) / 180;
      x += Math.cos(p) * Math.cos(l);
      y += Math.cos(p) * Math.sin(l);
      z += Math.sin(p);
    }
    const cLon = (Math.atan2(y, x) * 180) / Math.PI;
    const cLat = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
    const lines: GeoJSON.Feature<GeoJSON.LineString>[] = routes.map((r) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[r.from.lon, r.from.lat], [r.to.lon, r.to.lat]] },
    }));
    const maxSpan = Math.max(...routes.map((r) => geoDistance([r.from.lon, r.from.lat], [r.to.lon, r.to.lat])));
    // room for labels, and for the degree labels on the bottom and left edges
    const proj: GeoProjection = geoAzimuthalEquidistant().rotate([-cLon, -cLat]).fitExtent(
      [
        [44, 34],
        [W - 34, H - 30],
      ],
      { type: "FeatureCollection", features: lines },
    );
    // Don't zoom in past ~260 NM across, or a short hop loses all context.
    const minSpan = 0.075;
    if (maxSpan < minSpan) proj.scale(proj.scale() * (maxSpan / minSpan));
    proj.clipExtent([
      [0, 0],
      [W, H],
    ]);
    return { proj, path: geoPath(proj) };
  }, [routes, W, H]);

  const base = useMemo(() => (view ? baseLayers(view.proj, view.path, W, H, outlines, terrain) : null), [view, outlines, terrain, W, H]);

  return (
    <figure ref={ref} className={`map ${className ?? ""}`} style={{ height: H }}>
      {view && base ? (
        <Drawn view={view} base={base} routes={routes} W={W} H={H} hover={hover} setHover={setHover} onPick={onPick} label={label} codes={display.mapCodes} />
      ) : (
        !routes.length && <span className="map-empty">No route to draw</span>
      )}
    </figure>
  );
}

type View = { proj: GeoProjection; path: ReturnType<typeof geoPath> };
type Base = ReturnType<typeof baseLayers>;

/** Everything under the routes, which depends only on the projection and the data files. */
function baseLayers(proj: GeoProjection, path: ReturnType<typeof geoPath>, W: number, H: number, outlines: Outlines | null, terrain: Terrain | null) {
  const g = outlines ? outlineGeo(outlines) : null;
  const P = (o: GeoJSON.GeoJsonObject) => path(o as GeoJSON.Geometry) ?? "";
  const inFrame = (p: [number, number] | null, m = 14) => !!p && p[0] > m && p[0] < W - m && p[1] > m && p[1] < H - m;
  const small = W < 600;

  const seas = SEAS.flatMap(([t, lon, lat, size, ls]) => {
    const p = proj([lon, lat]);
    if (!inFrame(p, 30) || (small && size < 12)) return [];
    return [{ t, x: p![0], y: p![1], size: small ? size - 1 : size, ls }];
  });
  const countries = COUNTRIES.flatMap(([t, lon, lat]) => {
    const p = proj([lon, lat]);
    return inFrame(p, 30) ? [{ t, x: p![0], y: p![1] }] : [];
  });
  const ranges = small
    ? []
    : RANGES.flatMap(([t, a1, b1, a2, b2]) => {
        const p = proj([a1, b1]);
        const q = proj([a2, b2]);
        if (!p || !q || !inFrame([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], 30)) return [];
        let ang = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
        if (ang > 90) ang -= 180;
        if (ang < -90) ang += 180;
        return [{ t, x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, ang }];
      });

  // degrees where 10° meridians meet the bottom edge and parallels meet the left edge
  const degs: { t: string; x: number; y: number; side: "b" | "l" }[] = [];
  for (let lon = -180; lon < 180; lon += 10) {
    for (let lat = -80; lat <= 85; lat += 0.25) {
      const p = proj([lon, lat]);
      if (p && Math.abs(p[1] - (H - 1)) < 2.5 && p[0] > 40 && p[0] < W - 24) {
        degs.push({ t: `${Math.abs(lon)}°${lon < 0 ? "W" : lon > 0 ? "E" : ""}`, x: p[0], y: H - 6, side: "b" });
        break;
      }
    }
  }
  for (let lat = -80; lat <= 80; lat += 10) {
    for (let lon = -180; lon <= 180; lon += 0.25) {
      const p = proj([lon, lat]);
      if (p && Math.abs(p[0] - 1) < 2.5 && p[1] > 16 && p[1] < H - 22) {
        degs.push({ t: `${Math.abs(lat)}°${lat < 0 ? "S" : lat > 0 ? "N" : ""}`, x: 5, y: p[1] - 4, side: "l" });
        break;
      }
    }
  }

  return {
    depths: terrain ? terrain.depths.map((b, i) => ({ i, d: P(b.geo) })) : [],
    land: terrain ? P(terrain.land) : "",
    heights: terrain ? terrain.heights.map((b, i) => ({ i, d: P(b.geo) })) : [],
    minor: P(GRAT_MINOR),
    major: P(GRAT_MAJOR),
    coast: g ? P(g.coast) : "",
    borders: g ? P(g.borders) : "",
    seas,
    countries,
    ranges,
    degs,
  };
}

function Drawn({
  view,
  base,
  routes,
  W,
  H,
  hover,
  setHover,
  onPick,
  label,
  codes,
}: {
  view: View;
  base: Base;
  routes: MapRoute[];
  W: number;
  H: number;
  hover: string | null;
  setHover: (k: string | null) => void;
  onPick?: (icao: string) => void;
  label: string;
  codes: boolean;
}) {
  const { proj, path } = view;
  const many = routes.length > 1;
  const ordered = [...routes].sort((a, b) => Number(!!a.active) - Number(!!b.active) || Number(a.key === hover) - Number(b.key === hover));
  const ports = new Map<string, { a: Airport; ends: number; route: MapRoute }>();
  for (const r of routes)
    for (const a of [r.from, r.to]) {
      const p = ports.get(a.icao);
      if (p) p.ends++;
      else ports.set(a.icao, { a, ends: 1, route: r });
    }
  const active = routes.find((r) => r.active) ?? (routes.length === 1 ? routes[0] : null);
  const plane = active ? planeAt(proj, active) : null;

  // Destination codes (Settings → Display): placed busiest-first, skipping overlaps; the hub always.
  const labelled = new Set<string>();
  const boxes: [number, number, number, number][] = [];
  const portList = [...ports.values()].sort((x, y) => Number(y.ends > 1) - Number(x.ends > 1));
  for (const { a, ends } of portList) {
    const p = proj([a.lon, a.lat]);
    if (!p) continue;
    const hub = ends === routes.length && many;
    if (!many || hub) {
      labelled.add(a.icao);
      boxes.push([p[0] - 24, p[1] - 30, p[0] + 24, p[1] - 8]);
      continue;
    }
    if (!codes) continue;
    const code = a.iata ?? a.icao;
    const w = code.length * 7.4 + 4;
    const x0 = p[0] + 7;
    const b: [number, number, number, number] = [x0, p[1] - 9, x0 + w, p[1] + 5];
    if (b[2] > W - 2 || boxes.some((o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]))) continue;
    boxes.push(b);
    labelled.add(a.icao);
  }

  // Lettering is background: it gives way to dots, codes and the hub label, and to each other
  // (seas first, then countries, then ranges), so nothing is printed over anything else.
  for (const { a } of portList) {
    const p = proj([a.lon, a.lat]);
    if (p) boxes.push([p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5]);
  }
  const free = (b: [number, number, number, number]) => {
    if (boxes.some((o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]))) return false;
    boxes.push(b);
    return true;
  };
  const textBox = (x: number, y: number, chars: number, size: number, ls: number): [number, number, number, number] => {
    const w = chars * size * (0.56 + ls);
    return [x - w / 2, y - size * 0.85, x + w / 2, y + size * 0.25];
  };
  const seas = base.seas.filter((s) => free(textBox(s.x, s.y, s.t.length, s.size, s.ls)));
  const countries = base.countries.filter((c) => free(textBox(c.x, c.y, c.t.length, 12, 0.3)));
  const ranges = base.ranges.filter((r) => {
    // the rotated name's extent, approximated by its bounding box
    const len = r.t.length * 11 * 0.62;
    const dx = (Math.cos((r.ang * Math.PI) / 180) * len) / 2;
    const dy = (Math.sin((r.ang * Math.PI) / 180) * len) / 2;
    return free([r.x - Math.abs(dx) - 4, r.y - Math.abs(dy) - 6, r.x + Math.abs(dx) + 4, r.y + Math.abs(dy) + 6]);
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      <rect className="map-sea" x="0" y="0" width={W} height={H} />
      {base.depths.map((b) => (
        <path key={`d${b.i}`} className={`map-depth d${b.i}`} d={b.d} />
      ))}
      <path className="map-land" d={base.land} />
      {base.heights.map((b) => (
        <path key={`h${b.i}`} className={`map-height h${b.i}`} d={b.d} />
      ))}
      <path className="map-grat-minor" d={base.minor} />
      <path className="map-grat" d={base.major} />
      <path className="map-border" d={base.borders} />
      <path className="map-coast" d={base.coast} />
      <g className="map-letters" aria-hidden="true">
        {seas.map((s) => (
          <text key={s.t} className="l-sea" x={s.x} y={s.y} textAnchor="middle" style={{ fontSize: s.size, letterSpacing: `${s.ls}em` }}>
            {s.t}
          </text>
        ))}
        {countries.map((c) => (
          <text key={c.t} className="l-cty" x={c.x} y={c.y} textAnchor="middle">
            {c.t}
          </text>
        ))}
        {ranges.map((r) => (
          <text key={r.t} className="l-rng" textAnchor="middle" transform={`translate(${r.x.toFixed(1)} ${r.y.toFixed(1)}) rotate(${r.ang.toFixed(1)})`}>
            {r.t}
          </text>
        ))}
      </g>
      {ordered.map((r) => {
        const d = path({ type: "LineString", coordinates: [[r.from.lon, r.from.lat], [r.to.lon, r.to.lat]] }) ?? "";
        const strong = r.active || r.key === hover || routes.length === 1;
        return (
          <g
            key={r.key}
            className={`map-route${strong ? " on" : ""}${r.key === hover ? " hover" : ""}`}
            onMouseEnter={() => setHover(r.key)}
            onMouseLeave={() => setHover(null)}
          >
            <path className="map-casing" d={d} />
            <path className="map-line" d={d} style={{ stroke: r.color }} pathLength={1} />
            <path className="map-route-hit" d={d} />
          </g>
        );
      })}
      {plane && (
        <g className="map-plane" transform={`translate(${plane.x.toFixed(1)} ${plane.y.toFixed(1)}) rotate(${plane.deg.toFixed(1)})`}>
          <path d="M0-9 1.6-3.2 9 1.6V3.6L1.6 1.4 1.2 6.2 3.6 8V9.6L0 8.6-3.6 9.6V8L-1.2 6.2-1.6 1.4-9 3.6V1.6L-1.6-3.2Z" style={{ fill: active!.color }} />
        </g>
      )}
      {portList.map(({ a, ends, route }) => {
        const p = proj([a.lon, a.lat]);
        if (!p) return null;
        const hub = ends === routes.length && many;
        const pickable = !!onPick && !hub;
        const on = hover === route.key || route.active;
        const labelIt = labelled.has(a.icao) || on;
        const right = p[0] < W - 70;
        return (
          <g
            key={a.icao}
            className={`map-port${hub ? " hub" : ""}${pickable ? " pick" : ""}${on ? " on" : ""}`}
            transform={`translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})`}
            onMouseEnter={many ? () => setHover(route.key) : undefined}
            onMouseLeave={many ? () => setHover(null) : undefined}
            onClick={pickable ? () => onPick!(a.icao) : undefined}
            onKeyDown={pickable ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick!(a.icao)) : undefined}
            tabIndex={pickable ? 0 : undefined}
            role={pickable ? "button" : undefined}
            aria-label={pickable ? `${a.icao} ${a.name}${route.label ? `, ${route.label}` : ""}` : undefined}
            onFocus={many ? () => setHover(route.key) : undefined}
            onBlur={many ? () => setHover(null) : undefined}
          >
            {pickable && <circle className="map-hit" r="10" />}
            <circle className="map-dot" r={hub || !many ? 4.5 : 3.4} />
            {labelIt && (
              <text x={hub ? 0 : right ? 8 : -8} y={hub ? -10 : 4} textAnchor={hub ? "middle" : right ? "start" : "end"}>
                {a.iata ?? a.icao}
              </text>
            )}
          </g>
        );
      })}
      <g className="map-degs" aria-hidden="true">
        {base.degs.map((d) => (
          <text key={`${d.side}${d.t}`} x={d.x} y={d.y} textAnchor={d.side === "b" ? "middle" : "start"}>
            {d.t}
          </text>
        ))}
      </g>
    </svg>
  );
}

/** Aircraft marker at the great-circle midpoint, pointing along the track. */
function planeAt(proj: GeoProjection, r: MapRoute) {
  const ip = geoInterpolate([r.from.lon, r.from.lat], [r.to.lon, r.to.lat]);
  const a = proj(ip(0.5));
  const b = proj(ip(0.52));
  if (!a || !b) return null;
  return { x: a[0], y: a[1], deg: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 90 };
}
