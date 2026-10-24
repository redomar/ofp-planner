"use client";

import { geoAzimuthalEquidistant, geoCircle, geoDistance, geoPath, type GeoProjection } from "d3-geo";
import { useEffect, useMemo, useRef, useState } from "react";
import { NM_PER_DEG, type RangePlace } from "@/lib/range";
import { useOutlines } from "@/lib/outlines";
import { useTerrain } from "@/lib/terrain";
import { baseLayers, Ground, mapRadius, onDiscBox, placeLetters, useZoom, ZoomButtons, type Box } from "./RouteMap";

export interface Ring {
  id: string;
  nm: number;
  /** Any CSS colour (the page mixes family tokens). */
  color: string;
  dash?: string;
  name: string;
}
export interface RangePoint extends RangePlace {
  mine: boolean;
  /** Great-circle distance from the origin, NM. */
  d: number;
  /** data-tip attributes for the dot. */
  tip: Record<string, string>;
}

const GUIDES = [1000, 2000, 3000, 4000, 5000];
/** The disc's least reach: past every ring an A320 can draw, with room for the airports beyond it. */
const RANGE_NM = 6000;

/**
 * Range rings on the same chart as the route maps (azimuthal equidistant, centred on the origin,
 * so every ring is a true circle and every point sits at its real distance), on a disc reaching
 * RANGE_NM from it (further only if a ring does, for longer-range aircraft); airports past the rim
 * aren't drawn. With `relief` off
 * the chart is just land and sea, with no lettering, so the rings stand out.
 */
