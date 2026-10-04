"use client";

import { useMemo, useState } from "react";
import { airportLabel, dur } from "@/lib/data/flight";
import type { Airport } from "@/lib/data/load";
import type { RouteGroup } from "@/lib/data/query";
import type { AirlineInfo } from "@/lib/data/types";
import { routeColor, textOn } from "@/lib/colors";
import { RouteMap, type MapRoute } from "./RouteMap";

/** Routes drawn on the map at most (busiest first); the table lists all of them. */
const MAP_MAX = 400;
const PAGE = 100;

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
  const [prev, setPrev] = useState(routes);
  if (prev !== routes) {
    setPrev(routes);
    setLimit(PAGE);
  }
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

  const name = (icao: string) => {
    const a = airports?.get(icao);
    return a ? airportLabel(a) : icao;
  };

  return (
    <div className="routes-view">
      {mapRoutes.length > 0 && (
        <RouteMap routes={mapRoutes} height={480} label={`Map of ${mapRoutes.length} routes matching the filters.`} />
      )}
      <p className="muted routes-note">
        {routes.length.toLocaleString("en-GB")} {routes.length === 1 ? "route" : "routes"}
        {routes.length > MAP_MAX && ` · the map shows the ${MAP_MAX} busiest`}. Pick a route to see its flights. Block-time bars run from 0 to{" "}
        {Math.round(scaleMax / 60)} h.
      </p>
      <div className="tbl-wrap routes-wrap">
        <table className="tbl routes-tbl">
          <caption className="sr-only">Routes matching the filters, busiest first</caption>
          <thead>
            <tr>
              <th scope="col">Route</th>
              <th scope="col">Airlines</th>
              <th scope="col">Flights / week</th>
              <th scope="col" className="hide-s">
                Block time
              </th>
              <th scope="col" className="num hide-xs">
                Distance
              </th>
            </tr>
          </thead>
          <tbody>
            {routes.slice(0, limit).map((r) => {
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
                      {name(r.o)} → {name(r.d)}
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
