"use client";

import type { Manifest } from "@/lib/data/types";
import { seasonOf, shortDay, snapshotSeason } from "@/lib/season";

/**
 * A note when a date falls in another IATA season than the snapshot's timetable: the airline may
 * not fly then, and a flight that keeps its local time moves by an hour in UTC at the change.
 * Renders nothing when the date is in the snapshot's season (or there's no coverage yet).
 */
export function SeasonNote({ date, lead, manifest, many = false }: { date: string; lead: string; manifest: Manifest | null; many?: boolean }) {
  const snap = snapshotSeason(manifest);
  if (!snap || !manifest?.coverage) return null;
  const on = seasonOf(date);
  if (on.code === snap.code) return null;
  return (
    <p className="note-amber season-note" data-season={on.code}>
      {lead} is in the <b>{on.name}</b> timetable, but these times come from <b>{snap.name}</b> (seen {shortDay(manifest.coverage.from)} –{" "}
      {shortDay(manifest.coverage.to)}). Airlines change their timetables between seasons and the clocks change, so{" "}
      {many ? "some of these flights may not run then, and their times may be an hour off." : "the flight may not run then, and its times may be an hour off."}
    </p>
  );
}
