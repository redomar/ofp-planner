"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Field, Tip, V } from "@/components/ui";
import { CATEGORY_TIP, CATEGORY_TONE, compass, wmoSevere, wmoText, type Category } from "@/lib/wx/category";
import { fetchForecast, hourAt, nearestHour, type Forecast, type Hour } from "@/lib/wx/forecast";
import { deg3, localTime, relative, round, vis, zulu, zuluDay } from "@/lib/wx/format";
import { decodeMetar, fetchMetar, weatherText, type Metar } from "@/lib/wx/metar";
import { CloudColumn, WindDial, WxStrip } from "./WxGraphics";

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
export function RouteWeather({ origin, dest, dep, arr }: { origin: WxPoint; dest: WxPoint; dep: Date | null; arr: Date | null }) {
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

  return (
    <div className="wx">
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
      <div className="wx-cards">
        <AirportCard role="Departure" p={origin} at={dep} s={wx[origin.icao] ?? LOADING} onRetry={() => load(true)} />
        <AirportCard role="Arrival" p={dest} at={arr} s={wx[dest.icao] ?? LOADING} onRetry={() => load(true)} />
      </div>
    </div>
  );
}

function catBadge(c: Category | null, estimated: boolean) {
  if (!c) return <V v={null} w={4} />;
  return (
    <Badge tone={CATEGORY_TONE[c]} tip={CATEGORY_TIP[c] + (estimated ? " Ceiling is estimated from the forecast (no cloud base in model data)." : "")}>
      {c}
    </Badge>
  );
}

