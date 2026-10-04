/**
 * Flight categories (FAA / ICAO-style bands) and WMO weather-code text.
 *
 *   VFR   ceiling > 3000 ft and visibility > 5 SM
 *   MVFR  ceiling 1000–3000 ft and/or visibility 3–5 SM
 *   IFR   ceiling 500–999 ft and/or visibility 1 to < 3 SM
 *   LIFR  ceiling < 500 ft and/or visibility < 1 SM
 * The worse of the two decides.
 */

export type Category = "VFR" | "MVFR" | "IFR" | "LIFR";

export const CATEGORY_TONE: Record<Category, "green" | "blue" | "amber" | "red"> = {
  VFR: "green",
  MVFR: "blue",
  IFR: "amber",
  LIFR: "red",
};

export const CATEGORY_TIP: Record<Category, string> = {
  VFR: "Visual flight rules: ceiling above 3,000 ft and visibility above 5 SM (8 km).",
  MVFR: "Marginal VFR: ceiling 1,000–3,000 ft or visibility 3–5 SM (5–8 km). Expect some cloud on the approach.",
  IFR: "Instrument conditions: ceiling 500–999 ft or visibility 1–3 SM (1.6–5 km). A proper instrument approach.",
  LIFR: "Low IFR: ceiling below 500 ft or visibility below 1 SM (1.6 km). Check minima; a CAT II/III approach may be needed.",
};

const M_PER_SM = 1609.344;

/** ceilingFt: null = no ceiling (unlimited). visM: null = unknown (ignored). */
export function flightCategory(ceilingFt: number | null, visM: number | null): Category | null {
  if (ceilingFt == null && visM == null) return null;
  const rank = (c: Category) => ["VFR", "MVFR", "IFR", "LIFR"].indexOf(c);
  let cat: Category = "VFR";
  const worse = (c: Category) => {
    if (rank(c) > rank(cat)) cat = c;
  };
  if (ceilingFt != null) {
    if (ceilingFt < 500) worse("LIFR");
    else if (ceilingFt < 1000) worse("IFR");
    else if (ceilingFt <= 3000) worse("MVFR");
  }
  if (visM != null) {
    const sm = visM / M_PER_SM;
    if (sm < 1) worse("LIFR");
    else if (sm < 3) worse("IFR");
    else if (sm <= 5) worse("MVFR");
  }
  return cat;
}

/** WMO weather interpretation codes (as used by Open-Meteo). */
const WMO: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Light freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with heavy hail",
};

export const wmoText = (code: number | null) => (code == null ? null : (WMO[code] ?? `Weather code ${code}`));

/** Codes worth a caution badge (freezing, heavy, thunder). */
export const wmoSevere = (code: number | null) => code != null && (code >= 95 || [48, 56, 57, 65, 66, 67, 75, 82, 86].includes(code));

/** Compass point for a direction in degrees ("WSW"). */
export function compass(deg: number | null): string | null {
  if (deg == null) return null;
  const pts = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return pts[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Cloud cover % → METAR-style amount. */
export function coverAmount(pct: number | null): "SKC" | "FEW" | "SCT" | "BKN" | "OVC" | null {
  if (pct == null) return null;
  if (pct < 6) return "SKC";
  if (pct < 32) return "FEW";
  if (pct < 57) return "SCT";
  if (pct < 88) return "BKN";
  return "OVC";
}
