"use client";

import { Flag } from "./Flag";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { airportLabel, cityName, dur, hhmm } from "@/lib/data/flight";
import type { Airport } from "@/lib/data/load";
import type { Destination, Row, Sort, SortKey } from "@/lib/data/query";
import type { AirlineInfo } from "@/lib/data/types";
import { routeColor, textOn } from "@/lib/colors";
import { GLOSSARY } from "@/lib/glossary";
import { useFontsReady, widestLabel } from "@/lib/measure";
import { RouteMap } from "./RouteMap";
import { FlightIdent, GuessMark, MoreTypes, TypeBadge, VariesMark, WeekStrip, freqLabel, guessedEnd } from "./badges";
import { Tip, cx } from "./ui";
import { useDisplay } from "@/lib/display";
import { countryName } from "@/lib/places";

const PAGE = 80;

const COLS: [SortKey, string, string | null, string?][] = [
  ["flight", "Flight", null],
  ["dep", "From", null],
  ["arr", "To", null],
  ["std", "Dep Z", GLOSSARY.depCol, "num"],
  ["sta", "Arr Z", GLOSSARY.arrCol, "num hide-s c-arr"],
  ["block", "Block", GLOSSARY.block, "num"],
  ["dist", "Dist", GLOSSARY.distance, "num hide-s c-dist"],
  ["type", "Type", GLOSSARY.types, "hide-xs"],
  ["freq", "Freq", GLOSSARY.freq, "num hide-xs"],
];

