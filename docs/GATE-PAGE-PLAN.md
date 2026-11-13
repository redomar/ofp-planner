# Plan: a simpler Board → Gate screen page ("One desk")

Agreed on 2026-11-13 between the design session (which wrote it after reading main at 1.14.0 and
the live page), the Mac build session (reviewed it against the code) and the PC session (checked
§6 and §8 against OFP Tower and OBS). The owner's open questions are in §9. Read `docs/HANDOVER.md` and
`docs/HANDOVER-LIVE.md` first: their rules (workflow, no AI attribution, personal data, OBS, Fenix)
apply to everything here.

## 1. Who is who

| Session | Job | Reach it |
|---|---|---|
| "Version 1.8 design and UX review" (Mac) | Design and review. Wrote this plan; its part ends at the handover. | From the Mac build session by name. |
| "Boarding pass implementation handover" (Mac) | Builds the site in this repo, releases, and sends the PC what it needs. | From the design session; the owner's desktop app. |
| "PC and OFP Planner access" (sim PC, Remote Control) | OFP Tower, OBS, the sim. Read-only checks freely; any change to the PC or OBS needs the owner's own OK there. | Only from the Mac build session. The owner approves each message on the PC. |

## 2. What the owner decided (2026-11-13)

- Page shape **A1 "One desk"**, with the recommended parts: **F1** (which flight, one line), **P1**
  (the one preview), **S1** (Send to OBS, one list), **C1** (controls folded by when), **N1** (one
  set of stage names, one hold).
- **Hide the flip sides "Aircraft status" and "Flight deck" until there is data.** Reason, for both
  sessions: the placeholders say "after a probe flight on the PC", and the owner read that as
  overdue work. They come back when the probe gives real fields.
- Every feature stays. This is a rearrangement of one page, not a new protocol.

Sheets (outside the repo): `../ofp-planner-previews/v1.15-gate-page/01-gate-page-shape.png` and
`02-gate-page-parts.png`; sources in `src/`. Look at a sheet before building its part.

## 3. Why (the overlaps, all confirmed in code or in OBS)

1. Two previews that disagree: the top one is `gate.view` (always "full" on the control tab), "What
   OBS shows" is the real one.
2. Two "Copy stream URL" buttons with different links (`screenUrl` vs `streamUrl` in BoardApp).
3. Two VATSIM boxes: "Watch" replaces the flight, Live feed's only sets the position.
4. Two holds (`pin`, ten clock steps; `hold`, six stages) and two name tables (`STAGE_NAMES`,
   `STAGE_INFO`).
5. Which flight is on screen is never said. The rule in BoardApp: SimBrief OFP, then `f=`, then
   `live.plan` (the FMS via OFP Tower, or a watched VATSIM pilot's filed plan; both go through
   `fromPlan` as source "fms"), then `namedFlight` applies the names. A Logbook entry lost its registration because the tab had no OFP.
6. Clock and Status matter only before push-back but stay open all flight.
7. `go=` and `bye=` travel in the link only; everything else is relayed.
8. A change on the page replaces what OBS shows and nothing says so: relayed `st`/`sc` override the
   ones in an OBS link. The "OFP Planner" source asks for `as=Livestream`; the page has no such
   scene, so with OFP Tower running it shows the default stage table, without it the frame.

Also found: "All scenes at a glance" wraps its sixth column (Arrived) at 1440 px since 1.14.

## 4. Must not change

- **Link parameters** keep their names and meanings: `f d sb tab screen ch view st sc as hold late
  cx pin ov gate was reg an ac msg rot go bye feed rec rate at who port`. Old values keep reading (4- and
  5-part `st`, `hold=flying`). New parameters may be added; none renamed or removed.
- **OFP Tower**: port, message types, the relay envelope
  `{"type":"relay","channel":"stream","msg":{…}}`, and the fields inside a `settings` relay's `q`.
  No OFP Tower change is needed for this plan.
