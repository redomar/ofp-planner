"use client";

import { useMemo, useState } from "react";
import { airportLabel, daysLabel, dur, hhmm } from "@/lib/data/flight";
import type { Airport } from "@/lib/data/load";
import type { Destination, Row, Sort, SortKey } from "@/lib/data/query";
import type { AirlineInfo } from "@/lib/data/types";
import { routeColor } from "@/lib/colors";
import { GLOSSARY } from "@/lib/glossary";
import { RouteMap } from "./RouteMap";
import { Tip, cx } from "./ui";

const PAGE = 80;

const COLS: [SortKey, string, string | null, string?][] = [
  ["flight", "Flight", null],
  ["dep", "From", null],
  ["arr", "To", null],
  ["std", "Dep Z", GLOSSARY.depCol],
  ["sta", "Arr Z", GLOSSARY.arrCol, "hide-s"],
  ["block", "Block", GLOSSARY.block],
  ["dist", "Dist", GLOSSARY.distance, "hide-s"],
  ["type", "Type", GLOSSARY.types, "hide-xs"],
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
}: {
  rows: Row[];
  sort: Sort;
  onSort: (s: Sort) => void;
  selected: string | null;
  onSelect: (r: Row) => void;
  airports: Map<string, Airport> | null;
  airlines: Map<string, AirlineInfo>;
}) {
  const [limit, setLimit] = useState(PAGE);
  // A new result set starts at the first page (adjusted during render, not in an effect).
  const [prevRows, setPrevRows] = useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    setLimit(PAGE);
  }
  const shown = rows.slice(0, limit);
  const name = (icao: string) => {
    const a = airports?.get(icao);
    return a ? (a.city ?? a.name) : "";
  };

  return (
    <div className="results">
      <div className="tbl-wrap">
        <table className="tbl flights">
          <caption className="sr-only">Flights matching the filters, {rows.length} in total. Select a flight to see its details.</caption>
          <thead>
            <tr>
              {COLS.map(([k, label, tip, cls]) => {
                const on = sort.key === k;
                return (
                  <th key={k} scope="col" className={cls} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                    <button type="button" className="th-sort" onClick={() => onSort({ key: k, dir: on ? (sort.dir === 1 ? -1 : 1) : 1 })}>
                      {tip ? (
                        <Tip tip={tip} title={label} plain>
                          {label}
                        </Tip>
                      ) : (
                        label
                      )}
                      <span className="th-arrow" aria-hidden="true">
                        {on ? (sort.dir === 1 ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const { f } = r;
              const al = airlines.get(f.al);
              const sel = selected === f.id;
              return (
                <tr key={f.id} className={cx(sel && "sel")} onClick={() => onSelect(r)}>
                  <td>
                    <button type="button" className="row-btn" aria-pressed={sel} onClick={(e) => (e.stopPropagation(), onSelect(r))}>
                      <span className="al-dot" style={{ background: routeColor(al) }} aria-hidden="true" />
                      <span className="mono">{f.fn ? `${al?.iata ?? f.al}${f.fn}` : (f.cs ?? `${f.op} —`)}</span>
                    </button>
                    {f.fn && f.cs && <small className="mono muted cs">{f.cs}</small>}
                  </td>
                  <td>
                    <span className="mono">{f.o}</span> <small className="muted">{name(f.o)}</small>
                  </td>
                  <td>
                    <span className="mono">{f.d}</span> <small className="muted">{name(f.d)}</small>
                  </td>
                  <td className="mono num">
                    <Clock sched={f.std} obs={f.out ?? f.off} kind={f.out != null ? "OUT" : "OFF"} />
                  </td>
                  <td className="mono num hide-s">
                    <Clock sched={f.sta} obs={f.in ?? f.on} kind={f.in != null ? "IN" : "ON"} />
                  </td>
                  <td className="mono num">
                    {dur(r.block?.min) ?? "—"}
                    {r.block?.source === "estimated" && (
                      <span className="est" title="Estimated from distance">
                        ~
                      </span>
                    )}
                  </td>
                  <td className="mono num hide-s">{r.nm ?? "—"}</td>
                  <td className="mono hide-xs">
                    {f.types[0] ?? "—"}
                    {f.types.length > 1 && <small className="muted"> +{f.types.length - 1}</small>}
                    {f.days.length > 0 && f.days.length < 7 && <small className="muted days-mini"> {daysLabel(f.days)}</small>}
                  </td>
                </tr>
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
}: {
  places: Destination[];
  /** Which end is free: "d" lists destinations, "o" lists origins. */
  side: "d" | "o";
  hub: string | null;
  airports: Map<string, Airport> | null;
  airlines: Map<string, AirlineInfo>;
  onPick: (icao: string) => void;
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
  return (
    <div className="places">
      {hubAirport && routes.length > 0 && (
        <RouteMap
          routes={routes}
          height={360}
          onPick={onPick}
          label={`Map of ${places.length} ${what} ${side === "d" ? "from" : "to"} ${airportLabel(hubAirport)}. Select an airport to see its flights.`}
        />
      )}
      <div className="places-head">
        <p className="muted">
          {places.length} {what}
          {hubAirport && (side === "d" ? ` from ${hubAirport.iata ?? hub}` : ` into ${hubAirport.iata ?? hub}`)}. Pick one to see its flights.
        </p>
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
      <ul className="place-list">
        {sorted.map((p) => {
          const a = airports?.get(p.icao);
          return (
            <li key={p.icao}>
              <button type="button" className="place" onClick={() => onPick(p.icao)}>
                <span className="place-al" aria-hidden="true">
                  {p.airlines.slice(0, 4).map((al) => (
                    <i key={al} style={{ background: routeColor(airlines.get(al)) }} />
                  ))}
                </span>
                <span className="mono place-code">{p.icao}</span>
                <span className="place-name">
                  {a?.country && <img className="flag" src={`/flags/${a.country.toLowerCase()}.svg`} alt="" width="16" height="12" />}
                  {a ? airportLabel(a) : p.icao}
                  {a?.iata && <span className="mono muted"> {a.iata}</span>}
                </span>
                <span className="place-stats mono">
                  <span title="Departures per week">{p.weekly}/wk</span>
                  <span>{p.minBlock != null ? (p.minBlock === p.maxBlock ? dur(p.minBlock) : `${dur(p.minBlock)}–${dur(p.maxBlock)}`) : "—"}</span>
                  <span className="hide-xs">{p.nm != null ? `${p.nm} NM` : ""}</span>
                  <span className="hide-s muted">{p.types.slice(0, 3).join(" ")}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
