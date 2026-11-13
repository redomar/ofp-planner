"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cityName, dur, isoDay, onDay } from "@/lib/data/flight";
import { findFlight, loadRoutes, useDataset, useManifest, type FlightRow } from "@/lib/data/load";
import { hiddenAirlines, useDisplay } from "@/lib/display";
import { routeColor } from "@/lib/colors";
import { nextFocus, reveal, type LineFocus } from "@/lib/lineFocus";
import { applyFn, useFnOverrides } from "@/lib/fnoverride";
import { placeOptions } from "@/lib/places";
import { useAirframes } from "@/lib/simbrief";
import { fetchForecast, hourAt, nearestHour } from "@/lib/wx/forecast";
import { wmoText } from "@/lib/wx/category";
import { depOn, isoDate, MIN, movements, nextDep, type Movement, type Side } from "@/lib/board/board";
import {
  channelName,
  EMPTY_GATE,
  fetchOfp,
  fromOfp,
  fromPlan,
  fromSnapshot,
  gateFromParams,
  gateToParams,
  PRESETS,
  streamSettingsFrom,
  streamSettingsQuery,
  type GateFlight,
  type GateMessage,
  type GateState,
  type SbOfp,
} from "@/lib/board/gate";
import { StatusLine, TopBar } from "./chrome";
import { PlacePicker } from "./pickers";
import { RouteMap, type MapRoute } from "./RouteMap";
import { FidsBoard } from "./board/FidsBoard";
import type { FlightContext } from "@/lib/feed/core";
import { useObsScene } from "@/lib/feed/obs";
import { sendRelay, useRelay } from "@/lib/feed/relay";
import { CLOCK_FEED, feedFromParams, useFlightFeed, type FeedConfig } from "@/lib/feed/useFlightFeed";
import { GateViewScreen } from "./board/GateViews";
import { useShownStep } from "./board/useShownStep";
import { overSim as overSim_ } from "@/lib/board/looks";
import { LogArrival, REHEARSE_REC, RehearseStrip } from "./board/StreamPanel";
import { ScenesPreview } from "./board/StreamStudio";
import { FlightCard, SendToObs, WrittenOn } from "./board/GateDesk";
import { logFromFeed } from "@/lib/feed/toLog";
import { KEYS, readJSON } from "@/lib/storage";
import { namedFlight } from "@/lib/board/naming";
import { ENDING_KEY, endingRecord } from "@/lib/board/ending";
import { localClock, zoneLabel, type GateWx } from "./board/GateScreen";
import { cx, radioKeys, roving } from "./ui";

type Tab = "airport" | "gate";
const HOURS = [3, 6, 12];
/** 1.15: the app version a screen reports (from package.json at build time). */
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
/** who/here: ask every 30 s, drop a screen after two missed answers, give a hello 6 s to be followed by its "here". */
const WHO_EVERY_MS = 30_000;
const SCREEN_GONE_MS = 65_000;
const HERE_WAIT_MS = 6_000;
/** A screen open now (OBS, the popup), as it said in its "here". */
export interface OpenScreen {
  id: string;
  as: string | null;
  view: string;
  v: string | null;
  seen: number;
}
const ROWS = 40;

/**
 * The board: an airport's departures or arrivals for the next hours, as a flight information
 * display with a map of where they go, and a gate screen for one flight (snapshot or the pilot's
 * SimBrief OFP) with a live or virtual clock, for a stream before loading in.
 */
