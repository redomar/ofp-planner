"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { dur, fourTimes, hhmm, localHHMM, tzLabel, type Moment } from "@/lib/data/flight";
import type { Airport, FlightRow } from "@/lib/data/load";
import { useDisplay, type RouteHeadStyle } from "@/lib/display";
import { GLOSSARY } from "@/lib/glossary";
import { ReplayFlapCode } from "./FlapCode";
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
 * The flight card's departs / arrives block, in the style chosen in Settings → Display:
 * "timeline" (default: both ends, then the OUT · OFF · ON · IN track), "pass" (boarding pass)
 * or "board" (split-flap departure board). Times that aren't scheduled or tracked are estimated
 * and carry an EST. badge.
 */
export function RouteHead(p: Props & { style?: RouteHeadStyle }) {
  const d = useDisplay();
  const routeHead = p.style ?? d.routeHead;
  const t = fourTimes(p.f, p.blockMin);
  if (routeHead === "pass") return <Pass {...p} t={t} />;
  if (routeHead === "board") return <Board {...p} t={t} />;
  return <Timeline {...p} t={t} />;
}

type WithTimes = Props & { t: ReturnType<typeof fourTimes> };

const city = (a: Airport | undefined, icao: string) => a?.city ?? a?.name ?? icao;
const codeLabel = (a: Airport | undefined, icao: string) => (a ? `${icao}, ${a.name}` : icao);

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
      <span className={`mono${big ? " rh-big" : ""}${m.kind === "obs" ? " obs" : ""}`} title={m.kind === "obs" ? "Typical time from tracked flights" : m.kind === "sched" ? "Scheduled" : "Estimated"}>
        {hhmm(m.t)}Z
      </span>
      {m.kind === "est" && <Est />}
    </span>
  );
}
const local = (m: Moment | null, a: Airport | undefined) => (m && a?.tz ? `${localHHMM(m.t, a.tz)} LT · ${tzLabel(a.tz)}` : null);

