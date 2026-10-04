"use client";

import { useEffect, useState, type SyntheticEvent } from "react";
import { hhmm } from "@/lib/data/flight";
import { loadManifest } from "@/lib/data/load";
import type { Manifest } from "@/lib/data/types";
import { routeColor } from "@/lib/colors";
import { clearHistory, removeFavourite, useSaved, type SavedFlight } from "@/lib/saved";
import { DEFAULT_AIRFRAMES, readAirframes, useAirframes, writeAirframes, type Airframe } from "@/lib/simbrief";
import { applyTheme, clearAll, readTheme, storageBytes, useStorageVersion, type ThemePref } from "@/lib/storage";
import { DEFAULT_DISPLAY, useDisplay, writeDisplay, type AirlineTagStyle } from "@/lib/display";
import { FlightIdent, TypeBadge } from "./badges";
import { StatusLine, TopBar } from "./chrome";
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
        <Section id="favourites" no={3} title="Favourites">
          <Saved kind="favourites" />
        </Section>
        <Section id="recent" no={4} title="Recent flights">
          <Saved kind="history" />
        </Section>
        <Section id="data" no={5} title="Schedule snapshot" meta={manifest ? <span className="mono">{manifest.generatedAt.slice(0, 10)}</span> : null}>
          <DataInfo manifest={manifest} error={mErr} />
        </Section>
        <Section id="device" no={6} title="Appearance & storage">
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
          <input className="ctl-input" value={form.name} placeholder="G-ZONA" onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
            placeholder="276565_1790212659311"
            onChange={(e) => setForm({ ...form, sb: e.target.value })}
          />
        </label>
        <label className="wide">
          <span className="ctl-label">Note</span>
          <input className="ctl-input" value={form.note} placeholder="A320-251N · LEAP-1A26" onChange={(e) => setForm({ ...form, note: e.target.value })} />
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
              Restore G-ZONA
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

function DisplayPrefs({ manifest }: { manifest: Manifest | null }) {
  const d = useDisplay();
  const ezy = manifest?.airlines.find((a) => a.icao === "EZY");
  const sampleAl = ["EZY", "RYR", "KLM", "BAW"].map((c) => manifest?.airlines.find((a) => a.icao === c));
  return (
    <div className="display-prefs">
      <fieldset className="opt-group">
        <legend className="ctl-label">Airline name tag</legend>
        <div className="opt-grid">
          {TAG_STYLES.map(([v, label, note]) => (
            <label key={v} className="opt">
              <input type="radio" name="airlineTag" checked={d.airlineTag === v} onChange={() => writeDisplay({ airlineTag: v })} />
              <span className="opt-body">
                <span className="opt-title">
                  {label}
                  {v === "solid" && <span className="muted"> (default)</span>}
                </span>
                <span className="opt-sample">
                  <FlightIdent airline={ezy} fallback="EZY" ident="EZY43NM" style={v} />
                </span>
                <span className="opt-note">{note}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="opt-group">
        <legend className="ctl-label">Order</legend>
        <div className="opt-grid two">
          {([true, false] as const).map((ff) => (
            <label key={String(ff)} className="opt">
              <input type="radio" name="flightFirst" checked={d.flightFirst === ff} onChange={() => writeDisplay({ flightFirst: ff })} />
              <span className="opt-body">
                <span className="opt-title">
                  {ff ? "Flight, then airline" : "Airline, then flight"}
                  {ff && <span className="muted"> (default)</span>}
                </span>
                <span className="opt-sample">
                  <FlightIdent airline={ezy} fallback="EZY" ident="EZY43NM" flightFirst={ff} />
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="opt-group">
        <legend className="ctl-label">Aircraft badges: colour by</legend>
        <div className="opt-grid two">
          {(["maker", "airline"] as const).map((c) => (
            <label key={c} className="opt">
              <input type="radio" name="typeColour" checked={d.typeColour === c} onChange={() => writeDisplay({ typeColour: c })} />
              <span className="opt-body">
                <span className="opt-title">
                  {c === "maker" ? "Manufacturer" : "Airline"}
                  {c === "maker" && <span className="muted"> (default)</span>}
                </span>
                <span className="opt-note">
                  {c === "maker" ? "Airbus blue · Boeing green · Embraer amber · ATR and Dash 8 red · others grey" : "The brand colour of the airline flying it"}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="opt-group">
        <legend className="ctl-label">Aircraft badges: theme</legend>
        <div className="opt-grid two">
          {(["full", "side"] as const).map((t) => (
            <label key={t} className="opt">
              <input type="radio" name="typeTheme" checked={d.typeTheme === t} onChange={() => writeDisplay({ typeTheme: t })} />
              <span className="opt-body">
                <span className="opt-title">
                  {t === "full" ? "Fully coloured" : "Coloured edge"}
                  {t === "full" && <span className="muted"> (default)</span>}
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className="opt-sample types-dd">
          {(["A20N", "B38M", "E190", "AT76"] as const).map((t, i) => (
            <TypeBadge key={t} type={t} airline={sampleAl[i]} />
          ))}
          <span className="muted small"> Hover a badge for its manufacturer and full name.</span>
        </p>
      </fieldset>
      <button type="button" className="chip" onClick={() => writeDisplay(DEFAULT_DISPLAY)}>
        Reset display to defaults
      </button>
    </div>
  );
}

function Saved({ kind }: { kind: "favourites" | "history" }) {
  const saved = useSaved();
  if (!saved) return <div className="sk-block" aria-hidden="true" />;
  const list = saved[kind];
  if (!list.length)
    return (
      <p className="muted">
        {kind === "favourites" ? "No favourites yet. Use the star on a flight to keep it here." : "Flights you open in the Finder show up here."}
      </p>
    );
  return (
    <>
      <ul className="saved-list">
        {list.map((s: SavedFlight) => (
          <li key={s.id}>
            <a href={`/?al=${s.al}&dep=${s.o}&arr=${s.d}&f=${encodeURIComponent(s.id)}`}>
              <span className="mono">
                {s.fn ? `${s.al} ${s.fn}` : (s.cs ?? s.al)}
              </span>{" "}
              <span className="mono">
                {s.o} → {s.d}
              </span>
              {s.std != null && <span className="muted mono"> {hhmm(s.std)}Z</span>}
              {s.fn && s.cs && <span className="muted mono"> · {s.cs}</span>}
            </a>
            <a className="chip" href={`/brief?f=${encodeURIComponent(s.id)}`}>
              Brief
            </a>
            {kind === "favourites" && (
              <button type="button" className="chip" onClick={() => removeFavourite(s.id)}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {kind === "history" && (
        <button type="button" className="chip" onClick={clearHistory}>
          Clear recent flights
        </button>
      )}
    </>
  );
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
