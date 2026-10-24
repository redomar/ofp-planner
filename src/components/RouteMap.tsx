"use client";

import { geoAzimuthalEquidistant, geoDistance, geoGraticule, geoInterpolate, geoPath, type GeoProjection } from "d3-geo";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Airport } from "@/lib/data/load";
import { useDisplay, type MapCodes, type MapLines } from "@/lib/display";
import { COUNTRIES, RANGES, SEAS } from "@/lib/maplabels";
import { useOutlines, type Outlines } from "@/lib/outlines";
import { linePieces, useTerrain, visible, type Piece, type Terrain } from "@/lib/terrain";

export interface MapRoute {
  key: string;
  from: Airport;
  to: Airport;
  color: string;
  /** Drawn on top, thicker, with the aircraft marker. */
  active?: boolean;
  label?: string;
}

/** Outline lines (flat lon/lat arrays) → pieces a map can cull and simplify, built once per load. */
const geoCache = new WeakMap<Outlines, { coast: Piece[]; borders: Piece[] }>();
function outlineGeo(o: Outlines) {
  let g = geoCache.get(o);
  if (!g) {
    const ml = (lines: Float32Array[]) =>
      linePieces(
        lines.map((l) => {
          const pts: [number, number][] = [];
          for (let i = 0; i < l.length; i += 2) pts.push([l[i], l[i + 1]]);
          return pts;
        }),
      );
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
  const lineStyle = display.mapLines;
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

  // The default view fits the routes; zoom only goes in from there (k ≥ 1) and pans stay inside it.
  const fit = useMemo(() => {
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
      geometry: { type: "LineString", coordinates: trackCoords(r, lineStyle) },
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
    const far = Math.max(...pts.map((p) => geoDistance([cLon, cLat], p)));
    return { rotate: proj.rotate(), scale: proj.scale(), translate: proj.translate(), clip: mapRadius(far) };
  }, [routes, W, H, lineStyle]);

  const zoom = useZoom(ref, W, H, fit);
  const z = zoom.committed;

  const view = useMemo(() => {
    if (!fit) return null;
    const proj = geoAzimuthalEquidistant()
      .rotate(fit.rotate)
      .scale(fit.scale * z.k)
      .translate([fit.translate[0] * z.k + z.x, fit.translate[1] * z.k + z.y])
      .clipAngle(fit.clip)
      .clipExtent([
        [0, 0],
        [W, H],
      ]);
    return { proj, path: geoPath(proj) };
  }, [fit, z, W, H]);

  const base = useMemo(() => (view ? baseLayers(view.proj, view.path, W, H, outlines, terrain) : null), [view, outlines, terrain, W, H]);

  return (
    <figure ref={ref} className={`map ${className ?? ""}${zoom.live.k !== 1 ? " zoomed" : ""}`} style={{ height: H }}>
      {view && base ? (
        <Drawn
          view={view}
          base={base}
          routes={routes}
          W={W}
          H={H}
          hover={hover}
          setHover={setHover}
          onPick={onPick}
          label={label}
          codes={display.mapCodes}
          lines={display.mapLines}
          transform={zoom.transform}
        />
      ) : (
        !routes.length && <span className="map-empty">No route to draw</span>
      )}
      {view && <ZoomButtons zoom={zoom} title="Default view: fit all the routes" />}
    </figure>
  );
}

/** + / − / ⤢ in the map's top-left corner. */
export function ZoomButtons({ zoom, title }: { zoom: ReturnType<typeof useZoom>; title: string }) {
  return (
    <div className="map-zoom" role="group" aria-label="Map zoom">
      <button type="button" className="map-zbtn" aria-label="Zoom in" title="Zoom in" onClick={() => zoom.step(1.6)} disabled={zoom.live.k >= ZMAX}>
        +
      </button>
      <button type="button" className="map-zbtn" aria-label="Zoom out" title="Zoom out" onClick={() => zoom.step(1 / 1.6)} disabled={zoom.live.k <= zoom.kMin}>
        −
      </button>
      <button type="button" className="map-zbtn map-zreset" aria-label="Default view" title={title} onClick={zoom.reset} disabled={zoom.atDefault}>
        ⤢
      </button>
    </div>
  );
}

type View = { proj: GeoProjection; path: ReturnType<typeof geoPath> };
export type Base = ReturnType<typeof baseLayers>;
export type Box = [number, number, number, number];

/**
 * Sea, country and range names that fit around what's already placed (`boxes`, which this
 * extends): seas first, then countries, then ranges, so nothing is printed over anything else.
 */
export function placeLetters(base: Base, boxes: Box[]) {
  const free = (b: Box) => {
    if (!onDiscBox(base, b)) return false;
    if (boxes.some((o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]))) return false;
    boxes.push(b);
    return true;
  };
  const textBox = (x: number, y: number, chars: number, size: number, ls: number): Box => {
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
  return { seas, countries, ranges };
}
export type Letters = ReturnType<typeof placeLetters>;

/** Whether a label's box lies wholly inside the chart's disc (none of it falls off the rim). */
export function onDiscBox(base: Base, [x0, y0, x1, y1]: Box, pad = 2): boolean {
  const { x, y, r } = base.disc;
  return [x0, x1].every((bx) => [y0, y1].every((by) => Math.hypot(bx - x, by - y) <= r - pad));
}

/** The chart under the routes: depth wash, land and heights (unless `relief` is off), grid, borders, coast and lettering. */
export function Ground({ base, letters, relief = true }: { base: Base; letters: Letters; relief?: boolean }) {
  return (
    <>
      <path className="map-space" d={base.space} />
      {relief &&
        base.depths.map((b) => (
          <g key={`d${b.i}`} className={`map-depth d${b.i}`}>
            <path className="map-fill" d={b.d} />
            <path className="map-contour" d={b.l} />
          </g>
        ))}
      <path className="map-land" d={base.land} />
      {relief &&
        base.heights.map((b) => (
          <g key={`h${b.i}`} className={`map-height h${b.i}`}>
            <path className="map-fill" d={b.d} />
            <path className="map-contour" d={b.l} />
          </g>
        ))}
      <path className="map-grat-minor" d={base.minor} />
      <path className="map-grat" d={base.major} />
      <path className="map-border" d={base.borders} />
      <path className="map-coast" d={base.coast} />
      <g className="map-letters" aria-hidden="true">
        {letters.seas.map((s) => (
          <text key={s.t} className="l-sea" x={s.x} y={s.y} textAnchor="middle" style={{ fontSize: s.size, letterSpacing: `${s.ls}em` }}>
            {s.t}
          </text>
        ))}
        {letters.countries.map((c) => (
          <text key={c.t} className="l-cty" x={c.x} y={c.y} textAnchor="middle">
            {c.t}
          </text>
        ))}
        {letters.ranges.map((r) => (
          <text key={r.t} className="l-rng" textAnchor="middle" transform={`translate(${r.x.toFixed(1)} ${r.y.toFixed(1)}) rotate(${r.ang.toFixed(1)})`}>
            {r.t}
          </text>
        ))}
      </g>
    </>
  );
}

/** Degrees where the grid meets the bottom and left edges. */
export function EdgeDegrees({ base }: { base: Base }) {
  return (
    <g className="map-degs" aria-hidden="true">
      {base.degs.map((d) => (
        <text key={`${d.side}${d.t}`} x={d.x} y={d.y} textAnchor={d.side === "b" ? "middle" : "start"}>
          {d.t}
        </text>
      ))}
    </g>
  );
}

/** Everything under the routes, which depends only on the projection and the data files. */
export function baseLayers(
  proj: GeoProjection,
  path: ReturnType<typeof geoPath>,
  W: number,
  H: number,
  outlines: Outlines | null,
  terrain: Terrain | null,
) {
  const g = outlines ? outlineGeo(outlines) : null;
  const P = (o: GeoJSON.GeoJsonObject) => path(o as GeoJSON.Geometry) ?? "";
  const inFrame = (p: [number, number] | null, m = 14) => !!p && p[0] > m && p[0] < W - m && p[1] > m && p[1] < H - m;
  const small = W < 600;
  // the chart is a disc around the centre (see mapRadius); nothing is lettered past its rim
  const [rl, rp] = proj.rotate();
  const centre: [number, number] = [-rl, -rp];
  const rim = ((proj.clipAngle() ?? 180) * Math.PI) / 180;
  const onDisc = (lon: number, lat: number) => geoDistance(centre, [lon, lat]) < rim - 0.03;

  const seas = SEAS.flatMap(([t, lon, lat, size, ls]) => {
    const p = proj([lon, lat]);
    if (!onDisc(lon, lat) || !inFrame(p, 30) || (small && size < 12)) return [];
    return [{ t, x: p![0], y: p![1], size: small ? size - 1 : size, ls }];
  });
  const countries = COUNTRIES.flatMap(([t, lon, lat]) => {
    const p = proj([lon, lat]);
    return onDisc(lon, lat) && inFrame(p, 30) ? [{ t, x: p![0], y: p![1] }] : [];
  });
  const ranges = small
    ? []
    : RANGES.flatMap(([t, a1, b1, a2, b2]) => {
        const p = proj([a1, b1]);
        const q = proj([a2, b2]);
        if (!p || !q || !onDisc(a1, b1) || !onDisc(a2, b2) || !inFrame([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], 30)) return [];
        let ang = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
        if (ang > 90) ang -= 180;
        if (ang < -90) ang += 180;
        return [{ t, x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, ang }];
      });

  // degrees where 10° meridians meet the bottom edge and parallels meet the left edge
  const degs: { t: string; x: number; y: number; side: "b" | "l" }[] = [];
  for (let lon = -180; lon < 180; lon += 10) {
    for (let lat = -80; lat <= 85; lat += 0.25) {
      const p = onDisc(lon, lat) ? proj([lon, lat]) : null;
      if (p && Math.abs(p[1] - (H - 1)) < 2.5 && p[0] > 40 && p[0] < W - 24) {
        degs.push({ t: `${Math.abs(lon)}°${lon < 0 ? "W" : lon > 0 ? "E" : ""}`, x: p[0], y: H - 6, side: "b" });
        break;
      }
    }
  }
  for (let lat = -80; lat <= 80; lat += 10) {
    for (let lon = -180; lon <= 180; lon += 0.25) {
      const p = onDisc(lon, lat) ? proj([lon, lat]) : null;
      if (p && Math.abs(p[0] - 1) < 2.5 && p[1] > 16 && p[1] < H - 22) {
        degs.push({ t: `${Math.abs(lat)}°${lat < 0 ? "S" : lat > 0 ? "N" : ""}`, x: 5, y: p[1] - 4, side: "l" });
        break;
      }
    }
  }

  // only the terrain that can be in view: azimuthal equidistant, so px from the centre ÷ scale = radians
  const [tx, ty] = proj.translate();
  const reach = Math.min(rim, Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - tx, y - ty))) / proj.scale() + 0.02);
  // zoomed far out, contour lines would only be noise over the shading
  const pxPerDeg = (proj.scale() * Math.PI) / 180;
  const contours = pxPerDeg >= 3;
  const band = (b: Terrain["depths"][number], i: number) => {
    const v = visible(b.pieces, centre, reach, pxPerDeg);
    return { i, d: P(v.fill), l: contours ? P(v.lines) : "" };
  };

  return {
    depths: terrain ? terrain.depths.map(band) : [],
    land: terrain ? P(visible(terrain.land, centre, reach, pxPerDeg).fill) : "",
    heights: terrain ? terrain.heights.map(band) : [],
    // the disc in px, so lettering can stay inside its rim
    disc: { x: tx, y: ty, r: rim * proj.scale() },
    // the frame less the chart's disc: only there when zoomed out far enough to see its rim
    space: `M0,0H${W}V${H}H0Z${path({ type: "Sphere" }) ?? ""}`,
    minor: P(GRAT_MINOR),
    major: P(GRAT_MAJOR),
    coast: g ? P(visible(g.coast, centre, reach, pxPerDeg).lines) : "",
    borders: g ? P(visible(g.borders, centre, reach, pxPerDeg).lines) : "",
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
  lines,
  transform,
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
  codes: MapCodes;
  lines: MapLines;
  /** Live pinch/scroll zoom applied on top of the last drawn view until it's redrawn. */
  transform: string | undefined;
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
  const plane = active ? planeAt(proj, active, lines) : null;

  // Destination codes (Settings → Display): placed busiest-first, skipping overlaps; the hub always.
  const labelled = new Set<string>();
  const boxes: Box[] = [];
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
    if (codes === "off") continue;
    const code = codes === "icao" ? a.icao : (a.iata ?? a.icao);
    const w = code.length * 7.4 + 4;
    const x0 = p[0] + 7;
    const b: Box = [x0, p[1] - 9, x0 + w, p[1] + 5];
    if (b[2] > W - 2 || boxes.some((o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]))) continue;
    boxes.push(b);
    labelled.add(a.icao);
  }

  // Lettering is background: it gives way to dots, codes and the hub label.
  for (const { a } of portList) {
    const p = proj([a.lon, a.lat]);
    if (p) boxes.push([p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5]);
  }
  const letters = placeLetters(base, boxes);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      <rect className="map-sea" x="0" y="0" width={W} height={H} />
      <g transform={transform}>
      <Ground base={base} letters={letters} />
      {ordered.map((r) => {
        const d = path({ type: "LineString", coordinates: trackCoords(r, lines) }) ?? "";
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
                {codes === "icao" ? a.icao : (a.iata ?? a.icao)}
              </text>
            )}
          </g>
        );
      })}
      <EdgeDegrees base={base} />
      </g>
    </svg>
  );
}

