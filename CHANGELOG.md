# Changelog

## 1.5.0 — 2026-10-09

- **One line per flight, with its times for each weekday.** A flight that leaves at different times on different days (FR658 Brussels → Dublin: 07:35Z on Mondays, 08:30Z on Wednesdays, 07:50Z at weekends) used to be split into several rows, which overlapped on some days and showed departures that don't exist. It is now one flight with its weekly pattern.
  - Data: rows of the same callsign and route merge unless it was seen twice on the same date; Ryanair rows with the same flight number merge whatever the callsign. A delayed flight now counts as a sighting of its weekday instead of being dropped. Days whose times differ carry their own scheduled and typical times; days seen only once fall back to the flight's usual times. Snapshot: 41,593 flights (was 69,935 rows for the same 19 days; the drop is duplicates, not lost data), 15,772 of them vary by day. Files are slightly smaller.
  - Finder: the table shows the time of the day filter's day when one day is chosen, else today's, with a mark when other days differ (Settings → Display: **VAR tag**, **"varies"** under the time, or a **tilde**). **After (Z)** compares the chosen day's times; with several days chosen, any of them may pass.
  - Flight card (Finder panel and Brief): the brief's date (else today) sets the times shown, the SimBrief link and the next-leg sample. A **Times by day** section shows the week (Settings → Display: **week table** (default), **grouped by timetable**, **day tabs** over the OOOI table, or a **week timeline** on one UTC axis). The note under the OOOI table says how many of that weekday were tracked.
  - Board and gate screen: each date uses that weekday's times. Logbook "Log this flight" fills in that day's STD/STA.
  - Journeys: a flight whose times change is searched once per set of weekdays that run alike, so timed journeys use the right time each day. Searches take the same time or less (EGBB → LOWI in 5 legs: 255 → 167 ms in Node).
  - Saved favourites, recent flights and shared links keep working: an id from before the merge (its days or "~n" part no longer exists) finds the same airline, number or callsign and route.
- **Logbook list, redone.** The list scrolls in its own box (header row stays put) instead of making the page as long as the logbook, and fits the page width down to a phone, with no sideways scrolling.
  - **Table** (default): flights under month headings with that month's flights, block time and routes, in rows like the Finder's: the flight cell follows Settings → Display (airline tag style and order), From and To with the city. Hovering an airport shows its name, city and country, ICAO/IATA, elevation, time zone and how often it's in your logbook.
  - The OUT · OFF · ON · IN column is gone: hover (or focus) the **status** to see each time against the schedule, with block and airborne time. Everything else is still in the row's details.
  - **Hovering a flight shows it on the map**: its route draws in and the aircraft appears.
  - **Punctuality** switch above the table: a bar per flight instead of the airports, the scheduled block as an outline and the flown one solid in the airline colour, on one scale.
  - Settings → Display → **Logbook**: **Flight strips**, one paper strip per flight like an ATC flight progress board (airline colour band, flight and callsign, aircraft and registration, route, block, touchdown rate, date and a stamped status). Light and dark.
- Finder: **Flight or callsign** now finds a flight by its airline's IATA code too: "FR658" or "FR 658" as well as "RYR658" (only the ICAO form matched before).

## 1.4.4 — 2026-10-09

- Settings → Appearance & storage: **Download a backup (.json.gz)** saves everything this site keeps in your browser (airframes, favourites and groups, recent flights, the ready flight, your logbook, flight numbers you typed, display choices, theme, SimBrief username, folded sections) as one gzipped file. **Restore from a backup…** shows what the file holds, asks, then puts it all back exactly and reloads; if the browser refuses part-way, the previous data is put back. The weather cache is left out (it goes stale within the hour). Clear all saved data now suggests downloading a backup first.

## 1.4.3 — 2026-10-09

- Logbook: a **Status** chosen in the form (early, on time, late, delayed) now overrides the one worked out from the times. Only Cancelled used to stick; any other choice was replaced by the status from STD/STA against OUT/IN whenever those times were filled in. "From the times" still works it out.
- Data: snapshot 2026-09-20 → 2026-10-08 (19 days, 69,935 flights, 584 airports, 15,731 routes).

## 1.4.2 — 2026-10-09

- Finder: **Log this flight** in the selected flight's panel opens the logbook form prefilled from that flight (route, callsign, flight number, airline, type, listed STD/STA; the date is today). Nothing is saved until you submit it.
- Flight panel and brief: the buttons are grouped. **Open in SimBrief** has its own full-width row; brief, gate screen, log and next leg sit in an even grid below it.

