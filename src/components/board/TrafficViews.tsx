"use client";

/**
 * 1.17: the traffic views. G10, the departures board: the stream's dot-matrix board, with the gate
 * and where each flight comes from (MSFS AI, SayIntentions, a SkyNet simmer, VATSIM, IVAO). G10b,
 * the connections card: a small card over the sim with the next departures. Both show the airport
 * the flight is at: the origin until take-off, then the destination (its connections).
 */
import { createContext, useContext, useMemo, type CSSProperties } from "react";
import { cityName } from "@/lib/data/flight";
import type { Airport } from "@/lib/data/load";
import type { AirlineInfo } from "@/lib/data/types";
import { textOn } from "@/lib/colors";
import type { GateFlight } from "@/lib/board/gate";
import type { Look } from "@/lib/board/looks";
import type { FlightState } from "@/lib/feed/core";
import { airlineOf, atOriginOf, boardRows, fromIvao, fromTower, fromVatsim, mergeTraffic, type Stand, type TrafficRow, type TrafficSource, type TrafficStatus } from "@/lib/feed/traffic";
import { useNetworkTraffic } from "@/lib/feed/useTraffic";
import { localClock } from "./GateScreen";

/** Airports (for the other ends' names) and airlines (for the colours), from the page's data. */
export const TrafficPlaces = createContext<{
  airports: Map<string, Airport> | null;
  airlines: AirlineInfo[];
}>({ airports: null, airlines: [] });

const MIN = 60_000;
const SRC_NAME: Record<TrafficSource, string> = {
  AI: "MSFS AI",
  SI: "SayIntentions",
  SKY: "SkyNet simmer",
  VAT: "VATSIM",
  IVAO: "IVAO",
};

export interface TrafficViewProps {
  f: GateFlight;
  live: FlightState | null;
  now: number;
  /** The flight's arrival time (UTC ms), when known. */
  arrives: number | null;
  look: Look;
  towerTraffic?: Record<string, unknown> | null;
  stands?: { airport: string; stands: Stand[] } | null;
  /** A preview (not the stream): example traffic, nothing fetched. */
  preview?: boolean;
}

type Row = TrafficRow & { me?: boolean };

/** The flight is still at its origin (no feed, or not yet airborne). */
/** At the origin: see `atOriginOf` (traffic.ts). */
const atOrigin = (f: Pick<GateFlight, "from" | "to">, live: FlightState | null) => atOriginOf(f.from, f.to, live?.last ?? null, live?.stage ?? null);

function ownRow(f: GateFlight, live: FlightState | null, origin: boolean, arrives: number | null): Row {
  const ph = live?.phase;
  let status: TrafficStatus;
  if (origin) status = ph === "pushback" ? "PUSHBACK" : ph === "taxi" ? "TAXIING" : ph === "takeoff" ? "DEPARTED" : "BOARDING";
  else {
    // on the ground at the destination (landed, or a screen opened there afterwards)
    const parked = live?.last?.onGround === true && (live.last.gs ?? 0) < 1;
    status = ph === "landed" || ph === "taxiIn" ? "LANDED" : ph === "gate" || live?.stage === "arrived" || parked ? "ON BLOCKS" : ph === "approach" || ph === "descent" ? "APPROACH" : "EN ROUTE";
  }
  return {
    callsign: (f.callsign ?? f.flightNo).replace(/\s+/g, "").toUpperCase(),
    src: "AI",
    side: origin ? "dep" : "arr",
    other: origin ? f.to.icao : f.from.icao,
    // at the destination: the landing time, else the estimate (none once parked without a landing seen)
    t: origin ? f.stdMs : (live?.stamps.on ?? (status === "ON BLOCKS" ? null : arrives)),
    gate: null,
    snapped: false,
    status,
    type: f.types[0] ?? null,
    me: true,
  };
}

