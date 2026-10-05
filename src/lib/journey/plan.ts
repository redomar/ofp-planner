/**
 * The journey page's form: what's asked, its defaults, and how it maps to the URL, so a
 * reload or a shared link reopens the same search. Pure, no React.
 */
import type { LegsRule, SortKey, Spec } from "./engine";

export type Timing = "network" | "timed";

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
  sort: SortKey;
  seed: number;
  day: number | null;
  after: number | null;
  dutyMin: number | null;
  reportMin: number;
  minTurn: number;
  maxTurn: number;
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
  seed: 0,
  day: null,
  after: null,
  dutyMin: null,
  reportMin: 45,
  minTurn: 35,
  maxTurn: 180,
};

export const SORTS: { value: SortKey; label: string; timed?: boolean }[] = [
  { value: "distance", label: "Shortest distance" },
  { value: "fewest", label: "Fewest legs" },
  { value: "most", label: "Most legs" },
  { value: "quickest", label: "Quickest, first OUT to last IN", timed: true },
  { value: "waiting", label: "Least time on the ground", timed: true },
  { value: "random", label: "Shuffled" },
];

export const DUTY_HOURS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/** Sorts that need times fall back to distance on the network. */
export function effectiveSort(p: JourneyPlan): SortKey {
  return p.timing === "network" && SORTS.find((s) => s.value === p.sort)?.timed ? "distance" : p.sort;
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
    sort: SORTS.some((s) => s.value === sort) ? (sort as SortKey) : EMPTY_PLAN.sort,
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
    note: "Timed connections through Amsterdam, quickest first",
    plan: { from: "EGBB", via: ["EHAM"], to: "LEMD", timing: "timed", sort: "quickest" },
  },
  {
    label: "A 4-leg day from EGBB",
    note: "Four timed legs, tightest turnarounds first",
    plan: { from: "EGBB", legs: { kind: "exact", n: 4 }, timing: "timed", sort: "waiting" },
  },
  {
    label: "6 h duty, ending in EPPO",
    note: "From anywhere, as many legs as fit a 6-hour duty",
    plan: { to: "EPPO", legs: { kind: "upto", n: 6 }, timing: "timed", dutyMin: 360, sort: "most" },
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
