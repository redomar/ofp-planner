"use client";

import { useEffect, useState } from "react";
import { loadAirports, loadRoutes, type Airport } from "@/lib/data/load";

/** Per country: airports with flights, and departing / arriving flights in the snapshot. */
interface CountryStats {
  airports: number;
  dep: number;
  arr: number;
  airlines: number;
}
let statsP: Promise<Map<string, CountryStats>> | null = null;
let statsDone: Map<string, CountryStats> | null = null;

function loadStats(): Promise<Map<string, CountryStats>> {
  statsP ??= Promise.all([loadRoutes(), loadAirports()]).then(([routes, airports]) => {
    const m = new Map<string, CountryStats & { aps: Set<string>; als: Set<string> }>();
    const get = (cc: string) => {
      let s = m.get(cc);
      if (!s) m.set(cc, (s = { airports: 0, dep: 0, arr: 0, airlines: 0, aps: new Set(), als: new Set() }));
      return s;
    };
    const cc = (icao: string, a: Map<string, Airport>) => a.get(icao)?.country ?? null;
    for (const [o, dests] of Object.entries(routes))
      for (const [d, byAl] of Object.entries(dests)) {
        const n = Object.values(byAl).reduce((x, y) => x + y, 0);
        const co = cc(o, airports);
        const cd = cc(d, airports);
        if (co) {
          const s = get(co);
          s.dep += n;
          s.aps.add(o);
          for (const al of Object.keys(byAl)) s.als.add(al);
        }
        if (cd) {
          const s = get(cd);
          s.arr += n;
          s.aps.add(d);
          for (const al of Object.keys(byAl)) s.als.add(al);
        }
      }
    const out = new Map<string, CountryStats>();
    for (const [k, s] of m) out.set(k, { airports: s.aps.size, dep: s.dep, arr: s.arr, airlines: s.als.size });
    statsDone = out;
    return out;
  });
  statsP.catch(() => (statsP = null));
  return statsP;
}

const names = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();
export const countryName = (cc: string) => {
  try {
    return names?.of(cc.toUpperCase()) ?? cc;
  } catch {
    return cc;
  }
};

/**
 * A country flag with a hover label: the country as a chip, then how many of its airports,
 * departures, arrivals and airlines are in the snapshot. The figures load with the route index
 * (shared, fetched once) the first time a flag is shown.
 */
export function Flag({ cc, size = 16 }: { cc: string; size?: number }) {
  const [stats, setStats] = useState(statsDone);
  useEffect(() => {
    if (statsDone) return;
    let live = true;
    loadStats().then((s) => live && setStats(s), () => undefined);
    return () => {
      live = false;
    };
  }, []);
  const name = countryName(cc);
  const s = stats?.get(cc.toUpperCase());
  const fmt = (n: number) => n.toLocaleString("en-GB");
  const tip = s
    ? `${fmt(s.airports)} ${s.airports === 1 ? "airport" : "airports"} · ${fmt(s.dep)} departing and ${fmt(s.arr)} arriving flights · ${fmt(s.airlines)} ${s.airlines === 1 ? "airline" : "airlines"} in the snapshot.`
    : "Country of the airport.";
  return (
    <span className="flag-tip" data-tip={tip} data-tip-chip={name} data-tip-chip-color="var(--blue-bg)" data-tip-chip-ink="var(--blue)" role="img" aria-label={name}>
      <img className="flag" src={`/flags/${cc.toLowerCase()}.svg`} alt="" width={size} height={Math.round(size * 0.75)} />
    </span>
  );
}
