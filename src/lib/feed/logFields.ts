import type { GateFlight } from "../board/gate";
import type { FeedSource, FlightSummary, FlightState } from "./core";

const hhmm = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString().slice(11, 16));

const SIM: Partial<Record<FeedSource, string>> = { link: "MSFS 2024", vatsim: "VATSIM", replay: "MSFS 2024" };
const SOURCE: Partial<Record<FeedSource, string>> = { link: "ofp-link", vatsim: "vatsim", replay: "recording" };

/**
 * The raw Logbook fields for a flight the gate screen followed to the gate (checked afterwards by
 * the Logbook's cleanFlight). Standalone, so the tests can load it in Node.
 *
 * - Registration: what the user typed, else the flight's (SimBrief OFP), else OFP Tower's summary
 *   of the same route (the sim's ATC ID).
 * - STD/STA: only from a schedule (SimBrief OFP or a Finder flight). A flight read from the
 *   aircraft's FMS has none; its departure time is only when the plan first came, so neither is
 *   written.
 */
export function logFields(
  f: GateFlight,
  live: FlightState,
  using: FeedSource,
  reg: string | null,
  summary: FlightSummary | null = null,
): Record<string, string | number | null> | null {
  const st = live.stamps;
  const first = st.out ?? st.off ?? st.on ?? st.in;
  if (first == null) return null;
  const callsign = f.callsign?.replace(/\s/g, "") || null;
  const flightNo = f.flightNo.replace(/\s/g, "");
  // OFP Tower's summary, when it is of this flight
  const sum =
    summary && (summary.origin == null || summary.origin === f.from.icao) && (summary.destination == null || summary.destination === f.to.icao)
      ? summary
      : null;
  const sumType = sum?.aircraft && /^[A-Z][A-Z0-9]{2,3}$/.test(sum.aircraft) ? sum.aircraft : null;
  const scheduled = f.source !== "fms";
  return {
    date: new Date(first).toISOString().slice(0, 10),
    from: f.from.icao,
    to: f.to.icao,
    callsign,
    flight: flightNo && flightNo !== callsign && /\d/.test(flightNo) ? flightNo : null,
    airline: f.brand?.icao ?? null,
    type: f.types[0] ?? sumType,
    reg: reg || f.reg || sum?.reg || null,
    sim: SIM[using] ?? null,
    std: scheduled ? hhmm(f.stdMs) : null,
    sta: scheduled && f.block != null ? hhmm(f.stdMs + f.block * 60_000) : null,
    out: hhmm(st.out),
    off: hhmm(st.off),
    on: hhmm(st.on),
    in: hhmm(st.in),
    landingFpm: st.landingRate != null ? Math.round(st.landingRate) : null,
    pax: f.pax,
    source: SOURCE[using] ?? null,
  };
}
