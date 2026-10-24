"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode, type SubmitEvent } from "react";
import { loadAirports, type Airport } from "@/lib/data/load";
import { countryName } from "@/lib/places";
import {
  BEST_PLANES,
  DEFAULT_PLANES,
  FAMILIES,
  LOADS,
  NM_PER_DEG,
  PLANES,
  REFERENCE,
  TAXI,
  maxZfw,
  planeById,
  planeName,
  rangeOf,
  readRange,
  writeRange,
  type Load,
  type Plane,
  type RangePlace,
  type RangeState,
} from "@/lib/range";
import { useStorageVersion } from "@/lib/storage";
import { StatusLine, TopBar } from "./chrome";
import { CollapseProvider } from "./collapse";
import { PlacePicker, type PlaceOption } from "./pickers";
import { RangeMap, type RangePoint, type Ring } from "./RangeMap";
import { Section, cx } from "./ui";

const nmFmt = (n: number) => `${n.toLocaleString("en-GB")} NM`;
const tonnes = (kg: number) => (kg / 1000).toFixed(1);

/** Great-circle distance in NM. */
function gc(a: RangePlace, b: RangePlace): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return Math.round(2 * Math.asin(Math.sqrt(h)) * (180 / Math.PI) * NM_PER_DEG);
}

/** Each family has a colour; its variants step from that colour towards the ink, in list order. */
function ringColor(p: Plane): string {
  const fam = PLANES.filter((q) => q.family === p.family);
  const t = fam.length > 1 ? fam.indexOf(p) / (fam.length - 1) : 0;
  return `color-mix(in oklab, var(--rr-${p.family.toLowerCase()}) ${Math.round(100 - t * 45)}%, var(--ink))`;
}
const ringDash = (p: Plane) => (p.act === 1 ? "8 4" : p.act === 2 ? "14 4 3 4" : undefined);

/**
 * How far each sim A320 can go from an airport: a ring per aircraft on the chart, for an empty,
 * half or full payload, plus the user's own airports to test as origins and destinations.
 */
