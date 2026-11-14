/**
 * 1.16: the aircraft's state and the MCDU pages from OFP Tower (Fenix A320 family), for the flip
 * cards' "Aircraft status" and "Flight deck" sides. Field names and meanings are the ones a real
 * flight showed (EICK → EGBB, 13 Nov 2026, the probe in every recording); fields that never moved
 * with the cockpit (AUTOPILOT MASTER, APU SWITCH, SPOILERS ARMED, LIGHT RECOGNITION, …) aren't used.
 * Imports nothing, so verify loads it in Node.
 */

/** Probe values as sent: only the ones that changed in each message, merged here. */
export type ProbeValues = Record<string, number | string | null>;

/** The values so far, with the changes over them. */
export function mergeProbe(prev: ProbeValues | null, v: unknown): ProbeValues | null {
  if (!v || typeof v !== "object") return prev;
  const out: ProbeValues = { ...(prev ?? {}) };
  let n = 0;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k.length > 60) continue;
    if (typeof x === "number" ? Number.isFinite(x) : typeof x === "string" ? x.length <= 40 : x === null) {
      out[k] = x as number | string | null;
      n++;
    }
  }
  return n || prev ? out : prev;
}

const num = (v: ProbeValues, k: string): number | null => {
  const x = v[k];
  return typeof x === "number" && Number.isFinite(x) ? x : null;
};
const on = (v: ProbeValues, k: string): boolean | null => {
  const x = num(v, k);
  return x == null ? null : x > 0.5;
};

export type Light = "off" | "on" | "auto" | "taxi" | "to" | "retracted";

export interface AircraftStatus {
  lights: { beacon: boolean | null; strobe: Light | null; nav: boolean | null; landing: Light | null; nose: Light | null; turnoff: boolean | null };
  /** "UP", "1", "2", "3", "FULL". */
  flaps: string | null;
  gear: "down" | "up" | "moving" | null;
  /** "armed", "retracted", or deployed (0–100 %). */
  speedbrake: "armed" | "retracted" | number | null;
  autobrake: "LO" | "MED" | "MAX" | "off" | null;
  ap1: boolean | null;
  ap2: boolean | null;
  athr: boolean | null;
  engines: [boolean | null, boolean | null];
  n1: [number | null, number | null];
  /** "IGN/START" while the engine mode selector is there. */
  engMode: "NORM" | "IGN/START" | null;
  apu: boolean | null;
  apuBleed: boolean | null;
  extPower: boolean | null;
  xpdrCode: string | null;
  /** The transponder transmitting (AUTO/ON), not standby. */
  xpdrOn: boolean | null;
  /** "STD", or the QNH (hPa). */
  baro: "STD" | number | null;
  cabinAltFt: number | null;
  weightKg: number | null;
  /** Anything at all from the cockpit. */
  any: boolean;
}

const LIGHT3: Record<number, Light> = { 0: "off", 1: "auto", 2: "on" };
const LAND: Record<number, Light> = { 0: "retracted", 1: "off", 2: "on" };
const NOSE: Record<number, Light> = { 0: "off", 1: "taxi", 2: "to" };
const FLAPS = ["UP", "1", "2", "3", "FULL"];