## 1.4.1 — 2026-10-08

- Logbook: **Listed time** in the form (under Times), so the time a tracker lists for a flight can be added or edited; a bad time is refused with a message. It was imported and shown but had no field.
- Data: snapshot 2026-09-20 → 2026-10-07 (18 days, 68,927 flights, 584 airports, 15,712 routes).

## 1.4.0 — 2026-10-07

- **Logbook**: a new page for the flights you've flown. Totals (flights, block and airborne time, distance, airports, types, on-time share, average and softest landing), a map of every route flown (select a row to highlight its route), and one row per flight with its OOOI times, block and airborne time, status against the schedule (early, on time, late, delayed; ±15 min) and the landing rate with a grade (butter … very hard). Details per flight: callsign, operator, registration, scheduled times, landing g, cruise level, fuel, passengers, simulator, notes.
  - Add or edit flights by hand; **Log this flight** on a brief starts the form from that flight.
  - **Import** and **export** as JSON (`ofp-planner/logbook`, version 1; the format is described on the page). Re-importing a flight with the same id updates it; bad entries are skipped and named.
  - Kept in this browser only, apart from the schedule snapshot: nothing in the Finder, Journeys or Board reads it. Settings → Clear all saved data now says it removes the logbook too.
- Map terrain: two more height bands, 4000 m and 5000 m (Alps, Caucasus, the Iranian and Tibetan plateaus).
- Board: the To/From cell stays a table cell, so every row's bottom border lines up (the split-flap cell used to end short of the row).
- Favourites: drag a flight by its grip to reorder it within a group, or drop it on another group (or on "Drop here to take it out of its group"). Arrow keys on the grip move it up or down; Escape cancels a drag.
- Finder, Map tab: each route shows its codes over both cities with their country flags, and beside them, set off by a rule, the two airport names (hidden when the list is narrow). The columns sort (Route, Airlines, Flights / week, Block time, Distance; numbers biggest first on the first click), Flights / week by default; **Busiest first** returns to it. The map always shows the busiest routes. The table header has the sunk background.
- Journeys: **Avoid** in the route row (From · Via · Avoid · To): countries or airports no leg may land in or leave ("avoid Germany"); in the URL as `avoid=C:DE`. A From, Via or To you pick wins over the list. It doesn't check overflights.
- Data: snapshot 2026-09-20 → 2026-10-06 (17 days, 68,018 flights, 584 airports, 15,683 routes).

## 1.3.0 — 2026-10-05

- Board: a new page with two tabs (same panel tabs as the Finder).
  - **Airport board**: an airport's departures or arrivals for the next 3, 6 or 12 hours, soonest first, as a flight information display (dark screen, amber times, split-flap codes, airline picto in brand colour and wordmark). Remarks follow the clock (on time, gate open, boarding, final call, gate closed, departed; arrivals approaching / landed); "Expected HH:MM" when the flight usually runs 10+ minutes late; "typ" marks typical tracked times where no schedule is published. Local or UTC. A map of where they go; hovering a row lights its route. Only the airlines serving the airport are loaded.
  - **Gate screen**: one flight as the screen above a departure gate, in the airline's colour with its wordmark and a plane picto: flight number and callsign, destination, aircraft and registration, scheduled / new time / arrival in local time, the status with a countdown, and the steps from gate open through boarding, final call, gate closed, ready, pushback and line-up to take-off. Widebodies open the gate earlier; taxi time comes from the flight's tracked OUT→OFF. An info strip rotates destination weather at arrival (with a weather picto), flight facts and your message. A SimBrief OFP whose airline is an IATA code (U2) still gets its brand.
  - Clock: real time (the flight's real date) or **virtual** ("STD in 25 min"), so the sequence plays out live on a stream. Controls for the delay, holding on a step, cancelled, gate and gate change, registration, message, and a transparent backdrop for an OBS overlay.
  - **Open screen window** shows only the screen and follows the controls live (BroadcastChannel); **Copy stream URL** gives a 1920×1080-ready URL for an OBS browser source; keys on the screen: ↑/↓ delay, 0 on time, C cancelled, F full screen.
  - **Your SimBrief OFP**: a SimBrief username loads your latest OFP (flight, times, delay, aircraft, registration, passengers, cruise level, runway) onto the screen.
- Gate screen links from the Finder's flight card and from each Journeys leg (with its date).
- Split-flap tiles (Brief board times and codes): the hinge line is a dark translucent hairline instead of the paper rule colour.
- README: Board feature and screenshots.
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
