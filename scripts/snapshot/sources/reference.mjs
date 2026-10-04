// Reference data: airports (OurAirports + mwgg/Airports for time zones), aircraft registry
// (hex → ICAO type), and the VRS standing-data callsign → route table.
//
//  OurAirports            public domain       airports, coordinates, elevation, IATA, type
//  mwgg/Airports          MIT                 IANA time zone per airport ICAO
//  vradarserver/standing-data  CC0 1.0        callsign → route, airline positioning patterns,
//                                             aircraft registry (secondary)
//  wiedehopf/tar1090-db   (Mictronics-derived, community ADS-B registry, no licence stated)
//                                             hex → ICAO type (primary; only the type designator
//                                             is used, nothing is redistributed)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { AIRLINES } from "../airlines.mjs";
import { RAW, cachedFetch, distNm, log, parseCsv } from "../util.mjs";

// ---------------------------------------------------------------------------- airports

export async function loadAirports({ refresh = false } = {}) {
  const maxAgeH = refresh ? 0 : 24 * 30;
  const oa = parseCsv(
    (await cachedFetch("https://davidmegginson.github.io/ourairports-data/airports.csv", join(RAW, "ourairports/airports.csv"), { maxAgeH })).toString("utf8"),
  );
  const mw = JSON.parse(
    (await cachedFetch("https://raw.githubusercontent.com/mwgg/Airports/master/airports.json", join(RAW, "mwgg/airports.json"), { maxAgeH })).toString("utf8"),
  );
  const tzPoints = Object.values(mw).filter((a) => a.tz);

  /** icao → {icao, iata, name, city, country, lat, lon, elev, tz, sched, kind} */
  const byIcao = new Map();
  for (const a of oa) {
    if (!["large_airport", "medium_airport", "small_airport"].includes(a.type)) continue;
    const icao = /^[A-Z]{4}$/.test(a.icao_code) ? a.icao_code : /^[A-Z]{4}$/.test(a.gps_code) ? a.gps_code : /^[A-Z]{4}$/.test(a.ident) ? a.ident : null;
    if (!icao) continue;
    const sched = a.scheduled_service === "yes";
    const iata = /^[A-Z]{3}$/.test(a.iata_code) ? a.iata_code : null;
    if (!sched && !iata && a.type === "small_airport") continue;
    byIcao.set(icao, {
      icao,
      iata,
      name: a.name,
      city: a.municipality || null,
      country: a.iso_country || null,
      lat: +a.latitude_deg,
      lon: +a.longitude_deg,
      elev: a.elevation_ft === "" ? null : +a.elevation_ft,
      tz: mw[icao]?.tz || null,
      sched,
      kind: a.type,
    });
  }
  // time zone fallback: nearest mwgg airport in the same country within 150 NM
  for (const a of byIcao.values()) {
    if (a.tz) continue;
    let best = null;
    let bd = 150;
    for (const p of tzPoints) {
      if (p.country !== a.country) continue;
      const d = distNm(a.lat, a.lon, p.lat, p.lon);
      if (d < bd) [best, bd] = [p, d];
    }
    if (best) a.tz = best.tz;
  }
  const byIata = new Map();
  for (const a of byIcao.values()) {
    if (!a.iata) continue;
    const prev = byIata.get(a.iata);
    // prefer scheduled, then larger
    const rank = (x) => (x.sched ? 10 : 0) + (x.kind === "large_airport" ? 2 : x.kind === "medium_airport" ? 1 : 0);
    if (!prev || rank(a) > rank(prev)) byIata.set(a.iata, a);
  }
  log(`airports: ${byIcao.size} with ICAO codes, ${byIata.size} with IATA`);
  return { byIcao, byIata, index: buildIndex(byIcao) };
}

