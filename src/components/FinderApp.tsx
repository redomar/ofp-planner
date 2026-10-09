"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { airportLabel, isoDay, onDay } from "@/lib/data/flight";
import { findFlight, loadRoutes, useDataset, type FlightRow } from "@/lib/data/load";
import {
  EMPTY_QUERY,
  enrich,
  filterRows,
  groupByOtherEnd,
  groupRoutes,
  pickNextLeg,
  placeMatches,
  queryFromParams,
  queryToParams,
  roll,
  sortRows,
  type Query,
  type Row,
  type Sort,
} from "@/lib/data/query";
import { familyOf } from "@/lib/data/flight";
import { DEFAULT_PREFS, readPrefs, writePrefs } from "@/lib/saved";
import { applyFn, readFnOverrides, useFnOverrides } from "@/lib/fnoverride";
import { routeColor } from "@/lib/colors";
import { StatusLine, TopBar } from "./chrome";
import { FlightCard } from "./FlightCard";
import { AfterPicker, DayPicker, LengthPicker, MultiPicker, PlacePicker, type MultiOption, type PlaceOption } from "./pickers";
import { FlightTable, PlacesView } from "./Results";
import { RoutesView } from "./RoutesView";
import { cx } from "./ui";
import { countryName, placeOptions } from "@/lib/places";
import { EMPTY_PLAN, planToParams } from "@/lib/journey/plan";
import Link from "next/link";

type View = "flights" | "places" | "map";

