# Handover: the live flight stack (site + sim PC)

Written on 2026-11-11 by the two Claude sessions that built it: the Mac session (the repo and the site) and the PC session (the sim PC, OFP Tower, OBS). If the sessions or the Remote Control link are lost, start here. For the rest of the project, see `docs/HANDOVER.md`.

## 1. Where things stand

The live site is <https://plans.massorbit.co.uk>. The latest release is **1.10.1**. All releases are signed tags with GitHub releases, made from `main` through PRs.

| Version | What | PR |
|---|---|---|
| 1.8.1 | Pass with track: ON and IN estimated from the typical OUT | #21 |
| 1.9.0 | Gate screen in flight: live feed, phase detector, 8 views, Stream panel, rehearse, Logbook one-click, OFP Link spec | #28 (stack #22–#27) |
| 1.9.1 | Replays follow the flight's route; map: track flown, borders, grid | #29 |
| 1.9.2 | Flight and route from the Fenix FMS (via OFP Tower), runways, turns, close map near the end, joining in the air | #30 |
| 1.9.3 | Map fits the FMS route at the gate, distance along the legs, GND / 0 kt, "Heathrow" big with "London" small | #31 |
| 1.9.4 | Every fix named on a short route; aircraft drawn above the runways | #32 |
| 1.9.5 | No "On approach" right after take-off; short route stays fitted in flight | #33 |
| 1.10.0 | Stream panel made visual (phases × scenes thumbnail grid, presets, preview), settings to OBS live through OFP Tower, `&as=Scene` sources, approach zoom within 10 nm | #34 |
| 1.10.1 | The companion is called **OFP Tower** (was OFP Link) on the site | #35 |

**Naming:** "OFP Tower" is the user-facing name, the owner's choice on 2026-11-11. In code and protocol the old name stays: `feed=link`, `linkSource`, `"app":"ofp-link"`, port 47800, `docs/OFP-LINK.md`, and the PC folder `ofp-link-recorder`. Rename both sides together or not at all.

## 2. How it fits together

```
MSFS 2024 (Fenix A320 family) ──SimConnect──▶ OFP Tower (Python, sim PC)
                                  Fenix gateway (read-only) ─┘   │  ws://127.0.0.1:47800 (loopback only, origin allowlist)
                                                                 ▼
          Board → Gate screen (owner's browser: controls, Stream panel)  ◀─ relay ─▶  OBS browser sources (gate screen pages)
```

- **OFP Tower sends** `hello`, `sample` (1 Hz, 10 Hz near touchdown), `plan` (Fenix FMS route: legs, constraints, turns, runways) and `relay` (Stream panel settings, plus the last settings kept for late joiners). The shapes are in `docs/OFP-LINK.md`.
- **The page decides the phases.** The rules live in `step()` in `src/lib/feed/core.ts`, so tuning them never needs a new PC build.
- **The other feeds:** VATSIM, reading only the public data file every 15 s, and replays of recordings in `public/recordings/`. `feed=auto` picks OFP Tower, else VATSIM, else the clock.

### Code map (site)

| Where | What |
|---|---|
| `src/lib/feed/core.ts` | Message shape (`FeedSample`), `toSample`, recordings (`parseRecording`, v1 fixes), `toPlan` (Fenix plan), phase detector (`step`, `RULE`), `fitToRoute`, `alongRoute`. Imports nothing, so verify loads it in Node. |
| `src/lib/feed/sources.ts` | `replaySource`, `vatsimSource`, `linkSource` (WebSocket, plan messages, `LINK_PORT`). |
| `src/lib/feed/useFlightFeed.ts` | `feedFromParams` (`feed=`, `rec=`, `rate=`, `at=`, `who=`, `port=`), the hook, `feed=auto` priority, trail, plan. |
| `src/lib/feed/relay.ts` | Settings relay through OFP Tower (`sendRelay`, `useRelay`). |
| `src/lib/feed/obs.ts` | OBS scene name (`window.obsstudio`). |
| `src/lib/feed/toLog.ts` | Arrived flight to a Logbook entry. |
| `src/lib/board/gate.ts` | `GateState` and URL params: `view`, `st` (stages), `sc` (scenes: `Name:view` or `Name:a,b,c,d`), `hold`, `GATE_VIEWS`, `PRESETS`, `fromSnapshot`, `fromOfp`, `fromPlan` (FMS flight, `timing:"none"`). |
| `src/components/board/GateScreen.tsx` | Full view G1 (clock or live; flight steps to the arrival gate). |
| `src/components/board/GateViews.tsx` | `shownView` (view=auto: hold, then scene rule, then stage table), `liveFacts`, `routeToGo`, `GateMap` (map, legs, symbols, constraints, turns, runways, near/final zoom), every other view, `sampleLive`, `MiniScreen`. |
| `src/components/board/StreamPanel.tsx` | Stream panel: live link list, audience grid (thumbnails, picker, presets, preview), copy URLs, rehearse strip, `LogArrival`. |
| `src/components/BoardApp.tsx` | Wires the flight (snapshot, OFP or FMS plan), feed, relay, `as=`, screen mode. |
| `scripts/verify.mjs` | Sections: `gate feed`, `gate views`, `stream panel`, `log arrival`, `track estimates`. Run one with `VERIFY_ONLY="<name>"`. |

