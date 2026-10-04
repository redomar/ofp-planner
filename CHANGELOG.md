# Changelog

## 1.0.0 — unreleased

First release.

- Finder: filter a schedule snapshot of EMEA airlines by airline, origin and destination (airport or country), aircraft type or family, block time, operating days, and flight number or callsign. Results are sortable and every filter is kept in the URL.
- Random flights: roll any flight, a random destination from an airport, or a random origin into one, with even odds per airport. Next leg continues from the arrival airport after a realistic turnaround.
- Destinations: every destination from an airport on a projected map in airline colours, with flights per week, block times and aircraft types.
- Flight card: great-circle map, scheduled gate times beside typical OUT / OFF / ON / IN times (UTC and local), aircraft, operating days, distance and block time.
- SimBrief dispatch links with airline, flight number, callsign, route, type and departure time. Saved airframes (G-ZONA A20N preset) replace the scheduled type for the same family.
- Brief page: the flight you're about to fly, the date, and the forecast at both ends for the planned times (Open-Meteo), plus the current METAR (VATSIM). Fetched only on this page and cached.
- Settings: airframes, favourites, recent flights, snapshot sources and licences, theme, storage.
- Schedule snapshot pipeline (`pnpm data:snapshot`) and a CLI-only maintenance job for servers.
