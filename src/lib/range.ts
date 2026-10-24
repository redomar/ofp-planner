/**
 * Still-air range for the sim A320-family aircraft, from each developer's own SimBrief airframe
 * (OEW, MZFW, MTOW, MLW, tank capacity), for three loads: empty (ZFW = OEW), half (ZFW halfway to
 * MZFW) and full (ZFW = MZFW, or less where the MLW says so), or the user's own ZFW and fuel.
 * Unless the user sets the fuel, it is as much as fits: the tanks, what the MTOW leaves, or what
 * the MLW leaves, whichever is least. Each aircraft checks the user's figures against its own
 * limits (OEW, MZFW, tanks, MTOW, MLW), so one ZFW can suit an A321 and be impossible in an A319.
 *
 * The distance comes from the Breguet range equation, R = K · ln(W_takeoff / W_landing), with K
 * (true airspeed × L/D ÷ fuel burn, in NM) set so the model lands within about 10% of Airbus's
 * published ranges. It keeps 200 kg taxi, 5% contingency, a 200 NM alternate and 30 min final
 * reserve, then takes 5% and 40 NM off for the climb, descent and routing. Treat the result as ±5%.
 */
import { readJSON, writeJSON, KEYS } from "./storage";

/** 0–2: empty, half and full payload; 3: the user's own ZFW and fuel. */
export type Load = 0 | 1 | 2 | 3;
export const LOADS: { v: Load; label: string; tip: string }[] = [
  { v: 0, label: "Empty", tip: "No payload: ZFW = OEW. Fuel: as much as fits." },
  { v: 1, label: "Half", tip: "Half the max payload: ZFW halfway between OEW and MZFW. Fuel: as much as fits." },
  { v: 2, label: "Full", tip: "Max payload: ZFW = MZFW, or less if landing with the reserves would pass the MLW. Fuel: as much as fits." },
  { v: 3, label: "Custom", tip: "Your own ZFW, and your own fuel or as much as fits." },
];

/** The user's own figures, kg. A null FOB means as much as fits. */
export interface Custom {
  zfw: number;
  fob: number | null;
}
export const DEFAULT_CUSTOM: Custom = { zfw: 55000, fob: null };

export type Family = "A319" | "A320" | "A321" | "A20N";
export interface Plane {
  id: string;
  dev: "Fenix" | "FlyByWire" | "iniBuilds";
  family: Family;
  engine: "CFM" | "IAE" | "LEAP";
  sharklets: boolean;
  act: 0 | 1 | 2;
  /** kg, from the developer's SimBrief airframe. */
  oew: number;
  mzfw: number;
  mtow: number;
  mlw: number;
  fuel: number;
  /** Engine types as SimBrief lists them. */
  engines: string;
}

const CEO = 13284; // K for a CFM A320ceo without sharklets
const K_SHARKLETS = 1.03; // the developers' SimBrief profiles burn 3% less with sharklets
const K_IAE = 1.015; // V2500s burn about 1.5% less than CFM56s
const K_NEO = 1.15; // LEAP-1A: about 15% less than the ceo

const fenix = (family: "A319" | "A320" | "A321", w: Pick<Plane, "oew" | "mzfw" | "mtow" | "mlw" | "fuel">, engines: [string, string]) =>
  (["CFM", "IAE"] as const).flatMap((engine, e) =>
    [false, true].map(
      (sharklets): Plane => ({ id: `fnx-${family}-${engine}${sharklets ? "-sl" : ""}`.toLowerCase(), dev: "Fenix", family, engine, sharklets, act: 0, ...w, engines: engines[e] }),
    ),
  );

/** Fenix A321: the sharklet airframes are 374 kg heavier; each ACT adds 300 kg empty and 2,349 kg of fuel. */
const fenix321 = (["CFM", "IAE"] as const).flatMap((engine) =>
  [false, true].flatMap((sharklets) =>
    ([0, 1, 2] as const).map(
      (act): Plane => ({
        id: `fnx-a321-${engine}${sharklets ? "-sl" : ""}${act ? `-act${act}` : ""}`.toLowerCase(),
        dev: "Fenix",
        family: "A321",
        engine,
        sharklets,
        act,
        oew: 49202 + (sharklets ? 374 : 0) + act * 300,
        mzfw: 75600,
        mtow: 93500,
        mlw: 77800,
        fuel: [18644, 20993, 23342][act],
        engines: engine === "CFM" ? "CFM56-5B3" : "IAE V2533-A5",
      }),
    ),
  ),
);

