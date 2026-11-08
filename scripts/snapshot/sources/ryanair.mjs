// Ryanair public timetable (services-api.ryanair.com/timtbl, the JSON behind ryanair.com's
// timetable page; no key). One request per direction per month, cached under data/raw.
// Gives marketing flight numbers and scheduled local departure/arrival times per day.
//
// The API only serves today onwards, so the saved files are the only record of past days:
// a month before this one is read from the cache and never fetched again, and a fresh fetch
// of this month keeps the days before today from the saved file.
//
// Use is light (once per snapshot, ~2 requests/second, cached) and non-commercial. Turn it
// off with --no-ryanair if that ever changes; flight numbers then fall back to numeric
// callsigns only and STD/STA stay empty.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RAW, cachedFetch, log, sleep } from "../util.mjs";

const API = "https://services-api.ryanair.com/timtbl/3/schedules";

/** Schedules for each [origIata, destIata] for the given months ("2026-09"). */
export async function fetchRyanair(pairs, months, { concurrency = 2, delayMs = 400, refresh = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const jobs = [];
  for (const [o, d] of pairs) for (const m of months) jobs.push([o, d, m]);
  const result = new Map(); // `${o}-${d}` → [{date, fn, dep, arr}] (local times "HH:MM")
  let k = 0;
  let done = 0;
  let missing = 0;
  let fetched = 0;
  async function worker() {
    while (k < jobs.length) {
      const [o, d, m] = jobs[k++];
      const [y, mm] = m.split("-");
      const url = `${API}/${o}/${d}/years/${y}/months/${+mm}`;
      const path = join(RAW, "ryanair", m, `${o}-${d}.json`);
      const had = existsSync(path);
      let net = false;
      try {
        let j;
        if (m < thisMonth) {
          // gone from the API: the saved file or nothing
          if (!had) {
            missing++;
            continue;
          }
          j = JSON.parse(readFileSync(path, "utf8"));
        } else {
          const old = had ? JSON.parse(readFileSync(path, "utf8")) : null;
          const before = had ? statSync(path).mtimeMs : 0;
          j = JSON.parse((await cachedFetch(url, path, { maxAgeH: refresh ? 0 : 24 * 10, headers: { Accept: "application/json" } })).toString("utf8"));
          net = !had || statSync(path).mtimeMs !== before;
          if (net) fetched++;
          if (net && old && m === thisMonth) {
            // keep the days before today, which the fresh answer no longer has
            const day = +today.slice(8, 10);
            const kept = (old.days ?? []).filter((x) => x.day < day && !(j.days ?? []).some((n) => n.day === x.day));
            if (kept.length) {
              j.days = [...kept, ...(j.days ?? [])].sort((a, b) => a.day - b.day);
              writeFileSync(path, JSON.stringify(j));
            }
          }
        }
        const list = result.get(`${o}-${d}`) ?? [];
        for (const day of j.days ?? []) {
          const date = `${y}-${mm}-${String(day.day).padStart(2, "0")}`;
          for (const f of day.flights ?? []) list.push({ date, carrier: f.carrierCode, fn: String(f.number), dep: f.departureTime, arr: f.arrivalTime });
        }
        result.set(`${o}-${d}`, list);
      } catch (e) {
        if (e.status === 404 || e.status === 400) missing++;
        else log(`ryanair ${o}-${d} ${m}: ${e.message}`);
      } finally {
        done++;
        if (done % 200 === 0) log(`ryanair: ${done}/${jobs.length}`);
      }
      if (net) await sleep(delayMs);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  log(`ryanair: ${jobs.length} requests (${fetched} from the API), ${result.size} routes with schedules, ${missing} not served`);
  return result;
}