export function BoardApp() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("airport");
  const [ap, setAp] = useState<string | null>(null);
  const [side, setSide] = useState<Side>("dep");
  const [hours, setHours] = useState(6);
  const [utc, setUtc] = useState(false);
  const [gate, setGate] = useState<GateState>(EMPTY_GATE);
  const [screen, setScreen] = useState(false);
  const [ch, setCh] = useState<string | null>(null);
  const [feedCfg, setFeedCfg] = useState<FeedConfig>(CLOCK_FEED);
  /** Rehearse: the preview plays the recorded flight (this page only, not the stream). */
  const [rehearse, setRehearse] = useState<FeedConfig | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of the URL after hydration */
    setTab(p.get("tab") === "gate" ? "gate" : "airport");
    setAp(/^[A-Z0-9]{4}$/.test(p.get("ap") ?? "") ? p.get("ap") : null);
    setSide(p.get("side") === "arr" ? "arr" : "dep");
    setHours(HOURS.includes(Number(p.get("h"))) ? Number(p.get("h")) : 6);
    setUtc(p.get("tz") === "utc");
    setGate(gateFromParams(p, Date.now()));
    setScreen(p.get("screen") === "1");
    setCh(p.get("ch") || Math.random().toString(36).slice(2, 10));
    const fc = feedFromParams(p);
    if (fc.source !== "clock") setFeedCfg(fc);
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // the URL follows the page (not every tick: the virtual clock is written as minutes to go when something changes)
  useEffect(() => {
    if (!ready || screen) return;
    const q =
      tab === "gate"
        ? gateToParams(gate, Date.now(), { tab: "gate", feed: feedCfg.source !== "clock" ? feedCfg.source : null, who: feedCfg.who })
        : new URLSearchParams(
            Object.entries({ ap, side: side === "arr" ? "arr" : null, h: hours !== 6 ? String(hours) : null, tz: utc ? "utc" : null }).filter((e): e is [string, string] => !!e[1]),
          );
    const next = `${window.location.pathname}${q.toString() ? `?${q}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [ready, screen, tab, ap, side, hours, utc, gate, feedCfg]);

  /* ---------- data: only the airlines that serve the airport, or the gate flight's ---------- */

  const [routes, setRoutes] = useState<Awaited<ReturnType<typeof loadRoutes>> | null>(null);
  const [routesErr, setRoutesErr] = useState<string | null>(null);
  const routesFailed = (e: unknown) => setRoutesErr(e instanceof Error ? e.message : String(e));
  useEffect(() => {
    if (!ready || tab !== "airport" || !ap || routes) return;
    let live = true;
    loadRoutes().then(
      (r) => live && setRoutes(r),
      (e: unknown) => live && routesFailed(e),
    );
    return () => {
      live = false;
    };
  }, [ready, tab, ap, routes]);
  // Extra+ airlines only when Settings → Display lists them
  const airlineSet = useDisplay().airlines;
  const man = useManifest();
  const brands = useMemo(() => {
    if (!ap || !routes || !man || tab !== "airport") return [];
    const hidden = hiddenAirlines(man, airlineSet);
    const s = new Set<string>();
    if (side === "dep") for (const byAl of Object.values(routes[ap] ?? {})) for (const al of Object.keys(byAl)) s.add(al);
    else for (const dests of Object.values(routes)) for (const al of Object.keys(dests[ap] ?? {})) s.add(al);
    return [...s].filter((al) => !hidden.has(al)).sort();
  }, [ap, routes, man, airlineSet, side, tab]);
  const data = useDataset(ready ? brands : []);
  const { airports, airlines, manifest } = data;
  const fnOv = useFnOverrides();

  /* ---------- airport tab ---------- */

  const placeOpts = useMemo(() => {
    if (!airports || !routes) return [];
    const counts = new Map<string, number>();
    const hidden = hiddenAirlines(man, airlineSet);
    for (const [o, dests] of Object.entries(routes))
      for (const [d, byAl] of Object.entries(dests)) {
        const n = Object.entries(byAl).reduce((a, [al, b]) => (hidden.has(al) ? a : a + b), 0);
        if (!n) continue;
        counts.set(o, (counts.get(o) ?? 0) + n);
        counts.set(d, (counts.get(d) ?? 0) + n);
      }
    return placeOptions(counts, airports).filter((o) => !o.country);
  }, [airports, routes, man, airlineSet]);
  // airport options need routes.json even before an airport is chosen
  useEffect(() => {
    if (!ready || tab !== "airport" || routes) return;
    let live = true;
    loadRoutes().then(
      (r) => live && setRoutes(r),
      (e: unknown) => live && routesFailed(e),
    );
    return () => {
      live = false;
    };
  }, [ready, tab, routes]);

  const airport = useMemo(() => (ap ? (airports?.get(ap) ?? null) : null), [ap, airports]);
  const loadingBoard = !!ap && (!routes || data.loading.length > 0 || !airports);
  // a file that didn't download: say so (a failed route index isn't an empty board); the board lives in the URL, so Retry reloads
  const loadErr = tab === "airport" ? (routesErr ?? data.error) : null;
  // minute resolution, so the list is rebuilt once a minute, not every second
  const minute = Math.floor(now / MIN) * MIN;
  const rows = useMemo<Movement[]>(() => {
    if (!ap || loadingBoard) return [];
    const fl = data.flights.map((f) => applyFn(f, fnOv));
    return movements(fl, airports, ap, side, minute - 10 * MIN, minute + hours * 60 * MIN);
  }, [ap, loadingBoard, data.flights, fnOv, airports, side, minute, hours]);
  const [shown, setShown] = useState(ROWS);
  const [hover, setHover] = useState<string | null>(null);
  // a route line (or its airport) clicked on the map: that airport's flights marked, or one of them
  const [line, setLine] = useState<LineFocus>(null);
  const marked = useMemo(() => {
    if (!line) return null;
    const list = rows.filter((m) => m.other === line.key);
    return new Set((line.at === -1 ? list : list.slice(line.at, line.at + 1)).map((m) => m.key));
  }, [line, rows]);
  const onRoute = (key: string) => {
    const list = rows.filter((m) => m.other === key);
    const next = nextFocus(line, key, list.length);
    setLine(next);
    if (!next) return;
    const target = list[Math.max(0, next.at)];
    // the flight may be further down than the rows shown so far
    const at = rows.indexOf(target);
    if (at >= shown) setShown(Math.ceil((at + 1) / ROWS) * ROWS);
    reveal(`[data-mv="${CSS.escape(target.key)}"]`);
  };
  const fmt = (ms: number) => (utc || !airport?.tz ? `${new Date(ms).toISOString().slice(11, 16)}${utc ? "" : "Z"}` : localClock(ms, airport.tz));
  // the zone of the board's times, next to its clock
  const zone = utc || !airport?.tz ? "UTC" : zoneLabel(now, airport.tz);

  const mapRoutes = useMemo<MapRoute[]>(() => {
    if (!airport || !airports) return [];
    const seen = new Map<string, MapRoute>();
    for (const m of rows) {
      if (seen.has(m.other)) continue;
      const other = airports.get(m.other);
      if (!other) continue;
      seen.set(m.other, {
        key: m.other,
        from: side === "dep" ? airport : other,
        to: side === "dep" ? other : airport,
        color: routeColor(airlines.get(m.f.al)),
        active: (hover ?? line?.key) === m.other,
        label: cityName(other) ?? other.name,
      });
    }
    return [...seen.values()];
  }, [rows, airport, airports, airlines, side, hover, line]);

  /* ---------- gate tab: the flight ---------- */

  const [snapFlight, setSnapFlight] = useState<FlightRow | null>(null);
  useEffect(() => {
    if (!ready || !gate.f || (gate.sb && gate.fs !== "tt") || !manifest) return;
    let live = true;
    void findFlight(gate.f).then((f) => live && setSnapFlight(f));
    return () => {
      live = false;
    };
  }, [ready, gate.f, gate.sb, gate.fs, manifest]);
  const [ofp, setOfp] = useState<{ user: string; ofp: SbOfp | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!ready || !gate.sb) return;
    const user = gate.sb;
    const ctl = new AbortController();
    fetchOfp(user, ctl.signal).then(
      (o) => {
        setOfp({ user, ofp: o, error: null });
        // the OFP's own delay (est_out − sched_out) starts the screen's delay, once
        setGate((g) => (g.sb === user && !g.delay ? { ...g, delay: Math.max(0, Math.round((o.estOut - o.schedOut) / MIN)) } : g));
      },
      (e: Error) => !ctl.signal.aborted && setOfp({ user, ofp: null, error: e.message }),
    );
    return () => ctl.abort();
  }, [ready, gate.sb]);

  // 1.15: which flight, Auto (the OFP, then the timetable flight, then the FMS or a watched pilot's
  // plan) unless a source is pinned (fs=), so a link's sb= can't hide the flight being flown
  const useOfp = !!gate.sb && (gate.fs == null || gate.fs === "ofp");
  const useTt = !!gate.f && (gate.fs == null ? !gate.sb : gate.fs === "tt");
  const baseFlight = useMemo<GateFlight | null>(() => {
    if (!airports) return null;
    if (useOfp) return ofp?.user === gate.sb && ofp.ofp ? fromOfp(ofp.ofp, airports, airlines) : null;
    if (!useTt || !snapFlight || snapFlight.id !== gate.f) return null;
    const f = applyFn(snapFlight, fnOv);
    const std = (gate.d ? depOn(f, gate.d) : null) ?? nextDep(f, minute - 30 * MIN);
    // block, taxi and typical lateness from the times of the day it departs
    return std != null ? fromSnapshot(onDay(f, isoDay(new Date(std))), std, airports, airlines.get(f.al) ?? null) : null;
  }, [airports, airlines, useOfp, useTt, gate.sb, gate.f, gate.d, ofp, snapFlight, fnOv, minute]);

  // 1.9: a live feed (OFP Tower, a recorded flight or VATSIM) moves the screen with the aircraft
  const feedCtx = useMemo<FlightContext>(
    () =>
      baseFlight
        ? { from: { lat: baseFlight.from.lat, lon: baseFlight.from.lon, elev: baseFlight.from.elevFt }, to: { lat: baseFlight.to.lat, lon: baseFlight.to.lon, elev: baseFlight.to.elevFt }, cruiseFt: baseFlight.cruiseFt }
        : {},
    [baseFlight],
  );
  const live = useFlightFeed(rehearse ?? feedCfg, feedCtx, airports);
  // &as=BRB: this source shows the grid's BRB column whatever scene is live (one source per scene, Studio Mode)
  const [asScene, setAsScene] = useState<string | null>(null);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("as");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL after hydration
    if (v && v.trim()) setAsScene(v.trim().slice(0, 40));
  }, []);
  const obsLive = useObsScene();
  const obsScene = asScene ?? obsLive;
  // with no Finder flight or OFP (or pinned to it), the flight programmed in the aircraft's FMS (OFP
  // Tower, Fenix), or the plan a watched VATSIM pilot filed
  const usePlan = gate.fs == null ? !baseFlight && !gate.f && !gate.sb : gate.fs === "fms" || gate.fs === "vatsim";
  const planFlight = useMemo(
    () => (usePlan && live.plan && live.planAt != null ? fromPlan(live.plan, live.planAt, airports, airlines) : null),
    [usePlan, live.plan, live.planAt, airports, airlines],
  );
  // the operator the names are kept under: the OFP's airline, the timetable flight's, else the
  // flight number's letters (an FMS flight: EWG71W → EWG)
  const airlineCode = useOfp
    ? ofp?.user === gate.sb
      ? ofp.ofp?.airline || null
      : null
    : useTt
      ? snapFlight && snapFlight.id === gate.f
        ? snapFlight.al
        : null
      : (planFlight && /^([A-Z0-9]{2,3}?)\d/.exec((planFlight.callsign ?? planFlight.flightNo).replace(/\s/g, ""))?.[1]) || null;
  // 1.15: the names given for one airline show only on its flights (anf); names from before carry no airline and always show
  const namesApply = !gate.anf || gate.anf === airlineCode;
  // 1.13: with the airline name and code the user gave (Wizz Air Malta, W4), over the data's
  const flight = useMemo(() => {
    const f = baseFlight ?? planFlight;
    return f ? namedFlight(f, namesApply ? gate.an : "", namesApply ? gate.ac : "") : null;
  }, [baseFlight, planFlight, gate.an, gate.ac, namesApply]);
  // a flight of an airline named before: its names come back (this browser only; the relay and the link carry them to OBS)
  useEffect(() => {
    if (!airlineCode || screen) return;
    const saved = readJSON<Record<string, { an?: string; ac?: string }>>(KEYS.airlineNames, {})[airlineCode];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- once per airline, from storage
    setGate((g) => {
      if (g.anf === airlineCode) return g;
      // names typed before 1.15 (no airline) stay until they're changed
      if (!g.anf && (g.an || g.ac)) return g;
      if (saved) return { ...g, an: saved.an ?? "", ac: saved.ac ?? "", anf: airlineCode };
      // another airline's names: they don't show here, and stop being carried to OBS
      return g.anf ? { ...g, an: "", ac: "", anf: "" } : g;
    });
  }, [airlineCode, screen]);

  // 1.13: once down, keep the flight's ending (numbers and the line flown) for the ending screen, so
  // an OBS source refreshed after the flight, or with OFP Tower closed, still has it
  const endKey = flight && (live.state?.stamps.on != null || live.summary?.on != null) ? `${live.state?.stamps.on}|${live.state?.stamps.in}|${JSON.stringify(live.summary)}|${Math.floor(live.trail.length / 10)}` : null;
  useEffect(() => {
    if (!endKey || !flight) return;
    const rec = endingRecord(flight, live.state, live.summary, live.trail, Date.now());
    try {
      if (rec) window.localStorage.setItem(ENDING_KEY, JSON.stringify(rec));
    } catch {
      // storage full or blocked: the screen still shows what this page saw
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- endKey says when it changed
  }, [endKey]);

  // destination weather at arrival, for the info strip
  const [wx, setWx] = useState<{ key: string; wx: GateWx } | null>(null);
  const wxKey = flight ? `${flight.to.icao}@${Math.floor((flight.stdMs + (flight.block ?? 0) * MIN) / (60 * MIN))}` : null;
  useEffect(() => {
    if (!flight || !wxKey) return;
    let live = true;
    const etaMs = flight.stdMs + (flight.block ?? 90) * MIN;
    fetchForecast(flight.to.icao, flight.to.lat, flight.to.lon).then(
      ({ data: fc }) => {
        const n = nearestHour(fc, etaMs);
        if (!live || !n || n.outside) return;
        const h = hourAt(fc, n.i);
        const hr = Number(new Intl.DateTimeFormat("en-GB", { timeZone: flight.to.tz ?? "UTC", hour: "2-digit", hourCycle: "h23" }).format(etaMs));
        setWx({ key: wxKey, wx: { temp: h.temp, text: wmoText(h.code), code: h.code, night: hr < 6 || hr >= 20 } });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // the key carries the airport and the arrival hour
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wxKey]);
  const gateWx = wx && wx.key === wxKey ? wx.wx : null;

  // registration: what the user typed, else the OFP's, else a saved airframe of the same family
  const frames = useAirframes();
  const autoReg = useMemo(() => {
    if (!flight || flight.reg || !frames) return null;
    const t = flight.types[0];
    return frames.list.find((a) => a.icao === t)?.name ?? null;
  }, [flight, frames]);
  const shownGate = useMemo(() => ({ ...gate, reg: gate.reg || autoReg || "" }), [gate, autoReg]);

  /* ---------- live link to a screen window ---------- */

  const chanRef = useRef<BroadcastChannel | null>(null);
  const latest = useRef(gate);
  useEffect(() => {
    if (!ready || !ch || typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel(channelName(ch));
    chanRef.current = c;
    c.onmessage = (e: MessageEvent<GateMessage>) => {
      if (screen && e.data?.kind === "state") setGate(e.data.state);
      if (!screen && e.data?.kind === "hello") c.postMessage({ kind: "state", state: latest.current } satisfies GateMessage);
    };
    if (screen) c.postMessage({ kind: "hello" } satisfies GateMessage);
    return () => {
      c.close();
      chanRef.current = null;
    };
  }, [ready, ch, screen]);
  useEffect(() => {
    latest.current = gate;
    if (!screen) chanRef.current?.postMessage({ kind: "state", state: gate } satisfies GateMessage);
  }, [gate, screen]);

  const patch = (p: Partial<GateState>) => setGate((g) => ({ ...g, ...p }));

  // 1.10: the Stream panel's settings reach every open screen (OBS too) live through OFP Tower
  const relayOn = ready && (screen ? feedCfg.source === "link" || feedCfg.source === "auto" : tab === "gate");
  const latestGate = useRef(gate);
  const latestWho = useRef<string | null>(feedCfg.who);
  useEffect(() => {
    latestGate.current = gate;
    latestWho.current = feedCfg.who;
  }, [gate, feedCfg.who]);
  // What the stream settings were when last sent, received or first seen. A panel sends only when the
  // owner changes them (never just for opening or loading a flight), so a fresh tab can't put its
  // defaults over OBS; screens and panels apply only complete settings (streamSettingsFrom).
  const relayKnown = useRef<string | null>(null);
  const relayChanged = useRef(false);
  // 1.15: who/here. A screen says which scene it is and what it shows when the page asks ("who"),
  // and when it connects; the page lists them (Send to OBS). A bare hello with no "here" is a page
  // from before 1.15: "refresh this source".
  const screenId = useRef("");
  const screenAs = useRef<string | null>(null);
  const [screens, setScreens] = useState<OpenScreen[]>([]);
  const [olderSeen, setOlderSeen] = useState<number | null>(null);
  const helloAt = useRef<number[]>([]);
  const hereMsg = useCallback(
    () => ({ kind: "here", id: screenId.current, as: screenAs.current, view: latestGate.current.view, v: APP_VERSION }),
    [],
  );
  const onRelay = useCallback(
    (m: Record<string, unknown>) => {
      if (m.kind === "settings" && typeof m.q === "string") {
        const s = streamSettingsFrom(m.q, Date.now());
        if (!s) return;
        // 1.15: the board's VATSIM callsign comes with its settings (sv=2), so a watched pilot reaches OBS
        const q = new URLSearchParams(m.q);
        const who = q.get("sv") === "2" ? (/^[A-Z0-9_-]{2,12}$/i.test(q.get("who") ?? "") ? q.get("who")!.toUpperCase() : null) : undefined;
        relayKnown.current = streamSettingsQuery({ ...latestGate.current, ...s }, who === undefined ? latestWho.current : who);
        setGate((g) => ({ ...g, ...s }));
        if (who !== undefined && who !== latestWho.current) setFeedCfg((c) => (c.source === "auto" || c.source === "vatsim" ? { ...c, who } : c));
      }
      if (screen) {
        // only screens answer; they ignore one another's answers
        if (m.kind === "who") sendRelay(hereMsg());
        return;
      }
      // a screen that just connected asks for the current settings (OFP Tower also sends the last ones)
      if (m.kind === "hello") {
        if (relayChanged.current) sendRelay({ kind: "settings", q: streamSettingsQuery(latestGate.current, latestWho.current) });
        helloAt.current.push(Date.now());
      }
      if (m.kind === "here" && typeof m.id === "string" && m.id) {
        const t = Date.now();
        helloAt.current = helloAt.current.filter((h) => t - h > HERE_WAIT_MS);
        const row: OpenScreen = { id: m.id.slice(0, 24), as: typeof m.as === "string" ? m.as.slice(0, 40) : null, view: typeof m.view === "string" ? m.view.slice(0, 200) : "full", v: typeof m.v === "string" ? m.v.slice(0, 16) : null, seen: t };
        setScreens((l) => [...l.filter((x) => x.id !== row.id), row].sort((a, b) => a.id.localeCompare(b.id)));
      }
    },
    [screen, hereMsg],
  );
  const relayOpen = useRelay(relayOn, onRelay);
  useEffect(() => {
    if (!relayOpen || !screen) return;
    if (!screenId.current) screenId.current = Math.random().toString(36).slice(2, 10);
    screenAs.current = new URLSearchParams(window.location.search).get("as")?.trim().slice(0, 40) || null;
    sendRelay({ kind: "hello" });
    sendRelay(hereMsg());
  }, [relayOpen, screen, hereMsg]);
  // the page asks on every (re)connect and every 30 s (OFP Tower keeps no answers; one can be dropped)
  useEffect(() => {
    if (!relayOpen || screen) return;
    const ask = () => {
      sendRelay({ kind: "who" });
      const t = Date.now();
      setScreens((l) => (l.some((x) => t - x.seen > SCREEN_GONE_MS) ? l.filter((x) => t - x.seen <= SCREEN_GONE_MS) : l));
      // a hello that no "here" followed: a page from before 1.15
      const old = helloAt.current.filter((h) => t - h > HERE_WAIT_MS);
      if (old.length) {
        setOlderSeen(old.at(-1)!);
        helloAt.current = helloAt.current.filter((h) => t - h <= HERE_WAIT_MS);
      }
    };
    ask();
    const id = setInterval(ask, WHO_EVERY_MS);
    return () => clearInterval(id);
  }, [relayOpen, screen]);
  useEffect(() => {
    if (!relayOpen || screen) return;
    const q = streamSettingsQuery(gate, feedCfg.who);
    if (relayKnown.current === null) relayKnown.current = q;
    else if (q !== relayKnown.current && sendRelay({ kind: "settings", q })) {
      relayKnown.current = q;
      relayChanged.current = true;
    }
  }, [relayOpen, screen, gate, feedCfg.who]);

  // keyboard on the screen itself (OBS "Interact", or the popup): ↑/↓ delay, 0 resets, C cancels, F full screen
  useEffect(() => {
    if (!screen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") setGate((g) => ({ ...g, delay: Math.min(600, g.delay + 5) }));
      else if (e.key === "ArrowDown") setGate((g) => ({ ...g, delay: Math.max(0, g.delay - 5) }));
      else if (e.key === "0") setGate((g) => ({ ...g, delay: 0 }));
      else if (e.key.toLowerCase() === "c") setGate((g) => ({ ...g, cancelled: !g.cancelled }));
      else if (e.key.toLowerCase() === "f") void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [screen]);

  const screenUrl = (withCh: boolean) => {
    const q = gateToParams(gate, Date.now(), { tab: "gate", screen: "1", ch: withCh ? ch : null });
    return `${window.location.origin}/board?${q}`;
  };

  // at the gate (a live flight, not a rehearsal): one click writes its times to the Logbook
  const arrivedLog = useMemo(
    () => (!screen && !rehearse && flight && live.state?.stage === "arrived" ? logFromFeed(flight, live.state, live.using, gate.reg || null, live.summary) : null),
    [screen, rehearse, flight, live.state, live.using, gate.reg, live.summary],
  );

  // the link for one browser source that follows the aircraft and the OBS scene (with as=, always that scene)
  const streamUrl = (as: string | null = null) => {
    const q = gateToParams({ ...gate, view: "auto" }, now, { tab: "gate", screen: "1", feed: "auto", who: feedCfg.who, as });
    return `${typeof window === "undefined" ? "" : window.location.origin}/board?${q}`;
  };
  // 1.15: a link with one fixed look (the Countdown, the Ending, the preview's look)
  const lookUrl = (view: string) => {
    const q = gateToParams({ ...gate, view }, now, { tab: "gate", screen: "1", feed: "auto", who: feedCfg.who });
    return `${typeof window === "undefined" ? "" : window.location.origin}/board?${q}`;
  };
  const [rehearseRate, setRehearseRate] = useState<number | null>(null);
  // an OFP or a timetable flight on its way (the page would grow above the right column on a phone)
  // and a live feed's first reading (at most 2.5 s): the controls fold by where the aircraft is
  const [feedWait, setFeedWait] = useState(true);
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => setFeedWait(false), 2500);
    return () => clearTimeout(id);
  }, [ready]);
  const flightPending =
    (!flight && ((useOfp && ofp?.user !== gate.sb) || (useTt && (!snapFlight || snapFlight.id !== gate.f)) || !airports)) ||
    ((rehearse ?? feedCfg).source !== "clock" && !live.state && feedWait);
  const [previewToken, setPreviewToken] = useState("");
  // a scene a screen asks for (as=) that the page has no rule for: added as a gameplay scene (the
  // pill, the map now and then, the strip), to change on the preview
  const addScene = (name: string) => {
    const preset = PRESETS.find((p) => p.name === "Pills, map now and then") ?? PRESETS[0];
    patch({ scenes: [...gate.scenes, [name.replace(/[;:,]/g, "").slice(0, 40), preset.stages]] });
  };
  // registration: typed, else the OFP's, else a saved airframe of the type; the Logbook also takes OFP Tower's
  const summaryReg = live.summary && flight && (live.summary.origin == null || live.summary.origin === flight.from.icao) ? live.summary.reg : null;
  const regInfo = gate.reg
    ? { value: gate.reg, from: "typed here" }
    : flight?.reg
      ? { value: flight.reg, from: "from your SimBrief OFP" }
      : autoReg
        ? { value: autoReg, from: "a saved airframe of the type (the screen); the Logbook takes OFP Tower’s" }
        : summaryReg
          ? { value: summaryReg, from: "from OFP Tower (the sim’s ATC ID), for the Logbook" }
          : { value: null, from: "type one, load your OFP, or OFP Tower sends the sim’s at the gate" };
  const logNote = !flight
    ? "—"
    : [
        "OUT · OFF · ON · IN as they happen",
        flight.source === "fms" ? "no STD/STA (a flight from the FMS has no schedule: load your OFP for them)" : flight.block != null ? `STD ${new Date(flight.stdMs).toISOString().slice(11, 16)}Z → STA ${new Date(flight.stdMs + flight.block * MIN).toISOString().slice(11, 16)}Z` : "STD only (no block time)",
        gate.reg || flight.reg || summaryReg ? `reg ${gate.reg || flight.reg || summaryReg}` : "no registration yet",
      ].join(" · ");

  /* ---------- screen only (stream source / popup) ---------- */

  // 1.14: a stage that rotates turns through its steps from when the stage (or scene) began
  const shownStep = useShownStep(gate, live.state, obsScene, live.plan, now);
  // the views drawn over the sim are transparent outside their panels, like the overlay switch
  const overSim = gate.overlay || overSim_(shownStep.ls);

  if (screen) {
    if (!ready) return null;
    return createPortal(
      <div className={cx("screen-root", overSim && "is-overlay")}>
        <ScreenModeClass overlay={overSim} />
        <div className="gs-frame">
          {flight ? (
            <GateViewScreen flight={flight} state={shownGate} now={now} wx={gateWx} live={live.state} source={live.using} scene={obsScene} trail={live.trail} plan={live.plan} summary={live.summary} step={shownStep} />
          ) : (
            <p className="screen-wait">{ofp?.error ? `SimBrief: ${ofp.error}` : "Loading the flight…"}</p>
          )}
        </div>
      </div>,
      document.body,
    );
  }

  /* ---------- page ---------- */

  const retry = (
    <button type="button" className="linkish" onClick={() => window.location.reload()}>
      Retry
    </button>
  );
  const status = loadErr ? (
    <span className="st-err">Couldn’t load the schedule snapshot ({loadErr}). {retry}</span>
  ) : !ready || !manifest ? (
      <span className="muted">Loading schedule snapshot…</span>
    ) : tab === "airport" ? (
      ap && airport ? (
        <span>
          <b className="hide-xs">{airport.name}</b>
          <b className="only-xs">{airport.iata ?? airport.icao}</b> · {side === "dep" ? "departures" : "arrivals"}
          <span className="hide-xs"> in the next {hours} h</span> · {loadingBoard ? "loading…" : `${rows.length} flights`}
          <span className="muted"> · simulated<span className="hide-xs"> from the weekly timetable; remarks follow the clock</span></span>
        </span>
      ) : (
        <span className="muted">Pick an airport to see its board</span>
      )
    ) : flight ? (
      <span>
        <b>{flight.flightNo}</b> {flight.from.iata ?? flight.from.icao} → {flight.to.iata ?? flight.to.icao} ·{" "}
        {gate.stdAt != null ? `virtual clock, STD in ${dur(Math.max(0, Math.round((gate.stdAt - now) / MIN)))}` : `real time, ${new Date(flight.stdMs).toUTCString().slice(0, 16)}`}
        <span className="muted hide-xs"> · {flight.source === "simbrief" ? "from your SimBrief OFP" : flight.source === "fms" ? "from your FMS (OFP Tower)" : "from the snapshot"}</span>
      </span>
    ) : (
      <span className="muted">Pick a flight for the gate screen</span>
    );

  return (
    <>
      <TopBar />
      <StatusLine progress={ready && ap && tab === "airport" && !loadErr ? data.progress : null}>{status}</StatusLine>
      <main className="board">
        <h1 className="sr-only">Board</h1>
        <section className="panel board-panel" aria-label="Board">
          <div className="tabs-bar">
            <div className="tabs" role="tablist" aria-label="Show">
              <button type="button" role="tab" aria-selected={tab === "airport"} className="tab" onClick={() => setTab("airport")}>
                Airport board <span className="mono">{ready && ap && !loadingBoard ? rows.length.toLocaleString("en-GB") : ""}</span>
              </button>
              <button type="button" role="tab" aria-selected={tab === "gate"} className="tab" onClick={() => setTab("gate")}>
                Gate screen <span className="mono">{flight ? flight.flightNo : ""}</span>
              </button>
            </div>
          </div>
          <div role="tabpanel" className="board-body">
            {ready && tab === "airport" && (
              <>
                <div className="bd-form" role="group" aria-label="Board options">
                  <PlacePicker label="Airport" value={ap} options={placeOpts} onChange={(v) => (setAp(v), setShown(ROWS))} anyLabel="Choose an airport" />
                  <Seg
                    label="Show"
                    value={side}
                    options={[
                      ["dep", "Departures"],
                      ["arr", "Arrivals"],
                    ]}
                    onChange={(v) => (setSide(v), setShown(ROWS))}
                  />
                  <Seg label="Next" value={String(hours)} options={HOURS.map((h) => [String(h), `${h} h`] as [string, string])} onChange={(v) => setHours(Number(v))} />
                  <Seg
                    label="Times"
                    value={utc ? "utc" : "local"}
                    options={[
                      ["local", "Local"],
                      ["utc", "UTC"],
                    ]}
                    onChange={(v) => setUtc(v === "utc")}
                  />
                </div>
                {!ap ? (
                  <div className="bd-intro">
                    <h2 className="brief-title">An airport’s departures and arrivals</h2>
                    <p className="muted">
                      Pick an airport for the flights in the next few hours, soonest first, like the screens in the terminal. Remarks follow the clock: gate open, boarding, final
                      call, gate closed, departed. Times are scheduled where the airline publishes them, else typical from tracking (marked “typ”); “Expected” means the flight
                      usually runs 10 minutes or more late. Pick a flight for its gate screen.
                    </p>
                    <p className="bd-try">
                      <span className="ctl-label">Try</span>
                      {["EGKK", "EGBB", "LEMD", "EHAM", "EPPO"].map((c) => (
                        <button key={c} type="button" className="jr-example" onClick={() => setAp(c)}>
                          {c}
                        </button>
                      ))}
                    </p>
                  </div>
                ) : loadErr ? (
                  <div className="bd-loading">
                    <p className="form-err">
                      Couldn’t load the flights for this airport: {loadErr}. The board doesn’t know how many flights there are; it isn’t empty. {retry}
                    </p>
                  </div>
                ) : loadingBoard || !airport ? (
                  <div className="bd-loading" aria-busy="true">
                    <p className="muted">Loading the airlines that fly here…</p>
                  </div>
                ) : (
                  <div className="bd-split">
                    <div className="bd-list">
                      <FidsBoard
                        rows={rows.slice(0, shown)}
                        side={side}
                        airport={airport}
                        airports={airports!}
                        airlines={airlines}
                        now={now}
                        fmt={fmt}
                        clock={fmt(now)}
                        zone={zone}
                        hover={hover}
                        marked={marked}
                        onHover={setHover}
                        onPick={(m) => {
                          setGate({ ...EMPTY_GATE, f: m.f.id, d: isoDate(m.depMs) });
                          setSnapFlight(m.f);
                          setTab("gate");
                          window.scrollTo({ top: 0 });
                        }}
                      />
                      {rows.length > shown && (
                        <button type="button" className="btn bd-more" onClick={() => setShown((n) => n + ROWS)}>
                          Show {Math.min(ROWS, rows.length - shown)} more of {rows.length}
                        </button>
                      )}
                    </div>
                    <div className="bd-map">
                      {mapRoutes.length > 0 && (
                        <div className="bd-map-clip">
                          <RouteMap
                            routes={mapRoutes}
                            height={460}
                            label={`Map of ${mapRoutes.length} ${side === "dep" ? "destinations from" : "origins into"} ${airport.name} in the next ${hours} hours.`}
                            onPick={onRoute}
                            onRoute={onRoute}
                          />
                        </div>
                      )}
                      <p className="muted small">
                        Hover a flight to see its route; click a route for its flights. {mapRoutes.length} airports in the next {hours} h.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}

            {ready && tab === "gate" && (
              <div className="dk">
                <div className="dk-left">
                  {flight ? (
                    <ScenesPreview
                      gate={shownGate}
                      flight={flight}
                      now={now}
                      wx={gateWx}
                      feed={live}
                      rehearsing={!!rehearse}
                      canRehearse={rehearseRate != null}
                      onRehearse={(play) => setRehearse(play && rehearseRate != null ? { ...CLOCK_FEED, source: "replay", rec: REHEARSE_REC, rate: rehearseRate, fit: true } : null)}
                      rehearseStrip={<RehearseStrip gate={gate} ctx={feedCtx} rehearsing={!!rehearse} feed={live} onRate={setRehearseRate} onHold={(hold) => patch({ hold })} />}
                      arrived={arrivedLog && <LogArrival entry={arrivedLog} />}
                      onPatch={patch}
                      onLook={setPreviewToken}
                    />
                  ) : (
                    <div className="gs-frame" id="gs-preview">
                      <div className="gs-empty">
                        <p>{gate.sb && useOfp ? (ofp?.error ? `SimBrief: ${ofp.error}` : "Loading your SimBrief OFP…") : useTt ? "Loading the flight…" : feedCfg.who ? (live.vatsim?.state === "live" ? `${feedCfg.who} is on VATSIM but hasn’t filed a flight plan` : (live.vatsim?.text ?? `Looking for ${feedCfg.who} on VATSIM…`)) : "No flight yet"}</p>
                        {usePlan && live.link && <p className="gs-empty-link">{live.link.state === "live" ? "OFP Tower connected · waiting for a route in the MCDU" : live.link.text}</p>}
                      </div>
                    </div>
                  )}
                </div>
                {/* while the flight loads, the right column waits: it would only move down under it */}
                {!flightPending && (
                <div className="dk-right">
                  <FlightCard
                    gate={gate}
                    flight={flight}
                    dataFlight={baseFlight ?? planFlight}
                    snap={snapFlight && snapFlight.id === gate.f ? snapFlight : null}
                    now={now}
                    feed={live}
                    feedCfg={feedCfg}
                    ofpError={gate.sb && ofp?.user === gate.sb ? ofp.error : null}
                    reg={regInfo}
                    logNote={logNote}
                    onPatch={patch}
                    onSet={setGate}
                    onFeed={setFeedCfg}
                  />
                  {flight && <WrittenOn gate={gate} flight={flight} dataFlight={baseFlight ?? planFlight} now={now} left={!!live.state && (live.state.stage !== "ready" || live.state.stamps.out != null)} autoReg={autoReg} airlineCode={airlineCode} namesApply={namesApply} onPatch={patch} />}
                  <SendToObs
                    gate={gate}
                    hasFlight={!!flight}
                    relayOpen={relayOpen}
                    screens={screens}
                    olderSeen={olderSeen}
                    version={APP_VERSION}
                    streamUrl={streamUrl}
                    lookUrl={lookUrl}
                    previewToken={previewToken}
                    onOpenWindow={() => window.open(screenUrl(true), `gate-${ch}`, "popup,width=1280,height=720")}
                    onAddScene={addScene}
                  />
                </div>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}

/** Puts a class on <html> while the screen-only view is up (hides the page chrome, sets the backdrop). */
function ScreenModeClass({ overlay }: { overlay: boolean }) {
  useEffect(() => {
    const h = document.documentElement;
    h.classList.add("screen-mode");
    h.classList.toggle("screen-overlay", overlay);
    return () => h.classList.remove("screen-mode", "screen-overlay");
  }, [overlay]);
  return null;
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="jr-ctl">
      <span className="ctl-label">{label}</span>
      <div className="seg jr-seg" role="radiogroup" aria-label={label} onKeyDown={radioKeys}>
        {options.map(([v, l], i) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} tabIndex={roving(value === v, i)} className="seg-btn" onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