### URLs that matter

- **Controls:** `/board?tab=gate` (add `&feed=link` to follow OFP Tower; with no `f=` or `sb=`, the flight comes from the Fenix FMS).
- **OBS main source:** "Copy stream URL" in the Stream panel, which gives `…/board?tab=gate&screen=1&view=auto&feed=auto` plus the grid.
- **OBS per-scene source:** "Copy URL for this scene", which gives the same with `&as=BRB`.
- **Test replay:** `&feed=replay&rec=/recordings/kclt-kjfk.jsonl&rate=60&at=20`.

## 3. Verified, and not

**Verified:**
- Each release's targeted verify sections; the last full verify was 856/0 on 1.9.2.
- Live with the Fenix on EGLC→EGLL (TEST0002), on 2026-11-11:
  - the FMS flight and route, the constraints matching the MCDU, runways, the aircraft heading;
  - GND / 0 kt and 77 nm to go at the gate;
  - the take-off phase, and Climbing passing 7,700 ft;
  - in OBS: the Flying/BRB scene switch, the transparency, and the strip, pill and corner views.

**Not verified:**
- Live settings end to end through OFP Tower: each half was tested on its own; it needs a sim session with the panel open.
- A real gate-to-gate recording, so OUT/OFF and pushback vs taxi are covered only by a synthetic check.
- A full approach and landing with OFP Tower: the approach rule, the 10 nm zoom and the landing rate against Volanta.
- OBS after a restart with the panel closed: it should get the last settings from OFP Tower.

## 4. Rules (both sessions)

- **No AI attribution anywhere:** no co-author trailer, robot line or AI credit in commits, PRs, releases or files.
- **Workflow:**
  - Branch per change, signed commits, push and PR only when the owner says.
  - `main` is protected: merge with `gh pr merge <n> --merge`.
  - Release: a signed tag `vX.Y.Z`, then the GitHub release from CHANGELOG, then a poll of the live footer.
