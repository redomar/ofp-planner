"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AirlineInfo } from "@/lib/data/types";
import { airportLabel, daysLabel, dur, flightNo, hhmm, localHHMM, tzLabel } from "@/lib/data/flight";
import type { Airport } from "@/lib/data/load";
import type { Row } from "@/lib/data/query";
import { pushHistory, setReady, toggleFavourite, useSaved } from "@/lib/saved";
import { defaultChoice, flightDispatch, simbriefUrl, typeChoices, useAirframes } from "@/lib/simbrief";
import { ReplayFlapCode } from "./FlapCode";
import { RouteMap } from "./RouteMap";
import { Badge, Tip, V } from "./ui";
import { GLOSSARY } from "@/lib/glossary";
import { routeColor } from "@/lib/colors";

/** The selected flight: route, map, OOOI times, facts, and dispatch to SimBrief. */
export function FlightCard({
  row,
  airline,
  airports,
  onContinue,
  onPlace,
}: {
  row: Row;
  airline: AirlineInfo | undefined;
  airports: Map<string, Airport> | null;
  /** Roll an onward flight from this flight's destination. */
  onContinue?: () => void;
  /** Set the origin/destination filter to an airport. */
  onPlace?: (side: "dep" | "arr", icao: string) => void;
}) {
  const { f, nm, block } = row;
  const from = airports?.get(f.o);
  const to = airports?.get(f.d);
  const saved = useSaved();
  const frames = useAirframes();
  const fav = saved?.favourites.some((x) => x.id === f.id) ?? false;
  const choices = typeChoices(f, frames);
  // Parents key this card by flight id, so the choice resets to the default per flight.
  const [choice, setChoice] = useState<string | null>(null);
  const dflt = defaultChoice(f, frames);
  const picked = choices.find((c) => c.value === (choice ?? dflt)) ?? choices[0];
  const url = simbriefUrl(flightDispatch(f, picked.sbType));
  const color = routeColor(airline);
  const iata = airline?.iata ?? null;

  useEffect(() => {
    pushHistory(f);
  }, [f]);

  return (
    <article className="fcard" aria-label={`Flight ${flightNo(f, iata)}`} style={{ ["--al" as string]: color }}>
      <header className="fcard-head">
        <span className="fcard-bar" aria-hidden="true" />
        <div className="fcard-title">
          <p className="fcard-airline">
            {airline?.name ?? f.al}
            {f.op !== f.al && (
              <Tip tip={`Operated by ${f.op}, the airline whose code is filed with ATC.`} title="Operator">
                <span className="muted"> · op. {f.op}</span>
              </Tip>
            )}
          </p>
          <h2 className="fcard-no">
            <span>{flightNo(f, iata)}</span>
            <small>
              <Tip tip={GLOSSARY.callsign} title="Callsign">
                <span className="mono">{f.cs ?? `${f.op}${f.fn}`}</span>
              </Tip>
              {!f.cs && <span className="muted"> (no filed callsign in the snapshot)</span>}
            </small>
          </h2>
        </div>
        <button
          type="button"
          className={`btn btn-icon fav${fav ? " on" : ""}`}
          aria-pressed={fav}
          aria-label={fav ? "Remove from favourites" : "Add to favourites"}
          title={fav ? "Favourite" : "Add to favourites"}
          onClick={() => toggleFavourite(f)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
          </svg>
        </button>
      </header>

      <div className="fcard-route">
        <End a={from} icao={f.o} side="dep" onPlace={onPlace} sched={f.std} label="Departs" />
        <div className="fcard-mid" aria-hidden="true">
          <span className="mono">{dur(block?.min) ?? "—"}</span>
          <svg viewBox="0 0 100 10" preserveAspectRatio="none">
            <path d="M2 5H98" />
            <path d="M92 1l6 4-6 4" />
          </svg>
          <span className="mono">{nm != null ? `${nm.toLocaleString("en-GB")} NM` : "—"}</span>
        </div>
        <End a={to} icao={f.d} side="arr" onPlace={onPlace} sched={f.sta} label="Arrives" />
      </div>

      {from && to && (
        <RouteMap
          routes={[{ key: f.id, from, to, color, active: true }]}
          height={230}
          label={`Map: great-circle route from ${airportLabel(from)} to ${airportLabel(to)}, ${nm ?? "?"} nautical miles.`}
        />
      )}

      <Oooi row={row} from={from} to={to} />

      <dl className="facts">
        <div>
          <dt>
            <Tip tip={GLOSSARY.types} title="Aircraft">
              Aircraft
            </Tip>
          </dt>
          <dd className="mono">{f.types.length ? f.types.join(" · ") : <V v={null} w={5} />}</dd>
        </div>
        <div>
          <dt>
            <Tip tip={GLOSSARY.days} title="Operates">
              Operates
            </Tip>
          </dt>
          <dd>{daysLabel(f.days) ?? <span className="muted">Days not in snapshot</span>}</dd>
        </div>
        <div>
          <dt>
            <Tip tip={GLOSSARY.block} title="Block time">
              Block
            </Tip>
          </dt>
          <dd>
            <span className="mono">{dur(block?.min) ?? "—"}</span>{" "}
            {block && block.source !== "scheduled" && <Badge tone={block.source === "estimated" ? "amber" : "blue"}>{block.source}</Badge>}
          </dd>
        </div>
        <div>
          <dt>
            <Tip tip={GLOSSARY.distance} title="Distance">
              Distance
            </Tip>
          </dt>
          <dd className="mono">{nm != null ? `${nm.toLocaleString("en-GB")} NM` : "—"}</dd>
        </div>
      </dl>

      <div className="dispatch">
        <label className="dispatch-type">
          <span className="ctl-label">Aircraft for SimBrief</span>
          <select className="ctl-input" value={picked.value} onChange={(e) => setChoice(e.target.value)}>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <div className="dispatch-actions">
          <a className="btn btn-primary" href={url} target="_blank" rel="noopener noreferrer">
            Open in SimBrief
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M4 2h6v6M10 2L3 9" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <Link className="btn" href={`/brief?f=${encodeURIComponent(f.id)}`} onClick={() => setReady(f, null, picked.value)}>
            Ready to sim · weather
          </Link>
          {onContinue && (
            <button type="button" className="btn" onClick={onContinue} title={`Roll an onward flight from ${f.d}`}>
              Next leg from {to?.iata ?? f.d}
            </button>
          )}
        </div>
        <CopyLink url={url} />
      </div>
    </article>
  );
}

function End({
  a,
  icao,
  side,
  sched,
  label,
  onPlace,
}: {
  a: Airport | undefined;
  icao: string;
  side: "dep" | "arr";
  sched: number | null;
  label: string;
  onPlace?: (side: "dep" | "arr", icao: string) => void;
}) {
  return (
    <div className={`fcard-end ${side}`}>
      <span className="ctl-label">{label}</span>
      <ReplayFlapCode code={icao} label={a ? `${icao}, ${airportLabel(a)}` : icao} />
      <p className="fcard-place">
        {a?.country && <img className="flag" src={`/flags/${a.country.toLowerCase()}.svg`} alt="" width="16" height="12" />}
        <span>
          {a ? airportLabel(a) : <V v={null} w={12} />}
          {a?.iata && <span className="mono muted"> {a.iata}</span>}
        </span>
      </p>
      <p className="fcard-time">
        <span className="mono">{hhmm(sched) ? `${hhmm(sched)}Z` : "—"}</span>
        {sched != null && a?.tz && (
          <span className="muted">
            {" "}
            {localHHMM(sched, a.tz)} local ({tzLabel(a.tz)})
          </span>
        )}
      </p>
      {onPlace && (
        <button type="button" className="linkish" onClick={() => onPlace(side, icao)}>
          {side === "dep" ? "All flights from here" : "All flights to here"}
        </button>
      )}
    </div>
  );
}

/**
 * Scheduled vs typical OOOI times. Scheduled gate times line up with OUT and IN; the
 * observed medians fill all four where tracking data had them.
 */
function Oooi({ row, from, to }: { row: Row; from: Airport | undefined; to: Airport | undefined }) {
  const { f } = row;
  const cols = [
    ["OUT", GLOSSARY.out, f.std, f.out, from],
    ["OFF", GLOSSARY.off, null, f.off, from],
    ["ON", GLOSSARY.on, null, f.on, to],
    ["IN", GLOSSARY.in, f.sta, f.in, to],
  ] as const;
  const anyObs = f.out != null || f.off != null || f.on != null || f.in != null;
  const cell = (v: number | null, a: Airport | undefined) =>
    v == null ? (
      <span className="muted" aria-label="not available">
        —
      </span>
    ) : (
      <>
        <span className="mono">{hhmm(v)}Z</span>
        {a?.tz && <small className="muted">{localHHMM(v, a.tz)} LT</small>}
      </>
    );
  return (
    <div className="oooi">
      <table>
        <caption className="sr-only">Scheduled and typical OUT, OFF, ON and IN times</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Time</span>
            </th>
            {cols.map(([k, tip]) => (
              <th scope="col" key={k}>
                <Tip tip={tip} title={k}>
                  {k}
                </Tip>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">
              <Tip tip={GLOSSARY.scheduled} title="Scheduled">
                Scheduled
              </Tip>
            </th>
            {cols.map(([k, , s, , a]) => (
              <td key={k} className={k === "OFF" || k === "ON" ? "na" : undefined}>
                {k === "OFF" || k === "ON" ? (
                  <span className="muted" title="Airlines publish gate times only">
                    gate only
                  </span>
                ) : (
                  cell(s, a)
                )}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">
              <Tip tip={GLOSSARY.typical} title="Typical">
                Typical
              </Tip>
            </th>
            {cols.map(([k, , , o, a]) => (
              <td key={k}>{cell(o, a)}</td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="oooi-note">
        {anyObs ? `Typical = median of ${f.samples} tracked ${f.samples === 1 ? "flight" : "flights"}.` : "No tracked times for this flight in the snapshot."}{" "}
        All times UTC (Z) with local time (LT).
      </p>
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <p className="dispatch-link">
      <span className="mono" title={url}>
        {url.replace("https://", "")}
      </span>
      <button
        type="button"
        className="chip"
        onClick={() =>
          navigator.clipboard?.writeText(url).then(
            () => {
              setDone(true);
              setTimeout(() => setDone(false), 1400);
            },
            () => undefined,
          )
        }
      >
        {done ? "Copied" : "Copy link"}
      </button>
    </p>
  );
}
