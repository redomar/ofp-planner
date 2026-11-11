# OFP Link: spec

OFP Link is a small Windows program for the sim PC. It reads MSFS 2024 through SimConnect and hands the readings to the gate screen in the browser (an OBS browser source, the popup or Board → Gate screen) over a WebSocket on the same PC. It also records every flight to a file that OFP Planner can replay.

**Status: spec only.** OFP Link is not built yet, and nothing here has been tested as a program. It cannot be built or tested on the Mac; it gets built and tried on the owner's sim PC, in its own repository, not this one.

What exists today:

- The web side is built and verified (1.9 A–D): the WebSocket client (`linkSource` in `src/lib/feed/sources.ts`), the message shape and the phase detector (`src/lib/feed/core.ts`), the replay of recordings, and `feed=link` / `feed=auto` on the gate screen.
- A **recorder prototype** on the sim PC: `%USERPROFILE%\ofp-link-recorder\recorder.py` (Python 3.12, the `SimConnect` package, with `profiles.json`). It is not in this repo. It proved on 2026-11-10 that SimConnect gives everything below on MSFS 2024 1.9.24.0 with the Fenix A321. Its file format (v2) is the recording format below. The KCLT → KJFK flight in `public/recordings/` came from its first version (v1).

## What it does

1. **Reads the sim** through SimConnect: once a second, ten times a second near touchdown (see Readings).
2. **Serves the readings** to OFP Planner pages on this PC, over a WebSocket on `127.0.0.1`.
3. **Records each flight** to a `.jsonl` file the replay already reads.
4. **Relays the controls** between the controller tab and the screen in OBS (later; see Relay).

It sends facts, not opinions: position, level, speed, ground, brake, engines, lights, doors. Deciding "Pushback" or "Cruising" stays in the web page (`step()` in `core.ts`), so the rules can be tuned without a new `.exe`.

## Connection

- **Address:** `ws://127.0.0.1:47800`, also answering on `localhost`. The page tries `ws://localhost:47800` (`LINK_PORT`); `&port=` on the URL picks another (1024–65535).
- **Bound to the loopback only.** It never listens on the network. (The Fenix data server listens on `0.0.0.0:8083`; OFP Link must not do that.)
- **Origin check:** it accepts a WebSocket upgrade only when the `Origin` header is one of:
  - `https://plans.massorbit.co.uk` (the live site)
  - `http://localhost:3000` and `http://localhost:8765` (development and the local preview of `out/`)

  It refuses everything else with HTTP 403. An OBS browser source sends the page's own origin, so the live site's origin covers OBS.
- **No account, nothing sent anywhere.** It talks only to pages on this PC.
- **Reconnects are the page's job.** The page retries every 2 s, backing off to 15 s, so OFP Link and the sim can start in any order.

To test in the owner's browser and in OBS: whether an `https://` page may open `ws://localhost`. Chromium treats `localhost` as secure and has allowed this, but its newer "local network access" checks may ask the user for permission, and OBS's built-in Chromium is an older version. If either blocks it, a fallback is to serve the screen page from OFP Link itself (`http://localhost:47800/…`).

## Messages

JSON text frames, one object each. Every message has a `type`.

### OFP Link → page

**`hello`**, once on connect:

```json
{ "type": "hello", "app": "ofp-link", "version": "0.1.0", "sim": "MSFS2024", "title": "FenixA321 CFM SL SC", "atcId": "HB-IOO", "profile": "Fenix", "recording": "20261110-184821.jsonl" }
```

The page ignores it today. It is for the Stream panel to show the aircraft and the recording.

**`sample`**, once a second (and more often near touchdown). The field names are the recording's, so one reader serves both. The page (`toSample`) checks every field and treats a missing or wrong-typed one as unknown (null).

| Field | Type | Meaning | SimConnect (default) |
|---|---|---|---|
| `type` | `"sample"` | | |
| `zulu` | number, s | sim UTC time of day | `ZULU TIME` |
| `t` | number, ms | wall clock, only used when `zulu` is missing | |
| `lat`, `lon` | number, deg | position | `PLANE LATITUDE`, `PLANE LONGITUDE` (degrees) |
| `alt` | number, ft | above sea level | `PLANE ALTITUDE` |
| `agl` | number, ft | above ground (reference point, reads about 9–12 ft parked) | `PLANE ALT ABOVE GROUND` |
| `gs` | number, kt | ground speed | `GROUND VELOCITY` |
| `hdg` | number, deg | heading, true | `PLANE HEADING DEGREES TRUE` (degrees) |
| `vs` | number, ft/min | vertical speed | `VERTICAL SPEED` (feet per minute) |
| `onGround` | bool | | `SIM ON GROUND` |
| `parkBrake` | bool | | `BRAKE PARKING POSITION`, or the aircraft profile |
| `engines` | bool[] | one per engine, running | `GENERAL ENG COMBUSTION:n`, n = 1…`NUMBER OF ENGINES` |
| `beacon` | bool | | `LIGHT BEACON` |
| `doors` | number[] | 0 shut … 100 open | `EXIT OPEN:0…3` (percent) |
| `seatbelts` | bool | | `CABIN SEATBELTS ALERT SWITCH`, or profile |
| `noSmoking` | `"off"` \| `"auto"` \| `"on"` | | `CABIN NO SMOKING ALERT SWITCH` (on/off), or profile |
| `emerExitLt` | `"off"` \| `"arm"` \| `"on"` | not read by the page yet | profile only |
| `landingRate` | number, ft/min, negative | only on the reading where the wheels touch | see Landing rate |
| `tdSim` | number, ft/min, negative | the sim's latched touchdown velocity, same reading | `PLANE TOUCHDOWN NORMAL VELOCITY` (converted) |

