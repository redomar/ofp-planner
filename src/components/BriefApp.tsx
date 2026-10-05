"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { airportLabel, daysLabel, DAY_NAMES, dur, flightNo, hhmm, isoDay, nextDeparture, plannedOut } from "@/lib/data/flight";
import { findFlight, loadAirline, loadAirports, loadManifest, type Airport } from "@/lib/data/load";
import { enrich, pickNextLeg, type Row } from "@/lib/data/query";
import type { Manifest } from "@/lib/data/types";
import { readPrefs, readReady, setReady, updateReady } from "@/lib/saved";
import { KEYS, removeKey } from "@/lib/storage";
import { routeColor } from "@/lib/colors";
import { AirlineTag } from "./badges";
import { StatusLine, TopBar } from "./chrome";
import { applyFn, useFnOverrides } from "@/lib/fnoverride";
import { SavedFlights } from "./SavedFlights";
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

  const [loadId, setLoadId] = useState<string | null | undefined>(undefined);

  // Which flight to show: the URL, else the saved "ready" flight.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only read after hydration
    setLoadId(new URLSearchParams(window.location.search).get("f") ?? readReady()?.flight.id ?? null);
  }, []);

  useEffect(() => {
    if (loadId === undefined) return;
    const id = loadId;
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
          window.history.replaceState(null, "", `/brief?f=${encodeURIComponent(f.id)}`);
        }
        setState({ row, airports, manifest, error: f ? null : "This flight isn't in the current snapshot.", done: true });
      })
      .catch((e: unknown) => live && setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), done: true })));
    return () => {
      live = false;
    };
  }, [loadId]);

  const { airports, manifest } = state;
  // the user's flight number (added on the card) applies as soon as it's saved
  const fnOv = useFnOverrides();
  const row = useMemo(() => (state.row ? enrich(applyFn(state.row.f, fnOv), airports) : null), [state.row, fnOv, airports]);


  const f = row?.f ?? null;
  const from = f ? airports?.get(f.o) : undefined;
  const to = f ? airports?.get(f.d) : undefined;
  const airline = f ? manifest?.airlines.find((a) => a.icao === f.al) : undefined;

  const times = useMemo(() => {
    if (!f || !date) return null;
    const [y, m, d] = date.split("-").map(Number);
    const dep = plannedOut(f);
    if (dep == null) return { dep: null, arr: null };
    const depAt = new Date(Date.UTC(y, m - 1, d, 0, dep));
    const blockMin = row?.block?.min ?? null;
    return { dep: depAt, arr: blockMin != null ? new Date(depAt.getTime() + blockMin * 60_000) : null };
  }, [f, date, row]);

  /*
   * Next leg. A sample onward flight from this destination (same airline, realistic turnaround) is
   * picked ahead and previewed under its button, so you see what you'd get; "Next leg" opens every
   * flight from the destination in the finder instead.
   */
  const [sample, setSample] = useState<{ for: string; row: Row | null } | null>(null);
  const [sampleRound, setSampleRound] = useState(0);
  const rowId = row?.f.id ?? null;
  useEffect(() => {
    if (!row || !manifest) return;
    let live = true;
    const info = manifest.airlines.find((a) => a.icao === row.f.al);
    void (info ? loadAirline(info, manifest) : Promise.resolve([])).then((own) => {
      if (!live) return;
      const from = own.filter((x) => x.o === row.f.d).map((x) => enrich(x, airports));
      setSample({ for: row.f.id, row: pickNextLeg(from, row.f, readPrefs().spread) });
    });
    return () => {
      live = false;
    };
    // a new sample per flight, and on "another"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId, manifest, sampleRound]);
  const sampleRow = sample && sample.for === rowId ? sample.row : undefined;

  const takeSample = () => {
    if (!sampleRow) return;
    // fly it on the first day it operates after this flight lands
    const landed = times?.arr ?? new Date();
    setReady(sampleRow.f, ymd(nextDeparture(sampleRow.f, landed)), null);
    setLoadId(sampleRow.f.id);
  };

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
          · departs {ymd(times.dep)} {hhmm(plannedOut(f))}Z
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
          <div className="brief-start">
            <div className="panel brief-intro">
              <div className="brief-intro-text">
                <p className="brief-kicker">{state.error ? "That flight isn’t in the current snapshot" : "Brief"}</p>
                <h2 className="brief-title">Choose a flight to brief</h2>
                <p className="muted">
                  Pick one of your favourites or a recent flight below, or find one in the Finder. The brief gathers the SimBrief dispatch link, the day
                  you’ll fly it and the forecast at both ends.
                </p>
                <div className="brief-cta">
                  <Link className="btn btn-primary" href="/">
                    Open the Finder
                  </Link>
                  <Link className="btn" href="/?al=">
                    Browse all airlines
                  </Link>
                </div>
              </div>
              <ol className="brief-steps" aria-label="How it works">
                <li>
                  <span className="brief-step-no mono">1</span>
                  <span>
                    <b>Find</b> a flight: filter, roll a random one, or pick a destination.
                  </span>
                </li>
                <li>
                  <span className="brief-step-no mono">2</span>
                  <span>
                    <b>Star</b> it to keep it in a favourites group, or open its brief.
                  </span>
                </li>
                <li>
                  <span className="brief-step-no mono">3</span>
                  <span>
                    <b>Brief</b>: set the day, check the weather, dispatch in SimBrief.
                  </span>
                </li>
              </ol>
            </div>
            <div className="panel brief-lib">
              <SavedFlights
                onOpen={(id) => {
                  window.history.replaceState(null, "", `/brief?f=${encodeURIComponent(id)}`);
                  setState((s) => ({ ...s, done: false, error: null }));
                  setLoadId(id);
                }}
              />
            </div>
          </div>
        )}

        {f && row && (
          <>
            <Section id="flight" no={1} title="Flight" meta={<span className="mono">{flightNo(f, airline?.iata ?? null)}</span>}>
              <FlightCard
                key={row.f.id}
                context="brief"
                placeHref={(icao) => `/?al=&dep=${icao}`}
                extra={
                  <NextLeg
                    from={f.d}
                    fromName={to ? airportLabel(to) : f.d}
                    sample={sampleRow}
                    airlines={manifest}
                    airports={airports}
                    onTake={takeSample}
                    onAnother={() => setSampleRound((n) => n + 1)}
                  />
                }
                closeLabel="Clear the brief"
                onClose={() => {
                  removeKey(KEYS.ready);
                  window.history.replaceState(null, "", "/brief");
                  setState((s) => ({ ...s, row: null, error: null }));
                  setDate(null);
                }}
                row={row} airline={airline} airports={airports} />
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
                      <V v={times?.dep ? `${hhmm(plannedOut(f))}Z` : null} w={6} />
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
                <RouteWeather
                  origin={wxPoint(from)}
                  dest={wxPoint(to)}
                  dep={times?.dep ?? null}
                  arr={times?.arr ?? null}
                  flightLabel={`${flightNo(f, airline?.iata ?? null)} · ${dur(row.block?.min) ?? ""}`}
                />
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

/** The brief's next-leg controls: a sample leg with its preview below, and the full list in the finder. */
function NextLeg({
  from,
  fromName,
  sample,
  airlines,
  airports,
  onTake,
  onAnother,
}: {
  from: string;
  fromName: string;
  /** undefined while it's being picked, null when there's none. */
  sample: Row | null | undefined;
  airlines: Manifest | null;
  airports: Map<string, Airport> | null;
  onTake: () => void;
  onAnother: () => void;
}) {
  const al = sample ? airlines?.airlines.find((a) => a.icao === sample.f.al) : undefined;
  const dest = sample ? airports?.get(sample.f.d) : undefined;
  return (
    <div className="nextleg">
      <p className="ctl-label">Next leg from {fromName}</p>
      <div className="nextleg-row">
        <div className="nextleg-sample">
          <button type="button" className="btn" onClick={onTake} disabled={!sample}>
            A sample next leg
          </button>
          <div className="nextleg-preview" aria-live="polite">
            {sample === undefined ? (
              <span className="muted small">Picking one…</span>
            ) : sample === null ? (
              <span className="muted small">No onward flight on this airline from {from} in the snapshot.</span>
            ) : (
              <>
                <span className="leg-badge">
                  <AirlineTag name={al?.name ?? sample.f.al} color={routeColor(al)} style="solid" />
                  <span className="leg-dest">
                    {dest ? airportLabel(dest) : sample.f.d} <span className="mono muted">{sample.f.d}</span>
                  </span>
                </span>
                <button type="button" className="chip" onClick={onAnother} title="Pick a different sample">
                  Another
                </button>
              </>
            )}
          </div>
        </div>
        <Link className="btn btn-primary" href={`/?al=&dep=${from}`}>
          Next leg: all flights from {from} →
        </Link>
      </div>
    </div>
  );
}
