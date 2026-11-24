# Departures/arrivals board: what each traffic source can fill

From the PC session's research brief, 2026-11-24 (live checks on the PC plus the docs). The MSFS AI traffic variables aren't confirmed live yet; a read-only traffic probe runs on the owner's next sim session.

## Sources

**MSFS sim objects (SimConnect, in OFP Tower).**
- Covers MSFS native AI, SayIntentions-injected traffic, SkyNet simmers, and network traffic drawn by vPilot or Altitude.
- `RequestDataOnSimObjectType(AIRCRAFT)` within about 200 km, read only.
- Identity and position: `ATC ID` (reg), `ATC AIRLINE`, `ATC FLIGHT NUMBER`, `ATC MODEL`/`TYPE`, `TITLE`, lat/lon/alt, groundspeed, `SIM ON GROUND`.
- `AI TRAFFIC STATE`: "init", "sleep", "flt plan", "startup", "preflight support", "clearance", "push back 1/2", "pre taxi out", "taxi out", "takeoff 1/2", "enroute", "pattern", "landing", "rollout", "go around", "taxi in", "shutdown", "postflight support". It is empty with no flight plan.
- `AI TRAFFIC FROMAIRPORT`/`TOAIRPORT`/`ETD`/`ETA` (seconds relative to sim time): filled only for scheduled traffic-database aircraft. Injected traffic is probably blank.
- `AI TRAFFIC ASSIGNED PARKING`, e.g. "Gate G 4, RAMP lrg (18m)": the only native gate. Also `ASSIGNED RUNWAY` and `CURRENT AIRPORT`.
- These AI TRAFFIC variables are documented as "legacy, still supported".
- No source field. Plan to tell them apart:
  - a callsign found in the VATSIM or IVAO feed → VAT / IVAO;
  - SI or SkyNet → by `TITLE`/model or callsign pattern (to be confirmed);
  - everything else → AI.
- With the owner's SI settings (traffic on, density 81, up to 180 static aircraft), most "AI" at their airports is really SI traffic.

**SayIntentions.**
- `http://localhost:43117/flightJSON` (CORS *, every 3–30 s) covers the owner's own flight only. It has `current_flight.assigned_gate` (e.g. "Gate B7"), origin/destination, SID/STAR, runways, and departure/arrival weather with the ATIS letter and active runways. There is no traffic list.
- The file also holds the pilot's email, `api_key` and userid. **Never relay them; whitelist fields.**
- SAPI needs a developer key and has no traffic endpoint (getVATSIM, getParking, assignGate and getWX are for the own flight only).
- SkyNet has no public feed.

**VATSIM.**
- `https://data.vatsim.net/v3/vatsim-data.json`: public, every 15 s, CORS *. A custom User-Agent got a 403; the default worked.
- `pilots[]`: callsign, lat/lon, altitude, groundspeed, heading, transponder, and `flight_plan` (departure, arrival, aircraft_short, deptime "HHMM", enroute_time "HHMM", rules, route, remarks).
- `prefiles[]`: flights not connected yet ("about to leave").
- No gates; status and ETA have to be worked out. Callsign only: no names or CIDs.

**IVAO.**
- `https://api.ivao.aero/v2/tracker/whazzup`: public, no auth, CORS echoes our origin.
- `clients.pilots[]`: callsign.
  - `lastTrack`: lat/lon, altitude, groundSpeed, heading, onGround, `state`, arrivalDistance, departureDistance, transponder.
  - `flightPlan`: departureId, arrivalId, aircraftId, departureTime and actualDepartureTime (seconds after midnight UTC), eet (s), aircraft.icaoCode, rules, route, peopleOnBoard.
- `state` is a ready-made status: Boarding, Departing, Initial Climb, En Route, Approach, Landed, On Blocks.
- No gates. Terms and update interval are unconfirmed (the wiki returned 403); poll every 15–30 s at most.

**Gates for VATSIM, IVAO and SkyNet.** OFP Tower reads the airport's stands from the sim scenery (Facilities API `TAXI_PARKING`: name, number, type, position, radius; MSFS 2024 adds airline codes). It sends them to the board once per airport, and the board snaps aircraft on the ground to the nearest stand within its radius. These names match what the owner sees in the sim.

**Airline colours and logos.** The callsign's ICAO prefix maps to the site's airline colours. Logos: Airhex has a logo API (demo key, otherwise paid); no free licensed source was found, so it's colour chips and codes for now.

## Proposed split

- OFP Tower adds:
  - a `traffic` message: sim objects within about 100 nm of the chosen airport, every 10–15 s;
  - a `stands` message: once per airport;
  - SI's own gate, from whitelisted fields.
- The board fetches VATSIM and IVAO itself, merges by callsign (a feed wins over a sim object), and works out status and ETA.
- Columns every source can fill: time (scheduled or estimated), callsign, airline chip, type, status, gate (native or snapped), source badge.
- Only some sources can fill:
  - a scheduled time: AI ETD/ETA, VATSIM deptime, IVAO departureTime;
  - from/to for sim objects: only scheduled AI, or a callsign matched in a feed.
  - Designs need a "—" for these.

## SAPI checked live (24 Nov 2026, at the gate at EKCH, SayIntentions running)

- **`getAirport`**: `{}` (empty), with the game running at the gate. Probably needs SI's flight plan to be active; check again in flight.
- **`getVATSIM`**: a GeoJSON `FeatureCollection` of VATSIM **controllers only**: 29 features (20 airport, 5 centre, 4 approach). Each has a polygon and `properties`: `callsign`, `position` (GND/TWR/APP/CTR), `airspace_type`, `rating`, `server`, `frequency_count`, `start_time_epoch`, `controller_id`, `id`. No pilots, so no traffic.
- **`getParking`**: the own flight's assigned stand only: `parking.name` "D2", `type` "Gate", `terminal`, `friendlyId`, `pronouncedName` "Terminal 3 Gate D2", `sizeCategory`, `hasJetway`, `heading`, `latLngData` {lat, lng}, `allowedAirlines` (["NOZ", "SAS", …]), `id`. Useful for the LIVE row's gate; nothing for other flights.
- So far SAPI gives nothing about other traffic or departures.
