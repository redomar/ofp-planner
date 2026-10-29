# Handover: OFP Planner (read this first)

project:
  name: OFP Planner
  what: |
    Static, client-only site to pick a real airline flight for a flight sim (Europe / EMEA, short-haul
    first), roll random ones, browse destinations, see scheduled vs typical OUT/OFF/ON/IN times, and
    open a pre-filled SimBrief dispatch. A Brief page shows the forecast at both ends for the day flown.
  owner: Mohamed Omar (github.com/redomar); sister project OFP Reader (../ofp-reader, charts.massorbit.co.uk)
  status: v1.6.1 released 2026-10-29 (Next.js 16.4.3 security update; stay on ≥ 16.4.1); v1.6.0 released 2026-10-24 (Range page: range rings per sim A320 with payload, custom ZFW/FOB, MLW; maps cover the globe as a disc round their content; aircraft side profiles + liveries prepared, not used yet; feature/more-airlines is a separate draft PR, needs a rebase on 1.6.0); 1.5.2: (a flight in several favourites groups; shared journey legs kept and marked; 1.5.1: map route lines: great circle or rhumb line, Settings → Display; 1.5.0: one row per flight with per-weekday times, Brief/Finder/Board by day, logbook list redone: month table, punctuality switch, flight strips; 1.4.4: Settings: full browser backup .json.gz + restore; 1.4.3: a chosen logbook Status overrides the derived one, data to 10-08; 1.4.2: Log this flight in the Finder panel, grouped dispatch buttons; 1.4.1: logbook Listed time field, data to 10-07; 1.4.0: Logbook, favourites drag, map-tab sort + airport names, Journeys avoid, 4000/5000 m terrain; 1.3.1 folded in, never tagged) · github.com/redomar/ofp-planner (public) · https://plans.massorbit.co.uk (Dokploy)
  repo_url_assumed: https://github.com/redomar/ofp-planner   # src/lib/build-info.ts REPO_URL; change if different
  design_source: ../ofp-reader-handover.md (tokens, type, animation and layout rules came from there)

## 1. Working with the user (what they asked for and liked)

  - Build to "release ready", verify everything yourself, and only show results when fully done.
  - When they ask for options: one image sheet of labelled variations (A1, B2…), real data, day + night,
    saved under ../ofp-planner-previews/<set>/ and opened. Otherwise no previews mid-work.
  - Final screenshots go to ../ofp-planner-previews/release/ (`pnpm verify -- --shots`), never inside the repo.
  - WCAG AA contrast is a hard requirement (an A is acceptable only in rare cases). Check it numerically.
  - Commit locally after each confirmed step: signed (global gpg config), NO AI co-author trailer,
    no push until asked. Keep CHANGELOG.md "1.0.0 — unreleased" up to date.
  - Reply briefly: what changed, what was verified (numbers), what's left; name any removal.
  - Their own SimBrief airframe is personal: never commit it. It lives in the untracked .env.local as
    NEXT_PUBLIC_DEFAULT_AIRFRAMES (JSON array) and seeds the local build only; the published build ships none.
    Examples in code, docs and tests use G-ABCD / 123456_1700000000000.

## 2. Stack and commands

stack: Next.js 16.4.3 (App Router, `output: "export"`), React 19.2 (React Compiler lint rules on),
  TypeScript 5 (pinned: TS 7 breaks typescript-eslint), d3-geo (maps), playwright (verify only), pnpm 10, Node ≥ 20.
note: Next 16 differs from training data; read node_modules/next/dist/docs before framework changes (AGENTS.md).
commands:
  dev: pnpm dev                      # :3000; predev copies flags + builds public/geo outlines
  checks: pnpm typecheck && pnpm lint && pnpm build
  verify: pnpm verify [-- --shots]   # browser e2e against out/ (see §8); SHOT_DIR=… to redirect screenshots
  data: pnpm data:snapshot [--help]  # schedule snapshot pipeline (see §5)
  serve_out: python3 -m http.server -d out 8765   # quick static check (nginx handles .html in prod)

