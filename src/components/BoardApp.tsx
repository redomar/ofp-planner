"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cityName, dur } from "@/lib/data/flight";
import { findFlight, loadRoutes, useDataset, type FlightRow } from "@/lib/data/load";
import { routeColor } from "@/lib/colors";
import { applyFn, useFnOverrides } from "@/lib/fnoverride";
import { placeOptions } from "@/lib/places";
import { useAirframes } from "@/lib/simbrief";
import { fetchForecast, hourAt, nearestHour } from "@/lib/wx/forecast";
import { wmoText } from "@/lib/wx/category";
import { depOn, isoDate, MIN, movements, nextDep, phases, type Movement, type PhaseKey, type Side } from "@/lib/board/board";
import {
  channelName,
  EMPTY_GATE,
  fetchOfp,
  fromOfp,
  fromSnapshot,
  gateFromParams,
  gateToParams,
  type GateFlight,
  type GateMessage,
  type GateState,
  type SbOfp,
} from "@/lib/board/gate";
import { StatusLine, TopBar } from "./chrome";
import { PlacePicker } from "./pickers";
import { RouteMap, type MapRoute } from "./RouteMap";
import { FidsBoard } from "./board/FidsBoard";
import { GateScreen, localClock, screenNow, type GateWx } from "./board/GateScreen";
import { cx } from "./ui";

type Tab = "airport" | "gate";
const HOURS = [3, 6, 12];
const ROWS = 40;
const SB_KEY = "ofp-planner:simbrief-user";
const VIRTUAL = [5, 10, 15, 20, 25, 30, 45, 60, 90];