/** Example traffic for the previews: plausible departures around the flight's time at that airport. */
function sampleRows(apIcao: string, base: number): TrafficRow[] {
  const ex: [string, string, number, string, TrafficSource, TrafficStatus][] = [
    ["BAW476", "EGLL", -6, "J46", "VAT", "TAXIING"],
    ["TAP1015", "LPPT", -2, "H19", "SI", "PUSHBACK"],
    ["IBE2871", "GCXO", 4, "J50", "AI", "BOARDING"],
    ["VLG7721", "EBBR", 9, "K90", "SKY", "BOARDING"],
    ["KLM1700", "EHAM", 16, "H22", "IVAO", "BOARDING"],
    ["DLH1803", "EDDM", 31, "K88", "AI", "AT GATE"],
    ["UAE142", "OMDB", 36, "S30", "VAT", "AT GATE"],
    ["EZY7340", "EGBB", 46, "M12", "SI", "SCHEDULED"],
    ["AEA6001", "LEPA", 51, "J41", "AI", "SCHEDULED"],
    ["ITY053", "LIRF", 61, "H24", "IVAO", "SCHEDULED"],
    ["AFR1301", "LFPG", 72, "K82", "AI", "SCHEDULED"],
  ];
  return ex
    .filter(([, to]) => to !== apIcao)
    .map(([callsign, other, m, gate, src, status]) => ({
      callsign,
      src,
      side: "dep" as const,
      other,
      t: Math.round((base + m * MIN) / MIN) * MIN,
      gate,
      snapped: src !== "AI",
      status,
      type: null,
    }));
}

/** The rows for a traffic view, and where they're from. */
function useBoard(p: TrafficViewProps, max: number) {
  const origin = atOrigin(p.f, p.live);
  const ap = origin ? p.f.from : p.f.to;
  const net = useNetworkTraffic(!p.preview);
  const me = ownRow(p.f, p.live, origin, p.arrives);
  const stands = p.stands?.airport === ap.icao ? p.stands.stands : null;
  // the board's window: from a little before now, or the landing at the destination
  const pivot = origin ? p.now : Math.max(p.now, me.t ?? p.now);
  const minute = Math.floor(p.now / MIN);
  const pivotMin = Math.floor(pivot / MIN);
  const { preview, towerTraffic } = p;
  const vatsim = net.vatsim;
  const ivao = net.ivao;
  const rows = useMemo(() => {
    const tap = { icao: ap.icao, lat: ap.lat, lon: ap.lon, elevFt: ap.elevFt };
    const pv = pivotMin * MIN;
    const all = preview
      ? sampleRows(ap.icao, pv)
      : mergeTraffic(fromVatsim(vatsim, tap, minute * MIN, stands), fromIvao(ivao, tap, minute * MIN, stands), fromTower(towerTraffic, tap, minute * MIN, stands));
    return boardRows(all, "dep", pv - 15 * MIN, pv + 120 * MIN, minute * MIN, max, (cs) => cs === me.callsign);
  }, [preview, vatsim, ivao, towerTraffic, stands, ap.icao, ap.lat, ap.lon, ap.elevFt, pivotMin, minute, max, me.callsign]);
  const withMe: Row[] = [...rows];
  const at = withMe.findIndex((r) => (r.t ?? p.now) > (me.t ?? p.now));
  withMe.splice(at < 0 ? withMe.length : at, 0, me);
  const loaded = p.preview || net.at > 0 || !!p.towerTraffic;
  return {
    ap,
    origin,
    rows: withMe,
    me,
    loaded,
    none: loaded && rows.length === 0,
  };
}

function useChip() {
  const { airlines } = useContext(TrafficPlaces);
  return (cs: string, me?: boolean): { bg: string; ink: string; code: string } => {
    // the stream's own flight: its airline's chip like any other row (green when the airline isn't known)
    const a = airlineOf(cs, airlines);
    if (!a)
      return {
        bg: me ? "#3ee07a" : "#4a5263",
        ink: me ? "#05301a" : "#ffffff",
        code: /^[A-Z]{3}\d/.test(cs) ? cs.slice(0, 3) : "—",
      };
    const bg = a.colors.primary;
    return { bg, ink: textOn(bg), code: a.iata ?? a.icao };
  };
}

function usePlace() {
  const { airports } = useContext(TrafficPlaces);
  return (icao: string | null) => {
    if (!icao) return "—";
    const a = airports?.get(icao);
    return (a ? cityName(a) ?? a.name : icao).toUpperCase();
  };
}

const Src = ({ s, me }: { s: TrafficSource; me?: boolean }) =>
  me ? (
    <span className="tv-src is-you" title="The flight on this stream">
      LIVE
    </span>
  ) : (
    <span className={`tv-src is-${s}`} title={SRC_NAME[s]}>
      {s}
    </span>
  );

/* ---------- G10: the departures board ---------- */

