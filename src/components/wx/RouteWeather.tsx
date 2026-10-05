"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Tip, V } from "@/components/ui";
import { WindArrow } from "@/components/WindArrow";
import { advice, CAT_RANK, fcstLine, hazards, headline, summary, tokenClass } from "@/lib/wx/brief";
import { CATEGORY_TIP, CATEGORY_TONE, compass, wmoText, type Category } from "@/lib/wx/category";
import { fetchForecast, hourAt, nearestHour, type Forecast, type Hour } from "@/lib/wx/forecast";
import { deg3, localTime, relative, round, vis, zulu, zuluDay } from "@/lib/wx/format";
import { decodeMetar, fetchMetar, type Metar } from "@/lib/wx/metar";
import { Scene } from "./Scene";

export interface WxPoint {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  elevFt: number | null;
  tz: string | null;
}

type Load<T> = { state: "loading" } | { state: "ok"; data: T; at: number } | { state: "error"; message: string };

interface AirportState {
  fc: Load<Forecast>;
  metar: Load<string | null>;
}

const LOADING: AirportState = { fc: { state: "loading" }, metar: { state: "loading" } };

const errText = (e: unknown) =>
  e instanceof DOMException && e.name === "AbortError" ? null : e instanceof TypeError ? "Couldn't reach the weather service (offline?)." : e instanceof Error ? e.message : "Something went wrong.";

/**
 * Weather for a planned flight: forecast at departure and arrival (Open-Meteo) and the
 * current METAR at each end (VATSIM). Fetches once on mount; cached in localStorage
 * (forecast 60 min, METAR 10 min). "Refresh" re-reads the cache unless it's expired,
 * and a second click within a minute forces a refetch.
 */
