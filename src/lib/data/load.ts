"use client";

/**
 * Loads the static schedule snapshot from public/data/. The manifest is revalidated on
 * every visit (it's tiny); airports and airline files carry ?v=<generatedAt>, so the
 * browser caches them until a new snapshot is published. Each file is fetched at most
 * once per page load and shared by every component.
 */
import { useEffect, useState } from "react";
import type { AirlineFile, AirlineInfo, AirportRow, AirportsFile, Flight, Manifest, RoutesFile } from "./types";

export interface Airport {
  icao: string;
  iata: string | null;
  name: string;
  city: string | null;
  country: string | null;
  lat: number;
  lon: number;
  elevFt: number | null;
  tz: string | null;
}

/** A flight with its brand attached and a stable id. */
export interface FlightRow extends Flight {
  /** Brand airline ICAO (the file it came from). */
  al: string;
  /** Stable id: brand:op+number-or-callsign:orig-dest:days, e.g. "EZY:EJU54LH:LEMD-LFSB:4". */
  id: string;
  /** types was empty in the snapshot and holds the airline's most common type instead. */
  typeGuessed: boolean;
  /** fn was added by the user (Settings-free: from the flight card), not from the data. */
  fnUser?: boolean;
}

const BASE = "/data/";

let manifestP: Promise<Manifest> | null = null;
let airportsP: Promise<Map<string, Airport>> | null = null;
const airlineP = new Map<string, Promise<FlightRow[]>>();
const airlineDone = new Map<string, FlightRow[]>();
let manifestDone: Manifest | null = null;
let airportsDone: Map<string, Airport> | null = null;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export function loadManifest(): Promise<Manifest> {
  manifestP ??= json<Manifest>(`${BASE}manifest.json`, { cache: "no-cache" }).then((m) => (manifestDone = m));
  manifestP.catch(() => (manifestP = null));
  return manifestP;
}

const v = (m: Manifest) => encodeURIComponent(m.generatedAt);

export function loadAirports(): Promise<Map<string, Airport>> {
  airportsP ??= loadManifest()
    .then((m) => json<AirportsFile>(`${BASE}airports.json?v=${v(m)}`))
    .then((f) => {
      const map = new Map<string, Airport>();
      for (const [icao, r] of Object.entries(f.airports) as [string, AirportRow][]) {
        map.set(icao, { icao, iata: r[0], name: r[1], city: r[2], country: r[3], lat: r[4], lon: r[5], elevFt: r[6], tz: r[7] });
      }
      return (airportsDone = map);
    });
  airportsP.catch(() => (airportsP = null));
  return airportsP;
}

export function loadAirline(info: AirlineInfo, m: Manifest): Promise<FlightRow[]> {
  let p = airlineP.get(info.icao);
  if (!p) {
    p = json<AirlineFile>(`/${info.file}?v=${v(m)}`).then((f) => {
      // Flights without a known type (timetable-only rows) borrow the airline's most common one.
      const typeCount = new Map<string, number>();
      for (const fl of f.flights) if (fl.types[0]) typeCount.set(fl.types[0], (typeCount.get(fl.types[0]) ?? 0) + 1);
      const common = [...typeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const seen = new Map<string, number>();
      const rows = f.flights.map((fl) => {
        let id = `${info.icao}:${fl.op}${fl.fn ?? fl.cs ?? ""}:${fl.o}-${fl.d}:${fl.days.join("")}`;
        const n = seen.get(id) ?? 0;
        seen.set(id, n + 1);
        if (n) id += `~${n}`;
        const guess = !fl.types.length && !!common;
        return { ...fl, types: guess ? [common!] : fl.types, typeGuessed: guess, al: info.icao, id };
      });
      airlineDone.set(info.icao, rows);
      return rows;
    });
    p.catch(() => airlineP.delete(info.icao));
    airlineP.set(info.icao, p);
  }
  return p;
}

let routesP: Promise<RoutesFile["routes"]> | null = null;
/** The route index (orig → dest → brand → flights), fetched the first time an airport is chosen. */
export function loadRoutes(): Promise<RoutesFile["routes"]> {
  routesP ??= loadManifest()
    .then((m) => json<RoutesFile>(`${BASE}routes.json?v=${v(m)}`))
    .then((f) => f.routes);
  routesP.catch(() => (routesP = null));
  return routesP;
}

export interface Dataset {
  manifest: Manifest | null;
  airports: Map<string, Airport> | null;
  airlines: Map<string, AirlineInfo>;
  /** Flights of the requested airlines that have loaded so far. */
  flights: FlightRow[];
  /** Airlines requested but not loaded yet. */
  loading: string[];
  error: string | null;
  /** 0..1 for the status bar. */
  progress: number;
}

function snapshot(want: string[] | "all", error: string | null): Dataset {
  const m = manifestDone;
  const airlines = new Map((m?.airlines ?? []).map((a) => [a.icao, a]));
  const ids = want === "all" ? [...airlines.keys()] : want.filter((w) => airlines.has(w));
  const flights: FlightRow[] = [];
  const loading: string[] = [];
  for (const id of ids) {
    const rows = airlineDone.get(id);
    if (rows) flights.push(...rows);
    else loading.push(id);
  }
  const steps = 2 + ids.length;
  const done = (m ? 1 : 0) + (airportsDone ? 1 : 0) + (ids.length - loading.length);
  return { manifest: m, airports: airportsDone, airlines, flights, loading, error, progress: done / steps };
}

/**
 * The flights of `want` (brand ICAOs, or "all"), plus the manifest and airports.
 * Re-renders as files arrive so the table fills progressively.
 */
export function useDataset(want: string[] | "all"): Dataset {
  const key = want === "all" ? "*" : [...want].sort().join(",");
  const [state, setState] = useState<Dataset>(() => snapshot(want, null));
  useEffect(() => {
    let live = true;
    const list: string[] | "all" = key === "*" ? "all" : key ? key.split(",") : [];
    const update = (err: string | null = null) => live && setState(snapshot(list, err));
    update();
    loadManifest()
      .then((m) => {
        update();
        const infos = list === "all" ? m.airlines : m.airlines.filter((a) => list.includes(a.icao));
        return Promise.all([
          loadAirports().then(() => update()),
          // a few at a time, so the first airlines show while the rest download
          ...infos.map((a) => loadAirline(a, m).then(() => update())),
        ]);
      })
      .catch((e: unknown) => update(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [key]);
  return state;
}

/** Fetch every flight of every airline (used by search-by-id and the brief page). */
export async function findFlight(id: string): Promise<FlightRow | null> {
  const m = await loadManifest();
  const brand = id.split(":")[0];
  const info = m.airlines.find((a) => a.icao === brand);
  if (!info) return null;
  const rows = await loadAirline(info, m);
  return rows.find((r) => r.id === id) ?? null;
}
