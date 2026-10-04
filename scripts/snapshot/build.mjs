// Build stage: cached tracks + reference data (+ optional timetables) → public/data/.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { AIRLINES, REGION, brandForOperator } from "./airlines.mjs";
import { resolveLeg, segment, unpack } from "./legs.mjs";
import { tracksDir } from "./sources/adsblol.mjs";
import { fetchRyanair } from "./sources/ryanair.mjs";
import { OUT, circularMedian, ensureDir, log, mode } from "./util.mjs";

const DAY = 86400;

// ---------------------------------------------------------------------------- time zones

const dtfCache = new Map();
/** UTC offset (minutes, local − UTC) of `tz` at unix time `ms`. */
function tzOffset(tz, ms) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    dtfCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
}
/** Local date "YYYY-MM-DD" + "HH:MM" in tz → unix ms. */
function localToUtcMs(date, hhmm, tz) {
  const [h, m] = hhmm.split(":").map(Number);
  const guess = Date.parse(`${date}T00:00:00Z`) + (h * 60 + m) * 60000;
  const off = tzOffset(tz, guess - tzOffset(tz, guess) * 60000);
  return guess - off * 60000;
}
const isoDow = (ms) => ((new Date(ms).getUTCDay() + 6) % 7) + 1;
const minOfDay = (ms) => Math.floor((((ms / 60000) % 1440) + 1440) % 1440);

// ---------------------------------------------------------------------------- observations

async function* readTracks(file) {
  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) if (line) yield JSON.parse(line);
}

/**
 * Walk the cached days in order, carrying legs still airborne at midnight into the next
 * day, and return one observation per resolved leg.
 */
export async function observe(dates, airports, sdRoutes, { onlyBrand = null } = {}) {
  const obs = [];
  let carry = new Map(); // hex → {pts, events} with t relative to the next day
  let stats = { legs: 0, resolved: 0, viaSd: 0, region: 0 };
  for (const date of dates) {
    const file = join(tracksDir(), `${date}.ndjson.gz`);
    if (!existsSync(file)) continue;
    const dayMs = Date.parse(`${date}T00:00:00Z`);
    const nextCarry = new Map();
    const seen = new Set();
    const handle = (hex, points, events) => {
      const { legs, open } = segment(points, events, DAY);
      if (open) {
        const tail = [...open.before, ...open.pts].map((p) => ({ ...p, t: p.t - DAY }));
        nextCarry.set(hex, { pts: tail, events: events.filter(([t]) => t >= (open.before[0]?.t ?? open.pts[0].t) - 600).map(([t, c]) => [t - DAY, c]) });
      }
      for (const leg of legs) {
        if (!leg.cs) continue;
        const op = leg.cs.slice(0, 3);
        const brand = brandForOperator(op);
        if (!brand || (onlyBrand && brand.icao !== onlyBrand)) continue;
        stats.legs++;
        const r = resolveLeg(leg, airports);
        let o = r.o;
        let d = r.d;
        // one end unseen: the VRS callsign route fills it in when it agrees with the seen end
        if ((!o) !== (!d)) {
          for (const codes of sdRoutes.get(leg.cs) ?? []) {
            for (let i = 0; i + 1 < codes.length; i++) {
              if (o && codes[i] === o.icao && airports.byIcao.has(codes[i + 1])) d = airports.byIcao.get(codes[i + 1]);
              else if (d && codes[i + 1] === d.icao && airports.byIcao.has(codes[i])) o = airports.byIcao.get(codes[i]);
            }
            if (o && d) {
              stats.viaSd++;
              break;
            }
          }
        }
        if (!o || !d || o.icao === d.icao) continue;
        stats.resolved++;
        if (!REGION.has(o.country) || !REGION.has(d.country)) continue;
        stats.region++;
        const t0ms = dayMs + r.t0 * 1000;
        const sec = (s) => (s == null ? null : dayMs + s * 1000);
        obs.push({
          brand: brand.icao,
          op,
          cs: leg.cs,
          hex,
          o: o.icao,
          d: d.icao,
          // weekday at the origin, local time, from OUT/OFF or first sighting
          dow: isoDow((r.off != null ? sec(r.off) : t0ms) + (o.tz ? tzOffset(o.tz, t0ms) : 0) * 60000),
          ms: { out: sec(r.out), off: sec(r.off), on: sec(r.on), in: sec(r.in) },
        });
      }
    };
    for await (const rec of readTracks(file)) {
      seen.add(rec.h);
      const c = carry.get(rec.h);
      let pts = unpack(rec.p).sort((a, b) => a.t - b.t);
      let events = rec.c;
      if (c) {
        pts = [...c.pts, ...pts];
        events = [...c.events, ...events];
      }
      handle(rec.h, pts, events);
    }
    // carried aircraft not seen today: close them out as they are
    for (const [hex, c] of carry) if (!seen.has(hex)) handle(hex, c.pts, c.events);
    carry = nextCarry;
    log(`observe ${date}: ${obs.length} observations so far`);
  }
  log(`observe: ${stats.legs} airline legs, ${stats.resolved} with both ends (${stats.viaSd} via standing-data), ${stats.region} in region`);
  return obs;
}