export function RouteWeather({
  origin,
  dest,
  dep,
  arr,
  flightLabel,
}: {
  origin: WxPoint;
  dest: WxPoint;
  dep: Date | null;
  arr: Date | null;
  /** Shown on the flight bar in the trip strip, e.g. "EZY96ME · 1h 54m". */
  flightLabel?: string;
}) {
  const [wx, setWx] = useState<Record<string, AirportState>>({});
  const lastRefresh = useRef(0);
  const ctl = useRef<AbortController | null>(null);

  const load = useCallback(
    (force: boolean) => {
      ctl.current?.abort();
      const c = new AbortController();
      ctl.current = c;
      const pts = origin.icao === dest.icao ? [origin] : [origin, dest];
      const patch = (icao: string, p: Partial<AirportState>) => {
        if (c.signal.aborted) return;
        setWx((w) => ({ ...w, [icao]: { ...(w[icao] ?? LOADING), ...p } }));
      };
      for (const p of pts) {
        fetchForecast(p.icao, p.lat, p.lon, { force, signal: c.signal }).then(
          (r) => patch(p.icao, { fc: { state: "ok", ...r } }),
          (e) => {
            const m = errText(e);
            if (m) patch(p.icao, { fc: { state: "error", message: m } });
          },
        );
        fetchMetar(p.icao, { force, signal: c.signal }).then(
          (r) => patch(p.icao, { metar: { state: "ok", ...r } }),
          (e) => {
            const m = errText(e);
            if (m) patch(p.icao, { metar: { state: "error", message: m } });
          },
        );
      }
    },
    [origin, dest],
  );

  // Fetch once per airport pair (not on every re-render or time change).
  const pairKey = `${origin.icao}|${origin.lat}|${origin.lon}|${dest.icao}|${dest.lat}|${dest.lon}`;
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    loadRef.current(false);
    return () => ctl.current?.abort();
  }, [pairKey]);

  const refresh = () => {
    const now = Date.now();
    const force = now - lastRefresh.current < 60_000;
    lastRefresh.current = now;
    setWx({});
    load(force);
  };

  const fetched = Object.values(wx)
    .flatMap((a) => [a.fc, a.metar])
    .filter((l): l is { state: "ok"; data: never; at: number } => l.state === "ok")
    .map((l) => l.at);
  const oldest = fetched.length ? Math.min(...fetched) : null;

  const [now] = useState(() => Date.now());
  const ends = [
    { role: "Departure" as const, kind: "OUT", p: origin, at: dep, s: wx[origin.icao] ?? LOADING },
    { role: "Arrival" as const, kind: "IN", p: dest, at: arr, s: wx[dest.icao] ?? LOADING },
  ].map((e) => ({ ...e, ...resolve(e.s, e.at, now) }));
  const [d, a] = ends;
  const loading = ends.some((e) => e.s.fc.state === "loading");

  return (
    <div className="wx" aria-busy={loading || undefined}>
      <div className="wx-bar">
        <p className="wx-src">
          Forecast{" "}
          <a href="https://open-meteo.com/" rel="noopener noreferrer" target="_blank">
            Open-Meteo
          </a>{" "}
          · METAR{" "}
          <a href="https://metar.vatsim.net/" rel="noopener noreferrer" target="_blank">
            VATSIM
          </a>
          <span className="wx-age">{oldest != null ? ` · fetched ${relative(oldest)}` : " · fetching…"}</span>
        </p>
        <button type="button" className="btn wx-refresh" onClick={refresh} title="Uses the cache while it's fresh; click twice to force a new fetch">
          Refresh
        </button>
      </div>

      {/* split verdict: one half per end, coloured by its flight category */}
      <div className="wb-verdict">
        {ends.map((e) => (
          <div key={e.role} className={`wb-half t-${e.h?.category ? CATEGORY_TONE[e.h.category] : "ink"}`}>
            <b className="wb-k">
              {e.role === "Departure" ? "DEP" : "ARR"} {e.p.icao} · {e.kind} {e.at ? zulu(e.at.getTime()) : "now"}
            </b>
            {e.error ? (
              <span className="wx-err-inline">Forecast unavailable</span>
            ) : (
              <>
                {catBadge(e.h?.category ?? null, true)}
                <span>{e.h ? summary(e.h) : <V v={null} w={22} />}</span>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="wb-advice">
        {loading ? <V v={null} w={40} /> : advice({ icao: d.p.icao, h: d.h, fc: d.fc, at: d.at?.getTime() ?? null }, { icao: a.p.icao, h: a.h })}
      </p>
      {ends.some((e) => e.note) && (
        <ul className="wx-notes">
          {ends.map((e) => e.note && <li key={e.role}>{`${e.p.icao}: ${e.note}`}</li>)}
        </ul>
      )}

      <div className="wb-two">
        {ends.map((e) => (
          <EndPanel key={e.role} e={e} onRetry={() => load(true)} />
        ))}
      </div>

      <TripStrip d={d} a={a} label={flightLabel} />

      <Coded ends={ends} />

      <details className="wtoggle">
        <summary>
          <span className="wt-open">▸ Compare departure and arrival side by side</span>
          <span className="wt-close">▾ Hide the comparison table</span>
          <span className="muted"> · 10 rows</span>
        </summary>
        <Compare d={d} a={a} />
      </details>
    </div>
  );
}

type End = {
  role: "Departure" | "Arrival";
  kind: string;
  p: WxPoint;
  at: Date | null;
  s: AirportState;
  fc: Forecast | null;
  h: Hour | null;
  note: string | null;
  error: string | null;
  metar: Metar | null;
};

/** The forecast hour for the planned time (or why there isn't one) and the decoded METAR. */
function resolve(s: AirportState, at: Date | null, now: number) {
  const target = at?.getTime() ?? now;
  let h: Hour | null = null;
  let fc: Forecast | null = null;
  let note: string | null = at ? null : "No planned time, so this shows the forecast for now.";
  if (s.fc.state === "ok") {
    fc = s.fc.data;
    const n = nearestHour(fc, target);
    if (n) {
      h = hourAt(fc, n.i);
      if (n.outside === "after") note = `The planned time is beyond the 16-day forecast; showing the last hour (${zuluDay(h.t)} ${zulu(h.t)}).`;
      else if (n.outside === "before") note = `The planned time has passed; showing the earliest hour available (${zuluDay(h.t)} ${zulu(h.t)}).`;
      else if (at && target < now - 3600_000) note = "The planned time has passed; the forecast for that hour is shown, and the METAR is current.";
    }
  }
  const metar = s.metar.state === "ok" && s.metar.data ? decodeMetar(s.metar.data) : null;
  return { fc, h, note, error: s.fc.state === "error" ? s.fc.message : null, metar };
}

function catBadge(c: Category | null, estimated: boolean) {
  if (!c) return <V v={null} w={4} />;
  return (
    <Badge tone={CATEGORY_TONE[c]} tip={CATEGORY_TIP[c] + (estimated ? " Ceiling is estimated from the forecast (no cloud base in model data)." : "")}>
      {c}
    </Badge>
  );
}

const localHour = (ms: number | null, tz: string | null) => {
  const t = localTime(ms, tz);
  return t ? Number(t.slice(0, 2)) + Number(t.slice(3, 5)) / 60 : null;
};

function EndPanel({ e, onRetry }: { e: End; onRetry: () => void }) {
  const h = e.h;
  const planned = e.at?.getTime() ?? null;
  const z = planned != null ? `${zulu(planned)}` : "now";
  const gust = h?.gustKt != null && h.windKt != null && h.gustKt >= h.windKt + 8 ? h.gustKt : null;
  const spread = h?.temp != null && h.dew != null ? h.temp - h.dew : null;
  return (
    <figure className="wb-end" aria-label={`${e.role} weather, ${e.p.icao}`}>
      {e.error ? (
        <p className="wx-err" role="status">
          Forecast unavailable: {e.error}{" "}
          <button type="button" className="chip-btn" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : (
        <Scene h={h} icao={e.p.icao} z={z} headline={h ? headline(h) : "Loading forecast…"} elevFt={e.p.elevFt} localHour={localHour(planned ?? e.h?.t ?? null, e.p.tz)} />
      )}
      <figcaption>
        <p className="wb-haz">
          {catBadge(h?.category ?? null, true)}
          {hazards(h).map((z2) => (
            <Badge key={z2.label} tone={z2.tone} tip={z2.note}>
              {z2.label}
            </Badge>
          ))}
        </p>
        <dl className="wb-facts">
          <div>
            <dt>
              <Tip tip="Forecast wind at 10 m for the planned hour. The arrow points downwind and sways like a windsock: faster with more wind, unsteady with gusts; its colour is the wind category." title="Wind">
                Wind
              </Tip>
            </dt>
            <dd>
              {h?.windKt != null ? (
                <>
                  {h.windDir != null && h.windKt >= 1 && (
                    <WindArrow dir={Math.round(h.windDir)} spd={Math.round(h.windKt)} gust={gust != null ? Math.round(gust) : null} kind="PWIND" size={26} label={`Wind from ${deg3(h.windDir)}° at ${Math.round(h.windKt)} kt`} />
                  )}
                  <span className="mono">{h.windKt < 1 ? "Calm" : `${deg3(h.windDir)}° ${Math.round(h.windKt)} kt`}</span>
                  {gust != null && <small>gust {Math.round(gust)} kt</small>}
                  {h.windDir != null && h.windKt >= 1 && <small>from {compass(h.windDir)}</small>}
                </>
              ) : (
                <V v={null} w={9} />
              )}
            </dd>
          </div>
          <div>
            <dt>
              <Tip tip="Forecast horizontal visibility near the surface; the bar runs from 100 m (red) to 10 km (green)." title="Visibility">
                Visibility
              </Tip>
            </dt>
            <dd>
              <span className="mono">{h ? vis(h.visM) : <V v={null} w={6} />}</span>
              <VisBar m={h?.visM ?? null} />
            </dd>
          </div>
          <div>
            <dt>
              <Tip tip="Air temperature and dew point at 2 m. A spread under 3 °C means mist, fog or low cloud is likely." title="Temp / dew">
                Temp / dew
              </Tip>
            </dt>
            <dd>
              <span className="mono">{h?.temp != null ? `${round(h.temp)}° / ${round(h.dew) ?? "—"}°` : <V v={null} w={8} />}</span>
              {spread != null && <small>spread {Math.round(spread)}°{spread < 1.5 ? " · fog risk" : ""}</small>}
            </dd>
          </div>
          <div>
            <dt>
              <Tip tip="Mean sea-level pressure; set it on the altimeter for departure / arrival." title="QNH">
                QNH
              </Tip>
            </dt>
            <dd>
              <span className="mono">{h?.qnh != null ? `${Math.round(h.qnh)} hPa` : <V v={null} w={8} />}</span>
              {h?.qnh != null && <small>{(h.qnh * 0.02953).toFixed(2)} inHg</small>}
            </dd>
          </div>
        </dl>
      </figcaption>
    </figure>
  );
}

function VisBar({ m }: { m: number | null }) {
  if (m == null) return null;
  const p = Math.max(0, Math.min(100, ((Math.log10(Math.max(100, m)) - 2) / 2) * 100));
  return (
    <span className="wb-visbar" aria-hidden="true">
      <i style={{ left: `${p}%` }} />
    </span>
  );
}

/** Both airports on one UTC clock, an hourly block per flight category, the flight between OUT and IN. */
function TripStrip({ d, a, label }: { d: End; a: End; label?: string }) {
  const dep = d.at?.getTime() ?? null;
  const arr = a.at?.getTime() ?? null;
  if (!d.fc || !a.fc || dep == null) return null;
  // the departure's UTC day, or a 24 h window from 8 h before departure when the flight runs past midnight
  const dayStart = Date.UTC(new Date(dep).getUTCFullYear(), new Date(dep).getUTCMonth(), new Date(dep).getUTCDate());
  const start = arr != null && arr > dayStart + 86_400_000 ? Math.floor((dep - 8 * 3600_000) / 3600_000) * 3600_000 : dayStart;
  const hoursOf = (fc: Forecast) =>
    Array.from({ length: 24 }, (_, k) => {
      const t = (start + k * 3600_000) / 1000;
      const i = fc.time.indexOf(t);
      return i >= 0 ? hourAt(fc, i) : null;
    });
  const x = (ms: number) => Math.max(0, Math.min(100, ((ms - start) / 86_400_000) * 100));
  const rows: [End, (Hour | null)[], number | null, string, boolean][] = [
    [d, hoursOf(d.fc), dep, "OUT", false],
    [a, hoursOf(a.fc), arr, "IN", true],
  ];
  const dayLabel = new Date(start).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const block = (r: [End, (Hour | null)[], number | null, string, boolean]) => (
    <div className="wb-tl-row" key={r[0].role}>
      <span className="wb-tl-lbl mono">{r[0].p.icao}</span>
      <span className="wb-tl-bar">
        {r[1].map((h, i) => (
          <i
            key={i}
            className={h?.category ? `c-${CATEGORY_TONE[h.category]}` : "c-none"}
            title={`${String(new Date(start + i * 3600_000).getUTCHours()).padStart(2, "0")}Z ${h?.category ?? "no data"}`}
          />
        ))}
        {r[2] != null && (
          <span className={`wb-tl-mark${r[4] ? " below" : ""}`} style={{ left: `${x(r[2])}%` }}>
            <b className="mono">
              {r[3]} {zulu(r[2])}
            </b>
          </span>
        )}
      </span>
    </div>
  );
  return (
    <div className="wb-tl" role="img" aria-label={`Flight category by hour at ${d.p.icao} and ${a.p.icao}, ${dayLabel}, with the flight from ${zulu(dep)} to ${arr != null ? zulu(arr) : "unknown"}.`}>
      <p className="wb-tl-h field-label">
        <Tip tip="Each block is one hour (UTC), coloured by the forecast flight category; the magenta bar is the flight. See how flying earlier or later changes the weather." title="Trip strip">
          Through the day
        </Tip>
      </p>
      {block(rows[0])}
      <div className="wb-tl-row">
        <span className="wb-tl-lbl muted small">flight</span>
        <span className="wb-tl-bar air">
          {arr != null && <span className="wb-tl-flight" style={{ left: `${x(dep)}%`, width: `${Math.max(0.8, x(arr) - x(dep))}%` }} />}
          {label && arr != null && (
            <span className="wb-tl-flab" style={x(arr) > 70 ? { right: `${100 - x(dep) + 1}%` } : { left: `${x(arr) + 1}%` }}>
              {label}
            </span>
          )}
        </span>
      </div>
      {block(rows[1])}
      <div className="wb-tl-row axis">
        <span />
        <span className="wb-tl-axis mono">
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((k) => (
            <span key={k} style={{ left: `${(k / 24) * 100}%` }}>
              {String(new Date(start + k * 3600_000).getUTCHours()).padStart(2, "0")}
            </span>
          ))}
        </span>
      </div>
      <p className="wb-tl-key small muted">
        {(["VFR", "MVFR", "IFR", "LIFR"] as const).map((c) => (
          <Fragment key={c}>
            <i className={`c-${CATEGORY_TONE[c]}`} aria-hidden="true" />
            {c}{" "}
          </Fragment>
        ))}
        · one block per hour, UTC, {dayLabel}
      </p>
    </div>
  );
}

const colour = (line: string): ReactNode[] =>
  line.split(" ").flatMap((t, i) => {
    const c = tokenClass(t);
    return [i ? " " : "", c ? <span key={i} className={c}>{t}</span> : t];
  });

/** The forecast coded like a METAR (FCST, estimated) above the real METAR, on printer paper. */
function Coded({ ends }: { ends: End[] }) {
  const [copied, setCopied] = useState(false);
  const lines = ends.map((e) => ({
    e,
    fcst: e.h && e.at ? fcstLine(e.p.icao, e.h, e.at.getTime()) : null,
    metar: e.s.metar.state === "ok" && e.s.metar.data ? `METAR ${e.p.icao} ${e.s.metar.data}` : null,
  }));
  const text = lines.map((l) => [`${l.e.role.toUpperCase()} ${l.e.p.icao} ${l.e.p.name.toUpperCase()}`, l.fcst, l.metar].filter(Boolean).join("\n")).join("\n\n");
  return (
    <figure className="wb-print" aria-label="Forecast and METAR, printed">
      <span className="wb-feed left" aria-hidden="true" />
      <div className="wb-paper">
        {lines.flatMap((l, i) => [
          ...(i ? [<span className="pp-line" key={`gap${i}`} />] : []),
          <span className="pp-line pp-h" key={`h${i}`}>
            {l.e.role.toUpperCase()} {l.e.p.icao} {l.e.p.name.toUpperCase()}
          </span>,
          <span className="pp-line" key={`f${i}`}>
            <Tip tip="The model forecast for the planned time, coded like a METAR. It's an estimate (cloud base and weather are derived), not an official TAF." title="FCST" plain>
              <span className="pp-k">FCST</span>
            </Tip>
            {l.fcst ? colour(l.fcst.replace(/^FCST /, "")) : <V v={null} w={36} />}
          </span>,
          <span className="pp-line" key={`m${i}`}>
            <span className="pp-k">METAR</span>
            {l.metar ? colour(l.metar.replace(/^METAR /, "")) : l.e.s.metar.state === "loading" ? <V v={null} w={36} /> : <span className="pp-none">NO CURRENT METAR</span>}
          </span>,
        ])}
        <span className="pp-line" />
        <span className="pp-line pp-foot">FCST  = MODEL FORECAST AT THE PLANNED TIME (EST.)</span>
        <span className="pp-line pp-foot">
          METAR = LATEST OBSERVATION ·{" "}
          <button
            type="button"
            className="pp-copy"
            onClick={() =>
              navigator.clipboard?.writeText(text).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                },
                () => undefined,
              )
            }
          >
            {copied ? "COPIED" : "COPY TEXT"}
          </button>
        </span>
      </div>
      <span className="wb-feed right" aria-hidden="true" />
    </figure>
  );
}

/** Departure and arrival as two columns of the same rows; the worse value of each pair highlighted. */
function Compare({ d, a }: { d: End; a: End }) {
  const x = d.h;
  const y = a.h;
  const worse = (pa: number | null | undefined, pb: number | null | undefined, higherIsWorse = true): [string, string] => {
    if (pa == null || pb == null || pa === pb) return ["", ""];
    const aw = higherIsWorse ? pa > pb : pa < pb;
    return aw ? ["worse", ""] : ["", "worse"];
  };
  const ceilScore = (h: Hour | null) => (h ? (h.ceilingFt ?? 99999) : null);
  const wind = (h: Hour | null) =>
    h?.windKt != null ? (
      <>
        {h.windDir != null && h.windKt >= 1 && <WindArrow dir={Math.round(h.windDir)} spd={Math.round(h.windKt)} kind="PWIND" size={18} />}
        <span className="mono">{h.windKt < 1 ? "Calm" : `${deg3(h.windDir)}° ${Math.round(h.windKt)} kt`}</span>
      </>
    ) : (
      "—"
    );
  const rows: [string, ReactNode, ReactNode, [string, string]][] = [
    ["Category", catBadge(x?.category ?? null, true), catBadge(y?.category ?? null, true), worse(x?.category ? CAT_RANK[x.category] : null, y?.category ? CAT_RANK[y.category] : null)],
    ["Conditions", wmoText(x?.code ?? null) ?? "—", wmoText(y?.code ?? null) ?? "—", ["", ""]],
    ["Wind", wind(x), wind(y), worse(x?.windKt, y?.windKt)],
    ["Gust", x?.gustKt != null ? `${Math.round(x.gustKt)} kt` : "—", y?.gustKt != null ? `${Math.round(y.gustKt)} kt` : "—", worse(x?.gustKt, y?.gustKt)],
    ["Visibility", vis(x?.visM ?? null) ?? "—", vis(y?.visM ?? null) ?? "—", worse(x?.visM, y?.visM, false)],
    ["Cloud base (est.)", x ? (x.ceilingFt === 0 ? "obscured" : x.ceilingFt != null ? `${x.ceilingFt.toLocaleString("en-GB")} ft` : "none") : "—", y ? (y.ceilingFt === 0 ? "obscured" : y.ceilingFt != null ? `${y.ceilingFt.toLocaleString("en-GB")} ft` : "none") : "—", worse(ceilScore(x), ceilScore(y), false)],
    ["Temp / dew", x?.temp != null ? `${round(x.temp)}° / ${round(x.dew)}°` : "—", y?.temp != null ? `${round(y.temp)}° / ${round(y.dew)}°` : "—", ["", ""]],
    ["QNH", x?.qnh != null ? `${Math.round(x.qnh)} hPa` : "—", y?.qnh != null ? `${Math.round(y.qnh)} hPa` : "—", ["", ""]],
    ["Precip", x?.precipMm != null ? `${x.precipMm.toFixed(1)} mm · ${Math.round(x.precipProb ?? 0)}%` : "—", y?.precipMm != null ? `${y.precipMm.toFixed(1)} mm · ${Math.round(y.precipProb ?? 0)}%` : "—", worse(x?.precipProb, y?.precipProb)],
    ["METAR now", d.metar ? <span className="mono small">{colour(d.metar.raw)}</span> : "—", a.metar ? <span className="mono small">{colour(a.metar.raw)}</span> : "—", ["", ""]],
  ];
  return (
    <div className="tbl-wrap">
      <table className="tbl wb-cmp">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Item</span>
            </th>
            <th scope="col">
              {d.p.icao} · OUT {d.at ? zulu(d.at.getTime()) : "now"}
            </th>
            <th scope="col">
              {a.p.icao} · IN {a.at ? zulu(a.at.getTime()) : "now"}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v1, v2, [w1, w2]]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td className={w1}>{v1}</td>
              <td className={w2}>{v2}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted wb-cmp-note">The worse value of each pair is highlighted.</p>
    </div>
  );
}
