// Builds public/geo/outlines-<res>.json: coastlines and country borders for the whole
// globe from Natural Earth (public domain, via world-atlas) for the maps. Each line is a flat list
// of delta-encoded [lon, lat] in hundredths of a degree, so the client decodes it with
// a running sum and no topology library.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mesh } from "topojson-client";

const require = createRequire(import.meta.url);
const Q = 100;

function delta(line) {
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
}

function encode(lines) {
  return lines.map(delta).filter((l) => l.length >= 4);
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
