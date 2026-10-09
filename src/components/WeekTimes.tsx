import { DAY_NAMES, hhmm, plannedOut, weekTimes, type WeekDay } from "@/lib/data/flight";
import type { FlightRow } from "@/lib/data/load";
import type { WeekStyle } from "@/lib/display";
import { WeekStrip } from "./badges";
import { cx } from "./ui";

/**
 * A flight's times through the week, for flights whose times change by weekday (the flight
 * card under its OOOI table). `f.day` is the day the card is for; its row is highlighted.
 * Styles (Settings → Display): a row per day, rows grouped by timetable, or a timeline.
 * The tabs style is DayTabs, which drives the OOOI table above instead.
 */
export function WeekTimes({ f, style }: { f: FlightRow; style: Exclude<WeekStyle, "tabs"> }) {
  const week = weekTimes(f).filter((w) => w.operates);
  const sched = week.some((w) => w.f.std != null);
  return (
    <section className="week" aria-label="Times by day">
      <h3 className="week-title">Times by day</h3>
      {style === "table" ? <ByDay week={week} sched={sched} cur={f.day} /> : style === "grouped" ? <Grouped week={week} sched={sched} cur={f.day} /> : <Timeline week={week} cur={f.day} />}
      <p className="oooi-note">
        Times UTC.{sched ? " STD/STA scheduled, OUT/OFF/ON/IN typical, Usually = minutes late off-block (′ = min)." : ""} Typical = median of that weekday’s tracked flights
        {week.some((w) => w.seen != null && w.seen < 2) ? "; with fewer than two, the flight’s usual times" : ""}.
        {!sched && " No published schedule for this flight."}
      </p>
    </section>
  );
}

const T = ({ v }: { v: number | null }) => (v == null ? <span className="muted">—</span> : <span className="mono">{hhmm(v)}</span>);