/** Code flaps + city line, linked to the finder on the brief. */
function Place({ a, icao, size, placeHref, align }: { a: Airport | undefined; icao: string; size?: "s"; placeHref?: Props["placeHref"]; align?: "r" }) {
  const inner = (
    <>
      <span className={`code-flap${size ? " s" : ""}`}>
        <ReplayFlapCode code={icao} label={codeLabel(a, icao)} />
      </span>
      <p className={`fcard-place rh-city${align ? " r" : ""}`}>
        {a?.country && <Flag cc={a.country} />}
        <b>{a ? city(a, icao) : <V v={null} w={8} />}</b>
        {a?.iata && <span className="mono muted">{a.iata}</span>}
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

function Mid({ blockMin, nm, plane }: { blockMin: number | null; nm: number | null; plane?: boolean }) {
  return (
    <div className="rh-mid" aria-hidden="true">
      <span className="mono">{dur(blockMin) ?? "—"}</span>
      {plane ? (
        <svg width="18" height="18" viewBox="-10 -10 20 20" className="rh-plane">
          <path d="M0-9 1.6-3.2 9 1.6V3.6L1.6 1.4 1.2 6.2 3.6 8V9.6L0 8.6-3.6 9.6V8L-1.2 6.2-1.6 1.4-9 3.6V1.6L-1.6-3.2Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="rh-arrow">
          <path d="M2 5H98" />
          <path d="M92 1l6 4-6 4" />
        </svg>
      )}
      <span className="mono">{nm != null ? `${nm.toLocaleString("en-GB")} NM` : "—"}</span>
    </div>
  );
}

const label = (k: "OUT" | "OFF" | "ON" | "IN") => (
  <Tip tip={GLOSSARY[k.toLowerCase() as "out" | "off" | "on" | "in"]} title={k} plain>
    <small className="rh-k">{k}</small>
  </Tip>
);

/* ---------- R7: tidy columns + OUT · OFF · ON · IN track (default) ---------- */

function Timeline({ f, from, to, blockMin, nm, onPlace, placeHref, t }: WithTimes) {
  // place OFF and ON along the track by their real share of the block (clamped so labels fit)
  const span = t.out && t.in ? (t.in.t - t.out.t + 1440) % 1440 || 1 : null;
  const pos = (m: Moment | null, fallback: number) => (span && m && t.out ? Math.min(24, Math.max(7, (((m.t - t.out.t + 1440) % 1440) / span) * 100)) : fallback);
  const offPos = pos(t.off, 9);
  const onPos = 100 - (span && t.on && t.in ? Math.min(24, Math.max(7, (((t.in.t - t.on.t + 1440) % 1440) / span) * 100)) : 9);
  const dot = (m: Moment | null, left: number) => <i className={`rh-dot${!m ? " none" : m.kind === "est" ? " est" : ""}`} style={{ left: `${left}%` }} />;
  return (
    <div className="rh rh-timeline">
      <div className="rh-ends">
        <div className="fcard-end dep">
          <span className="ctl-label">Departs</span>
          <Place a={from} icao={f.o} placeHref={placeHref} />
          <p className="rh-ap">{from?.name}</p>
        </div>
        <Mid blockMin={blockMin} nm={nm} />
        <div className="fcard-end arr">
          <span className="ctl-label">Arrives</span>
          <Place a={to} icao={f.d} placeHref={placeHref} align="r" />
          <p className="rh-ap">{to?.name}</p>
        </div>
      </div>
      <p className="rh-mid-inline mono" aria-hidden="true">
        {dur(blockMin) ?? "—"} · {nm != null ? `${nm.toLocaleString("en-GB")} NM` : "—"}
      </p>
      <div className="rh-track-wrap" role="group" aria-label="OUT, OFF, ON and IN times">
        <div className="rh-ticks top">
          <span style={{ left: `${offPos}%` }}>
            <Z m={t.off} />
            {label("OFF")}
          </span>
          <span style={{ left: `${onPos}%` }}>
            <Z m={t.on} />
            {label("ON")}
          </span>
        </div>
        <div className="rh-track" aria-hidden="true">
          <span className="rh-line" />
          <span className="rh-air" style={{ left: `${offPos}%`, right: `${100 - onPos}%` }} />
          {dot(t.out, 0)}
          {dot(t.off, offPos)}
          {dot(t.on, onPos)}
          {dot(t.in, 100)}
        </div>
        <div className="rh-ticks">
          <span className="l">
            {label("OUT")}
            <Z m={t.out} big />
            <i className="mono">{local(t.out, from)}</i>
          </span>
          <span className="r">
            {label("IN")}
            <Z m={t.in} big />
            <i className="mono">{local(t.in, to)}</i>
          </span>
        </div>
      </div>
      <div className="rh-linkrow">
        <PlaceLinks side="dep" icao={f.o} a={from} onPlace={onPlace} placeHref={placeHref} />
        <PlaceLinks side="arr" icao={f.d} a={to} onPlace={onPlace} placeHref={placeHref} />
      </div>
    </div>
  );
}

/* ---------- R2: boarding pass ---------- */

function Pass({ f, from, to, blockMin, nm, onPlace, placeHref, t }: WithTimes) {
  return (
    <div className="rh">
      <div className="rh-pass">
        <div className="fcard-end dep stub">
          <span className="ctl-label">From</span>
          <Place a={from} icao={f.o} placeHref={placeHref} />
          <p className="rh-ap">{from?.name}</p>
        </div>
        <div className="perf">
          <Mid blockMin={blockMin} nm={nm} plane />
        </div>
        <div className="fcard-end arr stub">
          <span className="ctl-label">To</span>
          <Place a={to} icao={f.d} placeHref={placeHref} align="r" />
          <p className="rh-ap">{to?.name}</p>
        </div>
        <div className="strip">
          <span>
            {label("OUT")}
            <Z m={t.out} big />
            <i className="mono">{local(t.out, from)}</i>
          </span>
          <span className="pass-mid mono">
            <span className="rh-mid-inline">
              {dur(blockMin) ?? "—"} · {nm != null ? `${nm.toLocaleString("en-GB")} NM` : "—"} ·{" "}
            </span>
            {label("OFF")} <Z m={t.off} /> · {label("ON")} <Z m={t.on} />
          </span>
          <span className="r">
            {label("IN")}
            <Z m={t.in} big />
            <i className="mono">{local(t.in, to)}</i>
          </span>
        </div>
      </div>
      <div className="rh-linkrow">
        <PlaceLinks side="dep" icao={f.o} a={from} onPlace={onPlace} placeHref={placeHref} />
        <PlaceLinks side="arr" icao={f.d} a={to} onPlace={onPlace} placeHref={placeHref} />
      </div>
    </div>
  );
}

/* ---------- R5: split-flap departure board (light by day, dark at night) ---------- */

function Board({ f, from, to, blockMin, nm, onPlace, placeHref, t }: WithTimes) {
  const row = (side: Side, a: Airport | undefined, icao: string, m: Moment | null, kind: "OUT" | "IN"): ReactNode => (
    <div className={`fcard-end ${side} brow`}>
      <span className="ctl-label">{side === "dep" ? "Dep" : "Arr"}</span>
      <span className="time-flap" title={kind === "OUT" ? GLOSSARY.out : GLOSSARY.in}>
        {m ? <ReplayFlapCode code={hhmm(m.t)!.replace(":", "")} label={`${kind} ${hhmm(m.t)} UTC${m.kind === "est" ? ", estimated" : ""}`} /> : <span className="mono muted">— —</span>}
      </span>
      <span className="code-flap">
        <ReplayFlapCode code={icao} label={codeLabel(a, icao)} />
      </span>
      <span className="bcity">
        {a?.country && <Flag cc={a.country} />}
        {placeHref ? (
          <Link className="fcard-placelink" href={placeHref(icao)}>
            <b>{city(a, icao).toUpperCase()}</b>
          </Link>
        ) : (
          <b>{city(a, icao).toUpperCase()}</b>
        )}
        {m?.kind === "est" && <Est />}
      </span>
    </div>
  );
  return (
    <div className="rh">
      <div className="rh-board">
        {row("dep", from, f.o, t.out, "OUT")}
        {row("arr", to, f.d, t.in, "IN")}
        <p className="meta mono">
          {dur(blockMin) ?? "—"} · {nm != null ? `${nm.toLocaleString("en-GB")} NM` : "—"} · times UTC (OUT / IN)
          {t.out && from?.tz && t.in && to?.tz && ` · ${localHHMM(t.out.t, from.tz)} → ${localHHMM(t.in.t, to.tz)} local`}
        </p>
      </div>
      <div className="rh-linkrow">
        <PlaceLinks side="dep" icao={f.o} a={from} onPlace={onPlace} placeHref={placeHref} />
        <PlaceLinks side="arr" icao={f.d} a={to} onPlace={onPlace} placeHref={placeHref} />
      </div>
    </div>
  );
}
