/**
 * Everything the app remembers lives in localStorage under "ofp-planner:" and is
 * private to this browser. Components read through useStored(), which re-renders on
 * changes from this tab and from other tabs (the storage event).
 */
import { useSyncExternalStore } from "react";
import { THEME_KEY } from "./keys";

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
} as const;

function get(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage full or blocked: the app still works, it just forgets */
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

export function readJSON<T>(key: string, fallback: T): T {
  const raw = get(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
export function writeJSON(key: string, value: unknown) {
  set(key, JSON.stringify(value));
  changed();
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