export function FinderApp() {
  const [ready, setReady] = useState(false);
  const [q, setQ] = useState<Query>({ ...EMPTY_QUERY, al: DEFAULT_PREFS.airlines });
  const [sort, setSort] = useState<Sort | null>(DEFAULT_PREFS.sort);
  const [view, setView] = useState<View>("flights");
  const [selId, setSelId] = useState<string | null>(null);
  const [spread, setSpread] = useState(true);
  const [extra, setExtra] = useState<Row | null>(null);
  /** Airports tab: only this country's airports (ISO code), or every country. */
  const [placeCc, setPlaceCc] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);

  // Read the URL (wins) and saved preferences once, after hydration.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const prefs = readPrefs();
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of browser-only state after hydration */
    setQ(queryFromParams(p, prefs.airlines));
    setSort(prefs.sort);
    const v = p.get("view");
    setView(v === "places" || v === "map" ? v : prefs.view);
    setSpread(prefs.spread);
    setSelId(p.get("f"));
    setPlaceCc(/^[A-Z]{2}$/.test(p.get("cc") ?? "") ? p.get("cc") : null);
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const data = useDataset(ready ? (q.al.length ? q.al : "all") : []);
  const { airports, airlines, manifest } = data;

  // Mirror state into the URL so a reload or a shared link reopens the same view.
  useEffect(() => {
    if (!ready) return;
    const p = queryToParams(q, { view: view === "flights" ? null : view, cc: view === "places" ? placeCc : null, f: selId });
    const next = `${window.location.pathname}?${p.toString()}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [q, view, placeCc, selId, ready]);

  const fnOv = useFnOverrides();
  // times shown are for one weekday: the day filter's when it holds one day, else today (UTC)
  const [today] = useState(() => isoDay(new Date()));
  const viewDay = q.days.length === 1 ? q.days[0] : today;
  const rows = useMemo(() => data.flights.map((f) => enrich(applyFn(onDay(f, viewDay), fnOv), airports)), [data.flights, airports, fnOv, viewDay]);
  const filtered = useMemo(() => filterRows(rows, q, airports), [rows, q, airports]);
  const nameOf = useCallback((icao: string) => airportLabel(airports?.get(icao)) || icao, [airports]);
  const sorted = useMemo(() => sortRows(filtered, sort, nameOf), [filtered, sort, nameOf]);

  // Places: destinations from a fixed origin, origins into a fixed destination, or all origins.
  const placeSide: "d" | "o" = q.dep && !q.arr ? "d" : "o";
  const hub = placeSide === "d" ? (q.dep?.startsWith("C:") ? null : q.dep) : q.arr && !q.arr.startsWith("C:") ? q.arr : null;
  const routeGroups = useMemo(() => groupRoutes(filtered), [filtered]);
  const places = useMemo(() => (q.dep && q.arr ? null : groupByOtherEnd(filtered, placeSide)), [filtered, placeSide, q.dep, q.arr]);
  // the countries in the list, most airports first, for the Airports tab's country filter
  const placeCountries = useMemo(() => {
    const by = new Map<string, number>();
    for (const p of places ?? []) {
      const cc = airports?.get(p.icao)?.country;
      if (cc) by.set(cc, (by.get(cc) ?? 0) + 1);
    }
    return [...by.entries()].map(([cc, n]) => ({ cc, name: countryName(cc), n })).sort((a, b) => a.name.localeCompare(b.name));
  }, [places, airports]);
  const shownPlaces = useMemo(
    () => (places && placeCc ? places.filter((p) => airports?.get(p.icao)?.country === placeCc) : places),
    [places, placeCc, airports],
  );

  // Selected flight: from the loaded rows, or fetched by id (a link to an airline not selected).
  const selected = useMemo(
    () => (selId ? (rows.find((r) => r.f.id === selId) ?? (extra?.f.id === selId ? enrich(onDay(extra.f, viewDay), airports) : null)) : null),
    [rows, selId, extra, viewDay, airports],
  );
  useEffect(() => {
    if (!selId || selected || !manifest) return;
    let live = true;
    void findFlight(selId).then((f: FlightRow | null) => {
      if (live && f) setExtra(enrich(applyFn(f, readFnOverrides()), airports));
    });
    return () => {
      live = false;
    };
  }, [selId, selected, manifest, airports]);

  /* ---------- options for the pickers ---------- */

  const placeOpts = useMemo<PlaceOption[]>(() => {
    if (!airports) return [];
    const counts = new Map<string, number>();
    for (const r of rows) {
      counts.set(r.f.o, (counts.get(r.f.o) ?? 0) + 1);
      counts.set(r.f.d, (counts.get(r.f.d) ?? 0) + 1);
    }
    return placeOptions(counts, airports);
  }, [rows, airports]);

  // With an airport (or country) chosen, count each airline's flights for that selection from the
  // route index, so the dropdown shows who actually flies there (fetched once, ~60 KB).
  const [routes, setRoutes] = useState<Awaited<ReturnType<typeof loadRoutes>> | null>(null);
  const wantRoutes = !!(q.dep || q.arr);
  useEffect(() => {
    if (!wantRoutes || routes) return;
    let live = true;
    loadRoutes().then((r) => live && setRoutes(r), () => undefined);
    return () => {
      live = false;
    };
  }, [wantRoutes, routes]);
  const placeCounts = useMemo(() => {
    if (!wantRoutes || !routes || !airports) return null;
    const counts = new Map<string, number>();
    const origins = q.dep && !q.dep.startsWith("C:") ? [q.dep] : Object.keys(routes);
    for (const o of origins) {
      if (!placeMatches(q.dep, o, airports)) continue;
      for (const [d, byAl] of Object.entries(routes[o] ?? {})) {
        if (!placeMatches(q.arr, d, airports)) continue;
        for (const [al, n] of Object.entries(byAl)) counts.set(al, (counts.get(al) ?? 0) + n);
      }
    }
    return counts;
  }, [wantRoutes, routes, airports, q.dep, q.arr]);

  const airlineOptions = useMemo<MultiOption[]>(() => {
    const opts = (manifest?.airlines ?? []).map((a) => ({
      value: a.icao,
      label: a.name,
      detail: [a.iata, a.icao].filter(Boolean).join(" / "),
      swatch: routeColor(a),
      count: placeCounts ? (placeCounts.get(a.icao) ?? 0) : a.flights,
      dim: placeCounts ? !placeCounts.get(a.icao) : false,
    }));
    // flying here first (most flights first), then the rest alphabetically
    return placeCounts
      ? opts.sort((a, b) => Number(a.dim) - Number(b.dim) || (a.dim ? a.label.localeCompare(b.label) : b.count - a.count))
      : opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [manifest, placeCounts]);
  const placeName = (p: string | null) => (p ? (p.startsWith("C:") ? countryName(p.slice(2)) : (airports?.get(p)?.iata ?? p)) : null);
  const routeLabel = [placeName(q.dep), placeName(q.arr)].filter(Boolean).join(" → ");

  const typeOptions = useMemo<MultiOption[]>(() => {
    const fam = new Map<string, number>();
    const exact = new Map<string, number>();
    for (const r of rows)
      for (const t of r.f.types) {
        exact.set(t, (exact.get(t) ?? 0) + 1);
        const f = familyOf(t);
        if (f !== t) fam.set(f, (fam.get(f) ?? 0) + 1);
      }
    return [
      ...[...fam.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ value: v, label: v, detail: "Family", count: n })),
      ...[...exact.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ value: v, label: v, count: n })),
    ];
  }, [rows]);

  /* ---------- actions ---------- */

  const update = (patch: Partial<Query>) => setQ((old) => ({ ...old, ...patch }));
  const setAirlines = (al: string[]) => {
    update({ al });
    writePrefs({ airlines: al });
  };
  // The flight opens in a floating panel; it scrolls back to its top for each new flight.
  const select = useCallback((r: Row | null) => {
    setSelId(r?.f.id ?? null);
    if (r) requestAnimationFrame(() => detailRef.current?.scrollTo({ top: 0 }));
  }, []);

  // Escape closes the flight card (unless typing in a field or a picker is open).
  useEffect(() => {
    if (!selId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "Escape" || t?.closest("input, select, textarea, .multi.open, .combo.open")) return;
      select(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selId, select]);

  const rollLabel = q.dep && q.arr ? "Random flight on this route" : q.dep ? "Random destination" : q.arr ? "Random origin" : "Random flight";
  const doRoll = () => {
    const by = spread ? (q.dep && !q.arr ? "d" : q.arr && !q.dep ? "o" : null) : null;
    const r = roll(filtered, { spreadBy: by, avoid: selId });
    if (r) select(r);
  };

  /** Onward leg: from this flight's destination, departing after it arrives (with a turnaround), same airline first. */
  const nextLeg = () => {
    if (!selected) return;
    const f = selected.f;
    const q2: Query = { ...q, dep: f.d, arr: null };
    const r = pickNextLeg(filterRows(rows, q2, airports), f, spread);
    setQ(q2);
    if (r) select(r);
  };

  const onSort = (s: Sort | null) => {
    setSort(s);
    writePrefs({ sort: s });
  };
  const changeView = (v: View) => {
    setView(v);
    writePrefs({ view: v });
  };
  const pickPlace = (icao: string) => {
    if (placeSide === "d" && q.dep) update({ arr: icao });
    else update({ dep: icao });
    changeView("flights");
  };
  // Everything back to the start, including the airline (all airlines).
  const reset = () => {
    setQ({ ...EMPTY_QUERY, al: [] });
    writePrefs({ airlines: [] });
  };
  const filtersOn = !!(q.al.length || q.dep || q.arr || q.types.length || q.minLen != null || q.maxLen != null || q.days.length || q.text || q.after != null);

  /* ---------- status ---------- */

  const alNames = q.al.length ? q.al.map((a) => airlines.get(a)?.name ?? a).join(", ") : "All airlines";
  const status = data.error ? (
    <span className="st-err">
      Couldn’t load the schedule snapshot ({data.error}).{" "}
      <button type="button" className="linkish" onClick={() => window.location.reload()}>
        Retry
      </button>
    </span>
  ) : !ready || !manifest ? (
    <span className="muted">Loading schedule snapshot…</span>
  ) : data.loading.length ? (
    // fixed text while loading (the bar under the line shows progress), so nothing on the line moves
    <span className="muted">Loading schedule snapshot…</span>
  ) : (
    <span>
      <b>{alNames}</b> · {rows.length.toLocaleString("en-GB")} flights · snapshot{" "}
      <time dateTime={manifest.generatedAt}>{new Date(manifest.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</time>
      {manifest.coverage && <span className="muted hide-xs"> (schedules {manifest.coverage.from} → {manifest.coverage.to})</span>}
    </span>
  );

  // The list appears once every requested airline has loaded (all at once), so rows don't shuffle in.
  const nothingYet = !ready || !manifest || !airports || data.loading.length > 0;

  return (
    <>
      <TopBar finderHref="/" />
      <StatusLine progress={ready && !data.error ? data.progress : null}>{status}</StatusLine>
      <div className="finder">
        <section className="panel filters" aria-label="Filters">
          <div className="filters-grid">
            <MultiPicker
              label="Airline"
              values={q.al}
              options={airlineOptions}
              onChange={setAirlines}
              allLabel="All airlines"
              searchable
              note={placeCounts ? `Flights ${q.dep && !q.arr ? "from" : q.arr && !q.dep ? "to" : "on"} ${routeLabel}` : "Flights in the snapshot"}
              restLabel={placeCounts ? `Not flying ${q.dep && !q.arr ? "from" : q.arr && !q.dep ? "to" : "on"} ${routeLabel}` : undefined}
            />
            <PlacePicker label="From" value={q.dep} options={placeOpts} onChange={(dep) => update({ dep })} />
            <button
              type="button"
              className="btn btn-icon swap"
              aria-label="Swap from and to"
              title="Swap from and to"
              onClick={() => update({ dep: q.arr, arr: q.dep })}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 5h11M10 2l3 3-3 3M14 11H3M6 8l-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
            <PlacePicker label="To" value={q.arr} options={placeOpts} onChange={(arr) => update({ arr })} />
            <MultiPicker label="Aircraft" values={q.types} options={typeOptions} onChange={(types) => update({ types })} allLabel="Any type" searchable />
            <LengthPicker min={q.minLen} max={q.maxLen} onChange={(minLen, maxLen) => update({ minLen, maxLen })} />
            <DayPicker values={q.days} onChange={(days) => update({ days })} />
            <AfterPicker after={q.after} oooi={q.ref} sched={q.sched} onChange={(p) => update(p)} />
            <label className="search">
              <span className="ctl-label">Flight or callsign</span>
              <input
                className="ctl-input"
                value={q.text}
                placeholder="1016, EJU54LH"
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => update({ text: e.target.value })}
              />
            </label>
          </div>
          <div className="rollbar">
            <button type="button" className="btn btn-roll" onClick={doRoll} disabled={!filtered.length}>
              <Dice />
              {rollLabel}
            </button>
            <label className="check" title="Every destination (or origin) is equally likely, so busy routes don't dominate.">
              <input
                type="checkbox"
                checked={spread}
                onChange={(e) => {
                  setSpread(e.target.checked);
                  writePrefs({ spread: e.target.checked });
                }}
              />
              Even odds per airport
            </label>
            <span className="rollbar-count mono" aria-live="polite">
              {nothingYet ? "" : `${filtered.length.toLocaleString("en-GB")} ${filtered.length === 1 ? "match" : "matches"}`}
            </span>
            <button type="button" className="btn" onClick={reset} hidden={!filtersOn}>
              Clear filters
            </button>
          </div>
        </section>

        <section className="panel list" aria-label="Results">
          <div className="tabs-bar">
          <div className="tabs" role="tablist" aria-label="Show">
            <button type="button" role="tab" aria-selected={view === "flights"} className="tab" onClick={() => changeView("flights")}>
              Flights <span className="mono">{nothingYet ? "" : filtered.length.toLocaleString("en-GB")}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "places"}
              className="tab"
              onClick={() => changeView("places")}
              disabled={!places}
              title={places ? undefined : "Clear From or To to list destinations"}
            >
              {placeSide === "d" ? "Destinations" : q.arr ? "Origins" : "Airports"} <span className="mono">{shownPlaces && !nothingYet ? shownPlaces.length : ""}</span>
            </button>
            <button type="button" role="tab" aria-selected={view === "map"} className="tab" onClick={() => changeView("map")} disabled={!filtered.length}>
              Map <span className="mono">{nothingYet ? "" : routeGroups.length.toLocaleString("en-GB")}</span>
            </button>
          </div>
          {view === "flights" && sort && (
            <button type="button" className="btn sort-reset" onClick={() => onSort(null)} title="Clear the sort: flights in the order the data lists them">
              Reset sort
            </button>
          )}
          </div>
          <div role="tabpanel" className={cx("list-body", nothingYet && "is-loading")}>
            {nothingYet ? (
              <SkeletonRows />
            ) : view === "map" && routeGroups.length ? (
              <RoutesView
                routes={routeGroups}
                airports={airports}
                airlines={airlines}
                onPick={(o, d) => {
                  update({ dep: o, arr: d });
                  changeView("flights");
                }}
              />
            ) : view === "places" && shownPlaces ? (
              <PlacesView
                places={shownPlaces}
                side={placeSide}
                hub={hub}
                airports={airports}
                airlines={airlines}
                onPick={pickPlace}
                country={placeCc}
                countries={placeCountries}
                onCountry={setPlaceCc}
              />
            ) : filtered.length ? (
              <FlightTable rows={sorted} sort={sort} onSort={onSort} selected={selId} onSelect={(r) => select(r)} airports={airports} airlines={airlines} />
            ) : data.loading.length ? (
              <SkeletonRows />
            ) : (
              <div className="empty-note">
                <p>
                  No flights match. {q.dep && q.arr ? "There is no scheduled flight on this route for the selected airlines." : "Try widening the filters."}
                </p>
                {q.dep && q.arr && (
                  <p>
                    <Link className="btn btn-primary" href={`/journeys?${planToParams({ ...EMPTY_PLAN, from: q.dep, to: q.arr, al: q.al }).toString()}`}>
                      Find a journey with stops
                    </Link>{" "}
                    <span className="muted">Opens Journeys with {routeLabel} filled in.</span>
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
      {selected && (
        <aside className="drawer" aria-label={`Selected flight ${selected.f.cs ?? selected.f.fn ?? ""}`} ref={detailRef}>
          <FlightCard
            key={selected.f.id}
            row={selected}
            airline={airlines.get(selected.f.al)}
            airports={airports}
            onContinue={nextLeg}
            onClose={() => select(null)}
            onPlace={(side, icao) => {
              update(side === "dep" ? { dep: icao, arr: null } : { arr: icao, dep: null });
              changeView("places");
            }}
          />
        </aside>
      )}
    </>
  );
}

function SkeletonRows() {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="sk-row">
          <i style={{ width: "12%" }} />
          <i style={{ width: "22%" }} />
          <i style={{ width: "22%" }} />
          <i style={{ width: "8%" }} />
          <i style={{ width: "8%" }} />
          <i style={{ width: "10%" }} />
        </div>
      ))}
    </div>
  );
}

function Dice() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="1.5" y="1.5" width="15" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="5.5" cy="5.5" r="1.3" fill="currentColor" />
      <circle cx="9" cy="9" r="1.3" fill="currentColor" />
      <circle cx="12.5" cy="12.5" r="1.3" fill="currentColor" />
    </svg>
  );
}