export const PLANES: Plane[] = [
  ...fenix("A319", { oew: 41910, mzfw: 58500, mtow: 75500, mlw: 62500, fuel: 19004 }, ["CFM56-5B6 (5B7 with sharklets)", "IAE V2524-A5"]),
  ...fenix("A320", { oew: 44029, mzfw: 61000, mtow: 73500, mlw: 64500, fuel: 19004 }, ["CFM56-5B4/P", "IAE V2527-A5"]),
  ...fenix321,
  { id: "fbw-a20n", dev: "FlyByWire", family: "A20N", engine: "LEAP", sharklets: true, act: 0, oew: 42500, mzfw: 64300, mtow: 79000, mlw: 67400, fuel: 19046, engines: "LEAP-1A26" },
  { id: "ini-a20n", dev: "iniBuilds", family: "A20N", engine: "LEAP", sharklets: true, act: 0, oew: 42500, mzfw: 62800, mtow: 79000, mlw: 66300, fuel: 19050, engines: "LEAP-1A26" },
];
export const planeById = new Map(PLANES.map((p) => [p.id, p]));

/** "A320 IAE · sharklets · 2 ACT", or the product name for the neos. */
export function planeName(p: Plane, withFamily = true): string {
  if (p.family === "A20N") return p.dev === "FlyByWire" ? "FlyByWire A32NX" : "iniBuilds A320neo V2";
  return [withFamily ? `${p.family} ${p.engine}` : p.engine, p.sharklets && "sharklets", p.act && `${p.act} ACT`].filter(Boolean).join(" · ");
}

export const FAMILIES: { family: Family; title: string }[] = [
  { family: "A319", title: "Fenix A319" },
  { family: "A320", title: "Fenix A320" },
  { family: "A321", title: "Fenix A321" },
  { family: "A20N", title: "A320neo" },
];

const k = (p: Plane) => CEO * (p.family === "A20N" ? K_NEO : (p.sharklets ? K_SHARKLETS : 1) * (p.engine === "IAE" ? K_IAE : 1));

export const TAXI = 200; // kg
const ALTERNATE_NM = 200;

/**
 * kg. ZFW + FOB is the ramp weight; less the taxi fuel, the take-off weight (TOW); less the trip
 * fuel, the landing weight (LW), which is the ZFW plus the reserves still in the tanks.
 */
export interface RangeResult {
  ok: true;
  nm: number;
  zfw: number;
  /** ZFW − OEW. */
  payload: number;
  /** Fuel on board at the ramp (block fuel). */
  block: number;
  tow: number;
  /** Landing weight: ZFW + reserves. */
  ldw: number;
  taxi: number;
  trip: number;
  /** Contingency, alternate and final reserve: still in the tanks on landing. */
  reserve: number;
  /** What set the fuel: full tanks, the MTOW, the MLW (more fuel means more contingency to land with), or the user. */
  limit: "tanks" | "MTOW" | "MLW" | "FOB";
  /** The preset payload was cut so the landing weight stays within the MLW. */
  capped: boolean;
}
/** The figures don't work for this aircraft; `why` says which of its limits they break. */
export interface RangeBlocked {
  ok: false;
  why: string;
  zfw: number;
  block: number | null;
}

const t1 = (kg: number) => (kg / 1000).toFixed(1);

/** Final reserve (30 min at about 1.85% of the weight per hour) and alternate (a short leg flies ~35% less efficiently). */
const reserves = (p: Plane, zfw: number) => ({ hold: 0.5 * 0.0185 * zfw, alternate: zfw * (Math.exp((ALTERNATE_NM * 1.35) / k(p)) - 1) });

/**
 * As much fuel as fits: the least of full tanks, what the MTOW leaves, and what the MLW leaves.
 * Trip fuel carries 5% contingency, which is still aboard on landing, so LW = ZFW + hold +
 * alternate + (FOB − taxi − hold − alternate) / 21, and LW ≤ MLW caps the FOB.
 */
function maxFuel(p: Plane, zfw: number): { block: number; limit: "tanks" | "MTOW" | "MLW" } {
  const { hold, alternate } = reserves(p, zfw);
  const byMlw = TAXI + hold + alternate + 21 * (p.mlw - zfw - hold - alternate);
  const byMtow = p.mtow - zfw + TAXI;
  if (byMlw < Math.min(p.fuel, byMtow)) return { block: byMlw, limit: "MLW" };
  return byMtow < p.fuel ? { block: byMtow, limit: "MTOW" } : { block: p.fuel, limit: "tanks" };
}

/**
 * The most this aircraft can carry with fuel to the tanks or the MTOW: the MZFW, unless landing
 * with the reserves would pass the MLW first (the Fenix A321: MZFW 75.6 t, MLW 77.8 t).
 */
const maxZfwCache = new Map<string, number>();
export function maxZfw(p: Plane): number {
  let z = maxZfwCache.get(p.id);
  if (z === undefined) {
    let lo = p.oew,
      hi = p.mzfw;
    if (maxFuel(p, hi).limit === "MLW")
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (maxFuel(p, mid).limit === "MLW") hi = mid;
        else lo = mid;
      }
    else lo = hi;
    z = Math.floor(lo / 10) * 10;
    maxZfwCache.set(p.id, z);
  }
  return z;
}