Request every value with an explicit unit, as the recorder does, so nothing needs converting afterwards. Values must be fresh when sent: the first recorder returned each value one reading late, because the Python library hands back the previous request's answer. A read that fails keeps the last value; it does not send 0.

The page reads `sample` messages only. Others are ignored, so new types can be added without breaking older pages.

### Page → OFP Link

None needed for the readings. Reserved for the relay (below) and for the Stream panel to ask for `hello` again (`{"type":"hello?"}`).

## Readings

- **Once a second**, steady (the recorder holds 1,000 ms ± 25).
- **Ten times a second** for `vs` and `onGround` while airborne below 200 ft above ground (`PLANE ALT ABOVE GROUND MINUS CG`). `landingRate` is `vs` at the last airborne poll, at most 0.1 s before contact. Only the once-a-second readings go to the page, plus the touchdown reading itself.
- **Sim time, not wall time.** At 4× sim rate a minute of flight takes 15 s. The page and the replay use `zulu`, so the times stamped (OUT, OFF, ON, IN) are the sim's.

### Landing rate

Three numbers came out of the same landing (KCLT → KJFK, 2026-11-10): Volanta −251 fpm, TechLog −262 fpm, and the sim's latched `PLANE TOUCHDOWN NORMAL VELOCITY` 489 fpm. The flare floated for about 4 s, then dropped in the last 1–2 s, so small differences in when and where each tool measures give very different numbers.

Owner's decision: keep both.

- `landingRate` is the whole-aircraft vertical speed at contact, comparable to Volanta and TechLog. It's the one shown on the stream and written to the Logbook.
- `tdSim` is the sim's figure, kept for the record.

The fast-polling path is built in the recorder prototype but **not yet tried on a real landing**: compare it with Volanta and TechLog on the next flight. A bounce gives one touchdown reading per contact; the page keeps the first.

## Aircraft profiles

Some aircraft keep systems in their own variables, so the default SimVars can be wrong. A profile maps a field to an L:var for aircraft whose `TITLE` contains a given string. The first match wins; with no match, the defaults apply. Shape, as the recorder's `profiles.json`:

```json
[
  {
    "match": "Fenix",
    "vars": {
      "parkBrake": "L:S_MIP_PARKING_BRAKE",
      "seatbelts": "L:S_OH_SIGNS",
      "noSmoking": "L:S_OH_SIGNS_SMOKING",
      "emerExitLt": "L:S_OH_INT_LT_EMER"
    },
    "unconfirmed": []
  }
]
```

Fenix A320 family. Each was confirmed on 2026-11-10 by the owner flipping the switch both ways while the value was watched:

