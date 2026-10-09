/** Derived facts about a flight: distance, block time, clock formatting, operating days. */
import type { Airport, FlightRow } from "./load";

const R_NM = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in nautical miles. */
export function gcNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Minutes from a to b on a 24h clock (wraps past midnight). */
export const span = (a: number, b: number) => (b - a + 1440) % 1440;

export type BlockSource = "scheduled" | "observed" | "estimated";
export interface Block {
  min: number;
  source: BlockSource;
}

/**
 * Gate-to-gate time. Scheduled STD→STA when the snapshot has both; else the observed
 * OUT→IN (or OFF→ON plus typical taxi); else an estimate from distance at a typical
 * jet block speed, so length filters still work for every flight.
 */
export function blockTime(f: FlightRow, nm: number | null): Block | null {
  if (f.std != null && f.sta != null) return { min: span(f.std, f.sta), source: "scheduled" };
  if (f.out != null && f.in != null) return { min: span(f.out, f.in), source: "observed" };
  if (f.off != null && f.on != null) return { min: span(f.off, f.on) + 22, source: "observed" };
  if (nm != null) return { min: Math.round(nm / 7.4 + 28), source: "estimated" };
  return null;
}

/** 890 → "14:50" */
export function hhmm(min: number | null | undefined): string | null {
  if (min == null || !Number.isFinite(min)) return null;
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 135 → "2h 15m" */
export function dur(min: number | null | undefined): string | null {
  if (min == null) return null;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Local clock time at an airport for a UTC time on a given date (default today). */
export function localHHMM(utcMin: number | null, tz: string | null, on: Date = new Date()): string | null {
  if (utcMin == null || !tz) return null;
  const d = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate(), 0, utcMin));
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  } catch {
    return null;
  }
}

/** UTC offset label at an airport, e.g. "UTC+2". */
export function tzLabel(tz: string | null, on: Date = new Date()): string | null {
  if (!tz) return null;
  try {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(on);
    return p.find((x) => x.type === "timeZoneName")?.value.replace("GMT", "UTC") ?? null;
  } catch {
    return null;
  }
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** [1,2,3,4,5,6,7] → "Daily"; [1,3,5] → "Mon Wed Fri" */
export function daysLabel(days: number[]): string | null {
  if (!days.length) return null;
  if (days.length === 7) return "Daily";
  return days.map((d) => DAY_NAMES[d - 1]).join(" ");
}

/** ISO weekday of a Date in UTC (1 = Mon). */
export const isoDay = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;

/* ---------- times by weekday ---------- */

const dayCache = new WeakMap<FlightRow, Map<number, FlightRow>>();

/**
 * The flight with the times it runs on ISO weekday `day` (from byDay; days not listed use the
 * flight's own times). Same id; `base` keeps the row it came from so any day can be derived
 * again. Rows that run alike every day come back unchanged. Cached, so it's cheap per render.
 */
export function onDay(f: FlightRow, day: number): FlightRow {
  const b = f.base ?? f;
  if (!b.byDay) return f;
  let m = dayCache.get(f);
  if (!m) dayCache.set(f, (m = new Map()));
  const hit = m.get(day);
  if (hit) return hit;
  const g = b.byDay.find(([days]) => days.includes(day));
  const t = g ? { std: g[1], sta: g[2], out: g[3], off: g[4], on: g[5], in: g[6] } : { std: b.std, sta: b.sta, out: b.out, off: b.off, on: b.on, in: b.in };
  const row = { ...f, ...t, day, base: b };
  m.set(day, row);
  return row;
}

/** Whether the flight's times change through the week. */
export const varies = (f: FlightRow) => !!(f.base ?? f).byDay;

export interface WeekDay {
  day: number;
  operates: boolean;
  f: FlightRow;
  /** Tracked sightings that weekday (null for timetable-only flights). */
  seen: number | null;
}
/** Mon..Sun with each day's times, for the brief's week table. */
export function weekTimes(f: FlightRow): WeekDay[] {
  const b = f.base ?? f;
  return [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, operates: !b.days.length || b.days.includes(day), f: onDay(f, day), seen: b.seen ? b.seen[day - 1] : null }));
}

