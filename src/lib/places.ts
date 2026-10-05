/**
 * Airport and country options for the place pickers, from per-airport flight counts.
 */
import type { PlaceOption } from "@/components/pickers";
import type { Airport } from "./data/load";

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();
export const countryName = (cc: string) => {
  try {
    return regionNames?.of(cc) ?? cc;
  } catch {
    return cc;
  }
};

/** Every counted airport, plus each country as "Any of n airports". */
export function placeOptions(counts: Map<string, number>, airports: Map<string, Airport>): PlaceOption[] {
  const byCountry = new Map<string, { n: number; airports: number }>();
  const out: PlaceOption[] = [];
  for (const [icao, n] of counts) {
    const a = airports.get(icao);
    if (!a) continue;
    if (a.country) {
      const c = byCountry.get(a.country) ?? { n: 0, airports: 0 };
      c.n += n;
      c.airports++;
      byCountry.set(a.country, c);
    }
    out.push({
      value: icao,
      code: icao,
      alt: a.iata,
      name: a.name,
      detail: [a.city, a.country ? countryName(a.country) : null].filter(Boolean).join(" · "),
      weight: n,
      country: false,
    });
  }
  for (const [cc, c] of byCountry)
    out.push({ value: `C:${cc}`, code: cc, alt: null, name: countryName(cc), detail: `Any of ${c.airports} airports`, weight: c.n / 2, country: true });
  return out;
}
