"use client";

import { useSyncExternalStore } from "react";

const subs = new Map<string, (cb: () => void) => () => void>();
/** One subscribe function per query, so React doesn't resubscribe on every render. */
const subscribe = (q: string) => {
  let s = subs.get(q);
  if (!s) {
    s = (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    };
    subs.set(q, s);
  }
  return s;
};

/** Whether a media query matches (false while rendering on the server). */
export function useMedia(q: string): boolean {
  return useSyncExternalStore(
    subscribe(q),
    () => window.matchMedia(q).matches,
    () => false,
  );
}