// ---------------------------------------------------------------------------- aggregation

/** Signed minute difference folded into −720..720. */
const wrap = (m) => ((((m + 720) % 1440) + 1440) % 1440) - 720;

/** Split observations into clusters of departure time (±40 min). */
function clusterByTime(list) {
  const depOf = (ob) => {
    if (ob.ms.off != null) return minOfDay(ob.ms.off);
    if (ob.ms.out != null) return minOfDay(ob.ms.out + 12 * 60000);
    return null;
  };
  const timed = list.filter((ob) => depOf(ob) != null).sort((a, b) => depOf(a) - depOf(b));
  const untimed = list.filter((ob) => depOf(ob) == null);
  const clusters = [];
  for (const ob of timed) {
    const c = clusters[clusters.length - 1];
    if (c && depOf(ob) - depOf(c[0]) <= 40) c.push(ob);
    else clusters.push([ob]);
  }
  // wrap-around: merge last into first if they're within 40 min across midnight
  if (clusters.length > 1 && depOf(clusters[0][0]) + 1440 - depOf(clusters.at(-1).at(-1)) <= 40) {
    clusters[0].unshift(...clusters.pop());
  }
  if (!clusters.length) return [list];
  // untimed observations (only arrivals seen) join the biggest cluster
  clusters.sort((a, b) => b.length - a.length)[0].push(...untimed);
  return clusters;
}

function numericFn(brand, cs, sdAirlines) {
  if (!brand.numericFn) return null;
  const m = /^[A-Z]{3}0*(\d{1,4})$/.exec(cs);
  if (!m) return null;
  const pos = sdAirlines.get(cs.slice(0, 3))?.positioning;
  if (pos && pos.test(m[1])) return null;
  return m[1];
}

