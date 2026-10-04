/**
 * Data contract between the snapshot pipeline (scripts/snapshot/) and the app.
 * Files live in public/data/ and are fetched once by the browser, then cached.
 * Every field the pipeline can't be sure of is nullable; the UI says what's missing.
 *
 * Times: all clock times are minutes after midnight UTC (0-1439) unless a name ends in
 * "Local". Durations are minutes. Distances are nautical miles.
 *
 * OOOI: OUT = off-block (pushback from gate), OFF = wheels-up, ON = touchdown,
 * IN = on-block (at gate). Scheduled times (STD/STA) are gate times, so they compare
 * with OUT/IN, not OFF/ON.
 */

/** public/data/manifest.json */
export interface Manifest {
  /** Bumped when this contract changes shape. */
  schema: 1;
  generatedAt: string; // ISO
  /** Date range the schedule/observations cover (ISO dates). */
  coverage: { from: string; to: string } | null;
  sources: SourceInfo[];
  airlines: AirlineInfo[];
  counts: { airlines: number; flights: number; airports: number; routes: number };
}

export interface SourceInfo {
  id: string;
  name: string;
  url: string;
  licence: string;
  /** What this source contributed (e.g. "routes and flight numbers", "observed OFF/ON times"). */
  provides: string;
  fetchedAt: string; // ISO
}

export interface AirlineInfo {
  icao: string; // "EZY"
  iata: string | null; // "U2"
  name: string; // "easyJet"
  /** ATC callsign word ("EASY"). */
  callsign: string | null;
  country: string | null; // ISO 3166-1 alpha-2
  /** Brand colours (hex). primary is the route line; secondary is optional trim. */
  colors: { primary: string; secondary: string | null };
  /** Sub-operators flown under the same brand (EZY, EJU, EZS for easyJet). */
  operators: string[];
  /** Path relative to public/, e.g. "data/airlines/EZY.json". */
  file: string;
  flights: number;
}

/** public/data/airports.json — only airports referenced by some flight. */
export interface AirportsFile {
  schema: 1;
  /** icao → row */
  airports: Record<string, AirportRow>;
}
/** [iata, name, city, country(ISO2), lat, lon, elevationFt, ianaTimeZone] */
export type AirportRow = [
  string | null,
  string,
  string | null,
  string | null,
  number,
  number,
  number | null,
  string | null,
];

/** public/data/airlines/<ICAO>.json */
export interface AirlineFile {
  schema: 1;
  airline: string; // ICAO of the brand (matches AirlineInfo.icao)
  flights: Flight[];
}

export interface Flight {
  /** Operating airline ICAO (may differ from the brand, e.g. "EJU" under easyJet). */
  op: string;
  /** Marketing flight number, digits plus optional suffix letter ("1016", "8473A"). */
  fn: string;
  /** ATC callsign as filed ("EJU54LH"), null when unknown. */
  cs: string | null;
  o: string; // origin ICAO
  d: string; // destination ICAO
  /** Aircraft ICAO type designators seen/scheduled on this flight, most common first. */
  types: string[];
  /** Days of week operated, ISO numbering 1=Mon..7=Sun, e.g. [1,3,5]. Empty = unknown. */
  days: number[];
  /** Scheduled times (gate), UTC minutes. */
  std: number | null;
  sta: number | null;
  /** Typical observed OOOI times (UTC minutes, median over samples). */
  out: number | null;
  off: number | null;
  on: number | null;
  in: number | null;
  /** Number of observed operations behind the OOOI medians. */
  samples: number;
}
