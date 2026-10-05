/**
 * Multi-leg journey search, pure and data-in (no app imports, so it runs in Node too).
 *
 * Two modes over the same rules:
 *  - network: airport → airport hops from the route index (who flies where, any day);
 *  - timed:   real flights chained on a weekly clock (each operating day is an instance),
 *             with a turnaround window and an optional duty limit (report → last on-blocks).
 *
 * A journey starts at `from`, passes the `via` airports in order and ends at `to`. Either
 * end may be open: with no `to` the journey ends wherever its legs run out; with no `from`
 * the search runs backwards from `to` (reversed graph / reversed clock) and is flipped back.
 * No airport is visited twice, except a round trip may end where it started.
 *
 * The search is a depth-first walk with pruning: a lower bound on legs still needed (BFS hop
 * counts to each waypoint), on distance and on time, and, once enough journeys are found, a
 * branch-and-bound threshold for the chosen sort. A node budget keeps it interactive; results
 * say when it was reached. Journeys are grouped by their airport sequence; a timed group holds
 * its flight-by-flight variants, and a variant that works on several weekdays lists them.
 */

export type Place = string; // "LEMD" or a whole country "C:ES"
export interface Pt {
  lat: number;
  lon: number;
  country: string | null;
}
export type LegsRule = { kind: "fewest" } | { kind: "exact"; n: number } | { kind: "upto"; n: number };
export type SortKey = "distance" | "fewest" | "most" | "quickest" | "waiting" | "random";

export interface Spec {
  from: Place | null;
  to: Place | null;
  via: Place[];
  legs: LegsRule;
  /** Every leg on the same airline (brand). */
  oneAirline: boolean;
  sort: SortKey;
  /** Varies the walk order, so "Shuffle" finds other journeys when the budget can't cover all. */
  seed: number;
  /* timed only */
  /** ISO weekday the first leg departs (UTC); null = any. */
  day: number | null;
  /** First OUT at or after this UTC minute of the day; null = any. */
  after: number | null;
  /** Report to last on-blocks, minutes; null = no limit. */
  dutyMin: number | null;
  /** Report time before the first OUT, minutes. */
  reportMin: number;
  minTurn: number;
  maxTurn: number;
}

/** routes.json flattened: flights per brand on o → d. */
export interface RouteEdge {
  o: string;
  d: string;
  als: Record<string, number>;
}
/** A flight reduced to what the timed search needs: UTC minute of OUT and gate-to-gate block. */
export interface TFlight {
  o: string;
  d: string;
  al: string;
  dep: number;
  block: number;
  /** ISO weekdays; empty = treated as daily. */
  days: number[];
}

export interface NetLeg {
  o: string;
  d: string;
  nm: number;
  /** Brands flying it (all of them, or the one shared by every leg), most flights first. */
  als: [string, number][];
}
export interface TimedLeg {
  /** Index into the TFlight list. */
  f: number;
  o: string;
  d: string;
  /** Week minutes from Monday 00:00Z of the first leg's week (may run past one week). */
  t0: number;
  t1: number;
}
export interface Timed {
  legs: TimedLeg[];
  /** Weekdays (of the first OUT) this exact chain runs. */
  days: number[];
  /** First OUT, last IN (week minutes), report → last IN, ground time between legs, airborne+taxi. */
  start: number;
  end: number;
  duty: number;
  wait: number;
  block: number;
}
export interface Journey {
  stops: string[];
  nm: number;
  /** Order key for the "random" sort (from the seed). */
  rnd?: number;
  net?: NetLeg[];
  timed?: Timed;
}
export interface Group {
  key: string;
  stops: string[];
  best: Journey;
  /** Timed: the different flight chains for this airport sequence, best first. */
  variants: Journey[];
  score: number;
}
export interface Result {
  groups: Group[];
  /** Legs searched for "fewest" (the minimum that works), else null. */
  legs: number | null;
  expansions: number;
  /** The node budget ran out: there may be more (Shuffle tries another order). */
  capped: boolean;
  /** Why nothing was found, when it's knowable. */
  reason: string | null;
}

export const WEEK = 10080;
export const MAX_LEGS = 8;
const KEEP = 60; // groups kept for the bound
const MAX_VARIANTS = 16;
const HOLD = 1500; // groups held while searching
const ROAM_BRANCH = 7; // children tried per stop when no waypoint steers the walk
const SPEED_NM_PER_MIN = 8.5; // ~510 kt: faster than any short-haul block average, so a safe bound
const MIN_BLOCK = 25;

