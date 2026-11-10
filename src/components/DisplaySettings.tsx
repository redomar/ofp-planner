"use client";

/**
 * Settings → Display: the settings in groups (left), one row per setting with a segmented control,
 * and either a sample of the current choice on each row (Rows) or one live preview beside them (Preview).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadAirline, loadAirports, loadManifest, type Airport, type FlightRow } from "@/lib/data/load";
import { enrich } from "@/lib/data/query";
import type { AirlineInfo, Manifest } from "@/lib/data/types";
import { routeColor, textOn } from "@/lib/colors";
import { airportLabel, cityName, hhmm, isoDay, onDay, plannedOut, varies } from "@/lib/data/flight";
import { DEFAULT_DISPLAY, useDisplay, writeDisplay, type AirlineSet, type Display, type FinderLayout, type PassStyle, type VariesMark } from "@/lib/display";
import { RouteHead } from "./RouteHead";
import { DayTabs, WeekTimes } from "./WeekTimes";
import { FlightIdent, GuessMark, TypeBadge, VariesMark as VaryMark } from "./badges";
import { Flag } from "./Flag";
import { cx } from "./ui";

type Key = Exclude<keyof Display, "logBars" | "settingsView">;
type Setting = { name: string; help: string; options: readonly (readonly [Display[Key], string])[] };

/** Every setting this section offers, in the words of its row. The radio's name is the setting's key. */
const SETTINGS: Record<Key, Setting> = {
  airlineTag: {
    name: "Airline tag",
    help: "How the airline’s name is drawn",
    options: [
      ["solid", "Solid"],
      ["tint", "Tinted"],
      ["split", "Split pill"],
      ["edge", "Edge"],
    ],
  },
  flightFirst: {
    name: "Order",
    help: "Which comes first",
    options: [
      [true, "Flight, then airline"],
      [false, "Airline, then flight"],
    ],
  },
  typeColour: {
    name: "Aircraft badge colour",
    help: "What the colour means",
    options: [
      ["maker", "Maker"],
      ["airline", "Airline"],
      ["none", "Nothing"],
    ],
  },
  typeTheme: {
    name: "Aircraft badge style",
    help: "How much of the badge it fills",
    options: [
      ["full", "Filled"],
      ["side", "Edge"],
    ],
  },
  variesMark: {
    name: "Times that vary",
    help: "Mark for “other days differ”",
    options: [
      ["tag", "VAR tag"],
      ["word", "“varies”"],
      ["tilde", "~"],
      ["dot", "Dot"],
    ],
  },
  pinShort: {
    name: "What the filter pins",
    help: "One airline or origin chosen",
    options: [
      [false, "Shown in full"],
      [true, "Shown short"],
    ],
  },
  finder: {
    name: "Finder layout",
    help: "How much the Finder shows",
    options: [
      ["full", "Full"],
      ["calm", "Calm"],
      ["roll", "Roll first"],
      ["place", "In place"],
    ],
  },
  pass: {
    name: "Pass style",
    help: "The flight card is a boarding pass",
    options: [
      ["side", "Side stub"],
      ["track", "Track"],
      ["city", "City first"],
    ],
  },
  passFlip: {
    name: "Back of the pass",
    help: "Where the OUT · OFF · ON · IN table lives",
    options: [
      [true, "Flip for times"],
      [false, "Times always open"],
    ],
  },
  tickets: {
    name: "Flights in lists",
    help: "Favourites and recent flights",
    options: [
      [true, "Small tickets"],
      [false, "Plain rows"],
    ],
  },
  week: {
    name: "Times by day",
    help: "For flights that change in the week",
    options: [
      ["table", "Week table"],
      ["grouped", "Grouped"],
      ["tabs", "Day tabs"],
      ["timeline", "Timeline"],
    ],
  },
  mapCodes: {
    name: "Airport codes",
    help: "Beside destinations",
    options: [
      ["iata", "IATA"],
      ["icao", "ICAO"],
      ["off", "Off"],
    ],
  },
  mapLines: {
    name: "Route lines",
    help: "How a route is drawn",
    options: [
      ["great", "Shortest way"],
      ["rhumb", "Along the grid"],
    ],
  },
  logbook: {
    name: "Flights flown",
    help: "How the logbook lists them",
    options: [
      ["table", "Table"],
      ["strips", "Flight strips"],
    ],
  },
  airlines: {
    name: "Airlines",
    help: "Which ones pickers and searches list",
    options: [
      ["common", "Common"],
      ["extra", "Common + Extra+"],
    ],
  },
  guessed: {
    name: "Guessed airports",
    help: "Flights seen only once airborne",
    options: [
      [false, "Hide them"],
      [true, "Show them, marked"],
    ],
  },
};

