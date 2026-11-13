import type { GateFlight } from "../board/gate";
import { cleanFlight, type LogFlight } from "../logbook";
import type { FeedSource, FlightState, FlightSummary } from "./core";
import { logFields } from "./logFields";

/**
 * A Logbook entry from a flight the gate screen followed to the gate: the times stamped as they
 * happened (OUT, OFF, ON, IN, UTC) and the landing rate, with the flight's details from the screen
 * (snapshot, SimBrief OFP or the aircraft's FMS) and OFP Tower's summary. Times a feed couldn't
 * see (a recording that starts in the air) stay empty. Goes through the Logbook's own checks,
 * like an import.
 */
export function logFromFeed(
  f: GateFlight,
  live: FlightState,
  using: FeedSource,
  reg: string | null,
  summary: FlightSummary | null = null,
): LogFlight | null {
  const raw = logFields(f, live, using, reg, summary);
  if (!raw) return null;
  const out = cleanFlight(raw);
  return typeof out === "string" ? null : out;
}
