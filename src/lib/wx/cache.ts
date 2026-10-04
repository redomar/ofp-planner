/**
 * Small localStorage cache for weather responses. Keys look like
 * "ofp-planner:wx:<ICAO>:<kind>:<hour-bucket>" where the bucket is the UTC hour the
 * response was fetched (YYYYMMDDHH). Each entry stores its fetch time; a read returns
 * the freshest entry for that airport and kind still inside its TTL.
 */

export const WX_PREFIX = "ofp-planner:wx:";
/** Entries older than this are pruned whatever their kind. */
const PRUNE_AFTER_MS = 6 * 3600_000;

export type WxKind = "fc" | "metar";
export const TTL_MS: Record<WxKind, number> = { fc: 60 * 60_000, metar: 10 * 60_000 };

interface Entry<T> {
  at: number;
  data: T;
}

const bucket = (ms: number) => new Date(ms).toISOString().slice(0, 13).replace(/[-T]/g, "");
const keyPrefix = (icao: string, kind: WxKind) => `${WX_PREFIX}${icao.toUpperCase()}:${kind}:`;

function keys(): string[] {
  try {
    return Object.keys(window.localStorage).filter((k) => k.startsWith(WX_PREFIX));
  } catch {
    return [];
  }
}

function readEntry<T>(key: string): Entry<T> | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const e = JSON.parse(raw) as Entry<T>;
    return typeof e?.at === "number" ? e : null;
  } catch {
    return null;
  }
}

/** Freshest cached entry within TTL, or null. */
export function cacheGet<T>(icao: string, kind: WxKind, now = Date.now()): { at: number; data: T } | null {
  const p = keyPrefix(icao, kind);
  let best: Entry<T> | null = null;
  for (const k of keys()) {
    if (!k.startsWith(p)) continue;
    const e = readEntry<T>(k);
    if (e && now - e.at < TTL_MS[kind] && (!best || e.at > best.at)) best = e;
  }
  return best;
}

export function cachePut<T>(icao: string, kind: WxKind, data: T, now = Date.now()) {
  prune(now);
  const p = keyPrefix(icao, kind);
  // one entry per airport and kind: drop the older ones first
  for (const k of keys()) if (k.startsWith(p)) del(k);
  try {
    window.localStorage.setItem(p + bucket(now), JSON.stringify({ at: now, data } satisfies Entry<T>));
  } catch {
    /* storage full or blocked: still works, just refetches next time */
  }
}

export function prune(now = Date.now()) {
  for (const k of keys()) {
    const e = readEntry<unknown>(k);
    if (!e || now - e.at > PRUNE_AFTER_MS) del(k);
  }
}

function del(k: string) {
  try {
    window.localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
