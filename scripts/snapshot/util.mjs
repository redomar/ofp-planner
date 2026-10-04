// Small shared helpers for the snapshot pipeline: paths, logging, polite cached fetch, CSV.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Overridable for the server run (see docs/data-pipeline.md). index.mjs maps --cache/--out
// onto these env vars before anything imports this module.
const envCache = process.env.SNAPSHOT_CACHE ? resolve(process.env.SNAPSHOT_CACHE) : null;
/** Raw downloads (re-fetchable). */
export const RAW = envCache ?? join(ROOT, "data/raw");
/** Derived intermediates (per-day ADS-B tracks). */
export const CACHE = envCache ? join(envCache, "derived") : join(ROOT, "data/cache");
/** Published snapshot (what the site serves at /data/). */
export const OUT = process.env.SNAPSHOT_OUT ? resolve(process.env.SNAPSHOT_OUT) : join(ROOT, "public/data");

export const UA = "ofp-planner-snapshot/1 (+https://github.com/redomar; hobby flight-sim tool, runs rarely)";

const t0 = Date.now();
export function log(...args) {
  const s = ((Date.now() - t0) / 1000).toFixed(0).padStart(5);
  console.log(`[${s}s]`, ...args);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function ensureDir(p) {
  mkdirSync(p, { recursive: true });
  return p;
}

/**
 * GET a URL, caching the body at `cachePath`. A cached copy younger than `maxAgeH` hours is
 * reused without touching the network. Retries with backoff on 429/5xx.
 */
export async function cachedFetch(url, cachePath, { maxAgeH = 24 * 7, headers = {}, retries = 3 } = {}) {
  if (existsSync(cachePath)) {
    const { mtimeMs } = await import("node:fs").then((fs) => fs.statSync(cachePath));
    if (Date.now() - mtimeMs < maxAgeH * 3600_000) return readFileSync(cachePath);
  }
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, ...headers }, redirect: "follow" });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}`);
        err.status = res.status;
        throw err;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      ensureDir(dirname(cachePath));
      writeFileSync(cachePath, buf);
      return buf;
    } catch (e) {
      lastErr = e;
      if (e.status && e.status < 500 && e.status !== 429) throw e;
      await sleep(2000 * 2 ** i);
    }
  }
  throw lastErr;
}

/** RFC 4180-ish CSV parser (quoted fields, doubled quotes, CRLF). Returns array of objects. */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

/** Great-circle distance in nautical miles. */
export function distNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Median of minutes-of-day values, robust to the midnight wrap (circular). */
export function circularMedian(mins) {
  const v = mins.filter((x) => x != null);
  if (!v.length) return null;
  // rotate so the largest gap between sorted values sits at the wrap point
  const s = [...v].sort((a, b) => a - b);
  let gapAt = 0;
  let gap = s[0] + 1440 - s[s.length - 1];
  for (let i = 1; i < s.length; i++) {
    if (s[i] - s[i - 1] > gap) {
      gap = s[i] - s[i - 1];
      gapAt = i;
    }
  }
  const base = s[gapAt];
  const rot = s.map((x) => (x - base + 1440) % 1440).sort((a, b) => a - b);
  const m = rot.length % 2 ? rot[(rot.length - 1) / 2] : (rot[rot.length / 2 - 1] + rot[rot.length / 2]) / 2;
  return Math.round(m + base) % 1440;
}

/** Most common value (ties → first seen). */
export function mode(arr) {
  const c = new Map();
  for (const x of arr) if (x != null) c.set(x, (c.get(x) ?? 0) + 1);
  let best = null;
  let n = 0;
  for (const [k, v] of c) if (v > n) [best, n] = [k, v];
  return best;
}
