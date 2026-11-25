"use client";

/**
 * 1.17: the traffic looks, for the airport the flight is at (the origin until take-off, then the
 * destination): G10, the board full screen; G10b, a card over the sim; G10c (1.17.3), the board on
 * the right with a window for the game, like the ending screen. Each shows departures or arrivals
 * (`look.side`) in a style (`look.style`): the airline's colours, a dot-matrix board or split-flaps.
 * Each row: the airline's colour, the time, the other end, the flight, the gate, and where it's from
 * (MSFS AI, SayIntentions, a SkyNet simmer, VATSIM, IVAO); the stream's own flight is marked LIVE.
 */
import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from "react";
import { cityName } from "@/lib/data/flight";
import type { Airport } from "@/lib/data/load";
import type { AirlineInfo } from "@/lib/data/types";
import { routeColor, textOn } from "@/lib/colors";
import type { GateFlight } from "@/lib/board/gate";
import { look, sideAt, type Look, type TrafficStyle } from "@/lib/board/looks";
import type { FlightState } from "@/lib/feed/core";
import { airlineOf, atOriginOf, boardRows, fromIvao, fromTower, fromVatsim, mergeTraffic, type Stand, type TrafficRow, type TrafficSource, type TrafficStatus } from "@/lib/feed/traffic";
import { useNetworkTraffic } from "@/lib/feed/useTraffic";
import { localClock } from "./GateScreen";

/** Airports (for the other ends' names) and airlines (for the colours), from the page's data. */
export const TrafficPlaces = createContext<{ airports: Map<string, Airport> | null; airlines: AirlineInfo[] }>({ airports: null, airlines: [] });

const MIN = 60_000;
const SRC_NAME: Record<TrafficSource, string> = { AI: "MSFS AI", SI: "SayIntentions", SKY: "SkyNet simmer", VAT: "VATSIM", IVAO: "IVAO" };

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

/** Example traffic for the previews: plausible movements around the flight's time at that airport. */
function sampleRows(apIcao: string, base: number, side: "dep" | "arr"): TrafficRow[] {
  const ex: [string, string, number, string, TrafficSource, TrafficStatus, TrafficStatus][] = [
    ["BAW476", "EGLL", -6, "J46", "VAT", "TAXIING", "LANDED"],
    ["TAP1015", "LPPT", -2, "H19", "SI", "PUSHBACK", "LANDED"],
    ["IBE2871", "GCXO", 4, "J50", "AI", "BOARDING", "APPROACH"],
    ["VLG7721", "EBBR", 9, "K90", "SKY", "BOARDING", "APPROACH"],
    ["KLM1700", "EHAM", 16, "H22", "IVAO", "BOARDING", "APPROACH"],
    ["DLH1803", "EDDM", 31, "K88", "AI", "AT GATE", "EN ROUTE"],
    ["UAE142", "OMDB", 36, "S30", "VAT", "AT GATE", "EN ROUTE"],
    ["EZY7340", "EGBB", 46, "M12", "SI", "SCHEDULED", "EN ROUTE"],
    ["AEA6001", "LEPA", 51, "J41", "AI", "SCHEDULED", "EN ROUTE"],
    ["ITY053", "LIRF", 61, "H24", "IVAO", "SCHEDULED", "EN ROUTE"],
    ["AFR1301", "LFPG", 72, "K82", "AI", "SCHEDULED", "EN ROUTE"],
  ];
  return ex
    .filter(([, other]) => other !== apIcao)
    .map(([callsign, other, m, gate, src, dep, arr]) => ({ callsign, src, side, other, t: Math.round((base + m * MIN) / MIN) * MIN, gate: side === "dep" || arr === "LANDED" ? gate : null, snapped: src !== "AI", status: side === "dep" ? dep : arr, type: null }));
}