export async function build({ dates, airports, sdRoutes, sdAirlines, types, ryanair = true, onlyBrand = null, refresh = false }) {
  const obs = await observe(dates, airports, sdRoutes, { onlyBrand });

  // group: brand | op | cs | o | d
  const groups = new Map();
  for (const ob of obs) {
    const k = `${ob.brand}|${ob.op}|${ob.cs}|${ob.o}|${ob.d}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(ob);
  }

  // Ryanair: flight numbers + STD/STA by matching observed departures to the timetable
  const timetables = new Map(); // `${o}-${d}` icao → [{dow, fn, stdMin, staMin, date}]
  const usedRyanair = ryanair && (!onlyBrand || onlyBrand === "RYR");
  if (usedRyanair) {
    const pairs = new Map();
    for (const ob of obs) {
      if (ob.brand !== "RYR") continue;
      const o = airports.byIcao.get(ob.o);
      const d = airports.byIcao.get(ob.d);
      if (o?.iata && d?.iata) pairs.set(`${o.iata}-${d.iata}`, [o.iata, d.iata]);
    }
    // the timetable only serves today onwards: take the next 14 days, matched by weekday
    const today = new Date();
    const from = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const months = [...new Set([0, 13].map((n) => new Date(from + n * DAY * 1000).toISOString().slice(0, 7)))];
    const raw = await fetchRyanair([...pairs.values()], months, { refresh });
    for (const [key, list] of raw) {
      const [oi, di] = key.split("-");
      const o = airports.byIata.get(oi);
      const d = airports.byIata.get(di);
      if (!o?.tz || !d?.tz) continue;
      const rows = [];
      for (const f of list) {
        const t = Date.parse(`${f.date}T00:00:00Z`);
        if (t < from || t >= from + 14 * DAY * 1000) continue;
        const depMs = localToUtcMs(f.date, f.dep, o.tz);
        let arrMs = localToUtcMs(f.date, f.arr, d.tz);
        if (arrMs < depMs) arrMs += DAY * 1000;
        rows.push({ dow: isoDow(Date.parse(`${f.date}T12:00:00Z`)), fn: f.fn, std: minOfDay(depMs), sta: minOfDay(arrMs), blk: (arrMs - depMs) / 60000 });
      }
      timetables.set(`${o.icao}-${d.icao}`, rows);
    }
  }

  const fileFlights = new Map(AIRLINES.map((a) => [a.icao, []]));
  const ryMatched = new Map(); // route → Set(fn) matched to an observed flight
  for (const [k, all] of groups) {
    const [brandIcao, op, cs, o, d] = k.split("|");
    const brand = AIRLINES.find((a) => a.icao === brandIcao);
    const tt = brandIcao === "RYR" ? timetables.get(`${o}-${d}`) : undefined;
    // the same callsign can fly the route at different times on different weekdays:
    // one flight entry per departure-time cluster
    const matchedClusters = [];
    for (const list of clusterByTime(all)) {
      let fn = null;
      let std = null;
      let sta = null;
      let ttDays = null;
      if (tt) {
        // vote over observations: which scheduled departure (same weekday) does each fit?
        const votes = [];
        for (const ob of list) {
          const dep = ob.ms.out ?? (ob.ms.off != null ? ob.ms.off - 12 * 60000 : null);
          if (dep == null) continue;
          const depMin = minOfDay(dep);
          let best = null;
          let bestScore = Infinity;
          for (const row of tt) {
            if (row.dow !== ob.dow) continue;
            const delay = wrap(depMin - row.std);
            if (delay < -20 || delay > 150) continue;
            const score = delay < 0 ? -delay * 3 : delay;
            if (score < bestScore) [best, bestScore] = [row, score];
          }
          if (best) votes.push(best);
        }
        const top = mode(votes.map((v) => v.fn));
        if (top && votes.filter((v) => v.fn === top).length * 2 >= votes.length) {
          fn = top;
          const rows = tt.filter((r) => r.fn === top);
          std = mode(votes.filter((v) => v.fn === top).map((v) => v.std));
          sta = mode(rows.filter((r) => r.std === std).map((r) => r.sta));
          ttDays = [...new Set(rows.filter((r) => Math.abs(wrap(r.std - std)) <= 40).map((r) => r.dow))].sort();
          if (!ryMatched.has(`${o}-${d}`)) ryMatched.set(`${o}-${d}`, new Set());
          ryMatched.get(`${o}-${d}`).add([top, std]);
        }
      }
      // clusters matched to the same scheduled flight are one flight (delays split them)
      const same = std != null && matchedClusters.find((c) => c.fn === fn && c.std === std);
      if (same) {
        same.list.push(...list);
        continue;
      }
      matchedClusters.push({ list, fn, std, sta, ttDays });
    }
    for (const { list, fn: ttFn, std, sta, ttDays } of matchedClusters) {
      const fn = ttFn ?? numericFn(brand, cs, sdAirlines);
      // a one-off sighting is more likely a diversion, positioning or ad-hoc flight
      if (list.length < 2 && !ttDays) continue;
      const typeCounts = new Map();
      for (const ob of list) {
        const t = types.get(ob.hex);
        if (t) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
      }
      const med = (key) => circularMedian(list.map((ob) => (ob.ms[key] == null ? null : minOfDay(ob.ms[key]))));
      let [out, off, on, inn] = [med("out"), med("off"), med("on"), med("in")];
      // medians come from different subsets; drop gate times that don't fit their wheels times
      if (out != null && off != null && !(wrap(off - out) >= 3 && wrap(off - out) <= 60)) out = null;
      if (inn != null && on != null && !(wrap(inn - on) >= 1 && wrap(inn - on) <= 45)) inn = null;
      if (off != null && on != null && !(wrap(on - off) >= 15)) [off, on] = [null, null];
      fileFlights.get(brandIcao).push({
        op,
        fn,
        cs,
        o,
        d,
        types: [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
        days: ttDays ?? [...new Set(list.map((ob) => ob.dow))].sort(),
        std,
        sta,
        out,
        off,
        on,
        in: inn,
        samples: list.length,
      });
    }
  }

  // timetable flights we never saw (coverage gaps): add them without callsign/type/OOOI
  for (const [route, rows] of timetables) {
    const [o, d] = route.split("-");
    const matched = [...(ryMatched.get(route) ?? [])];
    const byFn = new Map(); // fn → clusters of rows by STD (±40 min)
    for (const r of rows) {
      if (matched.some(([fn, std]) => fn === r.fn && Math.abs(wrap(r.std - std)) <= 40)) continue;
      if (!byFn.has(r.fn)) byFn.set(r.fn, []);
      const clusters = byFn.get(r.fn);
      const c = clusters.find((cl) => Math.abs(wrap(cl[0].std - r.std)) <= 40);
      if (c) c.push(r);
      else clusters.push([r]);
    }
    for (const [fn, rs] of [...byFn].flatMap(([fn, cls]) => cls.map((c) => [fn, c]))) {
      fileFlights.get("RYR").push({
        op: "RYR",
        fn,
        cs: null,
        o,
        d,
        types: [],
        days: [...new Set(rs.map((r) => r.dow))].sort(),
        std: mode(rs.map((r) => r.std)),
        sta: mode(rs.map((r) => r.sta)),
        out: null,
        off: null,
        on: null,
        in: null,
        samples: 0,
      });
    }
  }

  return { fileFlights, obs, usedRyanair, dates };
}

// ---------------------------------------------------------------------------- output

export function writeOutput({ fileFlights, usedRyanair, dates }, airports, sources, { onlyBrand = null } = {}) {
  ensureDir(join(OUT, "airlines"));
  const generatedAt = new Date().toISOString();
  const manifestPath = join(OUT, "manifest.json");
  const prev = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;

  const airlineInfos = [];
  for (const a of AIRLINES) {
    let flights = fileFlights.get(a.icao) ?? [];
    const file = `data/airlines/${a.icao}.json`;
    if (onlyBrand && a.icao !== onlyBrand) {
      // partial run: keep the other airlines' previous output untouched
      const old = prev?.airlines.find((x) => x.icao === a.icao);
      if (old) airlineInfos.push(old);
      continue;
    }
    flights.sort((x, y) => x.o.localeCompare(y.o) || x.d.localeCompare(y.d) || (x.std ?? x.out ?? x.off ?? 9999) - (y.std ?? y.out ?? y.off ?? 9999));
    const path = join(OUT, "airlines", `${a.icao}.json`);
    if (!flights.length) {
      if (existsSync(path)) rmSync(path);
      continue;
    }
    writeFileSync(path, JSON.stringify({ schema: 1, airline: a.icao, flights }));
    airlineInfos.push({
      icao: a.icao,
      iata: a.iata,
      name: a.name,
      callsign: a.callsign,
      country: a.country,
      colors: { primary: a.colors[0], secondary: a.colors[1] ?? null },
      operators: a.operators,
      file,
      flights: flights.length,
    });
  }

  // airports referenced by any airline file on disk
  const used = new Set();
  let total = 0;
  const routes = new Set();
  for (const info of airlineInfos) {
    const { flights } = JSON.parse(readFileSync(join(OUT, "airlines", `${info.icao}.json`), "utf8"));
    total += flights.length;
    for (const f of flights) {
      used.add(f.o);
      used.add(f.d);
      routes.add(`${f.o}-${f.d}`);
    }
  }
  const rows = {};
  for (const icao of [...used].sort()) {
    const a = airports.byIcao.get(icao);
    if (!a) continue;
    rows[icao] = [a.iata, a.name, a.city, a.country, +a.lat.toFixed(5), +a.lon.toFixed(5), a.elev, a.tz];
  }
  writeFileSync(join(OUT, "airports.json"), JSON.stringify({ schema: 1, airports: rows }));

  const srcs = sources.filter((s) => s.id !== "ryanair" || usedRyanair || prev?.sources.some((p) => p.id === "ryanair"));
  const manifest = {
    schema: 1,
    generatedAt,
    coverage: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : (prev?.coverage ?? null),
    sources: srcs,
    airlines: airlineInfos.sort((x, y) => y.flights - x.flights),
    counts: { airlines: airlineInfos.length, flights: total, airports: Object.keys(rows).length, routes: routes.size },
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  log(`wrote ${airlineInfos.length} airlines, ${total} flights, ${Object.keys(rows).length} airports, ${routes.size} routes`);
  return manifest;
}

export function cachedDates() {
  return readdirSync(tracksDir())
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.ndjson\.gz$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort();
}
