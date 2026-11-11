# OFP Tower

The sim-PC companion to OFP Planner. It records your flight from MSFS 2024 (SimConnect) and serves it live on `ws://localhost:47800` to the board and the OBS browser sources. It also sends the Fenix FMS route and relays the Stream panel's settings. The page side of the protocol is in [docs/OFP-LINK.md](../docs/OFP-LINK.md); how it runs on the sim PC is in [docs/HANDOVER-LIVE.md](../docs/HANDOVER-LIVE.md).

This folder is not part of the website build.

## Setup on a new PC

- Windows, MSFS 2024, Python 3.12 (64-bit).
- `py -3.12 -m pip install -r requirements.txt`
- `OFP Tower.bat` expects Python at `%LOCALAPPDATA%\Programs\Python\Python312`; edit that line if yours is elsewhere.
- SimConnect.dll: the recorder falls back to the MSFS Addons Linker copy (`FALLBACK_DLL` in `recorder.py`), or pass `--dll PATH`.

## Run

Start the sim and load into a flight, then run `OFP Tower.bat`. It opens the board and runs `recorder.py --serve`. Recordings go to `recordings/` (one `.jsonl` per session), which git ignores, as it does `last-settings.json`.

## Files

- `recorder.py`: the SimConnect recorder and touchdown capture; `--serve` starts the link server.
- `link_server.py`: the WebSocket server (localhost only, origin-checked), relay and stored settings.
- `fenix_fms.py`: the Fenix MCDU route, constraints, active leg and V-speeds.
- `profiles.json`: per-aircraft L:var overrides (Fenix).
- `tools/`: tests (`*_test.py`, `link_selftest.py`), `analyse_flight.py`, and probes for L:vars and OBS.

Imported from the sim PC on 2026-11-11 (first copy; the PC has no git yet).