/** The rows for a traffic look, and where they're from. */
function useBoard(p: TrafficViewProps, max: number, atDest = false) {
  // 1.17.7: a board that flips shows departures, then arrivals, in turn
  const side = sideAt(p.look, p.now);
  // the ending screen: the flight is over, so its destination whatever the feed says (none at all, OFP Tower closed)
  const origin = atDest ? false : atOrigin(p.f, p.live);
  const ap = origin ? p.f.from : p.f.to;
  const net = useNetworkTraffic(!p.preview);
  const me = ownRow(p.f, p.live, origin, p.arrives);
  const stands = p.stands?.airport === ap.icao ? p.stands.stands : null;
  // the board's window: from a little before now, or the landing at the destination
  const pivot = origin || side === "arr" ? p.now : Math.max(p.now, me.t ?? p.now);
  const minute = Math.floor(p.now / MIN);
  const pivotMin = Math.floor(pivot / MIN);
  const { preview, towerTraffic } = p;
  const vatsim = net.vatsim;
  const ivao = net.ivao;
  const rows = useMemo(() => {
    const tap = { icao: ap.icao, lat: ap.lat, lon: ap.lon, elevFt: ap.elevFt };
    const pv = pivotMin * MIN;
    const all = preview
      ? sampleRows(ap.icao, pv, side)
      : mergeTraffic(fromVatsim(vatsim, tap, minute * MIN, stands), fromIvao(ivao, tap, minute * MIN, stands), fromTower(towerTraffic, tap, minute * MIN, stands));
    return boardRows(all, side, pv - (side === "arr" ? 30 : 15) * MIN, pv + 120 * MIN, minute * MIN, max, (cs) => cs === me.callsign);
  }, [preview, vatsim, ivao, towerTraffic, stands, ap.icao, ap.lat, ap.lon, ap.elevFt, pivotMin, minute, max, me.callsign, side]);
  // the stream's own flight: among the departures (at the origin, or as the arrival the connections follow),
  // and among the arrivals at the destination
  const withMe: Row[] = [...rows];
  if (side === "dep" || !origin) {
    const at = withMe.findIndex((r) => (r.t ?? p.now) > (me.t ?? p.now));
    withMe.splice(at < 0 ? withMe.length : at, 0, me);
  }
  const loaded = p.preview || net.at > 0 || !!p.towerTraffic;
  return { ap, origin, side, flips: p.look.side === "flip", rows: withMe, me, loaded, none: loaded && rows.length === 0 };
}

type Board = ReturnType<typeof useBoard>;

function useChip() {
  const { airlines } = useContext(TrafficPlaces);
  return (cs: string, me?: boolean): { bg: string; ink: string; code: string } => {
    // the stream's own flight: its airline's chip like any other row (green when the airline isn't known)
    const a = airlineOf(cs, airlines);
    if (!a) return { bg: me ? "#3ee07a" : "#4a5263", ink: me ? "#05301a" : "#ffffff", code: /^[A-Z]{3}\d/.test(cs) ? cs.slice(0, 3) : "—" };
    const bg = a.colors.primary;
    // 1.17.4: the ICAO code, three letters, as the callsign has it (EJU for easyJet Europe, in easyJet's colours)
    return { bg, ink: textOn(bg), code: cs.match(/^[A-Z]{3}/)?.[0] ?? a.icao };
  };
}

function usePlace() {
  const { airports } = useContext(TrafficPlaces);
  return (icao: string | null) => {
    if (!icao) return "—";
    const a = airports?.get(icao);
    return (a ? (cityName(a) ?? a.name) : icao).toUpperCase();
  };
}

/** A city in title case ("OSLO" → "Oslo"); a code with no name known ("KEWR") as it is. */
const cap = (s: string, code = false) => (code || s === "—" ? s : s.toLowerCase().replace(/(^|[\s-])\S/g, (x) => x.toUpperCase()));

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

/** What a row says: the own flight at the destination is "landing" until it has. */
const statusOf = (b: Board, r: Row) => (r.me && !b.origin && (r.status === "EN ROUTE" || r.status === "APPROACH") ? "LANDING" : r.status);

/** One word per split-flap: each character on its own flap, padded to the width. */
const flaps = (text: string, n: number) => (
  <span className="tv-flaps" aria-label={text}>
    {text
      .padEnd(n)
      .slice(0, n)
      .split("")
      .map((c, i) => (
        <span className="tv-flap" key={i} aria-hidden="true">
          {c === " " ? " " : c}
        </span>
      ))}
  </span>
);

