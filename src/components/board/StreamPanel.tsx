"use client";

import { useEffect, useMemo, useState, type PointerEvent as RPointerEvent } from "react";
import { allStages, PRESETS, STAGES, type GateFlight, type GateState, type ShownView } from "@/lib/board/gate";
import { GateViewScreen, MiniScreen, sampleLive } from "./GateViews";
import type { GateWx } from "./GateScreen";
import { detectAll, fitToRoute, parseRecording, type FlightContext, type FlightStage, type FlightState } from "@/lib/feed/core";
import type { FeedConfig, FlightFeed } from "@/lib/feed/useFlightFeed";
import { inObs } from "@/lib/feed/obs";
import { readLog, saveFlight, type LogFlight } from "@/lib/logbook";
import Link from "next/link";

/** The recorded flight the rehearse strip plays (the only one so far: the owner's KCLT → KJFK). */
export const REHEARSE_REC = "/recordings/kclt-kjfk.jsonl";

const VIEW_NAMES: [ShownView, string][] = [
  ["full", "Full screen · G1"],
  ["map", "Moving map · G3"],
  ["frame", "Frame with sim · G3a"],
  ["mapwin", "Map with window · G3c"],
  ["corner", "Map corner · G3b"],
  ["strip", "Strip · G4"],
  ["card", "Corner card · G5"],
  ["pill", "Pill · G5"],
];
const STAGE_NAMES: Record<FlightStage, { name: string; until: string }> = {
  ready: { name: "Getting ready", until: "the aircraft moves back" },
  taxi: { name: "Push-back and taxi", until: "wheels off" },
  flying: { name: "Flying", until: "parked, engines off" },
  arrived: { name: "Arrived", until: "you close it" },
};


/**
 * Board → Gate screen → Stream (sheet 07, FL1): where the live figures come from, what shows at
 * each stage and under which OBS scene names, and the one URL to give OBS.
 */
