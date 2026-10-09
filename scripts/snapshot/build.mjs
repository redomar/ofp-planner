// Build stage: cached tracks + reference data (+ optional timetables) → public/data/.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { writeRouteIndex } from "./route-index.mjs";
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
        if (!o !== !d) {
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

/** UTC date of an observation ("2026-10-05"), for telling two flights on one day from one flight on two days. */
const obDate = (ob) => new Date(ob.ms.off ?? ob.ms.out ?? ob.ms.on ?? ob.ms.in).toISOString().slice(0, 10);

/** Which timetabled flight number most observations fit (same weekday, −20…+150 min off-block), or null without a majority. */
function voteFn(list, tt) {
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
    if (best) votes.push(best.fn);
  }
  const top = mode(votes);
  return top && votes.filter((v) => v === top).length * 2 >= votes.length ? top : null;
}

/** A flight number's timetable rows → weekday → { std, sta } (the most common times on that weekday). */
function schedByDay(rows) {
  const out = new Map();
  for (let dow = 1; dow <= 7; dow++) {
    const day = rows.filter((r) => r.dow === dow);
    if (!day.length) continue;
    const std = mode(day.map((r) => r.std));
    out.set(dow, { std, sta: mode(day.filter((r) => r.std === std).map((r) => r.sta)) });
  }
  return out;
}

/** Typical OUT/OFF/ON/IN of some observations: circular medians, dropping gate times that don't fit their wheels times. */
function typical(list) {
  const med = (key) => circularMedian(list.map((ob) => (ob.ms[key] == null ? null : minOfDay(ob.ms[key]))));
  let [out, off, on, inn] = [med("out"), med("off"), med("on"), med("in")];
  // medians come from different subsets; drop gate times that don't fit their wheels times
  if (out != null && off != null && !(wrap(off - out) >= 3 && wrap(off - out) <= 60)) out = null;
  if (inn != null && on != null && !(wrap(inn - on) >= 1 && wrap(inn - on) <= 45)) inn = null;
  if (off != null && on != null && !(wrap(on - off) >= 15)) [off, on] = [null, null];
  return { out, off, on, in: inn };
}

const TIMES = ["std", "sta", "out", "off", "on", "in"];
/** A day's typical times with the gaps (an end not tracked that weekday) taken from the whole flight, moved to that day's time. */
function fill(t, all) {
  const k = ["off", "out", "on", "in"].find((k) => t[k] != null && all[k] != null);
  if (!k) return t;
  const by = wrap(t[k] - all[k]);
  return Object.fromEntries(["out", "off", "on", "in"].map((x) => [x, t[x] ?? (all[x] == null ? null : (((all[x] + by) % 1440) + 1440) % 1440)]));
}
const depOf = (t) => t.std ?? t.out ?? (t.off != null ? t.off - 12 : null);
const shift = (t, by) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v == null ? null : (((v + by) % 1440) + 1440) % 1440]));

/**
 * The weekly pattern: the flight-level times (the set most days share) plus, when some days
 * differ (another STD, or typical OUT/OFF more than 30 min off), `byDay` lists the other weekdays
 * as [days, std, sta, out, off, on, in]. Per-day typical times need two sightings that weekday; one sighting counts only
 * when it's clearly a different time (> 40 min off); otherwise the whole-flight typical stands in,
 * moved by the day's schedule difference. Ends not tracked on a weekday come from the whole flight,
 * moved to that day's time. `seen` counts the sightings per weekday.
 */
