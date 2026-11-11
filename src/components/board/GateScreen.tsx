"use client";

import type { CSSProperties } from "react";
import { cityName, dur } from "@/lib/data/flight";
import { routeColor, textOn } from "@/lib/colors";
import { countryName } from "@/lib/places";
import { MIN, phaseAt, phases, type PhaseKey } from "@/lib/board/board";
import type { GateFlight, GateState } from "@/lib/board/gate";
import { aircraft } from "@/lib/aircraft";
import { landingText, PHASE_LABEL, type FlightPhase, type FlightPlan, type FlightState } from "@/lib/feed/core";
import { altText, Belt, liveFacts } from "./GateViews";

/** Destination weather for the info strip. */
export interface GateWx {
  temp: number | null;
  text: string | null;
  /** WMO weather code, for the picto. */
  code: number | null;
  /** Dark at the destination at arrival (a moon instead of a sun). */
  night: boolean;
}

/** HH:MM at an airport (its time zone; UTC with a Z when unknown). */
export function localClock(ms: number, tz: string | null): string {
  if (tz) {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
    } catch {
      /* fall through */
    }
  }
  return `${new Date(ms).toISOString().slice(11, 16)}Z`;
}
/** The zone localClock() shows at that moment: "UTC+1", "UTC+5:30", or "UTC" (also when the zone is unknown). */
export function zoneLabel(ms: number, tz: string | null): string {
  if (!tz) return "UTC";
  try {
    const name = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(ms).find((p) => p.type === "timeZoneName")?.value;
    if (name && /^GMT([+-]\d{1,2}(:\d\d)?)?$/.test(name)) return name.replace("GMT", "UTC");
  } catch {
    /* fall through */
  }
  return "UTC";
}
function localDate(ms: number, tz: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz ?? "UTC", weekday: "short", day: "numeric", month: "short" }).format(ms);
  } catch {
    return new Date(ms).toUTCString().slice(0, 11);
  }
}

/** The steps drawn on the progress line. */
const STEPS: PhaseKey[] = ["gate", "boarding", "final", "closed", "ready", "pushback", "lineup", "takeoff"];

/** Where a live phase sits on the departure step line. */
const LIVE_STEP: Record<FlightPhase, PhaseKey> = {
  boarding: "boarding",
  doorsClosed: "closed",
  pushback: "pushback",
  taxi: "pushback",
  takeoff: "takeoff",
  climb: "departed",
  cruise: "departed",
  descent: "departed",
  approach: "departed",
  landed: "departed",
  taxiIn: "departed",
  gate: "departed",
};