/** The rows of a board in a style. `compact`: the card and the side panel (no flight column at extra small). */
function Rows({ b, style, tz, compact }: { b: Board; style: TrafficStyle; tz: string | null; compact: boolean }) {
  const chip = useChip();
  const place = usePlace();
  const { airports } = useContext(TrafficPlaces);
  // 1.17.8: no gate on any row (VATSIM's traffic, mostly): the column gives its room to the flight number
  const noGate = compact && !b.rows.some((r) => r.gate);
  return (
    <div className={`tv-rows is-${style}${compact ? " is-compact" : ""}${noGate ? " is-nogate" : ""}${b.flips ? " is-flipping" : ""}`} key={b.side}>
      {b.rows.map((r) => {
        const c = chip(r.callsign, r.me);
        const time = r.t != null ? localClock(r.t, tz) : "--:--";
        const where = place(r.other);
        const st = statusOf(b, r);
        const k = `${r.callsign}${r.me ? ":me" : ""}`;
        if (style === "flap")
          return (
            <div className={`tv-r${r.me ? " is-me" : ""}`} key={k}>
              <i className="tv-stripe" style={{ background: c.bg }} />
              {flaps(time.replace(":", ""), 4)}
              {compact && flaps(r.callsign, 7)}
              {flaps(where, compact ? 9 : 11)}
              {!compact && flaps(r.callsign, 7)}
              {!noGate && flaps(r.gate ?? "", 3)}
              <Src s={r.src} me={r.me} />
              {flaps(st, compact ? 8 : 10)}
            </div>
          );
        if (style === "dot")
          return (
            <div className={`tv-r${r.me ? " is-me" : ""}`} key={k}>
              {compact ? (
                // 1.17.8: the small boards' flight number: the airline's chip is its first three letters
                <span className="tv-fl">
                  <span className="tv-chip" style={{ background: c.bg, color: c.ink } as CSSProperties}>
                    {c.code}
                  </span>
                  <span className="tv-dot tv-w">{c.code === r.callsign.slice(0, 3) ? r.callsign.slice(3) : r.callsign}</span>
                </span>
              ) : (
                <span className="tv-chip" style={{ background: c.bg, color: c.ink } as CSSProperties}>
                  {c.code}
                </span>
              )}
              <span className="tv-dot tv-w">{time}</span>
              <span className="tv-dot">{where}</span>
              {!compact && (
                <span className="tv-dot">
                  {r.callsign.slice(0, 3)}
                  <span className="tv-w">{r.callsign.slice(3)}</span>
                </span>
              )}
              <span className="tv-dot tv-w tv-gate">{r.gate ?? "--"}</span>
              <Src s={r.src} me={r.me} />
              <span className="tv-dot">{st}</span>
            </div>
          );
        // the airline's colours: like the other cards
        return (
          <div className={`tv-r${r.me ? " is-me" : ""}`} key={k}>
            <i className="tv-stripe" style={{ background: c.bg }} />
            <span className="tv-time mono">{time}</span>
            <span className="tv-where">
              <b>{cap(where, !!r.other && !airports?.get(r.other))}</b>
              <small className="mono">
                {r.callsign} · {cap(st)}
              </small>
            </span>
            <span className="tv-gate mono">{r.gate ?? "—"}</span>
            <Src s={r.src} me={r.me} />
          </div>
        );
      })}
      {!b.loaded && <p className="tv-note">Looking for traffic…</p>}
      {b.none && <p className="tv-note">No {b.side === "arr" ? "arrivals" : "departures"} yet on VATSIM, IVAO or in the sim</p>}
    </div>
  );
}

/** The board's colours: the airline's for its style, the airport's dark for the others. */
function boardStyle(f: GateFlight, style: TrafficStyle): CSSProperties {
  if (style !== "brand") return { "--gs-bg": style === "dot" ? "#11141a" : "#1a1a1a", "--gs-ink": "#f2f2f2", "--gs-accent": "#f4c430" } as CSSProperties;
  const bg = routeColor(f.brand);
  const ink = textOn(bg);
  const accent = f.brand?.colors.secondary && /^#[0-9a-f]{6}$/i.test(f.brand.colors.secondary) && f.brand.colors.secondary.toLowerCase() !== bg.toLowerCase() ? f.brand.colors.secondary : ink;
  return { "--gs-bg": bg, "--gs-ink": ink, "--gs-accent": accent } as CSSProperties;
}

function Head({ b, now, tz, children }: { b: Board; now: number; tz: string | null; children?: ReactNode }) {
  const city = cityName(b.ap) ?? b.ap.name;
  const code = b.ap.iata ?? b.ap.icao;
  const what = b.side === "arr" ? "Arrivals" : b.origin ? "Departures" : "Connections";
  return (
    <div className="tv-head">
      <b>
        {what} · <span className="tv-head-city">{city}</span>
        <span className="tv-head-code"> {code}</span>
      </b>
      {children}
      <span className="mono">{localClock(now, tz)}</span>
    </div>
  );
}

/** The stream's own flight in a line, for the card and the side panel. */
function MeLine({ b, tz }: { b: Board; tz: string | null }) {
  const t = b.me.t != null ? localClock(b.me.t, tz) : null;
  const text = b.origin ? `${b.me.callsign} departs ${t ?? "—"}` : b.me.status === "ON BLOCKS" || b.me.status === "LANDED" ? `${b.me.callsign} landed${t ? ` ${t}` : ""}` : `${b.me.callsign} lands ${t ?? "—"}`;
  return <div className="tv-me">{text}</div>;
}