function timesByDay(days, list, sched) {
  const all = typical(list);
  const mainStd = sched ? mode([...sched.values()].map((s) => s.std)) : null;
  const per = new Map();
  for (const dow of days) {
    const s = sched?.get(dow) ?? { std: null, sta: null };
    const on = list.filter((ob) => ob.dow === dow);
    const fallback = shift(all, s.std != null && mainStd != null ? s.std - mainStd : 0);
    let t = fallback;
    if (on.length >= 2) t = fill(typical(on), all);
    else if (on.length === 1) {
      const one = typical(on);
      const a = depOf(one);
      const b = depOf(fallback);
      if (a != null && b != null && Math.abs(wrap(a - b)) > 40) t = fill(one, all);
    }
    per.set(dow, { std: s.std, sta: s.sta, ...t });
  }
  const key = (t) => TIMES.map((k) => t[k] ?? "").join(",");
  const groups = new Map();
  for (const [dow, t] of per) {
    const g = groups.get(key(t)) ?? { days: [], ...t };
    g.days.push(dow);
    groups.set(key(t), g);
  }
  const ordered = [...groups.values()].sort((a, b) => b.days.length - a.days.length || +(b.std === mainStd) - +(a.std === mainStd) || a.days[0] - b.days[0]);
  const main = ordered[0] ?? { std: null, sta: null, ...all };
  const far = (a, b) => a != null && b != null && Math.abs(wrap(a - b)) > 30;
  const differs = ordered.some((g) => g.std !== main.std || far(g.out, all.out) || far(g.off, all.off));
  const seen = [1, 2, 3, 4, 5, 6, 7].map((dow) => list.filter((ob) => ob.dow === dow).length);
  const flat = differs ? main : { ...all, std: main.std, sta: main.sta };
  return {
    days,
    std: flat.std ?? null,
    sta: flat.sta ?? null,
    out: flat.out ?? null,
    off: flat.off ?? null,
    on: flat.on ?? null,
    in: flat.in ?? null,
    ...(differs && ordered.length > 1 ? { byDay: ordered.slice(1).map((g) => [g.days.sort(), ...TIMES.map((k) => g[k] ?? null)]) } : {}),
    ...(list.length ? { seen } : {}),
  };
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
  const ryConsumed = new Map(); // route → Set(fn) already given a row from observations
  const byNumber = new Map(); // Ryanair: `${o}|${d}|${fn}` → observations of every callsign flying that number
  for (const [k, all] of groups) {
    const [brandIcao, op, cs, o, d] = k.split("|");
    const brand = AIRLINES.find((a) => a.icao === brandIcao);
    const tt = brandIcao === "RYR" ? timetables.get(`${o}-${d}`) : undefined;
    // the same callsign flies the route at different times on different weekdays (and delays
    // split a time into two clusters): each departure-time cluster votes for a timetable
    // flight number, then clusters merge into one flight unless they were seen on the same date
    const clusters = clusterByTime(all).map((list) => ({ list, fn: tt ? voteFn(list, tt) : null, dates: new Set(list.map(obDate)) }));
    const buckets = [];
    for (const c of clusters.sort((a, b) => b.list.length - a.list.length)) {
      // a lone sighting joins only a weekday the flight already flies (a delay); on a new weekday it stays a one-off
      const lone = c.list.length === 1 ? c.list[0].dow : null;
      const b = buckets.find(
        (b) => (b.fn == null || c.fn == null || b.fn === c.fn) && ![...c.dates].some((x) => b.dates.has(x)) && (lone == null || b.list.some((ob) => ob.dow === lone)),
      );
      if (!b) buckets.push({ list: [...c.list], fn: c.fn, dates: new Set(c.dates) });
      else {
        b.list.push(...c.list);
        b.fn ??= c.fn;
        for (const x of c.dates) b.dates.add(x);
      }
    }
    // groups of two or more that never share a date are one flight too (another time on other weekdays)
    for (let i = buckets.length - 1; i > 0; i--) {
      const c = buckets[i];
      if (c.list.length < 2) continue;
      const b = buckets.slice(0, i).find((b) => b.list.length >= 2 && (b.fn == null || c.fn == null || b.fn === c.fn) && ![...c.dates].some((x) => b.dates.has(x)));
      if (!b) continue;
      b.list.push(...c.list);
      b.fn ??= c.fn;
      for (const x of c.dates) b.dates.add(x);
      buckets.splice(i, 1);
    }
    for (const { list, fn: voted } of buckets) {
      // a callsign that is the number (RYR4312) belongs to that timetabled flight even when its times didn't vote
      const num = numericFn(brand, cs, sdAirlines);
      const ttFn = voted ?? (num && tt?.some((r) => r.fn === num) ? num : null);
      // Ryanair flies one flight number under different callsigns on different days: one flight per number
      if (ttFn) {
        const key = `${o}|${d}|${ttFn}`;
        const r = byNumber.get(key) ?? { brandIcao, op, o, d, list: [], fn: ttFn, tt };
        r.list.push(...list);
        byNumber.set(key, r);
        continue;
      }
      emit(brandIcao, op, cs, o, d, list, num, null);
    }
  }
  for (const { brandIcao, op, o, d, list, fn, tt } of byNumber.values()) {
    if (!ryConsumed.has(`${o}-${d}`)) ryConsumed.set(`${o}-${d}`, new Set());
    ryConsumed.get(`${o}-${d}`).add(fn);
    emit(brandIcao, op, mode(list.map((ob) => ob.cs)), o, d, list, fn, schedByDay(tt.filter((r) => r.fn === fn)));
  }

  function emit(brandIcao, op, cs, o, d, list, fn, sched) {
    // a one-off sighting is more likely a diversion, positioning or ad-hoc flight
    if (list.length < 2 && !sched) return;
    const typeCounts = new Map();
    for (const ob of list) {
      const t = types.get(ob.hex);
      if (t) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
    const days = sched ? [...sched.keys()].sort() : [...new Set(list.map((ob) => ob.dow))].sort();
    fileFlights.get(brandIcao).push({
      op,
      fn,
      cs,
      o,
      d,
      types: [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
      ...timesByDay(days, list, sched),
      samples: list.length,
    });
  }

  // timetable flights we never saw (coverage gaps): add them without callsign/type/OOOI
  for (const [route, rows] of timetables) {
    const [o, d] = route.split("-");
    const used = ryConsumed.get(route) ?? new Set();
    for (const fn of new Set(rows.map((r) => r.fn))) {
      if (used.has(fn)) continue;
      const sched = schedByDay(rows.filter((r) => r.fn === fn));
      fileFlights.get("RYR").push({ op: "RYR", fn, cs: null, o, d, types: [], ...timesByDay([...sched.keys()].sort(), [], sched), samples: 0 });
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
  writeRouteIndex(OUT);
  log(`wrote ${airlineInfos.length} airlines, ${total} flights, ${Object.keys(rows).length} airports, ${routes.size} routes`);
  return manifest;
}

export function cachedDates() {
  return readdirSync(tracksDir())
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.ndjson\.gz$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort();
}
