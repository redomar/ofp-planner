"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { AirlineInfo } from "@/lib/data/types";
import { DAY_NAMES, airportLabel, blockTime, dur, flightNo, hhmm, localHHMM, onDay, varies } from "@/lib/data/flight";
import type { Airport } from "@/lib/data/load";
import type { Row } from "@/lib/data/query";
import { cleanFn, setFnOverride } from "@/lib/fnoverride";
import { pushHistory, setInGroup, setReady, toggleFavourite, useSaved } from "@/lib/saved";
import { defaultChoice, flightDispatch, simbriefUrl, typeChoices, useAirframes } from "@/lib/simbrief";
import { TypeBadge, WeekStrip, freqLabel } from "./badges";
import { RouteHead } from "./RouteHead";
import { RouteMap } from "./RouteMap";
import { Badge, Tip, V } from "./ui";
import { GLOSSARY } from "@/lib/glossary";
import { routeColor } from "@/lib/colors";
import { useDisplay } from "@/lib/display";
import { DayTabs, WeekTimes } from "./WeekTimes";

/** The selected flight: route, map, OOOI times, facts, and dispatch to SimBrief. */
export function FlightCard({
  row,
  airline,
  airports,
  onContinue,
  onPlace,
  onClose,
  closeLabel = "Close this flight",
  context = "finder",
  extra,
  placeHref,
}: {
  row: Row;
  airline: AirlineInfo | undefined;
  airports: Map<string, Airport> | null;
  /** Roll an onward flight from this flight's destination. */
  onContinue?: () => void;
  /** Set the origin/destination filter to an airport. */
  onPlace?: (side: "dep" | "arr", icao: string) => void;
  /** Deselect the flight (back to the empty state). */
  onClose?: () => void;
  closeLabel?: string;
  /** Where the card is shown: the finder links on to the brief, the brief links back to the finder. */
  context?: "finder" | "brief";
  /** Extra content at the end of the dispatch area (the brief's next-leg controls). */
  extra?: ReactNode;
  /** Makes each airport a link (the brief: to the finder with that airport as the origin). */
  placeHref?: (icao: string) => string;
}) {
  const { f, nm, block } = row;
  const from = airports?.get(f.o);
  const to = airports?.get(f.d);
  const saved = useSaved();
  const frames = useAirframes();
  const fav = saved?.favourites.some((x) => x.id === f.id) ?? false;
  const favIn = saved ? saved.favourites.filter((x) => x.id === f.id && x.group && saved.groups.includes(x.group)).map((x) => x.group!) : [];
  const choices = typeChoices(f, frames);
  // Parents key this card by flight id, so the choice resets to the default per flight.
  const [choice, setChoice] = useState<string | null>(null);
  const dflt = defaultChoice(f, frames);
  const picked = choices.find((c) => c.value === (choice ?? dflt)) ?? choices[0];
  const url = simbriefUrl(flightDispatch(f, picked.sbType));
  const color = routeColor(airline);
  const iata = airline?.iata ?? null;

  // record each flight once when it's shown (not on every re-render of the same flight)
  const fRef = useRef(f);
  useEffect(() => {
    fRef.current = f;
  });
  useEffect(() => {
    pushHistory(fRef.current);
  }, [f.id]);
  // Times through the week (flights whose times change by weekday): a section under the OOOI
  // table, or day tabs that switch the table (Settings → Display). Tabs start on the card's day.
  const display = useDisplay();
  const weekVaries = varies(f);
  const [tab, setTab] = useState<number | null>(null);
  const shown: Row = tab != null && tab !== f.day ? { ...row, f: onDay(f, tab), block: blockTime(onDay(f, tab), nm) } : row;

  // Folded: only the header shows (it stays pinned while the card scrolls), so the table behind is visible.
  const [folded, setFolded] = useState(false);
  const bodyId = useId();
  const toggleFold = () => setFolded((v) => !v);

  return (
    <article className="fcard" aria-label={`Flight ${flightNo(f, iata)}`} style={{ ["--al" as string]: color }}>
      <header
        className="fcard-head"
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("button, a, input, select, form")) toggleFold();
        }}
        title={folded ? "Show the flight details" : "Hide the flight details"}
      >
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
            <FnLine f={f} iata={iata} />
          </h2>
        </div>
        <button
          type="button"
          className={`btn btn-icon fav${fav ? " on" : ""}`}
          aria-pressed={fav}
          aria-label={fav ? (favIn.length > 1 ? `Remove from favourites (all ${favIn.length} groups)` : "Remove from favourites") : "Add to favourites"}
          title={fav ? (favIn.length > 1 ? `Favourite, in ${favIn.length} groups` : "Favourite") : "Add to favourites"}
          onClick={() => toggleFavourite(f)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
          </svg>
        </button>
        <button
          type="button"
          className="btn btn-icon fold"
          aria-expanded={!folded}
          aria-controls={bodyId}
          aria-label={folded ? "Show the flight details" : "Hide the flight details"}
          onClick={toggleFold}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d={folded ? "M2 5l5 5 5-5" : "M2 9l5-5 5 5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        {onClose && (
          <button type="button" className="btn btn-icon" aria-label={closeLabel} title={closeLabel} onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </header>

      <div className="fcard-body" id={bodyId} hidden={folded}>
      <RouteHead f={f} from={from} to={to} blockMin={block?.min ?? null} nm={nm} onPlace={onPlace} placeHref={placeHref} />

      {from && to && (
        <RouteMap
          routes={[{ key: f.id, from, to, color, active: true }]}
          height={250}
          label={`Map: great-circle route from ${airportLabel(from)} to ${airportLabel(to)}, ${nm ?? "?"} nautical miles.`}
        />
      )}

      {weekVaries && display.week === "tabs" && <DayTabs f={f} day={shown.f.day} onPick={setTab} />}
      <Oooi row={shown} from={from} to={to} />
      {weekVaries && display.week !== "tabs" && <WeekTimes f={f} style={display.week} />}

      <dl className="facts">
        <div>
          <dt>
            <Tip tip={GLOSSARY.types} title="Aircraft">
              Aircraft
            </Tip>
          </dt>
          <dd className="types-dd">
            {f.types.length ? f.types.map((t) => <TypeBadge key={t} type={t} airline={airline} guessed={f.typeGuessed} />) : <V v={null} w={5} />}
            {f.typeGuessed && <small className="muted"> airline’s usual type</small>}
          </dd>
        </div>
        <div>
          <dt>
            <Tip tip={GLOSSARY.days} title="Operates">
              Operates
            </Tip>
          </dt>
          <dd className="days-dd">
            {f.days.length ? (
              <>
                <WeekStrip days={f.days} />
                <span className="mono">{freqLabel(f.days)}</span>
              </>
            ) : (
              <span className="muted">Days not in snapshot</span>
            )}
          </dd>
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
          <div className="dispatch-more">
            {context === "finder" ? (
              <Link className="btn" href={`/brief?f=${encodeURIComponent(f.id)}`} onClick={() => setReady(f, null, picked.value)}>
                Open brief · weather →
              </Link>
            ) : (
              <Link className="btn" href={`/?al=${f.al}&dep=${f.o}&arr=${f.d}&f=${encodeURIComponent(f.id)}`}>
                ← Back to finder
              </Link>
            )}
            <Link className="btn" href={`/board?tab=gate&f=${encodeURIComponent(f.id)}`}>
              Gate screen
            </Link>
            <Link className="btn" href={`/logbook?f=${encodeURIComponent(f.id)}`} title="Open the logbook form prefilled with this flight (nothing is saved until you submit)">
              Log this flight
            </Link>
            {onContinue && (
              <button type="button" className="btn" onClick={onContinue} title={`Roll an onward flight from ${f.d}`}>
                Next leg from {to?.iata ?? f.d}
              </button>
            )}
          </div>
        </div>
        <CopyLink url={url} />
        {fav && saved && saved.groups.length > 0 && (
          <div className="fav-group" role="group" aria-label="Favourite groups">
            <span className="fav-group-star" aria-hidden="true">
              ★
            </span>
            <span className="ctl-label">In groups</span>
            {saved.groups.map((g) => {
              const on = favIn.includes(g);
              return (
                <button key={g} type="button" className={`chip fav-group-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setInGroup(f, g, !on)}>
                  {on && <span aria-hidden="true">✓ </span>}
                  {g}
                </button>
              );
            })}
            {favIn.length > 1 && <span className="badge b-amber">shared by {favIn.length}</span>}
          </div>
        )}
        {extra}
      </div>
      </div>
    </article>
  );
}

/**
 * Under the flight number: the ATC callsign, and for flights the open data only knows by
 * callsign, a way to add (or edit) the marketing flight number. Kept per callsign in this browser.
 */
function FnLine({ f, iata }: { f: Row["f"]; iata: string | null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState(false);
  const prefix = iata ?? f.al;
  const canEdit = !!f.cs && (!f.fn || f.fnUser);
  const save = (v: string | null) => {
    if (v === null) {
      setFnOverride(f.op, f.cs!, null);
      setEditing(false);
      return;
    }
    const n = cleanFn(v);
    if (!n) return setBad(true);
    setFnOverride(f.op, f.cs!, n);
    setEditing(false);
  };
  if (editing)
    return (
      <form
        className="fn-edit"
        onSubmit={(e) => {
          e.preventDefault();
          save(draft);
        }}
      >
        <span className="mono fn-prefix" aria-hidden="true">
          {prefix}
        </span>
        <input
          className="ctl-input mono"
          value={draft}
          autoFocus
          inputMode="text"
          maxLength={8}
          placeholder="1016"
          aria-label={`Flight number for ${f.cs}, after ${prefix}`}
          aria-invalid={bad || undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setBad(false);
          }}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        />
        <button type="submit" className="chip">
          Save
        </button>
        {f.fnUser && (
          <button type="button" className="chip" onClick={() => save(null)}>
            Remove
          </button>
        )}
        <button type="button" className="chip" onClick={() => setEditing(false)}>
          Cancel
        </button>
        {bad && (
          <span className="fn-err" role="alert">
            Use 1–4 digits, optionally a letter (1016, 8473A)
          </span>
        )}
      </form>
    );
  return (
    <small className="fn-line">
      {f.cs ? (
        <Tip tip={GLOSSARY.callsign} title="Callsign">
          <span className="mono">{f.fn ? f.cs : "Callsign"}</span>
        </Tip>
      ) : (
        <span className="muted">no callsign in the snapshot</span>
      )}
      {canEdit && !f.fn && (
        <Tip tip={GLOSSARY.noFn} title="Flight number" plain>
          <button
            type="button"
            className="fn-add"
            onClick={() => {
              setDraft("");
              setEditing(true);
            }}
          >
            + Add flight number
          </button>
        </Tip>
      )}
      {canEdit && f.fnUser && (
        <button
          type="button"
          className="fn-add"
          title="You added this number; edit or remove it"
          onClick={() => {
            setDraft(f.fn ?? "");
            setEditing(true);
          }}
        >
          your number · edit
        </button>
      )}
    </small>
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
        {f.day && varies(f) ? (
          <>
            <b>{DAY_NAMES[f.day - 1]} times.</b> {dayNote(f, f.day)}
          </>
        ) : anyObs ? (
          `Typical = median of ${f.samples} tracked ${f.samples === 1 ? "flight" : "flights"}.`
        ) : (
          "No tracked times for this flight in the snapshot."
        )}{" "}
        All times UTC (Z) with local time (LT).
      </p>
    </div>
  );
}

/** Where a weekday's typical times come from, for flights whose times change through the week. */
function dayNote(f: Row["f"], day: number): string {
  const b = f.base ?? f;
  const n = b.seen?.[day - 1] ?? 0;
  const name = `${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day - 1]}${n === 1 ? "" : "s"}`;
  if (!b.seen) return "No tracked times; scheduled times only.";
  if (n >= 2) return `Typical = median of ${n} tracked ${name} (${b.samples} over the week).`;
  return `Typical = the flight’s usual times, moved to this day (${n} tracked ${name}; ${b.samples} over the week).`;
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
