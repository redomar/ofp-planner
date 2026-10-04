"use client";

import { geoAzimuthalEquidistant, geoDistance, geoGraticule10, geoInterpolate, geoPath, type GeoProjection } from "d3-geo";
import { useMemo, useState } from "react";
import type { Airport } from "@/lib/data/load";
import { useOutlines, type Outlines } from "@/lib/outlines";

export interface MapRoute {
  key: string;
  from: Airport;
  to: Airport;
  color: string;
  /** Drawn on top, thicker, with the aircraft marker. */
  active?: boolean;
  label?: string;
}

const W = 640;

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

/**
 * A projected map (azimuthal equidistant, centred on the routes so great circles look
 * true) with coastlines, borders and a 10° graticule. Routes are great-circle lines in
 * the airline's colour, cased in a contrasting outline so even light brand colours
 * stand out from the paper (WCAG 1.4.11, 3:1 for graphics).
 */
export function RouteMap({
  routes,
  height = 300,
  onPick,
  label,
  className,
}: {
  routes: MapRoute[];
  height?: number;
  /** Clicking an airport dot (other than the shared end) calls this with its ICAO. */
  onPick?: (icao: string) => void;
  label: string;
  className?: string;
}) {
  const outlines = useOutlines();
  const [hover, setHover] = useState<string | null>(null);
  const H = Math.round(height * (W / 640));

  const view = useMemo(() => {
    if (!routes.length) return null;
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
    // Fit to the routes with room for labels; a single short hop still shows some coast.
    const maxSpan = Math.max(...routes.map((r) => geoDistance([r.from.lon, r.from.lat], [r.to.lon, r.to.lat])));
    const pad = 36;
    const proj: GeoProjection = geoAzimuthalEquidistant().rotate([-cLon, -cLat]).fitExtent(
      [
        [pad, pad],
        [W - pad, H - pad],
      ],
      { type: "FeatureCollection", features: lines },
    );
    // Don't zoom in past ~250 NM across, or a short hop loses all context.
    const minSpan = 0.075; // radians (~260 NM)
    if (maxSpan < minSpan) proj.scale(proj.scale() * (maxSpan / minSpan));
    proj.clipExtent([
      [0, 0],
      [W, H],
    ]);
    return { proj, path: geoPath(proj) };
  }, [routes, H]);

  const base = useMemo(() => {
    if (!view) return null;
    const g = outlines ? outlineGeo(outlines) : null;
    return {
      grat: view.path(geoGraticule10()) ?? "",
      coast: g ? (view.path(g.coast) ?? "") : "",
      borders: g ? (view.path(g.borders) ?? "") : "",
    };
  }, [view, outlines]);

  if (!view || !base)
    return (
      <div className={`map map-empty ${className ?? ""}`} style={{ aspectRatio: `${W} / ${H}` }}>
        <span>No route to draw</span>
      </div>
    );

  const { proj, path } = view;
  const ordered = [...routes].sort((a, b) => Number(!!a.active) - Number(!!b.active) || Number(a.key === hover) - Number(b.key === hover));
  const ports = new Map<string, { a: Airport; ends: number; route: MapRoute }>();
  for (const r of routes)
    for (const a of [r.from, r.to]) {
      const p = ports.get(a.icao);
      if (p) p.ends++;
      else ports.set(a.icao, { a, ends: 1, route: r });
    }
  const showAllLabels = ports.size <= 24;
  const active = routes.find((r) => r.active) ?? (routes.length === 1 ? routes[0] : null);
  const plane = active ? planeAt(proj, active) : null;

  return (
    <figure className={`map ${className ?? ""}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <rect className="map-sea" x="0" y="0" width={W} height={H} />
        <path className="map-grat" d={base.grat} />
        <path className="map-border" d={base.borders} />
        <path className="map-coast" d={base.coast} />
        {ordered.map((r) => {
          const d = path({ type: "LineString", coordinates: [[r.from.lon, r.from.lat], [r.to.lon, r.to.lat]] }) ?? "";
          const strong = r.active || r.key === hover || routes.length === 1;
          return (
            <g key={r.key} className={strong ? "map-route on" : "map-route"}>
              <path className="map-casing" d={d} />
              <path className="map-line" d={d} style={{ stroke: r.color }} pathLength={1} />
            </g>
          );
        })}
        {plane && (
          <g className="map-plane" transform={`translate(${plane.x.toFixed(1)} ${plane.y.toFixed(1)}) rotate(${plane.deg.toFixed(1)})`}>
            <path d="M0-9 1.6-3.2 9 1.6V3.6L1.6 1.4 1.2 6.2 3.6 8V9.6L0 8.6-3.6 9.6V8L-1.2 6.2-1.6 1.4-9 3.6V1.6L-1.6-3.2Z" style={{ fill: active!.color }} />
          </g>
        )}
        {/* the shared end (hub) is drawn last, so its label sits on top of the fan */}
        {[...ports.values()].sort((x, y) => Number(x.ends > 1) - Number(y.ends > 1)).map(({ a, ends, route }) => {
          const p = proj([a.lon, a.lat]);
          if (!p) return null;
          const hub = ends > 1 && routes.length > 1;
          const pickable = !!onPick && !hub;
          const on = hover === route.key || route.active;
          const labelIt = showAllLabels || hub || on;
          const right = p[0] < W - 70;
          return (
            <g
              key={a.icao}
              className={`map-port${hub ? " hub" : ""}${pickable ? " pick" : ""}${on ? " on" : ""}`}
              transform={`translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})`}
              onMouseEnter={routes.length > 1 ? () => setHover(route.key) : undefined}
              onMouseLeave={routes.length > 1 ? () => setHover(null) : undefined}
              onClick={pickable ? () => onPick!(a.icao) : undefined}
              onKeyDown={pickable ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick!(a.icao)) : undefined}
              tabIndex={pickable ? 0 : undefined}
              role={pickable ? "button" : undefined}
              aria-label={pickable ? `${a.icao} ${a.name}${route.label ? `, ${route.label}` : ""}` : undefined}
              onFocus={routes.length > 1 ? () => setHover(route.key) : undefined}
              onBlur={routes.length > 1 ? () => setHover(null) : undefined}
            >
              {pickable && <circle className="map-hit" r="10" />}
              <circle className="map-dot" r={hub || routes.length === 1 ? 4.5 : 3.2} />
              {labelIt && (
                <text x={hub ? 0 : right ? 8 : -8} y={hub ? -10 : 4} textAnchor={hub ? "middle" : right ? "start" : "end"}>
                  {a.iata ?? a.icao}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
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
