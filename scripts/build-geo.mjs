// Builds public/geo/outlines-<res>.json: coastlines and country borders from Natural
// Earth (public domain, via world-atlas) for the route map. Each line is a flat list
// of delta-encoded [lon, lat] in hundredths of a degree, so the client decodes it with
// a running sum and no topology library.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mesh } from "topojson-client";

const require = createRequire(import.meta.url);
const Q = 100;

// Only the EMEA region is ever drawn, so lines are cut to this box (with a margin so
// projected edges stay filled). Keeps the file a fraction of the world's size.
const BOX = { w: -75, e: 115, s: -12, n: 86 };
const inBox = ([lon, lat]) => lon >= BOX.w && lon <= BOX.e && lat >= BOX.s && lat <= BOX.n;
function clip(lines) {
  const out = [];
  for (const line of lines) {
    let cur = [];
    for (const p of line) {
      if (inBox(p)) cur.push(p);
      else {
        if (cur.length >= 2) out.push(cur);
        cur = [];
      }
    }
    if (cur.length >= 2) out.push(cur);
  }
  return out;
}

function encode(lines) {
  return clip(lines).map((line) => {
    const out = [];
    let px = 0;
    let py = 0;
    for (const [lon, lat] of line) {
      const x = Math.round(lon * Q);
      const y = Math.round(lat * Q);
      if (out.length && x === px && y === py) continue;
      out.push(x - px, y - py);
      px = x;
      py = y;
    }
    return out;
  }).filter((l) => l.length >= 4);
}

export function buildGeo(res = "50m") {
  const topo = JSON.parse(readFileSync(require.resolve(`world-atlas/countries-${res}.json`), "utf8"));
  const obj = topo.objects.countries;
  const coast = mesh(topo, obj, (a, b) => a === b).coordinates;
  const borders = mesh(topo, obj, (a, b) => a !== b).coordinates;
  mkdirSync("public/geo", { recursive: true });
  const file = `public/geo/outlines-${res}.json`;
  writeFileSync(file, JSON.stringify({ q: Q, coast: encode(coast), borders: encode(borders) }));
  return file;
}