const mod = (n: number, m: number) => ((n % m) + m) % m;

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gcNm(a: Pt, b: Pt): number {
  const R = 3440.065;
  const toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR;
  const dLon = (b.lon - a.lon) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/* ---------- graph ---------- */

interface Arc {
  to: string;
  nm: number;
  als: [string, number][];
  /** Airline bitmask (two 32-bit halves). */
  lo: number;
  hi: number;
}
interface Graph {
  out: Map<string, Arc[]>;
  inn: Map<string, string[]>;
  alIndex: Map<string, number>;
}

function buildGraph(edges: RouteEdge[], pts: Map<string, Pt>, reverse: boolean): Graph {
  const alIndex = new Map<string, number>();
  const out = new Map<string, Arc[]>();
  const inn = new Map<string, string[]>();
  for (const e of edges) {
    const o = reverse ? e.d : e.o;
    const d = reverse ? e.o : e.d;
    const a = pts.get(o);
    const b = pts.get(d);
    if (!a || !b || o === d) continue;
    const als = Object.entries(e.als)
      .filter(([, n]) => n > 0)
      .sort((x, y) => y[1] - x[1]);
    if (!als.length) continue;
    let lo = 0,
      hi = 0;
    for (const [al] of als) {
      let i = alIndex.get(al);
      if (i == null) alIndex.set(al, (i = alIndex.size));
      if (i < 32) lo |= 1 << i;
      else if (i < 64) hi |= 1 << (i - 32);
    }
    let l = out.get(o);
    if (!l) out.set(o, (l = []));
    l.push({ to: d, nm: Math.round(gcNm(a, b)), als, lo, hi });
    let r = inn.get(d);
    if (!r) inn.set(d, (r = []));
    r.push(o);
  }
  return { out, inn, alIndex };
}

/** Fewest hops from every airport into `target`. */
function hopsTo(g: Graph, target: Set<string>): Map<string, number> {
  const dist = new Map<string, number>();
  let frontier = [...target];
  for (const t of frontier) dist.set(t, 0);
  for (let k = 1; frontier.length && k <= MAX_LEGS; k++) {
    const next: string[] = [];
    for (const v of frontier)
      for (const u of g.inn.get(v) ?? [])
        if (!dist.has(u)) {
          dist.set(u, k);
          next.push(u);
        }
    frontier = next;
  }
  return dist;
}

function placeSet(p: Place, nodes: Iterable<string>, pts: Map<string, Pt>): Set<string> {
  if (!p.startsWith("C:")) return new Set([p]);
  const cc = p.slice(2);
  const s = new Set<string>();
  for (const n of nodes) if (pts.get(n)?.country === cc) s.add(n);
  return s;
}

/* ---------- the shared walk ---------- */

interface Plan {
  start: Set<string>;
  wps: Set<string>[];
  /** The last waypoint is a destination (the journey stops on reaching it). */
  hasTo: boolean;
  /** A round trip may end where it started. */
  roundTrip: boolean;
  hops: Map<string, number>[];
  lbRest: number[];
  distRest: number[];
  distTo: (idx: number, u: string) => number;
}

function makePlan(g: Graph, pts: Map<string, Pt>, start: Set<string>, wps: Set<string>[], hasTo: boolean): Plan {
  const hops = wps.map((w) => hopsTo(g, w));
  const seg = (i: number) => {
    // fewest hops from waypoint i-1 to waypoint i
    let best = Infinity;
    for (const a of wps[i - 1]) best = Math.min(best, hops[i].get(a) ?? Infinity);
    return best;
  };
  const segDist = (i: number) => {
    let best = Infinity;
    for (const a of wps[i - 1]) {
      const pa = pts.get(a);
      if (!pa) continue;
      for (const b of wps[i]) {
        const pb = pts.get(b);
        if (pb) best = Math.min(best, gcNm(pa, pb));
      }
    }
    return best === Infinity ? 0 : best;
  };
  const lbRest: number[] = new Array(wps.length + 1).fill(0);
  const distRest: number[] = new Array(wps.length + 1).fill(0);
  for (let i = wps.length - 2; i >= 0; i--) {
    lbRest[i] = lbRest[i + 1] + seg(i + 1);
    distRest[i] = distRest[i + 1] + segDist(i + 1);
  }
  const cache = wps.map(() => new Map<string, number>());
  const distTo = (idx: number, u: string) => {
    if (idx >= wps.length) return 0;
    let d = cache[idx].get(u);
    if (d == null) {
      d = Infinity;
      const pu = pts.get(u);
      if (pu)
        for (const w of wps[idx]) {
          const pw = pts.get(w);
          if (pw) d = Math.min(d, gcNm(pu, pw));
        }
      if (d === Infinity) d = 0;
      cache[idx].set(u, d);
    }
    return d;
  };
  const roundTrip = hasTo && [...start].some((s) => wps[wps.length - 1].has(s));
  return { start, wps, hasTo, roundTrip, hops, lbRest, distRest, distTo };
}

/** Legs still needed from u having passed waypoints < idx. */
function lbLegs(p: Plan, u: string, idx: number): number {
  if (idx >= p.wps.length) return 0;
  const h = p.hops[idx].get(u);
  return h == null ? Infinity : h + p.lbRest[idx];
}

function advance(p: Plan, u: string, idx: number): number {
  while (idx < p.wps.length && p.wps[idx].has(u)) idx++;
  return idx;
}

/** Waypoints the start airport already satisfies (vias only: a round trip hasn't arrived yet). */
function startIdx(p: Plan, s: string): number {
  const stop = p.hasTo ? p.wps.length - 1 : p.wps.length;
  let idx = 0;
  while (idx < stop && p.wps[idx].has(s)) idx++;
  return idx;
}

function score(sort: SortKey, j: Journey): number {
  const legs = j.stops.length - 1;
  const t = j.timed;
  switch (sort) {
    case "distance":
      return j.nm;
    case "fewest":
      return legs * 1e7 + j.nm;
    case "most":
      return -legs * 1e7 + (t ? t.wait * 10 : j.nm);
    case "quickest":
      return t ? (t.end - t.start) * 1e3 + j.nm / 100 : j.nm;
    case "waiting":
      return t ? t.wait * 1e3 + j.nm / 100 : j.nm;
    case "random":
      return j.rnd ?? 0;
  }
}

class Collector {
  groups = new Map<string, Group>();
  threshold = Infinity;
  /** Groups scoring at or past this were trimmed away; new ones like them are dropped. */
  private cut = Infinity;
  private since = 0;
  private sort: SortKey;
  constructor(sort: SortKey) {
    this.sort = sort;
  }
  add(j: Journey, variantKey: string, day: number | null) {
    const key = j.stops.join("-");
    const s = score(this.sort, j);
    let g = this.groups.get(key);
    if (!g) {
      if (s >= this.cut) return;
      g = { key, stops: j.stops, best: j, variants: [j], score: s };
      this.groups.set(key, g);
      if (this.groups.size > 2 * HOLD) this.trim(HOLD);
    } else if (j.timed) {
      const same = g.variants.find((v) => vkey(v) === variantKey);
      if (same) {
        if (day != null && !same.timed!.days.includes(day)) same.timed!.days.push(day);
        return;
      }
      if (g.variants.length >= MAX_VARIANTS && s >= score(this.sort, g.variants[g.variants.length - 1])) return;
      g.variants.push(j);
      g.variants.sort((a, b) => score(this.sort, a) - score(this.sort, b));
      if (g.variants.length > MAX_VARIANTS) g.variants.length = MAX_VARIANTS;
      g.best = g.variants[0];
      g.score = score(this.sort, g.best);
    } else if (s < g.score) {
      g.best = j;
      g.variants = [j];
      g.score = s;
    }
    if (++this.since >= 256 && this.groups.size >= KEEP) {
      this.since = 0;
      this.threshold = Math.min(
        this.threshold,
        kth(
          [...this.groups.values()].map((x) => x.score),
          KEEP,
        ),
      );
    }
  }
  /** Keep the best `n` groups; anything scoring at or past the last one is no longer wanted. */
  private trim(n: number) {
    const all = [...this.groups.values()].sort((a, b) => a.score - b.score);
    this.cut = all[n - 1].score;
    this.groups = new Map(all.slice(0, n).map((g) => [g.key, g]));
    this.threshold = Math.min(this.threshold, all[Math.min(KEEP, n) - 1].score);
  }
}
function kth(v: number[], k: number): number {
  v.sort((a, b) => a - b);
  return v[k - 1];
}
const vkey = (j: Journey) => j.timed!.legs.map((l) => l.f).join(",");

/* ---------- network mode ---------- */

export function searchNetwork(spec: Spec, edges: RouteEdge[], pts: Map<string, Pt>, budget = 250_000): Result {
  const reverse = !spec.from && !!spec.to;
  const g = buildGraph(edges, pts, reverse);
  const nodes = new Set([...g.out.keys(), ...g.inn.keys()]);
  const origin = reverse ? spec.to : spec.from;
  if (!origin) return empty("Choose where the journey starts or ends.");
  const start = placeSet(origin, nodes, pts);
  const vias = (reverse ? [...spec.via].reverse() : spec.via).map((v) => placeSet(v, nodes, pts));
  const hasTo = !reverse && !!spec.to;
  const wps = hasTo ? [...vias, placeSet(spec.to!, nodes, pts)] : vias;
  if (![...start].some((s) => nodes.has(s))) return empty(`No flights ${reverse ? "into" : "from"} ${origin} in the snapshot.`);
  const plan = makePlan(g, pts, start, wps, hasTo);
  const col = new Collector(spec.sort);
  const rand = rng(spec.seed);
  const jitter = spec.seed ? 0.6 : 0.05;
  let expansions = 0;
  let capped = false;
  const bound = spec.sort === "distance" || spec.sort === "quickest";

  const startLb = Math.min(...[...start].map((s) => lbLegs(plan, s, startIdx(plan, s))));
  if (startLb === Infinity) return empty(noRoute(spec), 0);

  const run = (maxDepth: number, recordAll: boolean) => {
    const stops: string[] = [];
    const legs: NetLeg[] = [];
    const seen = new Set<string>();
    const walk = (v: string, depth: number, idx: number, nm: number, lo: number, hi: number) => {
      if (capped) return;
      if (++expansions > budget) {
        capped = true;
        return;
      }
      const arcs = g.out.get(v) ?? [];
      const cand: [Arc, number, number][] = [];
      for (const a of arcs) {
        const u = a.to;
        const nIdx = advance(plan, u, idx);
        const done = hasTo && nIdx === wps.length;
        if (seen.has(u) && !(done && plan.roundTrip && start.has(u))) continue;
        if (depth + 1 + lbLegs(plan, u, nIdx) > maxDepth) continue;
        if (spec.oneAirline && !(lo & a.lo) && !(hi & a.hi)) continue;
        if (bound && nm + a.nm + plan.distTo(nIdx, u) + plan.distRest[Math.min(nIdx, wps.length)] >= col.threshold) continue;
        cand.push([a, nIdx, plan.distTo(nIdx, u) * (1 + jitter * rand()) + a.nm * 0.15]);
      }
      if (!plan.wps.length) for (const c of cand) c[2] = rand();
      cand.sort((x, y) => x[2] - y[2]);
      if (!plan.wps.length || lbLegs(plan, v, idx) === 0) cand.length = Math.min(cand.length, ROAM_BRANCH);
      for (const [a, nIdx] of cand) {
        const u = a.to;
        let nlo = lo,
          nhi = hi;
        if (spec.oneAirline) {
          nlo &= a.lo;
          nhi &= a.hi;
        }
        if (++expansions > budget) {
          capped = true;
          return;
        }
        stops.push(u);
        legs.push({ o: v, d: u, nm: a.nm, als: a.als });
        const d = depth + 1;
        const complete = nIdx === wps.length;
        if (complete && (recordAll ? d <= maxDepth : d === maxDepth)) record(stops, legs, nlo, nhi);
        if (!(hasTo && complete) && d < maxDepth) {
          seen.add(u);
          walk(u, d, nIdx, nm + a.nm, nlo, nhi);
          seen.delete(u);
        }
        stops.pop();
        legs.pop();
        if (capped) return;
      }
    };
    const record = (stops: string[], legs: NetLeg[], lo: number, hi: number) => {
      let out = legs.map((l) => ({ ...l }));
      if (spec.oneAirline) {
        const keep = (al: string) => {
          const i = g.alIndex.get(al)!;
          return i < 32 ? (lo >>> i) & 1 : (hi >>> (i - 32)) & 1;
        };
        out = out.map((l) => ({ ...l, als: l.als.filter(([al]) => keep(al)) }));
      }
      let st = [...stops];
      if (reverse) {
        st = st.reverse();
        out = out.reverse().map((l) => ({ ...l, o: l.d, d: l.o }));
      }
      const j: Journey = { stops: st, nm: out.reduce((s, l) => s + l.nm, 0), net: out, rnd: rand() };
      col.add(j, "", null);
    };
    for (const s of start) {
      if (capped) break;
      stops.length = 0;
      stops.push(s);
      seen.clear();
      seen.add(s);
      walk(s, 0, startIdx(plan, s), 0, -1, -1);
    }
  };

  const result = runLegs(spec, startLb, run, () => col.groups.size);
  return finish(col, result, expansions, capped, spec);
}

/* ---------- timed mode ---------- */

interface Inst {
  f: number;
  t0: number;
  t1: number;
  d: string;
  al: string;
}

export function searchTimed(spec: Spec, flights: TFlight[], pts: Map<string, Pt>, budget = 400_000): Result {
  const reverse = !spec.from && !!spec.to;
  const origin = reverse ? spec.to : spec.from;
  if (!origin) return empty("Choose where the journey starts or ends.");

  // weekly instances per departure airport, sorted by OUT
  const byAirport = new Map<string, Inst[]>();
  const edgeMap = new Map<string, RouteEdge>();
  flights.forEach((fl, i) => {
    const o = reverse ? fl.d : fl.o;
    const d = reverse ? fl.o : fl.d;
    if (!pts.has(o) || !pts.has(d) || o === d) return;
    const days = fl.days.length ? fl.days : [1, 2, 3, 4, 5, 6, 7];
    let l = byAirport.get(o);
    if (!l) byAirport.set(o, (l = []));
    for (const day of days) {
      const t0 = (day - 1) * 1440 + fl.dep;
      const t1 = t0 + fl.block;
      if (reverse) {
        const r0 = mod(-t1, WEEK);
        l.push({ f: i, t0: r0, t1: r0 + fl.block, d, al: fl.al });
      } else l.push({ f: i, t0: mod(t0, WEEK), t1: mod(t0, WEEK) + fl.block, d, al: fl.al });
    }
    const k = `${o}-${d}`;
    const e = edgeMap.get(k) ?? { o, d, als: {} };
    e.als[fl.al] = (e.als[fl.al] ?? 0) + 1;
    edgeMap.set(k, e);
  });
  for (const l of byAirport.values()) l.sort((a, b) => a.t0 - b.t0);
  const g = buildGraph([...edgeMap.values()], pts, false); // already oriented
  const nodes = new Set([...g.out.keys(), ...g.inn.keys()]);
  const start = placeSet(origin, nodes, pts);
  if (![...start].some((s) => byAirport.has(s))) return empty(`No timed flights ${reverse ? "into" : "from"} ${origin} for these filters.`);
  const vias = (reverse ? [...spec.via].reverse() : spec.via).map((v) => placeSet(v, nodes, pts));
  const hasTo = !reverse && !!spec.to;
  const wps = hasTo ? [...vias, placeSet(spec.to!, nodes, pts)] : vias;
  const plan = makePlan(g, pts, start, wps, hasTo);
  const col = new Collector(spec.sort);
  const rand = rng(spec.seed);
  const jitter = spec.seed ? 0.6 : 0.05;
  const duty = spec.dutyMin;
  let expansions = 0;
  let capped = false;

  const startLb = Math.min(...[...start].map((s) => lbLegs(plan, s, startIdx(plan, s))));
  if (startLb === Infinity) return empty(noRoute(spec), 0);

  /** Least time (min) to finish from u: flying the remaining distance plus a turn and a short block per leg. */
  const lbTime = (u: string, idx: number) => {
    const legs = lbLegs(plan, u, idx);
    if (!legs) return 0;
    const dist = plan.distTo(idx, u) + plan.distRest[Math.min(idx, wps.length)];
    return Math.max(dist / SPEED_NM_PER_MIN, legs * MIN_BLOCK) + legs * spec.minTurn;
  };

  const dayOk = (t0: number) => {
    if (reverse) {
      // reversed: the first leg here is the real last leg; its real IN must fall on the chosen day or within two after
      if (spec.day == null) return true;
      const realIn = mod(-t0, WEEK);
      return mod(Math.floor(realIn / 1440) + 1 - spec.day, 7) <= 2;
    }
    if (spec.day != null && Math.floor(t0 / 1440) + 1 !== spec.day) return false;
    if (spec.after != null && mod(t0, 1440) < spec.after) return false;
    return true;
  };

  const run = (maxDepth: number, recordAll: boolean) => {
    const legs: TimedLeg[] = [];
    const stops: string[] = [];
    const seen = new Set<string>();
    let tStart = 0;
    /** The waypoint index after taking `inst` to u, or null when a rule or a bound rules it out. */
    const accept = (inst: Inst, u: string, idx: number, depth: number, nm: number, al: string | null, firstLeg: boolean) => {
      const nIdx = advance(plan, u, idx);
      const done = hasTo && nIdx === wps.length;
      if (seen.has(u) && !(done && plan.roundTrip && start.has(u))) return null;
      if (depth + 1 + lbLegs(plan, u, nIdx) > maxDepth) return null;
      if (al && spec.oneAirline && inst.al !== al) return null;
      const elapsedLb = inst.t1 - (firstLeg ? inst.t0 : tStart) + lbTime(u, nIdx);
      if (duty != null && elapsedLb + spec.reportMin > duty) return null;
      if (spec.sort === "quickest" && elapsedLb * 1e3 >= col.threshold) return null;
      if (spec.sort === "distance") {
        const leg = gcNm(pts.get(stops[stops.length - 1])!, pts.get(u)!);
        if (nm + leg + plan.distTo(nIdx, u) + plan.distRest[Math.min(nIdx, wps.length)] >= col.threshold) return null;
      }
      return nIdx;
    };

    const walk = (v: string, depth: number, idx: number, tArr: number, nm: number, al: string | null) => {
      if (capped) return;
      if (++expansions > budget) {
        capped = true;
        return;
      }
      const list = byAirport.get(v);
      if (!list || !list.length) return;
      const lo = tArr + spec.minTurn;
      const hi = tArr + spec.maxTurn;
      const roam = idx >= wps.length;
      // first instance with t0 ≥ lo (mod week), then walk forward with wrap-around
      let i = lowerBound(list, mod(lo, WEEK));
      let base = lo - mod(lo, WEEK);
      const cand: [Inst, number, number, number][] = [];
      for (let n = 0; n < list.length; n++, i++) {
        if (i >= list.length) {
          i = 0;
          base += WEEK;
        }
        const inst = list[i];
        const t0 = inst.t0 + base;
        if (t0 > hi) break;
        if (t0 < lo) continue;
        const shifted = { ...inst, t0, t1: t0 + (inst.t1 - inst.t0) };
        const nIdx = accept(shifted, inst.d, idx, depth, nm, al, false);
        if (nIdx == null) continue;
        // steered by the next waypoint; roaming prefers the next departures (packs a duty), or chance
        const h = !roam ? plan.distTo(nIdx, inst.d) * (1 + jitter * rand()) + (t0 - lo) * 0.5 : spec.sort === "random" ? rand() : (t0 - lo) * (0.4 + rand());
        cand.push([shifted, nIdx, h, gcNm(pts.get(v)!, pts.get(inst.d)!)]);
      }
      cand.sort((x, y) => x[2] - y[2]);
      if (roam) cand.length = Math.min(cand.length, ROAM_BRANCH);
      for (const [inst, nIdx, , leg] of cand) {
        step(inst, v, nIdx, depth, nm + leg, al ?? inst.al);
        if (capped) return;
      }
    };

    const step = (inst: Inst, v: string, nIdx: number, depth: number, nm: number, al: string) => {
      if (++expansions > budget) {
        capped = true;
        return;
      }
      const u = inst.d;
      stops.push(u);
      legs.push({ f: inst.f, o: v, d: u, t0: inst.t0, t1: inst.t1 });
      const d = depth + 1;
      const complete = nIdx === wps.length;
      if (complete && (recordAll ? d <= maxDepth : d === maxDepth)) record(nm);
      if (!(hasTo && complete) && d < maxDepth) {
        seen.add(u);
        walk(u, d, nIdx, inst.t1, nm, al);
        seen.delete(u);
      }
      stops.pop();
      legs.pop();
    };

    const record = (nm: number) => {
      let ls = legs.map((l) => ({ ...l }));
      let st = [...stops];
      if (reverse) {
        // flip back: the real first leg is the last one here; real times are C - reversed times
        const last = ls[ls.length - 1];
        const C = last.t1 + mod(-last.t1, WEEK);
        st = st.reverse();
        ls = ls.reverse().map((l) => ({ f: l.f, o: l.d, d: l.o, t0: C - l.t1, t1: C - l.t0 }));
      }
      // normalise so the first OUT is inside the first week
      const shift = ls[0].t0 - mod(ls[0].t0, WEEK);
      ls = ls.map((l) => ({ ...l, t0: l.t0 - shift, t1: l.t1 - shift }));
      const first = ls[0];
      const lastLeg = ls[ls.length - 1];
      if (reverse) {
        if (spec.day != null && Math.floor(first.t0 / 1440) + 1 !== spec.day) return;
        if (spec.after != null && mod(first.t0, 1440) < spec.after) return;
      }
      let wait = 0;
      let block = 0;
      for (let k = 0; k < ls.length; k++) {
        block += ls[k].t1 - ls[k].t0;
        if (k) wait += ls[k].t0 - ls[k - 1].t1;
      }
      const day = Math.floor(first.t0 / 1440) + 1;
      const j: Journey = {
        stops: st,
        nm: Math.round(nm),
        rnd: rand(),
        timed: { legs: ls, days: [day], start: first.t0, end: lastLeg.t1, duty: lastLeg.t1 - first.t0 + spec.reportMin, wait, block },
      };
      col.add(j, vkey(j), day);
    };

    for (const s of start) {
      const list = byAirport.get(s);
      if (!list) continue;
      const firsts: [Inst, number, number][] = [];
      for (const inst of list) {
        if (!dayOk(inst.t0)) continue;
        stops.length = 0;
        stops.push(s);
        seen.clear();
        seen.add(s);
        tStart = inst.t0;
        const nIdx = accept(inst, inst.d, startIdx(plan, s), 0, 0, null, true);
        if (nIdx == null) continue;
        const h = plan.wps.length ? plan.distTo(nIdx, inst.d) * (1 + jitter * rand()) : rand();
        firsts.push([inst, nIdx, h]);
      }
      firsts.sort((x, y) => x[2] - y[2]);
      for (const [inst, nIdx] of firsts) {
        if (capped) break;
        stops.length = 0;
        stops.push(s);
        seen.clear();
        seen.add(s);
        tStart = inst.t0;
        step(inst, s, nIdx, 0, gcNm(pts.get(s)!, pts.get(inst.d)!), inst.al);
      }
    }
  };

  const result = runLegs(spec, startLb, run, () => col.groups.size);
  return finish(col, result, expansions, capped, spec);
}

function lowerBound(list: Inst[], t: number): number {
  let lo = 0,
    hi = list.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (list[m].t0 < t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/* ---------- helpers ---------- */

/** Runs the walk for the legs rule; "fewest" deepens from the lower bound until something is found. */
function runLegs(spec: Spec, lb: number, run: (maxDepth: number, recordAll: boolean) => void, found: () => number): number | null {
  const r = spec.legs;
  if (r.kind === "exact") {
    if (r.n >= Math.max(1, lb)) run(r.n, false);
    return null;
  }
  if (r.kind === "upto") {
    if (r.n >= Math.max(1, lb)) run(r.n, true);
    return null;
  }
  for (let n = Math.max(1, lb); n <= MAX_LEGS; n++) {
    run(n, false);
    if (found()) return n;
  }
  return null;
}

function finish(col: Collector, legs: number | null, expansions: number, capped: boolean, spec: Spec): Result {
  const groups = [...col.groups.values()].sort((a, b) => a.score - b.score || a.key.localeCompare(b.key));
  for (const g of groups) for (const v of g.variants) v.timed?.days.sort((a, b) => a - b);
  return { groups, legs, expansions, capped, reason: groups.length ? null : capped ? "Nothing found before the search budget ran out. Try fewer legs or Shuffle." : noRoute(spec) };
}

function noRoute(spec: Spec): string {
  const r = spec.legs;
  const legs = r.kind === "fewest" ? "" : ` in ${r.kind === "upto" ? "up to " : ""}${r.n} leg${r.n === 1 ? "" : "s"}`;
  return `No journey fits${legs}${spec.dutyMin != null ? " within the duty limit" : ""} with these filters.`;
}

function empty(reason: string, expansions = 0): Result {
  return { groups: [], legs: null, expansions, capped: false, reason };
}
