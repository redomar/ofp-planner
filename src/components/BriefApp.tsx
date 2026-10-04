"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { airportLabel, daysLabel, DAY_NAMES, dur, flightNo, hhmm, isoDay, nextDeparture } from "@/lib/data/flight";
import { findFlight, loadAirports, loadManifest, type Airport } from "@/lib/data/load";
import { enrich, type Row } from "@/lib/data/query";
import type { Manifest } from "@/lib/data/types";
import { readReady, setReady, updateReady, useSaved } from "@/lib/saved";
import { StatusLine, TopBar } from "./chrome";
import { CollapseProvider } from "./collapse";
import { FlightCard } from "./FlightCard";
import { Section, V } from "./ui";
import { RouteWeather, type WxPoint } from "./wx/RouteWeather";
import { localTime } from "@/lib/wx/format";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The flight you're about to fly: the dispatch card, the date you're flying it, and the
 * forecast for both ends at those times. Weather is only fetched here, on demand.
 */
export function BriefApp() {
  const [state, setState] = useState<{ row: Row | null; airports: Map<string, Airport> | null; manifest: Manifest | null; error: string | null; done: boolean }>({
    row: null,
    airports: null,
    manifest: null,
    error: null,
    done: false,
  });
  const [date, setDate] = useState<string | null>(null);
  const [minDate] = useState(() => ymd(new Date(Date.now() - 86_400_000)));
  const saved = useSaved();

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("f") ?? readReady()?.flight.id ?? null;
    if (!id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing to load
      setState((s) => ({ ...s, done: true }));
      return;
    }
    let live = true;
    Promise.all([loadManifest(), loadAirports(), findFlight(id)])
      .then(([manifest, airports, f]) => {
        if (!live) return;
        const row = f ? enrich(f, airports) : null;
        if (f) {
          const ready = readReady();
          const keep = ready?.flight.id === f.id ? ready : null;
          if (!keep) setReady(f, null, null);
          const d = keep?.date && keep.date >= ymd(new Date()) ? keep.date : ymd(nextDeparture(f));
          setDate(d);
          if (f.std != null) window.history.replaceState(null, "", `/brief?f=${encodeURIComponent(f.id)}`);
        }
        setState({ row, airports, manifest, error: f ? null : "This flight isn't in the current snapshot.", done: true });
      })
      .catch((e: unknown) => live && setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), done: true })));
    return () => {
      live = false;
    };
  }, []);

  const { row, airports, manifest } = state;
  const f = row?.f ?? null;
  const from = f ? airports?.get(f.o) : undefined;
  const to = f ? airports?.get(f.d) : undefined;
  const airline = f ? manifest?.airlines.find((a) => a.icao === f.al) : undefined;

  const times = useMemo(() => {
    if (!f || !date) return null;
    const [y, m, d] = date.split("-").map(Number);
    const dep = f.std ?? f.out ?? f.off;
    if (dep == null) return { dep: null, arr: null };
    const depAt = new Date(Date.UTC(y, m - 1, d, 0, dep));
    const blockMin = row?.block?.min ?? null;
    return { dep: depAt, arr: blockMin != null ? new Date(depAt.getTime() + blockMin * 60_000) : null };
  }, [f, date, row]);

  const wxPoint = (a: Airport): WxPoint => ({ icao: a.icao, name: airportLabel(a), lat: a.lat, lon: a.lon, elevFt: a.elevFt, tz: a.tz });
  const operates = f && date ? !f.days.length || f.days.includes(isoDay(new Date(`${date}T00:00:00Z`))) : true;

  const status = !state.done ? (
    <span className="muted">Loading the flight…</span>
  ) : f ? (
    <span>
      <b>{flightNo(f, airline?.iata ?? null)}</b> · {f.o} → {f.d}
      {times?.dep && (
        <span className="muted">
          {" "}
          · departs {ymd(times.dep)} {hhmm(f.std)}Z
        </span>
      )}
    </span>
  ) : (
    <span className="muted">No flight picked yet</span>
  );

  return (
    <CollapseProvider>
      <TopBar finderHref={f ? `/?al=${f.al}&dep=${f.o}&arr=${f.d}&f=${encodeURIComponent(f.id)}` : "/"} />
      <StatusLine progress={state.done ? null : 0.4}>{status}</StatusLine>
      <main className="brief">
        {state.done && !f && (
          <div className="panel banner">
            <p className="detail-empty-title">{state.error ?? "No flight picked yet"}</p>
            <p className="muted">
              Pick a flight in the <Link href="/">Finder</Link> and press <b>Ready to sim</b>. The brief shows the dispatch link and the forecast at both
              ends for the day you fly.
            </p>
            {!!saved?.history.length && (
              <ul className="saved-list">
                {saved.history.slice(0, 6).map((h) => (
                  <li key={h.id}>
                    <a href={`/brief?f=${encodeURIComponent(h.id)}`}>
                      <span className="mono">
                        {h.fn ? `${h.al} ${h.fn}` : (h.cs ?? h.al)}
                      </span>{" "}
                      {h.o} → {h.d}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {f && row && (
          <>
            <Section id="flight" no={1} title="Flight" meta={<span className="mono">{flightNo(f, airline?.iata ?? null)}</span>}>
              <FlightCard key={row.f.id} row={row} airline={airline} airports={airports} />
            </Section>

            <Section id="when" no={2} title="When you fly" meta={<span className="mono">{date ?? ""}</span>}>
              <div className="when">
                <label className="when-date">
                  <span className="ctl-label">Departure date (UTC)</span>
                  <input
                    type="date"
                    className="ctl-input"
                    value={date ?? ""}
                    min={minDate}
                    onChange={(e) => {
                      setDate(e.target.value || null);
                      updateReady({ date: e.target.value || null });
                    }}
                  />
                </label>
                <div className="when-grid">
                  <div className="field">
                    <span className="field-label">Off-block (STD)</span>
                    <div className="field-value">
                      <V v={times?.dep ? `${hhmm(f.std ?? f.out)}Z` : null} w={6} />
                      {times?.dep && from?.tz && <span className="field-sub">{localTime(times.dep.getTime(), from.tz)} local</span>}
                    </div>
                  </div>
                  <div className="field">
                    <span className="field-label">On-block (STA)</span>
                    <div className="field-value">
                      <V v={times?.arr ? `${times.arr.toISOString().slice(11, 16)}Z` : null} w={6} />
                      {times?.arr && to?.tz && <span className="field-sub">{localTime(times.arr.getTime(), to.tz)} local</span>}
                    </div>
                  </div>
                  <div className="field">
                    <span className="field-label">Block</span>
                    <div className="field-value">
                      <V v={dur(row.block?.min)} w={6} />
                    </div>
                  </div>
                  <div className="field">
                    <span className="field-label">Operates</span>
                    <div className="field-value">
                      <span>{daysLabel(f.days) ?? "Unknown"}</span>
                    </div>
                  </div>
                </div>
                {!operates && date && (
                  <p className="note-amber">
                    {flightNo(f, airline?.iata ?? null)} doesn’t operate on {DAY_NAMES[isoDay(new Date(`${date}T00:00:00Z`)) - 1]}s in the snapshot.{" "}
                    <button type="button" className="linkish" onClick={() => setDate(ymd(nextDeparture(f, new Date(`${date}T00:00:00Z`))))}>
                      Use the next day it flies
                    </button>
                  </p>
                )}
              </div>
            </Section>

            <Section id="weather" no={3} title="Weather" meta={<span>Forecast at the planned times</span>}>
              {from && to ? (
                <RouteWeather origin={wxPoint(from)} dest={wxPoint(to)} dep={times?.dep ?? null} arr={times?.arr ?? null} />
              ) : (
                <p className="muted">Airport positions are missing from the snapshot, so there’s no forecast for this flight.</p>
              )}
            </Section>
          </>
        )}
      </main>
    </CollapseProvider>
  );
}
