"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { airportLabel, dur, familyOf, flightNo, hhmm, plannedOut } from "@/lib/data/flight";
import { enrich, queryToParams, EMPTY_QUERY } from "@/lib/data/query";
import { loadRoutes, useDataset, type Airport, type FlightRow } from "@/lib/data/load";
import type { AirlineInfo } from "@/lib/data/types";
import { routeColor } from "@/lib/colors";
import { applyFn, useFnOverrides } from "@/lib/fnoverride";
import type { Group, Journey, Pt, RouteEdge, TFlight } from "@/lib/journey/engine";
import { DETOURS, DUTY_HOURS, EMPTY_PLAN, EXAMPLES, HELP, listSort, planFromParams, planToParams, SORTS, toSpec, type JourneyPlan, type ListSort } from "@/lib/journey/plan";
import { dateLabel, departures, legDate, relDay, soonest, type Departure } from "@/lib/journey/dates";
import { useJourneySearch } from "@/lib/journey/useSearch";
import type { JourneyData } from "@/lib/journey/worker";
import { countryName, placeOptions } from "@/lib/places";
import { saveJourney } from "@/lib/saved";
import { defaultChoice, flightDispatch, simbriefUrl, typeChoices, useAirframes } from "@/lib/simbrief";
import { AirlineTag, FlightIdent, TypeBadge } from "./badges";
import { StatusLine, TopBar } from "./chrome";
import { MultiPicker, PlacePicker, type MultiOption } from "./pickers";
import { RouteMap, type MapRoute } from "./RouteMap";
import { cx, Tip } from "./ui";
import { JourneyTimings } from "./JourneyTimings";

const PAGE = 30;
const n0 = (n: number) => n.toLocaleString("en-GB");
/** Typical block for a network leg (same estimate the finder uses when there's no time). */
const estBlock = (nm: number) => Math.round(nm / 7.4 + 28);

/**
 * Multi-leg journeys: from an airport, through stops in order, to an airport (either end may
 * be open), over the route network (any day) or as real timed connections with a turnaround
 * window and a duty limit. The search runs in a worker; the form lives in the URL.
 */