/** The operating days split by their times: one entry per set of weekdays that run alike (one entry when nothing varies). */
export function dayGroups(f: FlightRow): { days: number[]; f: FlightRow }[] {
  if (!varies(f)) return [{ days: f.days, f }];
  const key = (x: FlightRow) => [x.std, x.sta, x.out, x.off, x.on, x.in].join(",");
  const out: { days: number[]; f: FlightRow }[] = [];
  for (const w of weekTimes(f)) {
    if (!w.operates) continue;
    const g = out.find((g) => key(g.f) === key(w.f));
    if (g) g.days.push(w.day);
    else out.push({ days: [w.day], f: w.f });
  }
  return out;
}

/**
 * The next UTC departure of a flight on or after `from`: the first operating day whose
 * STD is still ahead. Unknown days count as daily; unknown STD gives the date at 12:00Z.
 */
export function nextDeparture(f: FlightRow, from: Date = new Date()): Date {
  for (let i = 0; i < 8; i++) {
    const day0 = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + i));
    const d = new Date(day0.getTime() + (onDay(f, isoDay(day0)).std ?? 720) * 60_000);
    if (d.getTime() < from.getTime()) continue;
    if (!f.days.length || f.days.includes(isoDay(d))) return d;
  }
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 0, f.std ?? 720));
}

/**
 * How a flight is named: the marketing number when the snapshot has one ("U2 1016"),
 * else its ATC callsign ("EJU54LH"), which is how most tracked flights are known.
 */
export function flightNo(f: FlightRow, iata: string | null): string {
  if (f.fn) return `${iata ?? f.al} ${f.fn}`;
  return f.cs ?? `${f.op} —`;
}

/**
 * SimBrief's flight-number field: the real number, or the callsign's suffix ("54LH" from
 * EJU54LH), which SimBrief accepts and which keeps the OFP's flight id equal to the callsign.
 */
export function fltnum(f: FlightRow): string {
  if (f.fn) return f.fn;
  if (f.cs && f.cs.startsWith(f.op)) return f.cs.slice(f.op.length);
  return f.cs ?? "";
}

/** Planned off-block (UTC min): scheduled, observed OUT, or observed OFF less typical taxi-out. */
export function plannedOut(f: FlightRow): number | null {
  if (f.std != null) return f.std;
  if (f.out != null) return f.out;
  if (f.off != null) return (f.off - 12 + 1440) % 1440;
  return null;
}

/** Aircraft type families, so a saved airframe can stand in for its siblings. */
const FAMILIES: Record<string, string[]> = {
  "A320 family": ["A318", "A319", "A320", "A321", "A19N", "A20N", "A21N"],
  "737": ["B731", "B732", "B733", "B734", "B735", "B736", "B737", "B738", "B739", "B37M", "B38M", "B39M", "B3XM"],
  "A220": ["BCS1", "BCS3"],
  "E-Jet": ["E170", "E175", "E190", "E195", "E290", "E295"],
  ATR: ["AT43", "AT45", "AT72", "AT75", "AT76"],
  "Dash 8": ["DH8A", "DH8B", "DH8C", "DH8D"],
  CRJ: ["CRJ1", "CRJ2", "CRJ7", "CRJ9", "CRJX"],
  "757/767": ["B752", "B753", "B762", "B763", "B764"],
  "A330/A350": ["A332", "A333", "A338", "A339", "A359", "A35K"],
  "787": ["B788", "B789", "B78X"],
  "777": ["B772", "B77L", "B77W", "B773", "B778", "B779"],
};
const FAMILY_OF = new Map(Object.entries(FAMILIES).flatMap(([fam, types]) => types.map((t) => [t, fam] as const)));
export const familyOf = (type: string) => FAMILY_OF.get(type) ?? type;

/** The airport's own name ("Birmingham Airport", "London Heathrow Airport"); the city field is often a suburb or carries a region, so it isn't prefixed. */
export function airportLabel(a: Airport | undefined | null): string {
  return a ? a.name : "";
}

/**
 * The city an airport serves, where OurAirports names the suburb or parish it stands in
 * (Ferno for Milan Malpensa, Zaventem for Brussels). Only airports in the snapshot.
 */