export function DeparturesBoard(p: TrafficViewProps) {
  const b = useBoard(p, 10);
  const chip = useChip();
  const place = usePlace();
  const tz = b.ap.tz;
  const city = (cityName(b.ap) ?? b.ap.name).toUpperCase();
  return (
    <div className="gv tv-fids" role="region" aria-label={`Departures, ${city}`}>
      <div className="tv-fids-hd">
        <span>DEPARTURES · {city}</span>
        <small>{localClock(p.now, tz)}</small>
      </div>
      {b.rows.map((r) => {
        const c = chip(r.callsign, r.me);
        // the flight's own row at the destination: where it comes from, and when it lands
        const where = r.me && !b.origin ? `${place(r.other)}` : place(r.other);
        return (
          <div className={`tv-fids-r${r.me ? " is-me" : ""}`} key={r.callsign}>
            <span className="tv-chip" style={{ background: c.bg, color: c.ink } as CSSProperties}>
              {c.code}
            </span>
            <span className="tv-dot tv-w">{r.t != null ? localClock(r.t, tz) : "--:--"}</span>
            <span className="tv-dot">{where}</span>
            <span className="tv-dot">
              {r.callsign.slice(0, 3)}
              <span className="tv-w">{r.callsign.slice(3)}</span>
            </span>
            <span className="tv-dot tv-w tv-gate">{r.gate ?? "--"}</span>
            <Src s={r.src} me={r.me} />
            <span className="tv-dot">{r.me && !b.origin ? (r.status === "EN ROUTE" || r.status === "APPROACH" ? "LANDING" : r.status) : r.status}</span>
          </div>
        );
      })}
      {!b.loaded && <p className="tv-fids-note">Looking for traffic on VATSIM and IVAO…</p>}
      {b.none && (
        <p className="tv-fids-note">
          No departures on VATSIM or IVAO in the next two hours
          {p.towerTraffic ? "" : " · sim traffic comes with OFP Tower"}
        </p>
      )}
    </div>
  );
}

/* ---------- G10b: the connections card ---------- */

export function ConnectionsCard(p: TrafficViewProps) {
  const b = useBoard(p, 6);
  const place = usePlace();
  const { airlines } = useContext(TrafficPlaces);
  const tz = b.ap.tz;
  const code = b.ap.iata ?? b.ap.icao;
  const others = b.rows.filter((r) => !r.me);
  const at = { "data-size": p.look.size, "data-pos": p.look.pos } as Record<string, string>;
  // a city in title case; an ICAO code (no name known) as it is
  const cap = (s: string) => (/^[A-Z0-9]{4}$/.test(s) ? s : s.toLowerCase().replace(/(^|[\s-])\S/g, (x) => x.toUpperCase()));
  return (
    <div className="gv gv-over" {...at} role="region" aria-label={`${b.origin ? "Departures" : "Connections"} at ${code}`}>
      <div className="gv-card tv-conn">
        <div className="tv-conn-hd">
          <b>
            {b.origin ? "Departures" : "Connections"} · {code}
          </b>
          <span>{localClock(p.now, tz)}</span>
        </div>
        <div className="tv-conn-me">
          {b.origin
            ? `${b.me.callsign} departs ${b.me.t != null ? localClock(b.me.t, tz) : "—"}`
            : b.me.status === "ON BLOCKS" || b.me.status === "LANDED"
            ? `${b.me.callsign} landed ${b.me.t != null ? localClock(b.me.t, tz) : ""}`
            : `${b.me.callsign} lands ${b.me.t != null ? localClock(b.me.t, tz) : "—"}`}
        </div>
        {others.map((r) => {
          const a = airlineOf(r.callsign, airlines);
          return (
            <div className="tv-conn-r" key={r.callsign}>
              <i style={{ background: a?.colors.primary ?? "#4a5263" }} />
              <span className="mono">{r.t != null ? localClock(r.t, tz) : "--:--"}</span>
              <span className="tv-conn-d">{cap(place(r.other))}</span>
              <span className="mono">{r.gate ?? "—"}</span>
              <Src s={r.src} />
            </div>
          );
        })}
        {!b.loaded && <div className="tv-conn-note">Looking for traffic…</div>}
        {b.none && <div className="tv-conn-note">No departures on VATSIM or IVAO yet</div>}
      </div>
    </div>
  );
}