export function JourneysApp() {
  const [ready, setReady] = useState(false);
  const [plan, setPlan] = useState<JourneyPlan>(EMPTY_PLAN);
  const [sel, setSel] = useState<string | null>(null);
  const [dep, setDep] = useState<{ vi: number; day: number } | null>(null);
  const [now] = useState(() => Date.now());
  const [shown, setShown] = useState(PAGE);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of the URL after hydration */
    setPlan(planFromParams(p));
    setSel(p.get("j"));
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const timed = plan.timing === "timed";
  const data = useDataset(ready && timed ? (plan.al.length ? plan.al : "all") : []);
  const { manifest, airports, airlines } = data;
  const [routes, setRoutes] = useState<Awaited<ReturnType<typeof loadRoutes>> | null>(null);
  useEffect(() => {
    if (!ready || routes) return;
    let live = true;
    loadRoutes().then(
      (r) => live && setRoutes(r),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [ready, routes]);

  useEffect(() => {
    if (!ready) return;
    const next = `${window.location.pathname}?${planToParams(plan, { j: sel }).toString()}`.replace(/\?$/, "");
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [plan, sel, ready]);

  const update = (patch: Partial<JourneyPlan>) => {
    setPlan((p) => ({ ...p, ...patch }));
    setShown(PAGE);
    setDep(null);
    setSaved(null);
  };
  const pickExample = (x: Partial<JourneyPlan>) => {
    update({ ...EMPTY_PLAN, al: [], ...x });
    setSel(null);
  };
  const pick = (key: string) => {
    setSel(key);
    setDep(null);
    setSaved(null);
  };

  /* ---------- picker options ---------- */

  const placeOpts = useMemo(() => {
    if (!routes || !airports) return [];
    const counts = new Map<string, number>();
    for (const [o, ds] of Object.entries(routes))
      for (const [d, byAl] of Object.entries(ds)) {
        const n = Object.values(byAl).reduce((s, x) => s + x, 0);
        counts.set(o, (counts.get(o) ?? 0) + n);
        counts.set(d, (counts.get(d) ?? 0) + n);
      }
    return placeOptions(counts, airports);
  }, [routes, airports]);

  const airlineOpts = useMemo<MultiOption[]>(
    () =>
      (manifest?.airlines ?? [])
        .map((a) => ({
          value: a.icao,
          label: a.name,
          detail: [a.iata, a.icao].filter(Boolean).join(" / "),
          swatch: routeColor(a),
          count: a.flights,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [manifest],
  );

  const typeOpts = useMemo<MultiOption[]>(() => {
    const fam = new Map<string, number>();
    const exact = new Map<string, number>();
    for (const f of data.flights)
      for (const t of f.types) {
        exact.set(t, (exact.get(t) ?? 0) + 1);
        const g = familyOf(t);
        if (g !== t) fam.set(g, (fam.get(g) ?? 0) + 1);
      }
    return [
      ...[...fam.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ value: v, label: v, detail: "Family", count: n })),
      ...[...exact.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ value: v, label: v, count: n })),
    ];
  }, [data.flights]);

  /* ---------- search data ---------- */

  const pts = useMemo<[string, Pt][] | null>(() => (airports ? [...airports].map(([k, a]) => [k, { lat: a.lat, lon: a.lon, country: a.country }]) : null), [airports]);

  const net = useMemo(() => {
    if (timed || !routes || !manifest) return null;
    const keep = plan.al.length ? new Set(plan.al) : null;
    const edges: RouteEdge[] = [];
    for (const [o, ds] of Object.entries(routes))
      for (const [d, byAl] of Object.entries(ds)) {
        const als = keep ? Object.fromEntries(Object.entries(byAl).filter(([al]) => keep.has(al))) : byAl;
        if (Object.keys(als).length) edges.push({ o, d, als });
      }
    return {
      key: `net|${plan.al.join(",")}|${edges.length}|${manifest.generatedAt}`,
      edges,
    };
  }, [timed, routes, manifest, plan.al]);

  const timedSet = useMemo(() => {
    if (!timed || !manifest || !airports || data.loading.length || data.progress < 1 || !data.flights.length) return null;
    const want = plan.types;
    const rows: FlightRow[] = [];
    const flights: TFlight[] = [];
    let untimed = 0;
    for (const f of data.flights) {
      if (want.length && !f.types.some((t) => want.includes(t) || want.includes(familyOf(t)))) continue;
      const r = enrich(f, airports);
      const block = r.block?.min ?? null;
      let dep = plannedOut(f);
      if (dep == null && block != null && (f.sta ?? f.in) != null) dep = ((((f.sta ?? f.in)! - block) % 1440) + 1440) % 1440;
      if (dep == null || !block) {
        untimed++;
        continue;
      }
      rows.push(f);
      flights.push({ o: f.o, d: f.d, al: f.al, dep, block, days: f.days });
    }
    return {
      key: `timed|${plan.al.join(",")}|${want.join(",")}|${flights.length}|${manifest.generatedAt}`,
      rows,
      flights,
      untimed,
    };
  }, [timed, manifest, airports, data.loading.length, data.progress, data.flights, plan.types, plan.al]);

  const dataKey = timed ? (timedSet?.key ?? null) : (net?.key ?? null);
  const canSearch = ready && !!pts && !!dataKey && !!(plan.from || plan.to);
  const search = useJourneySearch(
    canSearch
      ? {
          key: dataKey!,
          spec: toSpec(plan),
          data: (): JourneyData => (timed ? { kind: "timed", flights: timedSet!.flights, pts: pts! } : { kind: "network", edges: net!.edges, pts: pts! }),
        }
      : null,
  );
  const result = search.resultKey === dataKey ? search.result : null;
  const groups = useMemo(() => result?.groups ?? [], [result]);
  const active = listSort(plan);
  const ordered = useMemo(() => {
    let l = groups;
    if (active === "next") l = [...l].sort((a, b) => soonest(a, now) - soonest(b, now) || a.score - b.score);
    // legs flips in the engine (fewest ⇄ most); the others reverse the list
    return plan.desc && active !== "fewest" ? [...l].reverse() : l;
  }, [groups, active, plan.desc, now]);
  const current = ordered.find((g) => g.key === sel) ?? ordered[0] ?? null;
  const sortList = (v: ListSort) => update(v === active ? { sort: v, desc: !plan.desc } : { sort: v, desc: false });
  const rowsOf = timed ? (timedSet?.rows ?? null) : null;

  /* ---------- status ---------- */

  const loadingTimed = timed && ready && !timedSet;
  const status =
    !ready || !manifest || !airports ? (
      <span className="muted">Loading schedule snapshot…</span>
    ) : loadingTimed ? (
      <span className="muted">Loading every airline’s timetable for timed connections…</span>
    ) : timed && timedSet ? (
      <span>
        <b>Timed connections</b> · {n0(timedSet.flights.length)} flights with times
        <span className="muted hide-xs"> · weekly pattern from the snapshot {manifest.coverage ? `${manifest.coverage.from} → ${manifest.coverage.to}` : ""}</span>
      </span>
    ) : (
      <span>
        <b>Route network</b> · {n0(manifest.counts.routes)} routes · {n0(manifest.counts.airports)} airports
        <span className="muted hide-xs"> · any day, from the snapshot</span>
      </span>
    );

  const summary = !canSearch
    ? ""
    : search.busy && !result
      ? "Searching…"
      : result
        ? result.groups.length
          ? `${n0(result.groups.length)}${result.groups.length >= 240 ? "+" : ""} journey${result.groups.length === 1 ? "" : "s"}${result.legs ? ` · fewest is ${result.legs} leg${result.legs === 1 ? "" : "s"}` : ""}`
          : "No journeys"
        : "";

  return (
    <>
      <TopBar />
      <StatusLine progress={timed && ready && !data.error ? data.progress : null}>{status}</StatusLine>
      <main className="journeys">
        {/* the form waits for the URL (read after hydration), so a shared timed link doesn't grow under the reader */}
        {ready && (
          <>
            <section className="panel jr-form" aria-label="Plan a journey">
              <div className="jr-route">
                <PlacePicker label="From" value={plan.from} options={placeOpts} onChange={(from) => update({ from })} />
                <ViaPicker via={plan.via} options={placeOpts} onChange={(via) => update({ via })} />
                <AvoidPicker avoid={plan.avoid} options={placeOpts} onChange={(avoid) => update({ avoid })} />
                <PlacePicker label="To" value={plan.to} options={placeOpts} onChange={(to) => update({ to })} />
                <button
                  type="button"
                  className="btn btn-icon jr-swap"
                  aria-label="Reverse the journey"
                  title="Reverse the journey"
                  onClick={() =>
                    update({
                      from: plan.to,
                      to: plan.from,
                      via: [...plan.via].reverse(),
                    })
                  }
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M2 5h11M10 2l3 3-3 3M14 11H3M6 8l-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </button>
              </div>

              <div className="jr-opts">
                <LegsPicker legs={plan.legs} onChange={(legs) => update({ legs })} />
                <div className="jr-ctl">
                  <span className="ctl-label" id="jr-timing">
                    <Tip tip={HELP.times} title="Times">
                      Times
                    </Tip>
                  </span>
                  <div className="seg jr-seg" role="radiogroup" aria-labelledby="jr-timing">
                    {(
                      [
                        ["network", "Any day", "Airport to airport on the route network, whatever the day or time"],
                        ["timed", "Timed connections", "Real flights that connect: turnaround window, day and duty limit"],
                      ] as const
                    ).map(([v, label, tip]) => (
                      <button key={v} type="button" role="radio" aria-checked={plan.timing === v} className="seg-btn" title={tip} onClick={() => update({ timing: v })}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <MultiPicker
                  label="Airline"
                  values={plan.al}
                  options={airlineOpts}
                  onChange={(al) => update({ al })}
                  allLabel="All airlines"
                  searchable
                  note="Flights in the snapshot"
                />
                <label className="jr-ctl">
                  <span className="ctl-label">
                    <Tip tip={HELP.detour} title="Detour">
                      Detour
                    </Tip>
                  </span>
                  <select className="ctl-input" value={plan.detour ?? ""} onChange={(e) => update({ detour: e.target.value ? Number(e.target.value) : null })}>
                    {DETOURS.map((d) => (
                      <option key={d} value={d}>
                        ≤ {d}× shortest
                      </option>
                    ))}
                    <option value="">Any</option>
                  </select>
                </label>
                <label className="check jr-one" title={HELP.oneAirline}>
                  <input type="checkbox" checked={plan.oneAirline} onChange={(e) => update({ oneAirline: e.target.checked })} />
                  One airline throughout
                </label>
              </div>

              {timed && (
                <div className="jr-timed">
                  <DayOne day={plan.day} onChange={(day) => update({ day })} />
                  <div className="jr-ctl">
                    <label className="ctl-label" htmlFor="jr-after">
                      <Tip tip={HELP.after} title="First OUT after">
                        First OUT after (Z)
                      </Tip>
                    </label>
                    <div className="after-row">
                      <input
                        id="jr-after"
                        className="ctl-input mono jr-after"
                        type="time"
                        value={plan.after != null ? `${String(Math.floor(plan.after / 60)).padStart(2, "0")}:${String(plan.after % 60).padStart(2, "0")}` : ""}
                        onChange={(e) => {
                          const m = e.target.value.match(/^(\d{2}):(\d{2})$/);
                          update({ after: m ? +m[1] * 60 + +m[2] : null });
                        }}
                      />
                      <button
                        type="button"
                        className="btn after-now"
                        title="The time now, UTC"
                        onClick={() => {
                          const d = new Date();
                          update({ after: d.getUTCHours() * 60 + d.getUTCMinutes() });
                        }}
                      >
                        Now
                      </button>
                    </div>
                  </div>
                  <label className="jr-ctl">
                    <span className="ctl-label">
                      <Tip tip={HELP.duty} title="Duty limit">
                        Duty limit
                      </Tip>
                    </span>
                    <select
                      className="ctl-input"
                      value={plan.dutyMin ?? ""}
                      onChange={(e) =>
                        update({
                          dutyMin: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    >
                      <option value="">No limit</option>
                      {DUTY_HOURS.map((h) => (
                        <option key={h} value={h * 60}>
                          {h} h
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="jr-ctl">
                    <span className="ctl-label">
                      <Tip tip={HELP.report} title="Report before OUT">
                        Report before OUT
                      </Tip>
                    </span>
                    <select className="ctl-input" value={plan.reportMin} onChange={(e) => update({ reportMin: Number(e.target.value) })}>
                      {[0, 30, 45, 60, 75, 90].map((m) => (
                        <option key={m} value={m}>
                          {m} min
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="jr-ctl">
                    <span className="ctl-label" id="jr-turn">
                      <Tip tip={HELP.turnaround} title="Turnaround">
                        Turnaround
                      </Tip>
                    </span>
                    <div className="len-row" role="group" aria-labelledby="jr-turn">
                      <select className="ctl-input" aria-label="Shortest turnaround" value={plan.minTurn} onChange={(e) => update({ minTurn: Number(e.target.value) })}>
                        {[20, 25, 30, 35, 40, 45, 50, 60, 75, 90].map((m) => (
                          <option key={m} value={m} disabled={m > plan.maxTurn}>
                            ≥ {m} min
                          </option>
                        ))}
                      </select>
                      <span aria-hidden="true">–</span>
                      <select className="ctl-input" aria-label="Longest turnaround" value={plan.maxTurn} onChange={(e) => update({ maxTurn: Number(e.target.value) })}>
                        {[60, 90, 120, 150, 180, 240, 300, 360, 480].map((m) => (
                          <option key={m} value={m} disabled={m < plan.minTurn}>
                            ≤ {dur(m)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <MultiPicker label="Aircraft" values={plan.types} options={typeOpts} onChange={(types) => update({ types })} allLabel="Any type" searchable />
                </div>
              )}

              <div className="jr-examples" aria-label="Examples">
                <span className="ctl-label">Try</span>
                {EXAMPLES.map((x) => (
                  <button
                    key={x.label}
                    type="button"
                    className="jr-example"
                    title={x.note}
                    onClick={() => pickExample(x.plan)}
                  >
                    {x.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn jr-clear"
                  disabled={!planToParams(plan).toString()}
                  onClick={() => {
                    update(EMPTY_PLAN);
                    setSel(null);
                  }}
                >
                  Clear
                </button>
              </div>
              {canSearch && (
                <details className="jr-guide">
                  <summary>What the options mean</summary>
                  <OptionGuide />
                </details>
              )}
            </section>

            {!canSearch ? (
              <section className="panel jr-intro">
                <h2 className="brief-title">Plan a multi-leg journey</h2>
                <p className="muted">
                  Chain flights from the snapshot into a journey of several legs: a way between two airports with no direct flight, a day of flying that fits a duty, or a round trip.
                  Choose where it starts, where it ends, or both, and add stops to pass through in order. Leave the end open to roam; leave the start open to work backwards from
                  where you want to finish.
                </p>
                <h3 className="jr-h3">Examples</h3>
                <p className="muted small">Each one fills in the form above, so you can see how it is set up and change it.</p>
                <ul className="jr-ex-cards">
                  {EXAMPLES.map((x) => (
                    <li key={x.label}>
                      <button type="button" className="jr-ex-card" onClick={() => pickExample(x.plan)}>
                        <b>{x.label}</b>
                        <span>{x.note}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <h3 className="jr-h3">What each option means</h3>
                <OptionGuide />
                <h3 className="jr-h3">Reading the results</h3>
                <ul className="jr-how">
                  <li>
                    Each card is one way through the airports, with every airline that flies each leg. The headings above the list sort it; click one again to reverse.
                  </li>
                  <li>
                    <b>Duty</b> runs from report to the last IN; <b>Ground</b> is the time between legs. With timed connections, the soonest date from today is on each card.
                  </li>
                  <li>
                    Pick a card to see it on the map, every timing that works, and each leg with buttons to brief it, open SimBrief, or save the journey as a group in Saved.
                  </li>
                  <li>
                    <b>Shuffle</b> searches in a different order, so other journeys come up when there are more than the search can list.
                  </li>
                </ul>
              </section>
            ) : (
              <section className="panel jr-results" aria-label="Journeys">
                <div className="jr-bar">
                  <span className="jr-count" aria-live="polite">
                    {summary}
                    {search.busy && result ? <span className="muted"> · updating…</span> : null}
                  </span>
                  {result && search.ms != null && (
                    <span className="muted small mono hide-xs">
                      {n0(result.expansions)} steps · {search.ms} ms
                      {result.capped ? " · search limit reached" : ""}
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn jr-shuffle"
                    onClick={() => update({ seed: 1 + Math.floor(Math.random() * 1e6) })}
                    title="Search in a different order: other journeys come up when there are more than the search covers, and Shuffled order changes"
                  >
                    Shuffle
                  </button>
                </div>
                {search.error ? (
                  <p className="empty-note">{search.error}</p>
                ) : !result ? (
                  <div className="jr-skel" aria-hidden="true">
                    {Array.from({ length: 6 }, (_, i) => (
                      <i key={i} />
                    ))}
                  </div>
                ) : !groups.length ? (
                  <div className="empty-note">
                    <p>{result.reason}</p>
                    <p className="muted small">
                      {timed
                        ? "Try a longer turnaround, a higher duty limit, any day, more legs, or switch to Any day to see whether the route network connects at all."
                        : "Try more legs, all airlines, or without One airline throughout."}
                    </p>
                  </div>
                ) : (
                  <div className={cx("jr-split", search.busy && "is-stale")}>
                    {current && (
                      <JourneyDetail
                        key={current.key}
                        group={current}
                        dep={dep}
                        onDep={(d) => setDep({ vi: d.vi, day: d.day })}
                        now={now}
                        rows={rowsOf}
                        airports={airports!}
                        airlines={airlines}
                        reportMin={plan.reportMin}
                        saved={saved}
                        onSave={(name, flights) => setSaved(saveJourney(name, flights))}
                        onTime={() => {
                          const s = current.stops;
                          update({
                            from: s[0],
                            to: s[s.length - 1],
                            via: s.slice(1, -1),
                            legs: { kind: "exact", n: s.length - 1 },
                            timing: "timed",
                            sort: "next",
                          });
                        }}
                      />
                    )}
                    <div className="jr-listcol">
                    <div className="jr-sorts" role="group" aria-label="Sort journeys">
                      <span className="ctl-label">Sort</span>
                      {SORTS.filter((x) => timed || !x.timed).map((x) => {
                        const on = active === x.value;
                        const arrow = x.value === "random" ? "" : on ? (plan.desc ? "▼" : "▲") : "";
                        return (
                          <button
                            key={x.value}
                            type="button"
                            className="jr-sort"
                            aria-pressed={on}
                            title={`${x.tip}${x.value === "random" ? "" : on ? (plan.desc ? " · highest first" : " · lowest first") : ""}`}
                            onClick={() => sortList(x.value)}
                          >
                            {x.label}
                            <span className="th-arrow" aria-hidden="true">
                              {arrow}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <ol className="jr-list">
                      {ordered.slice(0, shown).map((g, i) => (
                        <li key={g.key}>
                          <JourneyCard no={i + 1} group={g} on={g.key === current?.key} onPick={() => pick(g.key)} rows={rowsOf} airlines={airlines} now={now} byDate={active === "next"} />
                        </li>
                      ))}
                      {groups.length > shown && (
                        <li>
                          <button type="button" className="btn jr-more" onClick={() => setShown((n) => n + PAGE)}>
                            Show {Math.min(PAGE, groups.length - shown)} more of {n0(groups.length - shown)}
                          </button>
                        </li>
                      )}
                    </ol>
                    </div>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

/* ---------- form pieces ---------- */

function ViaPicker({ via, options, onChange }: { via: string[]; options: ReturnType<typeof placeOptions>; onChange: (v: string[]) => void }) {
  const name = (v: string) => (v.startsWith("C:") ? countryName(v.slice(2)) : v);
  return (
    <div className="jr-via">
      <PlacePicker
        label={via.length ? `Then via (stop ${via.length + 1})` : "Via (optional)"}
        value={null}
        options={options.filter((o) => !via.includes(o.value))}
        anyLabel="Add a stop"
        onChange={(v) => v && onChange([...via, v])}
      />
      {via.length > 0 && (
        <ol className="jr-chips" aria-label="Stops in order">
          {via.map((v, i) => (
            <li key={v} className="jr-chip">
              <span className="mono">{i + 1}</span> {name(v)}
              {i > 0 && (
                <button
                  type="button"
                  aria-label={`Move ${name(v)} earlier`}
                  title="Earlier"
                  onClick={() => onChange(via.map((x, k) => (k === i - 1 ? v : k === i ? via[i - 1] : x)))}
                >
                  ↑
                </button>
              )}
              <button type="button" aria-label={`Remove ${name(v)}`} title="Remove" onClick={() => onChange(via.filter((x) => x !== v))}>
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Countries or airports to keep out of the journey (e.g. “avoid Germany”). */
function AvoidPicker({ avoid, options, onChange }: { avoid: string[]; options: ReturnType<typeof placeOptions>; onChange: (v: string[]) => void }) {
  const name = (v: string) => (v.startsWith("C:") ? countryName(v.slice(2)) : v);
  return (
    <div className="jr-avoid">
      <PlacePicker
        label="Avoid (optional)"
        value={null}
        options={options.filter((o) => !avoid.includes(o.value))}
        anyLabel="Add a country or airport"
        onChange={(v) => v && onChange([...avoid, v])}
      />
      {avoid.length > 0 && (
        <ul className="jr-chips" aria-label="Places to avoid">
          {avoid.map((v) => (
            <li key={v} className="jr-chip jr-chip-avoid">
              <span aria-hidden="true">⊘</span> {name(v)}
              <button type="button" aria-label={`Stop avoiding ${name(v)}`} title="Remove" onClick={() => onChange(avoid.filter((x) => x !== v))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Every option with what it does, in form order; timed-only ones are marked. */
function OptionGuide() {
  const rows: [string, string, boolean?][] = [
    ["From", HELP.from],
    ["Via", HELP.via],
    ["Avoid", HELP.avoid],
    ["To", HELP.to],
    ["Legs", HELP.legs],
    ["Times", HELP.times],
    ["Airline", HELP.airline],
    ["Detour", HELP.detour],
    ["One airline throughout", HELP.oneAirline],
    ["Day (UTC)", HELP.day, true],
    ["First OUT after (Z)", HELP.after, true],
    ["Duty limit", HELP.duty, true],
    ["Report before OUT", HELP.report, true],
    ["Turnaround", HELP.turnaround, true],
    ["Aircraft", HELP.aircraft, true],
  ];
  return (
    <dl className="jr-defs">
      {rows.map(([k, v, timed]) => (
        <div key={k}>
          <dt>
            {k}
            {timed && <span className="jr-timed-tag">Timed</span>}
          </dt>
          <dd>{v.replace(/^Timed only: (.)/, (_, c: string) => c.toUpperCase())}</dd>
        </div>
      ))}
    </dl>
  );
}

function LegsPicker({ legs, onChange }: { legs: JourneyPlan["legs"]; onChange: (l: JourneyPlan["legs"]) => void }) {
  const n = legs.kind === "fewest" ? 3 : legs.n;
  return (
    <div className="jr-ctl">
      <span className="ctl-label" id="jr-legs">
        <Tip tip={HELP.legs} title="Legs">
          Legs
        </Tip>
      </span>
      <div className="jr-legs">
        <div className="seg jr-seg" role="radiogroup" aria-labelledby="jr-legs">
          {(
            [
              ["fewest", "Fewest"],
              ["exact", "Exactly"],
              ["upto", "Up to"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={legs.kind === k} className="seg-btn" onClick={() => onChange(k === "fewest" ? { kind: k } : { kind: k, n })}>
              {label}
            </button>
          ))}
        </div>
        <select
          className="ctl-input jr-n"
          aria-label="Number of legs"
          value={n}
          disabled={legs.kind === "fewest"}
          onChange={(e) => legs.kind !== "fewest" && onChange({ kind: legs.kind, n: Number(e.target.value) })}
        >
          {[1, 2, 3, 4, 5, 6, 7, 8].map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function DayOne({ day, onChange }: { day: number | null; onChange: (d: number | null) => void }) {
  const full = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return (
    <div className="days" role="radiogroup" aria-label="Day of the first departure (UTC)">
      <span className="ctl-label">
        <Tip tip={HELP.day} title="Day">
          Day (UTC)
        </Tip>
      </span>
      <div className="days-row">
        <button type="button" className="day day-any" role="radio" aria-checked={day == null} onClick={() => onChange(null)}>
          Any
        </button>
        {["M", "T", "W", "T", "F", "S", "S"].map((l, i) => (
          <button key={i} type="button" className="day" role="radio" aria-checked={day === i + 1} aria-label={full[i]} title={full[i]} onClick={() => onChange(i + 1)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- results ---------- */

/** The airline of each leg: the flight's brand (timed) or the busiest brand on the route. */
function legAirlines(j: Journey, rows: FlightRow[] | null): string[] {
  if (j.timed && rows) return j.timed.legs.map((l) => rows[l.f]?.al ?? "");
  return (j.net ?? []).map((l) => l.als[0]?.[0] ?? "");
}

const clockZ = (t: number) => `${hhmm(t % 1440)}Z`;
const plusDay = (t: number, start: number) => {
  const d = Math.floor(t / 1440) - Math.floor(start / 1440);
  return d > 0 ? <sup className="jr-plus">+{d}</sup> : null;
};

function JourneyCard({
  no,
  group,
  on,
  onPick,
  rows,
  airlines,
  now,
  byDate,
}: {
  no: number;
  group: Group;
  on: boolean;
  onPick: () => void;
  rows: FlightRow[] | null;
  airlines: Map<string, AirlineInfo>;
  now: number;
  byDate: boolean;
}) {
  // timed: by date, the soonest timing; otherwise the best timing (what the list is sorted on) and its next date
  const deps = group.best.timed ? departures(group, now) : [];
  const next = (byDate ? deps[0] : deps.find((d) => d.vi === 0)) ?? null;
  const j = next?.v ?? group.best;
  const legs = j.stops.length - 1;
  const als = legAirlines(j, rows);
  const t = j.timed;
  return (
    <button type="button" className="jr-card" aria-pressed={on} onClick={onPick}>
      <span className="jr-no mono">{no}</span>
      <span className="jr-chain mono">
        {j.stops.map((s, i) => (
          <span key={i} className="jr-stop">
            {i > 0 && (
              <i
                className="jr-hop"
                style={{
                  ["--c" as string]: routeColor(airlines.get(als[i - 1])),
                }}
                aria-hidden="true"
              />
            )}
            {s}
          </span>
        ))}
      </span>
      <span className="jr-meta">
        <span>
          {legs} leg{legs === 1 ? "" : "s"}
        </span>
        <span>{n0(j.nm)} nm</span>
        {t ? (
          <>
            {next && (
              <span>
                next <b>{dateLabel(next.at)}</b>
              </span>
            )}
            <span className="mono">
              {clockZ(t.start)}–{clockZ(t.end)}
              {plusDay(t.end, t.start)}
            </span>
            <span>duty {dur(t.duty)}</span>
          </>
        ) : (
          <span>≈ {dur((j.net ?? []).reduce((s, l) => s + estBlock(l.nm), 0))} block</span>
        )}
        {group.variants.length > 1 && <span className="muted">{group.variants.length} timings</span>}
      </span>
      <span className="jr-als">{[...new Set(als)].map((a) => airlines.get(a)?.name ?? a).join(" · ")}</span>
    </button>
  );
}

function JourneyDetail({
  group,
  dep,
  onDep,
  now,
  rows,
  airports,
  airlines,
  reportMin,
  saved,
  onSave,
  onTime,
}: {
  group: Group;
  dep: { vi: number; day: number } | null;
  onDep: (d: Departure) => void;
  now: number;
  rows: FlightRow[] | null;
  airports: Map<string, Airport>;
  airlines: Map<string, AirlineInfo>;
  reportMin: number;
  saved: string | null;
  onSave: (name: string, flights: FlightRow[]) => void;
  onTime: () => void;
}) {
  const deps = useMemo(() => departures(group, now), [group, now]);
  const sel = deps.find((d) => d.vi === dep?.vi && d.day === dep?.day) ?? deps[0] ?? null;
  const j = sel?.v ?? group.best;
  const fnOv = useFnOverrides();
  const frames = useAirframes();
  const [hover, setHover] = useState<number | null>(null);
  const als = legAirlines(j, rows);
  const t = j.timed;
  const flights = t && rows ? t.legs.map((l) => applyFn(rows[l.f], fnOv)) : null;
  const title = `${j.stops[0]} → ${j.stops[j.stops.length - 1]}${j.stops.length > 2 ? ` via ${j.stops.slice(1, -1).join(", ")}` : ""}`;

  const mapRoutes: MapRoute[] = [];
  for (let i = 0; i < j.stops.length - 1; i++) {
    const a = airports.get(j.stops[i]);
    const b = airports.get(j.stops[i + 1]);
    if (a && b)
      mapRoutes.push({
        key: `${i}`,
        from: a,
        to: b,
        color: routeColor(airlines.get(als[i])),
        active: hover === i,
        label: `leg ${i + 1}`,
      });
  }

  return (
    <article className="jr-detail" aria-label={`Journey ${title}`}>
      <header className="jr-dhead">
        <h2 className="jr-title mono">{j.stops.join(" › ")}</h2>
        <p className="jr-facts">
          <span>
            <b>{j.stops.length - 1}</b> legs
          </span>
          <span>
            <b>{n0(j.nm)}</b> nm
          </span>
          {t ? (
            <>
              {sel && (
                <span>
                  <b>{dateLabel(sel.at)}</b>
                  {relDay(sel.at, now) && <span className="muted"> ({relDay(sel.at, now)})</span>}
                </span>
              )}
              <span>
                OUT <b className="mono">{clockZ(t.start)}</b> → IN <b className="mono">{clockZ(t.end)}</b>
                {plusDay(t.end, t.start)}
              </span>
              <span title={`Report ${reportMin} min before the first OUT, to on-blocks after the last leg`}>
                duty <b>{dur(t.duty)}</b>
              </span>
              <span>
                block <b>{dur(t.block)}</b>
              </span>
              <span>
                on the ground <b>{dur(t.wait)}</b>
              </span>
            </>
          ) : (
            <span>
              ≈ <b>{dur((j.net ?? []).reduce((s, l) => s + estBlock(l.nm), 0))}</b> block
            </span>
          )}
        </p>
      </header>
      <RouteMap routes={mapRoutes} height={300} label={`Map of the journey ${title}.`} />
      {t && rows && deps.length > 0 && <JourneyTimings deps={deps} sel={sel} onPick={onDep} rows={rows} airlines={airlines} now={now} />}
      <ol className="jr-legs-list">
        {j.stops.slice(0, -1).map((o, i) => {
          const d = j.stops[i + 1];
          const leg = t?.legs[i];
          const f = flights?.[i];
          const next = t?.legs[i + 1];
          const nl = j.net?.[i];
          return (
            <li key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              <div className="jr-leg">
                <span className="jr-leg-no mono">{i + 1}</span>
                <div className="jr-leg-main">
                  <p className="jr-leg-route">
                    <b className="mono">{o}</b> → <b className="mono">{d}</b>
                    <span className="muted">
                      {" "}
                      {airportLabel(airports.get(o))} to {airportLabel(airports.get(d))}
                    </span>
                  </p>
                  {f && leg ? (
                    <div className="jr-leg-flight">
                      <FlightIdent airline={airlines.get(f.al)} ident={flightNo(f, airlines.get(f.al)?.iata ?? null)} fallback={f.al} />
                      {f.types[0] && <TypeBadge type={f.types[0]} airline={airlines.get(f.al)} guessed={f.typeGuessed} />}
                      <span className="mono jr-times">
                        OUT {clockZ(leg.t0)}
                        {plusDay(leg.t0, t!.start)} · IN {clockZ(leg.t1)}
                        {plusDay(leg.t1, t!.start)}
                      </span>
                      <span className="muted">{dur(leg.t1 - leg.t0)}</span>
                    </div>
                  ) : nl ? (
                    <div className="jr-leg-flight">
                      {nl.als.slice(0, 4).map(([al, n]) => {
                        const a = airlines.get(al);
                        return (
                          <span key={al} className="jr-al" title={`${a?.name ?? al}: ${n} flight${n === 1 ? "" : "s"} in the snapshot`}>
                            <AirlineTag name={a?.name ?? al} color={routeColor(a)} style="solid" />
                          </span>
                        );
                      })}
                      {nl.als.length > 4 && <span className="muted">+{nl.als.length - 4} more</span>}
                      <span className="muted">
                        {n0(nl.nm)} nm · ≈ {dur(estBlock(nl.nm))}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="jr-leg-acts">
                  {f ? (
                    <>
                      <Link className="btn" href={`/brief?f=${encodeURIComponent(f.id)}${sel && leg ? `&d=${legDate(sel, leg.t0)}` : ""}`}>
                        Brief
                      </Link>
                      <Link className="btn" href={`/board?tab=gate&f=${encodeURIComponent(f.id)}${sel && leg ? `&d=${legDate(sel, leg.t0)}` : ""}`}>
                        Gate
                      </Link>
                      <a className="btn" href={sbLink(f, frames)} target="_blank" rel="noopener noreferrer">
                        SimBrief ↗
                      </a>
                    </>
                  ) : (
                    <Link className="btn" href={`/?${queryToParams({ ...EMPTY_QUERY, al: nl?.als.map((a) => a[0]) ?? [], dep: o, arr: d }).toString()}`}>
                      Flights
                    </Link>
                  )}
                </div>
              </div>
              {leg && next && (
                <p className="jr-turn">
                  Turn at <b className="mono">{d}</b> · <b>{dur(next.t0 - leg.t1)}</b> on the ground
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <div className="jr-acts">
        {flights ? (
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onSave(title.replace(/ via .*/, ` via ${j.stops.length - 2} stop${j.stops.length === 3 ? "" : "s"}`).replace(/ via 0 stops/, ""), flights)}
            >
              Save as a favourites group
            </button>
            {saved && (
              <span className="small" role="status">
                Saved as “{saved}”. It’s on the <Link href="/brief">Brief</Link> start page and in Settings.
              </span>
            )}
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={onTime}>
              Find timed connections on this route
            </button>
            <span className="small muted">Real flights along these airports, with turnarounds and duty.</span>
          </>
        )}
      </div>
    </article>
  );
}

function sbLink(f: FlightRow, frames: ReturnType<typeof useAirframes>): string {
  const choice = defaultChoice(f, frames);
  const c = typeChoices(f, frames).find((x) => x.value === choice);
  return simbriefUrl(flightDispatch(f, c?.sbType ?? f.types[0] ?? "A320"));
}
