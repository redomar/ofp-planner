/**
 * IATA scheduling seasons. Summer runs from the last Sunday of March, winter from the last Sunday
 * of October, so each one matches the European clock change. Airlines publish a new timetable
 * for each season, and a flight that keeps its local time moves by an hour in UTC. A snapshot
 * therefore never mixes seasons: the pipeline cuts its window at the season change
 * (scripts/snapshot/season.mjs holds the same rule, keep both alike).
 */
import type { Manifest } from "./data/types";

export interface Season {
  /** "W26" (winter 2026/27), "S27" (summer 2027). */
  code: string;
  /** "Winter 2026/27", "Summer 2027". */
  name: string;
  /** First and last day (ISO dates, UTC). */
  from: string;
  to: string;
}

const DAY = 86_400_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const yy = (y: number) => String(y % 100).padStart(2, "0");

/** The last Sunday of a month (month 0-based), as UTC midnight in ms. */
function lastSunday(y: number, month: number): number {
  const d = new Date(Date.UTC(y, month + 1, 0));
  return d.getTime() - d.getUTCDay() * DAY;
}

/** The season an ISO date ("2026-11-08") falls in. */
export function seasonOf(iso: string): Season {
  const y = +iso.slice(0, 4);
  const summer = lastSunday(y, 2);
  const winter = lastSunday(y, 9);
  if (iso >= ymd(summer) && iso < ymd(winter)) return { code: `S${yy(y)}`, name: `Summer ${y}`, from: ymd(summer), to: ymd(winter - DAY) };
  const w = iso >= ymd(winter) ? y : y - 1;
  return { code: `W${yy(w)}`, name: `Winter ${w}/${yy(w + 1)}`, from: ymd(lastSunday(w, 9)), to: ymd(lastSunday(w + 1, 2) - DAY) };
}

/** The season the snapshot's schedules are from (its last day's), or null without coverage. */
export function snapshotSeason(m: Pick<Manifest, "coverage"> | null | undefined): Season | null {
  return m?.coverage ? seasonOf(m.coverage.to) : null;
}

/** "25 Oct", "27 Mar 2027": a short date for notes, with the year when it isn't this year. */
export function shortDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const s = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return iso.slice(0, 4) === new Date().toISOString().slice(0, 4) ? s : `${s} ${iso.slice(0, 4)}`;
}
