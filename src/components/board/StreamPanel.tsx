"use client";

import { useEffect, useMemo, useState, type PointerEvent as RPointerEvent } from "react";
import { DEFAULT_STAGES, STAGES, type GateFlight, type GateState, type ShownView } from "@/lib/board/gate";
import { detectAll, parseRecording, type FlightContext, type FlightStage, type FlightState } from "@/lib/feed/core";
import type { FeedConfig, FlightFeed } from "@/lib/feed/useFlightFeed";
import { inObs } from "@/lib/feed/obs";

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

function ViewSelect({ label, value, onChange }: { label: string; value: ShownView; onChange: (v: ShownView) => void }) {
  return (
    <select className="ctl-input sp-view" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as ShownView)}>
      {VIEW_NAMES.map(([v, n]) => (
        <option key={v} value={v}>
          {n}
        </option>
      ))}
    </select>
  );
}

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
  onPatch,
  onFeed,
}: {
  gate: GateState;
  flight: GateFlight | null;
  feedCfg: FeedConfig;
  feed: FlightFeed;
  /** The stream URL for these settings. */
  url: string;
  onPatch: (p: Partial<GateState>) => void;
  onFeed: (c: FeedConfig) => void;
}) {
  const [who, setWho] = useState(feedCfg.who ?? "");
  const [copied, setCopied] = useState(false);
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
  const setStage = (k: FlightStage, v: ShownView) => onPatch({ stages: { ...gate.stages, [k]: v } });
  const setScene = (i: number, n: string | null, v?: ShownView) => {
    const sc = gate.scenes.slice();
    if (n == null) sc.splice(i, 1);
    else sc[i] = [n.replace(/[;:]/g, "").slice(0, 40), v ?? sc[i][1]];
    onPatch({ scenes: sc });
  };
  const flyingNow = feed.state?.stage ?? null;

  return (
    <section className="sp" aria-labelledby="sp-h">
      <h3 id="sp-h" className="sp-h">
        Stream: one source, set up once
      </h3>
      <div className="sp-cols">
        <div className="sp-col">
          <h4 className="ctl-label">1 · Live link</h4>
          <ul className="sp-srcs">
            {row("link", "OFP Link", link?.state === "live" ? "MSFS 2024 · once a second" : (link?.text ?? "not running on this PC"), using === "link")}
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
          <h4 className="ctl-label">2 · What shows when</h4>
          <table className="sp-tbl">
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col">The screen shows</th>
                <th scope="col">Until</th>
              </tr>
            </thead>
            <tbody>
              {STAGES.map((k) => (
                <tr key={k}>
                  <th scope="row">
                    {STAGE_NAMES[k].name}
                    {flyingNow === k && <span className="sp-now">now</span>}
                    {gate.hold === k && <span className="sp-now is-hold">held</span>}
                  </th>
                  <td>
                    <ViewSelect label={`${STAGE_NAMES[k].name}: the screen shows`} value={gate.stages[k]} onChange={(v) => setStage(k, v)} />
                  </td>
                  <td className="muted small">{STAGE_NAMES[k].until}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {STAGES.some((k) => gate.stages[k] !== DEFAULT_STAGES[k]) && (
            <button type="button" className="linkish small" onClick={() => onPatch({ stages: DEFAULT_STAGES })}>
              Back to full screen on the ground, strip while flying
            </button>
          )}
          <h4 className="ctl-label sp-sub">Unless my OBS scene is called…</h4>
          <ul className="sp-rules">
            {gate.scenes.map(([n, v], i) => (
              <li key={i}>
                <input className="ctl-input sp-scene" aria-label={`Scene name ${i + 1}`} value={n} maxLength={40} onChange={(e) => setScene(i, e.target.value)} />
                <ViewSelect label={`Scene ${n || i + 1}: the screen shows`} value={v} onChange={(x) => setScene(i, n, x)} />
                <button type="button" className="btn sp-x" aria-label={`Remove the rule for ${n || "this scene"}`} onClick={() => setScene(i, null)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          {gate.scenes.length < 8 && (
            <button type="button" className="linkish small" onClick={() => onPatch({ scenes: [...gate.scenes, ["", "frame"]] })}>
              + add a rule
            </button>
          )}
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
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? "Copied" : "Copy stream URL"}
          </button>
          <ol className="sp-steps small">
            <li>
              <b>Add it once</b> as a Browser source, 1920 × 1080.
            </li>
            <li>
              In your other scenes choose <b>Add existing</b>, above the game capture.
            </li>
            <li>
              In its properties set <b>Page permissions</b> to read the scene name (at least “Read access to user information”).
            </li>
          </ol>
          <p className="muted small">
            {inObs() ? "This page is inside OBS." : "Scene names only work inside OBS."} Every view also has its own fixed URL (&amp;view=strip, &amp;view=frame…), one source per scene, if you’d rather not use scene names.
          </p>
        </div>
      </div>
    </section>
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
        const { samples } = parseRecording(text);
        const states = detectAll(samples, JSON.parse(ctxKey));
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
