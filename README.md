# OFP Planner

Pick a real airline flight for your flight sim and send it to SimBrief.

- **Finder**: filter a schedule snapshot of European and EMEA airlines by airline, origin, destination (an airport or a whole country), aircraft type, block time, days and flight number or callsign.
- **Random**: roll any flight. Set only *From* to roll a random destination, or only *To* to roll a random origin. *Next leg* continues from where you landed.
- **Destinations**: every destination from an airport (or origin into it) on a projected map in airline colours, with flights per week, block times and types.
- **Times**: scheduled gate times (STD/STA) beside typical OUT / OFF / ON / IN times from tracked flights, in UTC and local time.
- **SimBrief**: one click opens SimBrief dispatch pre-filled with airline, flight number, callsign, route, type and departure time. Saved airframes (such as a custom A20N) replace the scheduled type.
- **Brief**: once you're ready to fly, the forecast at both ends for the planned times (Open-Meteo) and the current METAR (VATSIM). It's fetched only on this page and cached.

It's a static site and runs entirely in the browser. Favourites, recent flights, airframes and preferences are kept in this browser's local storage.

## Develop

```sh
pnpm install
pnpm dev            # http://localhost:3000
pnpm typecheck && pnpm lint && pnpm build
pnpm verify         # browser checks against out/ (add -- --shots for screenshots)
```

## Schedule snapshot

The flight data in `public/data/` is a snapshot built offline by `scripts/snapshot/` and committed, so the site needs no API at runtime. Rebuild it locally with `pnpm data:snapshot` ([docs/data-pipeline.md](docs/data-pipeline.md)) and send it to the live site with `pnpm data:push` ([docs/deploy.md](docs/deploy.md)). The pipeline is CLI-only and never runs on the server or the web.

Live at **https://plans.massorbit.co.uk**.

## Licences

Map outlines: Natural Earth (public domain). Flags: flag-icons (MIT). Weather: Open-Meteo (CC BY 4.0) and VATSIM METAR. Schedule sources and their licences are listed in Settings → Schedule snapshot and in the pipeline docs.