type GroupId = "finder" | "list" | "card" | "maps" | "log" | "listed";
const GROUPS: { id: GroupId; title: string; keys: Key[] }[] = [
  { id: "finder", title: "Finder layout", keys: ["finder"] },
  { id: "list", title: "Flights list", keys: ["airlineTag", "flightFirst", "typeColour", "typeTheme", "variesMark", "pinShort"] },
  { id: "card", title: "Flight card", keys: ["pass", "passFlip", "tickets", "week"] },
  { id: "maps", title: "Maps", keys: ["mapCodes", "mapLines"] },
  { id: "log", title: "Logbook", keys: ["logbook"] },
  { id: "listed", title: "What’s listed", keys: ["airlines", "guessed"] },
];
const ALL_KEYS = GROUPS.flatMap((g) => g.keys);
/** What a pointed-at row changes in the preview (Preview view outlines it). */
const TARGET: Partial<Record<Key, string>> = { airlineTag: "ident", flightFirst: "ident", typeColour: "badge", typeTheme: "badge", variesMark: "time", pass: "pass", passFlip: "flip", tickets: "ticket", week: "week" };

const PASS_CARDS: [PassStyle, string, string][] = [
  ["side", "Pass, stub at the side", "The pass without the track; the actions on a stub at the side."],
  ["track", "Pass with track", "OUT · OFF · ON · IN track, the stub below."],
  ["city", "Ticket, city first", "Big city names, local time first."],
];

const FINDER_CARDS: [FinderLayout, string, string][] = [
  ["full", "Full", "Everything on one page, a little tidier: unused filters behind More filters, the panel’s extras folded."],
  ["calm", "Calm", "A sentence for the filter, shorter rows, the flight in a panel with tabs."],
  ["roll", "Roll first", "Opens on “Where are you flying from?” and a rolled flight; the list below."],
  ["place", "In place", "No panel: the row you pick opens where it is, pass and map."],
];

const optLabel = (k: Key, v: Display[Key]) => SETTINGS[k].options.find(([o]) => o === v)?.[1] ?? String(v);

