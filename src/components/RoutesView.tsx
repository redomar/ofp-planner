"use client";

import { useMemo, useState } from "react";
import { airportLabel, cityName, dur } from "@/lib/data/flight";
import type { Airport } from "@/lib/data/load";
import type { RouteGroup } from "@/lib/data/query";
import type { AirlineInfo } from "@/lib/data/types";
import { routeColor, textOn } from "@/lib/colors";
import { Flag } from "./Flag";
import { RouteMap, type MapRoute } from "./RouteMap";

/** Routes drawn on the map at most (busiest first); the table lists all of them. */
const MAP_MAX = 400;
const PAGE = 100;

type ColKey = "route" | "airlines" | "weekly" | "block" | "nm";
/** Columns: key, heading, class, and whether the first click sorts biggest first. */
const COLS: [ColKey, string, string, boolean][] = [
  ["route", "Route", "", false],
  ["airlines", "Airlines", "", true],
  ["weekly", "Flights / week", "", true],
  ["block", "Block time", "hide-s", true],
  ["nm", "Distance", "num hide-xs", true],
];
type RouteSort = { key: ColKey; desc: boolean } | null;

/**
 * Every route that matches the filters, whatever the ends are (airport, country or anywhere):
 * a map in airline colours and a table, busiest first. Picking a route narrows the finder to it.
 */
