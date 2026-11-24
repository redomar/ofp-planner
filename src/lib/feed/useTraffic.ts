"use client";

/**
 * 1.17: the VATSIM and IVAO feeds for the traffic views, fetched only while one is on screen. Every
 * view on the page shares one fetch per feed (VATSIM every 15 s, IVAO every 30 s).
 */
import { useEffect, useState } from "react";
import { VATSIM_URL } from "./sources";

export const IVAO_URL = "https://api.ivao.aero/v2/tracker/whazzup";

type Feed = {
  url: string;
  every: number;
  data: unknown;
  at: number;
  busy: boolean;
  users: number;
  timer: ReturnType<typeof setTimeout> | null;
  subs: Set<() => void>;
};
const feeds = new Map<string, Feed>();

function feed(url: string, every: number): Feed {
  let f = feeds.get(url);
  if (!f) {
    f = {
      url,
      every,
      data: null,
      at: 0,
      busy: false,
      users: 0,
      timer: null,
      subs: new Set(),
    };
    feeds.set(url, f);
  }
  return f;
}

async function poll(f: Feed) {
  if (f.busy || f.users === 0) return;
  f.busy = true;
  try {
    const r = await fetch(f.url, { cache: "no-store" });
    if (r.ok) {
      f.data = await r.json();
      f.at = Date.now();
      f.subs.forEach((s) => s());
    }
  } catch {
    /* the feed is down: keep what we had, try again next time */
  }
  f.busy = false;
  if (f.users > 0) f.timer = setTimeout(() => poll(f), f.every);
}

/** The latest VATSIM and IVAO data (null until fetched). `on`: a traffic view is showing. */
export function useNetworkTraffic(on: boolean): {
  vatsim: unknown;
  ivao: unknown;
  at: number;
} {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!on) return;
    const list = [feed(VATSIM_URL, 15_000), feed(IVAO_URL, 30_000)];
    const sub = () => bump((n) => n + 1);
    for (const f of list) {
      f.users++;
      f.subs.add(sub);
      if (f.users === 1 && !f.busy) {
        if (Date.now() - f.at > f.every) poll(f);
        else f.timer = setTimeout(() => poll(f), f.every - (Date.now() - f.at));
      }
    }
    return () => {
      for (const f of list) {
        f.users--;
        f.subs.delete(sub);
        if (f.users === 0 && f.timer) {
          clearTimeout(f.timer);
          f.timer = null;
        }
      }
    };
  }, [on]);
  const v = feeds.get(VATSIM_URL);
  const i = feeds.get(IVAO_URL);
  return {
    vatsim: on ? v?.data ?? null : null,
    ivao: on ? i?.data ?? null : null,
    at: Math.max(v?.at ?? 0, i?.at ?? 0),
  };
}
