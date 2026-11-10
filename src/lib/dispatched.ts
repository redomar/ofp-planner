/**
 * When each flight was last opened in SimBrief from its pass, so the stub can stay stamped
 * "Dispatched". Kept for a day (a flight is flown the day it's dispatched), newest 40, per browser.
 */
import { useMemo, useState } from "react";
import { KEYS, readJSON, useStorageVersion, writeJSON } from "./storage";

const DAY = 86_400_000;
const KEEP = 40;

function read(since: number): Record<string, number> {
  const all = readJSON<Record<string, unknown>>(KEYS.dispatched, {});
  return Object.fromEntries(Object.entries(all).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > since));
}

/** Stamp the flight as sent to SimBrief now. False when the browser refused to store it. */
export function markDispatched(id: string): boolean {
  const now = Date.now();
  const recent = { ...read(now - DAY), [id]: now };
  const newest = Object.entries(recent).sort((a, b) => b[1] - a[1]).slice(0, KEEP);
  return writeJSON(KEYS.dispatched, Object.fromEntries(newest));
}

/** When this flight was sent to SimBrief (ms), within the last day; null if it wasn't. */
export function useDispatched(id: string): number | null {
  const v = useStorageVersion();
  const [opened] = useState(() => Date.now());
  return useMemo(() => (v < 0 ? null : (read(opened - DAY)[id] ?? null)), [v, id, opened]);
}
