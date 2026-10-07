// Builds public/geo/terrain.json: the map's land, height bands and sea-depth bands for the region,
// as small vector polygons the browser projects like the coastlines. Run by hand (needs network):
//   node scripts/build-terrain.mjs            (≈ 1 min; output is committed)
// Elevation: AWS Terrain Tiles (Terrarium encoding, open data; sources include SRTM, GMTED2010,
// ETOPO1). Land: Natural Earth 1:50m (public domain), clipped to the region.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { geoIdentity, geoPath } from "d3-geo";
import { contours } from "d3-contour";
import { PNG } from "pngjs";
import { feature } from "topojson-client";

const require = createRequire(import.meta.url);
const BOX = { w: -75, e: 115, s: -12, n: 85 }; // wider than any map shows, so projected edges stay filled
const STEP = 0.1; // grid spacing in degrees (~11 km)
const LAND_LEVELS = [200, 500, 1000, 1500, 2000, 3000, 4000, 5000];
const SEA_LEVELS = [200, 1000, 2000, 4000]; // depths
const Z = 5;
const N = 1 << Z;
const Q = 100; // coordinates stored in hundredths of a degree

/* ---------- elevation from Terrarium tiles ---------- */

const tx = (lon) => ((lon + 180) / 360) * N;
const ty = (lat) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * N;
const x0 = Math.floor(tx(BOX.w)), x1 = Math.floor(tx(BOX.e - 1e-9));
const y0 = Math.floor(ty(BOX.n)), y1 = Math.floor(ty(BOX.s + 1e-9));
const MW = (x1 - x0 + 1) * 256, MH = (y1 - y0 + 1) * 256;
const mosaic = new Float32Array(MW * MH);

async function tile(x, y) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const png = PNG.sync.read(Buffer.from(await r.arrayBuffer()));
      for (let j = 0; j < 256; j++)
        for (let i = 0; i < 256; i++) {
          const k = (j * 256 + i) * 4;
          mosaic[((y - y0) * 256 + j) * MW + (x - x0) * 256 + i] = png.data[k] * 256 + png.data[k + 1] + png.data[k + 2] / 256 - 32768;
        }
      return;
    } catch (e) {
      if (attempt === 3) throw new Error(`${url}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 1000 * (attempt + 1)));
    }
  }
}

const jobs = [];
for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);
console.log(`fetching ${jobs.length} elevation tiles (z${Z})…`);
for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map(([x, y]) => tile(x, y)));

function elev(lon, lat) {
  const fx = (tx(lon) - x0) * 256, fy = (ty(lat) - y0) * 256;
  const ix = Math.max(0, Math.min(MW - 2, Math.floor(fx))), iy = Math.max(0, Math.min(MH - 2, Math.floor(fy)));
  const ax = fx - ix, ay = fy - iy, i = iy * MW + ix;
  return (mosaic[i] * (1 - ax) + mosaic[i + 1] * ax) * (1 - ay) + (mosaic[i + MW] * (1 - ax) + mosaic[i + MW + 1] * ax) * ay;
}

/* ---------- regular lon/lat grid → contour bands ---------- */

const GW = Math.round((BOX.e - BOX.w) / STEP) + 1, GH = Math.round((BOX.n - BOX.s) / STEP) + 1;
const grid = new Float64Array(GW * GH);
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) grid[j * GW + i] = elev(BOX.w + i * STEP, BOX.n - j * STEP);
const neg = grid.map((v) => -v);
{ let lo = Infinity, hi = -Infinity; for (const v of grid) { if (v < lo) lo = v; if (v > hi) hi = v; } console.log(`grid ${GW}×${GH}, elevation ${lo.toFixed(0)} … ${hi.toFixed(0)} m`); }

// light smoothing so 0.1° steps don't show as stair-steps in the contours
function smooth(a) {
  const out = new Float64Array(a.length);
  for (let j = 0; j < GH; j++)
    for (let i = 0; i < GW; i++) {
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const jj = j + dj, ii = i + di; if (jj >= 0 && jj < GH && ii >= 0 && ii < GW) { s += a[jj * GW + ii]; n++; } }
      out[j * GW + i] = s / n;
    }
  return out;
}

const toLonLat = ([i, j]) => [BOX.w + i * STEP, BOX.n - j * STEP];

// Douglas–Peucker on a ring (degrees)
function simplify(pts, tol) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    for (let k = a + 1; k < b; k++) {
      // closed rings start and end on the same point: measure from that point instead of a line
      const d = len < 1e-9 ? Math.hypot(pts[k][0] - ax, pts[k][1] - ay) : Math.abs(dy * pts[k][0] - dx * pts[k][1] + bx * ay - by * ax) / len;
      if (d > max) { max = d; idx = k; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, k) => keep[k]);
}

/** Polygons → delta-encoded rings in hundredths of a degree; tiny rings dropped. */
function encodePolys(polys, tol, minPts = 4) {
  const out = [];
  for (const poly of polys) {
    const rings = [];
    for (const ring of poly) {
      const s = simplify(ring, tol);
      if (s.length < minPts) continue;
      const flat = [];
      let px = 0, py = 0;
      for (const [lon, lat] of s) {
        const x = Math.round(lon * Q), y = Math.round(lat * Q);
        if (flat.length && x === px && y === py) continue;
        flat.push(x - px, y - py);
        px = x; py = y;
      }
      if (flat.length >= minPts * 2) rings.push(flat);
    }
    if (rings.length) out.push(rings);
  }
  return out;
}

const bands = (values, levels) =>
  contours().size([GW, GH]).thresholds(levels)(Array.from(values)).map((c) => ({
    v: c.value,
    p: encodePolys(c.coordinates.map((poly) => poly.map((ring) => ring.map(toLonLat))), 0.04),
  }));

console.log("contouring…");
const land = bands(smooth(grid), LAND_LEVELS);
const sea = bands(smooth(neg), SEA_LEVELS);

/* ---------- Natural Earth land, clipped to the box (planar clip on lon/lat) ---------- */

const topo = require("world-atlas/land-50m.json");
const ne = feature(topo, topo.objects.land);
const rings = [];
let cur = null;
const ctx = {
  moveTo(x, y) { cur = [[x, -y]]; },
  lineTo(x, y) { cur.push([x, -y]); },
  closePath() { if (cur && cur.length > 3) rings.push(cur); cur = null; },
  arc() {}, rect() {},
};
const ident = geoIdentity().reflectY(true).clipExtent([[BOX.w, -BOX.n], [BOX.e, -BOX.s]]);
geoPath(ident, ctx)(ne);
// each ring as its own polygon; holes (lakes) are drawn as islands of sea by even-odd fill in the client
const landPolys = encodePolys(rings.map((r) => [r]), 0.02, 3);

mkdirSync("public/geo", { recursive: true });
const out = { q: Q, box: BOX, landLevels: LAND_LEVELS, seaLevels: SEA_LEVELS, land: landPolys, heights: land, depths: sea };
const json = JSON.stringify(out);
writeFileSync("public/geo/terrain.json", json);
console.log(`public/geo/terrain.json: ${(json.length / 1024).toFixed(0)} KB (${landPolys.length} land polygons)`);
