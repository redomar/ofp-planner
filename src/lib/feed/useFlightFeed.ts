"use client";

import { useEffect, useState } from "react";
import { startState, step, type FeedSource, type FlightContext, type FlightState } from "./core";
import { LINK_PORT, linkSource, replaySource, vatsimSource, type FeedStatus } from "./sources";

/** Which feed the gate screen follows, from its URL: &feed=link|replay|vatsim (none = the clock, as before 1.9). */
export interface FeedConfig {
  source: FeedSource;
  /** replay: the recording's path on this site. */
  rec: string | null;
  /** replay: times sim speed. */
  rate: number;
  /** vatsim: callsign or CID. */
  who: string | null;
  /** link: OFP Link's port. */
  port: number;
}

export const CLOCK_FEED: FeedConfig = { source: "clock", rec: null, rate: 1, who: null, port: LINK_PORT };

/** ?feed=replay&rec=/recordings/x.jsonl&rate=60 · ?feed=vatsim&who=RYR7FE · ?feed=link&port=47800 */
export function feedFromParams(q: URLSearchParams): FeedConfig {
  const f = q.get("feed");
  const rate = Number(q.get("rate"));
  const port = Number(q.get("port"));
  const rec = q.get("rec");
  const who = q.get("who");
  const cfg: FeedConfig = {
    source: f === "link" || f === "replay" || f === "vatsim" ? f : "clock",
    rec: rec && /^\/[\w./-]{1,200}\.jsonl$/.test(rec) && !rec.includes("..") ? rec : null,
    rate: Number.isFinite(rate) && rate >= 1 ? Math.min(240, Math.round(rate)) : 1,
    who: who && /^[A-Za-z0-9_-]{2,12}$/.test(who) ? who.toUpperCase() : null,
    port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : LINK_PORT,
  };
  if ((cfg.source === "replay" && !cfg.rec) || (cfg.source === "vatsim" && !cfg.who)) return CLOCK_FEED;
  return cfg;
}

export interface FlightFeed {
  state: FlightState | null;
  status: FeedStatus | null;
}

/**
 * Runs the chosen source and the phase detector. With the clock (no feed) it does nothing and
 * returns nulls, so the screen behaves exactly as before.
 */
export function useFlightFeed(cfg: FeedConfig, ctx: FlightContext): FlightFeed {
  const { source, rec, rate, who, port } = cfg;
  const ctxKey = JSON.stringify(ctx);
  const key = `${source}|${rec}|${rate}|${who}|${port}|${ctxKey}`;
  // what the running source has said, tagged with its key: a new source or flight starts over,
  // without an extra render (and nothing at all happens on the clock)
  const [feed, setFeed] = useState<FlightFeed & { key: string }>({ key: "", state: null, status: null });
  useEffect(() => {
    if (source === "clock") return;
    const c: FlightContext = JSON.parse(ctxKey);
    const k = `${source}|${rec}|${rate}|${who}|${port}|${ctxKey}`;
    let st = startState();
    const h = {
      onSample: (s: Parameters<typeof step>[1]) => {
        st = step(st, s, c);
        const now = st;
        setFeed((f) => ({ key: k, status: f.key === k ? f.status : null, state: now }));
      },
      onStatus: (status: FeedStatus) => setFeed((f) => ({ key: k, state: f.key === k ? f.state : null, status })),
    };
    if (source === "replay" && rec) return replaySource(rec, rate, h);
    if (source === "vatsim" && who) return vatsimSource(who, h);
    if (source === "link") return linkSource(port, h);
  }, [source, rec, rate, who, port, ctxKey]);
  return feed.key === key ? feed : NO_FEED;
}

const NO_FEED: FlightFeed = { state: null, status: null };