export function DisplayPrefs({ manifest }: { manifest: Manifest | null }) {
  const d = useDisplay();
  const view = d.settingsView;
  const [group, setGroup] = useState<GroupId>("finder");
  const [hot, setHot] = useState<Key | null>(null);
  const changed = ALL_KEYS.filter((k) => d[k] !== DEFAULT_DISPLAY[k]);
  const resetAll = () => writeDisplay(Object.fromEntries(ALL_KEYS.map((k) => [k, DEFAULT_DISPLAY[k]])) as Partial<Display>);
  const rowsRef = useRef<HTMLDivElement>(null);

  // Rows: the group list follows the scroll (the group whose heading was passed last is current)
  useEffect(() => {
    const root = rowsRef.current;
    if (view !== "rows" || !root || typeof IntersectionObserver === "undefined") return;
    const heads = [...root.querySelectorAll<HTMLElement>("[data-group]")];
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set((e.target as HTMLElement).dataset.group!, e.isIntersecting);
        const first = heads.find((h) => seen.get(h.dataset.group!));
        if (first) setGroup(first.dataset.group as GroupId);
      },
      { rootMargin: "-10% 0px -55% 0px" },
    );
    heads.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [view]);

  const pick = (id: GroupId) => {
    setGroup(id);
    if (view === "rows") document.getElementById(`dp-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const preview = (id: GroupId) => {
    writeDisplay({ settingsView: "preview" });
    setGroup(id);
  };
  const shown = view === "preview" ? GROUPS.filter((g) => g.id === group) : GROUPS;

  return (
    <div className={cx("dp", `dp-${view}`)}>
      <div className="dp-bar">
        <span className="dp-changed mono" aria-live="polite">
          {changed.length ? `${changed.length} changed from default` : "All at their defaults"}
        </span>
        <button type="button" className="chip" onClick={resetAll} disabled={!changed.length}>
          Reset all
        </button>
        <span className="dp-view">
          <span className="ctl-label" id="dp-view-l">
            View
          </span>
          <span className="dp-seg" role="radiogroup" aria-labelledby="dp-view-l">
            {(
              [
                ["rows", "Rows"],
                ["preview", "Preview"],
              ] as const
            ).map(([v, l]) => (
              <label key={v} className="dp-seg-o">
                <input type="radio" name="settingsView" checked={view === v} onChange={() => writeDisplay({ settingsView: v })} />
                <span>{l}</span>
              </label>
            ))}
          </span>
        </span>
      </div>
      <div className="dp-body">
        <nav className="dp-nav" aria-label="Display groups">
          {GROUPS.map((g) => (
            <button key={g.id} type="button" className={cx("dp-nav-i", group === g.id && "on")} aria-current={group === g.id ? "true" : undefined} onClick={() => pick(g.id)}>
              <span>{g.title}</span>
              <small className="mono" aria-label={`${g.keys.length} settings`}>
                {g.keys.length}
              </small>
            </button>
          ))}
        </nav>
        <div className="dp-rows" ref={rowsRef} onMouseLeave={() => setHot(null)}>
          {shown.map((g) => (
            <section key={g.id} className="dp-grp" id={`dp-${g.id}`} aria-labelledby={`dp-${g.id}-h`}>
              <h3 className="dp-gh" id={`dp-${g.id}-h`} data-group={g.id}>
                {g.title}
              </h3>
              {g.keys.map((k) => (
                <Row key={k} k={k} d={d} view={view} hot={hot === k} onHot={setHot} manifest={manifest} onPreview={() => preview(g.id)} />
              ))}
              {g.id === "list" && view === "rows" && <BadgeSample />}
            </section>
          ))}
        </div>
        {view === "preview" && (
          <aside className="dp-pv" aria-label="Preview of your settings">
            <p className="dp-pv-cap">
              <span>Preview</span>
              <span>Your settings, live</span>
            </p>
            <Preview group={group} hot={hot ? (TARGET[hot] ?? null) : null} manifest={manifest} />
          </aside>
        )}
      </div>
    </div>
  );
}

function Row({ k, d, view, hot, onHot, manifest, onPreview }: { k: Key; d: Display; view: Display["settingsView"]; hot: boolean; onHot: (k: Key | null) => void; manifest: Manifest | null; onPreview: () => void }) {
  const s = SETTINGS[k];
  const isChanged = d[k] !== DEFAULT_DISPLAY[k];
  const undo = isChanged && (
    <button type="button" className="dp-undo" onClick={() => writeDisplay({ [k]: DEFAULT_DISPLAY[k] } as Partial<Display>)} aria-label={`${s.name} changed: undo, back to ${optLabel(k, DEFAULT_DISPLAY[k])}`}>
      changed · undo
    </button>
  );
  const head = (
    <div className="dp-n">
      <b id={`dp-${k}-l`}>{s.name}</b>
      <small id={`dp-${k}-h`}>{s.help}</small>
    </div>
  );
  // settings with a shape are picture cards
  if ((k === "pass" || k === "finder") && view === "rows") {
    const cards: [string, string, string, ReactNode][] =
      k === "pass" ? PASS_CARDS.map(([v, t, n]) => [v, t, n, <PassSketch key={v} style={v} />]) : FINDER_CARDS.map(([v, t, n]) => [v, t, n, <FinderSketch key={v} layout={v} />]);
    return (
      <div className={cx("dp-row dp-wide", hot && "hot")} onMouseEnter={() => onHot(k)} onFocus={() => onHot(k)}>
        {head}
        <div className={cx("dp-cards", k === "finder" && "four")} role="radiogroup" aria-labelledby={`dp-${k}-l`} aria-describedby={`dp-${k}-h`}>
          {cards.map(([v, title, note, pic]) => (
            <label key={v} className="dp-card">
              <input type="radio" name={k} checked={d[k] === v} onChange={() => writeDisplay({ [k]: v } as Partial<Display>)} />
              <span className="dp-card-t">
                {title}
                {v === DEFAULT_DISPLAY[k] && <small className="muted"> default</small>}
              </span>
              {pic}
              <small className="dp-card-n">{note}</small>
            </label>
          ))}
        </div>
        {undo && <div className="dp-c">{undo}</div>}
      </div>
    );
  }
  return (
    <div className={cx("dp-row", hot && "hot")} onMouseEnter={() => onHot(k)} onFocus={() => onHot(k)}>
      {head}
      <div className="dp-c">
        <span className="dp-seg" role="radiogroup" aria-labelledby={`dp-${k}-l`} aria-describedby={`dp-${k}-h`}>
          {s.options.map(([v, l]) => (
            <label key={l} className="dp-seg-o">
              <input type="radio" name={k} checked={d[k] === v} onChange={() => writeDisplay({ [k]: v } as Partial<Display>)} />
              <span>{l}</span>
            </label>
          ))}
        </span>
        {undo}
      </div>
      {view === "rows" && <div className="dp-s">{rowSample(k, d, manifest, onPreview)}</div>}
    </div>
  );
}

/** One small sample of the current choice, at the end of its row. */
function rowSample(k: Key, d: Display, manifest: Manifest | null, onPreview: () => void): ReactNode {
  const ezy = manifest?.airlines.find((a) => a.icao === "EZY");
  const see = (
    <button type="button" className="dp-see" onClick={onPreview}>
      See it in Preview
    </button>
  );
  switch (k) {
    case "airlineTag":
    case "flightFirst":
      return (
        <span aria-hidden="true" inert>
          <FlightIdent airline={ezy} fallback="EZY" ident="EZY43NM" />
        </span>
      );
    case "variesMark":
      return (
        <span className="mono var-sample" aria-hidden="true" inert>
          <VariesSample mark={d.variesMark} />
        </span>
      );
    case "mapCodes":
      return (
        <span className="dp-map" aria-hidden="true" inert>
          <MiniMap mode={d.mapCodes} />
        </span>
      );
    case "mapLines":
      return (
        <span className="dp-map" aria-hidden="true" inert>
          <LinesSketch mode={d.mapLines} />
        </span>
      );
    case "airlines":
      return <AirlineCount set={d.airlines} manifest={manifest} />;
    case "guessed":
      return (
        <span className="guess-sample" aria-hidden="true" inert>
          <span className="mono">BKPR</span>
          {d.guessed ? <GuessMark side="o" name="Pristina" /> : null} <small className="muted">Pristina</small>
          {!d.guessed && <small className="guess-sample-off">not listed</small>}
        </span>
      );
    case "week":
    case "logbook":
    case "passFlip":
    case "tickets":
      return see;
    default:
      return null;
  }
}

function AirlineCount({ set, manifest }: { set: AirlineSet; manifest: Manifest | null }) {
  if (!manifest) return null;
  const common = manifest.airlines.filter((a) => !a.extra).length;
  const extra = manifest.airlines.length - common;
  return <span className="mono small">{set === "extra" ? `${common} + ${extra} Extra+` : `${common} airlines`}</span>;
}

/** Real flights for the badge sample: one per maker, each on an airline of its own colour. */
const BADGE_ROWS = [
  ["PGT", "A20N"],
  ["LOT", "B38M"],
  ["AUA", "E195"],
  ["EIN", "AT76"],
] as const;
type SampleRow = { f: FlightRow; al: AirlineInfo | undefined; dest: Airport | undefined };

function useSampleRows() {
  const [rows, setRows] = useState<SampleRow[] | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const [m, airports] = await Promise.all([loadManifest(), loadAirports()]);
      const out: SampleRow[] = [];
      for (const [icao, type] of BADGE_ROWS) {
        const al = m.airlines.find((a) => a.icao === icao);
        if (!al) continue;
        const rs = await loadAirline(al, m);
        const ofType = rs.filter((r) => r.types[0] === type);
        const timed = ofType.filter((r) => plannedOut(r) != null);
        const f = timed.find((r) => r.fn && r.std != null && varies(r)) ?? timed.find((r) => r.fn && r.std != null) ?? timed.find((r) => r.fn) ?? timed[0] ?? ofType[0];
        if (f) out.push({ f: varies(f) ? onDay(f, isoDay(new Date())) : f, al, dest: airports.get(f.d) });
      }
      if (live) setRows(out);
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return rows;
}

/** Table rows as the flights table draws them with the current settings. */
function SampleTable({ rows, hot }: { rows: SampleRow[] | null; hot?: string | null }) {
  if (!rows) return <span className="sk-block" />;
  return (
    <span className="dp-tbl" aria-hidden="true" inert>
      {rows.map(({ f, al, dest }) => (
        <span key={f.id} className="dp-tr">
          <span className={cx("dp-td", hot === "ident" && "pv-hot")}>
            <FlightIdent airline={al} fallback={f.al} ident={f.fn ? `${al?.iata ?? f.al}${f.fn}` : (f.cs ?? f.al)} />
          </span>
          <span className="dp-td dp-city">
            <span className="mono">{f.d}</span> <small className="muted">{dest ? (cityName(dest) ?? airportLabel(dest)) : ""}</small>
          </span>
          <span className={cx("dp-td mono num", hot === "time" && "pv-hot")}>
            <VaryMark f={f}>{hhmm(plannedOut(f)) ?? "—"}</VaryMark>
          </span>
          <span className={cx("dp-td", hot === "badge" && "pv-hot")}>{f.types[0] && <TypeBadge type={f.types[0]} airline={al} />}</span>
        </span>
      ))}
    </span>
  );
}

const MAKER_KEY = [
  ["blue", "Airbus"],
  ["green", "Boeing"],
  ["amber", "Embraer"],
  ["red", "ATR · Dash 8"],
] as const;

/** The two badge questions answered on real rows, with a key that follows the answer. */
function BadgeSample() {
  const d = useDisplay();
  const rows = useSampleRows();
  return (
    <div className="dp-badges">
      <p className="dp-smp-h">
        <span>Sample</span>
        <span>Updates as you choose</span>
      </p>
      <SampleTable rows={rows} />
      <p className="dp-key small">
        {d.typeColour === "maker"
          ? MAKER_KEY.map(([tone, l]) => (
              <span key={tone}>
                <i className={`dp-key-sw tb-${tone}`} aria-hidden="true" />
                {l}
              </span>
            ))
          : d.typeColour === "airline"
            ? "Each badge takes the colour of the airline tag beside it."
            : "Badges are plain; point at one for its maker and full name."}
      </p>
    </div>
  );
}

/** The live preview for one group, built from the same parts the pages use. */
function Preview({ group, hot, manifest }: { group: GroupId; hot: string | null; manifest: Manifest | null }) {
  const d = useDisplay();
  const rows = useSampleRows();
  const sample = useSampleFlight();
  const varying = useVaryingSample();
  const al = (c: string) => manifest?.airlines.find((a) => a.icao === c);
  if (group === "list") return <SampleTable rows={rows} hot={hot} />;
  if (group === "finder")
    return (
      <div className="dp-pv-finder">
        <FinderSketch layout={d.finder} />
        <p className="small muted">{FINDER_CARDS.find(([v]) => v === d.finder)?.[2]}</p>
      </div>
    );
  if (group === "maps")
    return (
      <div className="dp-pv-maps">
        <MiniMap mode={d.mapCodes} />
        <LinesSketch mode={d.mapLines} />
      </div>
    );
  if (group === "log") return <LogbookSample style={d.logbook} />;
  if (group === "listed")
    return (
      <div className="dp-pv-listed">
        <AirlineSetSample set={d.airlines} manifest={manifest} />
        <span className="guess-sample" aria-hidden="true" inert>
          <span className="mono">BKPR</span>
          {d.guessed ? <GuessMark side="o" name="Pristina" /> : null} <small className="muted">Pristina</small> <span aria-hidden="true">→</span> <span className="mono">EDDF</span>{" "}
          <small className="muted">Frankfurt</small>
          {!d.guessed && <small className="guess-sample-off">not listed</small>}
        </span>
      </div>
    );
  // flight card: the pass, what's behind it, a week, a ticket
  if (!sample) return <span className="sk-block" />;
  const sal = al(sample.f.al);
  const ident = sample.f.fn ? `${sal?.iata ?? sample.f.al}${sample.f.fn}` : (sample.f.cs ?? sample.f.al);
  return (
    <div className="dp-pv-card">
      <span className={cx(`rh-sample bp-sample bp-${d.pass}`, hot === "pass" && "pv-hot")} style={band(sal)} aria-hidden="true" inert>
        <span className="fcard-head dp-band">
          <span className="fcard-title">
            <span className="fcard-airline">{sal?.name ?? sample.f.al}</span>
            <span className="fcard-no">{ident}</span>
          </span>
        </span>
        <span className="bp">
          <span className="bp-face">
            <RouteHead style={d.pass} f={sample.f} from={sample.from} to={sample.to} blockMin={sample.block} nm={sample.nm} />
          </span>
          <span className="bp-stub">
            <span className="btn btn-primary">Open in SimBrief</span>
            {d.passFlip && <span className="btn">Times</span>}
          </span>
        </span>
      </span>
      <p className={cx("small muted dp-pv-note", hot === "flip" && "pv-hot")}>
        {d.passFlip ? "Times: on the back of the pass (the Times button or F turns it over)." : "Times: the OUT · OFF · ON · IN table stays open under the map."}
      </p>
      {varying && (
        <div className={cx("dp-pv-week", hot === "week" && "pv-hot")} aria-hidden="true" inert>
          {d.week === "tabs" ? <DayTabs f={varying} day={varying.day} onPick={() => undefined} /> : <WeekTimes f={varying} style={d.week} />}
        </div>
      )}
      <ul className={cx("fl-list dp-pv-ticket", d.tickets && "tickets", hot === "ticket" && "pv-hot")} aria-hidden="true" inert>
        <li className="fl-row" style={{ ["--c" as string]: routeColor(sal) }}>
          <span className="fl-main">
            <span className="fl-ident">
              <FlightIdent airline={sal} fallback={sample.f.al} ident={ident} />
            </span>
            <span className="fl-route">
              <span className="fl-codes mono">
                {sample.f.o} <span className="fl-arrow">→</span> {sample.f.d}
              </span>
              <small className="fl-places">
                {sample.from?.country && <Flag cc={sample.from.country} />}
                {sample.from ? (cityName(sample.from) ?? sample.from.name) : sample.f.o}
                <span> → </span>
                {sample.to?.country && <Flag cc={sample.to.country} />}
                {sample.to ? (cityName(sample.to) ?? sample.to.name) : sample.f.d}
              </small>
            </span>
            <span className="fl-time mono">{plannedOut(sample.f) != null ? `${hhmm(plannedOut(sample.f))}Z` : "—"}</span>
          </span>
          <span className="fl-actions">
            <span className="icon-chip">›</span>
          </span>
        </li>
      </ul>
    </div>
  );
}

/** The airline's band colours, as the flight card sets them. */
function band(al: AirlineInfo | undefined) {
  const color = routeColor(al);
  const ink = textOn(color);
  const second = al?.colors?.secondary;
  const accent = second && /^#[0-9a-f]{6}$/i.test(second) && second.toLowerCase() !== color.toLowerCase() ? second : ink;
  return { ["--al" as string]: color, ["--al-ink" as string]: ink, ["--al-2" as string]: accent };
}

/** A picture of each Finder layout: filters, list and where the flight opens. */
function FinderSketch({ layout }: { layout: FinderLayout }) {
  const lines = (x: number, y: number, w: number, n: number, gap = 7) =>
    Array.from({ length: n }, (_, i) => <rect key={i} className="sk-dim" x={x} y={y + i * gap} width={w} height="2.5" />);
  return (
    <svg className="dp-sketch" viewBox="0 0 160 96" aria-hidden="true">
      <rect className="sk-paper" x="1" y="1" width="158" height="94" rx="4" />
      {layout === "full" ? (
        <>
          <rect className="sk-dim" x="8" y="8" width="34" height="7" />
          <rect className="sk-dim" x="46" y="8" width="34" height="7" />
          <rect className="sk-dim" x="84" y="8" width="34" height="7" />
          <rect className="sk-mag" x="8" y="19" width="30" height="5" />
          {lines(8, 32, 80, 9)}
          <rect className="sk-paper" x="94" y="28" width="60" height="62" />
          <rect className="sk-band" x="94" y="28" width="60" height="7" />
          <rect className="sk-water" x="98" y="58" width="52" height="26" />
        </>
      ) : layout === "roll" ? (
        <>
          <rect className="sk-ink" x="8" y="10" width="54" height="6" />
          <rect className="sk-dim" x="8" y="21" width="44" height="3" />
          <rect className="sk-dim" x="8" y="30" width="26" height="7" />
          <rect className="sk-mag" x="38" y="30" width="26" height="7" />
          <rect className="sk-paper" x="90" y="8" width="62" height="40" />
          <rect className="sk-band" x="90" y="8" width="62" height="7" />
          <rect className="sk-btn" x="95" y="38" width="40" height="5" />
          {lines(8, 60, 144, 5)}
        </>
      ) : (
        <>
          <rect className="sk-ink" x="8" y="8" width="18" height="6" />
          <rect className="sk-dim" x="30" y="10" width="20" height="3" />
          <rect className="sk-ink" x="54" y="8" width="22" height="6" />
          <rect className="sk-dim" x="80" y="10" width="14" height="3" />
          <rect className="sk-mag" x="130" y="8" width="22" height="6" />
          {layout === "calm" ? (
            <>
              {lines(8, 26, 84, 9)}
              <rect className="sk-paper" x="98" y="22" width="56" height="68" />
              <rect className="sk-band" x="98" y="22" width="56" height="7" />
              <rect className="sk-dim" x="102" y="52" width="10" height="3" />
              <rect className="sk-dim" x="116" y="52" width="10" height="3" />
              <rect className="sk-dim" x="130" y="52" width="10" height="3" />
              <rect className="sk-water" x="102" y="60" width="48" height="24" />
            </>
          ) : (
            <>
              {lines(8, 26, 144, 2)}
              <rect className="sk-hot" x="6" y="38" width="148" height="34" />
              <rect className="sk-paper" x="10" y="42" width="66" height="26" />
              <rect className="sk-band" x="10" y="42" width="66" height="6" />
              <rect className="sk-water" x="82" y="42" width="68" height="26" />
              {lines(8, 78, 144, 2)}
            </>
          )}
        </>
      )}
    </svg>
  );
}

/** A picture of each pass: band, both ends, and where the stub sits. */
function PassSketch({ style }: { style: PassStyle }) {
  return (
    <svg className="dp-sketch" viewBox="0 0 160 76" aria-hidden="true">
      <rect className="sk-paper" x="1" y="1" width="158" height="74" rx="4" />
      {style === "city" ? (
        <>
          <rect className="sk-band" x="1" y="1" width="10" height="74" />
          <rect className="sk-ink" x="20" y="14" width="46" height="9" />
          <rect className="sk-ink" x="96" y="14" width="46" height="9" />
          <rect className="sk-dim" x="20" y="28" width="26" height="4" />
          <rect className="sk-dim" x="116" y="28" width="26" height="4" />
          <rect className="sk-ink" x="20" y="44" width="60" height="5" />
          <path className="sk-perf" d="M11 58H159" />
          <rect className="sk-btn" x="20" y="63" width="70" height="8" />
        </>
      ) : (
        <>
          <rect className="sk-band" x="1" y="1" width="158" height="10" />
          <rect className="sk-ink" x="8" y="18" width="30" height="9" />
          <rect className="sk-ink" x={style === "side" ? 74 : 122} y="18" width="30" height="9" />
          {style === "track" ? (
            <>
              <path className="sk-trk" d="M12 44H148" />
              <circle className="sk-dot" cx="12" cy="44" r="2.5" />
              <circle className="sk-dot" cx="40" cy="44" r="2.5" />
              <circle className="sk-dot" cx="120" cy="44" r="2.5" />
              <circle className="sk-dot" cx="148" cy="44" r="2.5" />
              <path className="sk-perf" d="M1 58H159" />
              <rect className="sk-btn" x="8" y="63" width="96" height="8" />
            </>
          ) : (
            <>
              <rect className="sk-dim" x="8" y="38" width="40" height="5" />
              <rect className="sk-dim" x="64" y="38" width="40" height="5" />
              <path className="sk-perf" d="M114 11V75" />
              <rect className="sk-btn" x="120" y="20" width="32" height="10" />
              <rect className="sk-dim" x="120" y="36" width="24" height="4" />
            </>
          )}
        </>
      )}
    </svg>
  );
}

/** The option's airlines: how many, and a few of them by colour. */
function AirlineSetSample({ set, manifest }: { set: AirlineSet; manifest: Manifest | null }) {
  if (!manifest) return <span className="sk-block" />;
  const common = manifest.airlines.filter((a) => !a.extra);
  const extra = manifest.airlines.filter((a) => a.extra);
  const shown = set === "extra" ? extra : common;
  const top = [...shown].sort((a, b) => b.flights - a.flights).slice(0, 4);
  return (
    <span className="al-set" aria-hidden="true" inert>
      <span className="al-set-n mono">
        {set === "extra" ? `${common.length} + ${extra.length} Extra+` : `${common.length} airlines`}
      </span>
      {top.length ? (
        top.map((a) => (
          <span key={a.icao} className="al-set-row">
            <span className="al-dot" style={{ background: routeColor(a) }} />
            {a.name}
            {a.extra && <span className="multi-tag">Extra+</span>}
          </span>
        ))
      ) : (
        <span className="al-set-row muted">None in this snapshot yet</span>
      )}
    </span>
  );
}

/** Two made-up flights drawn the way each logbook style lists them. */
function LogbookSample({ style }: { style: "table" | "strips" }) {
  const rows = [
    ["Thu 8", "EGKK", "LEZL", "Gatwick", "Seville", "2h 10m", "b-green", "On time", "#ff6600"],
    ["Tue 6", "EBBR", "EIDW", "Brussels", "Dublin", "1h 51m", "b-red", "Late", "#073590"],
  ] as const;
  if (style === "strips")
    return (
      <span className="log-sample log-strips" aria-hidden="true" inert>
        {rows.map(([day, o, dst, , , blk, tone, st, c]) => (
          <span key={day} className="strip log-sample-strip" style={{ ["--c" as string]: c }}>
            <b className="mono">{o}</b>
            <span>▸</span>
            <b className="mono">{dst}</b>
            <span className="mono">{blk}</span>
            <span className={`badge ${tone} strip-stamp`}>{st}</span>
          </span>
        ))}
      </span>
    );
  return (
    <span className="log-sample log-sample-tbl" aria-hidden="true" inert>
      <span className="log-sample-month">October 2026</span>
      {rows.map(([day, o, dst, a, b, blk, tone, st]) => (
        <span key={day} className="log-sample-row">
          <span className="mono muted">{day}</span>
          <span className="mono">{o}</span>
          <small className="muted">{a}</small>
          <span className="mono">{dst}</span>
          <small className="muted">{b}</small>
          <span className="mono">{blk}</span>
          <span className={`badge ${tone}`}>{st}</span>
        </span>
      ))}
    </span>
  );
}

/** A sketch for the route-lines setting: the grid as it looks on these maps, and one long route drawn each way. */
function LinesSketch({ mode }: { mode: "great" | "rhumb" }) {
  const d = mode === "great" ? "M34 46L206 46" : "M34 46Q120 92 206 46";
  return (
    <svg className="mini-map" viewBox="0 0 240 124" role="img" aria-label={mode === "great" ? "A route drawn as a straight line" : "A route curving with the grid"}>
      <rect width="240" height="124" className="map-sea" />
      <path className="map-land" d="M0 70 C40 60 70 80 100 74 C140 66 170 50 240 56 L240 124 L0 124 Z" />
      <path className="map-grat" d="M-20 20Q120 66 260 20M-20 52Q120 98 260 52M-20 84Q120 130 260 84M40 124L80 0M120 124V0M200 124L160 0" />
      <g className="map-route on">
        <path className="map-casing" d={d} style={{ strokeWidth: 3.4, fill: "none" }} />
        <path className="map-line" d={d} style={{ stroke: "#ff6600", strokeWidth: 1.8, fill: "none", animation: "none", strokeDasharray: "none", strokeDashoffset: 0 }} />
      </g>
      {[
        [34, 46, "LGW"],
        [206, 46, "AYT"],
      ].map(([x, y, c]) => (
        <g key={c} className="map-port" transform={`translate(${x} ${y})`}>
          <circle className="map-dot" r="3.4" />
          <text x="0" y="-8" textAnchor="middle">
            {c}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** A small map sketch for the codes setting: a hub and three destinations, labelled per option. */
function MiniMap({ mode }: { mode: "iata" | "icao" | "off" }) {
  const ports: [number, number, string, string][] = [
    [48, 70, "BCN", "LEBL"],
    [150, 34, "MUC", "EDDM"],
    [196, 92, "ADB", "LTBJ"],
    [116, 104, "FCO", "LIRF"],
  ];
  const [hx, hy] = ports[0];
  const code = (i: string, o: string) => (mode === "icao" ? o : i);
  return (
    <svg className="mini-map" viewBox="0 0 240 124" role="img" aria-label={`Map sample with ${mode === "off" ? "no destination codes" : `${mode.toUpperCase()} codes`}`}>
      <rect width="240" height="124" className="map-sea" />
      <path className="map-land" d="M0 40 C40 30 70 50 100 44 C140 36 170 20 240 26 L240 70 C210 76 200 60 170 66 C150 70 140 84 120 80 C100 76 92 96 70 92 C50 88 30 98 0 92 Z" />
      <path className="map-grat" d="M0 62H240M60 0V124M120 0V124M180 0V124" />
      {ports.slice(1).map(([x, y]) => (
        <g key={`${x}${y}`} className="map-route on">
          <path className="map-casing" d={`M${hx} ${hy}L${x} ${y}`} style={{ strokeWidth: 3.4 }} />
          <path className="map-line" d={`M${hx} ${hy}L${x} ${y}`} style={{ stroke: "#ff6600", strokeWidth: 1.8, animation: "none", strokeDasharray: "none", strokeDashoffset: 0 }} />
        </g>
      ))}
      {ports.map(([x, y, i, o], k) => (
        <g key={i} className={`map-port${k === 0 ? " hub" : ""}`} transform={`translate(${x} ${y})`}>
          <circle className="map-dot" r={k === 0 ? 4.5 : 3.4} />
          {(k === 0 || mode !== "off") && (
            <text x={k === 0 ? 0 : 7} y={k === 0 ? -9 : 4} textAnchor={k === 0 ? "middle" : "start"}>
              {code(i, o)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** A real flight from the snapshot for the flight-card samples (Pegasus 1528 Barcelona → Izmir, else any). */
function useSampleFlight() {
  const [s, setS] = useState<{ f: FlightRow; from: Airport | undefined; to: Airport | undefined; block: number | null; nm: number | null } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const [m, airports] = await Promise.all([loadManifest(), loadAirports()]);
      const info = m.airlines.find((a) => a.icao === "PGT") ?? m.airlines[0];
      const rows = await loadAirline(info, m);
      const f = rows.find((r) => r.o === "LEBL" && r.d === "LTBJ") ?? rows.find((r) => r.off != null) ?? rows[0];
      const r = enrich(f, airports);
      if (live) setS({ f, from: airports.get(f.o), to: airports.get(f.d), block: r.block?.min ?? null, nm: r.nm });
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return s;
}

/** A real flight whose times change by weekday (Pegasus PGT651R Frankfurt → Antalya, else any), with today's times. */
function useVaryingSample() {
  const [f, setF] = useState<FlightRow | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const m = await loadManifest();
      const info = m.airlines.find((a) => a.icao === "PGT") ?? m.airlines[0];
      const rows = await loadAirline(info, m);
      const x = rows.find((r) => r.cs === "PGT651R" && varies(r)) ?? rows.find((r) => varies(r) && r.days.length === 7) ?? rows.find(varies);
      if (live && x) setF(onDay(x, isoDay(new Date())));
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return f;
}

/** The varies mark on a sample time, as the flights table shows it with this setting. */
function VariesSample({ mark, f = null }: { mark: VariesMark; f?: FlightRow | null }) {
  const t = hhmm(f ? plannedOut(f) : 760) ?? "12:40";
  if (mark === "word")
    return (
      <span className="var-word">
        {t}
        <small>varies</small>
      </span>
    );
  return (
    <>
      {t}
      {mark === "tilde" ? <span className="var-tilde">~</span> : <sup className="var-tag">VAR</sup>}
    </>
  );
}

