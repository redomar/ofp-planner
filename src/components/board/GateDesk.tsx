"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { isoDate, MIN, nextDep, phases, type PhaseKey } from "@/lib/board/board";
import { EMPTY_GATE, type FlightSource, type GateFlight, type GateState } from "@/lib/board/gate";
import { goParam } from "@/lib/board/countdown";
import { layersFrom, turnsFrom, VIEW_INFO } from "@/lib/board/looks";
import type { FlightRow } from "@/lib/data/load";
import type { FeedConfig, FlightFeed } from "@/lib/feed/useFlightFeed";
import { inObs } from "@/lib/feed/obs";
import { KEYS, readJSON, writeJSON } from "@/lib/storage";
import { screenNow } from "./GateScreen";
import { cx, radioKeys, roving } from "../ui";

/**
 * 1.15, Board → Gate screen, the right column ("One desk"): three questions in order. Which flight
 * (F1), what is written on it (C1, folded by when it matters), where it goes (S1, Send to OBS).
 */

const hhmm = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)}Z`;
const VIRTUAL = [5, 10, 15, 20, 25, 30, 45, 60, 90];
const SB_KEY = "ofp-planner:simbrief-user";
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

/* ---------- F1: which flight, one line ---------- */

const SOURCES: { k: FlightSource | null; name: string }[] = [
  { k: null, name: "Auto" },
  { k: "fms", name: "My aircraft" },
  { k: "ofp", name: "My SimBrief OFP" },
  { k: "tt", name: "Timetable flight" },
  { k: "vatsim", name: "Another pilot" },
];

/** Where the flight on screen came from, in words. */
export function flightFrom(f: GateFlight | null, gate: GateState, watching: string | null): string {
  if (!f) return "";
  if (f.source === "simbrief") return "from your SimBrief OFP";
  if (f.source === "snapshot") return "from the timetable (picked in the Finder or on the Airport board)";
  return watching && gate.fs !== "fms" ? `what ${watching} filed on VATSIM` : "from your aircraft's FMS (OFP Tower)";
}

export function FlightCard({
  gate,
  flight,
  dataFlight,
  snap,
  now,
  feed,
  feedCfg,
  ofpError,
  reg,
  logNote,
  onPatch,
  onSet,
  onFeed,
}: {
  gate: GateState;
  flight: GateFlight | null;
  /** The flight as the data has it (without the user's names). */
  dataFlight: GateFlight | null;
  snap: FlightRow | null;
  now: number;
  feed: FlightFeed;
  feedCfg: FeedConfig;
  ofpError: string | null;
  /** The registration shown, and where it's from. */
  reg: { value: string | null; from: string };
  /** What a Logbook entry would get now. */
  logNote: string;
  onPatch: (p: Partial<GateState>) => void;
  onSet: (g: GateState) => void;
  onFeed: (c: FeedConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState(() => (typeof window === "undefined" ? "" : readSbUser()));
  const [pilot, setPilot] = useState(gate.fs === "vatsim" ? (feedCfg.who ?? "") : "");
  const [mine, setMine] = useState(gate.fs === "vatsim" ? "" : (feedCfg.who ?? ""));
  const watching = gate.fs === "vatsim" || (!gate.f && !gate.sb && gate.fs == null) ? feedCfg.who : null;
  const link = feed.link;
  const linkLive = link?.state === "live";
  const using = feed.state ? feed.using : "clock";
  const vat = feed.vatsim;
  // the next operating dates of a timetable flight, for the date menu
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
  const keep = { rotate: gate.rotate, overlay: gate.overlay, view: gate.view, stages: gate.stages, scenes: gate.scenes, hold: gate.hold, go: gate.go, goFrom: gate.goFrom, bye: gate.bye };
  const pin = (fs: FlightSource | null) => onPatch({ fs });
  const fsOn = gate.fs;
  const wait = !flight
    ? gate.fs === "ofp" || (gate.fs == null && gate.sb)
      ? ofpError
        ? `SimBrief: ${ofpError}`
        : gate.sb
          ? "Loading your SimBrief OFP…"
          : "Add your SimBrief username"
      : gate.fs === "tt" || (gate.fs == null && gate.f)
        ? gate.f
          ? "Loading the flight…"
          : "Pick a flight on the Airport board, in the Finder or in Journeys"
        : gate.fs === "vatsim" || watching
          ? watching
            ? vat?.state === "live"
              ? `${watching} is on VATSIM but hasn’t filed a flight plan`
              : (vat?.text ?? `Looking for ${watching} on VATSIM…`)
            : "Add the pilot’s VATSIM callsign"
          : linkLive
            ? "OFP Tower connected · waiting for a route in the MCDU"
            : "No flight yet: OFP Tower isn’t running, and no OFP or timetable flight is loaded"
    : null;

  return (
    <section className="dk-card dk-flight" aria-labelledby="dk-flight-h">
      <div className="dk-card-h">
        <h3 id="dk-flight-h" className="ctl-label">
          Flight
        </h3>
        <button type="button" className="linkish small" aria-expanded={open} aria-controls="dk-flight-src" onClick={() => setOpen((o) => !o)}>
          {open ? "Done" : "Change"}
        </button>
      </div>
      <p className="dk-flight-line">
        {flight ? (
          <>
            <b className="mono">{flight.flightNo}</b> {flight.from.iata ?? flight.from.icao} → {flight.to.iata ?? flight.to.icao} · {flight.airline}
            {flight.source === "snapshot" && gate.f && (
              <>
                {" "}
                ·{" "}
                <Link href={`/brief?f=${encodeURIComponent(gate.f)}`} className="linkish">
                  Brief
                </Link>
              </>
            )}
          </>
        ) : (
          <span className="muted">{wait}</span>
        )}
      </p>
      <dl className="dk-facts">
        <dt>From</dt>
        <dd>
          {flight ? flightFrom(flight, gate, watching) : "—"}
          {gate.fs ? <span className="dk-pin"> · pinned</span> : <span className="muted"> · Auto</span>}
        </dd>
        <dt>Position</dt>
        <dd className="dk-chips">
          <span className={cx("st-chip", using === "link" && "is-on")}>
            <i aria-hidden="true" />
            OFP Tower · {linkLive ? (using === "link" ? "live" : "connected") : "not running"}
          </span>
          <span className={cx("st-chip", using === "vatsim" && "is-on")}>
            <i aria-hidden="true" />
            VATSIM · {using === "vatsim" ? `live (${feedCfg.who})` : feedCfg.who ? (vat?.state === "waiting" ? `${feedCfg.who} offline` : `looking for ${feedCfg.who}`) : "add a callsign"}
          </span>
          {/* the recorded flight in the clock's place (the row keeps its width) */}
          <span className={cx("st-chip", (using === "replay" || (using === "clock" && feedCfg.source !== "replay")) && "is-on")}>
            <i aria-hidden="true" />
            {using === "replay" || feedCfg.source === "replay" ? "Recorded flight" : "Clock"}
          </span>
        </dd>
        <dt>Registration</dt>
        <dd>
          {reg.value ? <b className="mono">{reg.value}</b> : "none yet"} <span className="muted">· {reg.from}</span>
        </dd>
        <dt>Shown as</dt>
        <dd>
          {flight ? `${flight.airline || "—"} · ${flight.flightNo.split(/\s+/)[0]}` : "—"}
          {dataFlight && flight && (dataFlight.airline !== flight.airline || dataFlight.flightNo !== flight.flightNo) ? <span className="muted"> · your names (the data says {dataFlight.airline || dataFlight.flightNo.split(/\s+/)[0]})</span> : <span className="muted"> · the data’s names</span>}
        </dd>
        <dt>Logbook</dt>
        <dd>{logNote}</dd>
      </dl>

      {open && (
        <div id="dk-flight-src" className="dk-src">
          <div className="seg dk-seg" role="radiogroup" aria-label="Where the flight comes from" onKeyDown={radioKeys}>
            {SOURCES.map((s, i) => (
              <button key={s.name} type="button" role="radio" aria-checked={fsOn === s.k} tabIndex={roving(fsOn === s.k, i)} className="seg-btn" onClick={() => pin(s.k)}>
                {s.name}
              </button>
            ))}
          </div>
          <p className="muted small">
            {fsOn == null
              ? "Auto: your SimBrief OFP when one is loaded, else the timetable flight, else the route in your aircraft’s FMS (OFP Tower) or a watched pilot’s plan."
              : "Pinned: the screens (OBS too, through OFP Tower) show this one, whatever else is loaded."}
          </p>
          {(fsOn === "ofp" || fsOn == null) && (
            <form
              className="gt-sb"
              onSubmit={(e) => {
                e.preventDefault();
                const u = user.trim();
                if (!u) return;
                writeSbUser(u);
                onSet({ ...EMPTY_GATE, ...keep, sb: u, fs: fsOn });
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
                <button type="button" className="btn" onClick={() => onSet({ ...EMPTY_GATE, ...keep, f: gate.f, d: gate.d, fs: fsOn === "ofp" ? null : fsOn })}>
                  Forget OFP
                </button>
              )}
            </form>
          )}
          {(fsOn === "tt" || fsOn == null) && (
            <>
              {gate.f && gate.stdAt == null && (
                <label className="jr-ctl">
                  <span className="ctl-label">Date (UTC)</span>
                  <select className="ctl-input" value={gate.d ?? ""} onChange={(e) => onPatch({ d: e.target.value || null })}>
                    <option value="">Next departure</option>
                    {dates.map((t) => (
                      <option key={t} value={isoDate(t)}>
                        {new Date(t).toUTCString().slice(0, 11)} · {hhmm(t)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="muted small">
                A timetable flight: pick one on the <b>Airport board</b>, or <b>Gate screen</b> on a flight in the <Link href="/">Finder</Link> or a leg in <Link href="/journeys">Journeys</Link>.
              </p>
            </>
          )}
          {fsOn === "fms" && <p className="muted small">{linkLive ? "OFP Tower is running: the route programmed in the MCDU is the flight." : "Start OFP Tower on the sim PC: the route programmed in the MCDU becomes the flight."}</p>}
          {fsOn === "vatsim" && (
            <form
              className="gt-sb"
              onSubmit={(e) => {
                e.preventDefault();
                const c = pilot.trim().toUpperCase();
                if (/^[A-Z0-9_-]{2,12}$/.test(c)) onFeed({ ...feedCfg, source: "auto", who: c });
              }}
            >
              <label className="jr-ctl">
                <span className="ctl-label">Their VATSIM callsign</span>
                <input className="ctl-input mono" value={pilot} maxLength={12} onChange={(e) => setPilot(e.target.value)} placeholder="Callsign, e.g. EWG50T" autoComplete="off" spellCheck={false} />
              </label>
              <button type="submit" className="btn" disabled={!/^[A-Za-z0-9_-]{2,12}$/.test(pilot.trim())}>
                Watch
              </button>
            </form>
          )}
          {fsOn !== "vatsim" && (
            <form
              className="gt-sb"
              onSubmit={(e) => {
                e.preventDefault();
                const w = mine.trim().toUpperCase();
                onFeed({ ...feedCfg, source: "auto", who: /^[A-Z0-9_-]{2,12}$/.test(w) ? w : null });
              }}
            >
              <label className="jr-ctl">
                <span className="ctl-label">Your VATSIM callsign (position when OFP Tower isn’t running)</span>
                <input className="ctl-input mono" value={mine} maxLength={12} onChange={(e) => setMine(e.target.value)} placeholder="e.g. RYR7FE" autoComplete="off" spellCheck={false} />
              </label>
              <button type="submit" className="btn">
                Use
              </button>
            </form>
          )}
          <p className="muted small">The position comes from the first that is live: OFP Tower, then VATSIM, else the clock. VATSIM is only read (the public list of who is online); nothing is sent to it.</p>
        </div>
      )}
    </section>
  );
}

/* ---------- C1: what is written on it, folded by when ---------- */

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

function Fold({ id, title, summary, open, onToggle, note, children }: { id: string; title: string; summary: string; open: boolean; onToggle: () => void; note?: string; children: React.ReactNode }) {
  return (
    <section className={cx("dk-card dk-fold", open && "is-open")} aria-labelledby={`${id}-h`}>
      <h3 className="dk-fold-h" id={`${id}-h`}>
        <button type="button" aria-expanded={open} aria-controls={`${id}-b`} onClick={onToggle}>
          <span className="ctl-label">{title}</span>
          {note && <small className="dk-fold-note">{note}</small>}
          <span className="dk-fold-sum">{summary}</span>
        </button>
      </h3>
      <div id={`${id}-b`} hidden={!open} className="dk-fold-b">
        {children}
      </div>
    </section>
  );
}

export function WrittenOn({
  gate,
  flight,
  dataFlight,
  now,
  left,
  autoReg,
  airlineCode,
  namesApply,
  onPatch,
}: {
  gate: GateState;
  flight: GateFlight;
  dataFlight: GateFlight | null;
  now: number;
  /** The aircraft has left the gate: "Before departure" folds itself. */
  left: boolean;
  autoReg: string | null;
  /** The operator the airline's names are kept under. */
  airlineCode: string | null;
  namesApply: boolean;
  onPatch: (p: Partial<GateState>) => void;
}) {
  const [before, setBefore] = useState<boolean | null>(null);
  const [screenOpen, setScreenOpen] = useState(true);
  const [ends, setEnds] = useState(false);
  const [vin, setVin] = useState(25);
  const [newGate, setNewGate] = useState("");
  // folds itself once the aircraft has left the gate; opens again by hand
  const [wasLeft, setWasLeft] = useState(left);
  if (left !== wasLeft) {
    setWasLeft(left);
    setBefore(null);
  }
  const beforeOpen = before ?? !left;
  // the airline's names: on the screen now, and remembered for this airline's next flights
  const nameAirline = (p: Pick<Partial<GateState>, "an" | "ac">) => {
    onPatch({ ...p, anf: airlineCode ?? "" });
    if (!airlineCode) return;
    const all = readJSON<Record<string, { an?: string; ac?: string }>>(KEYS.airlineNames, {});
    const next = { an: namesApply ? gate.an : "", ac: namesApply ? gate.ac : "", ...p };
    if (next.an || next.ac) all[airlineCode] = next;
    else delete all[airlineCode];
    writeJSON(KEYS.airlineNames, all);
  };
  const an = namesApply ? gate.an : "";
  const ac = namesApply ? gate.ac : "";
  const minToStd = Math.round((flight.stdMs - screenNow(now, flight, gate)) / MIN);
  const ps = phases(flight.types, flight.taxiOut);
  const clockSum = gate.stdAt != null ? `Virtual · STD in ${Math.max(0, minToStd)} min` : "Real time";
  const beforeSum = [clockSum, gate.delay ? `+${gate.delay} min` : "on time", gate.pin ? `hold on ${PIN_LABELS.find((p) => p[0] === gate.pin)?.[1]}` : "follows the clock", gate.cancelled && "cancelled", gate.oldGate && `gate change ${gate.oldGate} → ${gate.gate}`]
    .filter(Boolean)
    .join(" · ");
  const screenSum = [gate.gate ? `gate ${gate.gate}` : "no gate", gate.reg || autoReg || flight.reg ? `reg ${gate.reg || flight.reg || autoReg}` : null, an || ac ? "your airline names" : null, gate.msg ? "a message" : null, !gate.rotate && "info strip still", gate.overlay && "see-through"]
    .filter(Boolean)
    .join(" · ");
  const endsSum = [gate.go ? `countdown ${gate.go}` : "countdown: none", gate.bye ? `sign-off “${gate.bye.slice(0, 24)}${gate.bye.length > 24 ? "…" : ""}”` : "sign-off: the default"].join(" · ");

  return (
    <>
      <Fold id="dk-before" title="Before departure" note={left ? "the aircraft has left the gate" : undefined} summary={beforeSum} open={beforeOpen} onToggle={() => setBefore(!beforeOpen)}>
        <div className="seg jr-seg" role="radiogroup" aria-label="Clock" onKeyDown={radioKeys}>
          <button type="button" role="radio" aria-checked={gate.stdAt == null} tabIndex={roving(gate.stdAt == null, 0)} className="seg-btn" onClick={() => onPatch({ stdAt: null })}>
            Real time
          </button>
          <button type="button" role="radio" aria-checked={gate.stdAt != null} tabIndex={roving(gate.stdAt != null, 1)} className="seg-btn" onClick={() => onPatch({ stdAt: Math.floor(Date.now() / MIN) * MIN + vin * MIN })}>
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
            ? `The screen's clock runs so STD comes round in ${Math.max(0, minToStd)} min; the boarding steps play out live.`
            : "The screen shows the flight's real date and time; pick Virtual to start the countdown when you go live."}
        </p>
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
        <div className="gt-row">
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
        {ps.length > 0 && (
          <p className="muted small">
            Gate opens {Math.abs(ps[1].at)} min before off-block, boarding {Math.abs(ps[2].at)}, final call 20, gate closed 15; take-off after {ps[8].at} min of taxi.
          </p>
        )}
      </Fold>

      <Fold id="dk-screen" title="On the screen" summary={screenSum} open={screenOpen} onToggle={() => setScreenOpen((o) => !o)}>
        <label className="jr-ctl">
          <span className="ctl-label">Gate</span>
          <input className="ctl-input gt-gate" value={gate.gate} maxLength={6} onChange={(e) => onPatch({ gate: e.target.value.toUpperCase().slice(0, 6), oldGate: "" })} placeholder="e.g. 12" />
        </label>
        <label className="jr-ctl">
          <span className="ctl-label">Registration</span>
          <input className="ctl-input" value={gate.reg} maxLength={10} onChange={(e) => onPatch({ reg: e.target.value.toUpperCase().slice(0, 10) })} placeholder={flight.reg ?? autoReg ?? "e.g. G-ABCD"} />
        </label>
        <div className="gt-row">
          <label className="jr-ctl">
            <span className="ctl-label">Airline name</span>
            <input className="ctl-input" value={an} maxLength={40} onChange={(e) => nameAirline({ an: e.target.value.slice(0, 40) })} placeholder={dataFlight?.airline || "e.g. Wizz Air Malta"} />
          </label>
          <label className="jr-ctl">
            <span className="ctl-label">Code in the flight number</span>
            <input className="ctl-input gt-gate" value={ac} maxLength={3} onChange={(e) => nameAirline({ ac: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) })} placeholder={dataFlight?.flightNo.split(/\s+/)[0] ?? "e.g. W4"} />
          </label>
        </div>
        <p className="muted small">
          {airlineCode ? `Kept for ${airlineCode} flights only: another airline’s flight shows its own names.` : "This flight has no airline code, so names typed here show on any flight."}
        </p>
        <label className="jr-ctl">
          <span className="ctl-label">Message</span>
          <input className="ctl-input" value={gate.msg} maxLength={120} onChange={(e) => onPatch({ msg: e.target.value.slice(0, 120) })} placeholder="On the info strip, e.g. Welcome aboard!" />
        </label>
        <label className="check">
          <input type="checkbox" checked={gate.rotate} onChange={(e) => onPatch({ rotate: e.target.checked })} />
          Rotate the info strip (weather, flight facts, message)
        </label>
        <label className="check">
          <input type="checkbox" checked={gate.overlay} onChange={(e) => onPatch({ overlay: e.target.checked })} />
          See-through around the full gate screen (stream overlay)
        </label>
      </Fold>

      <Fold id="dk-ends" title="Start and end" summary={endsSum} open={ends} onToggle={() => setEnds((o) => !o)}>
        <label className="jr-ctl">
          <span className="ctl-label">Countdown to the stream (in the link only)</span>
          <input
            className="ctl-input"
            defaultValue={gate.go ?? ""}
            maxLength={40}
            onChange={(e) => onPatch({ go: goParam(e.target.value), goFrom: Date.now() })}
            placeholder="5m · 19:30 · 19:30Z · std-30 (several: std-30,5m)"
            aria-describedby="gt-go-note"
          />
        </label>
        <p className="muted small" id="gt-go-note">
          For the Countdown look. It lives in the source’s link, so it works without OFP Tower: copy the Countdown link under Send to OBS after a change. 5m counts from when the page loads: tick “Refresh browser when scene becomes active” on the OBS source and it starts again each time. 19:30 is this PC’s clock, 19:30Z UTC; std-30 is 30 min before the flight’s off-block. The first that gives a time wins.
        </p>
        <label className="jr-ctl">
          <span className="ctl-label">Sign-off</span>
          <input className="ctl-input" value={gate.bye} maxLength={140} onChange={(e) => onPatch({ bye: e.target.value.slice(0, 140) })} placeholder="On the Ending screen, e.g. Thanks for watching!" />
        </label>
        <p className="muted small">The sign-off reaches the Ending screen live through OFP Tower, like the other settings.</p>
      </Fold>
    </>
  );
}