/* ---------- G10: the board, full screen ---------- */

export function DeparturesBoard(p: TrafficViewProps) {
  const b = useBoard(p, 10);
  const tz = b.ap.tz;
  const city = (cityName(b.ap) ?? b.ap.name).toUpperCase();
  const style = p.look.style;
  return (
    <div className={`gv tv-board is-${style}`} style={boardStyle(p.f, style)} role="region" aria-label={`${b.side === "arr" ? "Arrivals" : "Departures"}, ${city}`}>
      {style === "brand" ? (
        <Head b={b} now={p.live?.last?.t ?? p.now} tz={tz} />
      ) : (
        <div className="tv-board-hd">
          <span>
            {b.side === "arr" ? "ARRIVALS" : "DEPARTURES"} · {city}
          </span>
          <small>{localClock(p.live?.last?.t ?? p.now, tz)}</small>
        </div>
      )}
      <Rows b={b} style={style} tz={tz} compact={false} />
    </div>
  );
}

/* ---------- G10b: the card over the sim ---------- */

export function ConnectionsCard(p: TrafficViewProps) {
  const b = useBoard(p, 6);
  const tz = b.ap.tz;
  const at = { "data-size": p.look.size, "data-pos": p.look.pos } as Record<string, string>;
  const style = p.look.style;
  return (
    <div className="gv gv-over" style={boardStyle(p.f, style)} {...at} role="region" aria-label={`${b.side === "arr" ? "Arrivals" : b.origin ? "Departures" : "Connections"} at ${b.ap.iata ?? b.ap.icao}`}>
      <div className={`gv-card tv-card is-${style}`}>
        <Head b={b} now={p.live?.last?.t ?? p.now} tz={tz} />
        <MeLine b={b} tz={tz} />
        <Rows b={{ ...b, rows: b.rows.filter((r) => !r.me) }} style={style} tz={tz} compact />
      </div>
    </div>
  );
}

/* ---------- G10c: the board beside a window for the game ---------- */

export function BoardWindow(p: TrafficViewProps) {
  const b = useBoard(p, 9);
  const tz = b.ap.tz;
  const style = p.look.style;
  return (
    <div className={`gv tv-win is-${style}`} style={boardStyle(p.f, style)} role="region" aria-label={`${b.side === "arr" ? "Arrivals" : "Departures"} at ${b.ap.iata ?? b.ap.icao}, with the game`}>
      <div className="gv-window" aria-hidden="true" />
      <div className="tv-win-panel">
        <Head b={b} now={p.live?.last?.t ?? p.now} tz={tz} />
        <Rows b={{ ...b, rows: b.rows.filter((r) => !r.me) }} style={style} tz={tz} compact />
      </div>
      <div className="tv-win-me">
        <MeLine b={b} tz={tz} />
      </div>
    </div>
  );
}

/* ---------- 1.17.4: the ending screen's connections ---------- */

/**
 * The departures where the flight ended (its connections), as a dot-matrix board under the game on
 * the ending screen: the traffic looks' rows, without the flight's own (the ticket beside it is that).
 */
export function EndConnections(p: Omit<TrafficViewProps, "look"> & { look?: Look }) {
  // 1.17.7: its side (connections, arrivals, or both in turn) and style from the ending's settings
  const lk = useMemo(() => p.look ?? look("ending"), [p.look]);
  // dot matrix takes 8 rows; the airline's and split-flaps' taller rows, 6
  const b = useBoard({ ...p, look: lk }, lk.style === "dot" ? 8 : 6, true);
  const tz = b.ap.tz;
  const city = (cityName(b.ap) ?? b.ap.name).toUpperCase();
  const style = lk.style;
  const what = b.side === "arr" ? "ARRIVALS" : b.origin ? "DEPARTURES" : "CONNECTIONS";
  return (
    <div className={`tv-end is-${style}`} style={style === "dot" ? undefined : boardStyle(p.f, style)} role="region" aria-label={`${what.toLowerCase()} at ${city}`}>
      <div className="tv-board-hd" key={b.side}>
        <span>
          {what} · {city}
        </span>
        <small>{localClock(p.live?.last?.t ?? p.now, tz)}</small>
      </div>
      <Rows b={{ ...b, rows: b.rows.filter((r) => !r.me) }} style={style} tz={tz} compact={style !== "dot"} />
    </div>
  );
}
