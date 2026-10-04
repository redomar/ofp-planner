"use client";

import { useEffect, useState } from "react";

/**
 * Coastlines and country borders for the route map (Natural Earth 1:50m, public
 * domain), built into public/geo by scripts/build-geo.mjs. Fetched once, the first
 * time a map needs it; until then (or if it fails) the map simply has no outlines.
 */
export interface Outlines {
  /** Each line as [lon0, lat0, lon1, lat1, …] in degrees. */
  coast: Float32Array[];
  borders: Float32Array[];
}

let pending: Promise<Outlines | null> | null = null;
let loaded: Outlines | null = null;

function decode(lines: number[][], q: number): Float32Array[] {
  return lines.map((d) => {
    const out = new Float32Array(d.length);
    let x = 0;
    let y = 0;
    for (let i = 0; i < d.length; i += 2) {
      x += d[i];
      y += d[i + 1];
      out[i] = x / q;
      out[i + 1] = y / q;
    }
    return out;
  });
}

function load(): Promise<Outlines | null> {
  pending ??= fetch("/geo/outlines-50m.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { q: number; coast: number[][]; borders: number[][] } | null) => {
      loaded = j ? { coast: decode(j.coast, j.q), borders: decode(j.borders, j.q) } : null;
      return loaded;
    })
    .catch(() => null);
  return pending;
}

export function useOutlines(): Outlines | null {
  const [o, setO] = useState<Outlines | null>(loaded);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    void load().then((v) => live && setO(v));
    return () => {
      live = false;
    };
  }, []);
  return o;
}

/**
 * SVG path data for the parts of `lines` inside a lon/lat box, projected with
 * `px`/`py`. A segment is kept when either end is inside, so lines run cleanly off
 * the edge instead of stopping short.
 */
export function outlinePath(
  lines: Float32Array[],
  box: { lon0: number; lon1: number; lat0: number; lat1: number },
  px: (lon: number) => number,
  py: (lat: number) => number,
): string {
  const parts: string[] = [];
  const inside = (lon: number, lat: number) => lon >= box.lon0 && lon <= box.lon1 && lat >= box.lat0 && lat <= box.lat1;
  for (const l of lines) {
    let open = false;
    let prevIn = false;
    for (let i = 0; i < l.length; i += 2) {
      const lon = l[i];
      const lat = l[i + 1];
      const now = inside(lon, lat);
      // Break at the antimeridian rather than drawing a line across the map.
      const jump = i > 0 && Math.abs(lon - l[i - 2]) > 180;
      if (i > 0 && (now || prevIn) && !jump) {
        if (!open) parts.push(`M${px(l[i - 2]).toFixed(1)} ${py(l[i - 1]).toFixed(1)}`);
        parts.push(`L${px(lon).toFixed(1)} ${py(lat).toFixed(1)}`);
        open = true;
      } else {
        open = false;
      }
      prevIn = now;
    }
  }
  return parts.join("");
}
