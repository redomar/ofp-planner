"use client";

import { Fragment, useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { loadAirline, loadAirports, loadManifest, type Airport, type FlightRow } from "@/lib/data/load";
import { enrich } from "@/lib/data/query";
import { RouteHead } from "./RouteHead";
import type { Manifest } from "@/lib/data/types";
import { routeColor } from "@/lib/colors";
import { DEFAULT_AIRFRAMES, readAirframes, useAirframes, writeAirframes, type Airframe } from "@/lib/simbrief";
import { applyTheme, clearAll, readTheme, storageBytes, useStorageVersion, type ThemePref } from "@/lib/storage";
import { DEFAULT_DISPLAY, useDisplay, writeDisplay, type AirlineTagStyle } from "@/lib/display";
import { FlightIdent, TypeBadge } from "./badges";
import { StatusLine, TopBar } from "./chrome";
import { SavedFlights } from "./SavedFlights";
import { CollapseProvider } from "./collapse";
import { Badge, Section } from "./ui";

/** Pulls the airframe id out of a pasted SimBrief "Plan" link, or takes the id as typed. */
export function parseAirframeId(v: string): string {
  const t = v.trim();
  const m = t.match(/[?&]type=([^&#\s]+)/);
  return decodeURIComponent(m ? m[1] : t);
}

export function SettingsApp() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [mErr, setMErr] = useState<string | null>(null);
  useEffect(() => {
    loadManifest().then(setManifest, (e: unknown) => setMErr(e instanceof Error ? e.message : String(e)));
  }, []);
  const v = useStorageVersion();

  return (
    <CollapseProvider>
      <TopBar />
      <StatusLine>
        <span className="muted">Everything here is stored in this browser only. Nothing is sent anywhere.</span>
      </StatusLine>
      <main className="settings">
        {v >= 0 && (
          <>
        <Section id="airframes" no={1} title="Airframes" meta={<span>Used for SimBrief links</span>}>
          <Airframes />
        </Section>
        <Section id="display" no={2} title="Display" meta={<span>Flights table, airport list, flight card</span>}>
          <DisplayPrefs manifest={manifest} />
        </Section>
        <Section id="favourites" no={3} title="Favourites & recent">
          <SavedFlights recentMax={40} />
        </Section>
        <Section id="data" no={4} title="Schedule snapshot" meta={manifest ? <span className="mono">{manifest.generatedAt.slice(0, 10)}</span> : null}>
          <DataInfo manifest={manifest} error={mErr} />
        </Section>
        <Section id="device" no={5} title="Appearance & storage">
          <Device key={v} />
        </Section>
          </>
        )}
      </main>
    </CollapseProvider>
  );
}

function Airframes() {
  const prefs = useAirframes();
  const [form, setForm] = useState({ name: "", icao: "", sb: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  if (!prefs) return <div className="sk-block" aria-hidden="true" />;

  const save = (p: typeof prefs) => writeAirframes(p);
  const add = (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    const sbType = parseAirframeId(form.sb);
    const icao = form.icao.trim().toUpperCase();
    if (!form.name.trim() || !/^[A-Z0-9]{2,4}$/.test(icao) || !sbType) {
      setErr("Give it a name, a 2–4 character ICAO type (A20N) and the SimBrief airframe id or Plan link.");
      return;
    }
    const a: Airframe = { id: `af-${Date.now().toString(36)}`, name: form.name.trim(), icao, sbType, note: form.note.trim() || null };
    const cur = readAirframes();
    save({ list: [...cur.list, a], preferred: cur.preferred ?? a.id });
    setForm({ name: "", icao: "", sb: "", note: "" });
    setErr(null);
  };

  return (
    <div className="airframes">
      <p className="muted">
        A saved airframe replaces the scheduled type in the SimBrief link, so SimBrief loads your registration, engines and weights. The{" "}
        <b>preferred</b> one is picked automatically when a flight’s type is in the same family (an A20N stands in for any A320-family flight).
      </p>
      <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th scope="col">Preferred</th>
            <th scope="col">Name</th>
            <th scope="col">Type</th>
            <th scope="col">SimBrief id</th>
            <th scope="col" className="hide-s">
              Note
            </th>
            <th scope="col">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {prefs.list.map((a) => (
            <tr key={a.id}>
              <td>
                <input
                  type="radio"
                  name="preferred"
                  aria-label={`Prefer ${a.name}`}
                  checked={prefs.preferred === a.id}
                  onChange={() => save({ ...prefs, preferred: a.id })}
                />
              </td>
              <td className="mono">{a.name}</td>
              <td className="mono">{a.icao}</td>
              <td className="mono small af-id">{a.sbType}</td>
              <td className="hide-s">{a.note}</td>
              <td>
                <button
                  type="button"
                  className="chip"
                  onClick={() => save({ list: prefs.list.filter((x) => x.id !== a.id), preferred: prefs.preferred === a.id ? null : prefs.preferred })}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {!prefs.list.length && (
            <tr>
              <td colSpan={6} className="muted">
                No saved airframes; links use the scheduled type.
              </td>
            </tr>
          )}
          <tr>
            <td>
              <input type="radio" name="preferred" aria-label="No preferred airframe" checked={!prefs.preferred} onChange={() => save({ ...prefs, preferred: null })} />
            </td>
            <td colSpan={5} className="muted">
              None: always use the scheduled type
            </td>
          </tr>
        </tbody>
      </table>
      </div>
      <form className="af-form" onSubmit={add}>
        <label>
          <span className="ctl-label">Name</span>
          <input className="ctl-input" value={form.name} placeholder="G-ABCD" onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          <span className="ctl-label">ICAO type</span>
          <input className="ctl-input mono" value={form.icao} placeholder="A20N" maxLength={4} onChange={(e) => setForm({ ...form, icao: e.target.value.toUpperCase() })} />
        </label>
        <label className="wide">
          <span className="ctl-label">SimBrief airframe id or Plan link</span>
          <input
            className="ctl-input mono"
            value={form.sb}
            placeholder="123456_1700000000000"
            onChange={(e) => setForm({ ...form, sb: e.target.value })}
          />
        </label>
        <label className="wide">
          <span className="ctl-label">Note</span>
          <input className="ctl-input" value={form.note} placeholder="A320-251N · LEAP-1A" onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
        <button type="submit" className="btn btn-primary">
          Add airframe
        </button>
        {err && (
          <p className="form-err" role="alert">
            {err}
          </p>
        )}
      </form>
      <p className="muted small">
        Find the id on SimBrief → Airframes → Saved Airframes: the <b>Plan</b> link ends in <span className="mono">?type=…</span>. Paste the whole
        link.
        {!prefs.list.some((a) => a.id === DEFAULT_AIRFRAMES[0].id) && (
          <>
            {" "}
            <button type="button" className="linkish" onClick={() => save({ list: [...DEFAULT_AIRFRAMES, ...prefs.list], preferred: prefs.preferred })}>
              Restore G-ABCD
            </button>
          </>
        )}
      </p>
    </div>
  );
}

const TAG_STYLES: [AirlineTagStyle, string, string][] = [
  ["solid", "Solid", "Name in the brand colour; text black or white for contrast"],
  ["tint", "Tinted", "Square plus the name on a light tint of the brand colour"],
  ["split", "Split pill", "Flight and airline as two halves of one pill"],
  ["edge", "Edge", "Neutral tag with a brand-colour edge"],
];

/** A radio card: title (+ default marker), note, and a live sample of the option. */
function Opt({ name, checked, onChange, title, isDefault, note, children }: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  isDefault?: boolean;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <label className="opt">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span className="opt-body">
        <span className="opt-title">
          {title}
          {isDefault && <span className="muted"> (default)</span>}
        </span>
        {note && <span className="opt-note">{note}</span>}
        {children && <span className="opt-sample">{children}</span>}
      </span>
    </label>
  );
}

const SAMPLE_TYPES = [
  ["A20N", "EZY"],
  ["B38M", "RYR"],
  ["E190", "KLM"],
  ["AT76", "BAW"],
] as const;

function DisplayPrefs({ manifest }: { manifest: Manifest | null }) {
  const d = useDisplay();
  const al = (c: string) => manifest?.airlines.find((a) => a.icao === c);
  const ezy = al("EZY");
  const badges = (colour: "maker" | "airline", theme: "side" | "full") => (
    <span className="types-dd">
      {SAMPLE_TYPES.map(([t, c]) => (
        <TypeBadge key={t} type={t} airline={al(c)} colour={colour} theme={theme} />
      ))}
    </span>
  );
  const sample = useSampleFlight();
  return (
    <div className="display-prefs">
      <fieldset className="opt-group">
        <legend className="ctl-label">Airline name tag</legend>
        <div className="opt-grid">
          {TAG_STYLES.map(([v, label, note]) => (
            <Opt key={v} name="airlineTag" checked={d.airlineTag === v} onChange={() => writeDisplay({ airlineTag: v })} title={label} isDefault={v === "solid"} note={note}>
              <FlightIdent airline={ezy} fallback="EZY" ident="EZY43NM" style={v} />
            </Opt>
          ))}
        </div>
      </fieldset>

      <fieldset className="opt-group">
        <legend className="ctl-label">Order</legend>
        <div className="opt-grid two">
          {([true, false] as const).map((ff) => (
            <Opt
              key={String(ff)}
              name="flightFirst"
              checked={d.flightFirst === ff}
              onChange={() => writeDisplay({ flightFirst: ff })}
              title={ff ? "Flight, then airline" : "Airline, then flight"}
              isDefault={ff}
            >
              <FlightIdent airline={ezy} fallback="EZY" ident="EZY43NM" flightFirst={ff} />
            </Opt>
          ))}
        </div>
      </fieldset>

      <fieldset className="opt-group">
        <legend className="ctl-label">Aircraft type badges</legend>
        <p className="opt-lead muted">
          Shown in the flights table, airport list and flight card. Pick what the colour means and how much of the badge it fills. Hover a badge for its
          manufacturer and full name.
        </p>
        <div className="badge-matrix" role="radiogroup" aria-label="Aircraft type badges">
          <span aria-hidden="true" />
          <span className="bm-col">Filled</span>
          <span className="bm-col">Edge only</span>
          {(
            [
              ["maker", "Colour by manufacturer", "Airbus blue · Boeing green · Embraer amber · ATR and Dash 8 red"],
              ["airline", "Colour by airline", "The brand colour of the airline flying it"],
            ] as const
          ).map(([colour, label, note]) => (
            <Fragment key={colour}>
              <span className="bm-row">
                <b>{label}</b>
                <small>{note}</small>
              </span>
              {(["full", "side"] as const).map((theme) => {
                const on = d.typeColour === colour && d.typeTheme === theme;
                return (
                  <label key={theme} className={`opt bm-cell${on ? " on" : ""}`}>
                    <input
                      type="radio"
                      name="typeBadge"
                      checked={on}
                      onChange={() => writeDisplay({ typeColour: colour, typeTheme: theme })}
                      aria-label={`${label}, ${theme === "full" ? "filled" : "edge only"}${colour === "maker" && theme === "full" ? " (default)" : ""}`}
                    />
                    <span className="bm-cap" aria-hidden="true">
                      {theme === "full" ? "Filled" : "Edge only"}
                    </span>
                    {badges(colour, theme)}
                    {colour === "maker" && theme === "full" && <span className="muted bm-def">default</span>}
                  </label>
                );
              })}
            </Fragment>
          ))}
        </div>
      </fieldset>

      <fieldset className="opt-group">
        <legend className="ctl-label">Flight card: departs / arrives</legend>
        <div className="opt-grid stack">
          {(
            [
              ["timeline", "Timeline", "Both ends with city and airport, then the OUT · OFF · ON · IN track with every time in order."],
              ["pass", "Boarding pass", "Each end in a stub, a perforated middle with the aircraft, block time and distance; times along the bottom."],
              ["board", "Departure board", "Split-flap rows like an airport screen: time, code and city. Light by day, dark at night."],
            ] as const
          ).map(([v, label, note]) => (
            <Opt key={v} name="routeHead" checked={d.routeHead === v} onChange={() => writeDisplay({ routeHead: v })} title={label} isDefault={v === "timeline"} note={note}>
              {sample ? (
                <span className="rh-sample" aria-hidden="true">
                  <RouteHead style={v} f={sample.f} from={sample.from} to={sample.to} blockMin={sample.block} nm={sample.nm} />
                </span>
              ) : (
                <span className="sk-block" />
              )}
            </Opt>
          ))}
        </div>
      </fieldset>

      <fieldset className="opt-group">
        <legend className="ctl-label">Maps: destination codes</legend>
        <div className="opt-grid">
          {(
            [
              ["iata", "IATA", "Three-letter codes passengers know (BCN, ADB)."],
              ["icao", "ICAO", "Four-letter codes pilots and SimBrief use (LEBL, LTBJ)."],
              ["off", "Off", "Only the shared airport is labelled; hover a destination to see its code."],
            ] as const
          ).map(([v, label, note]) => (
            <Opt key={v} name="mapCodes" checked={d.mapCodes === v} onChange={() => writeDisplay({ mapCodes: v })} title={label} isDefault={v === "iata"} note={note}>
              <MiniMap mode={v} />
            </Opt>
          ))}
        </div>
      </fieldset>

      <button type="button" className="chip" onClick={() => writeDisplay(DEFAULT_DISPLAY)}>
        Reset display to defaults
      </button>
    </div>
  );
}

/** A small map sketch for the codes setting: a hub and three destinations, labelled per option. */
function MiniMap({ mode }: { mode: "iata" | "icao" | "off" }) {
  const ports: [number, number, string, string][] = [
    [48, 70, "BCN", "LEBL"],
    [150, 34, "MUC", "EDDM"],
    [196, 92, "ADB", "LTBJ"],
    [116, 104, "FCO", "LIRF"],
  ];
  const [hx, hy] = ports[0];
  const code = (i: string, o: string) => (mode === "icao" ? o : i);
  return (
    <svg className="mini-map" viewBox="0 0 240 124" role="img" aria-label={`Map sample with ${mode === "off" ? "no destination codes" : `${mode.toUpperCase()} codes`}`}>
      <rect width="240" height="124" className="map-sea" />
      <path className="map-land" d="M0 40 C40 30 70 50 100 44 C140 36 170 20 240 26 L240 70 C210 76 200 60 170 66 C150 70 140 84 120 80 C100 76 92 96 70 92 C50 88 30 98 0 92 Z" />
      <path className="map-grat" d="M0 62H240M60 0V124M120 0V124M180 0V124" />
      {ports.slice(1).map(([x, y]) => (
        <g key={`${x}${y}`} className="map-route on">
          <path className="map-casing" d={`M${hx} ${hy}L${x} ${y}`} style={{ strokeWidth: 3.4 }} />
          <path className="map-line" d={`M${hx} ${hy}L${x} ${y}`} style={{ stroke: "#ff6600", strokeWidth: 1.8, animation: "none", strokeDasharray: "none", strokeDashoffset: 0 }} />
        </g>
      ))}
      {ports.map(([x, y, i, o], k) => (
        <g key={i} className={`map-port${k === 0 ? " hub" : ""}`} transform={`translate(${x} ${y})`}>
          <circle className="map-dot" r={k === 0 ? 4.5 : 3.4} />
          {(k === 0 || mode !== "off") && (
            <text x={k === 0 ? 0 : 7} y={k === 0 ? -9 : 4} textAnchor={k === 0 ? "middle" : "start"}>
              {code(i, o)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** A real flight from the snapshot for the flight-card samples (Pegasus 1528 Barcelona → Izmir, else any). */
function useSampleFlight() {
  const [s, setS] = useState<{ f: FlightRow; from: Airport | undefined; to: Airport | undefined; block: number | null; nm: number | null } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const [m, airports] = await Promise.all([loadManifest(), loadAirports()]);
      const info = m.airlines.find((a) => a.icao === "PGT") ?? m.airlines[0];
      const rows = await loadAirline(info, m);
      const f = rows.find((r) => r.o === "LEBL" && r.d === "LTBJ") ?? rows.find((r) => r.off != null) ?? rows[0];
      const r = enrich(f, airports);
      if (live) setS({ f, from: airports.get(f.o), to: airports.get(f.d), block: r.block?.min ?? null, nm: r.nm });
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return s;
}

function DataInfo({ manifest, error }: { manifest: Manifest | null; error: string | null }) {
  if (error) return <p className="note-red">Couldn’t read the snapshot manifest: {error}</p>;
  if (!manifest) return <div className="sk-block" aria-hidden="true" />;
  const c = manifest.counts;
  return (
    <div className="datainfo">
      <dl className="facts">
        <div>
          <dt>Generated</dt>
          <dd className="mono">{manifest.generatedAt.replace("T", " ").slice(0, 16)}Z</dd>
        </div>
        <div>
          <dt>Schedules cover</dt>
          <dd className="mono">{manifest.coverage ? `${manifest.coverage.from} → ${manifest.coverage.to}` : "—"}</dd>
        </div>
        <div>
          <dt>Flights</dt>
          <dd className="mono">{c.flights.toLocaleString("en-GB")}</dd>
        </div>
        <div>
          <dt>Routes · airports</dt>
          <dd className="mono">
            {c.routes.toLocaleString("en-GB")} · {c.airports.toLocaleString("en-GB")}
          </dd>
        </div>
      </dl>
      <p className="muted">
        The schedule is a snapshot built offline from the sources below, not live data. Times and flight numbers are real for the period covered but
        can change; check the airline before relying on one.
      </p>
      <h3 className="sub">Sources</h3>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Provides</th>
              <th scope="col" className="hide-s">
                Licence
              </th>
              <th scope="col" className="hide-xs">
                Fetched
              </th>
            </tr>
          </thead>
          <tbody>
            {manifest.sources.map((s) => (
              <tr key={s.id}>
                <td>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.name}
                  </a>
                </td>
                <td>{s.provides}</td>
                <td className="hide-s">{s.licence}</td>
                <td className="mono hide-xs">{s.fetchedAt.slice(0, 10)}</td>
              </tr>
            ))}
            <tr>
              <td>
                <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
                  Open-Meteo
                </a>{" "}
                ·{" "}
                <a href="https://metar.vatsim.net/" target="_blank" rel="noopener noreferrer">
                  VATSIM METAR
                </a>
              </td>
              <td>Forecasts and current METARs on the Brief page, fetched live when you open it</td>
              <td className="hide-s">CC BY 4.0 · VATSIM data</td>
              <td className="mono hide-xs">live</td>
            </tr>
            <tr>
              <td>
                <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener noreferrer">
                  AWS Terrain Tiles
                </a>{" "}
                ·{" "}
                <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">
                  Natural Earth
                </a>
              </td>
              <td>Map elevation (height and depth contours) and land, coastlines and borders, built into the site</td>
              <td className="hide-s">Open data (SRTM, GMTED2010, ETOPO1…) · public domain</td>
              <td className="mono hide-xs">build</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3 className="sub">Airlines</h3>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">Airline</th>
              <th scope="col">Codes</th>
              <th scope="col" className="hide-xs">
                Operators
              </th>
              <th scope="col" className="num">
                Flights
              </th>
            </tr>
          </thead>
          <tbody>
            {[...manifest.airlines]
              .sort((a, b) => b.flights - a.flights)
              .map((a) => (
                <tr key={a.icao}>
                  <td>
                    <span className="al-dot" style={{ background: routeColor(a) }} aria-hidden="true" /> {a.name}
                  </td>
                  <td className="mono">
                    {a.iata ?? "—"} / {a.icao}
                  </td>
                  <td className="mono hide-xs">{a.operators.join(" ")}</td>
                  <td className="mono num">{a.flights.toLocaleString("en-GB")}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Device() {
  const [theme, setTheme] = useState<ThemePref>("system");
  const [bytes, setBytes] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- browser-only values, read after hydration */
    setTheme(readTheme());
    setBytes(storageBytes());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  return (
    <div className="device">
      <fieldset className="radios">
        <legend className="ctl-label">Theme</legend>
        {(["system", "light", "dark"] as const).map((t) => (
          <label key={t}>
            <input
              type="radio"
              name="theme"
              checked={theme === t}
              onChange={() => {
                applyTheme(t);
                setTheme(t);
              }}
            />
            {t === "system" ? "Match the system" : t === "light" ? "Day" : "Night"}
          </label>
        ))}
      </fieldset>
      <p>
        Stored in this browser: <span className="mono">{bytes == null ? "…" : `${(bytes / 1024).toFixed(1)} KB`}</span>{" "}
        <Badge tone="green">private</Badge>
      </p>
      {confirm ? (
        <p className="note-red">
          Remove airframes, favourites, recent flights, cached weather and preferences?{" "}
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              clearAll();
              setConfirm(false);
              setBytes(storageBytes());
            }}
          >
            Yes, clear everything
          </button>{" "}
          <button type="button" className="btn" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </p>
      ) : (
        <button type="button" className="btn" onClick={() => setConfirm(true)}>
          Clear all saved data…
        </button>
      )}
    </div>
  );
}
