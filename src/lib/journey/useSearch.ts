"use client";

/**
 * Runs journey searches in a Web Worker. The newest request wins; `busy` is true from the
 * moment a request differs from the answered one (derived in render, no effect setState).
 */
import { useEffect, useRef, useState } from "react";
import type { Result, Spec } from "./engine";
import type { JourneyData, ResultMsg, SearchMsg } from "./worker";

export interface SearchState {
  result: Result | null;
  /** Data key the result was computed on (results index into that data). */
  resultKey: string | null;
  ms: number | null;
  busy: boolean;
  error: string | null;
}

export function useJourneySearch(req: { key: string; data: () => JourneyData; spec: Spec } | null): SearchState {
  const worker = useRef<Worker | null>(null);
  const sentKey = useRef<string | null>(null);
  const seq = useRef(0);
  const [answer, setAnswer] = useState<{ sig: string; key: string; result: Result; ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sig = req ? `${req.key}|${JSON.stringify(req.spec)}` : null;
  const pending = useRef(new Map<number, { sig: string; key: string }>());

  useEffect(() => {
    return () => {
      worker.current?.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    if (!req || !sig) return;
    if (!worker.current) {
      try {
        const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
        w.onmessage = (e: MessageEvent<ResultMsg>) => {
          const s = pending.current.get(e.data.id);
          pending.current.delete(e.data.id);
          if (s && e.data.id === seq.current) setAnswer({ sig: s.sig, key: s.key, result: e.data.result, ms: e.data.ms });
        };
        w.onerror = (e) => setError(e.message || "The search stopped unexpectedly.");
        worker.current = w;
        sentKey.current = null;
      } catch (e) {
        queueMicrotask(() => setError(e instanceof Error ? e.message : String(e)));
        return;
      }
    }
    const id = ++seq.current;
    pending.current.set(id, { sig, key: req.key });
    const msg: SearchMsg = { id, key: req.key, spec: req.spec };
    if (sentKey.current !== req.key) {
      msg.data = req.data();
      sentKey.current = req.key;
    }
    worker.current.postMessage(msg);
    // the request is described by `sig`; `req` itself is a fresh object each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return {
    result: answer?.result ?? null,
    resultKey: answer?.key ?? null,
    ms: answer?.ms ?? null,
    busy: !!sig && answer?.sig !== sig && !error,
    error,
  };
}
