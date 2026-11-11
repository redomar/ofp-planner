# Changelog

## 1.9.3 — 2026-11-11

Fixes from the first live test with OFP Link and the Fenix (London City → Heathrow).

- **The map fits the FMS route at the gate:** a short route is shown at least 40 nm across (it was drawn at about 260 nm across, a tiny cluster).
- **Distance to go follows the programmed route** (78 nm, as the MCDU's 82), not the straight line (19 nm).
- **On the ground** the tiles show GND and the ground speed (0 kt parked) instead of dashes.
- An FMS flight shows no "std" time (it has no schedule), and the Flight box says "from your FMS (OFP Link)".
- The destination on the map views no longer clips letters that hang below the line (the g in Perugia).
- **Two airports in one city:** the airport big ("Heathrow") with its city small above ("London"); long names shrink to fit the line.

## 1.9.2 — 2026-11-11

- **The flight from your FMS (OFP Link, Fenix).** With OFP Link running and no Finder flight or SimBrief OFP loaded, the gate screen takes the flight from the route programmed in the Fenix MCDU: origin, destination, flight number and cruise level. It shows no schedule it doesn't have.
- **The programmed route on the map:** the legs as flown in the FMS, each waypoint a small dot (Δ for an overfly), ← / → for a required turn, altitude constraints in Airbus magenta (+6000, FL070, 3000), the missed approach faded; the next fixes ahead are named.
- **Turns and runways:** fly-by fixes drawn as rounded corners and fly-overs swinging past the fix (turn geometry from OFP Link), and the departure and arrival runways drawn as runways (asphalt, edges, threshold markings, the runway number), 7 km long so they read on the map.
- **Closer in for the end of the flight:** within 150 nm of the destination, and after landing, the map closes in on the destination, the aircraft and the fixes ahead (at least 60 nm across), so the approach and the runway show.
- **Joining a flight in the air** (a page opened in cruise, VATSIM's first reading) no longer opens on "Climbing": it says Cruising, Climbing or Descending from what the aircraft is doing.
- Two airports in one city (London City → Heathrow) show their own names.

## 1.9.1 — 2026-11-11

- **A replayed recording follows the screen's flight.** A `&feed=replay` URL for a flight on another route (as in a test in OBS) played the recording at its own positions, so the screen showed thousands of miles to go and the aircraft off the map. Every replay now lays a recording from another route along the flight's line, as rehearse already did; on its own route it plays as recorded.
- **The map shows where you've been.** The flown line on the gate screen's maps runs from the departure through where the aircraft has actually flown (a point every 30 s or 2 nm), no longer a straight line to where it is.
- **The map as designed:** country borders dashed and visible, the coastline in light ink so islands stand out, a faint 5° grid of latitude and longitude, and the land a touch lighter against the sea.

## 1.9.0 — 2026-11-10

The gate screen in flight: it follows the aircraft from boarding to the arrival gate, in eight views for a stream, set up once from Board → Gate screen.

- **Gate screen: a live feed.** The gate screen can follow the aircraft instead of the clock: add `&feed=link` (OFP Link on the sim PC, coming later), `&feed=vatsim&who=CALLSIGN` (reads the public VATSIM data file every 15 s; nothing is sent to VATSIM) or `&feed=replay&rec=/recordings/….jsonl&rate=60` (a recorded flight). The steps and the headline follow the aircraft (Boarding, Doors closed, Pushback … Cruising, On approach, Landed, At the gate) with live figures, and OUT, OFF, ON, IN and the landing rate are stamped as they happen. Without a feed the screen runs on the clock exactly as before.
- **Gate screen views.** The same screen URL, with `&view=`: `full` (the screen you know; in flight its steps run on from pushback to the arrival gate, with the times stamped and the live source named), `map` (a moving map in the airline's colours with the facts beside it), `frame` (a 16:9 window for the game capture, the map on a rail and the status under it), `mapwin` (the map with a small window onto the sim), `corner` (the map as a card in a corner), `strip` (a lower third), `card` and `pill` (smallest). The views over the sim are transparent everywhere but their panels. `view=auto` follows the flight: the full screen on the ground, the strip while flying, the full screen again at the gate. With a feed, the clock shows the aircraft's time.
- **Stream panel** (Board → Gate screen): one browser source, set up once. It shows which live link is in use (OFP Link, then VATSIM with your callsign, then the clock; SayIntentions is not set up yet), what the screen shows at each stage (full screen on the ground, the strip while flying, by default), and which OBS scene names switch the same source to another view (BRB → the frame, Map → the moving map, Camera → the corner card). One URL to copy, with the three steps for OBS. Scene names are read with OBS's browser-source API and need the source's Page permissions; this hasn't been tried in OBS yet.
- **Rehearse:** the recorded flight as a strip of stages under the panel. Play it in a minute to see every switch on the preview; click or drag along the strip to hold a stage, on the stream too, and "Follow the aircraft" to let go.
- **Arrived: one click to the Logbook.** When the aircraft reaches the gate, Board → Gate screen offers its OUT, OFF, ON and IN (UTC, as they happened) and the landing rate, with the flight's details, to write to your Logbook. Writing it again updates the same entry. Times the feed didn't see (it joined in the air) stay empty. A rehearsal offers nothing.
- The gate screen's top row keeps its height when the gate or live-from box comes and goes, so nothing below it moves.
- Rehearsing a flight on another route lays the recorded flight along that route's line (by the share of the way it had flown), so the map no longer draws a line from the departure airport to the recording's own position. A recording of the same route plays as recorded.
- One recorded flight ships for testing and rehearsing: KCLT → KJFK in the Fenix A321, from cruise to the gate.

## 1.8.1 — 2026-11-10

- **Pass with track: no more impossible flight times.** When a flight had a schedule and tracked departures but no tracked arrivals (FR 5237 Brussels → Nador, for one), the track paired the typical OUT and OFF with an ON and IN taken from the schedule, which could show a three-hour flight as 39 minutes in the air. ON and IN are now estimated from the typical OUT plus the block time and carry the EST. badge.

## 1.8.0 — 2026-11-10

The 1.8 redesign: the flight card becomes a boarding pass, Settings → Display is regrouped with a live preview, and the Finder comes in four layouts.

- **The flight card is a boarding pass.** One object instead of four blocks: the header is the airline's band in its own colour (text in black or white, whichever reads), under it where and when, and a tear-off stub with what to do with the flight. Open in SimBrief, the aircraft choice, Brief, Gate screen and Log now sit right under the route on every screen size, above the map; Next leg, the SimBrief link and favourite groups stay at the bottom.
- **Three passes to choose from** (Settings → Display → Flight card: boarding pass):
  - **Pass with track** (default): split-flap codes at both ends, the headline OUT and IN, then the OUT · OFF · ON · IN track. Where a flight has a published schedule and tracked times, the headline is the schedule and the track shows how it really runs ("Typical Tue · usually +5 min off-block"); without a schedule the track only adds OFF and ON, so no time is said twice.
  - **Pass, stub at the side**: the same pass without the track, the actions on a stub at the side (along the bottom on a phone).
  - **Ticket, city first**: the city names large, codes on a quiet line, local time first with Z beside it, the airline's colours on a spine.
  - They replace the three older styles. A saved choice carries over: timeline and departure board open as the pass with track, boarding pass as the pass with the stub at the side.
- **Flip for times.** The scheduled and typical OUT · OFF · ON · IN table is the back of the pass: the Times button (or F) turns it over, and the pass keeps its height. Settings → Display → "Times always open" puts the table back under the map.
- **Dispatched.** Opening SimBrief stamps the stub "Dispatched" with the time (UTC); the stamp stays for a day, in this browser.
- **Which day's times.** For a flight whose times change through the week, the band names the day shown (TUE).
- **Favourites and recent flights are small tickets**: the airline's colour on the spine, the route on a dotted line, the actions on a perforated stub (along the bottom on a phone). Settings → Display → "Plain rows" brings the list back.
- **Motion with a reason** (none of it with reduced motion on): picking a flight in the table unfolds the panel out of that row; the codes flip when the flight changes, no longer every time the card scrolls back into view; the track draws once; the stub nudges along its perforation when you send the flight to SimBrief.
- **Settings → Display, shorter and in groups.** The settings sit in five groups on the left (Flights list, Flight card, Maps, Logbook, What’s listed), each with how many it holds. Each setting is one row: its name, one line of help, the choices side by side and a small sample of the current one. A setting you changed says “changed · undo”; Reset all puts every display setting back. The pass style stays three picture cards.
- **Rows or Preview.** A View switch at the top of Display: Rows (a sample on each row) or Preview, where one live preview beside the rows (real table rows, the pass with its band, the week’s times, a ticket, the maps) redraws as you choose, and pointing at a setting outlines what it changes. The choice is remembered.
- **Aircraft badges as two plain questions**: “Colour shows: Maker, Airline or Nothing” and “Style: Filled or Edge”, answered on real table rows with a key that follows the answer. “Filled” is now one recipe: by airline it is a light tint of the airline’s colour with its edge, like by maker (it was a solid block). “Nothing” is new: plain badges, the maker on hover. Saved choices carry over.
- Airlines (common / Extra+) and Guessed airports are now in the What’s listed group.
- **Four Finder layouts** (Settings → Display → Finder layout), built from the same parts:
  - **Full** (default): everything on one page, as before, a little tidier.
  - **Calm**: the filter reads as a sentence (“Ryanair flights from Brussels to anywhere on any day”), each word a control, the rest behind More filters; shorter rows that leave out what the sentence already says (city first, the code beside it); the flight in a panel with tabs (Map, Times, Week, Details; the last tab is kept).
  - **Roll first**: opens on “Where are you flying from?” with a real flight already rolled onto the pass; Roll again, or pick from the list below and it lands on the pass.
  - **In place**: no floating panel; the row you pick opens under itself into the pass and the map, and closes when you pick it again.
- **Full, tidier**: the filters you haven’t set (aircraft, block time, days, after, flight number) fold behind More filters on every screen, as phones already did; one in use shows them. The flight panel opens with the pass and the map; Times, Week and Details are headed sections you open with a click, and the panel remembers what you left open.
- Two new display options, off by default: **a dot** for times that change on other days (the column heading explains it once), and **what the filter pins shown short** (one airline as its colour square, one origin as its code).

## 1.7.3 — 2026-11-09

Fixes from a review of the live site, and phone pages reordered so the action comes before the detail.

- **Gate screen: the step line runs unbroken** from Gate open to Take-off. The done part used to stop halfway to the next step and leave a gap before the rest of the line; now one line runs under every step, and the done part follows the clock to the point between the current step and the next (boarding at 05:05 of 05:02–05:17 is a fifth of the way to Final call).
- **Gate screen and Board: times say their zone.** The clock, Scheduled, New time and Arrives each name it (UTC+1, UTC+2…), as does the Board's clock; the Board's header also gives the airport's IATA and ICAO codes.
- **A failed download is no longer shown as an answer.**
  - **Board:** when the route index doesn't download, the status line says so with **Retry**, and the board says it doesn't know how many flights there are, instead of "0 flights" next to "Loading…". While a board loads it says "loading…", not "0 flights". On phones the status line keeps "simulated" (from the weekly timetable) once a board is showing.
  - **Brief:** a schedule that didn't download says "Couldn't load the flight" with **Retry**, which loads it in place. Before, it said the flight wasn't in the snapshot, which only a successful lookup can tell.
  - **Weather:** with no forecast for one or both ends, the summary says the weather there is unknown. It used to say "No significant weather at either end" with both forecasts missing. "fetching…" changes to "unavailable" once the services have failed.
- **Logbook: cancelled flights aren't counted as flown.** They stay in the list, marked Cancelled, but add nothing to flights, block, distance, airports or types, nor a line on the map; the totals and month headings show them apart ("12 + 1 cancelled").
- **Forms point at what's missing.** The logbook form puts the cursor in the first field to fix and marks it, with one error message instead of the hint repeated in red. Settings → Airframes does the same, and an id that can't be one (a stray %, spaces) is an inline error instead of a silent failure.
- **An airport you typed but didn't pick is named under the field** when you leave it ("“zzqx” matches no airport or country: nothing selected"), instead of the text vanishing as if it had been applied.
- **Keyboard and screen readers:**
  - Opening a flight in the Finder puts the focus in its panel; closing it (× or Escape) puts it back on the row or button that opened it. On a phone, where the panel covers the list, the list behind it can't be tabbed into while it's open.
  - Radio-style button rows (Departures / Arrivals, Fewest / Exactly / Up to, Any day / Timed connections, OUT · OFF · ON · IN, the gate screen's clock, Range payloads) are one tab stop each and take the arrow keys, like ordinary radio buttons.
  - Tables that scroll sideways on a phone (Range weights and airports, Settings airframes, sources and airlines, the logbook file example) can take the focus, so the arrow keys reach their hidden columns.
  - Maps with clickable airports are announced as a group of buttons rather than one picture; the chart behind them is skipped. The previews in Settings → Display are skipped too, instead of adding 13 tab stops a screen reader was told to ignore.
  - Every page has a heading naming it and one main region (the Finder had neither).
- **Phones:**
  - The top bar names the page you're on next to the brand, with the page icons spread across a second row. At 320 px it's two rows instead of three (the theme button had a row to itself).
  - A flight opened in the Finder starts under the top bar; its first lines (the flight number) used to be hidden behind the bar's second row.
  - Settings fits a 320 px screen (the logbook and times-by-day previews ran 39 px past the edge).
  - Status lines say the short thing in full instead of being cut off: "Stored in this browser only" (Settings), "Still-air estimate, not a flight plan" (Range), "Your flights, in this browser only" (Logbook); the long forms stay on wider screens.
  - Timed Journeys names the weeks its timetable was seen in ("20 Sept – 24 Oct"), as the Finder does since 1.7.2.
  - The Board's Departures / Arrivals and 3 h / 6 h / 12 h buttons keep their words whole (Departures ran under Arrivals and "12 h" broke over two lines).
- **Journeys: the card and the journey it opens show the same timing.** Sorted by duty, a card showed its best timing (Sat 14 Nov, duty 4h 46m) and the detail opened on the soonest one (Mon 9 Nov, 5h 47m). The detail now opens on the card's timing; the others are still in its timings table.
- **Journeys: a reversed list says what it is** when there are more than 240 journeys: the search keeps the best 240 for the sort, so Distance reversed is "the 240 shortest found, longest first", not the longest of all.
- **Backup restore** stops reading a file once it unpacks past 20 MB (a small gzip can unpack to gigabytes and freeze the tab), and says why; nothing is replaced.

### Phones: what you do before what you read

- **Finder:** aircraft, block time, days, time and flight number fold behind **More filters** (with a count of the ones set; a link that sets one opens them), and the swap button sits beside From and To. Random and the first flights are on the first screen (the first flight was 1,000 px down).
- **A flight opened in the Finder:** the aircraft choice, **Open in SimBrief**, brief, gate screen and log come right after the route, before the map and times (SimBrief was 1,270 px down, below the fold).
- **Journeys** (phones and narrow windows): the list of journeys comes first and the picked one under it; picking a journey scrolls to it, and **Back to the list** returns to its card. Before, the first journey's map and timings came before the list.
- **Brief:** the next leg is its own last section, after the date and the weather, instead of inside the flight card before them.
- **Logbook:** a new flight is date, route and Add; **Times** and **Landing and more** are folded until opened, or open already when they hold something (a flight logged from its brief, an edit). The form is half as tall.
- **Settings:** an index at the top goes straight to Airframes, Display, Favourites, Snapshot or **Theme & backup** (the backup was 11,900 px down a 12,350 px page), opening the section if it was folded. Every section header shows − / + for open or folded.

## 1.7.2 — 2026-11-09

Fixes from an outside review of the planner.

- **A save the browser refuses now says so.** With storage full or blocked, a logbook import used to report "1 new" while nothing was kept, and the add/edit form closed as if saved. The import now says nothing was imported (keep the file), and the form stays open with what you typed. Changing a flight's id in the form is one save now, so a refused save can't lose the old entry.
- **Backups are checked before they replace anything.** A backup whose logbook, favourites, airframes or other saved values aren't in the shape the planner reads is refused with what's wrong ("logbook should be a list"), and nothing is changed. Values already stored are checked as they're read: a list drops entries it can't use, anything else falls back to its default, so the page keeps working.
- **Logbook import is stricter:** the date must be a real day (no 2026-99-99), and block/air time, pax, fuel, cruise level and landing G must be in a sensible range (no negative block time reducing your hours). Rows that fail are skipped with the reason.
- **Journeys shows load failures with Retry.** If the schedule, route index or an airline's timetable fails to download, the status line says so with a Retry button (the plan is kept), instead of "Loading…" forever. Also fixed for every page: when one airline's timetable failed, the airlines that arrived after it cleared the error.
- **The Finder shows the days the schedules cover**, on phones too (20 Sept – 24 Oct 2026), with the snapshot's build date after it on wider screens. Phones used to show only the build date, which read like the schedule's date.
- **Range** no longer claims "good to about ±5%": the model is tuned to Airbus brochure ranges, not measured in the sims, so it now says it's an approximate comparison.

## 1.7.1 — 2026-11-08

- **Schedule snapshot to 24 October**, the last day of the summer 2026 season: 20 September – 24 October (was to 13 October), 47,111 flights (was 45,332), 77 airlines, 615 airports. 14–24 October hold every airline, so the Extra+ airlines have more of their flights (Enter Air 44 → 141, Freebird 76 → 135, Atlantic Airways 49 → 94).
- **Ryanair scheduled times fixed.** Ryanair's STD/STA came from its timetable for the two weeks after the snapshot was built. A build that reached past 25 October picked up winter flights: about 500 Ryanair flights on Sundays, Mondays and Tuesdays that only fly in the winter timetable, with winter times. They're gone now, and STD/STA come from the summer timetable of the snapshot's own last two weeks (Ryanair 8,313 flights; 0.7% with a scheduled time more than an hour from the time flown, was 1.8%).

## 1.7.0 — 2026-11-08

- **More airlines.** Regional airlines that fly under brands already in the planner are now counted: **Air Nostrum** (Iberia Regional), **BA Shuttle** (British Airways UK domestic), **Emerald Airlines** (Aer Lingus Regional) and **Binter Canarias** (the Canary inter-island hops). Iberia 474 → 732 flights, British Airways 920 → 1,071, Aer Lingus 250 → 340, Binter 125 → 242.
- **20 new airlines (Extra+):** Sky Express, Aeroitalia, Edelweiss, Discover Airlines, Air Corsica, TAROM, Eastern Airways, Kuwait Airways, Aurigny, Freebird Airlines, Arkia, Marabu, Nouvelair, Azores Airlines, Atlantic Airways, Enter Air, Canaryfly, Air Greenland, Neos and Cabo Verde Airlines. They come from 5–13 October (every weekday at least once), so a flight seen only once in those nine days (some weekly charters and island routes) isn't in yet; a full download of the earlier days fills those in.
- **Greenland** is part of the region now (Air Greenland Copenhagen ↔ Nuuk, Icelandair to Greenland).
- **Guessed airports** (Settings → Display, off by default). Some airports have no ADS-B coverage near the ground (Pristina, Skiathos, Zakynthos, Florence, Pisa, Belgrade, Tivat…), so their flights were only ever seen once airborne and were left out. EW6612 Pristina → Frankfurt (callsign EWG18UG) was one. Now the airport is guessed from the climb-out or descent: a scheduled airport within 30 NM behind the climb (ahead of the descent), in line with the track, at a plausible gradient, and one the airline is seen flying to on other flights. With the setting on, these 157 flights are listed with a dashed ring next to the guessed airport (Finder table and the flight card's route header); hover it for how it was guessed.
- Turnarounds at such airports are now split into two flights: an aircraft last seen descending below FL150 and back climbing below FL150 20+ minutes later had landed in between (before, the flight in and the flight out were merged into one).
- Snapshot: 45,332 flights (was 41,593), 77 airlines, 20 September – 13 October (was to 8 October).
- Settings → Display → **Airlines: which to list**: **Common** (default, the airlines the planner has always had) or **Common + Extra+**, which adds the smaller leisure, regional and island airlines added in this release, tagged **Extra+** in the pickers. The Finder and Journeys airline pickers, "all airlines" searches, the Board and the route counts follow it; a link, favourite or logbook flight that names an Extra+ airline still opens it.

## 1.6.3 — 2026-11-08

- **Click a line on a map to find its flights.** Every map with several routes now takes a click on a route line, not just on its airport:
  - **Finder → Destinations** and **Map** tabs: a line opens that destination's or route's flights, as picking its row does.
  - **Logbook**: a line marks every flight you've flown on that route and scrolls the list to them; click it again to open each flight in turn, then all of them again. A route flown once opens that flight, and a second click closes it.
  - **Favourites** (a group's map): the same for the flights in that group.
  - **Board**: a line (or its airport) marks that airport's flights on the board, then each one in turn. If one is further down, more rows are shown to reach it.
  - **Journeys**: a leg's line marks that leg in the list; click again to let go.
  - The line stays lit while its flights are marked. Lines that lie on top of each other near a busy airport give the click to the one on top, which is the one that lights up when you hover.

## 1.6.1 — 2026-10-29

- **Security: Next.js 16.3.6 → 16.4.3.** 16.0 to 16.4.0 have two critical advisories ([GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr)) and a high one. The planner is a static export and uses neither the image optimiser nor `use cache`, so it wasn't exposed, but the build no longer stops on the warning. No change to how the planner works.

## 1.6.0 — 2026-10-24

- **Range** page (new tab): how far each sim A320 can go from an airport, as a ring per aircraft on the chart. Every Fenix A319, A320 and A321 variant (CFM or IAE, with or without sharklets, the A321 with 0, 1 or 2 extra centre tanks) and the FlyByWire and iniBuilds A320neo.
  - **Payload**: Empty (ZFW = OEW), Half (halfway to MZFW) or Full (ZFW = MZFW), with fuel as much as fits (full tanks or whatever the MTOW leaves), or **Custom**: your own ZFW and FOB in tonnes (leave FOB empty for as much as fits). Each aircraft checks custom figures against its own OEW, MZFW, tanks, MTOW and MLW; one they don't fit is greyed out with the reason and drops off the map. Every row shows its range and the ZFW + FOB it flies with. Weights are each developer's own SimBrief airframe; the range keeps the usual reserves (5% contingency, 200 NM alternate, 30 min final) and is still air, good to about ±5%.
  - **Max landing weight** (the aircraft's): the reserves (contingency, alternate, final) are still aboard on landing, so the landing weight is the ZFW plus all of them, and it can't pass the MLW. That can limit the fuel, and on the Fenix A321 (MZFW 75.6 t, MLW 77.8 t) it cuts the Full payload to a ZFW of 74.8 t.
  - **Weight and fuel**: for one aircraft, a bar and the sums behind it: OEW + payload = ZFW (against the MZFW), FOB split into taxi, trip and reserves, ZFW + FOB − taxi = take-off weight (against the MTOW), take-off weight − trip = landing weight (against the MLW), what set the fuel, and the ZFW above which every extra tonne of payload costs a tonne of fuel. Below it, the tonnes and range for Empty, Half, Full and Custom. **Weights and assumptions** lists every aircraft's range and ZFW + FOB for each payload.
  - **Origin**: any airport in the snapshot or the long-haul reference list; the map re-centres on it so every ring is a true circle. Clicking a dot flies from there.
  - **Your airports**: add any snapshot airport, or one by latitude and longitude. They're marked on the map and listed with their distance and how many of the aircraft shown reach them. Hover a dot to see which. Starts with Palma, Madrid, Geneva, Bergen and St Maarten. Kept in this browser (and in the Settings backup).
  - The map is the same chart as every other map, centred on the origin. **Terrain** is off by default (plain parchment land and blue sea, no names, so the rings stand out); on, it has the usual height and depth bands, contour lines and names. At night this map has its own darker, cooler colours.
- **Maps reach past Europe.** Terrain (height and depth bands, contour lines), coastlines, borders and names now cover the whole globe, not just Europe, North Africa and the Middle East. Zoom out (− or a pinch) and the chart opens out around what you're looking at, which stays in the middle, until it's a disc reaching about 5,200 NM from the centre (Range: 6,000 NM), like a plotting chart; a map only goes further, up to the whole globe, when its routes do. Names stay inside the disc. A plain scroll still stops at the default view and then scrolls the page. Zoomed far out, the contour lines are left off. Maps only draw what's in view, and simpler outlines when zoomed out, so they redraw about as fast as before.
- Tooltips: a long line now wraps inside the tooltip instead of running past its edge (on the Range page, with every aircraft shown, the A321 rows used to).
- Settings → credits: SimBrief airframes (the Range page's weights).
- Top bar: between 561 and 1080 px wide only the current page's tab keeps its name, so the seven tabs stay on one line; the names are still read out by screen readers (before, below 560 px they were hidden from them too).

## 1.5.2 — 2026-10-10

- **A flight can be in more than one favourites group.** Saving a journey whose leg was already in another saved journey used to move that leg out of the first group, leaving it a leg short without a word. Now the leg stays in both.
  - Journeys: after **Save as a favourites group**, the note names any leg that was already in another group ("Shared: U2 1234 is also in “EGBB → LEMD via 1 stop”. It stays in both groups.").
  - Favourites (Brief start page and Settings): a shared flight has an amber edge and a **+1** mark next to its number (hover: which other groups), and its group says **N shared**. Hovering or focusing it lights up its row in the other groups. **×** on a shared row takes it out of that group only; the row's group menu greys out the groups it's already in. Removing a group keeps its flights wherever else they are.
  - Flight card: **In groups** is now a tick per group instead of one menu, so a starred flight can join several; it says when it's shared. The star still removes the flight from every group.
  - A leg already lost this way isn't brought back: add it again from the journey or the flight card.

## 1.5.1 — 2026-10-09

- Settings → Display → **Maps: route lines**: **Shortest way** (default, the great circle, a straight line on these maps, as before) or **Along the grid**: a rhumb line, one constant heading that crosses every meridian at the same angle, so it curves with the lines of latitude and longitude. Applies to every map (Finder, flight card and Brief, favourites, Board, Journeys, Logbook); the aircraft marker follows the chosen line.

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
