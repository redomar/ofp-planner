# Flight data pipeline (snapshot)

The site never calls a flight-data API. A Node script builds a **snapshot** of real airline
flights once, writes it to `public/data/`, and the static site serves those JSON files.
Re-running the script is the "maintenance latch": a CLI only, never reachable from the web.

```
pnpm data:snapshot                 # fetch last 14 UTC days (cached) + build public/data/
pnpm data:snapshot --stage fetch   # download/process ADS-B days only
pnpm data:snapshot --stage build   # rebuild from cache only (seconds)
pnpm data:snapshot --airline EZY   # rebuild one airline, keep the other files as they are
pnpm data:snapshot --days 7 --end 2026-10-03 --concurrency 2 --no-ryanair --refresh
pnpm data:snapshot --out /srv/www/data --cache /srv/snapshot-cache
#   or: SNAPSHOT_OUT=/srv/www/data SNAPSHOT_CACHE=/srv/snapshot-cache pnpm data:snapshot
pnpm data:snapshot --help
```

Defaults: output `public/data/`, raw downloads `data/raw/`, derived per-day tracks
`data/cache/tracks/` (with `--cache DIR`: raw in `DIR`, tracks in `DIR/derived/tracks`).
`data/raw/` and `data/cache/` are gitignored; `public/data/` is committed.

Code: `scripts/snapshot/`

| file | role |
| --- | --- |
| `index.mjs` | CLI, stages, source list for the manifest |
| `airlines.mjs` | airline brands (operators, IATA, callsign word, brand colours), the region |
| `sources/adsblol.mjs` | streams adsb.lol daily archives, keeps only heatmap slices, writes per-day tracks |
| `sources/reference.mjs` | airports, time zones, aircraft types, VRS callsign routes |
| `sources/ryanair.mjs` | Ryanair public timetable (flight numbers, STD/STA) |
| `legs.mjs` | splits an aircraft's day into legs, finds airports, derives OUT/OFF/ON/IN |
| `build.mjs` | aggregates legs into flights, joins the timetable, writes the JSON |

## Output (contract: `src/lib/data/types.ts`)

- `manifest.json` — generation time, coverage dates, sources + licences, airlines (colours, file, count), totals
- `airports.json` — only airports referenced by a flight: `icao → [iata, name, city, country, lat, lon, elevationFt, tz]`
- `routes.json` — flights per airline on every route, `orig → dest → brand → flights` (written by `route-index.mjs`, also runnable on its own). Lets the app show which airlines serve an airport without downloading every airline file.
- `airlines/<ICAO>.json` — `{schema, airline, flights: Flight[]}`, minified

A **flight** is one `(operator, callsign, origin, destination)` at one departure time
(observations clustered within ±40 min), seen at least twice in the window or confirmed by a
timetable. Airlines often fly the same callsign at different times on different weekdays, so
one callsign can appear as several flights with different `days`. Clock times are minutes
after 00:00 UTC.

## Sources

