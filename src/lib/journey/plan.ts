/**
 * The journey page's form: what's asked, its defaults, and how it maps to the URL, so a
 * reload or a shared link reopens the same search. Pure, no React.
 */
import type { LegsRule, SortKey, Spec } from "./engine";

export type Timing = "network" | "timed";
/** How the journey list is ordered: an engine sort, or (timed) the soonest date from today. */
export type ListSort = SortKey | "next";

export interface JourneyPlan {
  from: string | null;
  to: string | null;
  via: string[];
  legs: LegsRule;
  timing: Timing;
  /** Brand ICAOs; empty = every airline. */
  al: string[];
  oneAirline: boolean;
  /** Aircraft families or ICAO types (timed only); empty = any. */
  types: string[];
  sort: ListSort;
  /** Reverse the list (legs flips fewest ⇄ most instead). */
  desc: boolean;
  seed: number;
  day: number | null;
  after: number | null;
  dutyMin: number | null;
  reportMin: number;
  minTurn: number;
  maxTurn: number;
  /** Detour limit as a factor of the shortest path through the stops; null = any. */
  detour: number | null;
}

export const EMPTY_PLAN: JourneyPlan = {
  from: null,
  to: null,
  via: [],
  legs: { kind: "fewest" },
  timing: "network",
  al: [],
  oneAirline: false,
  types: [],
  sort: "distance",
  desc: false,
  seed: 0,
  day: null,
  after: null,
  dutyMin: null,
  reportMin: 45,
  minTurn: 35,
  maxTurn: 180,
  detour: 2,
};

export const DETOURS = [1.5, 2, 3];

/** The list's sort headings, in order. "legs" covers fewest (up) and most (down). */
export const SORTS: { value: ListSort; label: string; tip: string; timed?: boolean }[] = [
  { value: "next", label: "Date", tip: "Soonest departure from today (UTC)", timed: true },
  { value: "distance", label: "Distance", tip: "Total great-circle distance" },
  { value: "fewest", label: "Legs", tip: "Number of legs" },
  { value: "quickest", label: "Duty", tip: "First OUT to last IN", timed: true },
  { value: "waiting", label: "Ground", tip: "Time on the ground between legs", timed: true },
  { value: "random", label: "Random", tip: "Random order; Shuffle deals again" },
];

export const DUTY_HOURS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/** The sort heading that's on: legs covers fewest and most; timed sorts fall back to distance on the network. */
export function listSort(p: JourneyPlan): ListSort {
  const s = p.sort === "most" ? "fewest" : p.sort;
  return p.timing === "network" && SORTS.find((x) => x.value === s)?.timed ? "distance" : s;
}

/** What the engine ranks by: "next" searches quickest first and is re-ordered by date on the page. */
export function effectiveSort(p: JourneyPlan): SortKey {
  const s = listSort(p);
  if (s === "next") return "quickest";
  if (s === "fewest") return p.desc ? "most" : "fewest";
  return s;
}

export function toSpec(p: JourneyPlan): Spec {
  return {
    from: p.from,
    to: p.to,
    via: p.via,
    legs: p.legs,
    oneAirline: p.oneAirline,
    sort: effectiveSort(p),
    seed: p.seed,
    day: p.day,
    after: p.after,
    dutyMin: p.dutyMin,
    reportMin: p.reportMin,
    minTurn: p.minTurn,
    maxTurn: Math.max(p.maxTurn, p.minTurn),
    maxDetour: p.detour,
  };
}