function AirportCard({ role, p, at, s, onRetry }: { role: "Departure" | "Arrival"; p: WxPoint; at: Date | null; s: AirportState; onRetry: () => void }) {
  const [now] = useState(() => Date.now());
  const target = at?.getTime() ?? now;
  let h: Hour | null = null;
  let strip: (Hour | null)[] = Array.from({ length: 25 }, () => null);
  let note: string | null = at ? null : "No planned time, so this shows the forecast for now.";
  if (s.fc.state === "ok") {
    const fc = s.fc.data;
    const n = nearestHour(fc, target);
    if (n) {
      h = hourAt(fc, n.i);
      strip = Array.from({ length: 25 }, (_, k) => {
        const j = n.i - 12 + k;
        return j >= 0 && j < fc.time.length ? hourAt(fc, j) : null;
      });
      if (n.outside === "after")
        note = `The planned time is beyond the 16-day forecast, so this shows the last forecast hour (${zuluDay(h.t)} ${zulu(h.t)}).`;
      else if (n.outside === "before") note = `The planned time has passed, so this shows the earliest hour available (${zuluDay(h.t)} ${zulu(h.t)}).`;
      else if (at && target < now - 3600_000) note = "The planned time has passed; the forecast for that hour is shown, and the METAR below is current.";
    }
  }
  const loading = s.fc.state === "loading";
  const planned = at ? at.getTime() : null;
  const local = localTime(planned ?? now, p.tz);
  const gust = h?.gustKt != null && h.windKt != null && h.gustKt >= h.windKt + 8 ? h.gustKt : null;
  const desc = wmoText(h?.code ?? null);

  return (
    <article className="wx-card" aria-label={`${role} weather, ${p.icao}`} aria-busy={loading || undefined}>
      <header className="wx-card-head">
        <span className="wx-role">{role}</span>
        <span className="wx-icao">{p.icao}</span>
        <span className="wx-name">{p.name}</span>
        <span className="wx-when">
          {planned != null ? (
            <>
              <span className="mono">
                {zuluDay(planned)} {zulu(planned)}
              </span>
              {local && <span className="wx-local"> · {local} local</span>}
            </>
          ) : (
            <span className="mono">now</span>
          )}
        </span>
      </header>

      {note && <p className="wx-note">{note}</p>}

      {s.fc.state === "error" ? (
        <p className="wx-err" role="status">
          Forecast unavailable: {s.fc.message}{" "}
          <button type="button" className="chip-btn" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : (
        <div className="wx-main">
          <div className="wx-now">
            <WindDial dir={h?.windDir ?? null} kt={h?.windKt ?? null} gust={gust} />
            <div className="wx-wind">
              <span className="wx-wind-v mono">
                {h?.windKt != null ? (
                  <>
                    {deg3(h.windDir)}° {Math.round(h.windKt)} kt{gust ? <span className={gust >= 25 ? "wx-gust strong" : "wx-gust"}> G{Math.round(gust)}</span> : null}
                  </>
                ) : (
                  <V v={null} w={11} />
                )}
              </span>
              <span className="wx-wind-sub">{h?.windDir != null ? `from ${compass(h.windDir)}` : " "}</span>
              <span className="wx-cat">
                {catBadge(h?.category ?? null, true)}
                {wmoSevere(h?.code ?? null) && <Badge tone="amber">Caution</Badge>}
              </span>
            </div>
          </div>
          <div className="fields wx-fields">
            <Field label="Conditions" tip="Model forecast for the planned hour (WMO weather code).">
              <V v={desc} w={12} className="wx-desc" />
            </Field>
            <Field label="Visibility" tip="Forecast horizontal visibility near the surface.">
              <V v={vis(h?.visM ?? null)} w={6} />
            </Field>
            <Field
              label="Ceiling"
              tip="Estimated: base of the lowest broken or overcast layer. The model gives cover per layer, not a cloud base, so the base is worked out from the temperature / dew-point spread."
              sub={h && h.ceilingFt != null ? "est." : null}
            >
              <V v={h ? (h.ceilingFt != null ? `${h.ceilingFt.toLocaleString("en-GB")} ft` : "None") : null} w={8} />
            </Field>
            <Field label="Temp / dew" tip="Air temperature and dew point at 2 m. A small spread (under 3 °C) means mist, fog or low cloud is likely.">
              <V v={h?.temp != null ? `${round(h.temp)} / ${round(h.dew) ?? "—"} °C` : null} w={9} />
            </Field>
            <Field label="QNH" tip="Mean sea-level pressure; set it on the altimeter for departure / arrival.">
              <V v={h?.qnh != null ? `${Math.round(h.qnh)} hPa` : null} w={8} />
            </Field>
            <Field label="Precip" tip="Precipitation in that hour, and the chance of any precipitation.">
              <V v={h?.precipMm != null ? `${h.precipMm.toFixed(1)} mm` : null} w={6} />
              {h?.precipProb != null && <span className="field-sub">{Math.round(h.precipProb)}%</span>}
            </Field>
          </div>
          <div className="wx-cloud">
            <span className="field-label">
              <Tip tip="Cloud cover by layer at the planned hour. Shading darkens with cover; amounts use METAR terms (FEW, SCT, BKN, OVC)." title="Cloud">
                Cloud
              </Tip>
            </span>
            <CloudColumn low={h?.cloudLow ?? null} mid={h?.cloudMid ?? null} high={h?.cloudHigh ?? null} />
          </div>
        </div>
      )}

      {s.fc.state !== "error" && (
        <div className="wx-strip-box">
          <span className="field-label">
            <Tip tip="Hourly outlook 12 hours either side of the planned time, in UTC. Arrows point downwind; speeds show the gust when it's 10 kt above the mean; the magenta box is the planned hour." title="24-hour outlook">
              24-hour outlook (UTC)
            </Tip>
          </span>
          <div className="wx-strip-scroll">
            <WxStrip hours={strip} planned={12} />
          </div>
        </div>
      )}

      <MetarBlock s={s.metar} onRetry={onRetry} />
    </article>
  );
}

function MetarBlock({ s, onRetry }: { s: Load<string | null>; onRetry: () => void }) {
  if (s.state === "error")
    return (
      <p className="wx-err" role="status">
        METAR unavailable: {s.message}{" "}
        <button type="button" className="chip-btn" onClick={onRetry}>
          Retry
        </button>
      </p>
    );
  const m: Metar | null = s.state === "ok" && s.data ? decodeMetar(s.data) : null;
  const none = s.state === "ok" && !s.data;
  return (
    <div className="wx-metar">
      <div className="wx-metar-head">
        <span className="field-label">
          <Tip tip="The latest observed report at the airport (real world, as served to VATSIM). Useful if you're flying now with live weather." title="METAR">
            METAR now
          </Tip>
        </span>
        {m?.category && catBadge(m.category, false)}
        {m?.observed != null && <span className="wx-obs mono">{zulu(m.observed)} · {relative(m.observed)}</span>}
      </div>
      {none ? (
        <p className="wx-note">This airport has no current METAR.</p>
      ) : (
        <>
          <p className="wx-metar-sum">
            {m ? (
              [
                m.windKt != null ? (m.windKt < 1 ? "Calm" : `${m.variable ? "VRB" : `${deg3(m.windDir)}°`} ${m.windKt} kt${m.gustKt ? ` G${m.gustKt}` : ""}`) : null,
                m.cavok ? "CAVOK" : vis(m.visM),
                !m.cavok && (m.clouds.length ? m.clouds.map((c) => `${c.amount}${c.baseFt != null ? ` ${c.baseFt.toLocaleString("en-GB")} ft` : ""}${c.type ? ` ${c.type}` : ""}`).join(", ") : null),
                ...m.weather.map(weatherText),
                m.temp != null ? `${m.temp}/${m.dew ?? "—"} °C` : null,
                m.qnh != null ? `Q${m.qnh}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Couldn't decode; see the raw report"
            ) : (
              <V v={null} w={34} />
            )}
          </p>
          <p className="wx-raw mono">{m ? m.raw : <V v={null} w={48} />}</p>
        </>
      )}
    </div>
  );
}

