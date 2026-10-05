# Changelog

## 1.3.0 — unreleased

- Board: a new page with two tabs.
  - **Airport board**: an airport's departures or arrivals for the next 3, 6 or 12 hours, soonest first, as a flight information display (dark screen, amber times, split-flap codes, airline picto in brand colour and wordmark). Remarks follow the clock (on time, gate open, boarding, final call, gate closed, departed; arrivals approaching / landed); "Expected HH:MM" when the flight usually runs 10+ minutes late; "typ" marks typical tracked times where no schedule is published. Local or UTC. A map of where they go; hovering a row lights its route. Only the airlines serving the airport are loaded.
  - **Gate screen**: one flight as the screen above a departure gate, in the airline's colour with its wordmark and a plane picto: flight number and callsign, destination, aircraft and registration, scheduled / new time / arrival in local time, the status with a countdown, and the steps from gate open through boarding, final call, gate closed, ready, pushback and line-up to take-off. Widebodies open the gate earlier; taxi time comes from the flight's tracked OUT→OFF. An info strip rotates destination weather at arrival, flight facts and your message.
  - Clock: real time (the flight's real date) or **virtual** ("STD in 25 min"), so the sequence plays out live on a stream. Controls for the delay, holding on a step, cancelled, gate and gate change, registration, message, and a transparent backdrop for an OBS overlay.
  - **Open screen window** shows only the screen and follows the controls live (BroadcastChannel); **Copy stream URL** gives a 1920×1080-ready URL for an OBS browser source; keys on the screen: ↑/↓ delay, 0 on time, C cancelled, F full screen.
  - **Your SimBrief OFP**: a SimBrief username loads your latest OFP (flight, times, delay, aircraft, registration, passengers, cruise level, runway) onto the screen.
- Gate screen links from the Finder's flight card and from each Journeys leg (with its date).
- City names: the city an airport serves where the data names a suburb (Milan Malpensa, not Ferno; Brussels, not Zaventem).

## 1.2.3 — 2026-10-05

- Airport names: the airport's own name only (Birmingham Airport, not "Birmingham, West Midlands Birmingham Airport"; Jersey Airport, not "St. Peter Jersey Airport"). Where a city is shown it drops the region ("Birmingham", "Paris").
- Finder, Airports tab: a Country menu lists one country's airports (kept in the URL as `cc`).
- Finder: a route with no flights offers **Find a journey with stops**, which opens Journeys with the From, To and airlines filled in.
- Journeys: **Now** beside First OUT after (Z), like the Finder's After (Z).
- Journeys: every label explains itself on hover (Legs, Times, Detour, Day, First OUT after, Duty limit, Report before OUT, Turnaround); "What the options mean" under the form; the start page has example cards with what each one shows, the option guide and how to read the results. Four more examples: a round trip from EGKK, an early start in an 8 h duty, anywhere to LEMD in two legs, and UK to Greece.

## 1.2.2 — 2026-10-05

- No personal airframe in the published build: the default airframe list is empty and set, if wanted, from an untracked `.env.local` (`NEXT_PUBLIC_DEFAULT_AIRFRAMES`). Settings placeholders use an example (G-ABCD, 123456_1700000000000). Airframes already saved in a browser are kept.

## 1.2.1 — 2026-10-05

First release of Journeys (1.2.0 was not released on its own; its notes follow).

- Journeys list sorts from its own headings: Date (soonest departure from today), Distance, Legs, Duty, Ground and Random; click the active one to reverse. The Sort dropdown is gone from the form.
- Timings: the dropdown is replaced by a table of every departure in the coming week, soonest first, each with its date (today / tomorrow), OUT–IN, a timeline of the legs on one UTC clock, duty, ground and block time; sortable by any of them. Picking a row sets the legs, and each leg's Brief link carries its date (the brief now accepts ?d=YYYY-MM-DD).
- Detour limit (default ≤ 2× the shortest path through the stops; 1.5×, 3× or any), so "up to 3 legs" no longer suggests Birmingham to Innsbruck via Dubai.
- Clear button on the form.
- Cards show the next date for timed journeys; up to 24 timings per journey.
- README: Journeys feature and screenshot; the brief weather screenshot shows the 1.1 layout.

## 1.2.0 — not released separately

- Journeys: a new page for multi-leg routes. From an airport (or country), through stops in order, to an airport (or country); leave the end open to roam, or the start open to work backwards from where you want to finish. A round trip may end where it started; no airport is visited twice otherwise.
- Legs: the fewest that work, exactly N, or up to N (1–8). Optional airline filter and "one airline throughout".
- Any day: searches the route network (who flies where in the snapshot). Timed connections: chains real flights by their typical times on the weekly pattern, with a turnaround window (default 35 min–3 h), a day (UTC), a first OUT time, a duty limit (report to last on-blocks, report time adjustable) and an aircraft filter.
- Sort by shortest distance, fewest or most legs, quickest (first OUT to last IN), least time on the ground, or shuffled; Shuffle searches in another order. Timed journeys list their other timings and the weekdays each runs.
- Each journey: a map of the legs in airline colours, every leg with its airlines (network) or flight, aircraft, OUT/IN and turnaround (timed), with Brief and SimBrief per leg; "Find timed connections on this route" turns a network route into real flights; "Save as a favourites group" keeps the legs in order for the Brief start page.
- Examples on the page: EGBB → LEMD via EHAM, a 4-leg day from EGBB, a 6 h duty ending in EPPO, EGBB → LOWI shortest and in 5 legs.
- The search runs in a Web Worker (src/lib/journey/), so the page stays responsive; the form lives in the URL.

## 1.1.0 — 2026-10-05

- Brief weather redesigned: a split verdict (one half per end, coloured by flight category) with plain advice ("Expect low-visibility procedures at EGKK. A departure after 10Z is VFR."); an illustrated scene of each airport at the planned time (fog, cloud, rain or snow, mountains for high fields, day or night, a windsock) with hazard badges and wind / visibility / temp-dew / QNH; OFP Reader's swaying wind arrows coloured by wind category; a "Through the day" strip with both airports' flight category by hour and the flight drawn between OUT and IN; the forecast coded like a METAR (FCST, est.) above the real METAR on continuous-form printer paper like OFP Reader's MCDU sheet (tractor-feed edges with see-through holes, banded lines, ribbon ink, both themes), with Copy text; and a prompt that opens a side-by-side comparison table.

## 1.0.0 — 2026-10-05

First release.

- Finder: filter a schedule snapshot of EMEA airlines by airline, origin and destination (airport or country), aircraft type or family, block time, operating days, and flight number or callsign. Results are sortable and every filter is kept in the URL.
- Random flights: roll any flight, a random destination from an airport, or a random origin into one, with even odds per airport. Next leg continues from the arrival airport after a realistic turnaround.
- Destinations: every destination from an airport on a projected map in airline colours, with flights per week, block times and aircraft types.
- Flight card: great-circle map, scheduled gate times beside typical OUT / OFF / ON / IN times (UTC and local), aircraft, operating days, distance and block time.
- SimBrief dispatch links with airline, flight number, callsign, route, type and departure time. Saved airframes replace the scheduled type for the same family.
- Brief page: the flight you're about to fly, the date, and the forecast at both ends for the planned times (Open-Meteo), plus the current METAR (VATSIM). Fetched only on this page and cached.
- Settings: airframes, favourites, recent flights, snapshot sources and licences, theme, storage.
- Flights table: airline name tag beside each flight (solid, tinted, split pill or edge style; flight first or airline first), how often it flies per week, and the week as a day strip. The table drops city names, distance and arrival time as its panel narrows, so it always fits.
- Airport list: column headings, flights per week as bars, block time as a range bar, distance, and aircraft badges.
- Aircraft badges coloured by manufacturer or by airline, fully coloured or with a coloured edge; hover or focus shows the manufacturer and full model name.
- Settings → Display holds these choices, with live samples.
- The selected flight opens in a floating panel, so the flights table keeps the full width. Flight numbers and airline tags line up down the column. Extra aircraft types show as a small pile of cards with the count.
- Brief ↔ Finder: "Open brief" from a flight and "Back to finder" from the brief. On the brief, "A sample next leg" shows the onward flight it would pick (airline and destination) below the button and takes it in one click, keeping the day sequence; "Next leg" opens every flight from the destination in the finder.
- The flights table and the airport list scroll inside a box the height of the screen, with "Show more" kept in view. Airline tags are sized to the widest airline name in the result, measured in the tag's font. Hovering the airline squares in the airport list shows up to six airline badges, then a "+n more" badge.
- After (Z) starts blank: no OOOI reference or Scheduled tick until chosen (it compares off-block until then; click a chosen reference again to clear it); the time box shows an HH:MM hint; OUT/OFF/ON/IN sits at the right, under Scheduled.
- Number column headings line up with their values; the flight column takes only its width; the hub label sits above the destinations fan.
- The flights table starts unsorted, in the order the data lists flights (origin, destination, then time). Sorting by a column shows Reset sort beside the tabs, which clears it again.
- After (Z) filter: only flights at or after a UTC time (type it or press Now), compared on OUT, OFF, ON or IN, with a Scheduled tick box to prefer published times. Missing times are estimated from the neighbouring one with typical taxi; flights with no usable time are left out. Kept in the URL.
- Airline dropdown: with an origin and/or destination chosen (airport or country), it lists the airlines flying there with their number of flights first, then a dashed rule and every other airline at 0. Backed by a small route index (routes.json) the snapshot now writes.
- Brief: the departure and arrival airports link to the finder with that airport as the origin.
- The flight card's header stays pinned while the card scrolls; clicking it folds the card so the table behind is visible.
- Close a selected flight (× or Escape) and clear the brief; Clear filters also resets the airline.
- Schedule snapshot pipeline (`pnpm data:snapshot`, run locally) and `pnpm data:push` to send a new snapshot to the server over SSH without a rebuild. First snapshot: 15 days (20 Sep – 4 Oct 2026), 57 airlines, 65,858 flights.