| source | licence | used for |
| --- | --- | --- |
| [adsb.lol globe history](https://github.com/adsblol) (daily GitHub releases) | ODbL 1.0 | every observed flight: callsign, route, days, OUT/OFF/ON/IN |
| [VRS standing data](https://github.com/vradarserver/standing-data) | CC0 1.0 | callsign → route when one end wasn't seen; positioning-flight patterns; aircraft types (gaps) |
| [tar1090-db](https://github.com/wiedehopf/tar1090-db) (Mictronics database) | none stated | ICAO type designator per airframe (only the type is used) |
| [OurAirports](https://ourairports.com/data/) | public domain | airports, coordinates, elevation, IATA |
| [mwgg/Airports](https://github.com/mwgg/Airports) | MIT | IANA time zone per airport |
| Ryanair public timetable (`services-api.ryanair.com/timtbl`) | Ryanair site data, used lightly and non-commercially | Ryanair flight numbers + STD/STA; `--no-ryanair` turns it off |

### How each field is derived

- **o / d** — the aircraft's last ground position before take-off (within 4 NM of an airport)
  or its first airborne point when low near an airport (≤ 10 NM, < 4 500 ft above the field);
  mirrored for the destination. If only one end was seen, the VRS route for the same callsign
  supplies the other end, but only when it agrees with the end that was seen. Legs where both
  ends are unknown are dropped. Both ends must be in the region (`REGION` in `airlines.mjs`:
  Europe, Turkey, Caucasus, Middle East, North Africa, Cape Verde).
- **cs** — the callsign broadcast during the leg (ADS-B).
- **op** — the callsign's 3-letter prefix (EZY / EJU / EZS under easyJet). Use it as SimBrief's `airline`.
- **fn** — Ryanair: matched from the timetable (observed departures voted onto scheduled
  departures of the same route and weekday; majority wins). Others: the digits of a purely
  numeric callsign (`EZY1114` → `1114`), except positioning patterns from VRS. Alphanumeric
  callsigns (`EJU54LH`) have no public mapping to a flight number, so `fn` is `null`.
- **types** — ICAO type of each airframe that flew it (tar1090-db, VRS for gaps), most frequent first.
- **days** — ISO weekdays (1 = Mon) it was observed on, in the origin's local time; for
  timetable matches, the timetabled weekdays.
- **std / sta** — Ryanair timetable only (local times converted to UTC with the airport's
  time zone). `null` elsewhere: no open timetable source exists for the other airlines.
- **out / off / on / in** — medians (circular, so midnight is safe) over the observations:
  - OFF / ON from the first / last airborne point, corrected for the height above the field.
    Accuracy ≈ ±1 min (points are ~20 s apart).
  - OUT / IN only when the ground track around the airport is continuous (no gap > 4 min):
    OUT = movement after a parked spell of ≥ 8 min; IN = first stop of ≥ 2 min (or the track
    ending stopped). Ground coverage is patchy, so these are often `null`.
- **samples** — how many observed operations back the medians.

## Rerunning

Expected runtime: the fetch is download-bound. Each day reads ≈ 0.9 GB (the heatmap stretch
of a ~3.6 GB archive, found by ~90 small range probes). The first full run here took 53 min
for 14 days at `--concurrency 3` (~3 MB/s per stream); a monthly rerun with a kept cache
only downloads the new days.
Ryanair: ~5 000 route-month requests at ~2–5 req/s ≈ 15–20 min the first time, cached for
10 days. The build stage itself takes ~20 s. Disk: ~35 MB per cached day + ~80 MB reference data.
Output: ~11 MB of JSON (≈ 1.2 MB gzipped; nginx gzips it).

### Locally

```
pnpm install
pnpm data:snapshot          # then commit public/data/ with the next release
```

### On the server (Dokploy / Docker)

Use the compose maintenance job (see `docs/deploy.md`): `docker compose --profile maintenance run --rm snapshot`.
It writes into the `live` volume that nginx serves at `/data/` ahead of the snapshot baked into the image, and
keeps its download cache in the `cache` volume so reruns only fetch new days. adsb.lol uploads a day's archive
the following morning (UTC), so the default end date is yesterday.

## Known gaps

- **Flight numbers**: unknown (`fn: null`) for alphanumeric callsigns of airlines without an
  open timetable — most easyJet (`EJU54LH`), BA, Wizz, Jet2 rotations. The callsign is real and
  is what SimBrief needs for ATC; the UI should let the user type a flight number.
- **Scheduled times** only for Ryanair. Everywhere else the observed OUT/OFF/ON/IN are the best
  available times.
- **Coverage**: ADS-B receivers are dense in western/central Europe, thinner over North Africa,
  the Middle East and the sea. Flights there are under-represented or missing one end.
- **Window**: a 14-day observation window. Weekly flights can be seen once and dropped (the
  two-sightings rule filters diversions and positioning flights). Seasonal schedules change at
  the end of March and October; refresh after those dates.
- **Brand colours** are taken from each airline's livery/brand and are approximate.
- Codeshares and wet-leases appear under the operating callsign's brand.
