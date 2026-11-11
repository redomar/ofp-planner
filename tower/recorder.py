"""OFP link flight recorder for MSFS 2024 (format v2).

Connects to the running sim via SimConnect and appends one JSON object per
second to recordings/<UTC yyyymmdd-hhmmss>.jsonl. Ctrl+C stops it cleanly.

* Every SimVar is requested with an explicit unit (degrees, feet, knots,
  feet per minute, percent, bool, seconds) - no conversions after the fact.
* All values of a sample are requested together and the recorder waits for
  fresh answers, so a line describes the sim at its own timestamp.
* Aircraft quirks live in profiles.json (matched on the sim TITLE).
* Near the ground (gear height < 200 ft, airborne) vertical speed and
  on-ground are polled at ~10 Hz to catch the moment of touchdown.

Touchdown fields (only on the first line after a touchdown, else null):
  landingRate  whole-aircraft VERTICAL SPEED just before contact, fpm,
               negative = descending. Comparable to Volanta etc. Stream value.
  tdSim        the sim's latched PLANE TOUCHDOWN NORMAL VELOCITY, fpm,
               negative = descending. Kept for analysis.

Usage:  py recorder.py [--seconds N] [--dll PATH]
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

from SimConnect import SimConnect
from SimConnect.RequestList import Request

FALLBACK_DLL = r"C:\Program Files (x86)\MSFSAddonsLinker\Simconnect_2024\SimConnect.dll"
HERE = os.path.dirname(os.path.abspath(__file__))
FAST_BELOW_FT = 200      # gear height that switches on fast touchdown polling
FAST_DT = 0.1            # seconds between fast polls
FRESH_TIMEOUT = 0.25     # max wait for fresh answers per batch
SIM_LOST_AFTER = 15      # consecutive 1 s samples with no fresh answer = sim gone

# Standard SimVars used for every aircraft. (name, unit)
BASE = {
    "zulu": ("ZULU TIME", "seconds"),
    "lat": ("PLANE LATITUDE", "degrees"),
    "lon": ("PLANE LONGITUDE", "degrees"),
    "alt": ("PLANE ALTITUDE", "feet"),
    "pressAlt": ("PRESSURE ALTITUDE", "feet"),     # altimeter on STD 1013 -> flight level
    "indAlt": ("INDICATED ALTITUDE", "feet"),      # what the captain's altimeter shows (any baro)
    "agl": ("PLANE ALT ABOVE GROUND", "feet"),
    "gearAgl": ("PLANE ALT ABOVE GROUND MINUS CG", "feet"),
    "gs": ("GROUND VELOCITY", "knots"),
    "hdg": ("PLANE HEADING DEGREES TRUE", "degrees"),
    "vs": ("VERTICAL SPEED", "feet per minute"),
    "onGround": ("SIM ON GROUND", "bool"),
    "beacon": ("LIGHT BEACON", "bool"),
    "nEng": ("NUMBER OF ENGINES", "number"),
    "hdgMag": ("PLANE HEADING DEGREES MAGNETIC", "degrees"),
    "trk": ("GPS GROUND MAGNETIC TRACK", "degrees"),
    "ias": ("AIRSPEED INDICATED", "knots"),
    "mach": ("AIRSPEED MACH", "mach"),
    "windDir": ("AMBIENT WIND DIRECTION", "degrees"),
    "windKt": ("AMBIENT WIND VELOCITY", "knots"),
    "fobLb": ("FUEL TOTAL QUANTITY WEIGHT", "pounds"),
    "g": ("G FORCE", "gforce"),
}
TD_G_WINDOW = 2.0        # seconds after each touchdown to look for the peak G

LB_TO_KG = 0.45359237
# Fields a profile may override, with their standard source (None = no standard var)
OVERRIDABLE = {
    "parkBrake": (("BRAKE PARKING POSITION", "bool"), "bool"),
    "seatbelts": (("CABIN SEATBELTS ALERT SWITCH", "bool"), "bool"),
    "noSmoking": (("CABIN NO SMOKING ALERT SWITCH", "bool"), "onoff"),
    "emerExitLt": (None, None),
}


def connect(dll_path=None):
    attempts = [dll_path] if dll_path else [None, FALLBACK_DLL]
    last_err = None
    for path in attempts:
        try:
            sm = SimConnect() if path is None else SimConnect(library_path=path)
            print(f"Connected to sim (DLL: {path or 'bundled'})", file=sys.stderr)
            return sm
        except Exception as e:  # bundled DLL may not work against MSFS 2024
            last_err = e
            print(f"Connect failed with DLL {path or 'bundled'}: {e}", file=sys.stderr)
    raise SystemExit(f"Could not connect to MSFS: {last_err}")


class Vars:
    """Batch reader that always returns fresh values (or the last good one)."""

    def __init__(self, sm):
        self.sm = sm
        self._req = {}
        self._last = {}
        self.fresh = 0

    def _get_req(self, key):
        r = self._req.get(key)
        if r is None:
            name, unit = key
            r = Request((name.encode(), unit.encode()), self.sm, _time=0, _attemps=1)
            self._req[key] = r
        return r

    def fetch(self, keys):
        keys = list(dict.fromkeys(keys))
        pending = []
        for k in keys:
            r = self._get_req(k)
            try:
                if r._deff_test():
                    r.outData = None
                    self.sm.request_data(r)
                    pending.append(k)
            except Exception:
                pass
        deadline = time.monotonic() + FRESH_TIMEOUT
        while time.monotonic() < deadline and any(self._req[k].outData is None for k in pending):
            time.sleep(0.002)
        self.fresh = sum(1 for k in pending if self._req[k].outData is not None)
        out = {}
        for k in keys:
            v = self._req[k].outData
            if v is None:          # missed read: keep the last good value
                v = self._last.get(k)
            else:
                self._last[k] = v
            out[k] = v
        return out


def num(v, nd=None):
    if v is None:
        return None
    v = float(v)
    return round(v, nd) if nd is not None else v


def flag(v):
    return None if v is None else bool(round(float(v)))


def text(v):
    if v is None:
        return None
    if isinstance(v, bytes):
        v = v.split(b"\x00", 1)[0].decode("utf-8", "replace")
    return str(v).strip() or None


def load_profile(title):
    path = os.path.join(HERE, "profiles.json")
    try:
        with open(path, encoding="utf-8") as f:
            profiles = json.load(f).get("profiles", [])
    except FileNotFoundError:
        return None
    t = (title or "").lower()
    for p in profiles:
        if p.get("match", "").lower() in t and p.get("match"):
            return p
    return None


def convert(spec, raw):
    if raw is None:
        return None
    if spec.get("type") == "enum":
        return spec.get("values", {}).get(str(int(round(float(raw)))), None)
    return flag(raw)


def std_convert(kind, raw):
    if raw is None or kind is None:
        return None
    b = flag(raw)
    return ("on" if b else "off") if kind == "onoff" else b


def start_fenix_plan_thread(link, every=10.0):
    """Read the Fenix MCDU flight plan (read-only) and push it to the link when it changes."""
    import threading
    from fenix_fms import read_plan

    def loop():
        warned = False
        while True:
            try:
                plan = read_plan()
                if not plan.get("origin") and not plan.get("destination") and len(plan.get("legs", [])) < 2:
                    time.sleep(every)
                    continue        # aircraft unloaded / FMS empty: keep the last good plan
                if link.set_plan(plan):
                    print(f"OFP Tower: Fenix MCDU plan {plan['origin']}->{plan['destination']} "
                          f"{plan['flightNumber']}, {len(plan['legs'])} waypoints", file=sys.stderr)
                warned = False
            except Exception as e:
                if not warned:
                    print(f"OFP Tower: Fenix plan not readable yet ({type(e).__name__}: {e})", file=sys.stderr)
                    warned = True
            time.sleep(every)

    threading.Thread(target=loop, daemon=True).start()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=0, help="stop after N samples (0 = until Ctrl+C)")
    ap.add_argument("--dll", help="path to SimConnect.dll to use")
    ap.add_argument("--serve", action="store_true", help="also stream readings to OFP Planner (OFP Tower live link)")
    ap.add_argument("--port", type=int, default=47800, help="OFP Link port (default 47800)")
    args = ap.parse_args()

    sm = connect(args.dll)
    sv = Vars(sm)

    head = sv.fetch([("TITLE", "string"), ("ATC ID", "string")])
    title, atc_id = text(head[("TITLE", "string")]), text(head[("ATC ID", "string")])
    profile = load_profile(title)
    pvars = (profile or {}).get("vars", {})
    overrides = [f for f, s in pvars.items() if s.get("confirmed")]
    unconfirmed = [f for f, s in pvars.items() if not s.get("confirmed")]

    nEng = sv.fetch([BASE["nEng"]])[BASE["nEng"]]
    n_eng = int(nEng) if nEng is not None else 0
    eng_keys = [(f"GENERAL ENG COMBUSTION:{i}", "bool") for i in range(1, n_eng + 1)]
    ff_keys = [(f"ENG FUEL FLOW PPH:{i}", "pounds per hour") for i in range(1, n_eng + 1)]
    door_keys = [(f"EXIT OPEN:{i}", "percent") for i in range(4)]
    std_keys = [src for src, _ in OVERRIDABLE.values() if src]
    lvar_keys = [(s["var"], s.get("unit", "number")) for s in pvars.values()]
    full_keys = list(BASE.values()) + eng_keys + ff_keys + door_keys + std_keys + lvar_keys
    fast_keys = [BASE["onGround"], BASE["vs"], BASE["gearAgl"], BASE["g"]]
    td_key = ("PLANE TOUCHDOWN NORMAL VELOCITY", "feet per minute")

    out_dir = os.path.join(HERE, "recordings")
    os.makedirs(out_dir, exist_ok=True)
    started = int(time.time() * 1000)
    path = os.path.join(out_dir, datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + ".jsonl")
    print(f"Recording to {path} (Ctrl+C to stop)", file=sys.stderr)
    print(f"Aircraft: {title} | profile: {profile['name'] if profile else 'none'}", file=sys.stderr)

    link = None
    if args.serve:
        from link_server import LinkServer
        link = LinkServer(args.port, {"title": title, "atcId": atc_id,
                                      "profile": profile["name"] if profile else None,
                                      "recording": os.path.basename(path)})
        link.start()
        if profile and profile.get("name") == "Fenix":
            start_fenix_plan_thread(link)

    # pendingTd: touchdowns not yet written (a short bounce can put two between 1 Hz lines).
    # tdCount numbers the contacts of one landing: 1 = the landing, 2+ = bounces.
    state = {"onGround": None, "lastAirVs": None, "pendingTd": [], "tdCount": 0,
             "gUntil": 0.0, "gMax": None, "gFor": None}

    def note_ground(on_ground, vs, gear=None, g=None):
        """Track on-ground transitions; remember vs while airborne; peak G after contact."""
        prev = state["onGround"]
        if on_ground is False and vs is not None:
            state["lastAirVs"] = vs
        if on_ground is False and gear is not None and gear >= FAST_BELOW_FT:
            state["tdCount"] = 0                 # clear of the ground: the next contact is a new landing
        if prev is False and on_ground is True:
            state["tdCount"] += 1
            n = state["tdCount"]
            state["pendingTd"].append({"n": n, "bounce": n > 1, "landingRate": num(state["lastAirVs"], 0)})
            if n == 1:                            # peak G of the landing, bounces included
                state["gUntil"], state["gMax"], state["gFor"] = time.monotonic() + TD_G_WINDOW, None, n
        if g is not None and state["gFor"] is not None and time.monotonic() <= state["gUntil"]:
            state["gMax"] = g if state["gMax"] is None else max(state["gMax"], g)
        if on_ground is not None:
            state["onGround"] = on_ground

    lines = 0
    stale = 0
    try:
        with open(path, "a", encoding="utf-8") as f:
            header = {"v": 2, "kind": "ofp-recording", "sim": "MSFS2024", "started": started,
                      "title": title, "atcId": atc_id,
                      "profile": profile["name"] if profile else None,
                      "overrides": overrides, "unconfirmed": unconfirmed}
            f.write(json.dumps(header) + "\n")
            f.flush()
            next_tick = time.monotonic()
            while True:
                t_ms = int(time.time() * 1000)
                d = sv.fetch(full_keys)
                stale = 0 if sv.fresh else stale + 1
                if getattr(sm, "quit", 0) or stale >= SIM_LOST_AFTER:
                    print("Sim closed or not answering: stopping.", file=sys.stderr)
                    break
                if stale:
                    next_tick += 1.0
                    time.sleep(max(0.0, next_tick - time.monotonic()))
                    continue        # no fresh data: don't write a stale line
                on_ground = flag(d[BASE["onGround"]])
                vs = d[BASE["vs"]]
                note_ground(on_ground, vs, d[BASE["gearAgl"]], d[BASE["g"]])

                tds_list = state["pendingTd"]
                state["pendingTd"] = []
                if tds_list:
                    tds = sv.fetch([td_key])[td_key]      # the sim latches the LAST contact only
                    tds_list[-1]["tdSim"] = -abs(num(tds, 0)) if tds is not None else None
                td = tds_list[0] if tds_list else None
                td_g = None
                if state["gFor"] is not None and time.monotonic() > state["gUntil"]:
                    td_g = {"n": state["gFor"], "peakG": num(state["gMax"], 2)}
                    state["gFor"] = None

                rec = {
                    "t": t_ms,
                    "zulu": num(d[BASE["zulu"]], 1),
                    "lat": num(d[BASE["lat"]], 6),
                    "lon": num(d[BASE["lon"]], 6),
                    "alt": num(d[BASE["alt"]], 1),
                    "pressAlt": num(d[BASE["pressAlt"]], 0),
                    "indAlt": num(d[BASE["indAlt"]], 0),
                    "agl": num(d[BASE["agl"]], 1),
                    "gs": num(d[BASE["gs"]], 1),
                    "hdg": num(d[BASE["hdg"]], 1),
                    "vs": num(vs, 0),
                    "onGround": on_ground,
                    "engines": [flag(d[k]) for k in eng_keys],
                    "beacon": flag(d[BASE["beacon"]]),
                    "doors": [num(d[k], 1) for k in door_keys if d[k] is not None],
                    "hdgMag": num(d[BASE["hdgMag"]], 1),
                    "trk": num(d[BASE["trk"]], 1),
                    "ias": num(d[BASE["ias"]], 0),
                    "mach": num(d[BASE["mach"]], 3),
                    "wind": [num(d[BASE["windDir"]], 0), num(d[BASE["windKt"]], 0)],
                    "fobKg": num(d[BASE["fobLb"]] * LB_TO_KG, 0) if d[BASE["fobLb"]] is not None else None,
                    "ffKgH": (num(sum(d[k] for k in ff_keys) * LB_TO_KG, 0)
                              if ff_keys and all(d[k] is not None for k in ff_keys) else None),
                }
                raw = {}
                for field, (src, kind) in OVERRIDABLE.items():
                    std_val = std_convert(kind, d[src]) if src else None
                    spec = pvars.get(field)
                    if spec:
                        lraw = d[(spec["var"], spec.get("unit", "number"))]
                        raw[field] = {"std": std_val, "lvar": num(lraw)}
                        rec[field] = convert(spec, lraw) if spec.get("confirmed") else std_val
                    else:
                        rec[field] = std_val
                # landingRate/tdSim: the first contact written on this line (kept for older readers).
                # touchdowns: every contact on this line; n=1 is THE landing, n>1 are bounces.
                rec["landingRate"] = td["landingRate"] if td else None
                rec["tdSim"] = td.get("tdSim") if td else None
                if tds_list:
                    rec["touchdowns"] = tds_list
                if td_g:
                    rec["tdPeakG"] = td_g                 # written ~2 s after the first contact
                rec["g"] = num(d[BASE["g"]], 2)
                if raw:
                    rec["raw"] = raw

                f.write(json.dumps(rec) + "\n")
                f.flush()
                if link:
                    link.publish(rec)
                lines += 1
                if args.seconds and lines >= args.seconds:
                    break

                next_tick += 1.0
                gear = d[BASE["gearAgl"]]
                # Fast polling while airborne close to the ground, and through the G window after contact
                while (((state["onGround"] is False and gear is not None and gear < FAST_BELOW_FT)
                        or (state["gFor"] is not None and time.monotonic() <= state["gUntil"]))
                       and time.monotonic() + FAST_DT < next_tick):
                    fd = sv.fetch(fast_keys)
                    gear = fd[BASE["gearAgl"]]
                    note_ground(flag(fd[BASE["onGround"]]), fd[BASE["vs"]], gear, fd[BASE["g"]])
                    time.sleep(FAST_DT)
                time.sleep(max(0.0, next_tick - time.monotonic()))
    except KeyboardInterrupt:
        pass
    finally:
        print(f"Stopped. {lines} samples written to {path}", file=sys.stderr)
        if link:
            link.stop()
        try:
            sm.exit()
        except Exception:
            pass


if __name__ == "__main__":
    main()