| Field | L:var | Values | Default SimVar on the Fenix |
|---|---|---|---|
| `parkBrake` | `L:S_MIP_PARKING_BRAKE` | 0 released, 1 set | `BRAKE PARKING POSITION` never changes: **wrong** |
| `seatbelts` | `L:S_OH_SIGNS` | 0 off, 1 on | `CABIN SEATBELTS ALERT SWITCH` follows about 0.8 s later: fine |
| `noSmoking` | `L:S_OH_SIGNS_SMOKING` | 0 off, 1 middle (AUTO, from the real A320's labels), 2 on | never changes: **wrong** |
| `emerExitLt` | `L:S_OH_INT_LT_EMER` | 0 off, 1 middle (ARM, assumed), 2 on | none |

Rules:

- An L:var that doesn't exist reads 0, so a 0 proves nothing. An entry counts only after the switch has been flipped and seen to change. Until then it goes in `unconfirmed`, and its value is recorded in `raw` only.
- Recordings keep both values for overridden fields (`raw: {"parkBrake": {"std": false, "lvar": 1}}`), so a wrong mapping can be fixed afterwards.
- Read L:vars through SimConnect, as the recorder does. The Fenix's own GraphQL server (port 8083) has introspection off and scrambled names, accepts writes, and is undocumented: don't use it.

Correct on the Fenix with the defaults: position, altitudes, speeds, heading, vertical speed, on ground, the latched touchdown rate, engines, beacon, doors (`EXIT OPEN:0` and `:3` went 0 → 100 at the gate).

## Recording

Every flight is written to `%USERPROFILE%\Documents\OFP Link\recordings\<UTC yyyymmdd-hhmmss>.jsonl`. It starts when SimConnect connects, or when the aircraft changes, and ends when the sim closes or the aircraft has been at the gate with the engines off for 10 minutes.

- **Line 1, the header:**

  ```json
  {"v": 2, "kind": "ofp-recording", "sim": "MSFS2024", "started": 1794339722514, "title": "FenixA321 CFM SL SC", "atcId": "HB-IOO", "profile": "Fenix", "overrides": ["parkBrake", "seatbelts", "noSmoking", "emerExitLt"], "unconfirmed": []}
  ```

- **Then one reading per line:** the `sample` fields without `type`, plus `raw` for profile fields.
- `parseRecording()` in `core.ts` reads v1 and v2. v1 files are corrected on reading: their values are shifted back one line, the parking brake is read as unknown, and `td` becomes `tdSim`.
- A recording replays on the gate screen (`&feed=replay&rec=/recordings/….jsonl&rate=60&at=20`), feeds the rehearse strip, and is how the Mac tests everything without a sim. To use one there, copy it into `public/recordings/`. Registrations in recordings are fine to publish (owner, 2026-11-10).

## Relay: the Stream panel's settings to OBS (1.10)

The page side is built (1.10, `src/lib/feed/relay.ts`). The Stream panel on Board → Gate screen and every open gate screen (the OBS browser source too) keep a WebSocket to OFP Link. OFP Link must pass relay messages on:

- **A page sends** `{"type":"relay","channel":"stream","msg":{…}}`.
- **OFP Link forwards it, unchanged, to every OTHER connected page** (not back to the sender). It doesn't read `msg`. Same origin checks as for samples.
- **Messages in `msg`:**
  - `{"kind":"settings","q":"st=strip%2Cpill%2Cpill%2Cfull&sc=BRB%3Aframe&late=10&…"}` comes from the panel whenever a setting changes. `q` is the screen's own URL query (stage table `st`, scene rules `sc`, `hold`, delay, gate, message, …). A screen applies only those display settings, checked as if they came from its URL, and keeps its flight and feed.
  - `{"kind":"hello"}` comes from a screen when it connects. The panel answers with the current settings.

Without OFP Link, nothing is sent. The panel then says "copy the stream URL again" after a change.

## The program

As sheet 07, FL4, sketched it:

- **Tray icon and one small window:** Simulator (MSFS 2024, connected or not), Aircraft (title, on the ground or not), Screens (how many pages are connected, and which are in OBS), Recording (file and length), Start with the sim (on/off). Buttons: Open Stream panel (opens Board → Gate screen in the browser) and Quit.
- **One file, no installer.** Windows warns about an unknown publisher unless the file is code-signed: decide when it's built.
- **Language:** open. C# with the managed SimConnect wrapper from the MSFS 2024 SDK is the usual choice. The prototype shows Python works too, but it needs a runtime.
- **Repository:** its own, not this one. Signed commits, no AI credit anywhere, as here.

## Testing on the sim PC

Nothing below is done:

1. With the page open on `&feed=link`, the screen follows the aircraft at the gate. Check the Stream panel shows "OFP Link · live".
2. A full flight, gate to gate, while recording. Then check:
   - every phase in order;
   - OUT at pushback, OFF at wheels-up, ON at touchdown, IN at the gate;
   - `landingRate` against Volanta and TechLog;
   - the Logbook one-click writing all four times.
3. OBS:
   - the stream URL as a Browser source;
   - Page permissions so the page can read the scene name;
   - the scene rules (BRB → frame and so on);
   - the transparent views over the game capture;
   - whether OBS lets the page connect to `ws://localhost`.
4. Pushback vs taxi: the page guesses from the direction of movement (1.9 A). If it's wrong with GSX or the Fenix tug, add `PUSHBACK STATE` (or the tug's L:var) to the readings and use it.
5. Bring the recording to the Mac (as on 2026-11-10: the PC serves the recordings folder read-only for a few minutes) and add it to `scripts/verify.mjs` as a departure check, replacing the synthetic one.

## Parked

- **SayIntentions:** the owner will provide its API. It slots in between OFP Link and VATSIM in `feed=auto`, mapped to the same message shape.
- **Other aircraft profiles:** add them as they're flown, each switch confirmed by flipping it.