const PLACE = /^(?:[A-Z0-9]{4}|C:[A-Z]{2})$/;
const place = (v: string | null) => (v && PLACE.test(v) ? v : null);
const int = (v: string | null, lo: number, hi: number) => {
  if (v == null || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= lo && n <= hi ? n : null;
};
const clock = (v: string | null) => {
  const m = v?.match(/^(\d{2})(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
};
const hhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}${String(n % 60).padStart(2, "0")}`;

/** ?from=EGBB&via=EHAM,LFPG&to=LEMD&legs=f|4|u5&t=1&al=EZY&one=1&type=A320%20family&sort=distance&seed=3&day=2&after=0600&duty=360&report=45&turn=35-180 */
export function planFromParams(q: URLSearchParams): JourneyPlan {
  const legs = q.get("legs");
  const n = legs?.match(/^(u?)(\d)$/);
  const turn = q.get("turn")?.match(/^(\d{1,3})-(\d{1,3})$/);
  const sort = q.get("sort");
  return {
    from: place(q.get("from")),
    to: place(q.get("to")),
    via: (q.get("via") ?? "")
      .split(",")
      .map(place)
      .filter((v): v is string => !!v)
      .slice(0, 6),
    legs: n && +n[2] >= 1 && +n[2] <= 8 ? { kind: n[1] ? "upto" : "exact", n: +n[2] } : { kind: "fewest" },
    timing: q.get("t") === "1" ? "timed" : "network",
    al: (q.get("al") ?? "").split(",").filter((a) => /^[A-Z0-9]{2,4}$/.test(a)),
    oneAirline: q.get("one") === "1",
    types: (q.get("type") ?? "").split(",").filter(Boolean),
    sort: sort === "most" ? "fewest" : SORTS.some((s) => s.value === sort) ? (sort as ListSort) : EMPTY_PLAN.sort,
    desc: q.get("dir") === "desc" || sort === "most",
    detour: q.get("detour") === "any" ? null : DETOURS.includes(Number(q.get("detour"))) ? Number(q.get("detour")) : EMPTY_PLAN.detour,
    seed: int(q.get("seed"), 0, 1e9) ?? 0,
    day: int(q.get("day"), 1, 7),
    after: clock(q.get("after")),
    dutyMin: int(q.get("duty"), 60, 1440),
    reportMin: int(q.get("report"), 0, 180) ?? EMPTY_PLAN.reportMin,
    minTurn: turn ? Math.min(+turn[1], 600) : EMPTY_PLAN.minTurn,
    maxTurn: turn ? Math.min(Math.max(+turn[2], 10), 720) : EMPTY_PLAN.maxTurn,
  };
}

export function planToParams(p: JourneyPlan, extra: Record<string, string | null> = {}): URLSearchParams {
  const q = new URLSearchParams();
  const set = (k: string, v: string | null | false | undefined) => v && q.set(k, v);
  set("from", p.from);
  set("via", p.via.join(","));
  set("to", p.to);
  set("legs", p.legs.kind === "fewest" ? null : `${p.legs.kind === "upto" ? "u" : ""}${p.legs.n}`);
  set("t", p.timing === "timed" && "1");
  set("al", p.al.join(","));
  set("one", p.oneAirline && "1");
  set("type", p.types.join(","));
  set("sort", p.sort !== EMPTY_PLAN.sort && p.sort);
  set("dir", p.desc && "desc");
  set("detour", p.detour !== EMPTY_PLAN.detour && (p.detour == null ? "any" : String(p.detour)));
  set("seed", p.seed ? String(p.seed) : null);
  if (p.timing === "timed") {
    set("day", p.day ? String(p.day) : null);
    set("after", p.after != null ? hhmm(p.after) : null);
    set("duty", p.dutyMin ? String(p.dutyMin) : null);
    set("report", p.reportMin !== EMPTY_PLAN.reportMin && String(p.reportMin));
    set("turn", (p.minTurn !== EMPTY_PLAN.minTurn || p.maxTurn !== EMPTY_PLAN.maxTurn) && `${p.minTurn}-${p.maxTurn}`);
  }
  for (const [k, v] of Object.entries(extra)) set(k, v);
  return q;
}

/** The examples on the page: the kinds of question it answers. */
export const EXAMPLES: { label: string; note: string; plan: Partial<JourneyPlan> }[] = [
  {
    label: "EGBB → LEMD via EHAM",
    note: "Timed connections through Amsterdam, soonest date first",
    plan: { from: "EGBB", via: ["EHAM"], to: "LEMD", timing: "timed", sort: "next" },
  },
  {
    label: "A 4-leg day from EGBB",
    note: "Four timed legs, tightest turnarounds first",
    plan: { from: "EGBB", legs: { kind: "exact", n: 4 }, timing: "timed", sort: "waiting" },
  },
  {
    label: "6 h duty, ending in EPPO",
    note: "From anywhere, as many legs as fit a 6-hour duty",
    plan: { to: "EPPO", legs: { kind: "upto", n: 6 }, timing: "timed", dutyMin: 360, sort: "fewest", desc: true },
  },
  {
    label: "EGBB → LOWI, shortest",
    note: "No direct flight: the fewest legs, shortest first",
    plan: { from: "EGBB", to: "LOWI", sort: "distance" },
  },
  {
    label: "EGBB → LOWI in 5 legs",
    note: "Any day, exactly five legs, shortest first",
    plan: { from: "EGBB", to: "LOWI", legs: { kind: "exact", n: 5 }, sort: "distance" },
  },
];
