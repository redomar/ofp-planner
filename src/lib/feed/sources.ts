/**
 * Where the gate screen's live readings come from, best first: OFP Link on the sim PC (a WebSocket
 * on localhost), a recorded flight (replayed in sim time, for testing and rehearsing), and the
 * public VATSIM data feed (read only: it lists who is online, nothing is ever sent to VATSIM).
 * Each source calls onSample with the shared FeedSample shape and onStatus with how it's going,
 * and returns a function that stops it.
 */
import { parseRecording, toPlan, toSample, type FeedSample, type FlightPlan } from "./core";

export type FeedStatus = { state: "connecting" | "live" | "waiting" | "ended" | "error"; text: string };
export interface SourceHandlers {
  onSample: (s: FeedSample) => void;
  onStatus: (s: FeedStatus) => void;
  /** OFP Link with a Fenix: the route programmed in the FMS. */
  onPlan?: (p: FlightPlan) => void;
}

/* ---------- a recorded flight ---------- */

/**
 * Plays a recording from this site (a same-origin path only) at `rate` times sim speed, the first
 * reading at once. `hold` (ms of sim time from the start) starts the replay part-way through.
 */
export function replaySource(path: string, rate: number, h: SourceHandlers, hold = 0, fit?: (s: FeedSample[]) => FeedSample[]): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const ctl = new AbortController();
  h.onStatus({ state: "connecting", text: "Loading the recorded flight" });
  const url = new URL(path, window.location.href);
  if (url.origin !== window.location.origin) {
    h.onStatus({ state: "error", text: "A recording has to come from this site" });
    return () => {};
  }
  fetch(url, { signal: ctl.signal })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`Recording not found (${r.status})`))))
    .then((text) => {
      const parsed = parseRecording(text).samples;
      const samples = fit ? fit(parsed) : parsed;
      if (!samples.length) throw new Error("The recording has no readings");
      const t0 = samples[0].t + hold;
      let i = Math.max(0, samples.findIndex((s) => s.t >= t0));
      // readings before the starting point still go through, at once, so the stamps are right
      for (let k = 0; k < i; k++) h.onSample(samples[k]);
      h.onStatus({ state: "live", text: `Recorded flight, ${rate}× speed` });
      const next = () => {
        if (stopped) return;
        h.onSample(samples[i]);
        i++;
        if (i >= samples.length) return h.onStatus({ state: "ended", text: "End of the recorded flight" });
        timer = setTimeout(next, Math.max(0, (samples[i].t - samples[i - 1].t) / rate));
      };
      next();
    })
    .catch((e: Error) => !stopped && h.onStatus({ state: "error", text: e.message }));
  return () => {
    stopped = true;
    ctl.abort();
    if (timer) clearTimeout(timer);
  };
}

/* ---------- VATSIM: the public data feed (read only) ---------- */

export const VATSIM_URL = "https://data.vatsim.net/v3/vatsim-data.json";

interface VatsimPilot {
  cid: number;
  callsign: string;
  latitude: number;
  longitude: number;
  altitude: number;
  groundspeed: number;
  heading: number;
  last_updated: string;
}

/**
 * Polls the VATSIM data feed every 15 s (it refreshes about that often) and follows one pilot by
 * callsign or CID. Position, altitude, speed and heading only: no ground, engine or door state, so
 * the detector falls back to speed and position for those.
 */
export function vatsimSource(who: string, h: SourceHandlers): () => void {
  const id = who.trim().toUpperCase();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastAlt: { t: number; alt: number } | null = null;
  let ctl: AbortController | null = null;
  h.onStatus({ state: "connecting", text: `Looking for ${id} on VATSIM` });
  const poll = async () => {
    ctl = new AbortController();
    try {
      const r = await fetch(VATSIM_URL, { signal: ctl.signal, cache: "no-store" });
      if (!r.ok) throw new Error(`VATSIM replied ${r.status}`);
      const j = (await r.json()) as { pilots?: VatsimPilot[] };
      const p = (j.pilots ?? []).find((x) => x.callsign?.toUpperCase() === id || String(x.cid) === id);
      if (stopped) return;
      if (!p) h.onStatus({ state: "waiting", text: `${id} isn't online on VATSIM` });
      else {
        const t = Date.parse(p.last_updated) || Date.now();
        // VATSIM gives no vertical speed: worked out from the last two altitudes
        const vs = lastAlt && t > lastAlt.t ? Math.round(((p.altitude - lastAlt.alt) / (t - lastAlt.t)) * 60_000) : null;
        if (!lastAlt || t > lastAlt.t) {
          lastAlt = { t, alt: p.altitude };
          const s = toSample({ lat: p.latitude, lon: p.longitude, alt: p.altitude, gs: p.groundspeed, hdg: p.heading, vs }, t);
          if (s) h.onSample(s);
        }
        h.onStatus({ state: "live", text: `VATSIM · ${p.callsign}` });
      }
    } catch (e) {
      if (!stopped) h.onStatus({ state: "error", text: (e as Error).message || "VATSIM didn't answer" });
    }
    if (!stopped) timer = setTimeout(poll, 15_000);
  };
  poll();
  return () => {
    stopped = true;
    ctl?.abort();
    if (timer) clearTimeout(timer);
  };
}

/* ---------- OFP Link on the sim PC ---------- */

export const LINK_PORT = 47800;

/**
 * Connects to OFP Link on this PC (ws://localhost:port) and takes its readings: one JSON message per
 * reading, {"type":"sample", …FeedSample fields, "zulu": seconds}. Reconnects on its own (2 s,
 * growing to 15 s) so the screen can be opened before the sim. Spec: docs/OFP-LINK.md.
 */
export function linkSource(port: number, h: SourceHandlers): () => void {
  let stopped = false;
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let wait = 2000;
  const open = () => {
    if (stopped) return;
    h.onStatus({ state: "connecting", text: "Looking for OFP Link on this PC" });
    try {
      ws = new WebSocket(`ws://localhost:${port}`);
    } catch {
      return retry();
    }
    ws.onopen = () => {
      wait = 2000;
      h.onStatus({ state: "live", text: "OFP Link" });
    };
    ws.onmessage = (e) => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.type === "plan") {
        const plan = toPlan(m);
        if (plan) h.onPlan?.(plan);
        return;
      }
      if (m.type !== "sample") return;
      const z = typeof m.zulu === "number" ? m.zulu : null;
      const now = Date.now();
      const day = now - (now % 86_400_000);
      // sim time of day → today's date, or yesterday's just after midnight
      const t = z != null ? day + z * 1000 - (day + z * 1000 > now + 43_200_000 ? 86_400_000 : 0) : typeof m.t === "number" ? m.t : now;
      const s = toSample(m, Math.round(t));
      if (s) h.onSample(s);
    };
    ws.onclose = () => retry();
  };
  const retry = () => {
    if (stopped) return;
    h.onStatus({ state: "waiting", text: "OFP Link isn't running" });
    timer = setTimeout(open, wait);
    wait = Math.min(15_000, wait * 1.5);
  };
  open();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  };
}