const SERVES: Record<string, string> = {
  EBBR: "Brussels", EBLG: "Liège", EDDG: "Münster", EDDP: "Leipzig", EDFH: "Frankfurt-Hahn", EDLP: "Paderborn", EDSB: "Karlsruhe",
  EGJB: "Guernsey", EGJJ: "Jersey", EGMC: "Southend", EGNJ: "Humberside", EGNS: "Isle of Man", EGNV: "Teesside", EGNX: "East Midlands",
  EGPB: "Sumburgh", EGPH: "Edinburgh", EGPL: "Benbecula", EIKN: "Knock", EIKY: "Kerry", ENDU: "Bardufoss", ENEV: "Harstad/Narvik",
  EPKK: "Kraków", EPMO: "Warsaw Modlin", EPSY: "Olsztyn", EPZG: "Zielona Góra", ESKN: "Stockholm Skavsta", GCFV: "Fuerteventura",
  GCLA: "La Palma", GCLP: "Gran Canaria", GCRR: "Lanzarote", GMAD: "Agadir", GMML: "Laayoune", GVAC: "Sal", GVBA: "Boa Vista",
  GVSV: "São Vicente", HESX: "Cairo Sphinx", LATI: "Tirana", LCEN: "Ercan", LDSB: "Brač", LDZA: "Zagreb", LEAS: "Asturias",
  LECO: "A Coruña", LEMH: "Menorca", LEMI: "Murcia", LESO: "San Sebastián", LEST: "Santiago", LEVT: "Vitoria", LFJL: "Metz-Nancy",
  LFLL: "Lyon", LFML: "Marseille", LFQQ: "Lille", LFRN: "Rennes", LFTH: "Toulon-Hyères", LGAV: "Athens", LGSA: "Chania",
  LGPZ: "Preveza", LIBC: "Crotone", LIME: "Bergamo", LIMC: "Milan Malpensa", LIMF: "Turin", LIMZ: "Cuneo", LIPQ: "Trieste",
  LIPX: "Verona", LIPY: "Ancona", LJLJ: "Ljubljana", LKMT: "Ostrava", LPAZ: "Santa Maria", LPLA: "Terceira", LQBK: "Banja Luka",
  LQTZ: "Tuzla", LROP: "Bucharest", LRTM: "Târgu Mureș", LTAF: "Adana", LTBJ: "Izmir", LTBZ: "Kütahya", LTDA: "Hatay",
  LTFD: "Edremit", LTFJ: "Istanbul Sabiha Gökçen", LWSK: "Skopje", LYBT: "Belgrade Batajnica", OERS: "Red Sea", OENN: "Neom",
  UGKO: "Kutaisi", EFKE: "Kemi-Tornio", EFKK: "Kokkola", DTTJ: "Djerba", GMFO: "Oujda",
};

/** The city an airport serves, without its region: "Birmingham, West Midlands" → "Birmingham", "Paris (Orly, Val-de-Marne)" → "Paris". */
export function cityName(a: Airport | undefined | null): string | null {
  if (!a) return null;
  return SERVES[a.icao] ?? (a.city ? a.city.split(/\s*[,(]/)[0].trim() || a.city : null);
}

/* ---------- the four OOOI times for display, with where each came from ---------- */

export type TimeKind = "sched" | "obs" | "est";
export interface Moment {
  t: number;
  kind: TimeKind;
}
export interface FourTimes {
  out: Moment | null;
  off: Moment | null;
  on: Moment | null;
  in: Moment | null;
}

const TAXI_OUT = 12;
const TAXI_IN = 6;
const wrap = (m: number) => ((m % 1440) + 1440) % 1440;

/**
 * OUT / OFF / ON / IN for the flight card: the schedule (gate times), else the tracked medians,
 * else estimates from the neighbouring time with typical taxi (12 min out, 6 min in), and for
 * the arrival end from the departure plus block time. Estimates are marked so the UI can badge them.
 */
export function fourTimes(f: FlightRow, blockMin: number | null): FourTimes {
  const m = (t: number | null | undefined, kind: TimeKind): Moment | null => (t == null ? null : { t: wrap(t), kind });
  const out = m(f.std, "sched") ?? m(f.out, "obs") ?? (f.off != null ? m(f.off - TAXI_OUT, "est") : null);
  const off = m(f.off, "obs") ?? (out ? m(out.t + TAXI_OUT, "est") : null);
  let inn = m(f.sta, "sched") ?? m(f.in, "obs") ?? (f.on != null ? m(f.on + TAXI_IN, "est") : null);
  if (!inn && out && blockMin != null) inn = m(out.t + blockMin, "est");
  const on = m(f.on, "obs") ?? (inn ? m(inn.t - TAXI_IN, "est") : null);
  return { out, off, on, in: inn };
}
