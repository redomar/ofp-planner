"use client";

import { geoArea } from "d3-geo";
import { useEffect, useState } from "react";

/**
 * Land, height bands and sea-depth bands for the maps (public/geo/terrain.json, built by
 * scripts/build-terrain.mjs from AWS Terrain Tiles + Natural Earth). Fetched once.
 *
 * Every ring is returned as its own polygon, wound as a small area; maps fill them with the
 * even-odd rule, so holes (lakes, valleys inside a band) show through without relying on the
 * source winding.
 */
export interface Band {
  /** Metres above sea level (heights) or below it (depths). */
  v: number;
  geo: GeoJSON.MultiPolygon;
}
export interface Terrain {
  land: GeoJSON.MultiPolygon;
  heights: Band[];
  depths: Band[];
}

interface Raw {
  q: number;
  land: number[][][];
  heights: { v: number; p: number[][][] }[];
  depths: { v: number; p: number[][][] }[];
}

function decode(polys: number[][][], q: number): GeoJSON.MultiPolygon {
  const coordinates: GeoJSON.Position[][][] = [];
  for (const poly of polys)
    for (const flat of poly) {
      const ring: GeoJSON.Position[] = [];
      let x = 0,
        y = 0;
      for (let i = 0; i < flat.length; i += 2) {
        x += flat[i];
        y += flat[i + 1];
        ring.push([x / q, y / q]);
      }
      const first = ring[0],
        last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
      // a ring wound the "wrong" way covers the rest of the globe; flip it to its small side
      if (geoArea({ type: "Polygon", coordinates: [ring] }) > 2 * Math.PI) ring.reverse();
      coordinates.push([ring]);
    }
  return { type: "MultiPolygon", coordinates };
}

let pending: Promise<Terrain | null> | null = null;
let loaded: Terrain | null = null;

function load(): Promise<Terrain | null> {
  pending ??= fetch("/geo/terrain.json")
    .then((r) => (r.ok ? (r.json() as Promise<Raw>) : null))
    .then((j) => {
      if (!j) return null;
      loaded = {
        land: decode(j.land, j.q),
        heights: j.heights.map((b) => ({ v: b.v, geo: decode(b.p, j.q) })),
        depths: j.depths.map((b) => ({ v: b.v, geo: decode(b.p, j.q) })),
      };
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
