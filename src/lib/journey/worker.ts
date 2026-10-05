/// <reference lib="webworker" />
/**
 * Runs the journey search off the main thread. The data (route edges or timed flights, and
 * airport points) is sent once per data key and kept; each search message carries only the spec.
 */
import { searchNetwork, searchTimed, type Pt, type Result, type RouteEdge, type Spec, type TFlight } from "./engine";

export type JourneyData = { kind: "network"; edges: RouteEdge[]; pts: [string, Pt][] } | { kind: "timed"; flights: TFlight[]; pts: [string, Pt][] };
export interface SearchMsg {
  id: number;
  key: string;
  data?: JourneyData;
  spec: Spec;
}
export interface ResultMsg {
  id: number;
  result: Result;
  ms: number;
}

/** Groups sent back to the page (the list pages through these). */
const SEND = 240;

let cache: { key: string; data: JourneyData; pts: Map<string, Pt> } | null = null;

self.onmessage = (e: MessageEvent<SearchMsg>) => {
  const m = e.data;
  if (m.data) cache = { key: m.key, data: m.data, pts: new Map(m.data.pts) };
  if (!cache || cache.key !== m.key) return;
  const t = performance.now();
  const d = cache.data;
  const result = d.kind === "network" ? searchNetwork(m.spec, d.edges, cache.pts) : searchTimed(m.spec, d.flights, cache.pts);
  result.groups = result.groups.slice(0, SEND);
  (self as unknown as Worker).postMessage({ id: m.id, result, ms: Math.round(performance.now() - t) } satisfies ResultMsg);
};
