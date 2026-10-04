// adsb.lol globe history (ODbL 1.0): one GitHub release per UTC day, a split tar of
// everything readsb saw (~3.6 GB). We only read the 48 `heatmap/NN.bin.ttf` half-hour
// slices (~0.8 GB): small range probes find where they sit in the tar (the order differs
// per day), then one ranged stream reads just that stretch and stops.
//
// Heatmap slice format (readsb, gzip-compressed): a flat array of 16-byte records
// (4 × int32 little-endian):
//   time marker   [0x0e7f7c9d, hi, lo, _]   → t = hi * 4294967.296 + lo / 1000 (unix s)
//   callsign      [flags<<24 | hex, 2^30 + x, 8 bytes ASCII callsign]
//   position      [flags<<24 | hex, lat * 1e6, lon * 1e6, (gs*10) << 16 | alt/25 (int16)]
//                 alt == -123 means "on the ground"
// Positions arrive roughly every 20 s per airborne aircraft (ground: less often).
//
// Output: data/cache/tracks/<date>.ndjson.gz — one line per aircraft (hex) flying a callsign
// of a configured airline: {h, c: [[t, callsign]…], p: [t, lat, lon, alt, gs, …]}
//   t   seconds since 00:00 UTC of <date>
//   lat/lon  × 1e4 (≈11 m)
//   alt feet, -1 on the ground
//   gs  knots
// Cruise points are thinned to one per 5 min; everything below 12 000 ft is kept.
import { createWriteStream, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createGzip, gunzipSync } from "node:zlib";
import { BBOX, brandForOperator } from "../airlines.mjs";
import { CACHE, UA, ensureDir, log } from "../util.mjs";

const MAGIC = 0x0e7f7c9d;
const CS_FLAG = 1 << 30;
const GROUND = -123;
const KEEP_BELOW_FT = 12000;
const CRUISE_EVERY_S = 300;

export const tracksDir = () => ensureDir(join(CACHE, "tracks"));
export const tracksPath = (date) => join(tracksDir(), `${date}.ndjson.gz`);

/** The day's release as a list of parts ({url, size}) forming one tar when concatenated. */
async function releaseParts(date) {
  const [y, m, d] = date.split("-");
  for (const pod of ["prod-0", "staging-0"]) {
    const tag = `v${y}.${m}.${d}-planes-readsb-${pod}`;
    const base = `https://github.com/adsblol/globe_history_${y}/releases/download/${tag}/${tag}.tar`;
    const parts = [];
    for (const suffix of [".aa", ".ab", ".ac", ".ad", ".ae"]) {
      const res = await fetch(base + suffix, { method: "HEAD", headers: { "User-Agent": UA }, redirect: "follow" });
      if (!res.ok) break;
      parts.push({ url: base + suffix, size: +res.headers.get("content-length") });
    }
    if (!parts.length) {
      const res = await fetch(base, { method: "HEAD", headers: { "User-Agent": UA }, redirect: "follow" });
      if (res.ok) parts.push({ url: base, size: +res.headers.get("content-length") });
    }
    if (parts.length && parts.every((x) => x.size > 0)) return parts;
  }
  return null;
}

/** Byte stream over the concatenated parts from `start` (absolute offset). */
function rangeReader(parts, start, signal) {
  let partIdx = 0;
  let off = start;
  while (partIdx < parts.length && off >= parts[partIdx].size) off -= parts[partIdx++].size;
  let reader = null;
  return {
    bytes: 0,
    async read() {
      for (;;) {
        if (!reader) {
          if (partIdx >= parts.length) return { done: true };
          const res = await fetch(parts[partIdx].url, { headers: { "User-Agent": UA, Range: `bytes=${off}-` }, redirect: "follow", signal });
          if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
          reader = res.body.getReader();
        }
        const r = await reader.read();
        if (!r.done) {
          this.bytes += r.value.length;
          return r;
        }
        reader = null;
        partIdx++;
        off = 0;
      }
    },
  };
}

/** A 512-byte block that is a valid ustar header (magic + checksum). */
function isHeader(b) {
  if (b.length < 512 || b.toString("latin1", 257, 262) !== "ustar") return false;
  const want = parseInt(b.toString("latin1", 148, 156).replace(/\0.*$/s, "").trim(), 8);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : b[i];
  return sum === want;
}
const headerName = (h) => {
  const name = h.toString("latin1", 0, 100).replace(/\0.*$/s, "");
  const prefix = h.toString("latin1", 345, 500).replace(/\0.*$/s, "");
  return prefix ? `${prefix}/${name}` : name;
};