/** The ZFW for a load: empty, half or all of the payload this aircraft can carry; for custom, the user's (which it may not allow). */
export const zfwFor = (p: Plane, load: Load, custom: Custom) => (load === 3 ? custom.zfw : p.oew + ((maxZfw(p) - p.oew) * load) / 2);

export function rangeOf(p: Plane, load: Load, custom: Custom = DEFAULT_CUSTOM): RangeResult | RangeBlocked {
  const zfw = zfwFor(p, load, custom);
  const fob = load === 3 ? custom.fob : null;
  if (zfw < p.oew) return { ok: false, why: `ZFW is under its OEW (${t1(p.oew)} t)`, zfw, block: fob };
  if (zfw > p.mzfw) return { ok: false, why: `ZFW is over its MZFW (${t1(p.mzfw)} t)`, zfw, block: fob };
  if (fob !== null && fob > p.fuel) return { ok: false, why: `FOB is more than its tanks hold (${t1(p.fuel)} t)`, zfw, block: fob };
  if (fob !== null && zfw + fob - TAXI > p.mtow)
    return { ok: false, why: `Take-off weight ${t1(zfw + fob - TAXI)} t is over its MTOW (${t1(p.mtow)} t)`, zfw, block: fob };
  const K = k(p);
  const { hold, alternate } = reserves(p, zfw);
  const most = maxFuel(p, zfw);
  const block = fob ?? most.block;
  const tow = zfw + block - TAXI;
  const trip = (tow - zfw - hold - alternate) / 1.05; // 5% contingency on top
  const ldw = tow - trip;
  if (ldw > p.mlw + 1)
    return {
      ok: false,
      why: `Landing weight ${t1(ldw)} t (ZFW + reserves) is over its MLW (${t1(p.mlw)} t)${fob !== null && most.limit === "MLW" && most.block > TAXI ? `: ${t1(most.block)} t FOB at most` : ""}`,
      zfw,
      block,
    };
  const nm = trip > 0 ? K * Math.log(tow / (tow - trip)) * 0.95 - 40 : 0;
  if (nm < 50)
    return {
      ok: false,
      why: fob === null ? `Landing with the reserves would pass its MLW (${t1(p.mlw)} t)` : `FOB doesn't cover taxi and reserves (${t1(TAXI + hold + alternate)} t) with a trip to spare`,
      zfw,
      block,
    };
  return {
    ok: true,
    nm: Math.round(nm / 10) * 10,
    zfw,
    payload: zfw - p.oew,
    block,
    tow,
    ldw,
    taxi: TAXI,
    trip,
    reserve: block - TAXI - trip,
    limit: fob !== null ? "FOB" : most.limit,
    capped: load === 2 && zfw < p.mzfw,
  };
}

/* ---------- great circles ---------- */

const R_NM = 3440.065;
export const NM_PER_DEG = (Math.PI * R_NM) / 180;

/* ---------- what the page remembers ---------- */

export interface RangePlace {
  icao: string;
  name: string;
  lat: number;
  lon: number;
}
export interface RangeState {
  origin: string;
  load: Load;
  custom: Custom;
  /** Height and depth bands and lettering on the map (off: plain land and sea). */
  relief: boolean;
  planes: string[];
  /** Airports the user added; coordinates kept so hand-entered ones survive. */
  mine: RangePlace[];
}

export const DEFAULT_PLANES = ["fnx-a319-cfm", "fnx-a320-cfm", "fnx-a321-cfm", "fnx-a321-cfm-act2", "fbw-a20n", "ini-a20n"];
export const BEST_PLANES = ["fnx-a319-iae-sl", "fnx-a320-iae-sl", "fnx-a321-iae-sl", "fnx-a321-iae-sl-act2", "fbw-a20n", "ini-a20n"];
/** Seeded on first visit; the user asked for these to try as origins and destinations. */
const DEFAULT_MINE = ["LEPA", "LEMD", "LSGG", "ENBR", "TNCM"];

export const DEFAULT_STATE: RangeState = { origin: "EGLL", load: 1, custom: DEFAULT_CUSTOM, relief: false, planes: DEFAULT_PLANES, mine: [] };