/** The cockpit as the probe last saw it. */
export function aircraftStatus(v: ProbeValues | null): AircraftStatus {
  const p = v ?? {};
  const pick = <T>(k: string, m: Record<number, T>) => {
    const x = num(p, k);
    return x == null ? null : (m[Math.round(x)] ?? null);
  };
  // landing lights: both switches, or the one that's there
  const landK = ["L:S_OH_EXT_LT_LANDING_BOTH", "L:S_OH_EXT_LT_LANDING_L", "L:S_OH_EXT_LT_LANDING_R"].find((k) => num(p, k) != null);
  const fl = num(p, "L:S_FC_FLAPS");
  const gearH = num(p, "L:S_MIP_GEAR") ?? num(p, "GEAR HANDLE POSITION");
  const gearPct = num(p, "GEAR TOTAL PCT EXTENDED");
  const sb = num(p, "L:A_FC_SPEEDBRAKE");
  const abMax = on(p, "L:I_MIP_AUTOBRAKE_MAX_L");
  const abMed = on(p, "L:I_MIP_AUTOBRAKE_MED_L");
  const abLo = on(p, "L:I_MIP_AUTOBRAKE_LO_L");
  const mode = num(p, "L:S_ENG_MODE");
  const xop = num(p, "L:S_XPDR_OPERATION");
  const xcode = num(p, "TRANSPONDER CODE:1");
  const kohl = num(p, "KOHLSMAN SETTING MB:1");
  const lb = num(p, "TOTAL WEIGHT");
  const n1 = (k: string) => {
    const x = num(p, k);
    return x == null ? null : Math.round(x);
  };
  return {
    lights: {
      beacon: on(p, "L:S_OH_EXT_LT_BEACON"),
      strobe: pick("L:S_OH_EXT_LT_STROBE", LIGHT3),
      nav: on(p, "L:S_OH_EXT_LT_NAV_LOGO"),
      landing: landK ? pick(landK, LAND) : null,
      nose: pick("L:S_OH_EXT_LT_NOSE", NOSE),
      turnoff: on(p, "L:S_OH_EXT_LT_RWY_TURNOFF"),
    },
    flaps: fl != null ? (FLAPS[Math.max(0, Math.min(4, Math.round(fl)))] ?? null) : null,
    gear: gearPct != null && gearPct > 0.02 && gearPct < 0.98 ? "moving" : gearH == null ? null : gearH > 0.5 ? "down" : "up",
    // 0 armed, 1 retracted, up to 3 fully out (decimals between)
    speedbrake: sb == null ? null : sb < 0.5 ? "armed" : sb < 1.05 ? "retracted" : Math.min(100, Math.round(((sb - 1) / 2) * 100)),
    autobrake: abMax == null && abMed == null && abLo == null ? null : abMax ? "MAX" : abMed ? "MED" : abLo ? "LO" : "off",
    ap1: on(p, "L:I_FCU_AP1"),
    ap2: on(p, "L:I_FCU_AP2"),
    athr: on(p, "L:I_FCU_ATHR"),
    engines: [on(p, "L:S_ENG_MASTER_1"), on(p, "L:S_ENG_MASTER_2")],
    n1: [n1("TURB ENG N1:1"), n1("TURB ENG N1:2")],
    engMode: mode == null ? null : Math.round(mode) === 2 ? "IGN/START" : "NORM",
    apu: on(p, "L:S_OH_ELEC_APU_MASTER"),
    apuBleed: on(p, "L:S_OH_PNEUMATIC_APU_BLEED"),
    extPower: on(p, "EXTERNAL POWER AVAILABLE:1"),
    xpdrCode: xcode != null && xcode >= 0 && xcode <= 7777 ? String(Math.round(xcode)).padStart(4, "0") : null,
    xpdrOn: xop == null ? null : xop >= 1,
    baro: kohl == null ? null : Math.abs(kohl - 1013.25) < 0.6 ? "STD" : Math.round(kohl),
    cabinAltFt: num(p, "PRESSURIZATION CABIN ALTITUDE") != null ? Math.round(num(p, "PRESSURIZATION CABIN ALTITUDE")! / 10) * 10 : null,
    weightKg: lb != null && lb > 1000 ? Math.round((lb * 0.45359237) / 100) * 100 : null,
    any: Object.keys(p).length > 0,
  };
}

/* ---------- the MCDU ---------- */

/**
 * A row as the Fenix shows it: real text is upper case, and lower-case letters are formatting
 * codes. s small, l large; c cyan, g green, w white, a amber, y yellow, m magenta. £ ¢ are the
 * left and right arrows, ¤ the scratchpad cursor.
 */
export type McduColour = "w" | "c" | "g" | "a" | "y" | "m";
export interface McduRun {
  text: string;
  colour: McduColour;
  small: boolean;
}
const COLOURS = new Set(["w", "c", "g", "a", "y", "m"]);

export function mcduRuns(row: string): McduRun[] {
  const out: McduRun[] = [];
  let colour: McduColour = "w";
  let small = false;
  for (const ch of row) {
    if (ch === "s" || ch === "l") small = ch === "s";
    else if (COLOURS.has(ch)) colour = ch as McduColour;
    else if (/[a-z]/.test(ch)) continue;
    else {
      const c = ch === "£" ? "←" : ch === "¢" ? "→" : ch === "¤" ? "" : ch;
      const last = out.at(-1);
      if (last && last.colour === colour && last.small === small) last.text += c;
      else out.push({ text: c, colour, small });
    }
  }
  return out;
}