/**
 * A point along the route at t (0–1): the great circle (the shortest way; straight lines on these
 * maps), or the rhumb line, a constant heading that crosses every meridian at the same angle and so
 * curves with the grid (straight on a Mercator chart).
 */
function track(r: MapRoute, lines: MapLines): (t: number) => [number, number] {
  if (lines === "great") return geoInterpolate([r.from.lon, r.from.lat], [r.to.lon, r.to.lat]);
  const rad = Math.PI / 180;
  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-89, Math.min(89, lat)) * rad) / 2));
  const y0 = merc(r.from.lat);
  const y1 = merc(r.to.lat);
  let dLon = r.to.lon - r.from.lon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  return (t) => {
    const y = y0 + (y1 - y0) * t;
    const lon = r.from.lon + dLon * t;
    return [((lon + 540) % 360) - 180, (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / rad];
  };
}

/** The route as a line to draw: its two ends for a great circle (d3 draws the arc), else points along the rhumb line. */
function trackCoords(r: MapRoute, lines: MapLines): [number, number][] {
  if (lines === "great") return [[r.from.lon, r.from.lat], [r.to.lon, r.to.lat]];
  const at = track(r, lines);
  return Array.from({ length: 49 }, (_, i) => at(i / 48));
}

/** Aircraft marker at the route's midpoint, pointing along the track. */
function planeAt(proj: GeoProjection, r: MapRoute, lines: MapLines) {
  const ip = track(r, lines);
  const a = proj(ip(0.5));
  const b = proj(ip(0.52));
  if (!a || !b) return null;
  return { x: a[0], y: a[1], deg: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 90 };
}

