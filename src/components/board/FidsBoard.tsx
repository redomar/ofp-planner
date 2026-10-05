"use client";

import type { CSSProperties } from "react";
import { cityName, flightNo } from "@/lib/data/flight";
import type { Airport } from "@/lib/data/load";
import type { AirlineInfo } from "@/lib/data/types";
import { routeColor } from "@/lib/colors";
import { remark, type Movement, type Side } from "@/lib/board/board";
import { FlapCode } from "../FlapCode";
import { PLANE } from "./GateScreen";

/**
 * An airport flight information display: dark, amber times, split-flap codes, one row per
 * movement with its remarks from the clock (boarding, final call, departed) and how late the
 * flight usually runs. Rows open the gate screen.
 */
export function FidsBoard({
  rows,
  side,
  airport,
  airports,
  airlines,
  now,
  fmt,
  clock,
  hover,
  onHover,
  onPick,
}: {
  rows: Movement[];
  side: Side;
  airport: Airport;
  airports: Map<string, Airport>;
  airlines: Map<string, AirlineInfo>;
  now: number;
  /** Clock time for the board (local or UTC). */
  fmt: (ms: number) => string;
  clock: string;
  hover: string | null;
  onHover: (other: string | null) => void;
  onPick: (m: Movement) => void;
}) {
  const where = side === "dep" ? "To" : "From";
  return (
    <section className="fids" aria-label={`${side === "dep" ? "Departures" : "Arrivals"}, ${airport.name}`}>
      <header className="fids-head">
        <svg className="fids-icon" viewBox="0 0 64 64" aria-hidden="true" style={{ transform: side === "dep" ? "rotate(45deg)" : "rotate(135deg)" }}>
          <path d={PLANE} />
        </svg>
        <h2>{side === "dep" ? "Departures" : "Arrivals"}</h2>
        <span className="fids-ap">{cityName(airport) ?? airport.name}</span>
        <b className="fids-clock mono">{clock}</b>
      </header>
      {rows.length ? (
        <table className="fids-tbl">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Flight</th>
              <th scope="col">{where}</th>
              <th scope="col" className="fids-ac">
                Aircraft
              </th>
              <th scope="col">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const al = airlines.get(m.f.al);
              const other = airports.get(m.other);
              const r = remark(m, side, now, fmt);
              return (
                <tr
                  key={m.key}
                  className={hover === m.other ? "is-hover" : undefined}
                  onMouseEnter={() => onHover(m.other)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onPick(m)}
                >
                  <td className="mono fids-time">
                    {fmt(m.ms)}
                    {!m.sched && (
                      <small className="fids-typ" title="Typical time from tracking (no published schedule)">
                        typ
                      </small>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="fids-flight"
                      style={{ "--al": routeColor(al) } as CSSProperties}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPick(m);
                      }}
                      aria-label={`${flightNo(m.f, al?.iata ?? null)}, ${al?.name ?? m.f.al}, ${where.toLowerCase()} ${other ? (cityName(other) ?? other.name) : m.other} at ${fmt(m.ms)}: ${r.text}. Open the gate screen.`}
                    >
                      <svg viewBox="0 0 64 64" aria-hidden="true">
                        <path d={PLANE} />
                      </svg>
                      <span className="mono">{flightNo(m.f, al?.iata ?? null)}</span>
                      <small>{al?.name ?? m.f.al}</small>
                    </button>
                  </td>
                  <td className="fids-place">
                    <FlapCode key={m.other} code={other?.iata ?? m.other} label={other?.iata ?? m.other} />
                    <span>{other ? (cityName(other) ?? other.name) : m.other}</span>
                  </td>
                  <td className="mono fids-ac">{m.f.types[0] ?? ""}</td>
                  <td className={`fids-rmk fids-${r.tone}`}>{r.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="fids-empty">No {side === "dep" ? "departures" : "arrivals"} in this window.</p>
      )}
    </section>
  );
}