/**
 * Where in the tar do the heatmap slices sit? The tar follows directory order, which
 * differs per day. Probe small windows across the archive: a window with no tar header
 * at all is inside a large file (heatmap slices are ~15–25 MB; traces are a few kB).
 */
async function locateHeatmaps(parts) {
  const total = parts.reduce((a, p) => a + p.size, 0);
  const STEP = 40e6;
  const WIN = 256 * 1024;
  const hits = [];
  for (let at = 0; at < total; at += STEP) {
    const start = Math.floor(at / 512) * 512;
    const ctrl = new AbortController();
    const rr = rangeReader(parts, start, ctrl.signal);
    const chunks = [];
    let have = 0;
    try {
      while (have < WIN) {
        const { done, value } = await rr.read();
        if (done) break;
        chunks.push(value);
        have += value.length;
      }
    } finally {
      ctrl.abort();
    }
    const buf = Buffer.concat(chunks, have);
    let kind = "big";
    for (let o = 0; o + 512 <= buf.length; o += 512) {
      const h = buf.subarray(o, o + 512);
      if (isHeader(h)) {
        kind = /heatmap\//.test(headerName(h)) ? "heatmap" : "other";
        break;
      }
    }
    if (kind !== "other") hits.push(start);
  }
  if (!hits.length) return 0;
  return Math.max(0, hits[0] - STEP);
}

const targetCallsign = (cs) => /^[A-Z]{3}[0-9]/.test(cs) && brandForOperator(cs.slice(0, 3)) !== undefined;

/** Per-day state across the 48 slices. */
class DayState {
  constructor(dayStart) {
    this.dayStart = dayStart;
    this.targets = new Set(); // hex numbers
    this.cs = new Map(); // hex → [[t, cs]]
    this.pts = new Map(); // hex → number[]
    this.lastHigh = new Map(); // hex → t of last kept cruise point
  }

  slice(buf) {
    const p = new Int32Array(buf.buffer, buf.byteOffset, buf.length >> 2);
    // pass 1: which aircraft fly a configured airline's callsign in this slice
    for (let i = 0; i < p.length; i += 4) {
      if (p[i] === MAGIC) continue;
      if (p[i + 1] > CS_FLAG) {
        const cs = buf.toString("latin1", (i + 2) * 4, (i + 4) * 4).replace(/[\0 ]+$/g, "").trim();
        if (targetCallsign(cs)) this.targets.add(p[i] & 0xffffff);
      }
    }
    // pass 2: callsigns and positions of those aircraft. Slices arrive out of order in the
    // tar, so cruise thinning restarts per slice.
    this.lastHigh.clear();
    let t = 0;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i] === MAGIC) {
        t = Math.round((p[i + 1] >>> 0) * 4294967.296 + (p[i + 2] >>> 0) / 1000) - this.dayStart;
        continue;
      }
      const hex = p[i] & 0xffffff;
      if (!this.targets.has(hex)) continue;
      if (p[i + 1] > CS_FLAG) {
        const cs = buf.toString("latin1", (i + 2) * 4, (i + 4) * 4).replace(/[\0 ]+$/g, "").trim();
        if (!cs) continue;
        let list = this.cs.get(hex);
        if (!list) this.cs.set(hex, (list = []));
        if (!list.length || list[list.length - 1][1] !== cs) list.push([t, cs]);
        continue;
      }
      const lat = p[i + 1] / 1e6;
      const lon = p[i + 2] / 1e6;
      if (lat < BBOX.latMin || lat > BBOX.latMax || lon < BBOX.lonMin || lon > BBOX.lonMax) continue;
      const altRaw = (p[i + 3] << 16) >> 16;
      const gs = Math.round((p[i + 3] >> 16) / 10);
      let alt;
      if (altRaw === GROUND) alt = -1;
      else if (altRaw < -40) continue; // unknown / invalid
      else alt = altRaw * 25;
      if (alt >= KEEP_BELOW_FT) {
        const last = this.lastHigh.get(hex);
        if (last !== undefined && t - last < CRUISE_EVERY_S) continue;
        this.lastHigh.set(hex, t);
      }
      let arr = this.pts.get(hex);
      if (!arr) this.pts.set(hex, (arr = []));
      arr.push(t, Math.round(lat * 1e4), Math.round(lon * 1e4), alt, gs);
    }
  }
}


