"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from "react";
import { airportLabel, cityName, dur, gcNm, hhmm, isoDay, onDay } from "@/lib/data/flight";
import { findFlight, loadAirports, loadManifest, type Airport } from "@/lib/data/load";
import type { AirlineInfo } from "@/lib/data/types";
import {
  airlineOf,
  airOf,
  arrDelay,
  blockOf,
  clockOf,
  defaultId,
  deleteFlight,
  depDelay,
  exportFile,
  landingGrade,
  LOG_SCHEMA,
  mergeFlights,
  parseLogFile,
  readLog,
  saveFlight,
  STATUS_LABEL,
  STATUS_TONE,
  statusOf,
  writeLog,
  type LogFlight,
  type LogStatus,
} from "@/lib/logbook";
import { readReady } from "@/lib/saved";
import { useStorageVersion } from "@/lib/storage";
import { useDisplay, writeDisplay } from "@/lib/display";
import { useFontsReady, widestLabel } from "@/lib/measure";
import { routeColor } from "@/lib/colors";
import { FlightIdent, TypeBadge } from "./badges";
import { StatusLine, TopBar } from "./chrome";
import { CollapseProvider } from "./collapse";
import { Flag } from "./Flag";
import { PlacePicker, type PlaceOption } from "./pickers";
import { RouteMap, type MapRoute } from "./RouteMap";
import { Section, cx } from "./ui";
import { countryName } from "@/lib/places";

type Ref = { airports: Map<string, Airport>; brands: Map<string, AirlineInfo> };

/**
 * Flights you've flown: a map of them, the totals, and one row per flight with its OOOI
 * times, how it ran against the schedule and the landing. Kept in this browser; JSON in and out.
 */
export function LogbookApp() {
  const v = useStorageVersion();
  const log = useMemo(() => (v < 0 ? null : readLog()), [v]);
  const [ref, setRef] = useState<Ref | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [editing, setEditing] = useState<LogFlight | null>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([loadManifest(), loadAirports()]).then(([m, airports]) => {
      if (!live) return;
      // every operator maps to its brand (EJU → easyJet)
      const brands = new Map<string, AirlineInfo>();
      for (const a of m.airlines) for (const op of [a.icao, ...a.operators]) brands.set(op, a);
      setRef({ airports, brands });
    }, () => undefined);
    return () => {
      live = false;
    };
  }, []);

  // ?f=<flight id>&d=<date> (from the brief): start the form from that flight
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("f");
    if (!id) return;
    let live = true;
    Promise.all([findFlight(id), loadManifest()]).then(([base, m]) => {
      if (!live || !base) return;
      const iata = m.airlines.find((a) => a.icao === base.al)?.iata ?? null;
      const ready = readReady();
      const d = q.get("d") ?? (ready?.flight.id === id ? ready.date : null);
      const date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10);
      // listed STD/STA of that weekday (they change through the week for some flights)
      const f = onDay(base, isoDay(new Date(`${date}T00:00:00Z`)));
      setEditing({
        id: "",
        date,
        from: f.o,
        to: f.d,
        callsign: f.cs,
        flight: f.fn ? `${iata ?? f.al}${f.fn}` : null,
        airline: f.op,
        type: f.types[0] ?? null,
        std: hhmm(f.std),
        sta: hhmm(f.sta),
        source: "manual",
      });
      setFormKey((k) => k + 1);
      document.getElementById("log-form")?.scrollIntoView({ block: "start" });
    }, () => undefined);
    return () => {
      live = false;
    };
  }, []);

  const flights = log ?? [];
  return (
    <CollapseProvider>
      <TopBar />
      <StatusLine>
        <span className="muted">Your flights, stored in this browser only. Import or export them as JSON.</span>
      </StatusLine>
      <main className="settings logbook">
        {log && (
          <>
            <Section id="log" no={1} title="Flights flown" meta={<span className="mono">{flights.length}</span>}>
              {flights.length ? (
                <>
                  <Totals flights={flights} ref_={ref} />
                  <LogMap flights={flights} ref_={ref} sel={hover ?? sel} />
                  <LogList
                    flights={flights}
                    ref_={ref}
                    sel={sel}
                    onSel={(id) => setSel((s) => (s === id ? null : id))}
                    onHover={setHover}
                    onEdit={(f) => {
                      setEditing(f);
                      setFormKey((k) => k + 1);
                      requestAnimationFrame(() => document.getElementById("log-form")?.scrollIntoView({ block: "start" }));
                    }}
                  />
                </>
              ) : (
                <p className="lib-empty">
                  No flights yet. Add one below, import a logbook file, or open a flight&apos;s brief and choose <b>Log this flight</b>.
                </p>
              )}
            </Section>
            <Section id="log-add" no={2} title={editing?.id ? "Edit flight" : "Add a flight"}>
              <LogForm
                key={formKey}
                start={editing}
                ref_={ref}
                onDone={(id) => {
                  setEditing(null);
                  setFormKey((k) => k + 1);
                  if (id) setSel(id);
                }}
              />
            </Section>
            <Section id="log-io" no={3} title="Import & export">
              <ImportExport flights={flights} />
            </Section>
          </>
        )}
      </main>
    </CollapseProvider>
  );
}

