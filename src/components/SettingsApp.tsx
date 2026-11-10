"use client";

import { Fragment, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { loadManifest } from "@/lib/data/load";
import type { Manifest } from "@/lib/data/types";
import { routeColor } from "@/lib/colors";
import { DEFAULT_AIRFRAMES, readAirframes, useAirframes, writeAirframes, type Airframe } from "@/lib/simbrief";
import { applyTheme, clearAll, readTheme, storageBytes, useStorageVersion, type ThemePref } from "@/lib/storage";
import { describeBackup, downloadBackup, readBackup, restoreBackup, type Backup } from "@/lib/backup";
import { StatusLine, TopBar } from "./chrome";
import { SavedFlights } from "./SavedFlights";
import { CollapseProvider, useCollapse } from "./collapse";
import { Badge, ScrollBox, Section } from "./ui";
import { DisplayPrefs } from "./DisplaySettings";

/**
 * Pulls the airframe id out of a pasted SimBrief "Plan" link, or takes the id as typed. Null when there's
 * none, or it isn't one (a broken %-escape, spaces or other characters SimBrief ids don't have).
 */
export function parseAirframeId(v: string): string | null {
  const t = v.trim();
  const m = t.match(/[?&]type=([^&#\s]+)/);
  let id: string;
  try {
    id = decodeURIComponent(m ? m[1] : t);
  } catch {
    return null;
  }
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
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
        <span className="muted">
          <span className="hide-xs">Everything here is stored in this browser only. Nothing is sent anywhere.</span>
          <span className="only-xs">Stored in this browser only</span>
        </span>
      </StatusLine>
      <main className="settings">
        <h1 className="sr-only">Settings</h1>
        <SettingsIndex />
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

const INDEX = [
  ["airframes", "Airframes"],
  ["display", "Display"],
  ["favourites", "Favourites"],
  ["data", "Snapshot"],
  ["device", "Theme & backup"],
] as const;

/** Straight to a section (opened if it was folded): Settings is long, and the backup is at the bottom. */
function SettingsIndex() {
  const { open } = useCollapse();
  return (
    <nav className="set-index" aria-label="Settings sections">
      {INDEX.map(([id, label]) => (
        <a key={id} href={`#${id}`} onClick={() => open(id)}>
          {label}
        </a>
      ))}
    </nav>
  );
}

function Airframes() {
  const prefs = useAirframes();
  const [form, setForm] = useState({ name: "", icao: "", sb: "", note: "" });
  // the message and the field it's about (focused and marked)
  const [err, setErr] = useState<{ text: string; field: "name" | "icao" | "sb" | null } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  if (!prefs) return <div className="sk-block" aria-hidden="true" />;

  const refused = "The browser refused to save it (storage full or blocked); nothing was changed.";
  const save = (p: typeof prefs) => {
    if (!writeAirframes(p)) setErr({ text: refused, field: null });
  };
  const add = (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    const sbType = parseAirframeId(form.sb);
    const icao = form.icao.trim().toUpperCase();
    const bad: { text: string; field: "name" | "icao" | "sb" } | null = !form.name.trim()
      ? { text: "Give it a name (G-ABCD).", field: "name" }
      : !/^[A-Z0-9]{2,4}$/.test(icao)
        ? { text: "The ICAO type is 2–4 letters and digits (A20N).", field: "icao" }
        : !form.sb.trim()
          ? { text: "Paste the SimBrief airframe id or its Plan link.", field: "sb" }
          : !sbType
            ? { text: "That isn’t a SimBrief airframe id: paste the Plan link from SimBrief → Airframes, or the id in it (like 123456_1700000000000).", field: "sb" }
            : null;
    if (bad) {
      setErr(bad);
      formRef.current?.querySelector<HTMLInputElement>(`[name="${bad.field}"]`)?.focus();
      return;
    }
    const a: Airframe = { id: `af-${Date.now().toString(36)}`, name: form.name.trim(), icao, sbType: sbType!, note: form.note.trim() || null };
    const cur = readAirframes();
    if (!writeAirframes({ list: [...cur.list, a], preferred: cur.preferred ?? a.id })) return setErr({ text: refused, field: null });
    setForm({ name: "", icao: "", sb: "", note: "" });
    setErr(null);
  };
  const invalid = (k: "name" | "icao" | "sb") => (err?.field === k ? { "aria-invalid": true, "aria-describedby": "af-err" } : {});

  return (
    <div className="airframes">
      <p className="muted">
        A saved airframe replaces the scheduled type in the SimBrief link, so SimBrief loads your registration, engines and weights. The{" "}
        <b>preferred</b> one is picked automatically when a flight’s type is in the same family (an A20N stands in for any A320-family flight).
      </p>
      <ScrollBox className="tbl-wrap" label="Saved airframes">
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
      </ScrollBox>
      <form className="af-form" onSubmit={add} ref={formRef} noValidate>
        <label>
          <span className="ctl-label">Name</span>
          <input className="ctl-input" name="name" value={form.name} placeholder="G-ABCD" onChange={(e) => setForm({ ...form, name: e.target.value })} {...invalid("name")} />
        </label>
        <label>
          <span className="ctl-label">ICAO type</span>
          <input
            className="ctl-input mono"
            name="icao"
            value={form.icao}
            placeholder="A20N"
            maxLength={4}
            onChange={(e) => setForm({ ...form, icao: e.target.value.toUpperCase() })}
            {...invalid("icao")}
          />
        </label>
        <label className="wide">
          <span className="ctl-label">SimBrief airframe id or Plan link</span>
          <input
            className="ctl-input mono"
            name="sb"
            value={form.sb}
            placeholder="123456_1700000000000"
            onChange={(e) => setForm({ ...form, sb: e.target.value })}
            {...invalid("sb")}
          />
        </label>
        <label className="wide">
          <span className="ctl-label">Note</span>
          <input className="ctl-input" value={form.note} placeholder="A320-251N · 180 seats" onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
        <button type="submit" className="btn btn-primary">
          Add airframe
        </button>
        {err && (
          <p className="form-err" role="alert" id="af-err">
            {err.text}
          </p>
        )}
      </form>
      <p className="muted small">
        Find the id on SimBrief → Airframes → Saved Airframes: the <b>Plan</b> link ends in <span className="mono">?type=…</span>. Paste the whole
        link.
        {DEFAULT_AIRFRAMES.length > 0 && !prefs.list.some((a) => a.id === DEFAULT_AIRFRAMES[0].id) && (
          <>
            {" "}
            <button type="button" className="linkish" onClick={() => save({ list: [...DEFAULT_AIRFRAMES, ...prefs.list], preferred: prefs.preferred })}>
              Restore {DEFAULT_AIRFRAMES[0].name}
            </button>
          </>
        )}
      </p>
    </div>
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
      <ScrollBox className="tbl-wrap" label="Sources">
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
              <td>Map elevation (height and depth contours) and land, coastlines and borders for the whole globe, built into the site</td>
              <td className="hide-s">Open data (SRTM, GMTED2010, ETOPO1…) · public domain</td>
              <td className="mono hide-xs">build</td>
            </tr>
            <tr>
              <td>
                <a href="https://www.simbrief.com/" target="_blank" rel="noopener noreferrer">
                  SimBrief
                </a>{" "}
                airframes
              </td>
              <td>Aircraft weights on the Range page (OEW, MZFW, MTOW, MLW, tanks): Fenix, FlyByWire and iniBuilds&apos; own airframes, built into the site</td>
              <td className="hide-s">© Navigraph and the developers</td>
              <td className="mono hide-xs">build</td>
            </tr>
          </tbody>
        </table>
      </ScrollBox>
      <h3 className="sub">Airlines</h3>
      <ScrollBox className="tbl-wrap" label="Airlines">
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
                    {a.extra && <span className="multi-tag">Extra+</span>}
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
      </ScrollBox>
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
      <BackupRestore onRestored={() => setBytes(storageBytes())} />
      {confirm ? (
        <p className="note-red">
          Remove airframes, favourites, recent flights, your logbook, cached weather and preferences? Download a backup first if you want to keep them.{" "}
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

/** Download everything stored here as one .json.gz, or put a backup back (replaces what's here, then reloads). */
function BackupRestore({ onRestored }: { onRestored: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<{ name: string; b: Backup } | null>(null);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPending(null);
    const r = await readBackup(file);
    if ("error" in r) return setMsg({ ok: false, text: r.error });
    setMsg(null);
    setPending({ name: file.name, b: r });
  };
  const restore = () => {
    if (!pending) return;
    if (!restoreBackup(pending.b)) return setMsg({ ok: false, text: "The browser refused to store the backup (storage full?). Nothing was changed." });
    setPending(null);
    onRestored();
    window.location.reload();
  };
  return (
    <div className="backup">
      <div className="backup-acts">
        <button type="button" className="btn" onClick={() => void downloadBackup().catch(() => setMsg({ ok: false, text: "This browser can't make the backup file." }))}>
          Download a backup (.json.gz)
        </button>
        <label className="btn backup-file">
          Restore from a backup…
          <input type="file" accept=".gz,.json,application/gzip,application/json" className="sr-only" onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ""))} />
        </label>
      </div>
      {pending ? (
        <p className="note-red">
          {pending.name}
          {pending.b.createdAt && ` (${pending.b.createdAt.slice(0, 16).replace("T", " ")}Z)`}: {describeBackup(pending.b)}. Replace everything stored in this browser with it?{" "}
          <button type="button" className="btn btn-danger" onClick={restore}>
            Yes, restore
          </button>{" "}
          <button type="button" className="btn" onClick={() => setPending(null)}>
            Cancel
          </button>
        </p>
      ) : (
        <p className="small muted">Airframes, favourites, recent flights, your logbook, flight numbers and preferences in one file, to keep or move to another browser.</p>
      )}
      {msg && (
        <p className={msg.ok ? "small" : "form-err"} role="status">
          {msg.text}
        </p>
      )}
    </div>
  );
}
