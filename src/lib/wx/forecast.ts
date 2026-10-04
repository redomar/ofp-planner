/**
 * Hourly point forecast from Open-Meteo (free, no key, CORS-enabled):
 * https://open-meteo.com/en/docs. One request per airport covers yesterday + 16 days,
 * so any planned time in range is answered from the same cached response.
 * Licence: CC BY 4.0, attribution "Weather data by Open-Meteo.com".
 */
import { cacheGet, cachePut } from "./cache";
import { flightCategory, type Category } from "./category";

const API = "https://api.open-meteo.com/v1/forecast";
const VARS = [
  "temperature_2m",
  "dew_point_2m",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "cloud_cover_low",
  "cloud_cover_mid",
  "cloud_cover_high",
  "visibility",
  "precipitation",
  "precipitation_probability",
  "weather_code",
  "pressure_msl",
] as const;
type Var = (typeof VARS)[number];

/** Column-oriented, as returned (times in unix seconds, UTC). Any value may be null. */
export interface Forecast {
  lat: number;
  lon: number;
  time: number[];
  hourly: Record<Var, (number | null)[]>;
}

export interface Hour {
  /** ms since epoch, UTC, top of the hour */
  t: number;
  temp: number | null;
  dew: number | null;
  windDir: number | null;
  windKt: number | null;
  gustKt: number | null;
  cloudLow: number | null;
  cloudMid: number | null;
  cloudHigh: number | null;
  visM: number | null;
  precipMm: number | null;
  precipProb: number | null;
  code: number | null;
  qnh: number | null;
  /** Estimated ceiling in ft (null = none below ~20,000 ft or unknown). */
  ceilingFt: number | null;
  category: Category | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Open-Meteo gives cloud cover per layer but no cloud base. When the low layer
 * (below ~6,500 ft) is broken or more, estimate its base from the temperature/dew-point
 * spread (about 400 ft per °C); a broken mid layer counts as a ceiling around 8,000 ft.
 */
function estimateCeiling(low: number | null, mid: number | null, temp: number | null, dew: number | null): number | null {
  if (low != null && low >= 57) {
    if (temp == null || dew == null) return 2000;
    return Math.round(Math.min(6500, Math.max(200, (temp - dew) * 400)) / 100) * 100;
  }
  if (mid != null && mid >= 57) return 8000;
  return null;
}

export function hourAt(fc: Forecast, i: number): Hour {
  const h = fc.hourly;
  const g = (k: Var) => num(h[k]?.[i]);
  const temp = g("temperature_2m");
  const dew = g("dew_point_2m");
  const low = g("cloud_cover_low");
  const mid = g("cloud_cover_mid");
  const visM = g("visibility");
  const ceilingFt = estimateCeiling(low, mid, temp, dew);
  const hasData = low != null || visM != null;
  return {
    t: fc.time[i] * 1000,
    temp,
    dew,
    windDir: g("wind_direction_10m"),
    windKt: g("wind_speed_10m"),
    gustKt: g("wind_gusts_10m"),
    cloudLow: low,
    cloudMid: mid,
    cloudHigh: g("cloud_cover_high"),
    visM,
    precipMm: g("precipitation"),
    precipProb: g("precipitation_probability"),
    code: g("weather_code"),
    qnh: g("pressure_msl"),
    ceilingFt,
    category: hasData ? flightCategory(ceilingFt, visM) : null,
  };
}

/** Index of the hour nearest to `ms`, and whether `ms` falls outside the data. */
export function nearestHour(fc: Forecast, ms: number): { i: number; outside: "before" | "after" | null } | null {
  const n = fc.time.length;
  if (!n) return null;
  const first = fc.time[0] * 1000;
  const last = fc.time[n - 1] * 1000;
  if (ms < first - 1800_000) return { i: 0, outside: "before" };
  if (ms > last + 1800_000) return { i: n - 1, outside: "after" };
  const i = Math.max(0, Math.min(n - 1, Math.round((ms - first) / 3600_000)));
  return { i, outside: null };
}

export async function fetchForecast(
  icao: string,
  lat: number,
  lon: number,
  { force = false, signal }: { force?: boolean; signal?: AbortSignal } = {},
): Promise<{ data: Forecast; at: number }> {
  if (!force) {
    const hit = cacheGet<Forecast>(icao, "fc");
    if (hit) return hit;
  }
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: VARS.join(","),
    wind_speed_unit: "kn",
    timezone: "GMT",
    timeformat: "unixtime",
    past_days: "1",
    forecast_days: "16",
    models: "best_match",
  });
  const res = await fetch(`${API}?${q}`, { signal });
  if (!res.ok) throw new Error(res.status === 429 ? "Forecast service is busy (rate limited). Try again shortly." : `Forecast service replied ${res.status}.`);
  const j = await res.json();
  const time: unknown = j?.hourly?.time;
  if (!Array.isArray(time)) throw new Error("Forecast came back without hourly data.");
  const hourly = {} as Forecast["hourly"];
  for (const k of VARS) hourly[k] = Array.isArray(j.hourly[k]) ? j.hourly[k].map(num) : time.map(() => null);
  const data: Forecast = { lat: num(j.latitude) ?? lat, lon: num(j.longitude) ?? lon, time: time.map(Number), hourly };
  const at = Date.now();
  cachePut(icao, "fc", data, at);
  return { data, at };
}
