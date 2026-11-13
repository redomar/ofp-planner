/**
 * 1.13: the countdown to the stream's start (the Countdown look), from the URL's go= param. No
 * imports, so the tests load it as it is.
 */
const MIN = 60_000;
/** An off-block time this far gone is an old OFP's, not this stream's. */
const STALE_MS = 3 * 3_600_000;

const GO_PART = /^(?:\d{1,3}m|\d{1,2}:\d{2}z?|std(?:[+-]\d{1,3})?)$/i;
/** A countdown param, cleaned: up to three parts that read, lower case ("5m", "19:30z", "std-30"); null without any. */
export function goParam(v: string | null): string | null {
  const parts = (v ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => GO_PART.test(x))
    .slice(0, 3);
  return parts.length ? parts.join(",") : null;
}

/**
 * When the stream starts (ms), from the countdown param: the first part that gives a time. "5m"
 * counts from `from` (the page loading: an OBS source refreshed as its scene comes on starts again);
 * "19:30" is this PC's clock, "19:30Z" UTC, the one nearest now (up to 12 h either side); "std-30" is
 * 30 min before the off-block (`std`, null without a schedule; skipped when that's over 3 h gone, an
 * old OFP). Null when none does.
 */
export function goTarget(go: string | null, from: number, std: number | null, now: number): number | null {
  for (const p of (go ?? "").split(",")) {
    let m = /^(\d{1,3})m$/.exec(p);
    if (m) return from + Number(m[1]) * MIN;
    m = /^(\d{1,2}):(\d{2})(z?)$/.exec(p);
    if (m) {
      const h = Number(m[1]);
      const mi = Number(m[2]);
      if (h > 23 || mi > 59) continue;
      const d = new Date(now);
      if (m[3]) d.setUTCHours(h, mi, 0, 0);
      else d.setHours(h, mi, 0, 0);
      let at = d.getTime();
      if (at <= now - 43_200_000) at += 86_400_000;
      else if (at > now + 43_200_000) at -= 86_400_000;
      return at;
    }
    m = /^std([+-]\d{1,3})?$/.exec(p);
    // an OFP from an earlier day (today's not made yet) would read "Starting now" all pre-show: the next part instead
    if (m && std != null && std + Number(m[1] ?? 0) * MIN >= now - STALE_MS) return std + Number(m[1] ?? 0) * MIN;
  }
  return null;
}
