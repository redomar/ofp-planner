"use client";

import { useEffect, useMemo, useState, type PointerEvent as RPointerEvent } from "react";
import type { GateState } from "@/lib/board/gate";
import { detectAll, fitToRoute, parseRecording, type FlightContext, type ViewStage, type FlightState, viewStage } from "@/lib/feed/core";
import type { FlightFeed } from "@/lib/feed/useFlightFeed";
import { readLog, saveFlight, type LogFlight } from "@/lib/logbook";
import Link from "next/link";
import { STAGE_INFO } from "./StreamStudio";

/** The recorded flight the rehearse strip plays (the only one so far: the owner's KCLT → KJFK). */
export const REHEARSE_REC = "/recordings/kclt-kjfk.jsonl";

/* ---------- rehearse: the recorded flight as a strip of stages (sheet 07, FL2) ---------- */

interface Block {
  stage: ViewStage;
  from: number;
  to: number;
}

const zt = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)}Z`;

/**
 * 1.15: the recorded flight as a strip of stages, under the preview's "Rehearse in 60 s" (which
 * plays it); a block holds its stage, a drag along the strip too. Says how fast to play it.
 */
export function RehearseStrip({
  gate,
  ctx,
  rehearsing,
  feed,
  onRate,
  onHold,
}: {
  gate: GateState;
  ctx: FlightContext;
  rehearsing: boolean;
  feed: FlightFeed;
  /** The sim speed that plays the recording in a minute, once it's read. */
  onRate: (rate: number) => void;
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
  useEffect(() => {
    if (rec) onRate(Math.max(1, Math.round((rec.t1 - rec.t0) / 60_000)));
  }, [rec, onRate]);
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
  return (
    <section className="rs" aria-label="The recorded flight, stage by stage">
      <p className="muted small">
        The recorded flight as a strip: each block is a stage. “Rehearse in 60 s” plays it on the preview; click or drag along the strip to hold a stage, on the stream too, when the detection gets it wrong.
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
                {i + 1} · {STAGE_INFO[b.stage].name}
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
        </>
      )}
    </section>
  );
}


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
