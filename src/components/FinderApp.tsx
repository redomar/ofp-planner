"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { airportLabel, cityName, isoDay, onDay, shortDate } from "@/lib/data/flight";
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
import { hiddenAirlines, listedAirline, useDisplay } from "@/lib/display";
import { useMedia } from "@/lib/media";
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

const day = shortDate;

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
  const heroRef = useRef<HTMLDivElement>(null);

  // Read the URL (wins) and saved preferences once, after hydration and before the first paint, so the filters
  // (which fold or open by what's set) don't change size on screen.
  useLayoutEffect(() => {
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

  const display = useDisplay();
  const airlineSet = display.airlines;
  const layout = display.finder;
  const data = useDataset(ready ? (q.al.length ? q.al : "all") : [], { extra: airlineSet === "extra" });
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
    // Extra+ airlines count only when listed (Settings → Display) or picked
    const hidden = hiddenAirlines(manifest, airlineSet, q.al);
    const origins = q.dep && !q.dep.startsWith("C:") ? [q.dep] : Object.keys(routes);
    for (const o of origins) {
      if (!placeMatches(q.dep, o, airports)) continue;
      for (const [d, byAl] of Object.entries(routes[o] ?? {})) {
        if (!placeMatches(q.arr, d, airports)) continue;
        for (const [al, n] of Object.entries(byAl)) if (!hidden.has(al)) counts.set(al, (counts.get(al) ?? 0) + n);
      }
    }
    return counts;
  }, [wantRoutes, routes, airports, q.dep, q.arr, q.al, manifest, airlineSet]);

  const airlineOptions = useMemo<MultiOption[]>(() => {
    const opts = (manifest?.airlines ?? [])
      .filter((a) => listedAirline(a, airlineSet, q.al))
      .map((a) => ({
        value: a.icao,
        label: a.name,
        detail: [a.iata, a.icao].filter(Boolean).join(" / "),
        swatch: routeColor(a),
        tag: a.extra ? "Extra+" : undefined,
        count: placeCounts ? (placeCounts.get(a.icao) ?? 0) : a.flights,
        dim: placeCounts ? !placeCounts.get(a.icao) : false,
      }));
    // flying here first (most flights first), then the rest alphabetically
    return placeCounts
      ? opts.sort((a, b) => Number(a.dim) - Number(b.dim) || (a.dim ? a.label.localeCompare(b.label) : b.count - a.count))
      : opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [manifest, placeCounts, airlineSet, q.al]);
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
  // The flight opens in a floating panel; it scrolls back to its top for each new flight. Opening it moves the
  // keyboard focus into it (it's what changed); closing it puts the focus back where it was (the row, Random…).
  const returnTo = useRef<HTMLElement | null>(null);
  const select = useCallback(
    (r: Row | null) => {
      const opening = !!r && !selId;
      const closing = !r && !!selId;
      if (opening) {
        const a = document.activeElement;
        returnTo.current = a instanceof HTMLElement && a !== document.body ? a : null;
      }
      setSelId(r?.f.id ?? null);
      requestAnimationFrame(() => {
        // Roll first: a flight picked from the list lands in the hero, so go back up to it
        if (r && heroRef.current) {
          const top = heroRef.current.getBoundingClientRect().top;
          if (top < 0) heroRef.current.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        }
        if (r) detailRef.current?.scrollTo({ top: 0 });
        if (opening) detailRef.current?.focus({ preventScroll: true });
        if (closing) {
          const back = returnTo.current;
          returnTo.current = null;
          if (back?.isConnected) back.focus({ preventScroll: true });
        }
      });
    },
    [selId],
  );
  // The panel opens out of the row that was picked: it unfolds from the row's height, so you see
  // where the flight came from. (No row beside it, e.g. the Destinations tab: the panel's own slide-in.)
  useLayoutEffect(() => {
    const el = detailRef.current;
    if (!el || !selId || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const row = document.querySelector("table.flights tr.sel");
    if (!row) return;
    const d = el.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.bottom <= d.top || r.top >= d.bottom) return;
    el.getAnimations().forEach((a) => a.cancel());
    const top = Math.max(0, r.top - d.top);
    const bottom = Math.max(0, d.bottom - r.bottom);
    el.animate([{ clipPath: `inset(${top}px 0 ${bottom}px 0)`, opacity: 0.5 }, { clipPath: "inset(0 0 0 0)", opacity: 1 }], { duration: 220, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
  }, [selId]);

  // what the filter pins down (short rows leave it out; "shown short" draws it small)
  const pin = { al: q.al.length === 1, dep: !!q.dep && !q.dep.startsWith("C:"), arr: !!q.arr && !q.arr.startsWith("C:") };
  // Roll first opens on a rolled flight: once, when the list is ready and nothing is picked
  const [autoRolled, setAutoRolled] = useState(false);
  // on a phone the panel covers the list: what's behind it is out of reach until it closes
  const narrow = useMedia("(max-width: 640px)");
  // the advanced filters in use (for "More filters · 2 on"); folded on a phone unless one is set or they're opened
  const advancedOn = [q.types.length > 0, q.minLen != null || q.maxLen != null, q.days.length > 0, q.after != null, q.text.trim() !== ""].filter(Boolean).length;
  const [moreOpen, setMoreOpen] = useState<boolean | null>(null);
  const moreShown = moreOpen ?? advancedOn > 0;

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
      <b>{alNames}</b> · {rows.length.toLocaleString("en-GB")} flights ·{" "}
      {manifest.coverage ? (
        // the days the schedules were seen on (on phones too); the build date is secondary
        <span className="st-cover">
          <span className="hide-xs">schedules </span>
          <time dateTime={manifest.coverage.from}>{day(manifest.coverage.from)}</time> – <time dateTime={manifest.coverage.to}>{day(manifest.coverage.to, true)}</time>
          <span className="muted hide-xs">
            {" "}
            · snapshot built <time dateTime={manifest.generatedAt}>{day(manifest.generatedAt.slice(0, 10), true)}</time>
          </span>
        </span>
      ) : (
        <>
          snapshot <time dateTime={manifest.generatedAt}>{day(manifest.generatedAt.slice(0, 10), true)}</time>
        </>
      )}
    </span>
  );

  // The list appears once every requested airline has loaded (all at once), so rows don't shuffle in.
  const nothingYet = !ready || !manifest || !airports || data.loading.length > 0;
  if (layout === "roll" && !autoRolled && !nothingYet && ready) {
    setAutoRolled(true);
    if (!selId && filtered.length) setSelId(roll(filtered, { spreadBy: spread && q.dep && !q.arr ? "d" : null, avoid: null })?.f.id ?? null);
  }
  const onPlace = (side: "dep" | "arr", icao: string) => {
    update(side === "dep" ? { dep: icao, arr: null } : { arr: icao, dep: null });
    changeView("places");
  };

  /* ---------- the filter controls, arranged per layout ---------- */

  const cityOf = (icao: string) => cityName(airports?.get(icao)) ?? null;

  const alPicker = (
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
  );
  const fromPicker = <PlacePicker label="From" value={q.dep} options={placeOpts} onChange={(dep) => update({ dep })} />;
  const toPicker = <PlacePicker label="To" value={q.arr} options={placeOpts} onChange={(arr) => update({ arr })} />;
  const swapBtn = (
    <button type="button" className="btn btn-icon swap" aria-label="Swap from and to" title="Swap from and to" onClick={() => update({ dep: q.arr, arr: q.dep })}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 5h11M10 2l3 3-3 3M14 11H3M6 8l-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </button>
  );
  const advanced = (
    <>
      <MultiPicker label="Aircraft" values={q.types} options={typeOptions} onChange={(types) => update({ types })} allLabel="Any type" searchable />
      <LengthPicker min={q.minLen} max={q.maxLen} onChange={(minLen, maxLen) => update({ minLen, maxLen })} />
      <DayPicker values={q.days} onChange={(days) => update({ days })} />
      <AfterPicker after={q.after} oooi={q.ref} sched={q.sched} onChange={(p) => update(p)} />
      <label className="search">
        <span className="ctl-label">Flight or callsign</span>
        <input className="ctl-input" value={q.text} placeholder="1016, EJU54LH" spellCheck={false} autoComplete="off" onChange={(e) => update({ text: e.target.value })} />
      </label>
    </>
  );
  // what's set is counted, and a link with any opens them
  const moreBtn = (
    <button type="button" className="linkish more-filters" aria-expanded={moreShown} onClick={() => setMoreOpen(!moreShown)}>
      {moreShown ? "Fewer filters" : "More filters"}
      {advancedOn > 0 && <span className="badge b-mag">{advancedOn} on</span>}
    </button>
  );
  const spreadCheck = (
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
  );
  const count = (
    <span className="rollbar-count mono" aria-live="polite">
      {nothingYet ? "" : `${filtered.length.toLocaleString("en-GB")} ${filtered.length === 1 ? "match" : "matches"}`}
    </span>
  );
  const clearBtn = (
    <button type="button" className="btn" onClick={reset} hidden={!filtersOn}>
      Clear filters
    </button>
  );
  // the filter as a sentence: each word a control, the rest behind More filters
  const sentence = (
    <div className="sf" role="group" aria-label="Filter">
      <span className="sf-ctl sf-al">{alPicker}</span>
      <span className="sf-w">flights from</span>
      <span className="sf-ctl sf-place">
        <PlacePicker label="From" value={q.dep} options={placeOpts} onChange={(dep) => update({ dep })} anyLabel="anywhere" word={cityOf} />
      </span>
      <span className="sf-w">to</span>
      <span className="sf-ctl sf-place">
        <PlacePicker label="To" value={q.arr} options={placeOpts} onChange={(arr) => update({ arr })} anyLabel="anywhere" word={cityOf} />
      </span>
      <span className="sf-w">on</span>
      <span className="sf-ctl">
        <DayWord days={q.days} onChange={(days) => update({ days })} />
      </span>
    </div>
  );
  const sentenceMore = moreShown && (
    <div className="sf-more">
      <div className="sf-more-grid">{advanced}</div>
      <div className="sf-more-bar">
        {spreadCheck}
        {count}
        {clearBtn}
      </div>
    </div>
  );
  const filtersPanel =
    layout === "full" ? (
      <section className="panel filters" aria-label="Filters">
        <div className={cx("filters-grid", !moreShown && "less")}>
          {alPicker}
          {fromPicker}
          {swapBtn}
          {toPicker}
          {advanced}
        </div>
        {moreBtn}
        <div className="rollbar">
          <button type="button" className="btn btn-roll" onClick={doRoll} disabled={!filtered.length}>
            <Dice />
            {rollLabel}
          </button>
          {spreadCheck}
          {count}
          {clearBtn}
        </div>
      </section>
    ) : layout === "roll" ? (
      <section className="panel roll-hero" aria-labelledby="rh-q">
        <div className="rh-ask">
          <h2 id="rh-q" className="rh-title">
            Where are you flying from?
          </h2>
          <p className="muted">Pick an airport and roll a real airline flight: real callsign, real times, ready for SimBrief.</p>
          {sentence}
          <div className="rh-actions">
            <button type="button" className="btn btn-roll" onClick={doRoll} disabled={!filtered.length}>
              <Dice />
              Roll a flight
            </button>
            {moreBtn}
          </div>
          {sentenceMore}
          <p className="small rh-after" aria-live="polite">
            {nothingYet ? (
              "\u00a0"
            ) : selected ? (
              <>
                Rolled from {filtered.length.toLocaleString("en-GB")} {filtered.length === 1 ? "flight" : "flights"} ·{" "}
                <button type="button" className="linkish" onClick={doRoll} disabled={filtered.length < 2}>
                  Roll again
                </button>{" "}
                ·{" "}
                <a className="linkish" href="#or-choose">
                  Browse all {filtered.length.toLocaleString("en-GB")} ↓
                </a>
              </>
            ) : (
              `${filtered.length.toLocaleString("en-GB")} flights to roll from`
            )}
          </p>
        </div>
        <div className="rh-card" ref={heroRef}>
          {selected ? (
            <FlightCard
              key={selected.f.id}
              row={selected}
              airline={airlines.get(selected.f.al)}
              airports={airports}
              rest="tabs"
              onContinue={nextLeg}
              onClose={() => select(null)}
              onPlace={onPlace}
            />
          ) : (
            <p className="rh-empty muted">{nothingYet ? "Loading the schedule…" : filtered.length ? "Roll, and the flight lands here." : "No flights match: widen the sentence."}</p>
          )}
        </div>
      </section>
    ) : (
      <section className="panel filters sentence" aria-label="Filters">
        <div className="sf-bar">
          {sentence}
          <span className="sf-end">
            {moreBtn}
            <button type="button" className="btn btn-roll" onClick={doRoll} disabled={!filtered.length}>
              <Dice />
              Roll one
            </button>
          </span>
        </div>
        {sentenceMore}
      </section>
    );

  return (
    <>
      <TopBar finderHref="/" />
      <StatusLine progress={ready && !data.error ? data.progress : null}>{status}</StatusLine>
      <main className={cx("finder", `finder-${layout}`)} inert={!!selected && narrow && (layout === "full" || layout === "calm")}>
        <h1 className="sr-only">Finder</h1>
        {/* drawn once the link and the saved layout are read (before the first paint after hydration), so the
            static page never shows one layout or one set of filters and then moves to another */}
        {ready && filtersPanel}

        {/* Roll first: the list comes with the rolled flight, so it doesn't move down when the pass lands */}
        {ready && !(layout === "roll" && nothingYet) && (
        <section className={cx("panel list", layout !== "full" && "is-short")} aria-label="Results" id="or-choose">
          {layout === "roll" && <h2 className="list-title">Or choose</h2>}
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
              <FlightTable
                rows={sorted}
                sort={sort}
                onSort={onSort}
                selected={selId}
                onSelect={(r) => select(layout === "place" && r.f.id === selId ? null : r)}
                airports={airports}
                airlines={airlines}
                short={layout !== "full"}
                pin={pin}
                pinShort={display.pinShort}
                renderOpen={
                  layout === "place"
                    ? (r) => <FlightCard key={r.f.id} row={r} airline={airlines.get(r.f.al)} airports={airports} rest="tabs" onContinue={nextLeg} onClose={() => select(null)} onPlace={onPlace} />
                    : undefined
                }
              />
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
        )}
      </main>
      {selected && (layout === "full" || layout === "calm") && (
        <aside className="drawer" aria-label={`Selected flight ${selected.f.cs ?? selected.f.fn ?? ""}`} ref={detailRef} tabIndex={-1}>
          <FlightCard
            key={selected.f.id}
            row={selected}
            airline={airlines.get(selected.f.al)}
            airports={airports}
            rest={layout === "full" ? "folded" : "tabs"}
            onContinue={nextLeg}
            onClose={() => select(null)}
            onPlace={onPlace}
          />
        </aside>
      )}
    </>
  );
}

const DAY_WORDS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
/** "on any day" in the sentence: one weekday or any (several picked under More filters read as a count). */
function DayWord({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  const value = days.length === 0 ? "" : days.length === 1 ? String(days[0]) : "many";
  return (
    <select className="ctl-input sf-day" aria-label="Day" value={value} onChange={(e) => onChange(e.target.value ? [Number(e.target.value)] : [])}>
      <option value="">any day</option>
      {DAY_WORDS.map((d, i) => (
        <option key={d} value={String(i + 1)}>
          {d}
        </option>
      ))}
      {days.length > 1 && (
        <option value="many" disabled>
          {days.length} days
        </option>
      )}
    </select>
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