/** Sortable, paged flight list. Clicking a row selects it. */
export function FlightTable({
  rows,
  sort,
  onSort,
  selected,
  onSelect,
  airports,
  airlines,
  short = false,
  pin,
  pinShort = false,
  renderOpen,
}: {
  rows: Row[];
  sort: Sort | null;
  onSort: (s: Sort | null) => void;
  selected: string | null;
  onSelect: (r: Row) => void;
  airports: Map<string, Airport> | null;
  airlines: Map<string, AirlineInfo>;
  /** Short rows: flight, the ends the filter leaves open (city first), times, block and type. */
  short?: boolean;
  /** What the filter pins down: one airline, one origin airport, one destination airport. */
  pin?: { al: boolean; dep: boolean; arr: boolean };
  /** Full rows with what the filter pins shown short: the airline as a colour square, a pinned airport as its code. */
  pinShort?: boolean;
  /** The picked row opens in place: what to show in a full-width row under it. */
  renderOpen?: (r: Row) => ReactNode;
}) {
  const [limit, setLimit] = useState(PAGE);
  // A new result set starts at the first page (adjusted during render, not in an effect).
  const [prevRows, setPrevRows] = useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    setLimit(PAGE);
  }
  const shown = rows.slice(0, limit);
  const identOf = (r: Row) => (r.f.fn ? `${airlines.get(r.f.al)?.iata ?? r.f.al}${r.f.fn}` : (r.f.cs ?? `${r.f.op} —`));
  // One width for every flight number and airline tag in the whole result (not just this page), so the
  // columns line up and don't change width when more rows are shown.
  // Flight numbers are mono, so characters give the width; airline names are measured in their real font.
  const fontsReady = useFontsReady();
  const { idW, alW } = useMemo(() => {
    let id = 4;
    const names = new Set<string>();
    for (const r of rows) {
      id = Math.max(id, identOf(r).length);
      names.add(airlines.get(r.f.al)?.name ?? r.f.al);
    }
    return { idW: id, alW: Math.min(150, widestLabel(names)) + 1 };
    // identOf only reads airlines; fontsReady re-measures once the face has loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, airlines, fontsReady]);
  const name = (icao: string) => {
    const a = airports?.get(icao);
    return a ? (cityName(a) ?? a.name) : "";
  };
  // what each row shows: short rows drop what the filter already says, and the columns nobody needs to pick a flight
  const p = pin ?? { al: false, dep: false, arr: false };
  const dotKey = useDisplay().variesMark === "dot";
  const SHORT_OUT: SortKey[] = ["dist", "freq"];
  const cols = COLS.filter(([k]) => !short || !(SHORT_OUT.includes(k) || (k === "dep" && p.dep) || (k === "arr" && p.arr)));
  const has = (k: SortKey) => cols.some(([c]) => c === k);
  const square = (short || pinShort) && p.al;
  const codeOnly = (side: "dep" | "arr") => !short && pinShort && p[side];
  const place = (icao: string, side: "o" | "d", f: Row["f"]) =>
    short ? (
      <>
        <span className="city-first">{name(icao) || icao}</span>
        {guessedEnd(f, side) && <GuessMark side={side} name={name(icao)} />} <small className="mono muted">{icao}</small>
      </>
    ) : (
      <>
        <span className="mono">{icao}</span>
        {guessedEnd(f, side) && <GuessMark side={side} name={name(icao)} />}
        {!codeOnly(side === "o" ? "dep" : "arr") && (
          <>
            {" "}
            <small className="muted city">{name(icao)}</small>
          </>
        )}
      </>
    );

  return (
    <div className="results">
      <div className="tbl-wrap">
        <table className={cx("tbl flights", short && "short")} style={{ ["--id-w" as string]: `${idW}ch`, ["--al-w" as string]: `${alW}px` }}>
          <caption className="sr-only">Flights matching the filters, {rows.length} in total. Select a flight to see its details.</caption>
          <thead>
            <tr>
              {cols.map(([k, label, tip, cls]) => {
                const on = sort?.key === k;
                return (
                  <th key={k} scope="col" className={cls} aria-sort={on ? (sort!.dir === 1 ? "ascending" : "descending") : undefined}>
                    <button type="button" className="th-sort" onClick={() => onSort({ key: k, dir: on ? (sort!.dir === 1 ? -1 : 1) : 1 })}>
                      {tip ? (
                        <Tip tip={tip} title={label} plain>
                          {label}
                        </Tip>
                      ) : (
                        label
                      )}
                      {dotKey && (k === "std" || k === "sta") && <span className="var-dot th-dot" role="img" aria-label="a dot after a time: other days differ" title="A dot after a time: other days differ" />}
                      <span className="th-arrow" aria-hidden="true">
                        {on ? (sort!.dir === 1 ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  </th>
                );
              })}
              {!short && (
                <th scope="col" className="hide-s">
                  <Tip tip={GLOSSARY.days} title="Days" plain>
                    Days
                  </Tip>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const { f } = r;
              const al = airlines.get(f.al);
              const sel = selected === f.id;
              const open = sel && renderOpen;
              return (
                <Fragment key={f.id}>
                <tr className={cx(sel && "sel", open && "is-open")} onClick={() => onSelect(r)}>
                  <td>
                    <button
                      type="button"
                      className="row-btn"
                      aria-pressed={sel}
                      aria-expanded={renderOpen ? sel : undefined}
                      title={f.fn && f.cs ? `Callsign ${f.cs}` : undefined}
                      onClick={(e) => (e.stopPropagation(), onSelect(r))}
                    >
                      {square ? (
                        <span className="id-sq">
                          <span className="al-sq" style={{ background: routeColor(al) }} title={al?.name ?? f.al} aria-hidden="true" />
                          <span className="mono">{identOf(r)}</span>
                        </span>
                      ) : (
                        <FlightIdent airline={al} fallback={f.al} ident={identOf(r)} />
                      )}
                    </button>
                  </td>
                  {has("dep") && <td>{place(f.o, "o", f)}</td>}
                  {has("arr") && <td>{place(f.d, "d", f)}</td>}
                  <td className="mono num">
                    <VariesMark f={f}>
                      <Clock sched={f.std} obs={f.out ?? f.off} kind={f.out != null ? "OUT" : "OFF"} />
                    </VariesMark>
                  </td>
                  <td className="mono num hide-s c-arr">
                    <VariesMark f={f}>
                      <Clock sched={f.sta} obs={f.in ?? f.on} kind={f.in != null ? "IN" : "ON"} />
                    </VariesMark>
                  </td>
                  <td className="mono num">
                    {dur(r.block?.min) ?? "—"}
                    {r.block?.source === "estimated" && (
                      <span className="est" title="Estimated from distance">
                        ~
                      </span>
                    )}
                  </td>
                  {has("dist") && <td className="mono num hide-s c-dist">{r.nm ?? "—"}</td>}
                  <td className="hide-xs">
                    {f.types[0] ? <TypeBadge type={f.types[0]} airline={al} guessed={f.typeGuessed} /> : "—"}
                    <MoreTypes types={f.types.slice(1)} />
                  </td>
                  {has("freq") && <td className="mono num hide-xs freq">{freqLabel(f.days) ?? <span className="muted">—</span>}</td>}
                  {!short && (
                    <td className="hide-s">
                      <WeekStrip days={f.days} />
                    </td>
                  )}
                </tr>
                {open && (
                  <tr className="row-open">
                    <td colSpan={cols.length + (short ? 0 : 1)}>{renderOpen(r)}</td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="more">
          <span className="muted">
            Showing {limit.toLocaleString("en-GB")} of {rows.length.toLocaleString("en-GB")}
          </span>
          <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE * 2)}>
            Show {Math.min(PAGE * 2, rows.length - limit)} more
          </button>
        </div>
      )}
    </div>
  );
}

/** A scheduled time, or a typical tracked one (marked, with its OOOI kind in the tooltip). */
function Clock({ sched, obs, kind }: { sched: number | null; obs: number | null; kind: string }) {
  if (sched != null) return <>{hhmm(sched)}</>;
  if (obs != null)
    return (
      <span className="obs" title={`Typical ${kind} time from tracked flights (no published schedule)`}>
        {hhmm(obs)}
      </span>
    );
  return <span className="muted">—</span>;
}

/** Tooltip for the airline squares: up to six airline badges in their colours, then a "+n" badge. */
function airlineTip(codes: string[], airlines: Map<string, AirlineInfo>) {
  const SHOW = 6;
  const chips: { label: string; color: string; ink: string }[] = codes.slice(0, SHOW).map((c) => {
    const a = airlines.get(c);
    const color = routeColor(a);
    return { label: a?.name ?? c, color, ink: textOn(color) };
  });
  if (codes.length > SHOW) chips.push({ label: `+${codes.length - SHOW} more`, color: "var(--sheet)", ink: "var(--ink)" });
  return {
    "data-tip": `${codes.length} ${codes.length === 1 ? "airline flies" : "airlines fly"} this route.`,
    "data-tip-chips": JSON.stringify(chips),
  };
}

type PlaceSort = "weekly" | "name" | "block" | "dist";

/**
 * Destinations from the chosen origin (or origins into the chosen destination): a fan
 * map in airline colours plus a list. Picking one narrows the finder to that route.
 */
export function PlacesView({
  places,
  side,
  hub,
  airports,
  airlines,
  onPick,
  country = null,
  countries = [],
  onCountry,
}: {
  places: Destination[];
  /** Which end is free: "d" lists destinations, "o" lists origins. */
  side: "d" | "o";
  hub: string | null;
  airports: Map<string, Airport> | null;
  airlines: Map<string, AirlineInfo>;
  onPick: (icao: string) => void;
  /** Only this country's airports (ISO code); null = every country. */
  country?: string | null;
  /** The countries in the unfiltered list, with how many airports each. */
  countries?: { cc: string; name: string; n: number }[];
  onCountry?: (cc: string | null) => void;
}) {
  const [sort, setSort] = useState<PlaceSort>("weekly");
  const sorted = useMemo(() => {
    const n = (icao: string) => airportLabel(airports?.get(icao)) || icao;
    const l = [...places];
    if (sort === "weekly") l.sort((a, b) => b.weekly - a.weekly);
    if (sort === "name") l.sort((a, b) => n(a.icao).localeCompare(n(b.icao)));
    if (sort === "block") l.sort((a, b) => (a.minBlock ?? 1e9) - (b.minBlock ?? 1e9));
    if (sort === "dist") l.sort((a, b) => (a.nm ?? 1e9) - (b.nm ?? 1e9));
    return l;
  }, [places, sort, airports]);

  const hubAirport = hub ? airports?.get(hub) : null;
  const routes = useMemo(() => {
    if (!hubAirport || !airports) return [];
    return places.flatMap((p) => {
      const other = airports.get(p.icao);
      if (!other) return [];
      const al = airlines.get(p.airlines[0]);
      return [
        {
          key: p.icao,
          from: side === "d" ? hubAirport : other,
          to: side === "d" ? other : hubAirport,
          color: routeColor(al),
          label: `${p.flights.length} ${p.flights.length === 1 ? "flight" : "flights"}`,
        },
      ];
    });
  }, [places, hubAirport, airports, airlines, side]);

  const what = side === "d" ? "destinations" : "origins";
  const countryLabel = country ? (countries.find((c) => c.cc === country)?.name ?? countryName(country)) : "";
  const maxWeekly = Math.max(1, ...places.map((p) => p.weekly));
  // block-time scale: 0 to the next whole hour above the longest, at least 4 h
  const scaleMax = Math.max(240, Math.ceil(Math.max(0, ...places.map((p) => p.maxBlock ?? 0)) / 60) * 60);
  return (
    <div className="places">
      {hubAirport && routes.length > 0 && (
        <RouteMap
          routes={routes}
          height={440}
          onPick={onPick}
          onRoute={onPick}
          label={`Map of ${places.length} ${what} ${side === "d" ? "from" : "to"} ${airportLabel(hubAirport)}. Select an airport to see its flights.`}
        />
      )}
      <div className="places-head">
        <p className="muted">
          {places.length} {what}
          {country && ` in ${countryLabel}`}
          {hubAirport && (side === "d" ? ` from ${hubAirport.iata ?? hub}` : ` into ${hubAirport.iata ?? hub}`)}.{" "}
          {places.length ? `Pick one to see its flights. Block-time bars run from 0 to ${Math.round(scaleMax / 60)} h.` : "Pick another country, or every country."}
        </p>
        <div className="places-ctls">
          {onCountry && (
            <label className="inline-ctl">
              <span className="ctl-label">Country</span>
              <select className="ctl-input places-cc" value={country ?? ""} onChange={(e) => onCountry(e.target.value || null)}>
                <option value="">Every country ({countries.reduce((n, c) => n + c.n, 0)})</option>
                {country && !countries.some((c) => c.cc === country) && <option value={country}>{countryLabel} (0)</option>}
                {countries.map((c) => (
                  <option key={c.cc} value={c.cc}>
                    {c.name} ({c.n})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="inline-ctl">
            <span className="ctl-label">Sort</span>
            <select className="ctl-input" value={sort} onChange={(e) => setSort(e.target.value as PlaceSort)}>
              <option value="weekly">Most flights</option>
              <option value="name">Name</option>
              <option value="block">Shortest</option>
              <option value="dist">Nearest</option>
            </select>
          </label>
        </div>
      </div>
      <div className="place-head" aria-hidden="true">
        <div className="ph-grid">
          <span className="ph-ap">{side === "d" ? "Destination" : "Origin"}</span>
          <span>Flights / week</span>
          <span className="hide-s">Block time</span>
          <span className="hide-xs ph-nm">Distance</span>
        </div>
        <span className="place-types hide-s">Aircraft</span>
      </div>
      <ul className="place-list">
        {sorted.map((p) => {
          const a = airports?.get(p.icao);
          const block = p.minBlock != null ? (p.minBlock === p.maxBlock ? dur(p.minBlock) : `${dur(p.minBlock)}–${dur(p.maxBlock)}`) : null;
          return (
            <li key={p.icao}>
              <div className="place">
                <button type="button" className="place-main" onClick={() => onPick(p.icao)} aria-label={`${a ? airportLabel(a) : p.icao}: ${p.airlines.map((c) => airlines.get(c)?.name ?? c).join(", ")}; ${p.weekly} flights a week${block ? `, block ${block}` : ""}${p.nm != null ? `, ${p.nm} NM` : ""}`}>
                  <span className="place-al" aria-hidden="true" {...airlineTip(p.airlines, airlines)}>
                    {p.airlines.slice(0, 4).map((al) => (
                      <i key={al} style={{ background: routeColor(airlines.get(al)) }} />
                    ))}
                  </span>
                  <span className="mono place-code">{p.icao}</span>
                  <span className="place-name">
                    {a?.country && <Flag cc={a.country} />}
                    {a?.iata && <span className="mono muted">{a.iata}</span>}
                    <span className="place-label">{a ? airportLabel(a) : p.icao}</span>
                  </span>
                  <span className="freqbar mono" aria-hidden="true">
                    <i style={{ width: `${Math.max(3, (p.weekly / maxWeekly) * 100)}%` }} />
                    <b>{p.weekly}/wk</b>
                  </span>
                  <span className="blockbar hide-s" aria-hidden="true">
                    <span className="range">
                      {p.minBlock != null && (
                        <i
                          style={{
                            left: `${(Math.min(p.minBlock, scaleMax) / scaleMax) * 100}%`,
                            width: `${Math.max(2, ((Math.min(p.maxBlock ?? p.minBlock, scaleMax) - Math.min(p.minBlock, scaleMax)) / scaleMax) * 100)}%`,
                          }}
                        />
                      )}
                    </span>
                    <b className="mono">{block ?? "—"}</b>
                  </span>
                  <span className="mono place-nm hide-xs" aria-hidden="true">
                    {p.nm != null ? `${p.nm} NM` : "—"}
                  </span>
                </button>
                <span className="place-types hide-s">
                  {p.types.slice(0, 2).map((t) => (
                    <TypeBadge key={t} type={t} airline={airlines.get(p.typeAirline[t])} />
                  ))}
                  <MoreTypes types={p.types.slice(2)} />
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