/** How late it usually leaves against the schedule (typical OUT − STD). */
function Late({ f }: { f: FlightRow }) {
  if (f.out == null || f.std == null) return <span className="muted">—</span>;
  const d = ((f.out - f.std + 720 + 1440) % 1440) - 720;
  return <span className="mono">{d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0"}′</span>;
}
const Seen = ({ n }: { n: number | null }) => (n == null ? <span className="muted">—</span> : <span className="mono">{n}×</span>);

function ByDay({ week, sched, cur }: { week: WeekDay[]; sched: boolean; cur: number | undefined }) {
  const head = (k: string, title: string, opt = false) => (
    <th scope="col" className={cx(opt && "wk-opt")} title={title}>
      {k}
    </th>
  );
  return (
    <div className="oooi week-tbl">
      <table>
        <caption className="sr-only">Scheduled (STD, STA) and typical (OUT, OFF, ON, IN) times for each day of the week</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Day</span>
            </th>
            {sched && head("STD", "Scheduled departure (gate)")}
            {sched && head("STA", "Scheduled arrival (gate)")}
            {head("OUT", "Typical off-block")}
            {head("OFF", "Typical take-off", true)}
            {head("ON", "Typical landing", true)}
            {head("IN", "Typical on-block")}
            {sched && head("Usually", "Typical OUT against STD, in minutes")}
            {head("Seen", "Tracked flights that weekday")}
          </tr>
        </thead>
        <tbody>
          {week.map(({ day, f, seen }) => (
            <tr key={day} className={cx(day === cur && "cur")} aria-current={day === cur ? "date" : undefined}>
              <th scope="row">{DAY_NAMES[day - 1]}</th>
              {sched && (
                <td>
                  <T v={f.std} />
                </td>
              )}
              {sched && (
                <td>
                  <T v={f.sta} />
                </td>
              )}
              <td>
                <T v={f.out} />
              </td>
              <td className="wk-opt">
                <T v={f.off} />
              </td>
              <td className="wk-opt">
                <T v={f.on} />
              </td>
              <td>
                <T v={f.in} />
              </td>
              {sched && (
                <td>
                  <Late f={f} />
                </td>
              )}
              <td>
                <Seen n={seen} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Days with the same times share a row, like an airline timetable. */
function Grouped({ week, sched, cur }: { week: WeekDay[]; sched: boolean; cur: number | undefined }) {
  // with a timetable, days group by their scheduled times (typical = the middle of those days); else by identical times
  const key = (f: FlightRow) => (sched ? [f.std, f.sta] : [f.std, f.sta, f.out, f.off, f.on, f.in]).join(",");
  const groups: { days: number[]; fs: FlightRow[]; seen: number | null }[] = [];
  for (const w of week) {
    const g = groups.find((g) => key(g.fs[0]) === key(w.f));
    if (g) {
      g.days.push(w.day);
      g.fs.push(w.f);
      if (w.seen != null) g.seen = (g.seen ?? 0) + w.seen;
    } else groups.push({ days: [w.day], fs: [w.f], seen: w.seen });
  }
  const mid = (fs: FlightRow[], k: "out" | "off" | "on" | "in") => {
    const v = fs.map((f) => f[k]).filter((x): x is number => x != null).sort((a, b) => a - b);
    return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
  };
  return (
    <div className="oooi week-tbl week-grp">
      <table>
        <caption className="sr-only">Times by day, days with the same schedule together</caption>
        <thead>
          <tr>
            <th scope="col">Days</th>
            {sched && <th scope="col">STD → STA</th>}
            <th scope="col">Typical OUT → IN</th>
            {sched && <th scope="col">Usually</th>}
            <th scope="col">Seen</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(({ days, fs, seen }) => {
            const f = fs[0];
            const out = mid(fs, "out") ?? mid(fs, "off");
            const inn = mid(fs, "in") ?? mid(fs, "on");
            return (
              <tr key={days.join()} className={cx(cur != null && days.includes(cur) && "cur")}>
                <th scope="row">
                  <WeekStrip days={days} />
                </th>
                {sched && (
                  <td>
                    <T v={f.std} /> → <T v={f.sta} />
                  </td>
                )}
                <td>
                  <T v={out} /> → <T v={inn} />
                </td>
                {sched && (
                  <td>
                    <Late f={{ ...f, out }} />
                  </td>
                )}
                <td>
                  <Seen n={seen} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Each day as a bar on one UTC axis: outline = scheduled OUT → IN, solid = typical, ticks at OFF and ON. */
function Timeline({ week, cur }: { week: WeekDay[]; cur: number | undefined }) {
  const ref = plannedOut(week[0].f) ?? 0;
  // minutes relative to the first day's departure, so a week that crosses midnight still lines up
  const rel = (t: number | null) => (t == null ? null : ((t - ref + 720 + 1440) % 1440) - 720);
  const ends = (f: FlightRow) => {
    const a = rel(f.out ?? f.std ?? (f.off != null ? f.off - 12 : null));
    const z = rel(f.in ?? f.sta ?? (f.on != null ? f.on + 6 : null));
    return [a, z != null && a != null && z < a ? z + 1440 : z] as const;
  };
  const all = week.flatMap(({ f }) => [rel(f.std), rel(f.sta), ...ends(f)]).filter((x): x is number => x != null);
  const lo = Math.floor((Math.min(...all) - 10 + ref) / 30) * 30 - ref;
  const hi = Math.ceil((Math.max(...all) + 10 + ref) / 30) * 30 - ref;
  const x = (m: number) => `${(((m - lo) / (hi - lo)) * 100).toFixed(2)}%`;
  const ticks: number[] = [];
  const step = hi - lo > 300 ? 60 : 30;
  for (let m = Math.ceil((lo + ref) / step) * step - ref; m <= hi; m += step) if ((m - lo) / (hi - lo) > 0.04 && (hi - m) / (hi - lo) > 0.06) ticks.push(m);
  const bar = (a: number | null, z: number | null, cls: string) =>
    a != null && z != null ? <span className={cls} style={{ left: x(a), width: `calc(${x(z)} - ${x(a)})` }} /> : null;
  return (
    <>
    <div className="week-tl" role="table" aria-label="Times by day on one UTC axis">
      <div className="week-tl-row week-tl-axis" role="row">
        <span role="columnheader">
          <span className="sr-only">Day</span>
        </span>
        <span className="week-tl-track" aria-hidden="true">
          {ticks.map((m) => (
            <span key={m} className="week-tl-t mono" style={{ left: x(m) }}>
              {hhmm(m + ref)}
            </span>
          ))}
        </span>
        <span role="columnheader">{week.some((w) => w.f.std != null) ? "STD" : "OUT"}</span>
      </div>
      {week.map(({ day, f }) => {
        const [a, z] = ends(f);
        const std = rel(f.std);
        const sta = rel(f.sta);
        return (
          <div key={day} role="row" className={cx("week-tl-row", day === cur && "cur")}>
            <span role="rowheader" className="week-tl-day">
              {DAY_NAMES[day - 1]}
            </span>
            <span className="week-tl-track" role="cell" aria-label={`Typical ${hhmm(f.out ?? f.off) ?? "unknown"} to ${hhmm(f.in ?? f.on) ?? "unknown"} UTC`}>
              {bar(std, sta != null && std != null && sta < std ? sta + 1440 : sta, "week-tl-sched")}
              {bar(a, z, "week-tl-obs")}
              {[f.off, f.on].map((t, i) => {
                let r = rel(t);
                if (r != null && a != null && r < a) r += 1440;
                return r != null ? <span key={i} className="week-tl-tick" style={{ left: x(r) }} /> : null;
              })}
            </span>
            <span role="cell" className="mono">
              {hhmm(f.std ?? plannedOut(f)) ?? "—"}
            </span>
          </div>
        );
      })}
    </div>
      <p className="oooi-note">
        <span className="week-key week-tl-sched" aria-hidden="true" /> scheduled OUT → IN · <span className="week-key week-tl-obs" aria-hidden="true" /> typical OUT → IN, ticks at OFF and
        ON.
      </p>
    </>
  );
}

/** A3: one tab per operating day above the OOOI table, which then shows that day's times. */
export function DayTabs({ f, day, onPick }: { f: FlightRow; day: number | undefined; onPick: (d: number) => void }) {
  const week = weekTimes(f).filter((w) => w.operates);
  return (
    <div className="week-tabs" role="group" aria-label="Times for which day">
      {week.map(({ day: d, f: x }) => (
        <button key={d} type="button" className={cx("week-tab", d === day && "on")} aria-pressed={d === day} onClick={() => onPick(d)}>
          <b>{DAY_NAMES[d - 1]}</b>
          <span className="mono">{hhmm(plannedOut(x)) ?? "—"}</span>
        </button>
      ))}
    </div>
  );
}
