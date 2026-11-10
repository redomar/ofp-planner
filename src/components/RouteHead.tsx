"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { DAY_NAMES, TAXI_IN, TAXI_OUT, cityName, dur, fourTimes, hhmm, localHHMM, tzLabel, varies, wrap, type FourTimes, type Moment } from "@/lib/data/flight";
import type { Airport, FlightRow } from "@/lib/data/load";
import { useDisplay, type PassStyle } from "@/lib/display";
import { GLOSSARY } from "@/lib/glossary";
import { FlapCode } from "./FlapCode";
import { GuessMark, guessedEnd } from "./badges";
import { Flag } from "./Flag";
import { Tip, V } from "./ui";

type Side = "dep" | "arr";

interface Props {
  f: FlightRow;
  from: Airport | undefined;
  to: Airport | undefined;
  blockMin: number | null;
  nm: number | null;
  /** Finder: list everything from / to this airport. */
  onPlace?: (side: Side, icao: string) => void;
  /** Brief: the airport links to the finder with it as the origin. */
  placeHref?: (icao: string) => string;
}

/**
 * The front of the flight card's boarding pass: where from, where to and when, in the style
 * chosen in Settings → Display. "track" (default) adds the OUT · OFF · ON · IN track, "side" is
 * the same without it (its actions sit on a stub at the side), "city" leads with the city names
 * and local times. Times that aren't scheduled or tracked are estimated and carry an EST. badge.
 * The airline band above it and the tear-off stub with the actions belong to FlightCard.
 */
export function RouteHead(p: Props & { style?: PassStyle }) {
  const d = useDisplay();
  const style = p.style ?? d.pass;
  const t = fourTimes(p.f, p.blockMin);
  if (style === "city") return <City {...p} t={t} />;
  return <Codes {...p} t={t} track={style === "track"} />;
}

type WithTimes = Props & { t: FourTimes };

const city = (a: Airport | undefined, icao: string) => cityName(a) ?? a?.name ?? icao;
const codeLabel = (a: Airport | undefined, icao: string) => (a ? `${icao}, ${a.name}` : icao);
const KIND = { sched: "Scheduled", obs: "Typical time from tracked flights", est: "Estimated" } as const;

/** EST. badge for an estimated time. */
function Est() {
  return (
    <Tip tip="Estimated: neither scheduled nor tracked; worked out from the other times with typical taxi and block time." title="Estimate" plain>
      <span className="est-badge">EST.</span>
    </Tip>
  );
}

function Z({ m, big }: { m: Moment | null; big?: boolean }) {
  if (!m) return <span className={`mono muted${big ? " rh-big" : ""}`}>—</span>;
  return (
    <span className="rh-z">
      <span className={`mono${big ? " rh-big" : ""}${m.kind === "obs" ? " obs" : ""}`} title={KIND[m.kind]}>
        {hhmm(m.t)}Z
      </span>
      {m.kind === "est" && <Est />}
    </span>
  );
}
const local = (m: Moment | null, a: Airport | undefined) => (m && a?.tz ? `${localHHMM(m.t, a.tz)} LT · ${tzLabel(a.tz)}` : null);

