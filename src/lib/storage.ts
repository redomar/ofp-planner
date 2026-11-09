/**
 * Everything the app remembers lives in localStorage under "ofp-planner:" and is
 * private to this browser. Components read through useStored(), which re-renders on
 * changes from this tab and from other tabs (the storage event).
 */
import { useSyncExternalStore } from "react";
import { THEME_KEY } from "./keys";
import { COLLAPSE_KEY } from "./collapse-boot";

const NS = "ofp-planner:";
const CHANGE = "ofp-planner:change";

export const KEYS = {
  airframes: `${NS}airframes`,
  favourites: `${NS}favourites`,
  favGroups: `${NS}fav-groups`,
  fnOverrides: `${NS}flight-numbers`,
  history: `${NS}history`,
  prefs: `${NS}prefs`,
  ready: `${NS}ready`,
  display: `${NS}display`,
  logbook: `${NS}logbook`,
  range: `${NS}range`,
} as const;

function get(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
/** False when the browser refused (storage full or blocked): the app still works, it just forgets. */
function set(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
function del(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

let version = 0;
function changed() {
  version++;
  try {
    window.dispatchEvent(new Event(CHANGE));
  } catch {
    /* ignore */
  }
}

export function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith(NS) || e.key === THEME_KEY) {
      version++;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE, cb);
  };
}
const getVersion = () => version;
const getServerVersion = () => -1;

/** -1 on the server and before hydration, so callers can tell "not read yet" from "empty". */
export function useStorageVersion() {
  return useSyncExternalStore(subscribe, getVersion, getServerVersion);
}

/*
 * What each stored value must look like. Values come back from a backup or another tab as
 * plain JSON, so a reader checks them before use: a list drops the entries that don't fit,
 * anything else of the wrong kind reads as the default.
 */
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
type Shape = { list: (v: unknown) => boolean } | { obj: (v: Record<string, unknown>) => boolean; nullable?: boolean };
const anyObj = { obj: () => true };
const saved = (v: unknown) => isObj(v) && isStr(v.id) && isStr(v.o) && isStr(v.d);
const SHAPES: Record<string, Shape> = {
  [KEYS.logbook]: { list: (v) => isObj(v) && isStr(v.id) && isStr(v.date) && isStr(v.from) && isStr(v.to) },
  [KEYS.favourites]: { list: saved },
  [KEYS.history]: { list: saved },
  [KEYS.favGroups]: { list: isStr },
  [KEYS.airframes]: { obj: (v) => Array.isArray(v.list) && v.list.every((a) => isObj(a) && isStr(a.id) && isStr(a.name) && isStr(a.icao) && isStr(a.sbType)) },
  [KEYS.fnOverrides]: anyObj,
  [KEYS.prefs]: anyObj,
  [KEYS.display]: anyObj,
  [KEYS.ready]: { ...anyObj, nullable: true },
  [KEYS.range]: { ...anyObj, nullable: true },
  [COLLAPSE_KEY]: { list: isStr },
};

/** The value made to fit its key's shape, or undefined when it can't be used at all. */
function fit(key: string, v: unknown): unknown {
  const s = SHAPES[key];
  if (!s) return v;
  if ("list" in s) return Array.isArray(v) ? v.filter(s.list) : undefined;
  if (v === null) return s.nullable ? null : undefined;
  return isObj(v) && s.obj(v) ? v : undefined;
}

/** Why a raw stored value doesn't fit its key (for checking a backup before it replaces anything), or null when it does. */
export function misfit(key: string, raw: string): string | null {
  const s = SHAPES[key];
  if (!s) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return "isn't valid JSON";
  }
  if ("list" in s) {
    if (!Array.isArray(v)) return "should be a list";
    const bad = v.findIndex((x) => !s.list(x));
    return bad < 0 ? null : `has a malformed entry (#${bad + 1})`;
  }
  if (v === null) return s.nullable ? null : "is empty";
  return isObj(v) && s.obj(v) ? null : "has the wrong shape";
}

export function readJSON<T>(key: string, fallback: T): T {
  const raw = get(key);
  if (raw == null) return fallback;
  try {
    const v = fit(key, JSON.parse(raw));
    return v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}
/** False when the browser refused to store it (full or blocked); nothing was saved then. */
export function writeJSON(key: string, value: unknown): boolean {
  const ok = set(key, JSON.stringify(value));
  changed();
  return ok;
}
export function removeKey(key: string) {
  del(key);
  changed();
}

/** Bytes used by this app in localStorage (UTF-16, so 2 bytes per char). */
export function storageBytes(): number {
  let n = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(NS) || k === THEME_KEY) n += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2;
    }
  } catch {
    /* ignore */
  }
  return n;
}

export function clearAll() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(NS)) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
  changed();
}

/* ---------- theme preference (shared with the inline boot script) ---------- */

export { THEME_KEY };
export type ThemePref = "system" | "light" | "dark";

export function readTheme(): ThemePref {
  const t = get(THEME_KEY);
  return t === "light" || t === "dark" ? t : "system";
}

export function applyTheme(pref: ThemePref) {
  const el = document.documentElement;
  if (pref === "system") {
    delete el.dataset.theme;
    del(THEME_KEY);
  } else {
    el.dataset.theme = pref;
    set(THEME_KEY, pref);
  }
  changed();
}
