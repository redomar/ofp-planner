/**
 * Timed journeys run on a weekly pattern; these turn each (timing, weekday) into the next real
 * departure from now, so the page can say "Tue 6 Oct" and sort by what's soonest.
 */
import { WEEK, type Group, type Journey } from "./engine";

export interface Departure {
  /** Index of the timing in group.variants. */
  vi: number;
  v: Journey;
  /** ISO weekday of the first OUT (UTC). */
  day: number;
  /** Epoch ms of the first OUT on its next date. */
  at: number;
}

const weekMinute = (ms: number) => {
  const d = new Date(ms);
  return ((d.getUTCDay() + 6) % 7) * 1440 + d.getUTCHours() * 60 + d.getUTCMinutes();
};

/** Every timing × weekday as its next departure at or after `now`, soonest first. */
export function departures(g: Group, now: number): Departure[] {
  const base = now - (now % 60_000);
  const nowW = weekMinute(base);
  const out: Departure[] = [];
  g.variants.forEach((v, vi) => {
    const t = v.timed;
    if (!t) return;
    const m = t.start % 1440;
    for (const day of t.days) {
      const diff = ((((day - 1) * 1440 + m - nowW) % WEEK) + WEEK) % WEEK;
      out.push({ vi, v, day, at: base + diff * 60_000 });
    }
  });
  return out.sort((a, b) => a.at - b.at || a.vi - b.vi);
}

/** Minutes until the group's soonest departure (Infinity for network journeys). */
export function soonest(g: Group, now: number): number {
  const d = departures(g, now)[0];
  return d ? (d.at - now) / 60_000 : Infinity;
}

/** UTC date (YYYY-MM-DD) a leg departs, given the journey's first OUT at `at`. */
export function legDate(d: Departure, legT0: number): string {
  return new Date(d.at + (legT0 - d.v.timed!.start) * 60_000).toISOString().slice(0, 10);
}

const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
/** "Tue 6 Oct" */
export const dateLabel = (ms: number) => DAY.format(new Date(ms)).replace(",", "");
/** "today", "tomorrow" or null. */
export function relDay(ms: number, now: number): string | null {
  const n = Math.floor(ms / 86_400_000) - Math.floor(now / 86_400_000);
  return n === 0 ? "today" : n === 1 ? "tomorrow" : null;
}