/* ---------- S1: where it goes, Send to OBS ---------- */

export interface ScreenRow {
  id: string;
  as: string | null;
  view: string;
  v: string | null;
}

export function SendToObs({
  gate,
  hasFlight,
  relayOpen,
  screens,
  olderSeen,
  version,
  streamUrl,
  lookUrl,
  previewToken,
  onOpenWindow,
  onAddScene,
}: {
  gate: GateState;
  hasFlight: boolean;
  /** OFP Tower passes changes to the OBS sources live. */
  relayOpen: boolean;
  screens: ScreenRow[];
  /** When a screen from before 1.15 last said hello (it can't say what it shows). */
  olderSeen: number | null;
  version: string;
  /** The link that follows the aircraft; with a scene name, the one that is always that scene. */
  streamUrl: (as: string | null) => string;
  /** A link with one fixed look. */
  lookUrl: (view: string) => string;
  /** The look the preview shows now, for "this look only". */
  previewToken: string;
  onOpenWindow: () => void;
  onAddScene: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [copiedAt, setCopiedAt] = useState<Record<string, string>>({});
  const named = gate.scenes.map(([n]) => n.trim().toLowerCase());
  const copy = (key: string, url: string) =>
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(key);
      setCopiedAt((c) => ({ ...c, [key]: url }));
      setTimeout(() => setCopied(null), 1800);
    });
  // a link copied before a change: without OFP Tower it has to go into OBS again
  const stale = !relayOpen && Object.entries(copiedAt).some(([k, u]) => linkFor(k) !== u);
  function linkFor(k: string): string {
    if (k === "main") return streamUrl(null);
    if (k.startsWith("scene:")) return streamUrl(k.slice(6));
    return lookUrl(k.slice(5));
  }
  const shows = (s: ScreenRow) => {
    const fixed = s.view !== "auto";
    if (fixed) {
      const ls = layersFrom(s.view);
      const t = turnsFrom(s.view);
      const name = s.view === "countdown" ? "the Countdown look" : s.view === "ending" ? "the Ending look" : ls ? ls.map((l) => VIEW_INFO[l.v].name).join(" + ") : t ? "a rotation of its own" : s.view;
      return { text: `one fixed look: ${name}`, change: "keeps its own look; text changes still reach it" };
    }
    if (!s.as) return { text: "follows the OBS scene it is in", change: "reaches it live" };
    const known = named.includes(s.as.trim().toLowerCase());
    return known ? { text: `the ${s.as} scene`, change: "reaches it live" } : { text: `no scene named ${s.as} here: showing “Any other scene”`, change: "reaches it live", add: s.as };
  };
  const fixedLinks: [string, string, string][] = [
    ["countdown", "Countdown", "the countdown to the stream (its timing lives in the link)"],
    ["ending", "Ending", "the ending screen"],
  ];
  const lookOnly = previewToken && previewToken !== "countdown" && previewToken !== "ending" ? previewToken : null;
  const linkRow = (key: string, name: string, sub: string, url: string) => (
    <li key={key}>
      <span>
        <b>{name}</b>
        <small>{sub}</small>
      </span>
      <button type="button" className="btn btn-sm" disabled={!hasFlight} onClick={() => copy(key, url)}>
        {copied === key ? "Copied" : "Copy"}
      </button>
    </li>
  );

  return (
    <section className="dk-obs" aria-labelledby="dk-obs-h">
      <div className="dk-obs-bar">
        <button type="button" className="btn btn-primary dk-send" aria-expanded={open} aria-controls="dk-obs-b" onClick={() => setOpen((o) => !o)}>
          <span id="dk-obs-h">Send to OBS</span> <span aria-hidden="true">{open ? "▴" : "▾"}</span>
        </button>
        <span className={cx("st-chip", relayOpen && "is-on")} title={relayOpen ? "Changes on this page reach the open OBS sources live through OFP Tower" : "Without OFP Tower, copy a link again after a change"}>
          <i aria-hidden="true" />
          {relayOpen ? `Changes go live to ${screens.length} screen${screens.length === 1 ? "" : "s"}` : "OBS: copy after changes"}
        </span>
      </div>
      {stale && <p className="sp-stale small">Changed since you copied a link: copy it again and paste it into OBS (or run OFP Tower and changes go there by themselves).</p>}
      <div id="dk-obs-b" hidden={!open} className="dk-card dk-obs-b">
        <h4 className="ctl-label">Open now</h4>
        {!relayOpen ? (
          <p className="muted small">With OFP Tower running, the screens open in OBS are listed here, with what a change on this page does to each.</p>
        ) : screens.length === 0 && !olderSeen ? (
          <p className="muted small">No screen has answered yet. A source shows up within 30 s of loading.</p>
        ) : (
          <table className="dk-open">
            <thead>
              <tr>
                <th scope="col">Screen</th>
                <th scope="col">Shows</th>
                <th scope="col">A change here</th>
              </tr>
            </thead>
            <tbody>
              {screens.map((s) => {
                const r = shows(s);
                return (
                  <tr key={s.id}>
                    <th scope="row">{s.as ?? (s.view === "auto" ? "Follows OBS" : s.view.split(/[.~>@|]/)[0])}</th>
                    <td>
                      {r.text}
                      {s.v && s.v !== version && <small className="dk-old"> · runs {s.v}: refresh this source</small>}
                    </td>
                    <td>
                      {r.change}
                      {r.add && (
                        <button type="button" className="btn btn-sm" onClick={() => onAddScene(r.add!)}>
                          Add scene
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {olderSeen && (
                <tr>
                  <th scope="row">An older page</th>
                  <td>connected at {hhmm(olderSeen)} but can’t say what it shows</td>
                  <td>refresh this source in OBS</td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        <h4 className="ctl-label">Links</h4>
        <ul className="dk-links">
          {linkRow("main", "Main", "follows the aircraft and the OBS scene it is in; the scene rules come from this page", streamUrl(null))}
          {gate.scenes.map(([n]) => linkRow(`scene:${n}`, n, `always the ${n} scene, whatever OBS shows`, streamUrl(n)))}
          {fixedLinks.map(([v, n, sub]) => linkRow(`look:${v}`, n, `one fixed look: ${sub}`, lookUrl(v)))}
          {lookOnly && linkRow(`look:${lookOnly}`, "This look only", `the look in the preview (${lookOnly}), fixed; text changes still reach it`, lookUrl(lookOnly))}
          <li>
            <span>
              <b>Screen window</b>
              <small>a window to capture, in step with this tab while it is open</small>
            </span>
            <button type="button" className="btn btn-sm" disabled={!hasFlight} onClick={onOpenWindow}>
              Open
            </button>
          </li>
        </ul>
        <ol className="sp-steps small">
          <li>
            <b>Add a link</b> as a Browser source, 1920 × 1080, above the game capture.
          </li>
          <li>
            <b>One source per scene</b> is simplest: each scene’s own link (above). With Studio Mode, a shared source only shows the scene that is live (Program).
          </li>
          <li>
            For “Main”, set <b>Page permissions</b> to “Read access to user information”, so it can read the scene name.
          </li>
        </ol>
        <p className="muted small">
          {inObs() ? "This page is inside OBS." : "Scene names only work inside OBS."} On the screen window: <kbd>↑</kbd>/<kbd>↓</kbd> delay ±5 min, <kbd>0</kbd> on time, <kbd>C</kbd> cancelled, <kbd>F</kbd> full screen.
        </p>
      </div>
    </section>
  );
}
