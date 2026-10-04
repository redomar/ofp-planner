#!/usr/bin/env node
// Flight snapshot pipeline — the "maintenance latch". CLI only; never exposed on the web.
//
//   pnpm data:snapshot                      fetch the last 14 days + build public/data/
//   pnpm data:snapshot --stage fetch        only download/process ADS-B days (cached)
//   pnpm data:snapshot --stage build        only rebuild from what's cached
//   pnpm data:snapshot --airline EZY        rebuild one airline, keep the others' files
//   pnpm data:snapshot --days 7 --end 2026-10-03 --no-ryanair --refresh
//   pnpm data:snapshot --out /srv/data --cache /srv/cache   (or SNAPSHOT_OUT / SNAPSHOT_CACHE)
//
// See docs/data-pipeline.md.
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    stage: { type: "string", default: "all" },
    airline: { type: "string" },
    days: { type: "string", default: "14" },
    end: { type: "string" },
    concurrency: { type: "string", default: "3" },
    "no-ryanair": { type: "boolean", default: false },
    refresh: { type: "boolean", default: false },
    out: { type: "string" },
    cache: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (args.help) {
  console.log(`Usage: pnpm data:snapshot [--stage fetch|build|all] [--airline ICAO] [--days N] [--end YYYY-MM-DD]
       [--concurrency N] [--no-ryanair] [--refresh] [--out DIR] [--cache DIR]`);
  process.exit(0);
}
// must be set before util.mjs is imported (it reads them at load)
if (args.out) process.env.SNAPSHOT_OUT = args.out;
if (args.cache) process.env.SNAPSHOT_CACHE = args.cache;

const { log, OUT, RAW } = await import("./util.mjs");
const { AIRLINES } = await import("./airlines.mjs");
const { fetchDay } = await import("./sources/adsblol.mjs");
const ref = await import("./sources/reference.mjs");
const { build, writeOutput, cachedDates } = await import("./build.mjs");

const onlyBrand = args.airline?.toUpperCase() ?? null;
if (onlyBrand && !AIRLINES.some((a) => a.icao === onlyBrand)) {
  console.error(`Unknown airline ${onlyBrand}. Known: ${AIRLINES.map((a) => a.icao).join(" ")}`);
  process.exit(1);
}

// last complete UTC day by default (adsb.lol uploads a day's archive the next morning)
const end = args.end ?? new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
const nDays = Math.max(1, +args.days);
const dates = [];
for (let i = nDays - 1; i >= 0; i--) dates.push(new Date(Date.parse(`${end}T00:00:00Z`) - i * 86400_000).toISOString().slice(0, 10));

log(`snapshot: stage=${args.stage} days=${dates[0]}..${dates[dates.length - 1]} out=${OUT} cache=${RAW}`);
const t0 = Date.now();

if (args.stage === "fetch" || args.stage === "all") {
  let k = 0;
  const conc = Math.max(1, +args.concurrency);
  const worker = async () => {
    while (k < dates.length) {
      const d = dates[k++];
      try {
        await fetchDay(d, { force: args.refresh });
      } catch (e) {
        log(`adsb.lol ${d}: failed (${e.message}); continuing`);
      }
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
}

if (args.stage === "build" || args.stage === "all") {
  const fetchedAt = new Date().toISOString();
  const sd = ref.syncStandingData({ refresh: args.refresh });
  const airports = await ref.loadAirports({ refresh: args.refresh });
  const sdRoutes = ref.loadSdRoutes(sd.dir);
  const sdAirlines = ref.loadSdAirlines(sd.dir);
  const types = await ref.loadAircraftTypes(sd.dir, { refresh: args.refresh });
  const have = new Set(cachedDates());
  const useDates = dates.filter((d) => have.has(d));
  if (!useDates.length) {
    console.error("No cached ADS-B days in range; run with --stage fetch first.");
    process.exit(1);
  }
  const sources = [
    { id: "adsblol", name: "adsb.lol globe history", url: "https://github.com/adsblol", licence: "ODbL 1.0", provides: "observed flights: callsigns, routes, days of week, OUT/OFF/ON/IN times", fetchedAt },
    { id: "standing-data", name: "Virtual Radar Server standing data", url: "https://github.com/vradarserver/standing-data", licence: "CC0 1.0", provides: `callsign routes where one end was unseen; positioning-flight patterns; aircraft types (gaps) — commit ${sd.sha.split(" ")[0].slice(0, 7)}`, fetchedAt },
    { id: "tar1090-db", name: "tar1090-db (Mictronics aircraft database)", url: "https://github.com/wiedehopf/tar1090-db", licence: "community database, no licence stated; only type designators used", provides: "aircraft type per airframe", fetchedAt },
    { id: "ourairports", name: "OurAirports", url: "https://ourairports.com/data/", licence: "Public domain", provides: "airports, coordinates, elevation, IATA codes", fetchedAt },
    { id: "mwgg-airports", name: "mwgg/Airports", url: "https://github.com/mwgg/Airports", licence: "MIT", provides: "airport time zones", fetchedAt },
    { id: "ryanair", name: "Ryanair public timetable", url: "https://www.ryanair.com/gb/en/cheap-flights/timetable", licence: "Ryanair website data; non-commercial use", provides: "Ryanair flight numbers and STD/STA (next 14 days, matched by weekday)", fetchedAt },
  ];
  const result = await build({ dates: useDates, airports, sdRoutes, sdAirlines, types, ryanair: !args["no-ryanair"], onlyBrand, sources, refresh: args.refresh });
  const manifest = writeOutput(result, airports, sources, { onlyBrand });
  log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min: ${manifest.counts.flights} flights`);
}
