"use client";

import { useMemo, useState } from "react";
import { dur, flightNo, hhmm } from "@/lib/data/flight";
import type { FlightRow } from "@/lib/data/load";
import type { AirlineInfo } from "@/lib/data/types";
import { routeColor } from "@/lib/colors";
import { dateLabel, relDay, type Departure } from "@/lib/journey/dates";
import { cx } from "./ui";

type By = "next" | "out" | "duty" | "ground" | "block";
const COLS: { by: By; label: string; tip: string; num?: boolean; wide?: boolean }[] = [
  { by: "next", label: "Date", tip: "Soonest from today (UTC)" },
  { by: "out", label: "OUT – IN (Z)", tip: "Time of day of the first OUT", wide: true },
  { by: "duty", label: "Duty", tip: "Report to on-blocks after the last leg", num: true },
  { by: "ground", label: "Ground", tip: "Time on the ground between legs", num: true, wide: true },
  { by: "block", label: "Block", tip: "Gate to gate, all legs", num: true, wide: true },
];
const FIRST = 8;

const key = (d: Departure, by: By) => {
  const t = d.v.timed!;
  switch (by) {
    case "next":
      return d.at;
    case "out":
      return (t.start % 1440) * 10 + d.day / 10;
    case "duty":
      return t.duty;
    case "ground":
      return t.wait;
    case "block":
      return t.block;
  }
};

/**
 * Every date this journey runs in the coming week, as a sortable table with a timeline of the
 * legs (airline colours, gaps are time on the ground) on one UTC clock. Soonest first.
 */
export function JourneyTimings({
  deps,
  sel,
  onPick,
  rows,
  airlines,
  now,
}: {
  deps: Departure[];
  sel: Departure | null;
  onPick: (d: Departure) => void;
  rows: FlightRow[];
  airlines: Map<string, AirlineInfo>;
  now: number;
}) {
  const [by, setBy] = useState<By>("next");
  const [desc, setDesc] = useState(false);
  const [all, setAll] = useState(false);
  const list = useMemo(() => {
    const l = [...deps].sort((a, b) => key(a, by) - key(b, by) || a.at - b.at);
    return desc ? l.reverse() : l;
  }, [deps, by, desc]);
  // one clock for every row: minutes from 00:00Z of each row's departure day
  const axis = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of deps) {
      const t = d.v.timed!;
      lo = Math.min(lo, t.start % 1440);
      hi = Math.max(hi, (t.start % 1440) + t.end - t.start);
    }
    lo = Math.floor(lo / 60) * 60;
    hi = Math.max(lo + 180, Math.ceil(hi / 60) * 60);
    const step = hi - lo > 12 * 60 ? 240 : hi - lo > 6 * 60 ? 120 : 60;
    const ticks: number[] = [];
    for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) ticks.push(m);
    return { lo, span: hi - lo, ticks };
  }, [deps]);
  const pct = (m: number) => `${((m - axis.lo) / axis.span) * 100}%`;
  const shown = all ? list : list.slice(0, FIRST);
  const isSel = (d: Departure) => !!sel && sel.vi === d.vi && sel.day === d.day;

  const sortBy = (b: By) => {
    if (b === by) setDesc((x) => !x);
    else {
      setBy(b);
      setDesc(false);
    }
  };

  return (
    <div className="jr-tim">
      <p className="jr-tim-head">
        <span className="ctl-label">Timings</span>
        <span className="small muted">
          {deps.length} departure{deps.length === 1 ? "" : "s"} in the next 7 days · pick one for the legs below
        </span>
      </p>
      <div className="jr-tim-wrap">
        <table className="tbl jr-tim-tbl">
          <thead>
            <tr>
              {COLS.slice(0, 2).map((c) => (
                <Th key={c.by} c={c} by={by} desc={desc} onSort={sortBy} />
              ))}
              <th className="jr-tl-h" aria-label="Timeline, UTC">
                <span className="jr-ticks" aria-hidden="true">
                  {axis.ticks.map((m) => (
                    <i key={m} style={{ left: pct(m) }}>
                      {hhmm(m)?.slice(0, 2)}
                    </i>
                  ))}
                </span>
              </th>
              {COLS.slice(2).map((c) => (
                <Th key={c.by} c={c} by={by} desc={desc} onSort={sortBy} />
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => {
              const t = d.v.timed!;
              const s0 = t.start % 1440;
              const rel = relDay(d.at, now);
              const extra = Math.floor(t.end / 1440) - Math.floor(t.start / 1440);
              return (
                <tr key={`${d.vi}-${d.day}`} className={cx(isSel(d) && "active")} onClick={() => onPick(d)}>
                  <td>
                    <button type="button" className="row-btn jr-tim-date" aria-pressed={isSel(d)} onClick={(e) => (e.stopPropagation(), onPick(d))}>
                      {dateLabel(d.at)}
                      {rel && <small>{rel}</small>}
                    </button>
                    <span className="jr-tim-sub">
                      {hhmm(t.start)}–{hhmm(t.end)}Z
                    </span>
                  </td>
                  <td className="jr-wide">
                    {hhmm(t.start)}–{hhmm(t.end)}
                    {extra > 0 && <sup className="jr-plus">+{extra}</sup>}
                  </td>
                  <td className="jr-tl">
                    <span className="jr-gantt">
                      {axis.ticks.map((m) => (
                        <b key={m} style={{ left: pct(m) }} aria-hidden="true" />
                      ))}
                      {t.legs.map((l, i) => {
                        const f = rows[l.f];
                        const a = airlines.get(f?.al ?? "");
                        const x = s0 + l.t0 - t.start;
                        return (
                          <i
                            key={i}
                            style={{ left: pct(x), width: pct(axis.lo + l.t1 - l.t0), ["--c" as string]: routeColor(a) }}
                            title={`${l.o} → ${l.d} · ${f ? flightNo(f, a?.iata ?? null) : ""} · ${hhmm(l.t0)}–${hhmm(l.t1)}Z`}
                          />
                        );
                      })}
                    </span>
                  </td>
                  <td className="num">{dur(t.duty)}</td>
                  <td className="num jr-wide">{dur(t.wait)}</td>
                  <td className="num jr-wide">{dur(t.block)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length > FIRST && (
        <button type="button" className="btn jr-tim-more" onClick={() => setAll((x) => !x)}>
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </div>
  );
}

function Th({ c, by, desc, onSort }: { c: (typeof COLS)[number]; by: By; desc: boolean; onSort: (b: By) => void }) {
  const on = by === c.by;
  return (
    <th className={cx(c.num && "num", c.wide && "jr-wide")} aria-sort={on ? (desc ? "descending" : "ascending") : "none"}>
      <button type="button" className="th-sort" title={c.tip} onClick={() => onSort(c.by)}>
        {c.label}
        <span className="th-arrow" aria-hidden="true">
          {on ? (desc ? "▼" : "▲") : ""}
        </span>
      </button>
    </th>
  );
}
