"use client";

import type { CSSProperties } from "react";
import { cityName, dur } from "@/lib/data/flight";
import { routeColor, textOn } from "@/lib/colors";
import { countryName } from "@/lib/places";
import { MIN, phaseAt, phases, type PhaseKey } from "@/lib/board/board";
import type { GateFlight, GateState } from "@/lib/board/gate";
import { aircraft } from "@/lib/aircraft";

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
function localDate(ms: number, tz: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz ?? "UTC", weekday: "short", day: "numeric", month: "short" }).format(ms);
  } catch {
    return new Date(ms).toUTCString().slice(0, 11);
  }
}

/** The steps drawn on the progress line. */
const STEPS: PhaseKey[] = ["gate", "boarding", "final", "closed", "ready", "pushback", "lineup", "takeoff"];

/** The screen's own clock: real time, or shifted so STD comes round at state.stdAt. */
export const screenNow = (now: number, f: GateFlight, g: GateState) => (g.stdAt != null ? now + (f.stdMs - g.stdAt) : now);

/**
 * A gate screen for one flight, as above a departure gate: the airline's colour and wordmark, the
 * destination, STD / new time / ETA in local time, the boarding step with a countdown, and the
 * steps from gate open to take-off. Drawn on a 16:9 canvas sized in container units, so it scales
 * from the preview to a 1920×1080 stream source.
 */
export function GateScreen({ flight: f, state: g, now, wx }: { flight: GateFlight; state: GateState; now: number; wx: GateWx | null }) {
  const bg = routeColor(f.brand);
  const ink = textOn(bg);
  const accent =
    f.brand?.colors.secondary && /^#[0-9a-f]{6}$/i.test(f.brand.colors.secondary) && f.brand.colors.secondary.toLowerCase() !== bg.toLowerCase() ? f.brand.colors.secondary : ink;
  const t = screenNow(now, f, g);
  const etd = f.stdMs + g.delay * MIN;
  const eta = f.block != null ? etd + f.block * MIN : null;
  const ps = phases(f.types, f.taxiOut);
  const auto = phaseAt(ps, (etd - t) / MIN);
  const phase = g.pin ? (ps.find((p) => p.key === g.pin) ?? auto) : auto;
  const at = (k: PhaseKey) => etd + (ps.find((p) => p.key === k)?.at ?? 0) * MIN;
  const delayed = g.delay >= 5;
  const fromTz = f.from.tz;
  const toTz = f.to.tz;

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
    next = eta ? `Arriving ${localClock(eta, toTz)} local time` : null;
  } else {
    tone = "done";
    next = phase.key === "takeoff" ? `Climbing out${f.runway ? ` from runway ${f.runway}` : ""}` : `Off-block ${localClock(etd, fromTz)}${f.runway ? ` · runway ${f.runway}` : ""}`;
  }
  if (g.pin && !g.cancelled) next = null;
  if (g.oldGate && g.gate && !g.cancelled) next = `Gate change: ${g.oldGate} → ${g.gate}`;

  const dest = cityName(f.to) ?? f.to.name;
  const type = f.typeName ?? (f.types[0] ? [aircraft(f.types[0]).maker, aircraft(f.types[0]).model].filter(Boolean).join(" ") || f.types[0] : null);
  const facts = [
    f.block != null && `Flight time ${dur(f.block)}`,
    f.nm != null && `${f.nm.toLocaleString("en-GB")} nm`,
    f.cruiseFt != null && `FL${String(Math.round(f.cruiseFt / 100)).padStart(3, "0")}`,
    f.pax != null && `${f.pax} passengers`,
  ].filter(Boolean) as string[];
  const wxText =
    wx && (wx.temp != null || wx.text) ? `${dest} at arrival: ${[wx.temp != null ? `${Math.round(wx.temp)}°C` : null, wx.text?.toLowerCase()].filter(Boolean).join(", ")}` : null;
  const items = [wxText, facts.length ? facts.join(" · ") : null, g.msg || null].filter((x): x is string => !!x);
  const item = items.length ? items[g.rotate ? Math.floor(now / 8000) % items.length : 0] : null;

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
        {g.gate && (
          <span className="gs-gate">
            <small>Gate</small>
            <b>{g.gate}</b>
          </span>
        )}
        <span className="gs-clock">
          <b className="mono">{localClock(t, fromTz)}</b>
          <small>{localDate(t, fromTz)}</small>
        </span>
      </header>

      <div className="gs-main">
        <div className="gs-ident mono">
          {f.flightNo}
          {f.callsign && f.callsign.replace(/\s/g, "") !== f.flightNo.replace(/\s/g, "") && <span> · {f.callsign}</span>}
        </div>
        <div className="gs-dest">{dest}</div>
        <div className="gs-dest-sub">
          {[f.to.iata, f.to.icao, f.to.country ? countryName(f.to.country) : null].filter(Boolean).join(" · ")}
          {type && <span> · {type}</span>}
          {(g.reg || f.reg) && <span className="mono"> · {g.reg || f.reg}</span>}
        </div>
      </div>

      <div className="gs-times">
        <div className={delayed && !g.cancelled ? "is-struck" : undefined}>
          <small>Scheduled</small>
          <b className="mono">{localClock(f.stdMs, fromTz)}</b>
        </div>
        {delayed && !g.cancelled && (
          <div className="gs-new">
            <small>New time</small>
            <b className="mono">{localClock(etd, fromTz)}</b>
          </div>
        )}
        {eta != null && !g.cancelled && (
          <div>
            <small>Arrives (local)</small>
            <b className="mono">{localClock(eta, toTz)}</b>
          </div>
        )}
        <div className={`gs-status gs-${tone}`} aria-live="polite">
          <b>{status}</b>
          {next && <small>{next}</small>}
        </div>
      </div>

      <ol className="gs-steps" aria-label="Boarding steps">
        {STEPS.map((k, i) => {
          const p = ps.find((x) => x.key === k)!;
          const state = g.cancelled ? "todo" : phase.key === "departed" || i < step ? "done" : i === step ? "now" : "todo";
          return (
            <li key={k} className={`is-${state}`} aria-current={state === "now" ? "step" : undefined}>
              <i aria-hidden="true" />
              <b>{p.short}</b>
              <small className="mono">{localClock(at(k), fromTz)}</small>
            </li>
          );
        })}
      </ol>

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