/** 1°×1° grid of airports that can be a flight's end (scheduled service or large/medium). */
function buildIndex(byIcao) {
  const grid = new Map();
  for (const a of byIcao.values()) {
    if (!a.sched && a.kind === "small_airport") continue;
    const k = `${Math.floor(a.lat)},${Math.floor(a.lon)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(a);
  }
  return grid;
}

/**
 * Nearest airport to a point within `maxNm`, preferring airports with scheduled service.
 * `altFt` (pressure altitude, -1 = ground) must be within reach of the field elevation.
 */
export function nearestAirport(index, lat, lon, altFt, maxNm = 10, maxAgl = 4500) {
  let best = null;
  let bestScore = Infinity;
  const la = Math.floor(lat);
  const lo = Math.floor(lon);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const cell = index.get(`${la + i},${lo + j}`);
      if (!cell) continue;
      for (const a of cell) {
        const d = distNm(lat, lon, a.lat, a.lon);
        if (d > maxNm) continue;
        if (altFt >= 0 && a.elev != null && altFt - a.elev > maxAgl) continue;
        // scheduled airports win ties within a couple of miles
        const score = d - (a.sched ? 2 : 0) - (a.kind === "large_airport" ? 1 : 0);
        if (score < bestScore) [best, bestScore] = [a, score];
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------- standing data

const SD_REPO = "https://github.com/vradarserver/standing-data.git";

export function syncStandingData({ refresh = false } = {}) {
  const dir = join(RAW, "sd");
  if (!existsSync(join(dir, ".git"))) {
    log("standing-data: cloning (sparse, shallow)");
    execFileSync("git", ["clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse", SD_REPO, dir], { stdio: "inherit" });
    execFileSync("git", ["-C", dir, "sparse-checkout", "set", "routes", "airlines", "aircraft"], { stdio: "inherit" });
  } else if (refresh) {
    log("standing-data: pulling");
    execFileSync("git", ["-C", dir, "pull", "-q", "--depth", "1", "--rebase=false"], { stdio: "inherit" });
  }
  const sha = execFileSync("git", ["-C", dir, "log", "-1", "--format=%H %cI"]).toString().trim();
  return { dir, sha };
}

/** callsign → array of airport-code arrays (["LEMD","LFSB"]), for configured operators only. */
export function loadSdRoutes(dir) {
  const ops = new Set(AIRLINES.flatMap((a) => a.operators));
  const routes = new Map();
  const base = join(dir, "routes/schema-01");
  for (const letter of readdirSync(base)) {
    const sub = join(base, letter);
    if (!/^[A-Z0-9]$/.test(letter)) continue;
    for (const f of readdirSync(sub)) {
      if (!f.endsWith(".csv")) continue;
      if (!ops.has(f.slice(0, 3))) continue;
      for (const r of parseCsv(readFileSync(join(sub, f), "utf8"))) {
        const codes = r.AirportCodes.split("-").filter(Boolean);
        if (codes.length < 2) continue;
        if (!routes.has(r.Callsign)) routes.set(r.Callsign, []);
        routes.get(r.Callsign).push(codes);
      }
    }
  }
  log(`standing-data: ${routes.size} callsign routes for configured operators`);
  return routes;
}

/** operator ICAO → RegExp of positioning flight numbers (from airlines.csv). */
export function loadSdAirlines(dir) {
  const rows = parseCsv(readFileSync(join(dir, "airlines/schema-01/airlines.csv"), "utf8"));
  const out = new Map();
  for (const r of rows) {
    if (!r.ICAO) continue;
    let pos = null;
    try {
      pos = r.PositioningFlightPattern ? new RegExp(`^(?:${r.PositioningFlightPattern})$`) : null;
    } catch {
      /* ignore malformed patterns */
    }
    out.set(r.ICAO, { name: r.Name, iata: r.IATA || null, positioning: pos });
  }
  return out;
}

// ---------------------------------------------------------------------------- aircraft types

/** hex (lowercase) → ICAO type designator. tar1090-db first, VRS registry fills gaps. */
export async function loadAircraftTypes(sdDir, { refresh = false } = {}) {
  const types = new Map();
  const buf = await cachedFetch("https://github.com/wiedehopf/tar1090-db/raw/refs/heads/csv/aircraft.csv.gz", join(RAW, "tar1090-db/aircraft.csv.gz"), {
    maxAgeH: refresh ? 0 : 24 * 14,
  });
  for (const line of gunzipSync(buf).toString("utf8").split("\n")) {
    const [hex, , type] = line.split(";");
    if (hex && type && /^[A-Z0-9]{2,4}$/.test(type)) types.set(hex.toLowerCase(), type);
  }
  const n1 = types.size;
  const base = join(sdDir, "aircraft/schema-01");
  const dirs = (p) => readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  for (const a of dirs(base)) {
    for (const b of dirs(join(base, a))) {
      for (const f of readdirSync(join(base, a, b)).filter((x) => x.endsWith(".csv"))) {
        for (const r of parseCsv(readFileSync(join(base, a, b, f), "utf8"))) {
          const hex = r.ICAO?.toLowerCase();
          if (hex && r.ModelICAO && !types.has(hex)) types.set(hex, r.ModelICAO);
        }
      }
    }
  }
  log(`aircraft types: ${n1} from tar1090-db, ${types.size - n1} more from standing-data`);
  return types;
}
