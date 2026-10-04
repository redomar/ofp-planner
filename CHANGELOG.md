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
- Flights table: airline name tag beside each flight (solid, tinted, split pill or edge style; flight first or airline first), how often it flies per week, and the week as a day strip. The table drops city names, distance and arrival time as its panel narrows, so it always fits.
- Airport list: column headings, flights per week as bars, block time as a range bar, distance, and aircraft badges.
- Aircraft badges coloured by manufacturer or by airline, fully coloured or with a coloured edge; hover or focus shows the manufacturer and full model name.
- Settings → Display holds these choices, with live samples.
- The selected flight opens in a floating panel, so the flights table keeps the full width. Flight numbers and airline tags line up down the column. Extra aircraft types show as a small pile of cards with the count.
- Brief ↔ Finder: "Open brief" from a flight and "Back to finder" from the brief. On the brief, "A sample next leg" shows the onward flight it would pick (airline and destination) below the button and takes it in one click, keeping the day sequence; "Next leg" opens every flight from the destination in the finder.
- The flights table and the airport list scroll inside a box the height of the screen, with "Show more" kept in view. Airline tags are sized to the widest airline name in the result, measured in the tag's font. Hovering the airline squares in the airport list shows up to six airline badges, then a "+n more" badge.
- The flight card's header stays pinned while the card scrolls; clicking it folds the card so the table behind is visible.
- Close a selected flight (× or Escape) and clear the brief; Clear filters also resets the airline.
- Schedule snapshot pipeline (`pnpm data:snapshot`) and a CLI-only maintenance job for servers.
