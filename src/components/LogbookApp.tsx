"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode, type SyntheticEvent } from "react";
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
                  <LogMap flights={flights} ref_={ref} sel={sel} />
                  <LogTable
                    flights={flights}
                    ref_={ref}
                    sel={sel}
                    onSel={(id) => setSel((s) => (s === id ? null : id))}
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

/* ---------- table ---------- */

function LogTable({
  flights,
  ref_,
  sel,
  onSel,
  onEdit,
}: {
  flights: LogFlight[];
  ref_: Ref | null;
  sel: string | null;
  onSel: (id: string) => void;
  onEdit: (f: LogFlight) => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const place = (icao: string) => {
    const a = ref_?.airports.get(icao);
    return (
      <span className="route-place" title={a ? airportLabel(a) : undefined}>
        {a?.country && <Flag cc={a.country} />}
        <span>{a ? (cityName(a) ?? airportLabel(a)) : icao}</span>
      </span>
    );
  };
  return (
    <div className="tbl-wrap log-wrap">
      <table className="tbl log-tbl">
        <caption className="sr-only">Flights flown, newest first. Select a row to see its details and highlight its route.</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Flight</th>
            <th scope="col">Route</th>
            <th scope="col" className="hide-s">
              Aircraft
            </th>
            <th scope="col" className="hide-s">
              OUT · OFF · ON · IN <span className="muted">(Z)</span>
            </th>
            <th scope="col" className="num">
              Block · air
            </th>
            <th scope="col">Status</th>
            <th scope="col" className="num">
              Landing
            </th>
          </tr>
        </thead>
        <tbody>
          {flights.map((f) => {
            const brand = ref_?.brands.get(f.airline ?? "");
            const s = statusOf(f);
            const g = landingGrade(f.landingFpm);
            const block = blockOf(f);
            const air = airOf(f);
            const dd = depDelay(f);
            const ad = arrDelay(f);
            const open = sel === f.id;
            const ident = f.flight ?? f.callsign ?? "—";
            return (
              <Fragment key={f.id}>
                <tr className={cx(open && "sel")} onClick={() => onSel(f.id)}>
                  <td className="mono">
                    <button type="button" className="log-date" aria-expanded={open} onClick={(e) => (e.stopPropagation(), onSel(f.id))}>
                      {f.date}
                    </button>
                    {f.started && !f.out && (
                      <small className="muted log-sub" title="The time your tracker lists for the flight (time zone not given)">
                        {f.started}
                      </small>
                    )}
                  </td>
                  <td>
                    <FlightIdent airline={brand} fallback={f.airline ?? "—"} ident={ident} />
                    {f.flight && f.callsign && <small className="muted mono log-sub">{f.callsign}</small>}
                  </td>
                  <td>
                    <span className="mono log-codes">
                      {f.from} <span aria-hidden="true">→</span> {f.to}
                    </span>
                    <small className="muted route-names">
                      {place(f.from)}
                      <span aria-hidden="true">→</span>
                      {place(f.to)}
                    </small>
                  </td>
                  <td className="hide-s">
                    {f.type ? <TypeBadge type={f.type} airline={brand} /> : <span className="muted">—</span>}
                    {f.reg && <small className="muted mono log-sub">{f.reg}</small>}
                  </td>
                  <td className="hide-s mono log-oooi">
                    {f.out || f.off || f.on || f.in ? (
                      <>
                        {[f.out, f.off, f.on, f.in].map((t, i) => (
                          <span key={i} className={t ? undefined : "muted"}>
                            {t ?? "--:--"}
                          </span>
                        ))}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                    {(f.std || f.sta) && (
                      <small className="muted log-sub">
                        sched {f.std ?? "--:--"}–{f.sta ?? "--:--"}
                      </small>
                    )}
                  </td>
                  <td className="mono num">
                    {dur(block) ?? "—"}
                    <small className="muted log-sub">{dur(air) ?? "—"}</small>
                  </td>
                  <td>
                    {s ? <span className={`badge ${STATUS_TONE[s]}`}>{STATUS_LABEL[s]}</span> : <span className="muted">—</span>}
                    {(ad != null || dd != null) && (
                      <small className="muted mono log-sub">
                        {dd != null && `dep ${signed(dd)}`}
                        {dd != null && ad != null && " · "}
                        {ad != null && `arr ${signed(ad)}`}
                      </small>
                    )}
                  </td>
                  <td className="num">
                    {f.landingFpm != null ? <span className="mono">{f.landingFpm} fpm</span> : <span className="muted">—</span>}
                    {g && <span className={`badge ${g.tone} log-grade`}>{g.label}</span>}
                  </td>
                </tr>
                {open && (
                  <tr className="log-detail">
                    <td colSpan={8}>
                      <dl className="log-facts">
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
                        {confirm === f.id ? (
                          <>
                            <span className="small">Delete this flight?</span>
                            <button type="button" className="btn btn-danger" onClick={() => (deleteFlight(f.id), setConfirm(null))}>
                              Delete
                            </button>
                            <button type="button" className="btn" onClick={() => setConfirm(null)}>
                              Keep
                            </button>
                          </>
                        ) : (
                          <button type="button" className="btn" onClick={() => setConfirm(f.id)}>
                            Delete…
                          </button>
                        )}
                      </div>
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
