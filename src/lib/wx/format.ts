/** Formatting helpers for the weather cards. All inputs nullable; outputs null when unknown. */

const pad = (n: number) => String(n).padStart(2, "0");

/** "14:50Z" */
export function zulu(ms: number | null): string | null {
  if (ms == null) return null;
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

/** "Sun 4 Oct" in UTC */
export function zuluDay(ms: number | null): string | null {
  if (ms == null) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(ms);
}

/** "16:50" local at the airport, or null when the time zone is unknown/invalid. */
export function localTime(ms: number | null, tz: string | null): string | null {
  if (ms == null || !tz) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
  } catch {
    return null;
  }
}

/** "2 h ago", "in 3 d" */
export function relative(ms: number, now = Date.now()): string {
  const d = ms - now;
  const a = Math.abs(d);
  const s =
    a < 90_000 ? "now" : a < 5400_000 ? `${Math.round(a / 60_000)} min` : a < 172800_000 ? `${Math.round(a / 3600_000)} h` : `${Math.round(a / 86400_000)} d`;
  if (s === "now") return "now";
  return d < 0 ? `${s} ago` : `in ${s}`;
}

/** Visibility for pilots: "10 km+" / "4.5 km" / "800 m". */
export function vis(m: number | null): string | null {
  if (m == null) return null;
  if (m >= 10000) return "10 km+";
  if (m >= 5000) return `${Math.round(m / 1000)} km`;
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 50) * 50} m`;
}

export const deg3 = (d: number | null) => (d == null ? null : String(Math.round(((d % 360) + 360) % 360) || 360).padStart(3, "0"));

export const round = (n: number | null, dp = 0) => (n == null ? null : dp ? n.toFixed(dp) : String(Math.round(n)));