const readSbUser = () => {
  try {
    return window.localStorage.getItem(SB_KEY) ?? "";
  } catch {
    return "";
  }
};
const writeSbUser = (v: string) => {
  try {
    window.localStorage.setItem(SB_KEY, v);
  } catch {
    /* forgets */
  }
};

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
        ? gateToParams(gate, Date.now(), { tab: "gate" })
        : new URLSearchParams(
            Object.entries({ ap, side: side === "arr" ? "arr" : null, h: hours !== 6 ? String(hours) : null, tz: utc ? "utc" : null }).filter((e): e is [string, string] => !!e[1]),
          );
    const next = `${window.location.pathname}${q.toString() ? `?${q}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [ready, screen, tab, ap, side, hours, utc, gate]);

  /* ---------- data: only the airlines that serve the airport, or the gate flight's ---------- */

  const [routes, setRoutes] = useState<Awaited<ReturnType<typeof loadRoutes>> | null>(null);
  useEffect(() => {
    if (!ready || tab !== "airport" || !ap || routes) return;
    let live = true;
    loadRoutes().then(
      (r) => live && setRoutes(r),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [ready, tab, ap, routes]);
  const brands = useMemo(() => {
    if (!ap || !routes || tab !== "airport") return [];
    const s = new Set<string>();
    if (side === "dep") for (const byAl of Object.values(routes[ap] ?? {})) for (const al of Object.keys(byAl)) s.add(al);
    else for (const dests of Object.values(routes)) for (const al of Object.keys(dests[ap] ?? {})) s.add(al);
    return [...s].sort();
  }, [ap, routes, side, tab]);
  const data = useDataset(ready ? brands : []);
  const { airports, airlines, manifest } = data;
  const fnOv = useFnOverrides();

  /* ---------- airport tab ---------- */

  const placeOpts = useMemo(() => {
    if (!airports || !routes) return [];
    const counts = new Map<string, number>();
    for (const [o, dests] of Object.entries(routes))
      for (const [d, byAl] of Object.entries(dests)) {
        const n = Object.values(byAl).reduce((a, b) => a + b, 0);
        counts.set(o, (counts.get(o) ?? 0) + n);
        counts.set(d, (counts.get(d) ?? 0) + n);
      }
    return placeOptions(counts, airports).filter((o) => !o.country);
  }, [airports, routes]);
  // airport options need routes.json even before an airport is chosen
  useEffect(() => {
    if (!ready || tab !== "airport" || routes) return;
    let live = true;
    loadRoutes().then(
      (r) => live && setRoutes(r),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [ready, tab, routes]);

  const airport = useMemo(() => (ap ? (airports?.get(ap) ?? null) : null), [ap, airports]);
  const loadingBoard = !!ap && (!routes || data.loading.length > 0 || !airports);
  // minute resolution, so the list is rebuilt once a minute, not every second
  const minute = Math.floor(now / MIN) * MIN;
  const rows = useMemo<Movement[]>(() => {
    if (!ap || loadingBoard) return [];
    const fl = data.flights.map((f) => applyFn(f, fnOv));
    return movements(fl, airports, ap, side, minute - 10 * MIN, minute + hours * 60 * MIN);
  }, [ap, loadingBoard, data.flights, fnOv, airports, side, minute, hours]);
  const [shown, setShown] = useState(ROWS);
  const [hover, setHover] = useState<string | null>(null);
  const fmt = (ms: number) => (utc || !airport?.tz ? `${new Date(ms).toISOString().slice(11, 16)}${utc ? "" : "Z"}` : localClock(ms, airport.tz));

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
        active: hover === m.other,
        label: cityName(other) ?? other.name,
      });
    }
    return [...seen.values()];
  }, [rows, airport, airports, airlines, side, hover]);

  /* ---------- gate tab: the flight ---------- */

  const [snapFlight, setSnapFlight] = useState<FlightRow | null>(null);
  useEffect(() => {
    if (!ready || !gate.f || gate.sb || !manifest) return;
    let live = true;
    void findFlight(gate.f).then((f) => live && setSnapFlight(f));
    return () => {
      live = false;
    };
  }, [ready, gate.f, gate.sb, manifest]);
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

  const flight = useMemo<GateFlight | null>(() => {
    if (!airports) return null;
    if (gate.sb) return ofp?.user === gate.sb && ofp.ofp ? fromOfp(ofp.ofp, airports, airlines) : null;
    if (!snapFlight || snapFlight.id !== gate.f) return null;
    const f = applyFn(snapFlight, fnOv);
    const std = (gate.d ? depOn(f, gate.d) : null) ?? nextDep(f, minute - 30 * MIN);
    return std != null ? fromSnapshot(f, std, airports, airlines.get(f.al) ?? null) : null;
  }, [airports, airlines, gate.sb, gate.f, gate.d, ofp, snapFlight, fnOv, minute]);

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
        setWx({ key: wxKey, wx: { temp: h.temp, text: wmoText(h.code) } });
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

  /* ---------- screen only (stream source / popup) ---------- */

  if (screen) {
    if (!ready) return null;
    return createPortal(
      <div className={cx("screen-root", gate.overlay && "is-overlay")}>
        <ScreenModeClass overlay={gate.overlay} />
        <div className="gs-frame">
          {flight ? (
            <GateScreen flight={flight} state={shownGate} now={now} wx={gateWx} />
          ) : (
            <p className="screen-wait">{ofp?.error ? `SimBrief: ${ofp.error}` : "Loading the flight…"}</p>
          )}
        </div>
      </div>,
      document.body,
    );
  }

  /* ---------- page ---------- */

  const status =
    !ready || !manifest ? (
      <span className="muted">Loading schedule snapshot…</span>
    ) : tab === "airport" ? (
      ap && airport ? (
        <span>
          <b>{airport.name}</b> · {side === "dep" ? "departures" : "arrivals"} in the next {hours} h · {rows.length} flights
          <span className="muted hide-xs"> · from the weekly timetable; remarks follow the clock</span>
        </span>
      ) : (
        <span className="muted">Pick an airport to see its board</span>
      )
    ) : flight ? (
      <span>
        <b>{flight.flightNo}</b> {flight.from.iata ?? flight.from.icao} → {flight.to.iata ?? flight.to.icao} ·{" "}
        {gate.stdAt != null ? `virtual clock, STD in ${dur(Math.max(0, Math.round((gate.stdAt - now) / MIN)))}` : `real time, ${new Date(flight.stdMs).toUTCString().slice(0, 16)}`}
        <span className="muted hide-xs"> · {flight.source === "simbrief" ? "from your SimBrief OFP" : "from the snapshot"}</span>
      </span>
    ) : (
      <span className="muted">Pick a flight for the gate screen</span>
    );

  return (
    <>
      <TopBar />
      <StatusLine progress={ready && ap && tab === "airport" && !data.error ? data.progress : null}>{status}</StatusLine>
      <main className="board">
        <div className="tabs-bar board-tabs">
          <div className="tabs" role="tablist" aria-label="Board">
            <button type="button" role="tab" aria-selected={tab === "airport"} className="tab" onClick={() => setTab("airport")}>
              Airport board
            </button>
            <button type="button" role="tab" aria-selected={tab === "gate"} className="tab" onClick={() => setTab("gate")}>
              Gate screen
            </button>
          </div>
        </div>

        {ready && tab === "airport" && (
          <>
            <section className="panel bd-form" aria-label="Board options">
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
            </section>
            {!ap ? (
              <section className="panel bd-intro">
                <h2 className="brief-title">An airport’s departures and arrivals</h2>
                <p className="muted">
                  Pick an airport for the flights in the next few hours, soonest first, like the screens in the terminal. Remarks follow the clock: gate open, boarding, final call,
                  gate closed, departed. Times are scheduled where the airline publishes them, else typical from tracking (marked “typ”); “Expected” means the flight usually runs
                  10 minutes or more late. Pick a flight for its gate screen.
                </p>
                <p className="bd-try">
                  <span className="ctl-label">Try</span>
                  {["EGKK", "EGBB", "LEMD", "EHAM", "EPPO"].map((c) => (
                    <button key={c} type="button" className="jr-example" onClick={() => setAp(c)}>
                      {c}
                    </button>
                  ))}
                </p>
              </section>
            ) : loadingBoard || !airport ? (
              <section className="panel bd-loading" aria-busy="true">
                <p className="muted">Loading the airlines that fly here…</p>
              </section>
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
                    hover={hover}
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
                <div className="panel bd-map">
                  {mapRoutes.length > 0 && (
                    <div className="bd-map-clip">
                      <RouteMap
                        routes={mapRoutes}
                        height={460}
                        label={`Map of ${mapRoutes.length} ${side === "dep" ? "destinations from" : "origins into"} ${airport.name} in the next ${hours} hours.`}
                        onPick={(icao) => setHover((h) => (h === icao ? null : icao))}
                      />
                    </div>
                  )}
                  <p className="muted small">
                    Hover a flight to see its route. {mapRoutes.length} airports in the next {hours} h.
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {ready && tab === "gate" && (
          <div className="gt-split">
            <div className="gt-preview">
              <div className="gs-frame" id="gs-preview">
                {flight ? (
                  <GateScreen flight={flight} state={shownGate} now={now} wx={gateWx} />
                ) : (
                  <div className="gs-empty">
                    <p>{gate.sb ? (ofp?.error ? `SimBrief: ${ofp.error}` : "Loading your SimBrief OFP…") : gate.f ? "Loading the flight…" : "No flight yet"}</p>
                  </div>
                )}
              </div>
              {
                <div className="gt-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!flight}
                    onClick={() => window.open(screenUrl(true), `gate-${ch}`, "popup,width=1280,height=720")}
                    title="A window with only the screen, kept in step with these controls (capture it in OBS as a window)"
                  >
                    Open screen window
                  </button>
                  <CopyButton
                    disabled={!flight}
                    text={() => screenUrl(false)}
                    label="Copy stream URL"
                    title="For an OBS browser source at 1920×1080: the screen with these settings (the virtual clock starts again when the source loads)"
                  />
                  <button type="button" className="btn" disabled={!flight} onClick={() => void document.getElementById("gs-preview")?.requestFullscreen?.()}>
                    Full screen
                  </button>
                </div>
              }
            </div>
            <GateControls
              gate={gate}
              flight={flight}
              snap={snapFlight && snapFlight.id === gate.f ? snapFlight : null}
              now={now}
              autoReg={autoReg}
              ofpError={gate.sb && ofp?.user === gate.sb ? ofp.error : null}
              onPatch={patch}
              onSet={setGate}
            />
          </div>
        )}
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
      <div className="seg jr-seg" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className="seg-btn" onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function CopyButton({ text, label, title, disabled }: { text: () => string; label: string; title?: string; disabled?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      title={title}
      disabled={disabled}
      onClick={() => {
        void navigator.clipboard?.writeText(text()).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        });
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

/* ---------- the gate screen's controls ---------- */

const PIN_LABELS: [PhaseKey, string][] = [
  ["scheduled", "On time / delayed"],
  ["gate", "Go to gate"],
  ["boarding", "Boarding"],
  ["final", "Final call"],
  ["closed", "Gate closed"],
  ["ready", "Ready for pushback"],
  ["pushback", "Pushback"],
  ["lineup", "Lining up"],
  ["takeoff", "Take-off"],
  ["departed", "Departed"],
];

function GateControls({
  gate,
  flight,
  snap,
  now,
  autoReg,
  ofpError,
  onPatch,
  onSet,
}: {
  gate: GateState;
  flight: GateFlight | null;
  snap: FlightRow | null;
  now: number;
  autoReg: string | null;
  ofpError: string | null;
  onPatch: (p: Partial<GateState>) => void;
  onSet: (g: GateState) => void;
}) {
  const [user, setUser] = useState(() => (typeof window === "undefined" ? "" : readSbUser()));
  const [vin, setVin] = useState(25);
  const [newGate, setNewGate] = useState("");
  const minToStd = flight ? Math.round(((flight.stdMs - screenNow(now, flight, gate)) / MIN) * 1) : null;
  // the next operating dates of a snapshot flight, for the date menu
  const hour = Math.floor(now / (60 * MIN));
  const dates = useMemo(() => {
    if (!snap) return [];
    const out: number[] = [];
    let from = hour * 60 * MIN - 60 * MIN;
    for (let i = 0; i < 7; i++) {
      const t = nextDep(snap, from);
      if (t == null) break;
      out.push(t);
      from = t + MIN;
    }
    return out;
  }, [snap, hour]);
  const ps = flight ? phases(flight.types, flight.taxiOut) : [];

  return (
    <section className="panel gt-ctl" aria-label="Gate screen controls">
      <fieldset className="gt-group">
        <legend>Flight</legend>
        {(flight || gate.f || gate.sb) && (
          <p className="gt-flight">
            {!flight && <span className="muted">Loading the flight…</span>}
            {flight && (
              <>
                <b className="mono">{flight.flightNo}</b> {flight.from.iata ?? flight.from.icao} → {flight.to.iata ?? flight.to.icao} · {flight.airline}
                {flight.source === "snapshot" && (
                  <>
                    {" "}
                    ·{" "}
                    <Link href={`/brief?f=${encodeURIComponent(gate.f ?? "")}`} className="linkish">
                      Brief
                    </Link>
                  </>
                )}
              </>
            )}
          </p>
        )}
        {gate.f && !gate.sb && gate.stdAt == null && (
          <label className="jr-ctl">
            <span className="ctl-label">Date (UTC)</span>
            <select className="ctl-input" value={gate.d ?? ""} onChange={(e) => onPatch({ d: e.target.value || null })}>
              <option value="">Next departure</option>
              {dates.map((t) => (
                <option key={t} value={isoDate(t)}>
                  {new Date(t).toUTCString().slice(0, 11)} · {new Date(t).toISOString().slice(11, 16)}Z
                </option>
              ))}
            </select>
          </label>
        )}
        <form
          className="gt-sb"
          onSubmit={(e) => {
            e.preventDefault();
            const u = user.trim();
            if (!u) return;
            writeSbUser(u);
            onSet({ ...EMPTY_GATE, sb: u, rotate: gate.rotate, overlay: gate.overlay });
          }}
        >
          <label className="jr-ctl">
            <span className="ctl-label">SimBrief username</span>
            <input className="ctl-input" value={user} onChange={(e) => setUser(e.target.value)} placeholder="Your SimBrief username" autoComplete="off" spellCheck={false} />
          </label>
          <button type="submit" className="btn" disabled={!user.trim()}>
            {gate.sb ? "Reload OFP" : "Use my latest OFP"}
          </button>
          {gate.sb && (
            <button type="button" className="btn" onClick={() => onSet({ ...EMPTY_GATE, rotate: gate.rotate, overlay: gate.overlay })}>
              Forget OFP
            </button>
          )}
        </form>
        {ofpError && <p className="st-err">SimBrief: {ofpError}</p>}
        {!flight && !gate.sb && (
          <p className="muted small">
            Or pick a flight on the <b>Airport board</b>, or <b>Gate screen</b> on a flight in the <Link href="/">Finder</Link> or a leg in <Link href="/journeys">Journeys</Link>.
          </p>
        )}
      </fieldset>

      {flight && (
        <>
          <fieldset className="gt-group">
            <legend>Clock</legend>
            <div className="seg jr-seg" role="radiogroup" aria-label="Clock">
              <button type="button" role="radio" aria-checked={gate.stdAt == null} className="seg-btn" onClick={() => onPatch({ stdAt: null })}>
                Real time
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={gate.stdAt != null}
                className="seg-btn"
                onClick={() => onPatch({ stdAt: Math.floor(Date.now() / MIN) * MIN + vin * MIN })}
              >
                Virtual
              </button>
            </div>
            <div className="gt-row">
              <label className="jr-ctl">
                <span className="ctl-label">STD in</span>
                <select className="ctl-input" value={vin} onChange={(e) => setVin(Number(e.target.value))}>
                  {VIRTUAL.map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn" onClick={() => onPatch({ stdAt: Math.floor(Date.now() / MIN) * MIN + vin * MIN })}>
                {gate.stdAt != null ? "Restart" : "Start"}
              </button>
            </div>
            <p className="muted small">
              {gate.stdAt != null
                ? `The screen's clock runs so STD comes round in ${minToStd != null ? Math.max(0, minToStd) : "?"} min; the boarding steps play out live.`
                : "The screen shows the flight's real date and time; pick Virtual to start the countdown when you go live."}
            </p>
          </fieldset>

          <fieldset className="gt-group">
            <legend>Status</legend>
            <div className="gt-row">
              <span className="gt-delay mono" aria-live="polite">
                {gate.delay ? `+${gate.delay} min` : "On time"}
              </span>
              {[-5, 5, 15, 30].map((d) => (
                <button key={d} type="button" className="btn" onClick={() => onPatch({ delay: Math.max(0, Math.min(600, gate.delay + d)) })} disabled={d < 0 && !gate.delay}>
                  {d > 0 ? `+${d}` : d}
                </button>
              ))}
              <button type="button" className="btn" onClick={() => onPatch({ delay: 0 })} disabled={!gate.delay}>
                Reset
              </button>
            </div>
            <label className="jr-ctl">
              <span className="ctl-label">Step</span>
              <select className="ctl-input" value={gate.pin ?? ""} onChange={(e) => onPatch({ pin: (e.target.value || null) as PhaseKey | null })}>
                <option value="">Follow the clock</option>
                {PIN_LABELS.map(([k, l]) => (
                  <option key={k} value={k}>
                    Hold on: {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={gate.cancelled} onChange={(e) => onPatch({ cancelled: e.target.checked })} />
              Cancelled
            </label>
            {ps.length > 0 && (
              <p className="muted small">
                Gate opens {Math.abs(ps[1].at)} min before off-block, boarding {Math.abs(ps[2].at)}, final call 20, gate closed 15; take-off after {ps[8].at} min of taxi.
              </p>
            )}
          </fieldset>

          <fieldset className="gt-group">
            <legend>On the screen</legend>
            <div className="gt-row">
              <label className="jr-ctl">
                <span className="ctl-label">Gate</span>
                <input
                  className="ctl-input gt-gate"
                  value={gate.gate}
                  maxLength={6}
                  onChange={(e) => onPatch({ gate: e.target.value.toUpperCase().slice(0, 6), oldGate: "" })}
                  placeholder="e.g. 12"
                />
              </label>
              <label className="jr-ctl">
                <span className="ctl-label">Gate change to</span>
                <input className="ctl-input gt-gate" value={newGate} maxLength={6} onChange={(e) => setNewGate(e.target.value.toUpperCase().slice(0, 6))} placeholder="e.g. 14" />
              </label>
              <button
                type="button"
                className="btn"
                disabled={!newGate || !gate.gate || newGate === gate.gate}
                onClick={() => {
                  onPatch({ oldGate: gate.gate, gate: newGate });
                  setNewGate("");
                }}
              >
                Change
              </button>
            </div>
            <label className="jr-ctl">
              <span className="ctl-label">Registration</span>
              <input
                className="ctl-input"
                value={gate.reg}
                maxLength={10}
                onChange={(e) => onPatch({ reg: e.target.value.toUpperCase().slice(0, 10) })}
                placeholder={flight.reg ?? autoReg ?? "e.g. G-ABCD"}
              />
            </label>
            <label className="jr-ctl">
              <span className="ctl-label">Message</span>
              <input
                className="ctl-input"
                value={gate.msg}
                maxLength={120}
                onChange={(e) => onPatch({ msg: e.target.value.slice(0, 120) })}
                placeholder="On the info strip, e.g. Welcome aboard!"
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={gate.rotate} onChange={(e) => onPatch({ rotate: e.target.checked })} />
              Rotate the info strip (weather, flight facts, message)
            </label>
            <label className="check">
              <input type="checkbox" checked={gate.overlay} onChange={(e) => onPatch({ overlay: e.target.checked })} />
              Transparent around the screen (stream overlay)
            </label>
          </fieldset>
          <p className="muted small gt-keys">
            On the screen window: <kbd>↑</kbd>/<kbd>↓</kbd> delay ±5 min, <kbd>0</kbd> on time, <kbd>C</kbd> cancelled, <kbd>F</kbd> full screen.
          </p>
        </>
      )}
    </section>
  );
}
