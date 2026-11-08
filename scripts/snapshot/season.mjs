// IATA scheduling seasons: summer from the last Sunday of March, winter from the last Sunday of
// October (the European clock changes). Timetables change with the season and a flight that keeps
// its local time moves by an hour in UTC, so a snapshot window never crosses a season change.
// The app has the same rule in src/lib/season.ts; keep both alike.

const DAY = 86_400_000;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const yy = (y) => String(y % 100).padStart(2, "0");

function lastSunday(y, month) {
  const d = new Date(Date.UTC(y, month + 1, 0));
  return d.getTime() - d.getUTCDay() * DAY;
}

/** The season an ISO date falls in: { code: "W26", name: "Winter 2026/27", from, to }. */
export function seasonOf(iso) {
  const y = +iso.slice(0, 4);
  const summer = lastSunday(y, 2);
  const winter = lastSunday(y, 9);
  if (iso >= ymd(summer) && iso < ymd(winter)) return { code: `S${yy(y)}`, name: `Summer ${y}`, from: ymd(summer), to: ymd(winter - DAY) };
  const w = iso >= ymd(winter) ? y : y - 1;
  return { code: `W${yy(w)}`, name: `Winter ${w}/${yy(w + 1)}`, from: ymd(lastSunday(w, 9)), to: ymd(lastSunday(w + 1, 2) - DAY) };
}