- **Stored things**: `ofp:my-looks`, `ofp-planner:airline-names`, `ofp-planner:ending`,
  `ofp-planner:simbrief-user`.
- **The screens**: every look, size, corner, layer, flip side, rotation, the stage detector.
- **OBS source names** ("OFP Planner", "OFP Planner BRB", "OFP Planner Countdown", "OFP Planner
  Ending"): the PC's refresh step matches on them.
- The standalone modules verify loads in Node stay import-free (`core.ts`, `looks.ts`,
  `countdown.ts`, `ending.ts`, `naming.ts`, `logFields.ts`).

## 5. The page after (A1)

Desktop: two columns. Phone: the same blocks in this order, one column.

**Left: the one preview (P1)**
- Scene tabs: "Any other scene", then each named scene, then "+ Scene". Rename and remove live on
  the selected tab.
- The screen, full width of the column: what that scene shows, exactly as the studio's "What OBS
  shows" computes it today (`shownTurns` with `view:"auto"`, the live feed for "now", `sampleLive`
  for another stage). The page no longer draws a second screen from `gate.view`. Only the in-page
  top preview goes: the screen path (`screen=1`, the popup, OBS) keeps `gate.view` as it is, and
  `OFP Tower.bat` still opens `view=full`.
- One rotation clock for both. Today the screen turns from when the stage began (`turnFrom` and
  `stepAt` in BoardApp) and "What OBS shows" turns on the wall clock, so with a rotation they
  differ. Lift `shownTurns` + `turnFrom` into one hook and use it for the screen and the preview.
- The stage strip: six cells with the stage name, the look's glyph and code (no thumbnails: the six
  MiniScreens are the heaviest part of the panel), "now" on the live stage. A rotation shows its
  first step's glyph and "⟳n", as the glance grid does. A click on a cell previews that stage;
  its "Change" (or a second click) opens the look editor, unchanged.
- One row under it: "Rehearse in 60 s" (the marker runs along the strip while it plays), "Follow
  the aircraft | Hold this stage" (`hold`), "Start from…" (presets), "All scenes" (the glance grid
  as a fold-out, six columns that fit). Quick changes move into the scene's menu. The timed
  rehearse strip with OUT/OFF/ON/IN stays as a fold-out.
- The flip-side picker stays under the screen when the look flips. "Full screen" stays on it.
- "Write to my Logbook" appears beside the preview when Arrived, unchanged.