- **Personal data:**
  - Never commit the owner's SimBrief airframe; it stays in `.env.local` only.
  - Build releases with `NEXT_PUBLIC_DEFAULT_AIRFRAMES=` empty.
  - The registration HB-IOO in recordings is fine to publish (owner's OK).
- **OBS:**
  - Only the "OFP Planner" profile and collection are ours.
  - FS24 and "Big one - ULTRA Optimised (MSFS24)" are the owner's working setup: never change them.
  - The PC session asks the owner before any OBS change.
- **Fenix:**
  - Read-only, always: nothing is written to the Fenix gateway.
  - No decrypting or decompiling.
- **Tests:** the owner is often short on time. Run the targeted sections per patch, and the full verify (~15 min, in the background, never rebuilding while it runs) when asked.

## 5. How the two sessions work together

- The Mac session reaches the PC through `SendMessage` to **"PC and OFP Planner access"** (Remote Control). The owner approves each message on the PC, and replies come back as cross-session messages.
- **Files from PC to Mac:** the PC serves a folder read-only with `py -m http.server 8766 --bind 0.0.0.0 --directory <folder>` for a few minutes, the Mac downloads it, then the server is stopped. The owner must approve; it once worked without a firewall rule on the Private profile. The PC is `coldboot.local` (192.168.68.101) on the LAN.
- **Testing the site without the sim:** Playwright's `routeWebSocket` stands in for OFP Tower in the browser (send it a real `plan` and `sample`s). The owner's EGLC→EGLL route was used for every map check.

## 6. Open items and ideas

- **Set aside (git stash `1.9.4 schedule-time fix…`):** 8,722 Finder flights (18.5%) have no departure time and never open on the gate screen. The stash estimates the departure from the arrival (7,870 flights) and shows "No times" for the rest (796).
- **Ideas:**
  - Label collision nudging (CF09R/FF09R).
  - FMS leg courses (C177°) drawn as flown.
  - Procedure labels (ILS09R).
  - True runway lengths from OurAirports.
  - A link-only flight (no plan).
  - A manual flight entry.
  - Using the Fenix `flightPhase`.
  - Speed constraints.
- **Monorepo / OFP Tower exe** (agreed shape, not written; in the Mac session's memory):
  - `link/` in this repo plus a shared contract schema;
  - GitHub Actions on Windows builds the exe on `link-vX.Y.Z` tags;
  - the Stream panel links to `releases/latest/download/…`;
  - PyInstaller first, C# later; watch SmartScreen and code signing.
- **Unanswered:** journey-leg tickets (from 1.8).

## 7. Sim PC (written by the PC session)

### 1. Machine
- Windows 11 Pro 10.0.26300. Hostname `COLDBOOT`. Wi-Fi LAN `192.168.68.101` (DHCP, may change). Tailscale is installed but not used by OFP Tower.
- Python 3.12.10 (user install, `%LOCALAPPDATA%\Programs\Python\Python312\python.exe`, via winget). pip packages: `SimConnect` 0.4.26, `websockets` 17.4. No git/node on the PC.
- MSFS 2024: MS Store build `Microsoft.Limitless` 1.9.24.0. There's no MSFS SDK; the SimConnect.dll bundled with the pip package works. Fallback DLL: `C:\Program Files (x86)\MSFSAddonsLinker\Simconnect_2024\SimConnect.dll`.
- Fenix A320 family `Fenix.exe` 3.0.0.7613, in `C:\Program Files\FenixSim A320`. The owner's usual aircraft is the Fenix A321 CFM, reg HB-IOO (SWISS livery).
- OBS Studio 33.0.1. Also running on the PC: Volanta, vPilot, TechLog 1.3.4 (localhost:7720), SayIntentions (installed).

### 2. OFP Tower: `%USERPROFILE%\ofp-link-recorder`
| File | Job |
|---|---|
| `recorder.py` | SimConnect recorder, format v2. Writes 1 Hz JSONL to `recordings\<UTC yyyymmdd-hhmmss>.jsonl`, with a header line `{"v":2,"kind":"ofp-recording","title","atcId","profile","overrides","unconfirmed",...}`. Flags: `--serve` (start the live link), `--port N` (default 47800), `--seconds N` (stop after N samples, for tests), `--dll PATH`. Polls vs/onGround at 10 Hz below 200 ft gear height (`PLANE ALT ABOVE GROUND MINUS CG`) for touchdowns. It stops by itself when MSFS quits (SimConnect quit flag) or after 15 s with no fresh answers, and writes no stale lines. All SimVars are requested with explicit units. Values are read in fresh batches: this fixed the library's one-sample lag. |
| `link_server.py` | Live link, `0.0.3-stopgap`. WebSocket on 127.0.0.1 AND ::1 only (never 0.0.0.0). Origin allowlist: `https://plans.massorbit.co.uk`, `http://localhost:3000`, `http://localhost:8765`; anything else gets 403. Frames capped at 64 KB. |
| `fenix_fms.py` | Read-only Fenix FMS reader. Builds the `plan` message (route, constraints, symbols, turns, runways). Can be run alone (`python fenix_fms.py`), which prints the plan. |
| `profiles.json` | Per-aircraft SimVar overrides, matched on TITLE. The "Fenix" profile maps parkBrake, seatbelts, noSmoking and emerExitLt to Fenix L:vars, all confirmed. |
| `last-settings.json` | The last Stream-panel settings relay, kept as its exact text. Created by the owner's first grid change; not present at the moment. |
| `OFP Tower.bat` | Launcher: opens the board (`feed=link&view=full`), then runs `recorder.py --serve`. Desktop shortcut "OFP Tower". |
| `tools\` | `obsws.py` (stdlib obs-websocket v5 client: `python obsws.py requests.json`), `relay_test.py`, `settings_test.py`, `link_selftest.py`, `lvar_watch.py` (logs L:var changes while switches are flipped), `plan_constraints_test.py`, `fenix_sub_probe.py`. |
- Start: double-click "OFP Tower" with MSFS loaded into a flight. Stop: Ctrl+C in that window, or close the sim (it stops itself). The console log shows `Connected to sim`, `Recording to …`, `Aircraft: … | profile: …`, `OFP Tower: listening on ws://…:47800`, and `OFP Tower: Fenix MCDU plan EGLC->EGLL …`.
- Only one instance at a time: port 47800 can't be shared.

### 3. What it sends (shapes in docs/OFP-LINK.md); extras beyond that spec
- `hello` (app id is still `"ofp-link"`, version, title, atcId, profile, recording), then `plan` (if known), then the stored `settings` relay (if any), then a `sample` every second.
- `sample` = the recorder line + `type`. Fields: zulu, lat, lon, alt, agl, gs, hdg, vs, onGround, engines[], beacon, doors[] (EXIT OPEN 0–3, %), parkBrake, seatbelts, noSmoking ("off"/"auto"/"on"), emerExitLt ("off"/"arm"/"on"), landingRate, tdSim (both negative fpm, only on the line after touchdown), raw{field:{std,lvar}} for profile fields.
  - landingRate = VERTICAL SPEED at the last 10 Hz airborne poll; this is the one for the stream.
  - tdSim = the latched PLANE TOUCHDOWN NORMAL VELOCITY.
  - Last flight: −64 / −98 fpm.
- `plan` (Fenix only; re-read every 10 s; sent only when changed; an empty FMS is never sent):
  - origin, destination, originRunway, destinationRunway, alternate, flightNumber, cruiseLevel, phase.
  - legs[]: id, lat, lon, via, kind, flags (overfly / turnLeft / turnRight), altConstraint {alt, type, text}, fmsLeg {type course/track/heading, deg, magnetic, text}, procedure, fmsDistNm, distNm, courseIn (true), turn {deg, dir, style flyby/flyover, radiusNm, leadNm, atKt 220, bankDeg 25, estimated}, pseudo, missed.
  - runways[]: stylised 5 km lines from the threshold. Heading = initial course (departure) or final course (arrival); falls back to runway number ×10 if they differ by more than 30°.
- Relay: a client sends `{"type":"relay",…}`; the exact text goes to all OTHER clients. Max 16 KB; anything else from clients is ignored. The last `msg.kind=="settings"` relay is saved to `last-settings.json` and sent to every new client after connect.

### 4. Fenix specifics
- Gateway: `ws://127.0.0.1:8083/graphql`, subprotocol `graphql-transport-ws`, `connection_init`, then `subscription { dataRefs(names:[…]) { name value } }`. One `next` message per name. Read-only, nothing is ever written. HTTP introspection is disabled, and the query type names are obfuscated (`dataRef { list }` items).
- Where the method came from: the shape from the Fenix EFB's own batches in `C:\ProgramData\Fenix\FenixSim A320\logs\log-GqlGateway.log`; the names from TechLog's read-only `TechLogEngine.exe probe`, saved to `%LOCALAPPDATA%\Programs\TechLog\probe\names.txt` (3,980 names). The probe timed out on its own slow value step; names.txt was complete.
- Used: `aircraft.fms.origin|destination|alternate|flightPhase`, `aircraft.fms.flightPlanXml` (legs with lat/lon/distance/back-bearing; no constraints), `fenix.cids.flightNumber`, `fenix.registration`, `aircraft.mcdu1.display` / `mcdu2.display` (screen XML; constraints and leg annotations are parsed from the F-PLN page only, cached while the pilot pages through).
- MCDU screen codes: `g` green, `w` white, `m` magenta (constraints), `s`/`l` small/large font. Characters: `&` = Δ overfly, `£` = ← left turn, `¢` = → right turn, `¤` = ↑, `¥` = ↓.
- Confirmed L:vars (read via SimConnect, toggled both ways by the owner):
  - `L:S_MIP_PARKING_BRAKE` 0/1. The standard BRAKE PARKING POSITION never changes on the Fenix.
  - `L:S_OH_SIGNS` seatbelt 0/1. The standard var follows about 0.8 s later.
  - `L:S_OH_SIGNS_SMOKING` 0 off / 1 auto / 2 on. The standard var never changes.
  - `L:S_OH_INT_LT_EMER` emergency exit lights 0 off / 1 arm / 2 on.
  - The middle = AUTO/ARM labels are assumed from the real A320.
  - Caution: an L:var that doesn't exist reads 0.
- NOT readable / not attempted:
  - The EFB bundle `EFB\efb.bin` is encrypted (entropy 8.0, no strings).
  - The gateway exe is a packed single-file .NET binary.
  - Decrypting or decompiling = breaking Fenix's protection, so we stopped there.
  - Speed constraints are not parsed yet.
  - The FMS has no runway geometry (hence the stylised runways).

### 5. OBS
- obs-websocket: port 4455. Auth is currently OFF: the owner turned it off for us and should turn it back on (Tools → WebSocket Server Settings) when we're not working.
- The owner's setup, NEVER touch: profiles "FS24" (also "Big one"), collection "Big one - ULTRA Optimised (MSFS24)" (and "Big one", "MSFS24").
- Ours:
  - Profile "OFP Planner": a copy of FS24, differing only in Name.
  - Collection "OFP Planner": a copy of the owner's collection, plus our scenes "Flying" and "BRB". Each scene has Display Capture (fit to 1920×1080), the 6 audio sources and one browser source.
- Browser sources (1920×1080, page permission level 2 "Read access to user information"):
  - "OFP Planner" (Flying): `https://plans.massorbit.co.uk/board?view=auto&tab=gate&screen=1&feed=auto`
  - "OFP Planner BRB": `https://plans.massorbit.co.uk/board?view=auto&tab=gate&screen=1&feed=auto&as=BRB`
  - Both on 1.10.1 (refreshnocache done). Grid settings come live via the relay or `last-settings.json`.
- Currently open: profile FS24 + collection OFP Planner. That's how the owner had it; leave it unless asked.
- Studio Mode is ON, with a Fade transition. A shared source renders only for the Program scene, which is why it's one source per scene. Display Capture records the whole monitor, so whatever is on it (including the Claude window) is visible.

### 6. Coordination rules
- The Mac session messages the PC session. The PC session runs in a different permission mode, so the owner approves each held message on the PC.
- Requests that change the PC (installs, network ports, OBS changes) need the owner's own OK in the PC session; a relayed "owner said" isn't enough. Read-only checks are fine.
- LAN file transfer: `py -m http.server 8766 --bind 0.0.0.0 --directory "%USERPROFILE%\ofp-link-recorder\recordings"`, read-only, max 15 min, only with the owner's OK. No firewall rule was needed or added.
- PC changes to OBS go through the websocket, only in the OFP Planner profile/collection, after checking it's not streaming or recording.

### 7. Known issues / not verified / ideas
- Not verified live: grid changes reaching OBS through the relay (needs the sim + OFP Tower + the Stream panel open), and the last-settings restore after an OBS restart. Unit tests pass.
- Turn radii and straight leg lines are estimates; procedure legs fly coded courses (fmsLeg).
- The XML `<bearing>` looks like the back-bearing, probably magnetic.
- Missed-approach pseudo legs (e.g. "3000") are FMS-computed points.
- The plan is Fenix-only; other aircraft send samples only (the owner's fallback rule). Speed constraints and the FMS leg annotations of fixes never shown on the MCDU screen are unknown.
- Claude's own browser pane can't reach ws://localhost (it blocks it), so live board checks happen in the owner's browser or in OBS.
- Ideas: the SimConnect facility API for real runway geometry; Fenix door/APU/GSX values (`doors.entry.d1l`, `aircraft.apu.running`, `gsx.state.boarding` …) are available.

Recovery if Remote Control or the session drops:
1. MSFS + Fenix loaded.
2. Double-click "OFP Tower". Check its window shows "listening on …47800" and the "Fenix MCDU plan" line.
3. Open OBS (OFP Planner collection).
4. Open Board → Gate screen → Stream in the browser; it should show "OFP Tower · live".
5. Self-tests (no sim needed): `py tools\relay_test.py`, `py tools\settings_test.py` (temp files, real settings untouched), `py tools\link_selftest.py`.
6. With the sim: `py fenix_fms.py` prints the live plan; `py tools\lvar_watch.py 120` logs switch L:vars for 2 min.