## 3. Architecture (file map)

pages:        # all client components; one shared TopBar (Finder · Journeys · Board · Brief · Logbook · Range · Settings tabs; 561–1080 px only the current tab shows its name), fixed-height StatusLine
  /:          src/components/FinderApp.tsx  — filters, roll bar, Flights/Destinations tabs, floating flight panel
  /journeys:  src/components/JourneysApp.tsx — multi-leg planner (form in the URL, results list + sticky detail with map and legs)
  /board:     src/components/BoardApp.tsx — Airport board (board/FidsBoard.tsx) and Gate screen (board/GateScreen.tsx + controls);
              lib/board/board.ts (dated movements from the weekly pattern, boarding phases, remarks), lib/board/gate.ts (state ⇄ URL,
              snapshot or SimBrief OFP → GateFlight, BroadcastChannel). ?tab=gate&f&d&sb&in=<min to STD, virtual>&late&pin&cx&gate&was&reg&msg&ov&rot&screen=1&ch.
              screen=1 portals the 16:9 screen into body and hides the rest (html.screen-mode); sized in cqw units.
              SimBrief: www.simbrief.com/api/xml.fetcher.php?username=…&json=v2 is CORS *; the username is kept in localStorage only.
  /brief:     src/components/BriefApp.tsx   — FlightCard, date, next leg (sample + full list), weather
  /logbook:   src/components/LogbookApp.tsx + lib/logbook.ts — flights flown (localStorage "ofp-planner:logbook", never mixed with the snapshot):
              totals, RouteMap of routes flown, table (OOOI "HH:MM" UTC on the OUT date, block/air, status from STD/STA vs OUT/IN ±15 min,
              landing fpm + grade; a recorded/chosen status wins over the derived one), add/edit form,
              list (1.5.0): scrolling box (max min(640px,72vh), sticky header); Display.logbook "table" (rows under month headings, Finder flight cell,
              From/To with an airport tooltip) or "strips" (ATC flight progress strips); Display.logBars = the table's Punctuality switch
              (scheduled-vs-flown bar per row). OOOI times live in the status badge's tooltip (data-tip-rows); hovering a row makes its route the
              map's active one (draw-in + plane animation already in RouteMap CSS). JSON import/export (schema "ofp-planner/logbook" v1; parseLogFile cleans untrusted input).
              /logbook?f=<flight id>[&d=date] prefills the form (FlightCard "Log this flight" on the brief and in the Finder panel). The user's own file lives outside
              the repo in ../ofp-planner-logbook/ (it has their registrations).
  /range:     src/components/RangeApp.tsx + RangeMap.tsx + lib/range.ts — range rings for the user's sim A320s (22 variants: Fenix A319/A320/A321
              CFM/IAE × sharklets, A321 × 0–2 ACT; FlyByWire and iniBuilds A320neo). Weights are the developers' SimBrief airframes (public
              www.simbrief.com/api/inputs.airframes.json, "Fenix Simulations (MSFS) - …" etc.); rangeOf() = Breguet with K tuned to ~10% of Airbus
              brochure ranges, reserves 5%/200 NM altn/30 min, −5% −40 NM. MLW (the aircraft's, not runway): LW = ZFW + all reserves incl.
              contingency, so maxFuel() = min(tanks, MTOW − ZFW + taxi, taxi + hold + altn + 21·(MLW − ZFW − hold − altn)); maxZfw() cuts the
              Full preset where MLW would bind at max fuel (Fenix A321: 74.8 t not 75.6), Half = halfway to that. load 3 = custom {zfw, fob|null kg}:
              rangeOf() returns {ok:false, why} when the figures break that aircraft's OEW/MZFW/tanks/MTOW/MLW (row greyed, no ring). State in
              "ofp-planner:range" {origin, load, custom, relief, planes, mine[] with coords} (seeded LEPA LEMD LSGG ENBR TNCM, the user's picks).
              REFERENCE = long-haul airports outside the snapshot. Section 2 "Weight and fuel" (BuildUp): bar OEW|payload|reserves|trip|taxi with
              MZFW/MLW/MTOW marks, sums for ZFW, FOB, TOW, LW, and a per-load table.
              RangeMap = the site's map (baseLayers/Ground/placeLetters/useZoom/ZoomButtons from RouteMap), centred on the origin, disc
              RANGE_NM 6000 (grows only for rings past it; airports beyond the rim aren't drawn); Terrain toggle
              (relief, default off = parchment/blue, no lettering; on = the same bands + contours as every map). Night uses its own darker
              palette (.range-map overrides --m-*, from the first sketch). Figure height is CSS-only (.range-map) so nothing shifts while it loads.
  /settings:  src/components/SettingsApp.tsx — airframes, Display, favourites, recent, snapshot info, theme/storage
              backup: lib/backup.ts — every "ofp-planner:*" key (+ theme, minus wx cache) as raw strings, schema "ofp-planner/backup" v1,
              gzipped with CompressionStream; restore replaces those keys (rolls back on a quota error) and reloads.
components:
  FlightCard.tsx:  sticky foldable header (bg sunk), RouteHead, RouteMap, OOOI table, facts, SimBrief dispatch
  RouteHead.tsx:   departs/arrives in display.routeHead = "timeline" (user's R7, default) | "pass" (R2) | "board" (R5);
                   times from fourTimes() in data/flight.ts (sched → tracked → estimated, EST. badge)
  Results.tsx:     FlightTable (sortable, paged 80, scroll box) and PlacesView (fan map + airport rows)
  RouteMap.tsx:    d3-geo azimuthal-equidistant chart (user's pick "48" from the map previews): depth bands + dashed depth
                   contours, parchment land + height bands/contours, 10°/5° grid, edge degrees (no shading behind),
                   sea/country/range lettering placed with collision boxes, routes (hover = looping draw-in), dots,
                   destination codes display.mapCodes "iata" | "icao" | "off" (old boolean migrated in readDisplay); route lines display.mapLines "great" (d3 great-circle arc) | "rhumb" (trackCoords samples 49 points along the constant-heading line; planeAt follows it). Drawn at the measured pixel width.
                   Disc: projection.clipAngle(mapRadius(far)) = DISC_NM 5200 (Range: 6000) or the furthest route ×1.12 + 300 NM, up to
                   179.9° (whole globe only when routes need it); .map-space (frame minus Sphere) outside the rim; lettering kept inside
                   (onDisc for anchors, onDiscBox for label boxes).
                   useZoom: k kMin–12 over the fitted view (kMin = the disc fits; below k 1 the view stays centred, no pan; ⤢ = k 1),
                   live SVG transform during gestures, redraw ~140 ms after; plain scroll stops at k 1 then scrolls the page (unless already
                   below 1), ctrl/pinch and − go on to kMin; pointer pinch/drag, dblclick,
                   +/−/⤢ buttons top-left (the floating flight panel covers the right).
  terrain:         public/geo/terrain.json v3 (committed, ~1.5 MB / 510 KB gzip, whole globe) from `pnpm map:terrain` (~3 min); land bands
                   200/500/1000/1500/2000/3000/4000/5000 m (h0–h7), sea 200/1000/2000/4000 m (d0–d3) (scripts/build-terrain.mjs: AWS Terrain
                   Tiles z5 → 0.1° grid, poles take the 85° row → d3-contour per 30° tile with 2-step overlap, rings wound for d3 (outer
                   clockwise) so ocean bands > a hemisphere work; Natural Earth 50m land). src/lib/terrain.ts: each polygon a Piece with a
                   bounding cap + lazy LOD copies (0/0.1/0.25/0.6°); visible() culls to the view and picks the level by px/degree; band = fill
                   path + contour path (tile edges left out; tile edges along parallels densified so they don't bow). Contours hidden below
                   3 px/°. outlines-50m.json (whole globe, built at predev) is culled/simplified the same way (linePieces).
  AircraftProfile.tsx (NOT USED YET, prepared for a release): A320-family side view in any paint. Shapes in src/lib/profile.ts
                   (pure, no React: drawAircraft() → parts in metres, aircraftSvg() string for scripts); nose, tail cone, fin,
                   tailplane, doors, exits and engine positions measured from "Airbus A32X family v1.0" (Wikimedia Commons,
                   CC BY-SA 3.0); airframe = {type A319|A320|A321, engine CFM|IAE|LEAP, sharklets} (ACT doesn't change the outline).
                   Paint slots (SLOTS, 11): body, belly, cheatline, nose, tail, tailAccent, tailStripes, tailHoist, tailMark
                   (cross|disc|bar), engines, wingtips; only body + tail required. layout: bellySplit, cheatlineY/Height;
                   fixed: metal, metalDark, glass, lip, line. Clip ids via useId (two on a page must not share them).
                   src/lib/liveries.ts: LIVERIES by ICAO airline (EZY, WZZ, SWR, UAE so far), preliminary, colours only.
                   Previews: ../ofp-planner-previews/aircraft (node --experimental-strip-types liveries.mts renders from src).
  pickers.tsx:     PlacePicker (ARIA combobox, airports + countries "C:ES"), MultiPicker, DayPicker, LengthPicker, AfterPicker
  badges.tsx:      FlightIdent/AirlineTag (4 styles), TypeBadge (maker tooltip), MoreTypes (card pile), WeekStrip
  wx/:             RouteWeather + SVG graphics (Open-Meteo forecast, VATSIM METAR)
  copied from OFP Reader: ui.tsx (Field/V/Tip/Badge/Section), collapse, replay, FlapCode, TooltipLayer, SiteFooter
lib:
  data/types.ts:   the data contract with the pipeline (manifest, airports, airlines/<ICAO>, routes)
  data/load.ts:    fetch + in-memory cache; useDataset(airlines|"all"); findFlight(id); loadRoutes()
  data/query.ts:   Query ↔ URL, filterRows, sortRows, groupByOtherEnd, roll, pickNextLeg, oooiTime, parseClock
  data/flight.ts:  gcNm, blockTime (scheduled → observed → estimated), hhmm/dur/localHHMM, flightNo/fltnum/plannedOut, families;
                   onDay(f, isoWeekday) = cached copy with that weekday's times (byDay), base = the original row; varies(f);
                   weekTimes(f) (Mon..Sun for the week section); dayGroups(f) (weekdays that run alike; Journeys input)
  per-day times (1.5.0): Finder rows = onDay(f, day filter's single day ?? today); Brief = onDay(f, weekday of the date);
                   Board/gate per date; After with several days = any day. FlightCard → WeekTimes.tsx (A1 table, A2 grouped,
                   A3 DayTabs, A4 timeline; display.week) and badges VariesMark (display.variesMark tag/word/tilde).
                   findFlight falls back to brand:op+fn|cs:route when the days/~n part of a saved id no longer exists.
  journey/engine.ts: pure multi-leg search (no app imports; runs in Node with --experimental-strip-types for testing).
                   network mode over routes.json edges; timed mode over weekly flight instances (day × OUT, week minutes,
                   wrap-around), reversed graph/clock when only `to` is set. DFS with hop lower bounds (BFS to each waypoint),
                   distance/time bounds, branch-and-bound on the K-th best group, node budget (250k / 400k), roam branching cap 7.
                   Results grouped by airport sequence; timed groups keep ≤16 flight-chain variants with their weekdays.
  journey/plan.ts: the form ⇄ URL (?from&via&to&avoid=C:DE,EDDF&legs=f|4|u5&t=1&al&one&type&sort&dir=desc&detour=1.5|3|any&seed&day&after=HHMM&duty&report&turn=35-180&j=<group>), examples.
                   List sorts: next (client-side by soonest date; engine ranks quickest) · distance · fewest (dir=desc → engine "most") · quickest · waiting · random.
  journey/dates.ts: weekly timings → next real departures from now (departures, soonest, legDate, dateLabel).
  journey avoid:   Spec.avoid (Place[]); engine's avoider() drops edges/flights touching an avoided airport before the graph is built
                   (so the hop/distance bounds stay right); from/to/via places are exempt. Landing/leaving only, no overflight check.
  favourites order: the favourites array order is the order inside each group; placeFavourite(id, group, before) in saved.ts.
                   SavedFlights drags by pointer events on the grip (setPointerCapture, elementFromPoint on [data-fav]/[data-fav-group]),
                   arrow keys nudge; focus is put back on the grip after React moves the row.
  JourneyTimings.tsx: the timings table (sortable, legs timeline on one UTC clock); replaced the variant dropdown in 1.2.1.
  journey/worker.ts + useSearch.ts: Web Worker (new Worker(new URL("./worker.ts", import.meta.url))); data posted once per key,
                   newest request wins, busy derived in render. Turbopack also copies worker.ts into out/_next/static/media (harmless).
  places.ts:       countryName + placeOptions (shared by Finder and Journeys)
  data/flight.ts:  airportLabel = the airport's name only (OurAirports' city is often a suburb or "City, Region"); cityName drops the region
                   and uses SERVES (icao → city served) where OurAirports names a suburb; add to it when a board shows a suburb
  simbrief.ts:     airframes (localStorage) + dispatch URL builder
  saved.ts / display.ts / storage.ts: favourites, history, ready flight, prefs, display choices; all localStorage "ofp-planner:*"
  aircraft-data.json + aircraft.ts: ICAO type → maker/model, maker → tone
  colors.ts:       routeColor, textOn (black/white on a brand colour, always ≥ 4.58:1)
  measure.ts:      canvas text measurement (airline tag widths), useFontsReady
styles: src/app/base.css (sections lifted from OFP Reader) + planner.css (app) + wx.css (weather agent)
ids_and_urls:
  flight_id: "<brand>:<op><fn|callsign>:<orig>-<dest>:<days>" (+"~n" if duplicate), e.g. EZY:EJU54LH:LEMD-LFSB:4
  finder_url: ?al=EZY,RYR (empty = all) &dep=LEMD|C:ES &arr= &type= &len=60-180 &days=1,5 &q= &after=1803&ref=out|off|on|in&sched=1 &view=places|map &f=<id>
  brief_url: /brief?f=<id>   (else the saved "ready" flight)

## 4. Data: what exists and why

snapshot_now: 57 airlines · 41,593 flights (one per weekly pattern; 1.4.4 had 69,935 rows) · 15,802 routes · 584 airports · window 2026-09-20 → 2026-10-08 (19 days)
size: public/data ≈ 11 MB raw, ≈ 1.2 MB gzipped (biggest RYR.json 3.6 MB / 423 KB gz); routes.json 315 KB / 62 KB gz
loading: manifest revalidated each visit; other files fetched with ?v=<generatedAt> (cache-friendly);
  airline files load only for selected airlines; routes.json only once an airport is chosen.
sources_used:
  adsb.lol globe history (ODbL 1.0): the backbone. Every observed flight: callsign, route, days, OUT/OFF/ON/IN.
    Daily ~3.6 GB archives on GitHub releases; the pipeline range-probes and reads only the ~0.9 GB heatmap slice.
  VRS standing data (CC0): fills one unseen end when it agrees with the seen end; positioning patterns; type gaps.
  tar1090-db: ICAO type per airframe (only the type field used; no licence stated).
  OurAirports (public domain): airports, coords, elevation, IATA. mwgg/Airports (MIT): IANA time zones.
  Ryanair public timetable (services-api.ryanair.com/timtbl): RYR flight numbers + STD/STA. Light, cached,
    non-commercial; site terms discourage scraping → `--no-ryanair`. OPEN DECISION: user hasn't said keep/drop.
sources_rejected:
  FlightRadar24, FlightAware: terms forbid scraping. iflyschedules.com: competitor's database, not copied.
  easyJet / Wizz sites: bot protection (403). OpenSky: historical flights need an account now.
  OpenFlights: routes from 2014. aviationstack / AeroDataBox: keys + tiny free quotas.
  aviationweather.gov: no CORS (can't call from the browser). → weather uses Open-Meteo + VATSIM (both CORS *).
consequences_shown_in_ui:
  - fn (flight number) is null for alphanumeric callsigns (EJU54LH): no open source maps them. The UI names the
    flight by callsign; SimBrief fltnum = callsign minus operator prefix ("54LH"), airline = operator (EJU).
  - std/sta only for Ryanair; elsewhere "typical" tracked times (dotted underline), labelled as such.
  - OUT/IN often null (patchy ground coverage); OFF/ON ≈ ±1 min.
  - one callsign may appear as several flights (different times on different weekdays).
  - ~9,700 RYR rows are timetable-only (samples 0, no callsign/type) → type shown as the airline's usual type.
  - thin coverage over North Africa / Middle East / sea; a 14-day window misses some weekly flights.
field_derivations: docs/data-pipeline.md ("How each field is derived") — don't duplicate, keep that file current.

## 5. Running the data pipeline (recipes)

where: scripts/snapshot/ (index.mjs CLI; airlines.mjs brands/colours/region; sources/*; legs.mjs; build.mjs; route-index.mjs)
caches: data/raw (88 MB downloads) + data/cache (493 MB; tracks/<date>.ndjson.gz per day) — gitignored, keep them.
cached_days_now: 2026-09-20 … 2026-10-08 (data/cache ≈ 530 MB)
timing: fetch ≈ 4 min/day at concurrency 3 (download-bound); first Ryanair pass 15–20 min (cached 10 days); build ≈ 20 s.
recipes:
  add_a_15th_day: |
    pnpm data:snapshot --days 15 --end 2026-10-04
    # fetches only 2026-10-04 (others are cached), rebuilds everything; coverage becomes 09-20 → 10-04.
    # Window length is just --days; --end defaults to yesterday UTC (adsb.lol publishes the next morning).
  roll_the_window_forward: pnpm data:snapshot            # last 14 days ending yesterday; old cached days are kept but unused
  rebuild_only: pnpm data:snapshot --stage build --days 14 --end 2026-10-03   # seconds, no network except reference refresh
  one_airline: pnpm data:snapshot --stage build --airline EZY                 # keeps other airline files as they are
  without_ryanair: pnpm data:snapshot --no-ryanair
  force_redownload: add --refresh
  only_route_index: node scripts/snapshot/route-index.mjs [outDir]
  add_an_airline: add a brand to AIRLINES in scripts/snapshot/airlines.mjs (icao, iata, name, callsign word,
    operators[], colors[primary, secondary]), then --stage build. Region filter = REGION in the same file.
  after_any_run: pnpm build && pnpm verify, check counts in Settings → Schedule snapshot, commit public/data.
dokploy: project "OFP Planner" (PC5mxBiH9LB-oYVT1hoUv) · app "web" oAmzXw0iAtwtFQM__Jx1M (appName ofp-planner-web-sjnvl5) ·
  Dockerfile build from redomar/ofp-planner main, autodeploy on push · domain plans.massorbit.co.uk:80 (Let's Encrypt) ·
  bind mount /srv/ofp-planner/live → /usr/share/nginx/html/live · updateConfigSwarm start-first + rollback.
  Git remote uses the SSH alias github-origin (git@github-origin:redomar/ofp-planner.git).
data_to_server: pnpm data:push (rsync over SSH to koronto:/srv/ofp-planner/live/data, atomic swap; --status, --clear). See docs/deploy.md.
server_latch_container_alternative: |
  CLI only, never a web route. docker compose --profile maintenance run --rm snapshot
  → writes the "live" volume; nginx serves /data/ from /live first, falling back to the baked copy (nginx.conf).
  Cron example and rollback: docs/deploy.md. Refresh after schedule changes (end of March / October).

## 6. Product decisions (and why)

  - Snapshot, not live API: free/unlimited schedule APIs don't exist; the user accepted possibly-stale data.
  - Finder is one dense page: filters → roll bar → Flights | Destinations tabs; the selected flight floats in a
    panel on the right (fixed, foldable header) so the table keeps the full width. × or Escape closes it.
  - Random: "Even odds per airport" spreads rolls across destinations/origins, not flights. Set only From →
    random destination; only To → random origin. Next leg: same airline, turnaround 35 min–8 h, not straight back.
  - Brief: "A sample next leg" previews the pick (airline | destination badge) under the button and takes it,
    dated the first operating day after landing; "Next leg: all flights from X" opens the finder (all airlines).
    Airports on the brief link to the finder with that airport as origin.
  - Map tab (view=map): groupRoutes(filtered) → RoutesView (map of ≤400 busiest routes + paged route table);
    picking a route sets dep/arr and returns to Flights. RouteMap's hub = an end shared by every route.
  - Airline dropdown counts flights for the chosen airports (routes.json), flying airlines first, then a dashed
    "Not flying to X" group at 0.
  - After (Z) filter (blank by default: no reference, Scheduled unticked; no reference = compare OUT): OUT/OFF/ON/IN switch + Scheduled preference; missing times estimated from the neighbour
    (taxi-out 12 min, taxi-in 6 min); same day only (no wrap past midnight); flights with no usable time excluded.
  - Display settings (Settings → Display): airline tag solid (default) / tinted / split / edge; flight first
    (default) or airline first; aircraft badges by maker (default) or airline, fully coloured (default) or edge.
  - Flights table: Freq column (2× / Daily) then a 7-letter week strip; flight number and airline tag widths come
    from the whole filtered result (mono ch for numbers, canvas-measured text for names), so columns line up.
  - Weather is fetched only on the Brief (never on the Finder), cached (forecast 60 min, METAR 10 min).
  - User flight numbers: src/lib/fnoverride.ts, "ofp-planner:flight-numbers" { "EJU:EJU54LH": "1016" }; applyFn() fills
    fn (fnUser=true) in the Finder rows and Brief; SavedFlights uses overrideFor(). useFnOverrides is content-stable
    (a new object on every storage change caused an update loop with pushHistory).
  - Favourites: SavedFlight.group (null = ungrouped), groups list in "ofp-planner:fav-groups", prefs.lastGroup =
    where new stars go. SavedFlights.tsx renders favourites by group + recent, on the brief start page and Settings.
    1.5.2: a flight may be in several groups = several entries with the same id, one per group (unique by group+id).
    A flight is ungrouped (one entry) or in ≥1 groups, never both: writeFavourites() tidies on every write. Entry ops take
    the group: moveFavourite(id, from, to), placeFavourite(id, from, group, before), removeFavourite(id, group?) (no group =
    everywhere, the star), setInGroup (card ticks); groupsById() for the shared marks. saveJourney returns {name, shared}.
  - Journeys (1.2): timed legs use plannedOut (or IN − block) and blockTime; flights with neither are left out of timed search.
    Duty = report (default 45 min) → last IN. Turnaround window 35 min–3 h by default. "Save as a favourites group" (saveJourney in saved.ts)
    writes a new uniquely named group with the legs in order (legs in other groups stay there too). The form renders only after the URL is read (no CLS on shared links).
    Detour cap (1.2.1): total ≤ max(f × shortest path through the stops, + 250 nm), f = 2 by default; off for round trips and open ends.
    Brief accepts ?d=YYYY-MM-DD (Journeys passes each leg's date).
  - Clear filters resets everything including the airline (→ all airlines).
  - The flights table is unsorted by default (data order: the pipeline writes flights by origin, destination,
    then time; airlines in manifest order). Sorting shows Reset sort, which returns to that order (sort = null).

## 7. Design rules in force

  - Tokens/typography/animation from ../ofp-reader-handover.md: paper + 48px grid, sheets with magenta crop marks,
    IBM Plex Sans / Mono, Barlow Condensed labels; magenta = current/active, blue = links/actions, status colours only for status.
  - Brand colours are decorative only (route lines, squares, tag fills with textOn). Route lines get an ink casing
    (--casing) for 3:1 against the map. Never use a brand colour as text on paper.
  - Manufacturer tones: Airbus blue · Boeing green · Embraer amber · ATR/Dash 8 red · others ink.
  - No layout shift: fixed-height status line; lists render once all requested airlines have loaded;
    width-reserving placeholders; target CLS ≤ 0.02 on every page (verify enforces it).
  - Respect prefers-reduced-motion everywhere (map line draw, drawer slide, flaps).

## 8. Verification (pnpm verify)

  - scripts/verify.mjs serves out/ itself (page.html beats folder of the same name, like nginx try_files) and
    drives Chromium: ~112 checks — finder flows (combobox, random destination, preferred airframe (example seeded), destinations,
    next leg, reload, tooltips, fold/pin, close, clear), airline counts, After filter, every page × 1280/390 ×
    day/night (sideways scroll, CLS, AA contrast incl. color-mix backgrounds, console errors), brief (weather,
    next leg, airport links, back link), settings (airframe from a pasted Plan link, display choices apply).
  - Chromium: Playwright's download is blocked in this sandbox; the script falls back to the newest cached
    ~/Library/Caches/ms-playwright/chromium-*/…/Google Chrome for Testing (or CHROME_PATH).
  - Always: pnpm typecheck && pnpm lint && pnpm build && pnpm verify before committing.

## 9. Gotchas learnt here

  - Next static export writes both brief.html and a brief/ folder; static servers must prefer the .html.
  - position: sticky dies inside overflow: hidden → use overflow: clip on the card.
  - CSS grid with min-height stretches rows (align-content) → content jumped once the list grew; align-content: start.
  - Old selectors win on specificity (.flights td small.muted beat .flights .city) — check computed styles.
  - Classes that set display (blockbar, place-types) override .hide-s → hide them inside the media/container query.
  - Container queries (.results .tbl-wrap, .places) drive column hiding; the panel is narrower than the viewport.
  - React Compiler lint: no setState in effects (use "adjust state during render" or keyed remounts), no Date.now()
    in render (useState(() => Date.now())), and memo deps must be preservable (define closures after useMemo).
  - React 19 treats `ref` as a normal prop on function components — don't name a prop `ref`.
  - A global .sub class (sub-heading with dashed rule) exists in base.css — don't reuse the name.
  - fieldset defaults to min-width: min-content; set min-width: 0 or wide samples overflow phones.
  - verify.mjs excuses only weather-service (open-meteo / vatsim) HTTP failures, tracked per response.
  - Tooltips hide on any scroll (TooltipLayer); tests must hover after scrolling settles.
  - Status text that changes length mid-load shifts what follows → keep loading text constant; let the bar show progress.
  - tsconfig excludes out/: Turbopack emits the worker source as a .ts asset there, which `next build`'s type check would pick up.
  - No prettier config: new files were formatted with --print-width 180 to match the existing code.
  - A python heredoc ending in `open(p,'w').write(s)` with s undefined truncates the file — restore from git.

## 10. Open items / ideas

  - After 1.5.0 (per-day times): Journeys UI could show each leg's weekday times in the timings table; 116 numbered callsigns
    on other airlines still have two rows (seen twice on one date = two flights). Data releases need pnpm data:push too
    (the server's live data overlay shadows the data baked into the image).
  - Ryanair timetable: kept on (user decision 2026-10-05). Next releases: feature branches → release/x.y.z → PR → merge
    commit → signed tag → GitHub release; pushing main auto-deploys (Dokploy).
  - Refresh the snapshot after 25 Oct 2026 (winter schedule) and periodically after; consider a longer window
    (--days 21–28) to catch weekly flights.
  - Possible: user-typed flight number override for fn-null flights; more airlines in airlines.mjs;
    favourites/next-leg "rotation" planning; a printout like OFP Reader's MCDU sheet.