**Right: three questions in order**
1. **Flight (F1).** One line: flight, route, airline, and where it came from. "Change" opens the
   sources: Auto (today's order) | My aircraft (FMS via OFP Tower) | My SimBrief OFP | Timetable
   flight (with its date) | Another pilot (VATSIM callsign). Picking one pins it. Rows under it:
   Position (OFP Tower, VATSIM with your own callsign, clock: the Live feed tab's content),
   Registration (and which of the three sources it is), Shown as (airline name and code), Logbook
   (what an entry would get now, and what is missing).
2. **What is written on it (C1).** Three folding groups with a one-line summary each:
   - Before departure: clock, delay, step (`pin`), cancelled, gate change. Folds itself once the
     aircraft has left the gate; opens again by hand.
   - On the screen: gate, registration, airline name and code, message, rotate, see-through.
   - Start and end: countdown, sign-off, marked "in the link only".
3. **Where it goes (S1).** "Send to OBS":
   - Open now (needs OFP Tower): each connected screen, what it shows, and what a change here does
     to it ("reaches it live" for `view=auto` screens; "keeps its own look" for fixed ones, which
     still take text changes). A screen whose `as=` names no scene here gets "Add scene".
   - Links: Main and one per scene; fixed-look links (Countdown, Ending, this look only); the
     screen window. One copy button each. The three OBS setup steps under the list.
   - A chip always in view: "Changes go live to N screens" or "OBS: copy after changes".
   - The look editor's Save says where it lands when screens are connected.

**Names (N1):** `STAGE_INFO` is the only table (At the gate, Taxi, Climb, Cruise, Approaching,
Arrived). `STAGE_NAMES` goes. Tokens stay `ready, taxi, climb, cruise, approaching, arrived`.

## 6. New, small, additive

- **Screens say who they are.** The page asks `{kind:"who"}` on connect and every 30 s; a screen
  answers `{kind:"here", as, view, id, v}` (`id` random per page load, `v` the app version). Do NOT
  reuse `hello` for the answer: a board tab answers every hello with a full settings resend once it
  has changed something, so each ask would push settings to every screen. `hello` stays as it is. A
  screen is dropped after two missed asks. A bare hello with no `here` is an older page: "refresh
  this source". OFP Tower relays any `msg` and keeps only `kind:"settings"`, so nothing changes
  there: confirmed by the PC session (any relay up to 16 KB goes as exact text to every client but
  the sender; kind and channel aren't checked).
  Rules from the PC session: (1) `here` isn't stored, so a board asks `who` on every connect and
  reconnect, not only every 30 s; (2) every relay reaches every client, so screens ignore `here`,
  boards ignore `who`, and only screens answer; (3) relays share one outgoing queue (50 items,
  oldest dropped) with the 1 Hz samples, so never count on one reply: the re-ask covers it;
  (4) don't use the version in OFP Tower's hello ("0.0.3-stopgap") to detect features.
- **A pinned flight source:** `fs=fms|ofp|tt|vatsim`, absent = Auto = today's rule, so every
  existing OBS link behaves as now. It goes into `streamSettingsQuery` / `StreamSettings` so the
  OBS pages follow the board: their links carry `sb=`, and a board pinned to "My aircraft" would
  otherwise show a different flight from OBS. Older pages ignore it.
- **Airline names follow the airline.** Confirmed cause: the override is never tied to an airline.
  `airlineCode` is null for an FMS flight, the saved-name effect only fills empty `an`/`ac` and
  never clears them, and they are relayed and stay. Stateless fix: relay the code they were set for
  (`anf=`), and apply `an`/`ac` only when the flight's airline code matches; for an FMS flight take
  the code from the flight-number prefix (as `fromPlan` already does). `an`/`ac` with no `anf`
  apply as now.
- **The sign-off can reach OBS live:** add `bye` to the relayed settings (older pages ignore an
  unknown key). Both sessions recommend it; it is the owner's call (§9). The countdown (`go`) stays
  in the link, so it works without OFP Tower.

## 7. Order of work

Either one release (1.15.0) or two (1.14.1 then 1.15.0): the owner chooses (§9). Each release that
changes the screen needs the OBS sources refreshed once, together; that is true either way, since
all five sources were refreshed for 1.14 on 2026-11-13.

**1.14.1, small and first (or the first commits of 1.15.0)**
1. Hide the flip sides that aren't ready: filter `ready:false` out of the look editor's list, and
   make sure `sampleLive` / `MiniScreen` previews never pick them. Keep them in `BACKS` and in the
   token reader (their codes stay valid) so no link breaks.
2. Glance grid: six columns that fit at 1440 and 390 (the wrap is seen on the live site by the
   design session, not yet reproduced by the builder).
3. Optional here: the screen side of who/here (screens answer; nothing lists them yet).

The case for 1.14.1: it gets the two things the owner asked for today out quickly. It no longer
saves an OBS refresh.

**1.15.0, the page**
4. N1: one name table.
5. S1: Send to OBS, the open-now list, the chip, the Save note (it doesn't depend on P1 or F1, so
   it can go early). The Stream panel's shell and its OBS setup tab go when P1 lands.
6. P1: the preview block (scene tabs, screen, stage strip, hold, rehearse, fold-outs, the shared
   rotation clock). The studio's three columns and the top preview go; the look editor stays.
7. F1: the flight line, `fs=`, the position chips, the registration, names (`anf=`) and Logbook
   rows. Live feed tab goes.
8. C1: the three groups; `bye` relayed if the owner says yes.
9. Docs: HANDOVER §3, HANDOVER-LIVE code map and URLs, OFP-LINK (who/here), CHANGELOG, README
   screenshot.

**Verify:** the sections "gate views", "stream panel", "board", "log arrival" and "phone order" use
selectors that move; update them with each step and add checks for: the preview equals the screen
for the same scene and stage; one copy button per link; the pinned source; Before departure folding
when the stage leaves `ready`; the open-now list with a stand-in OFP Tower (`routeWebSocket`), old
bare hello included; AA contrast, no layout shift, 1440 and 390, reduced motion. Full verify before
the release, targeted sections per step.

## 8. For the PC session (each change needs the owner's OK there)

- Nothing to build in OFP Tower for this plan (confirmed, §6).
- There are five board sources in the "OFP Planner" collection: OFP Planner, OFP Planner BRB, OFP
  Planner Countdown, OFP Planner Ending, and the old Flight tracker. All five were refreshed for
  1.14 on 2026-11-13 with the owner's OK.
- After each release: refresh the sources together. After 1.15.0, check in OBS that the open-now
  list shows them, that a change reaches the two `view=auto` sources, and that Countdown and Ending
  keep their looks.
- **Livestream:** keep `as=Livestream` on the "OFP Planner" source and add a "Livestream" scene on
  the page (no OBS edit). The owner had built a "livestream" rotation on purpose (the pills, then
  the strip); an earlier save in the panel overwrote it, so it has to be made again. Tell the owner.
- **Flight tracker** (864 × 486, no live feed; on in "In Progress" and "Start Screen", off in
  "Ending Screen" and "Main Screen"): ask the owner whether they still use it in In Progress. If
  not, disable it in those two scenes first, and delete it after a stream or two.
- `OFP Tower.bat` opens `…&feed=link&view=full`: still fine; `view` no longer drives the page's
  preview.

## 9. Open questions for the owner

**Answered 2026-11-13 (to the build session):** (1) one release, 1.15.0; (2) yes, the sign-off is
relayed; (3) add the "Livestream" scene on the page (Send to OBS offers "Add scene", which makes it
with the "Pills, map now and then" preset, the owner's pills-then-strip idea); (4) the owner doesn't
remember "Flight tracker": hide it (the PC session switches it off, with the owner's OK there) and
delete it later (done: switched off in all four scenes, renamed "Flight tracker - niu", not deleted yet); (5) yes,
the routine is right: OFP Tower, OBS, Start Screen with the countdown, Flying, BRB as needed, Ending Screen,
then the Logbook.

As built (corrections to the plan): `hello` also stays a screen's first message; a 1.15 screen sends
its `here` right after it, unasked. The VATSIM callsign (`who`) is relayed with `sv=2` too, so a
pinned "Another pilot" reaches OBS. The "SayIntentions · not set up yet" placeholder went with the
Live feed tab.

1. 1.14.1 first (flip sides hidden, glance grid), then 1.15.0, or one 1.15.0? Either works and
   neither saves an OBS refresh; 1.14.1 only gets the two small fixes out sooner.
2. Should the sign-off (`bye`) also be relayed, so it can be changed for OBS from the page? Both
   sessions recommend yes. The countdown stays in the link (it must work without OFP Tower).
3. Livestream: all three sessions recommend adding a "Livestream" scene on the page and making
   your pills-then-strip rotation again (an earlier save overwrote it). OK?
4. Do you still use the old "Flight tracker" source in the In Progress scene? If not, the PC
   session disables it there and in Start Screen, and deletes it after a stream or two.
5. Is the routine right: OFP Tower, OBS, Start Screen with the countdown, Flying, BRB as needed,
   Ending Screen, then the Logbook?

## 10. Not verified

- The OBS facts in §3.8 and §8 are the PC session's reading of the sources, `link_server.py` and
  `last-settings.json`; none was watched live.
- The stale airline name: the cause is confirmed in the code by the builder, not reproduced live.
- The glance-grid wrap at 1440 px: seen on the live site by the design session only.
- Whether the preview at the column's full width costs a layout shift on first load: measure it.
