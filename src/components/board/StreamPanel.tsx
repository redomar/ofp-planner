"use client";

import { useEffect, useMemo, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import type { GateFlight, GateState } from "@/lib/board/gate";
import type { GateWx } from "./GateScreen";
import { detectAll, fitToRoute, parseRecording, type FlightContext, type ViewStage, type FlightState, viewStage } from "@/lib/feed/core";
import type { FeedConfig, FlightFeed } from "@/lib/feed/useFlightFeed";
import { inObs } from "@/lib/feed/obs";
import { readLog, saveFlight, type LogFlight } from "@/lib/logbook";
import Link from "next/link";
import { STAGE_INFO, StreamStudio } from "./StreamStudio";

/** The recorded flight the rehearse strip plays (the only one so far: the owner's KCLT → KJFK). */
export const REHEARSE_REC = "/recordings/kclt-kjfk.jsonl";

const STAGE_NAMES: Record<ViewStage, { name: string; until: string }> = {
  ready: { name: "Getting ready", until: "the aircraft moves back" },
  taxi: { name: "Push-back and taxi", until: "wheels off" },
  flying: { name: "Flying", until: "the approach" },
  approaching: { name: "Approach and landing", until: "parked, engines off" },
  arrived: { name: "Arrived", until: "you close it" },
};

type StreamTab = "scenes" | "rehearse" | "feed" | "obs";
const TABS: { k: StreamTab; name: string }[] = [
  { k: "scenes", name: "Scenes" },
  { k: "rehearse", name: "Rehearse" },
  { k: "feed", name: "Live feed" },
  { k: "obs", name: "OBS setup" },
];

/**
 * Board → Gate screen → Stream (1.12, the Stream studio): one line that says whether the stream is
 * ready, then tabs: the scenes (what each OBS scene shows at each stage), rehearse, the live feed
 * and the OBS setup with the one URL to give OBS.
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
  rehearse,
  onPatch,
  onFeed,
}: {
  gate: GateState;
  flight: GateFlight | null;
  feedCfg: FeedConfig;
  feed: FlightFeed;
  /** The stream URL for these settings. */
  url: string;
  /** The URL for a source that always shows one scene (&as=Name). */
  urlFor: (scene: string) => string;
  now: number;
  wx: GateWx | null;
  /** OFP Tower passes changes to the OBS source live (no new URL needed). */
  relayOpen: boolean;
  /** The rehearse strip, shown in its tab. */
  rehearse?: ReactNode;
  onPatch: (p: Partial<GateState>) => void;
  onFeed: (c: FeedConfig) => void;
}) {
  const [tab, setTab] = useState<StreamTab>("scenes");
  const [who, setWho] = useState(feedCfg.who ?? "");
  const [copied, setCopied] = useState(false);
  // the URL last copied: a change since then has to be pasted into OBS again (unless OFP Tower carries it)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const stale = copiedUrl != null && copiedUrl !== url && !relayOpen;
  const using = feed.state ? feed.using : "clock";
  const link = feed.link;
  const vat = feed.vatsim;
  const stage = gate.hold ?? (feed.state ? viewStage(feed.state, feed.plan) : null);
  const copyUrl = () =>
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setCopiedUrl(url);
      setTimeout(() => setCopied(false), 2000);
    });
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
  const linkLive = link?.state === "live";

  return (
    <section className="sp st-panel" aria-labelledby="sp-h">
      <header className="st-bar">
        <h3 id="sp-h" className="sp-h">
          Stream
        </h3>
        <span className={`st-chip${linkLive ? " is-on" : ""}`}>
          <i aria-hidden="true" />
          OFP Tower · {linkLive ? "live" : "not running"}
        </span>
        <span className={`st-chip${using === "vatsim" ? " is-on" : ""}`}>
          <i aria-hidden="true" />
          VATSIM · {using === "vatsim" ? "live" : feedCfg.who ? (vat?.state === "waiting" ? "offline" : "looking") : "not used"}
        </span>
        <span className={`st-chip${relayOpen ? " is-on" : ""}`} title={relayOpen ? "Changes here reach the OBS sources live through OFP Tower" : "Without OFP Tower, copy the URL again after a change"}>
          <i aria-hidden="true" />
          {relayOpen ? "Changes reach OBS live" : "OBS: copy after changes"}
        </span>
        {flight && (
          <span className="st-chip is-flight">
            <b className="mono">{flight.flightNo}</b> {flight.from.iata ?? flight.from.icao} → {flight.to.iata ?? flight.to.icao}
            {stage && ` · ${STAGE_INFO[stage].name}`}
          </span>
        )}
        <span className="st-grow" />
        <button type="button" className="btn btn-primary sp-copy" disabled={!flight} onClick={copyUrl}>
          {copied ? "Copied" : "Copy stream URL"}
        </button>
      </header>
      {stale && <p className="sp-stale small">Changed since you copied it: copy the stream URL again and paste it into OBS (or run OFP Tower and changes go there by themselves).</p>}

      <div className="tabs st-tabs" role="tablist" aria-label="Stream">
        {TABS.map((t) => (
          <button type="button" role="tab" key={t.k} id={`st-tab-${t.k}`} aria-selected={tab === t.k} aria-controls={`st-p-${t.k}`} className="tab" onClick={() => setTab(t.k)}>
            {t.name}
            {t.k === "scenes" && <span className="st-count">{gate.scenes.length + 1}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="st-p-scenes" aria-labelledby="st-tab-scenes" hidden={tab !== "scenes"}>
        {flight ? <StreamStudio gate={gate} flight={flight} now={now} wx={wx} feed={feed} urlFor={urlFor} onPatch={onPatch} /> : <p className="muted">Load a flight to set up the scenes.</p>}
      </div>

      <div role="tabpanel" id="st-p-rehearse" aria-labelledby="st-tab-rehearse" hidden={tab !== "rehearse"}>
        {rehearse}
      </div>

      <div role="tabpanel" id="st-p-feed" aria-labelledby="st-tab-feed" hidden={tab !== "feed"} className="st-tabpanel">
        <h4 className="ctl-label">Where the live figures come from</h4>
        <ul className="sp-srcs">
          {row("link", "OFP Tower", linkLive ? "MSFS 2024 · once a second" : (link?.text ?? "not running on this PC"), using === "link")}
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

      <div role="tabpanel" id="st-p-obs" aria-labelledby="st-tab-obs" hidden={tab !== "obs"} className="st-tabpanel">
        <h4 className="ctl-label">The stream URL</h4>
        <div className="st-url">
          <input className="ctl-input mono sp-url" readOnly value={url} aria-label="Stream URL" onFocus={(e) => e.target.select()} />
          <button type="button" className="btn btn-primary" disabled={!flight} onClick={copyUrl}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {relayOpen ? <p className="sp-live small">Changes reach OBS live through OFP Tower: no need to copy the URL again.</p> : null}
        <ol className="sp-steps small">
          <li>
            <b>Add it</b> as a Browser source, 1920 × 1080, above the game capture, in your main scene.
          </li>
          <li>
            <b>One source per scene</b> is simplest: in each other scene add a Browser source with that scene’s own URL (“Copy URL for this scene” in Scenes). With Studio Mode, a shared source only shows the scene that is live (Program).
          </li>
          <li>
            In its properties set <b>Page permissions</b> to “Read access to user information”, so it can read the scene name.
          </li>
        </ol>
        <p className="muted small">
          {inObs() ? "This page is inside OBS." : "Scene names only work inside OBS."} Every look also has its own fixed URL (&amp;view=strip, &amp;view=card.s.bl…), one source per scene, if you’d rather not use scene names.
        </p>
      </div>
    </section>
  );
}

/* ---------- rehearse: the recorded flight as a strip of stages (sheet 07, FL2) ---------- */

interface Block {
  stage: ViewStage;
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
  onHold: (s: ViewStage | null) => void;
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
          const vs = viewStage(s);
          if (last && last.stage === vs) last.to = t;
          else blocks.push({ stage: vs, from: t, to: t });
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
    const s = (e.target as HTMLElement).closest<HTMLElement>("[data-stage]")?.dataset.stage as ViewStage | undefined;
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
            <button type="button" className="btn" disabled={!gate.hold && !feed.state} onClick={() => onHold(gate.hold ? null : feed.state ? viewStage(feed.state, feed.plan) : null)}>
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