/* ---------- the disc ---------- */

const NM_PER_RAD = 3440.065;
/** How far the chart reaches from its centre unless the content needs more (about an A320's range). */
export const DISC_NM = 5200;

/**
 * The chart's radius in degrees: DISC_NM, or past the furthest thing it shows (`far`, radians from
 * the centre) with room to spare, up to the whole globe. A map only becomes the whole earth when
 * its routes really reach round it; otherwise zooming out stops at a disc like a plotting chart's.
 */
export function mapRadius(far: number, least = DISC_NM): number {
  const nm = Math.max(least, far * NM_PER_RAD * 1.12 + 300);
  return Math.min(179.9, (nm / NM_PER_RAD) * (180 / Math.PI));
}

/* ---------- zoom and pan ---------- */

export const ZMAX = 12;
interface Z {
  k: number;
  x: number;
  y: number;
}
const Z0: Z = { k: 1, x: 0, y: 0 };

/**
 * Zoom (1× = the fitted view, in to 12×, out until the chart's disc fits) and pan for a map element.
 * Screen = k · fitted + (x, y). Zoomed out past the fitted view, the content stays in the middle:
 * the chart opens out around it, as far as the rim of its disc (see mapRadius).
 * Gestures move a cheap SVG transform at once ("live"); the map is redrawn at the new zoom once
 * the gesture rests ("committed"), so lines and lettering stay crisp.
 * Two-finger scroll and trackpad pinch zoom; a plain scroll stops at the fitted view (and then scrolls the page) unless the
 * map is already zoomed out past it, so the page still scrolls past a map; the − button and a pinch go out to the globe.
 * Touch: two-finger pinch, one-finger drag once zoomed in; double-click zooms in.
 */