export function RangeMap({
  origin,
  rings,
  fitNm,
  hot,
  points,
  onPick,
  label,
  relief,
}: {
  origin: RangePlace;
  rings: Ring[];
  /** Radius the default view fits (the furthest ring the current aircraft can reach). */
  fitNm: number;
  /** A ring to bring forward (hovered in the list). */
  hot: string | null;
  points: RangePoint[];
  /** Clicking a dot makes it the origin. */
  onPick: (icao: string) => void;
  label: string;
  /** Height and depth bands, and the sea, country and range names. */
  relief: boolean;
}) {
  const outlines = useOutlines();
  const terrain = useTerrain();
  const ref = useRef<HTMLElement>(null);
  // the figure's size comes from CSS (fixed before anything loads, so nothing shifts)
  const [[W, H], setSize] = useState<[number, number]>([0, 0]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize([Math.round(e.contentRect.width), Math.round(e.contentRect.height)]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useMemo(() => {
    if (W < 50 || H < 50) return null;
    const proj: GeoProjection = geoAzimuthalEquidistant()
      .rotate([-origin.lon, -origin.lat])
      .fitExtent(
        [
          [44, 34],
          [W - 34, H - 30],
        ],
        geoCircle().center([origin.lon, origin.lat]).radius((fitNm * 1.04) / NM_PER_DEG)(),
      );
    return { rotate: proj.rotate(), scale: proj.scale(), translate: proj.translate(), clip: mapRadius(((fitNm / NM_PER_DEG) * Math.PI) / 180, RANGE_NM) };
  }, [origin.lon, origin.lat, fitNm, W, H]);

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

  const drawn = useMemo(() => {
    if (!view || !base) return null;
    const { proj, path } = view;
    const circle = (nm: number) => path(geoCircle().center([origin.lon, origin.lat]).radius(nm / NM_PER_DEG).precision(0.5)()) ?? "";
    const home = proj([origin.lon, origin.lat]);
    const boxes: Box[] = [];
    if (home) boxes.push([home[0] - 24, home[1] - 30, home[0] + 24, home[1] + 6]);
    // your airports are always labelled; the rest only where there's room
    const ordered = [...points].sort((a, b) => Number(b.mine) - Number(a.mine) || a.d - b.d);
    const dots = ordered.flatMap((pt) => {
      if (geoDistance([origin.lon, origin.lat], [pt.lon, pt.lat]) > (fit!.clip - 1) * (Math.PI / 180)) return [];
      const p = proj([pt.lon, pt.lat]);
      if (!p || p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) return [];
      boxes.push([p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5]);
      return [{ pt, x: p[0], y: p[1] }];
    });
    const hits = (b: Box) => boxes.some((o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]));
    const labelled = dots.map(({ pt, x, y }) => {
      const w = pt.icao.length * 7.4 + 4;
      const rightBox: Box = [x + 7, y - 9, x + 7 + w, y + 5];
      const leftBox: Box = [x - 7 - w, y - 9, x - 7, y + 5];
      // the side away from the edge first, then the other; yours are labelled even if both are taken
      const sides: [boolean, Box][] = x < W - 70 ? [[true, rightBox], [false, leftBox]] : [[false, leftBox], [true, rightBox]];
      const inside = sides.filter(([, b]) => onDiscBox(base, b));
      const pick = inside.find(([, b]) => !hits(b)) ?? (pt.mine ? (inside[0] ?? sides[0]) : null);
      if (pick) boxes.push(pick[1]);
      return { pt, x, y, right: pick ? pick[0] : true, label: !!pick };
    });
    // each 1,000 NM guide is labelled where the label doesn't cover a dot or a code
    const guides = GUIDES.flatMap((nm): { nm: number; d: string; at: [number, number] | null }[] => {
      const d = circle(nm);
      if (!d) return [];
      const w = 64;
      for (const brg of [215, 160, 250, 125, 290]) {
        const p = proj(destination(origin, nm, brg));
        if (!p || p[0] < 30 || p[0] > W - w - 10 || p[1] < 14 || p[1] > H - 24) continue;
        const b: Box = [p[0] + 2, p[1] - 10, p[0] + 6 + w, p[1] + 3];
        if (!onDiscBox(base, b) || boxes.some((o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]))) continue;
        boxes.push(b);
        return [{ nm, d, at: p }];
      }
      return [{ nm, d, at: null }];
    });
    const letters = relief ? placeLetters(base, boxes) : { seas: [], countries: [], ranges: [] };
    return { home, labelled, guides, letters, ring: (nm: number) => circle(nm) };
  }, [view, base, points, origin, W, H, relief, fit]);

  const order = [...rings].sort((a, b) => Number(a.id === hot) - Number(b.id === hot) || b.nm - a.nm);

  return (
    <figure ref={ref} className={`map range-map${relief ? " relief" : ""}${zoom.live.k !== 1 ? " zoomed" : ""}`}>
      {view && base && drawn && (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
          <rect className="map-sea" x="0" y="0" width={W} height={H} />
          <g transform={zoom.transform}>
            <Ground base={base} letters={drawn.letters} relief={relief} />
            <g className="range-guides" aria-hidden="true">
              {drawn.guides.map((g) => (
                <path key={g.nm} d={g.d} />
              ))}
              {drawn.guides.map(
                (g) =>
                  g.at && (
                    <text key={g.nm} x={g.at[0] + 4} y={g.at[1]}>
                      {g.nm.toLocaleString("en-GB")} NM
                    </text>
                  ),
              )}
            </g>
            {order.map((r) => {
              const d = drawn.ring(r.nm);
              return (
                <g key={r.id} className={`range-ring${r.id === hot ? " hot" : ""}${hot && r.id !== hot ? " dim" : ""}`} data-ring={r.id}>
                  <path className="range-casing" d={d} />
                  <path className="range-line" d={d} style={{ stroke: r.color, strokeDasharray: r.dash }} />
                </g>
              );
            })}
            {drawn.labelled.map(({ pt, x, y, right, label: show }) => (
              <g
                key={pt.icao}
                className={`map-port pick range-pt${pt.mine ? " mine" : ""}${rings.some((r) => r.nm >= pt.d) ? " in" : " out"}`}
                transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
                tabIndex={0}
                role="button"
                aria-label={`${pt.icao} ${pt.name}, ${pt.d.toLocaleString("en-GB")} NM. Make it the origin.`}
                onClick={() => onPick(pt.icao)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(pt.icao))}
                {...pt.tip}
              >
                <circle className="map-hit" r="10" />
                <circle className="map-dot" r={pt.mine ? 4.6 : 3.2} />
                {show && (
                  <text x={right ? 8 : -8} y={4} textAnchor={right ? "start" : "end"}>
                    {pt.icao}
                  </text>
                )}
              </g>
            ))}
            {drawn.home && (
              <g className="map-port hub range-home" transform={`translate(${drawn.home[0].toFixed(1)} ${drawn.home[1].toFixed(1)})`}>
                <circle className="map-dot" r="5" />
                <text x="0" y="-11" textAnchor="middle">
                  {origin.icao}
                </text>
              </g>
            )}
          </g>
        </svg>
      )}
      {view && <ZoomButtons zoom={zoom} title="Default view: fit the furthest ring" />}
    </figure>
  );
}

/** The point `nm` along the great circle from `o` on true bearing `brg`. */
function destination(o: RangePlace, nm: number, brg: number): [number, number] {
  const r = Math.PI / 180;
  const d = nm / NM_PER_DEG * r;
  const b = brg * r;
  const la = o.lat * r;
  const lo = o.lon * r;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [lo2 / r, la2 / r];
}
