// Ryanair public timetable (services-api.ryanair.com/timtbl, the JSON behind ryanair.com's
// timetable page; no key). One request per direction per month, cached under data/raw.
// Gives marketing flight numbers and scheduled local departure/arrival times per day.
//
// Use is light (once per snapshot, ~2 requests/second, cached) and non-commercial. Turn it
// off with --no-ryanair if that ever changes; flight numbers then fall back to numeric
// callsigns only and STD/STA stay empty.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { RAW, cachedFetch, log, sleep } from "../util.mjs";

const API = "https://services-api.ryanair.com/timtbl/3/schedules";

/** Fetch schedules for each [origIata, destIata] for the given months ("2026-09"). */
export async function fetchRyanair(pairs, months, { concurrency = 2, delayMs = 400, refresh = false } = {}) {
  const jobs = [];
  for (const [o, d] of pairs) for (const m of months) jobs.push([o, d, m]);
  const result = new Map(); // `${o}-${d}` → [{date, fn, dep, arr}] (local times "HH:MM")
  let k = 0;
  let done = 0;
  let missing = 0;
  async function worker() {
    while (k < jobs.length) {
      const [o, d, m] = jobs[k++];
      const [y, mm] = m.split("-");
      const url = `${API}/${o}/${d}/years/${y}/months/${+mm}`;
      const path = join(RAW, "ryanair", m, `${o}-${d}.json`);
      const cached = !refresh && existsSync(path);
      try {
        const buf = await cachedFetch(url, path, { maxAgeH: refresh ? 0 : 24 * 10, headers: { Accept: "application/json" } });
        const j = JSON.parse(buf.toString("utf8"));
        const list = result.get(`${o}-${d}`) ?? [];
        for (const day of j.days ?? []) {
          const date = `${y}-${mm}-${String(day.day).padStart(2, "0")}`;
          for (const f of day.flights ?? []) list.push({ date, carrier: f.carrierCode, fn: String(f.number), dep: f.departureTime, arr: f.arrivalTime });
        }
        result.set(`${o}-${d}`, list);
      } catch (e) {
        if (e.status === 404 || e.status === 400) missing++;
        else log(`ryanair ${o}-${d} ${m}: ${e.message}`);
      }
      done++;
      if (done % 200 === 0) log(`ryanair: ${done}/${jobs.length}`);
      if (!cached) await sleep(delayMs);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  log(`ryanair: ${jobs.length} requests, ${result.size} routes with schedules, ${missing} not served`);
  return result;
}