/** Reads the saved state; `seed` resolves the default airports the first time. */
export function readRange(seed: (icao: string) => RangePlace | null): RangeState {
  const raw = readJSON<Partial<RangeState> | null>(KEYS.range, null);
  if (!raw) return { ...DEFAULT_STATE, mine: DEFAULT_MINE.flatMap((i) => seed(i) ?? []) };
  const okPlace = (m: unknown): m is RangePlace =>
    !!m && typeof m === "object" && typeof (m as RangePlace).icao === "string" && Number.isFinite((m as RangePlace).lat) && Number.isFinite((m as RangePlace).lon);
  const c = raw.custom;
  const kg = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 200000 ? v : undefined);
  return {
    origin: typeof raw.origin === "string" ? raw.origin : DEFAULT_STATE.origin,
    load: raw.load === 0 || raw.load === 1 || raw.load === 2 || raw.load === 3 ? raw.load : DEFAULT_STATE.load,
    custom: { zfw: kg(c?.zfw) ?? DEFAULT_CUSTOM.zfw, fob: c?.fob === null ? null : (kg(c?.fob) ?? DEFAULT_CUSTOM.fob) },
    relief: raw.relief === true,
    planes: Array.isArray(raw.planes) ? raw.planes.filter((id) => planeById.has(id)) : DEFAULT_PLANES,
    mine: Array.isArray(raw.mine) ? raw.mine.filter(okPlace) : [],
  };
}
export const writeRange = (s: RangeState) => writeJSON(KEYS.range, s);

/**
 * Airports for scale beyond the snapshot's own (which are almost all in Europe): the long-haul
 * end of what these aircraft can reach from western Europe.
 */
export const REFERENCE: RangePlace[] = [
  { icao: "KJFK", name: "New York JFK", lat: 40.6398, lon: -73.7789 },
  { icao: "KBOS", name: "Boston Logan", lat: 42.3656, lon: -71.0096 },
  { icao: "CYUL", name: "Montréal Trudeau", lat: 45.4706, lon: -73.7408 },
  { icao: "CYYZ", name: "Toronto Pearson", lat: 43.6772, lon: -79.6306 },
  { icao: "CYHZ", name: "Halifax Stanfield", lat: 44.8808, lon: -63.5086 },
  { icao: "CYYT", name: "St. John's", lat: 47.6186, lon: -52.7519 },
  { icao: "KIAD", name: "Washington Dulles", lat: 38.9445, lon: -77.4558 },
  { icao: "KORD", name: "Chicago O'Hare", lat: 41.9786, lon: -87.9048 },
  { icao: "KATL", name: "Atlanta", lat: 33.6367, lon: -84.4281 },
  { icao: "KMIA", name: "Miami", lat: 25.7932, lon: -80.2906 },
  { icao: "KDFW", name: "Dallas/Fort Worth", lat: 32.8998, lon: -97.0403 },
  { icao: "KDEN", name: "Denver", lat: 39.8617, lon: -104.6731 },
  { icao: "TXKF", name: "Bermuda", lat: 32.364, lon: -64.6787 },
  { icao: "TBPB", name: "Barbados", lat: 13.0746, lon: -59.4925 },
  { icao: "MDPC", name: "Punta Cana", lat: 18.5674, lon: -68.3634 },
  { icao: "SBRF", name: "Recife", lat: -8.1265, lon: -34.9236 },
  { icao: "SBFZ", name: "Fortaleza", lat: -3.7763, lon: -38.5326 },
  { icao: "FNLU", name: "Luanda", lat: -8.8584, lon: 13.2312 },
  { icao: "HKJK", name: "Nairobi", lat: -1.3192, lon: 36.9278 },
  { icao: "HTDA", name: "Dar es Salaam", lat: -6.8781, lon: 39.2026 },
  { icao: "FAOR", name: "Johannesburg", lat: -26.1392, lon: 28.246 },
  { icao: "VIDP", name: "Delhi", lat: 28.5665, lon: 77.1031 },
  { icao: "VABB", name: "Mumbai", lat: 19.0887, lon: 72.8679 },
  { icao: "OPKC", name: "Karachi", lat: 24.9065, lon: 67.1608 },
  { icao: "VNKT", name: "Kathmandu", lat: 27.6966, lon: 85.3591 },
  { icao: "VGHS", name: "Dhaka", lat: 23.8433, lon: 90.3978 },
  { icao: "VCBI", name: "Colombo", lat: 7.1808, lon: 79.8841 },
  { icao: "UTTT", name: "Tashkent", lat: 41.2579, lon: 69.2812 },
  { icao: "UAAA", name: "Almaty", lat: 43.3521, lon: 77.0405 },
  { icao: "UNNT", name: "Novosibirsk", lat: 55.0126, lon: 82.6507 },
  { icao: "ZBAA", name: "Beijing Capital", lat: 40.0801, lon: 116.5846 },
  { icao: "VTBS", name: "Bangkok Suvarnabhumi", lat: 13.69, lon: 100.7501 },
  { icao: "TNCM", name: "St Maarten Princess Juliana", lat: 18.041, lon: -63.1089 },
];