export function StreamPanel({
  gate,
  flight,
  feedCfg,
  feed,
  url,
  urlFor,
  now,
  wx,
  relayOpen,
  onPatch,
  onFeed,
}: {
  gate: GateState;
  flight: GateFlight | null;
  feedCfg: FeedConfig;
  feed: FlightFeed;
  /** The stream URL for these settings. */
  url: string;
  /** The URL for a source that always shows one scene's column (&as=Name). */
  urlFor: (scene: string) => string;
  now: number;
  wx: GateWx | null;
  /** OFP Tower passes changes to the OBS source live (no new URL needed). */
  relayOpen: boolean;
  onPatch: (p: Partial<GateState>) => void;
  onFeed: (c: FeedConfig) => void;
}) {
  const [who, setWho] = useState(feedCfg.who ?? "");
  const [copied, setCopied] = useState(false);
  // the URL last copied: a change since then has to be pasted into OBS again (unless OFP Tower carries it)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const stale = copiedUrl != null && copiedUrl !== url && !relayOpen;
  const using = feed.state ? feed.using : "clock";
  const link = feed.link;
  const vat = feed.vatsim;
  const row = (key: string, name: string, sub: string, on: boolean) => (
    <li className={`sp-src${on ? " is-on" : ""}`} key={key}>
      <i aria-hidden="true" />
      <span>
        <b>
          {name}
          {on && " · live"}
        </b>
        <small>{sub}</small>
      </span>
    </li>
  );

  return (
    <section className="sp" aria-labelledby="sp-h">
      <h3 id="sp-h" className="sp-h">
        Stream: one source, set up once
      </h3>
      <div className="sp-cols">
        <div className="sp-col">
          <h4 className="ctl-label">1 · Live link</h4>
          <ul className="sp-srcs">
            {row("link", "OFP Tower", link?.state === "live" ? "MSFS 2024 · once a second" : (link?.text ?? "not running on this PC"), using === "link")}
            {row("si", "SayIntentions", "not set up yet", false)}
            {row("vatsim", "VATSIM", vat?.text ?? (feedCfg.who ? `looking for ${feedCfg.who}` : "add your callsign"), using === "vatsim")}
            {row("clock", "Clock only", "always there", using === "clock" && feedCfg.source !== "replay")}
          </ul>
          <form
            className="sp-who"
            onSubmit={(e) => {
              e.preventDefault();
              const w = who.trim().toUpperCase();
              onFeed({ ...feedCfg, source: "auto", who: /^[A-Z0-9_-]{2,12}$/.test(w) ? w : null });
            }}
          >
            <label className="jr-ctl">
              <span className="ctl-label">VATSIM callsign or CID</span>
              <input className="ctl-input" value={who} maxLength={12} onChange={(e) => setWho(e.target.value)} placeholder="e.g. RYR7FE" />
            </label>
            <button type="submit" className="btn">
              Use
            </button>
          </form>
          <p className="muted small">
            Uses the first one that is live.
            {flight && (
              <>
                {" "}
                Flight: <b className="mono">{flight.flightNo}</b> {flight.from.iata ?? flight.from.icao} → {flight.to.iata ?? flight.to.icao}
                {flight.source === "simbrief" ? " from your latest SimBrief OFP." : "."}
              </>
            )}{" "}
            VATSIM is only read (the public list of who is online); nothing is sent to it.
          </p>
        </div>

        <div className="sp-col">
          <h4 className="ctl-label">3 · For OBS</h4>
          <input className="ctl-input mono sp-url" readOnly value={url} aria-label="Stream URL" onFocus={(e) => e.target.select()} />
          <button
            type="button"
            className="btn btn-primary sp-copy"
            disabled={!flight}
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(() => {
                setCopied(true);
                setCopiedUrl(url);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? "Copied" : "Copy stream URL"}
          </button>
          {relayOpen ? (
            <p className="sp-live small">Changes reach OBS live through OFP Tower: no need to copy the URL again.</p>
          ) : stale ? (
            <p className="sp-stale small">Changed since you copied it: copy the stream URL again and paste it into OBS (or run OFP Tower and changes go there by themselves).</p>
          ) : null}
          <ol className="sp-steps small">
            <li>
              <b>Add it</b> as a Browser source, 1920 × 1080, above the game capture, in your main scene.
            </li>
            <li>
              <b>One source per scene</b> is simplest: in another scene (BRB) add a new Browser source with the same URL. With Studio Mode, a shared source only shows the scene that is live (Program).
            </li>
            <li>
              In its properties set <b>Page permissions</b> to “Read access to user information”, so it can read the scene name.
            </li>
          </ol>
          <p className="muted small">
            {inObs() ? "This page is inside OBS." : "Scene names only work inside OBS."} Every view also has its own fixed URL (&amp;view=strip, &amp;view=frame…), one source per scene, if you’d rather not use scene names.
          </p>
        </div>
      </div>
      {flight && (
        <AudienceGrid
          gate={gate}
          flight={flight}
          now={now}
          wx={wx}
          feed={feed}
          urlFor={urlFor}
          onPatch={onPatch}
        />
      )}
    </section>
  );
}

/* ---------- 2 · what your audience sees: phases × OBS scenes, each cell a thumbnail ---------- */

const STAGE_ROWS: { k: FlightStage; name: string; short: string; until: string }[] = [
  { k: "ready", name: "At the gate", short: "Gate", until: "until the aircraft moves" },
  { k: "taxi", name: "Push-back and taxi", short: "Taxi", until: "until wheels off" },
  { k: "flying", name: "Flying", short: "Flying", until: "until parked, engines off" },
  { k: "arrived", name: "Arrived", short: "Arrived", until: "until you close it" },
];

function AudienceGrid({
  gate,
  flight,
  now,
  wx,
  feed,
  urlFor,
  onPatch,
}: {
  gate: GateState;
  flight: GateFlight;
  now: number;
  wx: GateWx | null;
  feed: FlightFeed;
  urlFor: (scene: string) => string;
  onPatch: (p: Partial<GateState>) => void;
}) {
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  // columns: any other scene (the stage table), then each named scene
  const cols: { name: string | null; views: Record<FlightStage, ShownView> }[] = [{ name: null, views: gate.stages }, ...gate.scenes.map(([n, v]) => ({ name: n, views: v }))];
  const [pick, setPick] = useState<{ col: number; stage: FlightStage } | null>(null);
  const [pvCol, setPvCol] = useState(0);
  const [pvStage, setPvStage] = useState<FlightStage | null>(null);
  const liveStage = gate.hold ?? feed.state?.stage ?? null;
  const samples = useMemo(() => Object.fromEntries(STAGES.map((k) => [k, sampleLive(flight, k, now)])) as Record<FlightStage, FlightState>, [flight, now]);
  const set = (col: number, stage: FlightStage | "all", v: ShownView) => {
    const views = stage === "all" ? allStages(v) : { ...cols[col].views, [stage]: v };
    if (col === 0) onPatch({ stages: views });
    else onPatch({ scenes: gate.scenes.map((sc, i) => (i === col - 1 ? [sc[0], views] : sc)) });
  };
  const rename = (col: number, name: string) => onPatch({ scenes: gate.scenes.map((sc, i) => (i === col - 1 ? [name.replace(/[;:,]/g, "").slice(0, 40), sc[1]] : sc)) });
  const remove = (col: number) => {
    onPatch({ scenes: gate.scenes.filter((_, i) => i !== col - 1) });
    setPvCol(0);
  };
  const mini = (view: ShownView, stage: FlightStage) => (
    <MiniScreen view={view} flight={flight} state={{ ...gate, hold: null }} now={now} wx={wx} live={samples[stage]} source="link" trail={[]} plan={feed.plan} />
  );
  const pvScene = pvCol > 0 ? (gate.scenes[pvCol - 1]?.[0] ?? null) : null;
  const pvStageShown = pvStage ?? liveStage ?? "ready";
  const pvLive = pvStage ? samples[pvStage] : (feed.state ?? samples[pvStageShown]);

  return (
    <div className="sp-aud">
      <div className="sp-aud-head">
        <h4 className="ctl-label">2 · What your audience sees</h4>
        <div className="sp-presets" role="group" aria-label="Start from a preset (any other scene)">
          {PRESETS.map((p) => (
            <button key={p.name} type="button" className="btn btn-sm" title={p.note} aria-pressed={STAGES.every((k) => gate.stages[k] === p.stages[k])} onClick={() => onPatch({ stages: p.stages })}>
              {p.name}
            </button>
          ))}
        </div>
      </div>
      <div className="sp-aud-body">
        <div className="sp-aud-grid" role="table" aria-label="What each OBS scene shows at each phase">
          <div role="row" className="sp-aud-row is-head">
            <span role="columnheader" />
            {cols.map((c, i) => (
              <span role="columnheader" key={i} className="sp-aud-col">
                {i === 0 ? (
                  <b>Any other scene</b>
                ) : (
                  <span className="sp-aud-scene">
                    <input className="ctl-input" aria-label={`OBS scene name ${i}`} value={c.name ?? ""} onChange={(e) => rename(i, e.target.value)} />
                    <button type="button" className="btn sp-x" aria-label={`Remove the scene ${c.name}`} onClick={() => remove(i)}>
                      ×
                    </button>
                    <button
                      type="button"
                      className="linkish small sp-copy-as"
                      title={`A source for the ${c.name} scene: shows this column whatever scene is live (one source per scene, right in Studio Mode)`}
                      onClick={() => {
                        void navigator.clipboard?.writeText(urlFor(c.name ?? "")).then(() => {
                          setCopiedFor(c.name);
                          setTimeout(() => setCopiedFor(null), 2000);
                        });
                      }}
                    >
                      {copiedFor === c.name ? "Copied" : "Copy URL for this scene"}
                    </button>
                  </span>
                )}
              </span>
            ))}
            {gate.scenes.length < 6 && (
              <span role="columnheader">
                <button type="button" className="linkish small" onClick={() => onPatch({ scenes: [...gate.scenes, ["Scene", allStages("frame")]] })}>
                  + an OBS scene
                </button>
              </span>
            )}
          </div>
          {STAGE_ROWS.map((r) => (
            <div role="row" className="sp-aud-row" key={r.k}>
              <span role="rowheader" className="sp-aud-stage">
                <b>{r.name}</b>
                {liveStage === r.k && <span className="sp-now">{gate.hold === r.k ? "held" : "now"}</span>}
                <small className="muted">{r.until}</small>
              </span>
              {cols.map((c, i) => (
                <span role="cell" key={i}>
                  <button
                    type="button"
                    className={`sp-cell${pick?.col === i && pick.stage === r.k ? " is-open" : ""}`}
                    aria-label={`${c.name ?? "Any other scene"}, ${r.name}: ${VIEW_NAMES.find(([v]) => v === c.views[r.k])?.[1]}. Change`}
                    onClick={() => {
                      setPick(pick?.col === i && pick.stage === r.k ? null : { col: i, stage: r.k });
                      setPvCol(i);
                      setPvStage(r.k);
                    }}
                  >
                    {mini(c.views[r.k], r.k)}
                    <small>{VIEW_NAMES.find(([v]) => v === c.views[r.k])?.[1]}</small>
                  </button>
                </span>
              ))}
            </div>
          ))}
          {pick && (
            <div className="sp-pick" role="dialog" aria-label={`Choose what ${cols[pick.col]?.name ?? "any other scene"} shows: ${STAGE_ROWS.find((r) => r.k === pick.stage)?.name}`}>
              <div className="sp-pick-head">
                <b>
                  {cols[pick.col]?.name ?? "Any other scene"} · {STAGE_ROWS.find((r) => r.k === pick.stage)?.name}
                </b>
                <button type="button" className="btn btn-sm" onClick={() => setPick(null)}>
                  Done
                </button>
              </div>
              <div className="sp-pick-list">
                {VIEW_NAMES.map(([v, n]) => (
                  <button key={v} type="button" className="sp-cell" aria-pressed={cols[pick.col]?.views[pick.stage] === v} onClick={() => set(pick.col, pick.stage, v)}>
                    {mini(v, pick.stage)}
                    <small>{n}</small>
                  </button>
                ))}
              </div>
              {pick.col > 0 && (
                <button type="button" className="linkish small" onClick={() => set(pick.col, "all", cols[pick.col].views[pick.stage])}>
                  Use this for the whole flight in {cols[pick.col].name}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="sp-aud-pv">
          <div className="sp-aud-pv-head">
            <label className="jr-ctl">
              <span className="ctl-label">OBS scene</span>
              <select className="ctl-input" value={pvCol} onChange={(e) => setPvCol(Number(e.target.value))}>
                {cols.map((c, i) => (
                  <option key={i} value={i}>
                    {c.name ?? "Any other scene"}
                  </option>
                ))}
              </select>
            </label>
            <div className="seg jr-seg" role="radiogroup" aria-label="Phase to preview">
              <button type="button" role="radio" aria-checked={pvStage == null} className="seg-btn" onClick={() => setPvStage(null)}>
                Now
              </button>
              {STAGE_ROWS.map((r) => (
                <button key={r.k} type="button" role="radio" aria-checked={pvStage === r.k} className="seg-btn" onClick={() => setPvStage(r.k)}>
                  {r.short}
                </button>
              ))}
            </div>
          </div>
          <div className="gs-frame sp-aud-screen">
            <GateViewScreen flight={flight} state={{ ...gate, view: "auto", hold: pvStage ?? gate.hold }} now={now} wx={wx} live={pvLive} source={feed.using} scene={pvScene} trail={pvStage ? [] : feed.trail} plan={feed.plan} />
          </div>
          <p className="muted small">
            What OBS shows in {pvScene ?? "any other scene"} {pvStage ? `at "${STAGE_ROWS.find((r) => r.k === pvStage)?.name}" (an example of this flight)` : "now"}. The see-through parts show your game.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- rehearse: the recorded flight as a strip of stages (sheet 07, FL2) ---------- */

interface Block {
  stage: FlightStage;
  from: number;
  to: number;
}

const zt = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)}Z`;

export function RehearseStrip({
  gate,
  ctx,
  rehearsing,
  feed,
  onPlay,
  onStop,
  onHold,
}: {
  gate: GateState;
  ctx: FlightContext;
  rehearsing: boolean;
  feed: FlightFeed;
  onPlay: (rate: number) => void;
  onStop: () => void;
  onHold: (s: FlightStage | null) => void;
}) {
  const [rec, setRec] = useState<{ blocks: Block[]; end: FlightState; t0: number; t1: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ctxKey = JSON.stringify(ctx);
  useEffect(() => {
    let live = true;
    fetch(REHEARSE_REC)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("The recorded flight isn't on this site"))))
      .then((text) => {
        const c: FlightContext = JSON.parse(ctxKey);
        const raw = parseRecording(text).samples;
        // as the preview plays it: along this flight's line when the recording flew another route
        const samples = c.from && c.to ? fitToRoute(raw, c.from, c.to) : raw;
        const states = detectAll(samples, c);
        const blocks: Block[] = [];
        states.forEach((s, i) => {
          const t = samples[i].t;
          const last = blocks.at(-1);
          if (last && last.stage === s.stage) last.to = t;
          else blocks.push({ stage: s.stage, from: t, to: t });
        });
        if (live) setRec({ blocks, end: states.at(-1)!, t0: samples[0].t, t1: samples.at(-1)!.t });
      })
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [ctxKey]);
  const span = rec ? Math.max(1, rec.t1 - rec.t0) : 1;
  const at = rehearsing && feed.state?.last && rec ? Math.min(1, Math.max(0, (feed.state.last.t - rec.t0) / span)) : null;
  const holdAt = (e: RPointerEvent<HTMLDivElement>) => {
    const s = (e.target as HTMLElement).closest<HTMLElement>("[data-stage]")?.dataset.stage as FlightStage | undefined;
    if (s && s !== gate.hold) onHold(s);
  };
  const stamps = rec?.end.stamps;
  const marks = useMemo(
    () =>
      stamps
        ? ([
            ["out", stamps.out],
            ["off", stamps.off],
            ["on", stamps.on],
            ["in", stamps.in],
          ] as const).filter((x): x is readonly ["out" | "off" | "on" | "in", number] => x[1] != null)
        : [],
    [stamps],
  );
  // OUT · OFF · ON · IN under the strip; ones too close to read apart share a label
  const labels: { at: number; text: string }[] = [];
  for (const [k, t] of marks) {
    const at = rec ? (t - rec.t0) / span : 0;
    const prev = labels.at(-1);
    if (prev && at - prev.at < 0.15) prev.text += ` · ${zt(t)} ${k}`;
    else labels.push({ at, text: `${zt(t)} ${k}` });
  }
  const now = gate.hold ? `Holding: ${STAGE_NAMES[gate.hold].name}` : rehearsing ? "Playing the recorded flight" : "Following the aircraft";

  return (
    <section className="rs" aria-labelledby="rs-h">
      <h3 id="rs-h" className="sp-h">
        Rehearse: the flight in a minute
      </h3>
      <p className="muted small">
        The recorded flight as a strip: each block is a stage. Play it to see every switch on the preview, or drag along the strip to hold a stage, on the stream too, when the detection gets it wrong.
      </p>
      {err && <p className="muted small">{err}</p>}
      {rec && (
        <>
          <div className="rs-strip" onPointerDown={(e) => (e.currentTarget.setPointerCapture?.(e.pointerId), holdAt(e))} onPointerMove={(e) => e.buttons && holdAt(e)}>
            {rec.blocks.map((b, i) => (
              <button
                key={i}
                type="button"
                data-stage={b.stage}
                className={`rs-b is-${b.stage}${gate.hold === b.stage ? " is-held" : ""}`}
                style={{ flexGrow: Math.max(1, b.to - b.from) }}
                aria-pressed={gate.hold === b.stage}
                onClick={() => onHold(gate.hold === b.stage ? null : b.stage)}
              >
                {i + 1} · {STAGE_NAMES[b.stage].name}
              </button>
            ))}
            {at != null && <i className="rs-at" style={{ left: `${at * 100}%` }} aria-hidden="true" />}
          </div>
          <div className="rs-times mono small">
            <span>{zt(rec.t0)}</span>
            {labels.map((l) => (
              <span key={l.text} style={{ left: `${l.at * 100}%` }}>
                {l.text}
              </span>
            ))}
          </div>
          <div className="gt-actions">
            {rehearsing ? (
              <button type="button" className="btn" onClick={onStop}>
                Stop
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => onPlay(Math.max(1, Math.round(span / 60_000)))}>
                ▶ Play in 60 s
              </button>
            )}
            <button type="button" className="btn" disabled={!gate.hold && !feed.state} onClick={() => onHold(gate.hold ? null : (feed.state?.stage ?? null))}>
              {gate.hold ? "Follow the aircraft" : "Hold this stage"}
            </button>
            <span className="muted small" aria-live="polite">
              {now}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

export { STAGE_NAMES };

/* ---------- arrived: one click writes the flight to the Logbook ---------- */

/**
 * Once the aircraft is at the gate, the times the screen stamped (OUT, OFF, ON, IN) and the landing
 * rate go to the Logbook in one click. Writing it again replaces the same entry.
 */
export function LogArrival({ entry }: { entry: LogFlight }) {
  const [done, setDone] = useState<"saved" | "failed" | null>(null);
  const had = useMemo(() => readLog().some((x) => x.id === entry.id), [entry.id, done]); // eslint-disable-line react-hooks/exhaustive-deps
  const times = (
    [
      ["OUT", entry.out],
      ["OFF", entry.off],
      ["ON", entry.on],
      ["IN", entry.in],
    ] as const
  ).filter(([, v]) => v);
  return (
    <section className="la" aria-labelledby="la-h">
      <div>
        <h3 id="la-h" className="sp-h">
          Arrived: {entry.from} → {entry.to}
        </h3>
        <p className="la-times mono">
          {times.map(([k, v]) => (
            <span key={k}>
              <small>{k}</small> {v}Z
            </span>
          ))}
          {entry.landingFpm != null && (
            <span>
              <small>Landing</small> {entry.landingFpm} fpm
            </span>
          )}
        </p>
        {times.length < 4 && <p className="muted small">Only the times the feed saw: it joined the flight part-way.</p>}
      </div>
      <div className="la-act">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setDone(saveFlight(entry) ? "saved" : "failed")}
        >
          {done === "saved" ? "Written to your Logbook" : had ? "Update it in your Logbook" : "Write to my Logbook"}
        </button>
        {done === "saved" && (
          <Link className="linkish small" href="/logbook">
            Open the Logbook
          </Link>
        )}
        {done === "failed" && <span className="small">The browser refused to save it (storage full or blocked).</span>}
      </div>
    </section>
  );
}