export function RangeApp() {
  const v = useStorageVersion();
  const [airports, setAirports] = useState<Map<string, Airport> | null>(null);
  const [failed, setFailed] = useState(false);
  const [hot, setHot] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadAirports().then(
      (m) => live && setAirports(m),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  /** An airport by ICAO from the snapshot, then the long-haul reference list. */
  const known = useMemo(() => {
    const m = new Map<string, RangePlace & { detail: string; iata: string | null }>();
    for (const r of REFERENCE) m.set(r.icao, { ...r, detail: "Reference airport", iata: null });
    if (airports)
      for (const a of airports.values())
        m.set(a.icao, { icao: a.icao, name: a.name, lat: a.lat, lon: a.lon, iata: a.iata, detail: [a.city, a.country ? countryName(a.country) : null].filter(Boolean).join(" · ") });
    return m;
  }, [airports]);

  // read once storage is available and the airports are in (or failed), so the default airports can be named
  const state = useMemo(() => (v < 0 || (!airports && !failed) ? null : readRange((icao) => {
            const k = known.get(icao);
            return k ? { icao: k.icao, name: k.name, lat: k.lat, lon: k.lon } : null;
          })), [v, airports, failed, known]);

  if (!state) {
    return (
      <Shell>
        <div className="range-wait" aria-hidden="true" />
      </Shell>
    );
  }
  return (
    <Shell>
      <Range state={state} known={known} hot={hot} setHot={setHot} />
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <CollapseProvider>
      <TopBar />
      <StatusLine>
        <span className="muted">Still-air range with reserves, from each developer&apos;s SimBrief weights. Estimates, good to about ±5%.</span>
      </StatusLine>
      <main className="settings range-page">{children}</main>
    </CollapseProvider>
  );
}

type Known = Map<string, RangePlace & { detail: string; iata: string | null }>;
type Out = ReturnType<typeof rangeOf>;
const reachOf = (r: Out) => (r.ok ? r.nm : 0);
const loadName = (load: Load) => (load === 3 ? "your own figures" : `${LOADS[load].label.toLowerCase()} payload`);

function Range({ state, known, hot, setHot }: { state: RangeState; known: Known; hot: string | null; setHot: (id: string | null) => void }) {
  const update = (patch: Partial<RangeState>) => writeRange({ ...state, ...patch });
  const mineSet = new Set(state.mine.map((m) => m.icao));
  const place = (icao: string): RangePlace | null => state.mine.find((m) => m.icao === icao) ?? known.get(icao) ?? null;
  const origin = place(state.origin) ?? place("EGLL") ?? { icao: "EGLL", name: "London Heathrow", lat: 51.4708, lon: -0.4599 };

  const shown = PLANES.filter((p) => state.planes.includes(p.id));
  const ranges = useMemo(() => new Map(PLANES.map((p) => [p.id, rangeOf(p, state.load, state.custom)])), [state.load, state.custom]);
  const flying = shown.filter((p) => ranges.get(p.id)!.ok);
  const rings: Ring[] = flying.map((p) => ({ id: p.id, nm: reachOf(ranges.get(p.id)!), color: ringColor(p), dash: ringDash(p), name: planeName(p) }));
  // the view fits the furthest these aircraft go empty, so switching the load doesn't move the map
  const fitNm = Math.max(1500, ...shown.map((p) => reachOf(rangeOf(p, 0))));

  const options: PlaceOption[] = useMemo(() => {
    const out = new Map<string, PlaceOption>();
    for (const k of known.values()) out.set(k.icao, { value: k.icao, code: k.icao, alt: k.iata, name: k.name, detail: k.detail, weight: 0, country: false });
    for (const m of state.mine) if (!out.has(m.icao)) out.set(m.icao, { value: m.icao, code: m.icao, alt: null, name: m.name, detail: "Your airport", weight: 0, country: false });
    for (const m of state.mine) out.get(m.icao)!.weight = 1; // yours first when nothing's typed
    return [...out.values()];
  }, [known, state.mine]);

  const tipFor = (pt: RangePlace, d: number): Record<string, string> => ({
    "data-tip-title": `${pt.icao} · ${pt.name}`,
    "data-tip": `${nmFmt(d)} from ${origin.icao}.`,
    "data-tip-rows": JSON.stringify(
      shown.map((p) => {
        const r = ranges.get(p.id)!;
        if (!r.ok) return { chip: { label: "N/A", color: "var(--sunk)", ink: "var(--ink-2)" }, text: `${planeName(p)} · ${r.why}` };
        const ok = r.nm >= d;
        // range first, padded, so the numbers line up and a long name wraps on its own
        return { chip: { label: ok ? "IN" : "OUT", color: ok ? "var(--ink)" : "var(--sunk)", ink: ok ? "var(--sheet)" : "var(--ink-2)" }, text: `${nmFmt(r.nm).padStart(8)}  ${planeName(p).replace(/(\d) ACT/, "$1\u00a0ACT")}`, hang: 10 };
      }),
    ),
    "data-tip-note": "Click to make it the origin.",
  });

  const points: RangePoint[] = [...REFERENCE.filter((r) => !mineSet.has(r.icao)).map((r) => ({ ...r, mine: false })), ...state.mine.map((m) => ({ ...m, mine: true }))]
    .filter((p) => p.icao !== origin.icao)
    .map((p) => {
      const d = gc(origin, p);
      return { ...p, d, tip: tipFor(p, d) };
    });

  const toggle = (id: string, on: boolean) => update({ planes: on ? [...state.planes, id] : state.planes.filter((x) => x !== id) });
  const addMine = (p: RangePlace) => !mineSet.has(p.icao) && update({ mine: [...state.mine, p] });
  const blocked = shown.length - flying.length;

  return (
    <>
      <Section id="range-map" no={1} title="Range rings" meta={<span className="mono">{`${origin.icao} · ${loadName(state.load)}`}</span>}>
        <div className="range-controls">
          <div className="range-origin">
            <PlacePicker label="Origin" value={origin.icao} options={options} onChange={(icao) => icao && update({ origin: icao })} anyLabel="Type an airport" />
          </div>
          <Seg
            id="range-load-l"
            label="Payload"
            value={state.load}
            options={LOADS.map((l) => ({ v: l.v, label: l.label, tip: l.tip }))}
            onChange={(load) => update({ load: load as Load })}
          />
          <Seg
            id="range-relief-l"
            label="Terrain"
            value={state.relief ? 1 : 0}
            options={[
              { v: 0, label: "Off", tip: "Plain land and sea, so the rings stand out" },
              { v: 1, label: "On", tip: "Height and depth shading, with sea, country and mountain names" },
            ]}
            onChange={(v) => update({ relief: v === 1 })}
          />
        </div>
        {state.load === 3 ? (
          <CustomLoad custom={state.custom} blocked={blocked} onChange={(custom) => update({ custom })} />
        ) : (
          <p className="small muted range-load-tip">{LOADS[state.load].tip} Each aircraft uses its own OEW, MZFW, tanks and MTOW, listed beside its range.</p>
        )}
        <div className="range-grid">
          <RangeMap
            origin={origin}
            rings={rings}
            fitNm={fitNm}
            hot={hot && rings.some((r) => r.id === hot) ? hot : null}
            points={points}
            onPick={(icao) => update({ origin: icao })}
            label={`Range rings from ${origin.icao} for ${rings.length} aircraft with ${loadName(state.load)}.`}
            relief={state.relief}
          />
          <Rack state={state} ranges={ranges} setHot={setHot} toggle={toggle} setPlanes={(planes) => update({ planes })} />
        </div>
        <p className="small muted range-hint">
          The map is drawn so every point sits at its true great-circle distance from {origin.icao}, which is why the rings are circles. Dashed grey rings mark every
          1,000 NM. Filled dots are in reach of at least one aircraft shown; hover one to see which, click it to fly from there.
        </p>
      </Section>

      <Section id="range-fuel" no={2} title="Weight and fuel" meta={<span className="mono">ZFW + FOB</span>}>
        <BuildUp state={state} shown={shown} />
      </Section>

      <Section id="range-mine" no={3} title="Your airports" meta={<span className="mono">{state.mine.length}</span>}>
        <Mine state={state} origin={origin} options={options} known={known} ranges={ranges} shown={shown} addMine={addMine} update={update} />
      </Section>

      <Section id="range-how" no={4} title="Weights and assumptions">
        <Weights state={state} />
      </Section>
    </>
  );
}

/** A labelled radio row in the site's segmented style. */
function Seg({ id, label, value, options, onChange }: { id: string; label: string; value: number; options: { v: number; label: string; tip: string }[]; onChange: (v: number) => void }) {
  return (
    <div className="range-seg">
      <span className="ctl-label" id={id}>
        {label}
      </span>
      <div className="seg" role="radiogroup" aria-labelledby={id}>
        {options.map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={value === o.v} className="seg-btn" title={o.tip} onClick={() => onChange(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Tonnes typed by the user → kg, or undefined while it isn't a usable number. */
const parseT = (s: string) => {
  const n = Number(s.replace(",", ".").trim());
  return s.trim() && Number.isFinite(n) && n > 0 && n < 200 ? Math.round(n * 100) * 10 : undefined;
};

/** Your own ZFW and FOB; each aircraft then checks them against its own limits. */
function CustomLoad({ custom, blocked, onChange }: { custom: RangeState["custom"]; blocked: number; onChange: (c: RangeState["custom"]) => void }) {
  const [zfw, setZfw] = useState(tonnes(custom.zfw));
  const [fob, setFob] = useState(custom.fob === null ? "" : tonnes(custom.fob));
  const zKg = parseT(zfw);
  const fKg = fob.trim() ? parseT(fob) : null;
  return (
    <div className="range-custom">
      <label className="range-num">
        <span className="ctl-label">ZFW</span>
        <span className="range-unit">
          <input
            id="range-zfw"
            className="ctl-input mono"
            inputMode="decimal"
            value={zfw}
            aria-invalid={zKg === undefined}
            onChange={(e) => {
              setZfw(e.target.value);
              const kg = parseT(e.target.value);
              if (kg !== undefined) onChange({ ...custom, zfw: kg });
            }}
          />
          <span aria-hidden="true">t</span>
        </span>
      </label>
      <span className="range-op" aria-hidden="true">
        +
      </span>
      <label className="range-num">
        <span className="ctl-label">FOB</span>
        <span className="range-unit">
          <input
            id="range-fob"
            className="ctl-input mono"
            inputMode="decimal"
            placeholder="max"
            value={fob}
            aria-invalid={fKg === undefined}
            aria-describedby="range-custom-help"
            onChange={(e) => {
              setFob(e.target.value);
              const kg = e.target.value.trim() ? parseT(e.target.value) : null;
              if (kg !== undefined) onChange({ ...custom, fob: kg });
            }}
          />
          <span aria-hidden="true">t</span>
        </span>
      </label>
      <p id="range-custom-help" className="small muted range-custom-help">
        ZFW is the aircraft with its payload, before fuel. Leave FOB empty for as much as fits. Each aircraft checks your figures against its own OEW, MZFW, tanks and
        MTOW
        {blocked ? (
          <>
            : <b className="range-bad">{blocked === 1 ? "1 aircraft shown can't fly them" : `${blocked} aircraft shown can't fly them`}</b> (greyed out in the list).
          </>
        ) : (
          "."
        )}
      </p>
    </div>
  );
}

/* ---------- the aircraft list ---------- */

function Rack({
  state,
  ranges,
  setHot,
  toggle,
  setPlanes,
}: {
  state: RangeState;
  ranges: Map<string, Out>;
  setHot: (id: string | null) => void;
  toggle: (id: string, on: boolean) => void;
  setPlanes: (ids: string[]) => void;
}) {
  const same = (ids: string[]) => ids.length === state.planes.length && ids.every((id) => state.planes.includes(id));
  return (
    <div className="range-rack">
      <div className="range-quick" role="group" aria-label="Show">
        {(
          [
            ["Base models", DEFAULT_PLANES],
            ["Best of each", BEST_PLANES],
            ["All", PLANES.map((p) => p.id)],
            ["None", []],
          ] as const
        ).map(([label, ids]) => (
          <button key={label} type="button" className="chip" aria-pressed={same([...ids])} onClick={() => setPlanes([...ids])}>
            {label}
          </button>
        ))}
      </div>
      {FAMILIES.map(({ family, title }) => {
        const ps = PLANES.filter((p) => p.family === family);
        const w = ps[0];
        return (
          <fieldset key={family} className="range-fam">
            <legend>
              <span>{title}</span>
              {family !== "A20N" && (
                <span className="mono small muted">
                  MTOW {tonnes(w.mtow)} · MZFW {tonnes(w.mzfw)} t
                </span>
              )}
            </legend>
            {ps.map((p) => {
              const r = ranges.get(p.id)!;
              const on = state.planes.includes(p.id);
              return (
                <label
                  key={p.id}
                  className={cx("range-row", on && "on", !r.ok && "blocked")}
                  style={{ "--c": ringColor(p) } as CSSProperties}
                  onPointerEnter={() => on && r.ok && setHot(p.id)}
                  onPointerLeave={() => setHot(null)}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!r.ok}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                    onFocus={() => on && setHot(p.id)}
                    onBlur={() => setHot(null)}
                  />
                  <span className="range-sw" aria-hidden="true">
                    <svg viewBox="0 0 22 8" width="22" height="8">
                      <line x1="1" y1="4" x2="21" y2="4" style={{ strokeDasharray: ringDash(p) }} />
                    </svg>
                  </span>
                  <span className="range-name">{planeName(p, false) || p.engine}</span>
                  {r.ok ? (
                    <span className="range-val mono">
                      {nmFmt(r.nm)}
                      <small>
                        {tonnes(r.zfw)} + {tonnes(r.block)} t
                      </small>
                    </span>
                  ) : (
                    <span className="range-val mono">
                      <small>can&apos;t fly</small>
                    </span>
                  )}
                  {!r.ok && <span className="range-why small">{r.why}</span>}
                </label>
              );
            })}
          </fieldset>
        );
      })}
      <p className="small muted range-key">
        <span className="mono">ZFW + FOB t</span> under each range: the zero-fuel weight and the fuel on board it flies with.
      </p>
    </div>
  );
}

/* ---------- how ZFW and FOB add up ---------- */

const LIMIT_TEXT = { tanks: "full tanks", MTOW: "the MTOW", MLW: "the MLW", FOB: "your FOB" } as const;
const cap1 = (t: string) => t[0].toUpperCase() + t.slice(1);

function BuildUp({ state, shown }: { state: RangeState; shown: Plane[] }) {
  const [pick, setPick] = useState<string | null>(null);
  const p = planeById.get(pick ?? "") ?? shown[0] ?? planeById.get("fnx-a320-cfm")!;
  const r = rangeOf(p, state.load, state.custom);
  const zfw = r.zfw;
  const fob = r.ok ? r.block : (r.block ?? 0);
  const scale = Math.max(p.mtow + TAXI, zfw + fob) * 1.04;
  const pc = (kg: number) => `${((Math.max(0, kg) / scale) * 100).toFixed(2)}%`;
  // above this ZFW the MTOW, not the tanks, sets the fuel: each tonne of payload costs a tonne of fuel
  const cross = p.mtow - p.fuel + TAXI;
  const top = maxZfw(p);

  return (
    <div className="range-build">
      <div className="range-build-head">
        <label className="range-build-pick">
          <span className="ctl-label">Aircraft</span>
          <select className="ctl-input" value={p.id} onChange={(e) => setPick(e.target.value)}>
            {FAMILIES.map(({ family, title }) => (
              <optgroup key={family} label={title}>
                {PLANES.filter((q) => q.family === family).map((q) => (
                  <option key={q.id} value={q.id}>
                    {planeName(q)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <p className="small muted">
          {cap1(loadName(state.load))}. ZFW is the aircraft and its payload; the fuel on board (FOB) goes on top. Take-off weight can&apos;t pass the MTOW, and what
          lands (the ZFW plus the reserves still in the tanks) can&apos;t pass the MLW.
        </p>
      </div>

      <div
        className="range-bar"
        role="img"
        aria-label={r.ok ? `ZFW ${tonnes(zfw)} t, landing ${tonnes(r.ldw)} t, take-off ${tonnes(r.tow)} t; MZFW ${tonnes(p.mzfw)}, MLW ${tonnes(p.mlw)}, MTOW ${tonnes(p.mtow)} t.` : r.why}
      >
        <span className="rb oew" style={{ left: 0, width: pc(Math.min(zfw, p.oew)) }} />
        <span className="rb pay" style={{ left: pc(p.oew), width: pc(zfw - p.oew) }} />
        {r.ok ? (
          <>
            <span className="rb res" style={{ left: pc(zfw), width: pc(r.reserve) }} />
            <span className="rb trip" style={{ left: pc(r.ldw), width: pc(r.trip) }} />
            <span className="rb taxi" style={{ left: pc(r.tow), width: pc(r.taxi) }} />
          </>
        ) : (
          <span className="rb fuel" style={{ left: pc(zfw), width: pc(fob) }} />
        )}
        <span className="rb-mark" style={{ left: pc(p.mzfw) }}>
          <i>MZFW</i>
        </span>
        <span className="rb-mark low" style={{ left: pc(p.mlw) }}>
          <i>MLW</i>
        </span>
        <span className="rb-mark" style={{ left: pc(p.mtow) }}>
          <i>MTOW</i>
        </span>
      </div>
      <ul className="range-legend small" aria-hidden="true">
        <li>
          <i className="rb oew" />
          OEW
        </li>
        <li>
          <i className="rb pay" />
          Payload
        </li>
        <li>
          <i className="rb res" />
          Reserves (still aboard on landing)
        </li>
        <li>
          <i className="rb trip" />
          Trip fuel
        </li>
        <li>
          <i className="rb taxi" />
          Taxi
        </li>
      </ul>

      <dl className="range-sum mono">
        <div>
          <dt>ZFW</dt>
          <dd>
            <span>
              OEW {tonnes(p.oew)} + payload {tonnes(Math.max(0, zfw - p.oew))} = <b>{tonnes(zfw)} t</b>
            </span>
            <span className={cx("range-lim", (zfw > p.mzfw || zfw < p.oew) && "range-bad")}>
              {zfw < p.oew ? `under OEW ${tonnes(p.oew)}` : `MZFW ${tonnes(p.mzfw)}`}
            </span>
          </dd>
        </div>
        <div>
          <dt>FOB</dt>
          <dd>
            {r.ok ? (
              <span>
                taxi {tonnes(r.taxi)} + trip {tonnes(r.trip)} + reserves {tonnes(r.reserve)} = <b>{tonnes(fob)} t</b>
              </span>
            ) : (
              <b>{state.load === 3 && state.custom.fob === null ? "max" : `${tonnes(fob)} t`}</b>
            )}
            <span className={cx("range-lim", fob > p.fuel && "range-bad")}>tanks {tonnes(p.fuel)}</span>
          </dd>
        </div>
        <div>
          <dt>TOW</dt>
          <dd>
            <span>
              ZFW {tonnes(zfw)} + FOB {tonnes(fob)} − taxi {tonnes(TAXI)} = <b>{tonnes(zfw + fob - TAXI)} t</b>
            </span>
            <span className={cx("range-lim", zfw + fob - TAXI > p.mtow && "range-bad")}>MTOW {tonnes(p.mtow)}</span>
          </dd>
        </div>
        <div>
          <dt>LW</dt>
          <dd>
            {r.ok ? (
              <span>
                TOW {tonnes(r.tow)} − trip {tonnes(r.trip)} = ZFW + reserves = <b>{tonnes(r.ldw)} t</b>
              </span>
            ) : (
              <span>—</span>
            )}
            <span className={cx("range-lim", !r.ok && /MLW/.test(r.why) && "range-bad")}>MLW {tonnes(p.mlw)}</span>
          </dd>
        </div>
      </dl>
      <p className={cx("small range-verdict", !r.ok && "range-bad")} role="status">
        {r.ok ? (
          <>
            <b>{nmFmt(r.nm)}</b> with the fuel set by {LIMIT_TEXT[r.limit]}.{" "}
            {r.capped && `Full payload is cut to a ZFW of ${tonnes(top)} t (MZFW ${tonnes(p.mzfw)} t) so the landing weight stays within the MLW. `}
            {r.limit === "MLW"
              ? "More fuel would mean more contingency still aboard on landing, past the MLW."
              : r.limit === "FOB"
                ? null
                : zfw >= cross
                  ? `From a ZFW of ${tonnes(cross)} t up, the MTOW is the limit: every extra tonne of payload is a tonne less fuel.`
                  : `The tanks fill up to a ZFW of ${tonnes(cross)} t; above that, every extra tonne of payload is a tonne less fuel.`}
          </>
        ) : (
          <>Can&apos;t fly this: {r.why}.</>
        )}
      </p>

      <div className="tbl-wrap">
        <table className="tbl range-tbl range-loads">
          <caption className="small muted">{planeName(p)}: tonnes for each payload, and the range they give.</caption>
          <thead>
            <tr>
              <th>Payload</th>
              <th className="num">ZFW</th>
              <th className="num">FOB</th>
              <th className="num">TOW</th>
              <th className="num">LW</th>
              <th>Fuel set by</th>
              <th className="num">Range</th>
            </tr>
          </thead>
          <tbody>
            {LOADS.map((l) => {
              const x = rangeOf(p, l.v, state.custom);
              return (
                <tr key={l.v} className={cx(l.v === state.load && "is-load")}>
                  <td>{l.label}</td>
                  <td className="num mono">{tonnes(x.zfw)}</td>
                  <td className="num mono">{x.ok ? tonnes(x.block) : x.block === null ? "max" : tonnes(x.block)}</td>
                  <td className="num mono">{x.ok ? tonnes(x.tow) : "—"}</td>
                  <td className="num mono">{x.ok ? tonnes(x.ldw) : "—"}</td>
                  <td>{x.ok ? cap1(LIMIT_TEXT[x.limit]) + (x.capped ? " · payload cut for the MLW" : "") : <span className="range-bad">{x.why}</span>}</td>
                  <td className="num mono">{x.ok ? <b>{nmFmt(x.nm)}</b> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- your airports ---------- */

function Mine({
  state,
  origin,
  options,
  known,
  ranges,
  shown,
  addMine,
  update,
}: {
  state: RangeState;
  origin: RangePlace;
  options: PlaceOption[];
  known: Known;
  ranges: Map<string, Out>;
  shown: Plane[];
  addMine: (p: RangePlace) => void;
  update: (patch: Partial<RangeState>) => void;
}) {
  const [code, setCode] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [msg, setMsg] = useState("");
  const [pickKey, setPickKey] = useState(0);

  const add = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const icao = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(icao)) return setMsg("Enter the airport's 4-letter ICAO code.");
    if (state.mine.some((m) => m.icao === icao)) return setMsg(`${icao} is already in your list.`);
    const k = known.get(icao);
    if (k) {
      addMine({ icao, name: k.name, lat: k.lat, lon: k.lon });
    } else {
      const la = Number(lat);
      const lo = Number(lon);
      if (!lat.trim() || !lon.trim() || !(Math.abs(la) <= 90) || !(Math.abs(lo) <= 180))
        return setMsg(`${icao} isn't in the snapshot. Enter its latitude and longitude in decimal degrees (south and west negative).`);
      addMine({ icao, name: icao, lat: la, lon: lo });
    }
    setMsg(`Added ${icao}.`);
    setCode("");
    setLat("");
    setLon("");
  };

  return (
    <div className="range-mine">
      <div className="range-add">
        <div className="range-add-pick">
          <PlacePicker
            key={pickKey}
            label="Add an airport"
            value={null}
            options={options.filter((o) => !state.mine.some((m) => m.icao === o.value))}
            onChange={(icao) => {
              const k = icao ? known.get(icao) : null;
              if (k) {
                addMine({ icao: k.icao, name: k.name, lat: k.lat, lon: k.lon });
                setMsg(`Added ${k.icao}.`);
              }
              setPickKey((n) => n + 1);
            }}
            anyLabel="ICAO, IATA or name"
          />
        </div>
        <form className="range-add-own" onSubmit={add} noValidate>
          <span className="ctl-label">Not in the list? Add it by position</span>
          <div className="range-add-fields">
            <input id="range-own-icao" className="ctl-input mono" aria-label="ICAO code" placeholder="ICAO" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <input id="range-own-lat" className="ctl-input mono" aria-label="Latitude" placeholder="Lat 18.04" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
            <input id="range-own-lon" className="ctl-input mono" aria-label="Longitude" placeholder="Lon −63.11" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
            <button type="submit" className="btn">
              Add
            </button>
          </div>
        </form>
      </div>
      <p className="small range-msg" role="status">
        {msg}
      </p>
      {state.mine.length ? (
        <div className="tbl-wrap">
          <table className="tbl range-tbl">
            <thead>
              <tr>
                <th>Airport</th>
                <th className="num">From {origin.icao}</th>
                <th>In reach of</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.mine.map((m) => {
                const isOrigin = m.icao === origin.icao;
                const d = gc(origin, m);
                const reach = shown.filter((p) => reachOf(ranges.get(p.id)!) >= d);
                return (
                  <tr key={m.icao} className={cx(isOrigin && "is-origin")}>
                    <td>
                      <b className="mono">{m.icao}</b> <span className="muted">{m.name !== m.icao ? m.name : `${m.lat.toFixed(2)}, ${m.lon.toFixed(2)}`}</span>
                    </td>
                    <td className="num mono">{isOrigin ? "origin" : nmFmt(d)}</td>
                    <td>
                      {isOrigin ? (
                        <span className="muted">—</span>
                      ) : shown.length ? (
                        <span className="range-reach">
                          <span className="mono">
                            {reach.length}/{shown.length}
                          </span>
                          {reach.map((p) => (
                            <i key={p.id} style={{ "--c": ringColor(p) } as CSSProperties} title={planeName(p)} aria-hidden="true" />
                          ))}
                          <span className="sr-only">{reach.map((p) => planeName(p)).join(", ")}</span>
                        </span>
                      ) : (
                        <span className="muted">No aircraft shown</span>
                      )}
                    </td>
                    <td className="range-acts">
                      <button type="button" className="chip" disabled={isOrigin} onClick={() => update({ origin: m.icao })}>
                        Fly from here
                      </button>
                      <button
                        type="button"
                        className="chip"
                        aria-label={`Remove ${m.icao}`}
                        onClick={() => update({ mine: state.mine.filter((x) => x.icao !== m.icao), origin: isOrigin ? "EGLL" : state.origin })}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="lib-empty">No airports yet. Add one above to see how far it is and which aircraft reach it.</p>
      )}
    </div>
  );
}

/* ---------- the numbers behind it ---------- */

function Weights({ state }: { state: RangeState }) {
  const loads = LOADS.filter((l) => l.v !== 3 || state.load === 3);
  return (
    <div className="range-how">
      <div className="tbl-wrap">
        <table className="tbl range-tbl range-weights">
          <caption className="small muted">
            Tonnes. OEW, MZFW, MTOW, MLW and tank capacity from each developer&apos;s SimBrief airframe. Each payload shows the range, then ZFW + FOB.
          </caption>
          <thead>
            <tr>
              <th>Aircraft</th>
              <th className="num">OEW</th>
              <th className="num">MZFW</th>
              <th className="num">MTOW</th>
              <th className="num">MLW</th>
              <th className="num">Tanks</th>
              {loads.map((l) => (
                <th key={l.v} className={cx("num", l.v === state.load && "is-load")}>
                  {l.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLANES.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.dev === "Fenix" ? `Fenix ${planeName(p)}` : planeName(p)}
                  <small className="muted"> · {p.engines}</small>
                </td>
                <td className="num mono">{tonnes(p.oew)}</td>
                <td className="num mono">{tonnes(p.mzfw)}</td>
                <td className="num mono">{tonnes(p.mtow)}</td>
                <td className="num mono">{tonnes(p.mlw)}</td>
                <td className="num mono">{tonnes(p.fuel)}</td>
                {loads.map((l) => {
                  const r = rangeOf(p, l.v, state.custom);
                  return (
                    <td key={l.v} className={cx("num mono range-cell", l.v === state.load && "is-load")} title={r.ok ? `Fuel set by ${LIMIT_TEXT[r.limit]}${r.capped ? "; payload cut for the MLW" : ""}` : r.why}>
                      {r.ok ? (
                        <>
                          <b>{nmFmt(r.nm)}</b>
                          <small>
                            {tonnes(r.zfw)} + {tonnes(r.block)}
                            {r.limit === "MTOW" ? " ▲" : r.limit === "MLW" || r.capped ? " ▼" : ""}
                          </small>
                        </>
                      ) : (
                        <>
                          <span className="range-bad">—</span>
                          <small>can&apos;t fly</small>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="range-notes">
        <p>
          <b>Fuel.</b> 200 kg taxi, 5% contingency, a 200 NM alternate and 30 minutes final reserve. The rest is trip fuel. Unless you set it, the FOB is
          the least of: full tanks, what the MTOW leaves after the ZFW (marked ▲), and what the MLW allows (▼). The 5% contingency is still aboard on landing,
          so the landing weight is the ZFW plus all the reserves; on the Fenix A321 (MZFW 75.6 t, MLW 77.8 t) that cuts the full payload too (▼).
        </p>
        <p>
          <b>Burn.</b> The Breguet range equation, tuned to land within about 10% of Airbus&apos;s published ranges. Sharklets burn 3% less (as in the Fenix
          profiles), IAE engines about 1.5% less than CFM, and the neo 15% less than the ceo. Climb, descent and routing take another 5% and 40 NM off.
        </p>
        <p>
          <b>Wind.</b> These are still-air figures. Westbound over the Atlantic the jet stream usually costs 10–15%; eastbound you gain about as much. Plan the real
          flight in SimBrief with the matching airframe.
        </p>
        <p className="muted small">
          {planeById.size} aircraft · Fenix A321 with additional centre tanks (ACT): each tank adds 300 kg empty and 2.3 t of fuel, which only helps until the MTOW
          is reached.
        </p>
      </div>
    </div>
  );
}
