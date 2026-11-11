"use client";

import { useEffect, useRef, useState } from "react";
import { fitToRoute, startState, step, type FeedSample, type FeedSource, type FlightContext, type FlightPlan, type FlightState } from "./core";
import { LINK_PORT, linkSource, replaySource, vatsimSource, type FeedStatus } from "./sources";

/** Which feed the gate screen follows, from its URL: &feed=link|replay|vatsim (none = the clock, as before 1.9). */
export interface FeedConfig {
  /** auto: OFP Tower when it's live, else VATSIM (with a callsign), else the clock. */
  source: FeedSource | "auto";
  /** replay: the recording's path on this site. */
  rec: string | null;
  /** replay: times sim speed. */
  rate: number;
  /** vatsim: callsign or CID. */
  who: string | null;
  /** link: OFP Tower's port. */
  port: number;
  /** replay: start this many minutes of sim time into the recording. */
  at: number;
  /** replay: lay a recording from another route along this flight's line (on its own route it plays as recorded). */
  fit?: boolean;
}

export const CLOCK_FEED: FeedConfig = { source: "clock", rec: null, rate: 1, who: null, port: LINK_PORT, at: 0 };

/** ?feed=replay&rec=/recordings/x.jsonl&rate=60 · ?feed=vatsim&who=RYR7FE · ?feed=link&port=47800 */
export function feedFromParams(q: URLSearchParams): FeedConfig {
  const f = q.get("feed");
  const rate = Number(q.get("rate"));
  const port = Number(q.get("port"));
  const rec = q.get("rec");
  const who = q.get("who");
  const at = Number(q.get("at"));
  const cfg: FeedConfig = {
    source: f === "link" || f === "replay" || f === "vatsim" || f === "auto" ? f : "clock",
    rec: rec && /^\/[\w./-]{1,200}\.jsonl$/.test(rec) && !rec.includes("..") ? rec : null,
    rate: Number.isFinite(rate) && rate >= 1 ? Math.min(240, Math.round(rate)) : 1,
    who: who && /^[A-Za-z0-9_-]{2,12}$/.test(who) ? who.toUpperCase() : null,
    port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : LINK_PORT,
    at: Number.isFinite(at) && at > 0 ? Math.min(1440, at) : 0,
    // a recording from another route is laid along this flight's line (it plays as recorded on its own route)
    fit: true,
  };
  if ((cfg.source === "replay" && !cfg.rec) || (cfg.source === "vatsim" && !cfg.who)) return CLOCK_FEED;
  return cfg;
}

export interface FlightFeed {
  state: FlightState | null;
  status: FeedStatus | null;
  /** The source the readings are coming from now ("clock" before any arrive). */
  using: FeedSource;
  /** Each source's own status (auto runs OFP Tower and VATSIM side by side). */
  link: FeedStatus | null;
  vatsim: FeedStatus | null;
  /** Where the aircraft has been, [lon, lat], a point every 30 s or 2 nm (for the flown line on the map). */
  trail: [number, number][];
  /** The route programmed in the aircraft's FMS (OFP Tower with a Fenix), and when it first came. */
  plan: FlightPlan | null;
  planAt: number | null;
}

/**
 * Runs the chosen source and the phase detector. With the clock (no feed) it does nothing and
 * returns nulls, so the screen behaves exactly as before.
 */
export function useFlightFeed(cfg: FeedConfig, ctx: FlightContext): FlightFeed {
  const { source, rec, rate, who, port, at, fit = false } = cfg;
  const ctxKey = JSON.stringify(ctx);
  // a replay starts over for another flight (it's laid along its route); a live source keeps
  // running and simply uses the newest flight (it may itself bring the flight: the FMS plan)
  const replayCtx = source === "replay" ? ctxKey : "";
  const key = `${source}|${rec}|${rate}|${who}|${port}|${at}|${fit}|${replayCtx}`;
  const ctxRef = useRef<FlightContext>(ctx);
  useEffect(() => {
    ctxRef.current = JSON.parse(ctxKey);
  }, [ctxKey]);
  // what the running source has said, tagged with its key: a new source or flight starts over,
  // without an extra render (and nothing at all happens on the clock)
  const [feed, setFeed] = useState<FlightFeed & { key: string }>({ key: "", ...NO_FEED });
  useEffect(() => {
    if (source === "clock") return;
    const c0: FlightContext = replayCtx ? JSON.parse(replayCtx) : ctxRef.current;
    const k = `${source}|${rec}|${rate}|${who}|${port}|${at}|${fit}|${replayCtx}`;
    let planCtx: FlightContext = {};
    let planCruise: number | null = null;
    // the flight on screen, else the FMS plan's ends; the FMS's cruise level over the flight's
    const ctxNow = (): FlightContext => {
      const c = replayCtx ? c0 : ctxRef.current.to ? ctxRef.current : planCtx;
      return planCruise != null ? { ...c, cruiseFt: planCruise } : c;
    };
    let st = startState();
    let trail: [number, number][] = [];
    let trailAt = 0;
    const put = (p: Partial<FlightFeed>) => setFeed((f) => ({ ...(f.key === k ? f : NO_FEED), ...p, key: k }));
    // auto: OFP Tower wins while it's sending; VATSIM fills in when it isn't
    let linkAt = 0;
    const take = (from: FeedSource) => (s: Parameters<typeof step>[1]) => {
      if (from === "link") linkAt = Date.now();
      else if (source === "auto" && Date.now() - linkAt < 10_000) return;
      st = step(st, s, ctxNow());
      const now = st;
      const last = trail[trail.length - 1];
      if (!last || s.t - trailAt >= 30_000 || Math.hypot(s.lon - last[0], s.lat - last[1]) > 0.033) {
        trail = [...trail, [s.lon, s.lat]];
        trailAt = s.t;
      }
      const path = trail;
      put({ state: now, using: from, trail: path });
    };
    const said = (from: "link" | "vatsim" | "replay") => (status: FeedStatus) => put(from === "replay" ? { status } : { [from]: status, status });
    const fitTo = fit && c0.from && c0.to ? (x: FeedSample[]) => fitToRoute(x, c0.from!, c0.to!) : undefined;
    const onPlan = (p: FlightPlan) => {
      const first = p.legs.find((l) => !l.missed);
      const last = [...p.legs].reverse().find((l) => !l.missed);
      planCruise = p.cruiseFt;
      planCtx = first && last ? { from: { lat: first.lat, lon: first.lon }, to: { lat: last.lat, lon: last.lon } } : {};
      setFeed((f) => {
        const base = f.key === k ? f : { ...NO_FEED, key: k };
        return { ...base, key: k, plan: p, planAt: base.planAt ?? Date.now() };
      });
    };
    if (source === "replay" && rec) return replaySource(rec, rate, { onSample: take("replay"), onStatus: said("replay") }, at * 60_000, fitTo);
    if (source === "vatsim" && who) return vatsimSource(who, { onSample: take("vatsim"), onStatus: said("vatsim") });
    if (source === "link") return linkSource(port, { onSample: take("link"), onStatus: said("link"), onPlan });
    if (source === "auto") {
      const stops = [linkSource(port, { onSample: take("link"), onStatus: said("link"), onPlan })];
      if (who) stops.push(vatsimSource(who, { onSample: take("vatsim"), onStatus: said("vatsim") }));
      return () => stops.forEach((x) => x());
    }
  }, [source, rec, rate, who, port, at, fit, replayCtx]);
  return feed.key === key ? feed : NO_FEED;
}

const NO_FEED: FlightFeed = { state: null, status: null, using: "clock", link: null, vatsim: null, trail: [], plan: null, planAt: null };