/** Code flaps + city line, linked to the finder on the brief. The flaps flip when the code changes, not on scroll. */
function Place({ a, icao, placeHref, align, guess }: { a: Airport | undefined; icao: string; placeHref?: Props["placeHref"]; align?: "r"; guess?: "o" | "d" }) {
  const inner = (
    <>
      <span className="code-flap">
        <FlapCode key={icao} code={icao} label={codeLabel(a, icao)} />
      </span>
      <p className={`fcard-place rh-city${align ? " r" : ""}`}>
        {a?.country && <Flag cc={a.country} />}
        <b>{a ? city(a, icao) : <V v={null} w={8} />}</b>
        {a?.iata && <span className="mono muted">{a.iata}</span>}
        {guess && <GuessMark side={guess} name={a ? city(a, icao) : icao} />}
      </p>
    </>
  );
  return placeHref ? (
    <Link className="fcard-placelink" href={placeHref(icao)} title={`Flights from ${a?.name ?? icao} in the finder`}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

function PlaceLinks({ side, icao, a, onPlace, placeHref }: { side: Side; icao: string; a: Airport | undefined; onPlace?: Props["onPlace"]; placeHref?: Props["placeHref"] }) {
  const code = a?.iata ?? icao;
  return (
    <span className="rh-links">
      {placeHref && (
        <Link className="linkish" href={placeHref(icao)}>
          Flights from {code} →
        </Link>
      )}
      {onPlace && (
        <button type="button" className="linkish" onClick={() => onPlace(side, icao)}>
          {side === "dep" ? `Flights from ${code} →` : `Flights to ${code} →`}
        </button>
      )}
    </span>
  );
}

function LinkRow({ f, from, to, onPlace, placeHref }: Pick<Props, "f" | "from" | "to" | "onPlace" | "placeHref">) {
  if (!onPlace && !placeHref) return null;
  return (
    <div className="rh-linkrow">
      <PlaceLinks side="dep" icao={f.o} a={from} onPlace={onPlace} placeHref={placeHref} />
      <PlaceLinks side="arr" icao={f.d} a={to} onPlace={onPlace} placeHref={placeHref} />
    </div>
  );
}

const PLANE = "M0-9 1.6-3.2 9 1.6V3.6L1.6 1.4 1.2 6.2 3.6 8V9.6L0 8.6-3.6 9.6V8L-1.2 6.2-1.6 1.4-9 3.6V1.6L-1.6-3.2Z";
/** The dotted line between the two ends, with the aircraft on it. */
const Line = () => (
  <span className="bp-ln" aria-hidden="true">
    <svg width="18" height="18" viewBox="-10 -10 20 20">
      <path d={PLANE} />
    </svg>
  </span>
);
const nmText = (nm: number | null) => (nm != null ? `${nm.toLocaleString("en-GB")} NM` : "—");

const label = (k: "OUT" | "OFF" | "ON" | "IN") => (
  <Tip tip={GLOSSARY[k.toLowerCase() as "out" | "off" | "on" | "in"]} title={k} plain>
    <small className="rh-k">{k}</small>
  </Tip>
);
/** "OUT · scheduled": which kind of time the headline is. An estimate says so with its badge instead. */
const fieldLabel = (k: "OUT" | "IN", m: Moment | null): ReactNode => (
  <span className="bp-k">
    {label(k)}
    {m && m.kind !== "est" && <small className="rh-k"> · {m.kind === "sched" ? "scheduled" : "typical"}</small>}
  </span>
);

/* ---------- "track" (default) and "side": code flaps at both ends, the headline OUT and IN ---------- */

function Codes({ f, from, to, blockMin, nm, onPlace, placeHref, t, track }: WithTimes & { track: boolean }) {
  return (
    <div className={`rh bp-front ${track ? "bp-f-track" : "bp-f-side"}`}>
      <div className="rh-ends">
        <div className="fcard-end dep">
          <span className="ctl-label">From</span>
          <Place a={from} icao={f.o} placeHref={placeHref} guess={guessedEnd(f, "o") ? "o" : undefined} />
          <p className="rh-ap">{from?.name}</p>
        </div>
        <div className="rh-mid" aria-hidden="true">
          <span className="mono">{dur(blockMin) ?? "—"}</span>
          <Line />
          <span className="mono">{nmText(nm)}</span>
        </div>
        <div className="fcard-end arr">
          <span className="ctl-label">To</span>
          <Place a={to} icao={f.d} placeHref={placeHref} align="r" guess={guessedEnd(f, "d") ? "d" : undefined} />
          <p className="rh-ap">{to?.name}</p>
        </div>
      </div>
      <p className="rh-mid-inline mono" aria-hidden="true">
        {dur(blockMin) ?? "—"} · {nmText(nm)}
      </p>
      <div className="bp-fields">
        <div>
          {fieldLabel("OUT", t.out)}
          <Z m={t.out} big />
          <i className="mono">{local(t.out, from)}</i>
        </div>
        <div className="r">
          {fieldLabel("IN", t.in)}
          <Z m={t.in} big />
          <i className="mono">{local(t.in, to)}</i>
        </div>
      </div>
      {track && <Track f={f} t={t} blockMin={blockMin} />}
      <LinkRow f={f} from={from} to={to} onPlace={onPlace} placeHref={placeHref} />
    </div>
  );
}

/**
 * What the track shows. With a published schedule and tracked times, the headline is the schedule
 * and the track is how the flight really runs (typical OUT · OFF · ON · IN), so a flight that
 * usually leaves late shows it. Without a schedule the headline already is the typical OUT and IN,
 * so the track only names OFF and ON.
 */
function trackTimes(f: FlightRow, t: FourTimes, blockMin: number | null) {
  const obs = (v: number | null): Moment | null => (v == null ? null : { t: wrap(v), kind: "obs" });
  const est = (v: number): Moment => ({ t: wrap(v), kind: "est" });
  const both = f.std != null && f.out != null;
  if (!both) return { out: t.out, off: t.off, on: t.on, in: t.in, ends: false, late: null };
  // every time on the track follows the typical OUT, never the schedule: a missing ON / IN is
  // estimated from the tracked ON, else the typical OUT plus block time (an EST. badge shows it)
  const out = obs(f.out)!;
  const off = obs(f.off) ?? est(out.t + TAXI_OUT);
  const inn = obs(f.in) ?? (f.on != null ? est(f.on + TAXI_IN) : blockMin != null ? est(out.t + blockMin) : null);
  const on = obs(f.on) ?? (inn ? est(inn.t - TAXI_IN) : null);
  const late = ((f.out! - f.std! + 720 + 1440) % 1440) - 720;
  return { out, off, on, in: inn, ends: true, late };
}

function Track({ f, t, blockMin }: { f: FlightRow; t: FourTimes; blockMin: number | null }) {
  const tr = trackTimes(f, t, blockMin);
  // place OFF and ON along the track by their real share of the block (clamped so labels fit)
  const span = tr.out && tr.in ? (tr.in.t - tr.out.t + 1440) % 1440 || 1 : null;
  const share = (a: Moment | null, b: Moment | null) => (span && a && b ? Math.min(24, Math.max(7, (((b.t - a.t + 1440) % 1440) / span) * 100)) : 9);
  const offPos = share(tr.out, tr.off);
  const onPos = 100 - share(tr.on, tr.in);
  const dot = (m: Moment | null, left: number) => <i className={`rh-dot${!m ? " none" : m.kind === "est" ? " est" : ""}`} style={{ left: `${left}%` }} />;
  const day = f.day && varies(f) ? ` ${DAY_NAMES[f.day - 1]}` : "";
  const usual = tr.late == null ? null : Math.abs(tr.late) < 1 ? "usually on time" : `usually ${tr.late > 0 ? "+" : "−"}${Math.abs(tr.late)} min off-block`;
  return (
    <div className="bp-trk" role="group" aria-label={tr.ends ? "Typical OUT, OFF, ON and IN times" : "OFF and ON times"}>
      {tr.ends && (
        <p className="bp-trk-cap">
          Typical{day} · {usual}
        </p>
      )}
      <div className="rh-ticks top">
        <span style={{ left: `${offPos}%` }}>
          <Z m={tr.off} />
          {label("OFF")}
        </span>
        <span style={{ left: `${onPos}%` }}>
          <Z m={tr.on} />
          {label("ON")}
        </span>
      </div>
      <div className="rh-track" aria-hidden="true">
        <span className="rh-line" />
        <span className="rh-air" style={{ left: `${offPos}%`, right: `${100 - onPos}%` }} />
        {dot(tr.out, 0)}
        {dot(tr.off, offPos)}
        {dot(tr.on, onPos)}
        {dot(tr.in, 100)}
      </div>
      {tr.ends && (
        <div className="rh-ticks">
          <span className="l">
            {label("OUT")}
            <Z m={tr.out} />
          </span>
          <span className="r">
            {label("IN")}
            <Z m={tr.in} />
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------- "city": the city names first, local time leading with Z beside it ---------- */

function City({ f, from, to, blockMin, nm, onPlace, placeHref, t }: WithTimes) {
  const end = (side: Side, a: Airport | undefined, icao: string, m: Moment | null) => {
    const name = <b className="bp-cname">{a ? city(a, icao) : icao}</b>;
    const g = guessedEnd(f, side === "dep" ? "o" : "d");
    return (
      <div className={`fcard-end ${side}`}>
        <span className="ctl-label">{side === "dep" ? "From" : "To"}</span>
        <p className="fcard-place bp-cline">
          {placeHref ? (
            <Link className="fcard-placelink" href={placeHref(icao)} title={`Flights from ${a?.name ?? icao} in the finder`}>
              {name}
            </Link>
          ) : (
            name
          )}
          {g && <GuessMark side={side === "dep" ? "o" : "d"} name={city(a, icao)} />}
        </p>
        <p className="bp-codes">
          {a?.country && <Flag cc={a.country} />}
          <span className="mono">{[icao, a?.iata].filter(Boolean).join(" · ")}</span>
          {a && a.name !== city(a, icao) && <span className="bp-apname">{a.name}</span>}
        </p>
        <div className="bp-lt">
          <span className="ctl-label">{side === "dep" ? "Departs" : "Arrives"}</span>
          {m ? (
            <span className="rh-z">
              <span className={`mono bp-ltime${m.kind === "obs" ? " obs" : ""}`} title={`${KIND[m.kind]}${a?.tz ? ", local time" : ""}`}>
                {a?.tz ? localHHMM(m.t, a.tz) : `${hhmm(m.t)}Z`}
              </span>
              {m.kind === "est" && <Est />}
            </span>
          ) : (
            <span className="mono muted bp-ltime">—</span>
          )}
          <i className="mono">{m ? (a?.tz ? `${hhmm(m.t)}Z · ${tzLabel(a.tz)}` : "UTC") : ""}</i>
        </div>
      </div>
    );
  };
  return (
    <div className="rh bp-front bp-f-city">
      <div className="bp-cities">
        {end("dep", from, f.o, t.out)}
        <div className="rh-mid" aria-hidden="true">
          <Line />
          <span className="mono">{dur(blockMin) ?? "—"}</span>
          <span className="mono">{nmText(nm)}</span>
        </div>
        {end("arr", to, f.d, t.in)}
      </div>
      <p className="rh-mid-inline mono" aria-hidden="true">
        {dur(blockMin) ?? "—"} · {nmText(nm)}
      </p>
      <LinkRow f={f} from={from} to={to} onPlace={onPlace} placeHref={placeHref} />
    </div>
  );
}