/** Streams the part of the day's tar holding the heatmap slices; writes the tracks file. */
export async function fetchDay(date, { force = false } = {}) {
  const out = tracksPath(date);
  if (existsSync(out) && !force) {
    log(`adsb.lol ${date}: cached`);
    return out;
  }
  const parts = await releaseParts(date);
  if (!parts) {
    log(`adsb.lol ${date}: no release found, skipping`);
    return null;
  }
  const start = await locateHeatmaps(parts);
  const dayStart = Date.parse(`${date}T00:00:00Z`) / 1000;
  const state = new DayState(dayStart);
  const ctrl = new AbortController();
  const rr = rangeReader(parts, start, ctrl.signal);

  let buf = Buffer.alloc(0);
  let slices = 0;
  let seenHeatmap = false;
  const need = async (n) => {
    if (buf.length >= n) return true;
    const chunks = [buf];
    let have = buf.length;
    let ok = true;
    while (have < n) {
      const { done, value } = await rr.read();
      if (done) {
        ok = false;
        break;
      }
      chunks.push(value);
      have += value.length;
    }
    buf = Buffer.concat(chunks, have);
    return ok;
  };
  const skip = async (n) => {
    while (n > 0) {
      if (!buf.length && !(await need(1))) return false;
      const take = Math.min(n, buf.length);
      buf = buf.subarray(take);
      n -= take;
    }
    return true;
  };
  let longName = null;
  let synced = start === 0;
  try {
    for (;;) {
      if (!(await need(512))) break;
      const h = buf.subarray(0, 512);
      if (!synced) {
        // started mid-archive: advance block by block to the next real header
        if (!isHeader(h)) {
          buf = buf.subarray(512);
          continue;
        }
        synced = true;
      }
      if (h.every((b) => b === 0)) break; // end of archive
      let name = headerName(h);
      const size = parseInt(h.toString("latin1", 124, 136).replace(/\0.*$/s, "").trim() || "0", 8);
      const type = String.fromCharCode(h[156]);
      buf = buf.subarray(512);
      const padded = Math.ceil(size / 512) * 512;
      if (type === "L") {
        if (!(await need(padded))) break;
        longName = buf.toString("latin1", 0, size).replace(/\0.*$/s, "");
        buf = buf.subarray(padded);
        continue;
      }
      if (longName) {
        name = longName;
        longName = null;
      }
      const isHeat = /heatmap\/\d+\.bin\.ttf$/.test(name);
      if (isHeat) {
        seenHeatmap = true;
        if (!(await need(padded))) break;
        state.slice(gunzipSync(buf.subarray(0, size)));
        slices++;
        buf = buf.subarray(padded);
        if (slices >= 48) break;
      } else {
        if (seenHeatmap && type === "0") break; // past the heatmaps: stop downloading
        if (!(await skip(padded))) break;
      }
    }
  } finally {
    ctrl.abort();
  }
  if (slices < 40) throw new Error(`only ${slices}/48 heatmap slices found (read ${(rr.bytes / 1e6).toFixed(0)} MB from ${(start / 1e6).toFixed(0)} MB)`);

  const tmp = `${out}.tmp`;
  const gz = createGzip({ level: 6 });
  const ws = createWriteStream(tmp);
  gz.pipe(ws);
  let n = 0;
  for (const [hex, pts] of state.pts) {
    const c = state.cs.get(hex) ?? [];
    if (!c.length || pts.length < 10) continue;
    gz.write(JSON.stringify({ h: hex.toString(16).padStart(6, "0"), c, p: pts }) + "\n");
    n++;
  }
  gz.end();
  await new Promise((r, j) => ws.on("finish", r).on("error", j));
  renameSync(tmp, out);
  log(`adsb.lol ${date}: ${slices} slices, ${(rr.bytes / 1e6).toFixed(0)} MB read from ${(start / 1e6).toFixed(0)} MB, ${n} aircraft`);
  return out;
}
