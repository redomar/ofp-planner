import type { GateFlight } from "../board/gate";
import { cleanFlight, type LogFlight } from "../logbook";
import type { FeedSource, FlightState } from "./core";

const hhmm = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString().slice(11, 16));

const SIM: Partial<Record<FeedSource, string>> = { link: "MSFS 2024", vatsim: "VATSIM", replay: "MSFS 2024" };
const SOURCE: Partial<Record<FeedSource, string>> = { link: "ofp-link", vatsim: "vatsim", replay: "recording" };

/**
 * A Logbook entry from a flight the gate screen followed to the gate: the times stamped as they
 * happened (OUT, OFF, ON, IN, UTC) and the landing rate, with the flight's details from the screen
 * (snapshot or SimBrief OFP). Times a feed couldn't see (a recording that starts in the air) stay
 * empty. Goes through the Logbook's own checks, like an import.
 */
export function logFromFeed(f: GateFlight, live: FlightState, using: FeedSource, reg: string | null): LogFlight | null {
  const st = live.stamps;
  const first = st.out ?? st.off ?? st.on ?? st.in;
  if (first == null) return null;
  const callsign = f.callsign?.replace(/\s/g, "") || null;
  const flightNo = f.flightNo.replace(/\s/g, "");
  const raw = {
    date: new Date(first).toISOString().slice(0, 10),
    from: f.from.icao,
    to: f.to.icao,
    callsign,
    flight: flightNo && flightNo !== callsign && /\d/.test(flightNo) ? flightNo : null,
    airline: f.brand?.icao ?? null,
    type: f.types[0] ?? null,
    reg: reg || f.reg || null,
    sim: SIM[using] ?? null,
    std: hhmm(f.stdMs),
    sta: f.block != null ? hhmm(f.stdMs + f.block * 60_000) : null,
    out: hhmm(st.out),
    off: hhmm(st.off),
    on: hhmm(st.on),
    in: hhmm(st.in),
    landingFpm: st.landingRate != null ? Math.round(st.landingRate) : null,
    pax: f.pax,
    source: SOURCE[using] ?? null,
  };
  const out = cleanFlight(raw);
  return typeof out === "string" ? null : out;
}