export function useZoom(ref: RefObject<HTMLElement | null>, W: number, H: number, fit: { scale: number; clip: number } | null) {
  // the chart's whole disc (radius `clip` degrees, so clip·π/180 × scale px) inside the frame
  const kMin = fit ? Math.min(1, (Math.min(W, H) / 2 - 6) / (((fit.clip * Math.PI) / 180) * fit.scale)) : 1;
  const kMinRef = useRef(kMin);
  useEffect(() => {
    kMinRef.current = kMin;
  }, [kMin]);
  const [live, setLive] = useState<Z>(Z0);
  const [committed, setCommitted] = useState<Z>(Z0);
  const liveRef = useRef<Z>(Z0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // a new set of routes (or size) starts from the fitted view again
  const [prevFit, setPrevFit] = useState(fit);
  if (fit !== prevFit) {
    setPrevFit(fit);
    setLive(Z0);
    setCommitted(Z0);
  }
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  const clamp = useCallback(
    (z: Z): Z => {
      const k = Math.min(ZMAX, Math.max(kMin, z.k));
      // zoomed out: the fitted area sits in the middle; zoomed in: the view can't leave it
      if (k < 1) return { k, x: (W * (1 - k)) / 2, y: (H * (1 - k)) / 2 };
      const bx = W * (1 - k), by = H * (1 - k);
      return { k, x: Math.min(0, Math.max(bx, z.x)), y: Math.min(0, Math.max(by, z.y)) };
    },
    [W, H, kMin],
  );
  const apply = useCallback(
    (z: Z, now = false) => {
      const n = clamp(z);
      liveRef.current = n;
      setLive(n);
      clearTimeout(timer.current);
      if (now) setCommitted(n);
      else timer.current = setTimeout(() => setCommitted(n), 140);
    },
    [clamp],
  );
  const zoomAt = useCallback(
    (px: number, py: number, f: number, now = false, floor = kMinRef.current) => {
      const z = liveRef.current;
      const k = Math.min(ZMAX, Math.max(floor, z.k * f));
      const r = k / z.k;
      apply({ k, x: px - r * (px - z.x), y: py - r * (py - z.y) }, now);
    },
    [apply],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const local = (e: { clientX: number; clientY: number }) => {
      const b = el.getBoundingClientRect();
      return [e.clientX - b.left, e.clientY - b.top] as const;
    };
    // Two-finger scroll (and pinch, which arrives as ctrl+wheel) zooms: up = in, down = out.
    // At the fitted view, scrolling down isn't captured, so the page still scrolls past the map.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const zoomingOut = e.deltaY > 0;
      const k = liveRef.current.k;
      const floor = e.ctrlKey || k < 1 ? kMinRef.current : 1;
      if (zoomingOut && k <= floor) return;
      e.preventDefault();
      const [px, py] = local(e);
      const rate = e.ctrlKey ? 0.01 : e.deltaMode === 1 ? 0.05 : 0.004;
      zoomAt(px, py, Math.exp(-e.deltaY * rate), false, floor);
    };
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let last: { x: number; y: number; d: number } | null = null;
    const summary = () => {
      const v = [...pts.values()];
      const x = v.reduce((s, p) => s + p.x, 0) / v.length;
      const y = v.reduce((s, p) => s + p.y, 0) / v.length;
      const d = v.length > 1 ? Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) : 0;
      return { x, y, d };
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element).closest(".map-zoom")) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const [x, y] = local(e);
      pts.set(e.pointerId, { x, y });
      if (pts.size === 1) moved = 0;
      last = summary();
    };
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      const [x, y] = local(e);
      pts.set(e.pointerId, { x, y });
      const s = summary();
      if (!last) return (last = s);
      const z = liveRef.current;
      const dx = s.x - last.x;
      const dy = s.y - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (pts.size > 1 && last.d > 0) {
        // pinch: scale about the fingers' midpoint and follow it
        const k = Math.min(ZMAX, Math.max(kMinRef.current, (z.k * s.d) / last.d));
        const r = k / z.k;
        apply({ k, x: s.x - r * (last.x - z.x), y: s.y - r * (last.y - z.y) });
      } else if (z.k > 1 && moved > 3) {
        if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
        apply({ k: z.k, x: z.x + dx, y: z.y + dy });
      }
      last = s;
    };
    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      last = pts.size ? summary() : null;
    };
    // a drag shouldn't also click a destination dot
    const onClick = (e: MouseEvent) => {
      if (moved > 6) {
        e.stopPropagation();
        e.preventDefault();
        moved = 0;
      }
    };
    const onDbl = (e: MouseEvent) => {
      if ((e.target as Element).closest(".map-zoom")) return;
      const [px, py] = local(e);
      zoomAt(px, py, 2, true);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("click", onClick, true);
    el.addEventListener("dblclick", onDbl);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("dblclick", onDbl);
      clearTimeout(timer.current);
    };
  }, [ref, zoomAt, apply]);

  const r = live.k / committed.k;
  const same = live.k === committed.k && live.x === committed.x && live.y === committed.y;
  return {
    live,
    committed,
    kMin,
    atDefault: live.k === 1 && live.x === 0 && live.y === 0,
    transform: same ? undefined : `translate(${(live.x - r * committed.x).toFixed(2)} ${(live.y - r * committed.y).toFixed(2)}) scale(${r.toFixed(4)})`,
    step: (f: number) => zoomAt(W / 2, H / 2, f, true),
    reset: () => apply(Z0, true),
  };
}