export function RoutesView({
  routes,
  airports,
  airlines,
  onPick,
}: {
  routes: RouteGroup[];
  airports: Map<string, Airport> | null;
  airlines: Map<string, AirlineInfo>;
  onPick: (o: string, d: string) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [sort, setSort] = useState<RouteSort>(null);
  const [prev, setPrev] = useState(routes);
  if (prev !== routes) {
    setPrev(routes);
    setLimit(PAGE);
  }
  const city = (icao: string) => {
    const a = airports?.get(icao);
    return a ? (cityName(a) ?? airportLabel(a)) : icao;
  };
  // the table can be re-sorted; the map always shows the busiest routes
  const rows = useMemo(() => {
    if (!sort) return routes;
    const val = (r: RouteGroup): number | string | null =>
      sort.key === "route" ? `${city(r.o)} ${city(r.d)}` : sort.key === "airlines" ? r.airlines.length : sort.key === "weekly" ? r.weekly : sort.key === "block" ? r.minBlock : r.nm;
    const dir = sort.desc ? -1 : 1;
    return [...routes].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // unknowns last
      return (typeof x === "string" ? x.localeCompare(y as string, "en-GB") : x - (y as number)) * dir || b.weekly - a.weekly;
    });
    // city only reads airports
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, sort, airports]);
  const maxWeekly = Math.max(1, ...routes.map((r) => r.weekly));
  const scaleMax = Math.max(240, Math.ceil(Math.max(0, ...routes.map((r) => r.maxBlock ?? 0)) / 60) * 60);

  const mapRoutes = useMemo<MapRoute[]>(() => {
    if (!airports) return [];
    return routes.slice(0, MAP_MAX).flatMap((r) => {
      const from = airports.get(r.o);
      const to = airports.get(r.d);
      if (!from || !to) return [];
      return [{ key: r.key, from, to, color: routeColor(airlines.get(r.airlines[0])), label: `${r.weekly} flights a week` }];
    });
  }, [routes, airports, airlines]);

  const place = (icao: string) => {
    const a = airports?.get(icao);
    return (
      <span className="route-place" title={a ? airportLabel(a) : undefined}>
        {a?.country && <Flag cc={a.country} />}
        {city(icao)}
      </span>
    );
  };
  const sortLabel = sort ? `${COLS.find((c) => c[0] === sort.key)![1].toLowerCase()}, ${sort.desc ? "highest" : "lowest"} first` : null;

  return (
    <div className="routes-view">
      {mapRoutes.length > 0 && (
        <RouteMap routes={mapRoutes} height={480} label={`Map of ${mapRoutes.length} routes matching the filters.`} />
      )}
      <p className="muted routes-note">
        {routes.length.toLocaleString("en-GB")} {routes.length === 1 ? "route" : "routes"}
        {routes.length > MAP_MAX && ` · the map shows the ${MAP_MAX} busiest`}. Pick a route to see its flights. Block-time bars run from 0 to{" "}
        {Math.round(scaleMax / 60)} h.
        {sort && (
          <>
            {" "}
            Sorted by {sortLabel}.{" "}
            <button type="button" className="linkish" onClick={() => setSort(null)}>
              Busiest first
            </button>
          </>
        )}
      </p>
      <div className="tbl-wrap routes-wrap">
        <table className="tbl routes-tbl">
          <caption className="sr-only">Routes matching the filters, {sortLabel ? `sorted by ${sortLabel}` : "busiest first"}</caption>
          <thead>
            <tr>
              {COLS.map(([k, label, cls, bigFirst]) => {
                const on = sort?.key === k;
                return (
                  <th key={k} scope="col" className={cls || undefined} aria-sort={on ? (sort.desc ? "descending" : "ascending") : undefined}>
                    <button type="button" className="th-sort" onClick={() => setSort({ key: k, desc: on ? !sort.desc : bigFirst })}>
                      {label}
                      <span className="th-arrow" aria-hidden="true">
                        {on ? (sort.desc ? "▼" : "▲") : ""}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => {
              const block = r.minBlock != null ? (r.minBlock === r.maxBlock ? dur(r.minBlock) : `${dur(r.minBlock)}–${dur(r.maxBlock)}`) : "—";
              return (
                <tr key={r.key} onClick={() => onPick(r.o, r.d)}>
                  <td>
                    <button type="button" className="route-btn" onClick={(e) => (e.stopPropagation(), onPick(r.o, r.d))}>
                      <span className="mono">{r.o}</span>
                      <span aria-hidden="true">→</span>
                      <span className="mono">{r.d}</span>
                    </button>
                    <small className="muted route-names">
                      {place(r.o)}
                      <span aria-hidden="true">→</span>
                      {place(r.d)}
                    </small>
                  </td>
                  <td>
                    <span className="route-als">
                      {r.airlines.slice(0, 3).map((al) => {
                        const a = airlines.get(al);
                        const c = routeColor(a);
                        return (
                          <span key={al} className="al-tag al-solid" style={{ background: c, color: textOn(c) }} title={a?.name ?? al}>
                            {a?.name ?? al}
                          </span>
                        );
                      })}
                      {r.airlines.length > 3 && <span className="muted mono small">+{r.airlines.length - 3}</span>}
                    </span>
                  </td>
                  <td>
                    <span className="freqbar mono">
                      <i style={{ width: `${Math.max(3, (r.weekly / maxWeekly) * 100)}%` }} />
                      <b>{r.weekly}/wk</b>
                    </span>
                  </td>
                  <td className="hide-s">
                    <span className="blockbar">
                      <span className="range">
                        {r.minBlock != null && (
                          <i
                            style={{
                              left: `${(Math.min(r.minBlock, scaleMax) / scaleMax) * 100}%`,
                              width: `${Math.max(2, ((Math.min(r.maxBlock ?? r.minBlock, scaleMax) - Math.min(r.minBlock, scaleMax)) / scaleMax) * 100)}%`,
                            }}
                          />
                        )}
                      </span>
                      <b className="mono">{block}</b>
                    </span>
                  </td>
                  <td className="mono num hide-xs">{r.nm != null ? `${r.nm} NM` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {routes.length > limit && (
        <div className="more">
          <span className="muted">
            Showing {limit.toLocaleString("en-GB")} of {routes.length.toLocaleString("en-GB")}
          </span>
          <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE * 2)}>
            Show {Math.min(PAGE * 2, routes.length - limit)} more
          </button>
        </div>
      )}
    </div>
  );
}