/** A row as plain text: the codes out, the arrows as < >. */
export const mcduPlain = (row: string) =>
  row
    .replace(/[a-z]/g, "")
    .replace(/£/g, "<")
    .replace(/¢/g, ">")
    .replace(/¤/g, "");

export type McduKind = "perf" | "fpln" | "prog" | "fuelpred" | "initfuel" | "other";
export interface McduPage {
  unit: number;
  /** When it was read (ms). */
  t: number;
  /** As shown, codes and all. */
  rows: string[];
  kind: McduKind;
  /** The page's title, plain ("CRZ", "INIT FUEL PREDICTION", "FROM TST123"). */
  title: string;
}

/** What page a screen is, from its plain text (recordings before the title fix carry codes in it). */
export function mcduPage(unit: number, t: number, rows: unknown): McduPage | null {
  if (!Array.isArray(rows)) return null;
  const r = rows.filter((x): x is string => typeof x === "string").slice(0, 16).map((x) => x.slice(0, 80));
  if (!r.length) return null;
  const plain = r.map(mcduPlain);
  const title = (plain[0] ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  const all = plain.join("\n");
  const kind: McduKind = /^(TAKE OFF|CLB|CRZ|DES|APPR|GO AROUND)\b/.test(title)
    ? "perf"
    : /^INIT FUEL PREDICTION/.test(title)
      ? "initfuel"
      : /^FUEL PRED/.test(title)
        ? "fuelpred"
        : /^(CLB|CRZ|DES|TO|GA)?\s*PROG?\b/.test(title) || /\bPROG\b/.test(title) || /REPORT/.test(all) && /BRG \/DIST/.test(all)
          ? "prog"
          : /^FROM\b/.test(title) && /\bDEST\b/.test(all)
            ? "fpln"
            : "other";
  return { unit: unit === 2 ? 2 : 1, t, rows: r, kind, title: title.slice(0, 30) };
}

const hhmm = (s: string | undefined) => (s && /^\d{4}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2)}` : null);
const toNum = (s: string | undefined) => {
  if (!s) return null;
  const x = Number(s.replace(/^\./, "0."));
  return Number.isFinite(x) ? x : null;
};
const tokens = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** What the FMS says about the flight, from whichever pages have been seen. */
export interface FmsFigures {
  phase: string | null;
  /** Arrival at the destination, UTC "HH:MM". */
  utcDest: string | null;
  /** Fuel on board at the destination (t). */
  efob: number | null;
  costIndex: number | null;
  /** Top of descent: UTC "HH:MM" and distance (nm). */
  tdUtc: string | null;
  tdNm: number | null;
  /** Managed speed: Mach (".76") and/or kt. */
  managed: string | null;
  /** Distance to the destination (nm), from the F-PLN. */
  destNm: number | null;
  /** Before departure (INIT FUEL PREDICTION): trip fuel (t) and time, block, TOW, LW (t), extra fuel. */
  trip: number | null;
  tripTime: string | null;
  block: number | null;
  tow: number | null;
  lw: number | null;
  extra: number | null;
  /** When the newest of these was read (ms). */
  at: number | null;
}

const EMPTY: FmsFigures = { phase: null, utcDest: null, efob: null, costIndex: null, tdUtc: null, tdNm: null, managed: null, destNm: null, trip: null, tripTime: null, block: null, tow: null, lw: null, extra: null, at: null };

/** The figures from one page (only those it carries). */
export function pageFigures(pg: McduPage): Partial<FmsFigures> {
  const p = pg.rows.map(mcduPlain);
  const out: Partial<FmsFigures> = {};
  const after = (re: RegExp) => {
    const i = p.findIndex((x) => re.test(x));
    return i >= 0 && i + 1 < p.length ? tokens(p[i + 1]) : null;
  };
  if (pg.kind === "perf") {
    out.phase = pg.title.split(" ")[0];
    const d = after(/UTC DEST/);
    if (d && d.length >= 3) {
      out.utcDest = hhmm(d[1]);
      out.efob = toNum(d[2]);
    }
    const ci = after(/^\s*CI\b/);
    if (ci?.[0] && /^\d{1,3}$/.test(ci[0])) out.costIndex = Number(ci[0]);
    // CRZ: TO (T/D) over UTC and DIST
    if (p.some((x) => /\(T\/D\)/.test(x))) {
      const td = after(/MANAGED\s+UTC\s+DIST/);
      if (td && td.length >= 3) {
        out.managed = td[0];
        out.tdUtc = hhmm(td[1]);
        out.tdNm = toNum(td[2]);
      }
    } else {
      const m = after(/^\s*MANAGED\s*$/);
      if (m?.[0]) out.managed = m[0];
    }
  } else if (pg.kind === "fpln") {
    const d = after(/\bDEST\b.*\bUTC\b/);
    if (d && d.length >= 4) {
      out.utcDest = hhmm(d[1]);
      out.destNm = toNum(d[2]);
      out.efob = toNum(d[3]);
    }
    const tdRow = p.find((x) => /\(T\/D\)/.test(x));
    const tdT = tdRow ? tokens(tdRow.replace("(T/D)", "")).find((x) => /^\d{4}$/.test(x)) : undefined;
    if (tdT) out.tdUtc = hhmm(tdT);
  } else if (pg.kind === "initfuel") {
    const tr = after(/TRIP\/TIME/);
    if (tr) {
      const [trip, time] = (tr[0] ?? "").split("/");
      out.trip = toNum(trip);
      out.tripTime = hhmm(time);
      out.block = toNum(tr.at(-1));
    }
    const tw = after(/TOW\/\s*LW/);
    if (tw) {
      const j = tw.join(" ").split(/\s+/);
      const both = j.slice(-2).join("").split("/").map((x) => toNum(x));
      if (both.length === 2) [out.tow, out.lw] = both;
    }
    const ex = after(/EXTRA\/TIME/);
    if (ex?.length) out.extra = toNum(ex.at(-1)?.split("/")[0]);
  }
  return out;
}

/** The newest figures across the pages seen (each figure from the newest page that has it). */
export function fmsFigures(pages: McduPage[]): FmsFigures {
  const out: FmsFigures = { ...EMPTY };
  for (const pg of [...pages].sort((a, b) => a.t - b.t)) {
    const f = pageFigures(pg);
    let any = false;
    for (const [k, v] of Object.entries(f)) {
      if (v != null) {
        (out as unknown as Record<string, unknown>)[k] = v;
        any = true;
      }
    }
    if (any) out.at = pg.t;
  }
  return out;
}

/** Keeps the newest page of each kind and unit (and the last "other" page), at most a dozen. */
export function keepPages(pages: McduPage[], pg: McduPage): McduPage[] {
  const key = (x: McduPage) => `${x.unit}:${x.kind === "other" ? "other" : x.kind === "perf" ? `perf:${x.title.split(" ")[0]}` : x.kind}`;
  return [...pages.filter((x) => key(x) !== key(pg)), pg].sort((a, b) => a.t - b.t).slice(-12);
}

/** The page to show on the Flight deck side: the newest PROG, FUEL PRED, PERF or F-PLN (the ones with figures). */
export function deckPage(pages: McduPage[]): McduPage | null {
  const rank: Record<McduKind, number> = { prog: 5, fuelpred: 4, perf: 3, fpln: 2, initfuel: 1, other: 0 };
  const useful = pages.filter((x) => rank[x.kind] > 0);
  if (!useful.length) return null;
  const newest = Math.max(...useful.map((x) => x.t));
  // the newest, and among pages read within a minute of it the more telling one
  return useful.filter((x) => newest - x.t < 60_000).sort((a, b) => rank[b.kind] - rank[a.kind] || b.t - a.t)[0];
}

/* ---------- 1.16: changes worth a pop-up on the strip and the pills ---------- */

/** Something in the cockpit changed: "Flaps 2", "Gear DOWN", "AP1 ON". `t` on the readings' clock. */
export interface DeckEvent {
  key: string;
  text: string;
  /** on: switched on / extended; off: the other way; info: a value (squawk, baro). */
  tone: "on" | "off" | "info";
  t: number;
}

/** How long a pop-up stays (ms). */
export const EVENT_SHOW_MS = 30_000;

const LIGHT_NAME: Record<keyof AircraftStatus["lights"], string> = { beacon: "Beacon", strobe: "Strobe", nav: "Nav lights", landing: "Landing lights", nose: "Nose light", turnoff: "Runway turn-off lights" };
const lightWord = (v: boolean | Light | null) => (v == null ? null : v === true ? "ON" : v === false ? "OFF" : ({ off: "OFF", on: "ON", auto: "AUTO", taxi: "TAXI", to: "T.O", retracted: "RETRACTED" } as const)[v]);
const lit = (v: boolean | Light | null) => v === true || (typeof v === "string" && v !== "off" && v !== "retracted");
const onOff = (v: boolean | null) => (v ? "ON" : "OFF");

/** What changed between two readings of the cockpit (nothing for what wasn't known before). */
export function statusEvents(a: AircraftStatus, b: AircraftStatus, t: number): DeckEvent[] {
  const out: DeckEvent[] = [];
  const add = (key: string, before: unknown, after: unknown, text: string, tone: DeckEvent["tone"]) => {
    if (before == null || after == null || before === after) return;
    out.push({ key, text, tone, t });
  };
  for (const k of Object.keys(LIGHT_NAME) as (keyof AircraftStatus["lights"])[]) add(`light:${k}`, a.lights[k], b.lights[k], `${LIGHT_NAME[k]} ${lightWord(b.lights[k])}`, lit(b.lights[k]) ? "on" : "off");
  add("flaps", a.flaps, b.flaps, b.flaps === "UP" ? "Flaps UP" : `Flaps ${b.flaps}`, b.flaps === "UP" ? "off" : "on");
  // the gear: once it's up or down (not every moment in transit)
  if (b.gear !== "moving") add("gear", a.gear === "moving" ? null : a.gear, b.gear, `Gear ${b.gear?.toUpperCase()}`, b.gear === "down" ? "on" : "off");
  const sb = (x: AircraftStatus["speedbrake"]) => (x == null ? null : typeof x === "number" ? "out" : x);
  add("speedbrake", sb(a.speedbrake), sb(b.speedbrake), sb(b.speedbrake) === "armed" ? "Spoilers ARMED" : sb(b.speedbrake) === "out" ? "Speedbrake OUT" : "Speedbrake RETRACTED", sb(b.speedbrake) === "retracted" ? "off" : "on");
  add("autobrake", a.autobrake, b.autobrake, b.autobrake === "off" ? "Autobrake OFF" : `Autobrake ${b.autobrake}`, b.autobrake === "off" ? "off" : "on");
  add("ap1", a.ap1, b.ap1, `AP1 ${onOff(b.ap1)}`, b.ap1 ? "on" : "off");
  add("ap2", a.ap2, b.ap2, `AP2 ${onOff(b.ap2)}`, b.ap2 ? "on" : "off");
  add("athr", a.athr, b.athr, `A/THR ${onOff(b.athr)}`, b.athr ? "on" : "off");
  add("eng1", a.engines[0], b.engines[0], `Engine 1 ${onOff(b.engines[0])}`, b.engines[0] ? "on" : "off");
  add("eng2", a.engines[1], b.engines[1], `Engine 2 ${onOff(b.engines[1])}`, b.engines[1] ? "on" : "off");
  add("apu", a.apu, b.apu, `APU ${onOff(b.apu)}`, b.apu ? "on" : "off");
  add("baro", a.baro, b.baro, b.baro === "STD" ? "Baro STD" : `QNH ${b.baro}`, "info");
  add("squawk", a.xpdrCode, b.xpdrCode, `Squawk ${b.xpdrCode}`, "info");
  return out;
}

/** The pop-ups kept: the newest of each kind, from the last 5 minutes, at most eight. */
export function keepEvents(list: DeckEvent[], add: DeckEvent[], now: number): DeckEvent[] {
  const keys = new Set(add.map((e) => e.key));
  return [...list.filter((e) => !keys.has(e.key) && now - e.t < 5 * 60_000), ...add].slice(-8);
}

/** The pop-ups to show now (newest first, at most three). */
export const showEvents = (list: DeckEvent[] | null | undefined, now: number): DeckEvent[] =>
  (list ?? []).filter((e) => now - e.t >= -5_000 && now - e.t < EVENT_SHOW_MS).sort((a, b) => b.t - a.t).slice(0, 3);
