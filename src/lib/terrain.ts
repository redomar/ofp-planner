"use client";

import { geoArea, geoDistance } from "d3-geo";
import { useEffect, useState } from "react";

/**
 * Land, height bands and sea-depth bands for the whole globe (public/geo/terrain.json, built by
 * scripts/build-terrain.mjs from AWS Terrain Tiles + Natural Earth). Fetched once.
 *
 * Bands come in 30° tiles that overlap their neighbours by a little, so fills meet without a seam;
 * their polygons keep their holes and arrive wound the way d3-geo reads them. Each band also
 * carries its contour lines: the same rings, less the stretches along the tile's own edges where
 * the grid was cut. Land rings are each their own polygon, wound as a small area; maps fill them
 * with the even-odd rule, so lakes show through.
 *
 * Every polygon keeps a bounding cap (centre and angular radius), so a map draws only what can
 * be in its view, and coarser copies of itself (made on first use), so a zoomed-out map doesn't
 * project points closer together than a pixel: see `visible`.
 */
interface Shape {
  poly: GeoJSON.Position[][];
  lines: GeoJSON.Position[][];
}
export interface Piece extends Shape {
  /** Bounding cap: centre [lon, lat] and radius in radians. */
  c: [number, number];
  r: number;
  /** Coarser copies by level (see LEVELS); null where the shape vanishes at that level. */
  lod: (Shape | null)[];
  /** Contour lines are kept for bands, not for land. */
  contours: boolean;
  /** The tile a band polygon was cut from (its edges aren't contours). */
  tile?: Bounds;
}

/** Simplification tolerances in degrees; level 0 is the file as built (0.04°/0.02°). */
const LEVELS = [0, 0.1, 0.25, 0.6];
export interface Band {
  /** Metres above sea level (heights) or below it (depths). */
  v: number;
  pieces: Piece[];
}
export interface Terrain {
  land: Piece[];
  heights: Band[];
  depths: Band[];
}

interface Raw {
  q: number;
  /** [w, s, e, n] of each tile, in 1/q degrees. */
  tiles: number[][];
  land: number[][][];
  /** Polygons, and the tile each came from. */
  heights: { v: number; p: number[][][]; t: number[] }[];
  depths: { v: number; p: number[][][]; t: number[] }[];
}
type Bounds = [number, number, number, number];

function ring(flat: number[], q: number): GeoJSON.Position[] {
  const out: GeoJSON.Position[] = [];
  let x = 0,
    y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
    out.push([x / q, y / q]);
  }
  const first = out[0],
    last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  return out;
}

/** The cap around a polygon's outer ring: centre of its lon/lat box, radius to the furthest point. */
function cap(outer: GeoJSON.Position[]): Pick<Piece, "c" | "r"> {
  let w = Infinity,
    e = -Infinity,
    s = Infinity,
    n = -Infinity;
  for (const [x, y] of outer) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  const c: [number, number] = [(w + e) / 2, (s + n) / 2];
  let r = 0;
  for (const p of outer) r = Math.max(r, geoDistance(c, p as [number, number]));
  // edges bow out a little between points; past a hemisphere the inside may reach further than any point
  return { c, r: r > Math.PI / 2 ? Math.PI : r + 0.01 };
}

/** Along one of the tile's edges (where its polygons were closed), not a contour. */
const edge = (a: GeoJSON.Position, b: GeoJSON.Position, [w, s, e, n]: Bounds) =>
  (a[0] === b[0] && (a[0] === w || a[0] === e)) || (a[1] === b[1] && (a[1] === s || a[1] === n));

/**
 * A tile's edge along a parallel would be drawn as a great circle, bowing towards the pole; points
 * every half degree keep it on the parallel (and inside the strip its neighbour overlaps).
 */
function hug(r: GeoJSON.Position[], [, s, , n]: Bounds): GeoJSON.Position[] {
  const out: GeoJSON.Position[] = [r[0]];
  for (let i = 1; i < r.length; i++) {
    const [x0, y0] = r[i - 1],
      [x1, y1] = r[i];
    if (y0 === y1 && (y0 === s || y0 === n) && Math.abs(x1 - x0) > 0.5) {
      const steps = Math.ceil(Math.abs(x1 - x0) / 0.5);
      for (let k = 1; k < steps; k++) out.push([x0 + ((x1 - x0) * k) / steps, y0]);
    }
    out.push(r[i]);
  }
  return out;
}

