"use client";

import { Flag } from "./Flag";
import { useMemo, useState } from "react";
import { airportLabel, dur, hhmm } from "@/lib/data/flight";
import type { Airport } from "@/lib/data/load";
import type { Destination, Row, Sort, SortKey } from "@/lib/data/query";
import type { AirlineInfo } from "@/lib/data/types";
import { routeColor, textOn } from "@/lib/colors";
import { GLOSSARY } from "@/lib/glossary";
import { useFontsReady, widestLabel } from "@/lib/measure";
import { RouteMap } from "./RouteMap";
import { FlightIdent, MoreTypes, TypeBadge, WeekStrip, freqLabel } from "./badges";
import { Tip, cx } from "./ui";

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
}: {
  rows: Row[];
  sort: Sort | null;
  onSort: (s: Sort | null) => void;
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
    return a ? (a.city ?? a.name) : "";
  };

  return (
    <div className="results">
      <div className="tbl-wrap">
        <table className="tbl flights" style={{ ["--id-w" as string]: `${idW}ch`, ["--al-w" as string]: `${alW}px` }}>
          <caption className="sr-only">Flights matching the filters, {rows.length} in total. Select a flight to see its details.</caption>
          <thead>
            <tr>
              {COLS.map(([k, label, tip, cls]) => {
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
                      <span className="th-arrow" aria-hidden="true">
                        {on ? (sort!.dir === 1 ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  </th>
                );
              })}
              <th scope="col" className="hide-s">
                <Tip tip={GLOSSARY.days} title="Days" plain>
                  Days
                </Tip>
              </th>
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
                    <button
                      type="button"
                      className="row-btn"
                      aria-pressed={sel}
                      title={f.fn && f.cs ? `Callsign ${f.cs}` : undefined}
                      onClick={(e) => (e.stopPropagation(), onSelect(r))}
                    >
                      <FlightIdent airline={al} fallback={f.al} ident={identOf(r)} />
                    </button>
                  </td>
                  <td>
                    <span className="mono">{f.o}</span> <small className="muted city">{name(f.o)}</small>
                  </td>
                  <td>
                    <span className="mono">{f.d}</span> <small className="muted city">{name(f.d)}</small>
                  </td>
                  <td className="mono num">
                    <Clock sched={f.std} obs={f.out ?? f.off} kind={f.out != null ? "OUT" : "OFF"} />
                  </td>
                  <td className="mono num hide-s c-arr">
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
                  <td className="mono num hide-s c-dist">{r.nm ?? "—"}</td>
                  <td className="hide-xs">
                    {f.types[0] ? <TypeBadge type={f.types[0]} airline={al} guessed={f.typeGuessed} /> : "—"}
                    <MoreTypes types={f.types.slice(1)} />
                  </td>
                  <td className="mono num hide-xs freq">{freqLabel(f.days) ?? <span className="muted">—</span>}</td>
                  <td className="hide-s">
                    <WeekStrip days={f.days} />
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
          label={`Map of ${places.length} ${what} ${side === "d" ? "from" : "to"} ${airportLabel(hubAirport)}. Select an airport to see its flights.`}
        />
      )}
      <div className="places-head">
        <p className="muted">
          {places.length} {what}
          {hubAirport && (side === "d" ? ` from ${hubAirport.iata ?? hub}` : ` into ${hubAirport.iata ?? hub}`)}. Pick one to see its flights. Block-time bars run from 0 to{" "}
          {Math.round(scaleMax / 60)} h.
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