/** After pushback the step line runs on to the arrival gate (sheet 02, G1). */
const FLIGHT_STEPS: { key: string; label: string; of: FlightPhase[] }[] = [
  { key: "pushback", label: "Pushback", of: ["pushback", "taxi"] },
  { key: "takeoff", label: "Take-off", of: ["takeoff"] },
  { key: "climb", label: "Climb", of: ["climb"] },
  { key: "cruise", label: "Cruise", of: ["cruise"] },
  { key: "descent", label: "Descent", of: ["descent"] },
  { key: "approach", label: "Approach", of: ["approach"] },
  { key: "landing", label: "Landing", of: ["landed", "taxiIn"] },
  { key: "gate", label: "At the gate", of: ["gate"] },
];
const zTime = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)}Z`;

/** "FL284 · 463 kt", or "3,200 ft · 180 kt" below FL100; on the ground, the speed alone. */
function figures(st: FlightState): string | null {
  const s = st.last;
  if (!s) return null;
  if (st.stage === "ready" || st.phase === "gate") return null;
  const kt = `${Math.round(s.gs)} kt`;
  if (s.onGround ?? s.gs < 40) return st.phase === "pushback" ? null : kt;
  const alt = altText(s);
  return `${alt} · ${kt}`;
}

/** An airport's own name, short: no "Airport", no city in front (London Heathrow Airport → Heathrow). */
export function shortName(name: string, city: string | null): string {
  const n = name.replace(/ (International )?Airport$/, "");
  return city && n.startsWith(`${city} `) ? n.slice(city.length + 1) : n;
}

/** The screen's own clock: real time, or shifted so STD comes round at state.stdAt. */
export const screenNow = (now: number, f: GateFlight, g: GateState) => (g.stdAt != null ? now + (f.stdMs - g.stdAt) : now);

/**
 * A gate screen for one flight, as above a departure gate: the airline's colour and wordmark, the
 * destination, STD / new time / ETA in local time, the boarding step with a countdown, and the
 * steps from gate open to take-off. Drawn on a 16:9 canvas sized in container units, so it scales
 * from the preview to a 1920×1080 stream source.
 */
export function GateScreen({
  flight: f,
  state: g,
  now,
  wx,
  live = null,
  source = null,
  plan = null,
}: {
  flight: GateFlight;
  state: GateState;
  now: number;
  wx: GateWx | null;
  live?: FlightState | null;
  /** Where the live figures come from ("MSFS", "VATSIM", "Replay"), shown beside the clock. */
  source?: string | null;
  /** The FMS route (OFP Tower, Fenix): distance to go follows it. */
  plan?: FlightPlan | null;
}) {
  const bg = routeColor(f.brand);
  const ink = textOn(bg);
  const accent =
    f.brand?.colors.secondary && /^#[0-9a-f]{6}$/i.test(f.brand.colors.secondary) && f.brand.colors.secondary.toLowerCase() !== bg.toLowerCase() ? f.brand.colors.secondary : ink;
  const t = screenNow(now, f, g);
  const etd = f.stdMs + g.delay * MIN;
  const eta = f.block != null ? etd + f.block * MIN : null;
  const ps = phases(f.types, f.taxiOut);
  const auto = phaseAt(ps, (etd - t) / MIN);
  // with a live feed the aircraft sets the step, not the clock (a pinned step still wins)
  const fed = live ? (ps.find((p) => p.key === LIVE_STEP[live.phase]) ?? auto) : auto;
  const phase = g.pin ? (ps.find((p) => p.key === g.pin) ?? fed) : fed;
  const at = (k: PhaseKey) => etd + (ps.find((p) => p.key === k)?.at ?? 0) * MIN;
  const delayed = g.delay >= 5;
  const fromTz = f.from.tz;
  const toTz = f.to.tz;
  // every time on the screen is local at its airport; say which zone that is
  const fromZone = zoneLabel(t, fromTz);
  const toZone = zoneLabel(eta ?? t, toTz);

  // the headline status and what comes next
  let status = phase.label;
  let tone: "go" | "warn" | "stop" | "plain" | "done" = "plain";
  let next: string | null = null;
  const inMin = (ms: number) => Math.max(0, Math.ceil((ms - t) / MIN));
  const step = STEPS.indexOf(phase.key);
  if (g.cancelled) {
    status = "Cancelled";
    tone = "stop";
    next = "Please contact the airline";
  } else if (phase.key === "scheduled") {
    status = delayed ? "Delayed" : "On time";
    tone = delayed ? "warn" : "plain";
    next = `Gate opens ${localClock(at("gate"), fromTz)}${inMin(at("gate")) <= 120 ? ` · in ${dur(inMin(at("gate")))}` : ""}`;
  } else if (phase.key === "gate") {
    tone = "go";
    next = `Boarding starts in ${inMin(at("boarding"))} min`;
  } else if (phase.key === "boarding") {
    tone = "go";
    next = `Gate closes in ${inMin(at("closed"))} min`;
  } else if (phase.key === "final") {
    tone = "warn";
    next = `Gate closes in ${inMin(at("closed"))} min`;
  } else if (phase.key === "closed" || phase.key === "ready") {
    tone = "stop";
    next = `Pushback in ${inMin(etd)} min`;
  } else if (phase.key === "departed") {
    tone = "done";
    next = eta ? `Arriving ${localClock(eta, toTz)} local time (${toZone})` : null;
  } else {
    tone = "done";
    next = phase.key === "takeoff" ? `Climbing out${f.runway ? ` from runway ${f.runway}` : ""}` : `Off-block ${localClock(etd, fromTz)}${f.runway ? ` · runway ${f.runway}` : ""}`;
  }
  if (live && !g.pin && !g.cancelled) {
    status = PHASE_LABEL[live.phase];
    tone = live.stage === "ready" ? (live.phase === "boarding" ? "go" : "stop") : "done";
    const at2 = (ms: number | null, tz: string | null) => (ms == null ? null : localClock(ms, tz));
    next =
      live.phase === "gate"
        ? [at2(live.stamps.in, toTz) && `On stand ${at2(live.stamps.in, toTz)}`, landingText(live.stamps)].filter(Boolean).join(" · ") || null
        : live.stage === "ready"
          ? f.source === "fms"
            ? `${f.from.iata ?? f.from.icao} → ${f.to.iata ?? f.to.icao}${f.cruiseFt ? ` · cruise FL${Math.round(f.cruiseFt / 100)}` : ""}`
            : `Off-block ${localClock(etd, fromTz)}`
          : (figures(live) ?? (live.stamps.out != null ? `Off-block ${localClock(live.stamps.out, fromTz)}` : null));
  }
  if (g.pin && !g.cancelled) next = null;
  if (g.oldGate && g.gate && !g.cancelled) next = `Gate change: ${g.oldGate} → ${g.gate}`;

  // two airports in one city (London City → Heathrow): the destination airport's own name
  // two airports in one city (London City → Heathrow): the airport big, its city small above
  const sameCity = cityName(f.to) != null && cityName(f.to) === cityName(f.from);
  const dest = sameCity ? shortName(f.to.name, cityName(f.to)) : (cityName(f.to) ?? f.to.name);
  const type = f.typeName ?? (f.types[0] ? [aircraft(f.types[0]).maker, aircraft(f.types[0]).model].filter(Boolean).join(" ") || f.types[0] : null);
  const facts = [
    f.block != null && `Flight time ${dur(f.block)}`,
    f.nm != null && `${f.nm.toLocaleString("en-GB")} nm`,
    f.cruiseFt != null && `FL${String(Math.round(f.cruiseFt / 100)).padStart(3, "0")}`,
    f.pax != null && `${f.pax} passengers`,
  ].filter(Boolean) as string[];
  const wxText =
    wx && (wx.temp != null || wx.text) ? `${dest} at arrival: ${[wx.temp != null ? `${Math.round(wx.temp)}°C` : null, wx.text?.toLowerCase()].filter(Boolean).join(", ")}` : null;
  const liveLine = live && live.stage === "flying" && live.last && !live.last.onGround && live.phase !== "landed" ? `${figures(live)?.replace(" · ", " · Ground speed ").replace(/^/, "Level ")}` : null;
  const items = [liveLine, wxText, liveLine ? null : facts.length ? facts.join(" · ") : null, g.msg || null].filter((x): x is string => !!x);
  const item = items.length ? items[g.rotate ? Math.floor(now / 8000) % items.length : 0] : null;

  // how far along the step line: steps done, plus the part of the way to the next one the clock has gone
  // (a pinned step sits on its marker; nothing is done before the gate opens or on a cancelled flight)
  const last = STEPS.length - 1;
  let frac = 0;
  if (!g.pin && !live && step >= 0 && step < last) {
    const a = at(STEPS[step]);
    const b = at(STEPS[step + 1]);
    frac = b > a ? Math.min(1, Math.max(0, (t - a) / (b - a))) : 0;
  }
  const progress = g.cancelled ? 0 : phase.key === "departed" ? 1 : step < 0 ? 0 : Math.min(1, (step + frac) / last);

  // with a live feed past the gate, the steps run on to the arrival gate and the times are the
  // ones stamped (est. for what's still to come)
  const inFlight = !!live && live.stage !== "ready" && !g.pin && !g.cancelled;
  const lf = live ? liveFacts(f, g, live, now, plan) : null;
  const fIdx = inFlight ? FLIGHT_STEPS.findIndex((x) => x.of.includes(live!.phase)) : -1;
  const fTime = (k: string): string => {
    if (!live) return "";
    const st = live.stamps;
    const e = live.entered;
    const etaOn = lf?.arrives ?? null;
    const at: Record<string, number | null | undefined> = {
      pushback: st.out,
      takeoff: st.off,
      climb: e.climb,
      cruise: e.cruise,
      descent: e.descent,
      approach: e.approach,
      landing: st.on,
      gate: st.in,
    };
    const v = at[k];
    if (v != null) return zTime(v);
    if (k === "landing" && etaOn != null) return `est ${zTime(etaOn)}`;
    if (k === "gate" && etaOn != null) return `est ${zTime(etaOn + 6 * MIN)}`;
    return "";
  };
  // the clock: the aircraft's own time once it's moving (a replay runs in the recording's sim time)
  const clockAt = inFlight && live!.last ? live!.last.t : t;
  if (inFlight && lf) {
    status = lf.status;
    tone = lf.tone;
    next = lf.line;
  }

  return (
    <div className="gs" style={{ "--gs-bg": bg, "--gs-ink": ink, "--gs-accent": accent } as CSSProperties} role="region" aria-label={`Gate screen: ${f.flightNo} to ${dest}`}>
      <svg className="gs-watermark" viewBox="0 0 64 64" aria-hidden="true">
        <path d={PLANE} />
      </svg>
      <header className="gs-top">
        <span className="gs-brand">
          <svg className="gs-picto" viewBox="0 0 64 64" aria-hidden="true">
            <path d={PLANE} />
          </svg>
          <span className="gs-wordmark">{f.airline}</span>
        </span>
        {g.gate && !inFlight && (
          <span className="gs-gate">
            <small>Gate</small>
            <b>{g.gate}</b>
          </span>
        )}
        {inFlight && source && (
          <span className="gs-gate gs-live">
            <small>Live from</small>
            <b>{source}</b>
          </span>
        )}
        <Belt live={live} />
        <span className="gs-clock">
          <b className="mono">{localClock(clockAt, fromTz)}</b>
          <small>
            {localDate(clockAt, fromTz)} · {zoneLabel(clockAt, fromTz)}
          </small>
        </span>
      </header>

      <div className="gs-main">
        <div className="gs-ident mono">
          {f.flightNo}
          {f.callsign && f.callsign.replace(/\s/g, "") !== f.flightNo.replace(/\s/g, "") && <span> · {f.callsign}</span>}
        </div>
        {sameCity && <div className="gs-dest-city">{cityName(f.to)}</div>}
        {/* a long name shrinks to fit the line rather than being cut off */}
        <div className="gs-dest" style={{ "--fit": Math.min(1, 13 / dest.length) } as CSSProperties}>
          {dest}
        </div>
        <div className="gs-dest-sub">
          {[f.to.iata, f.to.icao, f.to.country ? countryName(f.to.country) : null].filter(Boolean).join(" · ")}
          {type && <span> · {type}</span>}
          {(g.reg || f.reg) && <span className="mono"> · {g.reg || f.reg}</span>}
        </div>
      </div>

      <div className="gs-times">
        {inFlight && live!.stamps.off != null && (
          <div>
            <small>Took off · {zoneLabel(live!.stamps.off, fromTz)}</small>
            <b className="mono">{localClock(live!.stamps.off, fromTz)}</b>
          </div>
        )}
        {inFlight && live!.stamps.off == null && live!.stamps.out != null && (
          <div>
            <small>Off-block · {zoneLabel(live!.stamps.out, fromTz)}</small>
            <b className="mono">{localClock(live!.stamps.out, fromTz)}</b>
          </div>
        )}
        {inFlight && lf?.arrives != null && (
          <div>
            <small>{live!.stamps.on != null ? "Landed" : "Arrives"} · {zoneLabel(lf.arrives, toTz)}</small>
            <b className="mono">{localClock(lf.arrives, toTz)}</b>
          </div>
        )}
        {!inFlight && f.source !== "fms" && (
        <div className={delayed && !g.cancelled ? "is-struck" : undefined}>
          <small>Scheduled · {zoneLabel(f.stdMs, fromTz)}</small>
          <b className="mono">{localClock(f.stdMs, fromTz)}</b>
        </div>
        )}
        {!inFlight && f.source !== "fms" && delayed && !g.cancelled && (
          <div className="gs-new">
            <small>New time · {zoneLabel(etd, fromTz)}</small>
            <b className="mono">{localClock(etd, fromTz)}</b>
          </div>
        )}
        {!inFlight && f.source !== "fms" && eta != null && !g.cancelled && (
          <div>
            <small>Arrives · {toZone}</small>
            <b className="mono">{localClock(eta, toTz)}</b>
          </div>
        )}
        <div className={`gs-status gs-${tone}`} aria-live="polite">
          <b>{status}</b>
          {next && <small>{next}</small>}
        </div>
      </div>

{inFlight ? (
        <ol className="gs-steps" aria-label="Flight steps, UTC" style={{ "--gs-n": FLIGHT_STEPS.length, "--gs-p": Math.max(0, fIdx) / (FLIGHT_STEPS.length - 1) } as CSSProperties}>
          {FLIGHT_STEPS.map((x, i) => {
            const state = i < fIdx || live!.phase === "gate" ? "done" : i === fIdx ? "now" : "todo";
            const tm = fTime(x.key);
            return (
              <li key={x.key} className={`is-${state}`} aria-current={state === "now" ? "step" : undefined}>
                <i aria-hidden="true" />
                <b>{x.label}</b>
                <small className="mono">{state === "now" && x.key === "cruise" && lf?.toGo != null ? `${lf.toGo} nm to go` : tm}</small>
              </li>
            );
          })}
        </ol>
      ) : (
            <ol className="gs-steps" aria-label={`Boarding steps, local time ${fromZone}`} style={{ "--gs-n": STEPS.length, "--gs-p": progress } as CSSProperties}>
        {STEPS.map((k, i) => {
          const p = ps.find((x) => x.key === k)!;
          const state = g.cancelled ? "todo" : phase.key === "departed" || i < step ? "done" : i === step ? "now" : "todo";
          return (
            <li key={k} className={`is-${state}`} aria-current={state === "now" ? "step" : undefined}>
              <i aria-hidden="true" />
              <b>{p.short}</b>
              <small className="mono">{f.source === "fms" ? "" : localClock(at(k), fromTz)}</small>
            </li>
          );
        })}
      </ol>
      )}

      <footer className="gs-info">
        {item && (
          <span key={item} className="gs-info-item">
            {item === wxText && wx && <WxPicto code={wx.code} night={wx.night} />}
            <span>{item}</span>
          </span>
        )}
      </footer>
    </div>
  );
}

/** A plain airliner seen from above (decorative, not any airline's mark). */
export const PLANE = "M32 3c2.2 0 3.4 2.4 3.4 6v13.6l22.6 12.6v5.6l-22.6-7.2v11.8l7.6 5.6v4.4l-11-3.4-11 3.4v-4.4l7.6-5.6V33.6L6 40.8v-5.6l22.6-12.6V9c0-3.6 1.2-6 3.4-6z";

/** A small weather picto from a WMO code: clear, partly cloudy, cloud, fog, rain, snow or thunder. */
function WxPicto({ code, night }: { code: number | null; night: boolean }) {
  const c = code ?? 3;
  const kind =
    c <= 1
      ? "clear"
      : c === 2
        ? "partly"
        : c === 3
          ? "cloud"
          : c === 45 || c === 48
            ? "fog"
            : c >= 95
              ? "storm"
              : (c >= 71 && c <= 77) || c === 85 || c === 86
                ? "snow"
                : c >= 51
                  ? "rain"
                  : "cloud";
  const cloud = <path d="M7 17.5h10.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6-1.3A4 4 0 0 0 7 17.5z" />;
  const sky = night ? (
    <path className="sun" d="M15.5 4.5a6 6 0 1 0 4 10.4 7 7 0 0 1-4-10.4z" />
  ) : (
    <g className="sun">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </g>
  );
  return (
    <svg className="gs-info-icon" viewBox="0 0 24 24" aria-hidden="true">
      {kind === "clear" && sky}
      {kind === "partly" && (
        <>
          <g transform="translate(-3 -3) scale(0.8)">{sky}</g>
          {cloud}
        </>
      )}
      {kind === "cloud" && cloud}
      {kind === "fog" && <path d="M4 9h16M6 13h13M4 17h16" />}
      {kind === "rain" && (
        <>
          <g transform="translate(0 -3)">{cloud}</g>
          <path className="drop" d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" />
        </>
      )}
      {kind === "snow" && (
        <>
          <g transform="translate(0 -3)">{cloud}</g>
          <path d="M8 19.5h.01M12 21h.01M16 19.5h.01" strokeWidth="2.6" />
        </>
      )}
      {kind === "storm" && (
        <>
          <g transform="translate(0 -3)">{cloud}</g>
          <path className="bolt" d="M12.5 15 9.5 20h2.5l-1 3.5 3.5-5h-2.5l1-3.5z" />
        </>
      )}
    </svg>
  );
}