/** A ring as contour lines: broken wherever it runs along its tile's edge. */
function contour(r: GeoJSON.Position[], b: Bounds): GeoJSON.Position[][] {
  const out: GeoJSON.Position[][] = [];
  let cur: GeoJSON.Position[] = [r[0]];
  for (let i = 1; i < r.length; i++) {
    if (edge(r[i - 1], r[i], b)) {
      if (cur.length > 1) out.push(cur);
      cur = [r[i]];
    } else cur.push(r[i]);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function bands(b: Raw["heights"], tiles: Bounds[], q: number): Band[] {
  return b.map(({ v, p, t }) => ({
    v,
    pieces: p.map((rings, k) => {
      const tb = tiles[t[k]];
      const poly = rings.map((f) => hug(ring(f, q), tb));
      return { ...cap(poly[0]), poly, lines: poly.flatMap((r) => contour(r, tb)), lod: [], contours: true, tile: tb };
    }),
  }));
}

function land(polys: number[][][], q: number): Piece[] {
  return polys.flatMap((rings) =>
    rings.map((f) => {
      const r = ring(f, q);
      // a ring wound the "wrong" way covers the rest of the globe; flip it to its small side
      if (geoArea({ type: "Polygon", coordinates: [r] }) > 2 * Math.PI) r.reverse();
      return { ...cap(r), poly: [r], lines: [], lod: [], contours: false };
    }),
  );
}

/** Douglas–Peucker on a closed ring (degrees), keeping both ends. */
function simplify(pts: GeoJSON.Position[], tol: number): GeoJSON.Position[] {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let max = 0,
      idx = -1;
    const [ax, ay] = pts[a],
      [bx, by] = pts[b];
    const dx = bx - ax,
      dy = by - ay,
      len = Math.hypot(dx, dy);
    for (let k = a + 1; k < b; k++) {
      // a closed ring starts and ends on one point: measure from it instead of a line
      const d = len < 1e-9 ? Math.hypot(pts[k][0] - ax, pts[k][1] - ay) : Math.abs(dy * pts[k][0] - dx * pts[k][1] + bx * ay - by * ax) / len;
      if (d > max) {
        max = d;
        idx = k;
      }
    }
    if (max > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

function level(p: Piece, i: number): Shape | null {
  if (i === 0) return p;
  if (p.lod[i] === undefined && !p.poly.length) {
    // a line (coast, border): simplified as it is
    const lines = p.lines.map((l) => simplify(l, LEVELS[i])).filter((l) => l.length >= 2);
    p.lod[i] = lines.length ? { poly: [], lines } : null;
  }
  if (p.lod[i] === undefined) {
    const poly: GeoJSON.Position[][] = [];
    for (const r of p.poly) {
      const s = simplify(r, LEVELS[i]);
      if (s.length >= 4) poly.push(p.tile ? hug(s, p.tile) : s); // simplifying drops the points that kept tile edges on their parallel
      else if (!poly.length) break; // the outer ring is gone: so is the shape
    }
    p.lod[i] = poly.length ? { poly, lines: p.contours && p.tile ? poly.flatMap((r) => contour(r, p.tile!)) : [] } : null;
  }
  return p.lod[i];
}

/**
 * The pieces that can show in a view centred on `centre` reaching `reach` radians, as one
 * MultiPolygon (fill) and one MultiLineString (contours), at the coarsest level whose tolerance
 * stays under about a pixel at `pxPerDeg`.
 */
export function visible(
  pieces: Piece[],
  centre: [number, number],
  reach: number,
  pxPerDeg: number,
): { fill: GeoJSON.MultiPolygon; lines: GeoJSON.MultiLineString } {
  let lvl = 0;
  for (let i = 1; i < LEVELS.length; i++) if (LEVELS[i] * pxPerDeg <= 0.8) lvl = i;
  const fill: GeoJSON.Position[][][] = [];
  const lines: GeoJSON.Position[][] = [];
  for (const p of pieces) {
    if (reach < Math.PI && geoDistance(centre, p.c) - p.r > reach) continue;
    const sh = level(p, lvl);
    if (!sh) continue;
    if (sh.poly.length) fill.push(sh.poly);
    for (const l of sh.lines) lines.push(l);
  }
  return { fill: { type: "MultiPolygon", coordinates: fill }, lines: { type: "MultiLineString", coordinates: lines } };
}

/** Lines (coastlines, borders) as pieces, so `visible` can skip and simplify them too. */
export function linePieces(lines: GeoJSON.Position[][]): Piece[] {
  return lines.map((l) => {
    const { c, r } = cap(l);
    return { c, r: Math.min(Math.PI, r), poly: [], lines: [l], lod: [], contours: false };
  });
}

let pending: Promise<Terrain | null> | null = null;
let loaded: Terrain | null = null;

function load(): Promise<Terrain | null> {
  pending ??= fetch("/geo/terrain.json")
    .then((r) => (r.ok ? (r.json() as Promise<Raw>) : null))
    .then((j) => {
      if (!j) return null;
      const tiles = j.tiles.map((b) => b.map((x) => x / j.q) as Bounds);
      loaded = { land: land(j.land, j.q), heights: bands(j.heights, tiles, j.q), depths: bands(j.depths, tiles, j.q) };
      return loaded;
    })
    .catch(() => null);
  return pending;
}

export function useTerrain(): Terrain | null {
  const [t, setT] = useState<Terrain | null>(loaded);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    void load().then((v) => live && setT(v));
    return () => {
      live = false;
    };
  }, []);
  return t;
}