/* ---------- totals ---------- */

function Totals({ flights, ref_ }: { flights: LogFlight[]; ref_: Ref | null }) {
  let block = 0;
  let air = 0;
  let nm = 0;
  const aps = new Set<string>();
  const types = new Set<string>();
  let rated = 0;
  let onTime = 0;
  const fpm: number[] = [];
  for (const f of flights) {
    block += blockOf(f) ?? 0;
    air += airOf(f) ?? 0;
    const a = ref_?.airports.get(f.from);
    const b = ref_?.airports.get(f.to);
    if (a && b) nm += gcNm(a, b);
    aps.add(f.from);
    aps.add(f.to);
    if (f.type) types.add(f.type);
    const s = statusOf(f);
    if (s && s !== "cancelled") {
      rated++;
      if (s === "on-time" || s === "early") onTime++;
    }
    if (f.landingFpm != null) fpm.push(f.landingFpm);
  }
  const avg = fpm.length ? Math.round(fpm.reduce((x, y) => x + y, 0) / fpm.length) : null;
  const softest = fpm.length ? Math.max(...fpm) : null;
  const items: [string, ReactNode][] = [
    ["Flights", flights.length],
    ["Block", block ? dur(block) : "—"],
    ["Airborne", air ? dur(air) : "—"],
    ["Distance", ref_ ? `${Math.round(nm).toLocaleString("en-GB")} NM` : "…"],
    ["Airports", aps.size],
    ["Types", types.size || "—"],
    ["On time or early", rated ? `${Math.round((onTime / rated) * 100)}%` : "—"],
    ["Avg landing", avg != null ? `${avg} fpm` : "—"],
    ["Softest", softest != null ? `${softest} fpm` : "—"],
  ];
  return (
    <dl className="log-totals">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className="mono">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- map ---------- */

function LogMap({ flights, ref_, sel }: { flights: LogFlight[]; ref_: Ref | null; sel: string | null }) {
  const routes = useMemo<MapRoute[]>(() => {
    if (!ref_) return [];
    const by = new Map<string, MapRoute & { n: number }>();
    const selF = flights.find((f) => f.id === sel);
    for (const f of flights) {
      const key = `${f.from}-${f.to}`;
      const from = ref_.airports.get(f.from);
      const to = ref_.airports.get(f.to);
      if (!from || !to) continue;
      const r = by.get(key) ?? { key, from, to, color: routeColor(ref_.brands.get(f.airline ?? "")), n: 0 };
      r.n++;
      r.label = `${r.n} ${r.n === 1 ? "flight" : "flights"}`;
      r.active = selF ? selF.from === f.from && selF.to === f.to : false;
      by.set(key, r);
    }
    return [...by.values()];
  }, [flights, ref_, sel]);
  // keep the map's room while the airports load, so the table doesn't jump
  if (!ref_) return <div className="log-map log-map-wait" style={{ height: 420 }} aria-hidden="true" />;
  if (!routes.length) return null;
  return <RouteMap routes={routes} height={420} label={`Map of the ${routes.length} routes you've flown.`} className="log-map" />;
}

/* ---------- list: table (by month, or punctuality bars) or flight strips ---------- */

type ListProps = {
  flights: LogFlight[];
  ref_: Ref | null;
  sel: string | null;
  onSel: (id: string) => void;
  onHover: (id: string | null) => void;
  onEdit: (f: LogFlight) => void;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const toMin = (t: string | null | undefined) => (t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);
/** "8 Oct", with the year when it isn't this year ("8 Oct 25"). */
function shortDate(iso: string) {
  const s = `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1].slice(0, 3)}`;
  return iso.slice(0, 4) === new Date().toISOString().slice(0, 4) ? s : `${s} ${iso.slice(2, 4)}`;
}
const weekday = (iso: string) => WDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];

/** Every flight cell gets the same width (widest number, widest airline name), as in the Finder. */
function useIdentWidths(flights: LogFlight[], ref_: Ref | null) {
  const fontsReady = useFontsReady();
  return useMemo(() => {
    let id = 4;
    const names = new Set<string>();
    for (const f of flights) {
      id = Math.max(id, (f.flight ?? f.callsign ?? "—").length);
      names.add(ref_?.brands.get(f.airline ?? "")?.name ?? f.airline ?? "—");
    }
    return { ["--id-w" as string]: `${id}ch`, ["--al-w" as string]: `${Math.min(150, widestLabel(names)) + 1}px` } as CSSProperties;
    // fontsReady re-measures once the face has loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flights, ref_, fontsReady]);
}

const tipChip = (label: string) => ({ label, color: "transparent", ink: "var(--sheet)" });

/** The status badge's tooltip: OUT/OFF/ON/IN against the schedule, block and airborne. */
function timesTip(f: LogFlight): Record<string, string> | null {
  const s = statusOf(f);
  const rel = (a: string | null | undefined, b: string | null | undefined) => {
    const d = a && b ? (((toMin(a)! - toMin(b)! + 720 + 1440) % 1440) - 720) : null;
    return d == null ? "" : `  sched ${b} · ${d === 0 ? "±0" : d > 0 ? `+${d}m` : `−${-d}m`}`;
  };
  const rows = [
    ["OUT", f.out, rel(f.out, f.std)],
    ["OFF", f.off, ""],
    ["ON", f.on, ""],
    ["IN", f.in, rel(f.in, f.sta)],
  ]
    .filter(([, t]) => t)
    .map(([k, t, n]) => ({ chip: tipChip(k!), text: `${t}Z${n}` }));
  if (!rows.length) for (const [k, t] of [["STD", f.std], ["STA", f.sta]] as const) if (t) rows.push({ chip: tipChip(k), text: `${t}Z` });
  if (f.started && !f.out) rows.push({ chip: tipChip("LISTED"), text: `${f.started} (zone not given)` });
  if (!rows.length && !s) return null;
  const dd = depDelay(f);
  const ad = arrDelay(f);
  const delays = [dd != null && `dep ${signed(dd)}`, ad != null && `arr ${signed(ad)}`].filter(Boolean).join(" · ");
  const block = blockOf(f);
  const air = airOf(f);
  return {
    "data-tip-title": [s ? STATUS_LABEL[s] : "Times", delays].filter(Boolean).join(" · "),
    "data-tip": block != null || air != null ? `Block ${dur(block) ?? "—"}, airborne ${dur(air) ?? "—"}.` : s === "cancelled" ? "Not flown." : "No block time logged.",
    "data-tip-rows": JSON.stringify(rows),
    ...(rows.length ? { "data-tip-note": "Times UTC" } : {}),
  };
}

function Status({ f, className }: { f: LogFlight; className?: string }) {
  const s = statusOf(f);
  const tip = timesTip(f);
  const label = s ? STATUS_LABEL[s] : "Times";
  if (!s && !tip) return <span className="muted">—</span>;
  return (
    <span className={cx(s ? `badge ${STATUS_TONE[s]}` : "log-times-chip", "log-status", className)} tabIndex={0} {...tip}>
      {label}
    </span>
  );
}

/** An airport: code and city; hovering shows its name, city and country, codes, elevation and your visits. */
function Place({ icao, ref_, visits }: { icao: string; ref_: Ref | null; visits: Map<string, number> }) {
  const a = ref_?.airports.get(icao);
  const city = a ? (cityName(a) ?? airportLabel(a)) : null;
  const n = visits.get(icao) ?? 0;
  const rows = a
    ? [
        { chip: tipChip("ICAO"), text: a.icao },
        ...(a.iata ? [{ chip: tipChip("IATA"), text: a.iata }] : []),
        ...(a.elevFt != null ? [{ chip: tipChip("ELEV"), text: `${a.elevFt.toLocaleString("en-GB")} ft` }] : []),
        ...(a.tz ? [{ chip: tipChip("ZONE"), text: a.tz }] : []),
      ]
    : [];
  return (
    <span
      className="log-place"
      tabIndex={a ? 0 : undefined}
      data-tip={a ? [city, a.country ? countryName(a.country) : null].filter(Boolean).join(", ") : undefined}
      data-tip-title={a?.name}
      data-tip-rows={a ? JSON.stringify(rows) : undefined}
      data-tip-note={a ? `In your logbook ${n} ${n === 1 ? "time" : "times"}` : undefined}
    >
      <span className="mono">{icao}</span>{" "}
      {a && (
        <small className="muted city">
          {a.country && <Flag cc={a.country} />}
          <span>{city}</span>
        </small>
      )}
    </span>
  );
}

/** Scheduled block as an outline and the flown one solid in the airline colour, on one scale for the whole list. */
function useBarScale(flights: LogFlight[]) {
  return useMemo(() => {
    let lo = 0;
    let hi = 60;
    for (const f of flights) {
      const s = toMin(f.std ?? f.out);
      if (s == null) continue;
      for (const t of [f.out, f.in, f.sta]) {
        const m = toMin(t);
        if (m == null) continue;
        let d = ((m - s + 1440) % 1440);
        if (d > 1200) d -= 1440; // early off-block: slightly before the schedule
        lo = Math.min(lo, Math.max(-90, d));
        hi = Math.max(hi, Math.min(18 * 60, d));
      }
    }
    return { lo, hi };
  }, [flights]);
}

function PunctBar({ f, color, scale }: { f: LogFlight; color: string; scale: { lo: number; hi: number } }) {
  const s0 = toMin(f.std ?? f.out);
  if (s0 == null) return <span className="muted">—</span>;
  const rel = (t: string | null | undefined) => {
    const m = toMin(t);
    if (m == null) return null;
    const d = (m - s0 + 1440) % 1440;
    return d > 1200 ? d - 1440 : d;
  };
  const pc = (m: number) => `${(((m - scale.lo) / (scale.hi - scale.lo)) * 100).toFixed(2)}%`;
  const bar = (a: number | null, z: number | null, cls: string, style?: CSSProperties) =>
    a != null && z != null ? <i className={cls} style={{ left: pc(a), width: `calc(${pc(Math.max(z, a + 2))} - ${pc(a)})`, ...style }} /> : null;
  const sched = f.std && f.sta ? `scheduled ${f.std}–${f.sta}Z` : null;
  const flown = f.out && f.in ? `flown ${f.out}–${f.in}Z` : null;
  return (
    <span className="log-bar" role="img" aria-label={[sched, flown].filter(Boolean).join(", ") || "No times"} {...timesTip(f)}>
      {bar(rel(f.std), rel(f.sta), "log-bar-s")}
      {bar(rel(f.out), rel(f.in), "log-bar-o", { background: color })}
    </span>
  );
}

function Landing({ f }: { f: LogFlight }) {
  const g = landingGrade(f.landingFpm);
  if (f.landingFpm == null) return <span className="muted">—</span>;
  return (
    <>
      <span className="mono">{f.landingFpm}</span>
      {g && <span className={`badge ${g.tone} log-grade`}>{g.label}</span>}
    </>
  );
}

function Details({ f, brand, onEdit }: { f: LogFlight; brand: AirlineInfo | undefined; onEdit: (f: LogFlight) => void }) {
  const [confirm, setConfirm] = useState(false);
  const block = blockOf(f);
  const air = airOf(f);
  return (
    <>
      <dl className="log-facts">
        {fact("Date", f.date)}
        {fact("Callsign", f.callsign)}
        {fact("Flight", f.flight)}
        {fact("Operator", f.airline ? `${f.airline}${brand ? ` · ${brand.name}` : ""}` : null)}
        {fact("Aircraft", [f.type, f.reg].filter(Boolean).join(" · ") || null)}
        {fact("Scheduled", f.std || f.sta ? `${f.std ?? "--:--"} → ${f.sta ?? "--:--"} Z` : null)}
        {fact("OOOI", f.out || f.off || f.on || f.in ? `${f.out ?? "--:--"} · ${f.off ?? "--:--"} · ${f.on ?? "--:--"} · ${f.in ?? "--:--"} Z` : null)}
        {fact("Block / air", block != null || air != null ? `${dur(block) ?? "—"} / ${dur(air) ?? "—"}` : null)}
        {fact("Landing", f.landingFpm != null ? `${f.landingFpm} fpm${f.landingG != null ? ` · ${f.landingG} g` : ""}` : null)}
        {fact("Cruise", f.cruiseFl != null ? `FL${f.cruiseFl}` : null)}
        {fact("Fuel", f.fuelKg != null ? `${f.fuelKg.toLocaleString("en-GB")} kg` : null)}
        {fact("Passengers", f.pax)}
        {fact("Simulator", f.sim)}
        {fact("Listed time", f.started)}
        {fact("Source", f.source)}
        {fact("Notes", f.notes)}
      </dl>
      <div className="log-acts">
        <button type="button" className="btn" onClick={() => onEdit(f)}>
          Edit
        </button>
        {confirm ? (
          <>
            <span className="small">Delete this flight?</span>
            <button type="button" className="btn btn-danger" onClick={() => (deleteFlight(f.id), setConfirm(false))}>
              Delete
            </button>
            <button type="button" className="btn" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirm(true)}>
            Delete…
          </button>
        )}
      </div>
    </>
  );
}

function LogList(props: ListProps) {
  const d = useDisplay();
  const strips = d.logbook === "strips";
  return (
    <>
      <div className="log-bar-head">
        <span className="small muted">Hover a flight to see it on the map, and its status for the times. Select it for everything logged.</span>
        {!strips && (
          <span className="log-view" role="group" aria-label="The table shows">
            <button type="button" className={cx("chip", !d.logBars && "on")} aria-pressed={!d.logBars} onClick={() => writeDisplay({ logBars: false })}>
              Airports
            </button>
            <button type="button" className={cx("chip", d.logBars && "on")} aria-pressed={d.logBars} onClick={() => writeDisplay({ logBars: true })}>
              Punctuality
            </button>
          </span>
        )}
      </div>
      {strips ? <LogStrips {...props} /> : <LogTable {...props} bars={d.logBars} />}
    </>
  );
}

function LogTable({ flights, ref_, sel, onSel, onHover, onEdit, bars }: ListProps & { bars: boolean }) {
  const widths = useIdentWidths(flights, ref_);
  const scale = useBarScale(flights);
  const visits = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of flights) for (const a of [f.from, f.to]) m.set(a, (m.get(a) ?? 0) + 1);
    return m;
  }, [flights]);
  const cols = 8;
  // the first (newest) flight of each month gets the month's heading above it
  const firsts = useMemo(() => {
    const s = new Set<string>();
    let m = "";
    for (const f of flights) {
      if (f.date.slice(0, 7) === m) continue;
      m = f.date.slice(0, 7);
      s.add(f.id);
    }
    return s;
  }, [flights]);
  return (
    <div className="tbl-wrap log-wrap" onMouseLeave={() => onHover(null)}>
      <table className={cx("tbl log-tbl", bars && "log-tbl-bars")} style={widths}>
        <caption className="sr-only">Flights flown, newest first{bars ? "" : ", by month"}. Select a row to see its details.</caption>
        <thead>
          <tr>
            <th scope="col">{bars ? "Date" : "Day"}</th>
            <th scope="col">Flight</th>
            {bars ? (
              <>
                <th scope="col">Route</th>
                <th scope="col" className="hide-s">
                  Sched vs flown
                </th>
              </>
            ) : (
              <>
                <th scope="col">From</th>
                <th scope="col">To</th>
              </>
            )}
            <th scope="col" className="num hide-xs">
              Block
            </th>
            <th scope="col" className="hide-s">
              Aircraft
            </th>
            <th scope="col">Status</th>
            <th scope="col" className="num hide-xs" title="Touchdown rate, feet per minute">
              Landing <span className="muted">fpm</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {flights.map((f) => {
            const brand = ref_?.brands.get(f.airline ?? "");
            const open = sel === f.id;
            const block = blockOf(f);
            return (
              <Fragment key={f.id}>
                {!bars && firsts.has(f.id) && <MonthRow ym={f.date.slice(0, 7)} flights={flights} cols={cols} />}
                <tr className={cx(open && "sel")} onClick={() => onSel(f.id)} onMouseEnter={() => onHover(f.id)}>
                  <td className="mono">
                    <button type="button" className="log-date" aria-expanded={open} title={f.date} onClick={(e) => (e.stopPropagation(), onSel(f.id))} onFocus={() => onHover(f.id)}>
                      {bars ? (
                        shortDate(f.date)
                      ) : (
                        <>
                          <span className="muted log-wd">{weekday(f.date)}</span> {+f.date.slice(8, 10)}
                        </>
                      )}
                    </button>
                  </td>
                  <td title={f.flight && f.callsign ? `Callsign ${f.callsign}` : undefined}>
                    <FlightIdent airline={brand} fallback={f.airline ?? "—"} ident={f.flight ?? f.callsign ?? "—"} />
                  </td>
                  {bars ? (
                    <>
                      <td className="mono">
                        {f.from} <span aria-hidden="true">→</span>
                        <span className="sr-only">to</span> {f.to}
                      </td>
                      <td className="hide-s">
                        <PunctBar f={f} color={routeColor(brand)} scale={scale} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        <Place icao={f.from} ref_={ref_} visits={visits} />
                      </td>
                      <td>
                        <Place icao={f.to} ref_={ref_} visits={visits} />
                      </td>
                    </>
                  )}
                  <td className="mono num hide-xs">{dur(block) ?? <span className="muted">—</span>}</td>
                  <td className="hide-s" title={f.reg ?? undefined}>
                    {f.type ? <TypeBadge type={f.type} airline={brand} /> : <span className="muted">—</span>}
                  </td>
                  <td>
                    <Status f={f} />
                  </td>
                  <td className="num hide-xs">
                    <Landing f={f} />
                  </td>
                </tr>
                {open && (
                  <tr className="log-detail">
                    <td colSpan={cols}>
                      <Details f={f} brand={brand} onEdit={onEdit} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MonthRow({ ym, flights, cols }: { ym: string; flights: LogFlight[]; cols: number }) {
  const inM = flights.filter((f) => f.date.startsWith(ym));
  const block = inM.reduce((a, f) => a + (blockOf(f) ?? 0), 0);
  const routes = new Set(inM.map((f) => `${f.from}-${f.to}`)).size;
  return (
    <tr className="log-month">
      <th scope="rowgroup" colSpan={cols}>
        {MONTHS[+ym.slice(5, 7) - 1]} {ym.slice(0, 4)}
        <span className="mono">
          {inM.length} {inM.length === 1 ? "flight" : "flights"}
          {block ? ` · ${dur(block)} block` : ""} · {routes} {routes === 1 ? "route" : "routes"}
        </span>
      </th>
    </tr>
  );
}

/** W5: ATC flight progress strips, one per flight, in a rack. */
function LogStrips({ flights, ref_, sel, onSel, onHover, onEdit }: ListProps) {
  const widths = useIdentWidths(flights, ref_);
  const city = (icao: string) => {
    const a = ref_?.airports.get(icao);
    return a ? (cityName(a) ?? airportLabel(a)) : "";
  };
  return (
    <div className="log-wrap log-strips" style={widths} onMouseLeave={() => onHover(null)}>
      <ul aria-label="Flights flown, newest first. Select a strip to see its details.">
        {flights.map((f) => {
          const brand = ref_?.brands.get(f.airline ?? "");
          const open = sel === f.id;
          return (
            <li key={f.id} className={cx("strip", open && "sel")} style={{ ["--c" as string]: routeColor(brand) }} onMouseEnter={() => onHover(f.id)}>
              <div className="strip-row" onClick={() => onSel(f.id)}>
                <span className="strip-cs">
                  <button type="button" className="log-date" aria-expanded={open} onClick={(e) => (e.stopPropagation(), onSel(f.id))} onFocus={() => onHover(f.id)}>
                    <FlightIdent airline={brand} fallback={f.airline ?? "—"} ident={f.flight ?? f.callsign ?? "—"} />
                  </button>
                  <small className="mono">{f.flight && f.callsign ? f.callsign : " "}</small>
                </span>
                <span className="strip-ac">
                  <b className="mono">{f.type ?? "—"}</b>
                  <small className="mono">{f.reg ?? " "}</small>
                </span>
                <span className="strip-ap">
                  <b className="mono">{f.from}</b>
                  <small>{city(f.from)}</small>
                </span>
                <span className="strip-to" aria-hidden="true">
                  ▸
                </span>
                <span className="sr-only">to</span>
                <span className="strip-ap">
                  <b className="mono">{f.to}</b>
                  <small>{city(f.to)}</small>
                </span>
                <span className="strip-n">
                  <small>Block</small>
                  <b className="mono">{dur(blockOf(f)) ?? "—"}</b>
                </span>
                <span className="strip-n">
                  <small>V/S</small>
                  <b className="mono">{f.landingFpm ?? "—"}</b>
                </span>
                <span className="strip-d mono">
                  <span>{shortDate(f.date).split(" ").slice(0, 2).join(" ")}</span>
                  <small>{f.date.slice(0, 4)}</small>
                </span>
                <span className="strip-st">
                  <Status f={f} className="strip-stamp" />
                </span>
              </div>
              {open && (
                <div className="strip-detail">
                  <Details f={f} brand={brand} onEdit={onEdit} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const signed = (m: number) => (m === 0 ? "±0" : `${m > 0 ? "+" : "−"}${dur(Math.abs(m))}`);
const fact = (k: string, v: ReactNode) =>
  v == null || v === "" ? null : (
    <div key={k}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );

/* ---------- add / edit ---------- */

const TIME_FIELDS = [
  ["std", "STD"],
  ["sta", "STA"],
  ["out", "OUT"],
  ["off", "OFF"],
  ["on", "ON"],
  ["in", "IN"],
] as const;
type Draft = Record<string, string>;
const toDraft = (f: LogFlight | null): Draft => {
  const d: Draft = { date: f?.date ?? new Date().toISOString().slice(0, 10), status: f?.status ?? "" };
  for (const k of ["callsign", "flight", "type", "reg", "sim", "std", "sta", "out", "off", "on", "in", "notes", "started", "source"] as const) d[k] = f?.[k] ?? "";
  for (const k of ["blockMin", "airMin", "landingFpm", "landingG", "cruiseFl", "fuelKg", "pax"] as const) d[k] = f?.[k] != null ? String(f[k]) : "";
  return d;
};

function LogForm({ start, ref_, onDone }: { start: LogFlight | null; ref_: Ref | null; onDone: (id: string | null) => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(start));
  const [from, setFrom] = useState<string | null>(start?.from ?? null);
  const [to, setTo] = useState<string | null>(start?.to ?? null);
  const [err, setErr] = useState<string | null>(null);
  const opts = useMemo<PlaceOption[]>(() => {
    if (!ref_) return [];
    return [...ref_.airports.values()].map((a) => ({
      value: a.icao,
      code: a.icao,
      alt: a.iata,
      name: a.name,
      detail: [cityName(a), a.country ? countryName(a.country) : null].filter(Boolean).join(" · "),
      weight: 1,
      country: false,
    }));
  }, [ref_]);
  const set = (k: string) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));
  const n = (k: string) => (d[k].trim() && Number.isFinite(+d[k]) ? +d[k] : null);
  const s = (k: string) => d[k].trim() || null;

  const build = (): LogFlight | string => {
    if (!from || !to) return "Choose where the flight left from and where it landed.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return "Choose the date.";
    for (const [k, label] of [...TIME_FIELDS, ["started", "Listed time"] as const]) if (d[k].trim() && !clockOf(d[k])) return `${label} must be a time like 14:05.`;
    const callsign = s("callsign")?.toUpperCase().replace(/\s+/g, "") ?? null;
    const f: LogFlight = {
      id: start?.id ?? "",
      date: d.date,
      from,
      to,
      callsign,
      flight: s("flight")?.toUpperCase().replace(/\s+/g, "") ?? null,
      airline: airlineOf(callsign) ?? start?.airline ?? null,
      type: s("type")?.toUpperCase() ?? null,
      reg: s("reg")?.toUpperCase() ?? null,
      sim: s("sim"),
      std: clockOf(d.std),
      sta: clockOf(d.sta),
      out: clockOf(d.out),
      off: clockOf(d.off),
      on: clockOf(d.on),
      in: clockOf(d.in),
      blockMin: n("blockMin"),
      airMin: n("airMin"),
      landingFpm: n("landingFpm") == null ? null : -Math.abs(Math.round(n("landingFpm")!)),
      landingG: n("landingG"),
      status: (d.status as LogStatus) || null,
      started: clockOf(d.started),
      cruiseFl: n("cruiseFl"),
      fuelKg: n("fuelKg"),
      pax: n("pax"),
      source: s("source") ?? "manual",
      notes: s("notes"),
    };
    if (!f.id) f.id = defaultId(f);
    return f;
  };
  const preview = build();
  const submit = (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    const f = build();
    if (typeof f === "string") return setErr(f);
    if (start?.id && start.id !== f.id) deleteFlight(start.id);
    saveFlight(f);
    setErr(null);
    onDone(f.id);
  };
  const text = (k: string, label: string, extra: { placeholder?: string; inputMode?: "numeric" | "decimal" | "text"; className?: string; maxLength?: number } = {}) => (
    <label className={cx("ctl", extra.className)}>
      <span className="ctl-label">{label}</span>
      <input className="ctl-input" value={d[k]} onChange={set(k)} placeholder={extra.placeholder} inputMode={extra.inputMode} maxLength={extra.maxLength} />
    </label>
  );
  return (
    <form id="log-form" className="log-form" onSubmit={submit} noValidate>
      <fieldset>
        <legend>Flight</legend>
        <div className="log-grid">
          <label className="ctl">
            <span className="ctl-label">Date (UTC)</span>
            <input className="ctl-input" type="date" value={d.date} onChange={set("date")} required />
          </label>
          <PlacePicker label="From" value={from} options={opts} onChange={setFrom} anyLabel="Departure airport" />
          <PlacePicker label="To" value={to} options={opts} onChange={setTo} anyLabel="Arrival airport" />
          {text("callsign", "Callsign", { placeholder: "EZY42", maxLength: 10 })}
          {text("flight", "Flight number", { placeholder: "U21042", maxLength: 10 })}
          {text("type", "Aircraft type", { placeholder: "A20N", maxLength: 4 })}
          {text("reg", "Registration", { placeholder: "G-ABCD", maxLength: 10 })}
          {text("sim", "Simulator", { placeholder: "MSFS24", maxLength: 24 })}
        </div>
      </fieldset>
      <fieldset>
        <legend>Times (UTC, HH:MM)</legend>
        <div className="log-grid log-times">
          {TIME_FIELDS.map(([k, label]) => (
            <label key={k} className="ctl">
              <span className="ctl-label">{label}</span>
              <input
                className="ctl-input mono"
                value={d[k]}
                onChange={set(k)}
                placeholder="--:--"
                inputMode="numeric"
                maxLength={5}
                aria-invalid={d[k].trim() && !clockOf(d[k]) ? true : undefined}
              />
            </label>
          ))}
          {text("blockMin", "Block (min, if no OUT/IN)", { inputMode: "numeric", placeholder: "75" })}
          {text("airMin", "Airborne (min, if no OFF/ON)", { inputMode: "numeric", placeholder: "58" })}
          <label className="ctl">
            <span className="ctl-label">Listed time (your tracker&apos;s, any zone)</span>
            <input
              className="ctl-input mono"
              value={d.started}
              onChange={set("started")}
              placeholder="--:--"
              inputMode="numeric"
              maxLength={5}
              aria-invalid={d.started.trim() && !clockOf(d.started) ? true : undefined}
            />
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Landing and more</legend>
        <div className="log-grid">
          {text("landingFpm", "Landing rate (fpm)", { inputMode: "numeric", placeholder: "-180" })}
          {text("landingG", "Landing g", { inputMode: "decimal", placeholder: "1.18" })}
          {text("cruiseFl", "Cruise FL", { inputMode: "numeric", placeholder: "360" })}
          {text("fuelKg", "Fuel used (kg)", { inputMode: "numeric", placeholder: "2400" })}
          {text("pax", "Passengers", { inputMode: "numeric", placeholder: "174" })}
          <label className="ctl">
            <span className="ctl-label">Status</span>
            <select className="ctl-input" value={d.status} onChange={set("status")}>
              <option value="">From the times</option>
              {(Object.keys(STATUS_LABEL) as LogStatus[]).map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="ctl log-notes">
            <span className="ctl-label">Notes</span>
            <textarea className="ctl-input" value={d.notes} onChange={set("notes")} rows={2} maxLength={500} />
          </label>
        </div>
      </fieldset>
      <p className="log-preview small" aria-live="polite">
        {typeof preview === "string" ? (
          <span className="muted">{preview}</span>
        ) : (
          <>
            Block <b className="mono">{dur(blockOf(preview)) ?? "—"}</b> · airborne <b className="mono">{dur(airOf(preview)) ?? "—"}</b> · status{" "}
            <b>{statusOf(preview) ? STATUS_LABEL[statusOf(preview)!] : "—"}</b>
            {preview.landingFpm != null && (
              <>
                {" "}
                · landing <b className="mono">{preview.landingFpm} fpm</b> ({landingGrade(preview.landingFpm)?.label.toLowerCase()})
              </>
            )}
          </>
        )}
      </p>
      {err && (
        <p className="form-err" role="alert">
          {err}
        </p>
      )}
      <div className="log-acts">
        <button type="submit" className="btn btn-primary">
          {start?.id ? "Save changes" : "Add to logbook"}
        </button>
        {start && (
          <button type="button" className="btn" onClick={() => onDone(null)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/* ---------- import / export ---------- */

function ImportExport({ flights }: { flights: LogFlight[] }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const r = parseLogFile(await file.text());
    if ("error" in r) return setMsg({ ok: false, text: r.error });
    const { added, updated } = mergeFlights(r.flights);
    const skipped = r.skipped.length ? ` Skipped ${r.skipped.length}: ${r.skipped.slice(0, 3).map((s) => `#${s.index + 1} ${s.why}`).join("; ")}${r.skipped.length > 3 ? "…" : ""}.` : "";
    setMsg({ ok: !r.skipped.length, text: `Imported ${file.name}: ${added} new, ${updated} updated.${skipped}` });
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(exportFile(flights), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ofp-logbook-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="log-io">
      <div className="log-acts">
        <label className="btn log-file">
          Import a logbook file…
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ""))} />
        </label>
        <button type="button" className="btn" onClick={download} disabled={!flights.length}>
          Export {flights.length} {flights.length === 1 ? "flight" : "flights"} as JSON
        </button>
        {flights.length > 0 &&
          (confirm ? (
            <>
              <span className="small">Remove every flight from this browser?</span>
              <button type="button" className="btn btn-danger" onClick={() => (writeLog([]), setConfirm(false))}>
                Clear logbook
              </button>
              <button type="button" className="btn" onClick={() => setConfirm(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirm(true)}>
              Clear logbook…
            </button>
          ))}
      </div>
      {msg && (
        <p className={msg.ok ? "small" : "form-err"} role="status">
          {msg.text}
        </p>
      )}
      <details className="log-format">
        <summary>File format</summary>
        <p className="small">
          A JSON file <code>{`{ "schema": "${LOG_SCHEMA}", "version": 1, "flights": [ … ] }`}</code> (or just the list). Each flight needs <code>date</code>{" "}
          (YYYY-MM-DD, UTC), <code>from</code> and <code>to</code> (ICAO); everything else is optional. Times are <code>HH:MM</code> UTC; a later time that is
          earlier on the clock crossed midnight. Importing a flight with an <code>id</code> already in the logbook replaces it.
        </p>
        <pre className="log-example mono">{`{
  "id": "2026-10-03-EZY22N-EGBB-LEMD",
  "date": "2026-10-03",
  "from": "EGBB", "to": "LEMD",
  "callsign": "EZY22N", "flight": "U2227", "airline": "EZY",
  "type": "A20N", "reg": "G-ABCD", "sim": "MSFS24",
  "std": "16:30", "sta": "18:55",
  "out": "16:41", "off": "16:55", "on": "18:52", "in": "18:58",
  "blockMin": null, "airMin": null,
  "landingFpm": -180, "landingG": 1.12,
  "status": null,
  "cruiseFl": 360, "fuelKg": 4300, "pax": 171,
  "source": "manual", "notes": ""
}`}</pre>
        <p className="small">
          <code>status</code> is <code>early</code>, <code>on-time</code>, <code>late</code>, <code>delayed</code> or <code>cancelled</code>; leave it out to work it out from
          STD/STA against OUT/IN (more than 15 min either way). <code>blockMin</code> / <code>airMin</code> are for when OUT/IN or OFF/ON aren&apos;t known.
        </p>
      </details>
    </div>
  );
}
