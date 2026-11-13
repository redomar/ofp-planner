"""Read the Fenix A320-family MCDU flight plan, read-only, from Fenix's own gateway.

Uses the same subscription the Fenix EFB uses:
  ws://127.0.0.1:8083/graphql (graphql-transport-ws)
  subscription { dataRefs(names: [...]) { name value } }
Nothing is ever written to the Fenix.
"""
import json
import math
import re
import sys
import time
import xml.etree.ElementTree as ET

from websockets.sync.client import connect

GATEWAY = "ws://127.0.0.1:8083/graphql"
NAMES = ["aircraft.fms.origin", "aircraft.fms.destination", "aircraft.fms.alternate",
         "aircraft.fms.flightPhase", "fenix.cids.flightNumber", "aircraft.fms.flightPlanXml",
         "aircraft.mcdu1.display", "aircraft.mcdu2.display"]

# Fenix MCDU character codes (confirmed from the MCDU screen: the page title's
# scroll arrows are "£¢" = "<->", the scratchpad's are "¤¥" = up/down):
#   "&" = overfly / fly-over triangle (the delta on the OVFY key)
#   "£" = left arrow after a fix: a required LEFT turn at that fix
#   "¢" = right arrow after a fix: a required RIGHT turn
SYMBOLS = {"&": "overfly", "£": "turnLeft", "¢": "turnRight"}
SYMBOL_CHARS = "&£¢"

# Altitude constraints seen on the F-PLN page, remembered while the pilot pages
# through it (the screen only shows ~5 fixes at a time). Reset when the route changes.
_constraints = {}
_constraint_key = None
_passed = []         # waypoints the Fenix already dropped from its plan, oldest first
_last_legs = []      # the plan's legs at the previous read
_history_from_origin = False   # True when the first plan seen for this flight started at the origin
_WPT_LINE = re.compile(r"^[gwyamcb]?([A-Z0-9]{2,8})[&£¢]*(?=[\sgwsl])")
_ALT_CON = re.compile(r"/[^/]*?ms?([+\-]?)(FL\d{3}|\d{3,5})")


def read_values(timeout=6.0, names=None):
    names = names or NAMES
    doc = "subscription { dataRefs(names: %s) { name value } }" % json.dumps(names)
    got = {}
    with connect(GATEWAY, subprotocols=["graphql-transport-ws"], open_timeout=5) as ws:
        ws.send(json.dumps({"type": "connection_init", "payload": {}}))
        ws.recv(timeout=5)
        ws.send(json.dumps({"id": "1", "type": "subscribe", "payload": {"query": doc}}))
        end = time.time() + timeout
        while time.time() < end and len(got) < len(names):
            try:
                m = json.loads(ws.recv(timeout=max(0.1, end - time.time())))
            except TimeoutError:
                break
            if m.get("type") == "next":
                d = m["payload"]["data"]["dataRefs"]
                got[d["name"]] = d["value"]
            elif m.get("type") == "error":
                raise RuntimeError(f"gateway error: {m.get('payload')}")
    return got


def _num(s):
    try:
        v = float(s)
        return None if math.isnan(v) else v
    except (TypeError, ValueError):
        return None


_dropped_seen = set()


def _real_position(lat, lon):
    """False for 0,0 ('Null Island': unresolved MCDU entries) and out-of-range values."""
    if abs(lat) > 90 or abs(lon) > 180:
        return False
    return not (abs(lat) < 1e-4 and abs(lon) < 1e-4)


def _note_dropped(ident, lat, lon):
    key = (ident, round(lat, 4), round(lon, 4))
    if key not in _dropped_seen:                # say it once per waypoint, not every 10 s
        _dropped_seen.add(key)
        print(f"OFP Tower: ignored MCDU waypoint {ident!r} with no real position ({lat}, {lon})",
              file=sys.stderr)


def parse_plan_xml(xml_text, destination=None):
    root = ET.fromstring(xml_text)
    cruise = _num(root.findtext("cruiseLevel"))
    route = None
    for rt in root.iter("route"):
        if rt.get("type") == "act":
            route = rt
            break
    legs = []
    past_dest = False
    if route is not None:
        for lg in route.iter("leg"):
            ltype = lg.findtext("type") or ""
            raw = lg.findtext("displayString") or ""
            lat, lon = _num(lg.findtext("latitude")), _num(lg.findtext("longitude"))
            if ltype in ("Disco", "EndOfFlightPlan", "NoAlternate") or lat is None or lon is None:
                continue
            flags = [name for ch, name in SYMBOLS.items() if ch in raw]
            ident = re.sub("[" + SYMBOL_CHARS + "]", "", raw).strip()
            if not _real_position(lat, lon):
                _note_dropped(ident or raw or ltype, lat, lon)   # e.g. 0,0 while the MCDU is mid-entry
                continue
            leg = {"id": ident, "lat": round(lat, 6), "lon": round(lon, 6),
                   "via": lg.findtext("via") or None, "kind": ltype}
            eta = (lg.findtext("ETA") or "").strip()
            if re.fullmatch(r"\d{4}", eta):
                leg["eta"] = f"{eta[:2]}:{eta[2:]}"      # FMS prediction, UTC hh:mm
            wm = re.fullmatch(r"\s*(\d{1,3})\D{0,2}/\s*(\d{1,3})\s*", lg.findtext("wind") or "")
            if wm:
                leg["wind"] = [int(wm.group(1)), int(wm.group(2))]   # FMS wind [deg, kt]
            if flags:
                leg["flags"] = flags
            if re.fullmatch(r"\d+", ident):      # altitude-terminated leg, e.g. "3000"
                leg["pseudo"] = True
            if past_dest:
                leg["missed"] = True             # missed approach, after the destination runway
            if destination and ident.startswith(destination):
                past_dest = True
            legs.append(leg)
    return cruise, legs


EARTH_NM = 3440.065
TURN_BANK_DEG = 25.0          # Airbus FMS lateral guidance: ~25 deg bank in normal turns
TURN_REF_KT = 220.0           # reference ground speed for the estimate (terminal area)


def _gc(lat1, lon1, lat2, lon2):
    """Great-circle distance (nm) and initial true course (deg)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    dist = 2 * EARTH_NM * math.asin(min(1.0, math.sqrt(a)))
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return dist, (math.degrees(math.atan2(y, x)) + 360) % 360


def turn_radius_nm(gs_kt, bank_deg=TURN_BANK_DEG):
    """r = V^2 / (g tan(bank)); result in nm."""
    v = gs_kt * 0.514444
    return v * v / (9.80665 * math.tan(math.radians(bank_deg))) / 1852.0


def add_geometry(legs):
    """Per leg: distance and course from the previous fix; at each fix the turn
    (angle, direction) and an ESTIMATED turn radius and fly-by lead distance."""
    real = [l for l in legs if not l.get("pseudo")]
    for i, l in enumerate(real):
        if i > 0:
            d, crs = _gc(real[i - 1]["lat"], real[i - 1]["lon"], l["lat"], l["lon"])
            l["distNm"] = round(d, 2)
            l["courseIn"] = round(crs)
        if 0 < i < len(real) - 1:
            _, crs_out = _gc(l["lat"], l["lon"], real[i + 1]["lat"], real[i + 1]["lon"])
            delta = (crs_out - l["courseIn"] + 540) % 360 - 180      # -180..180, + = right
            flags = l.get("flags", [])
            if "turnLeft" in flags and delta > 0:
                delta -= 360                                      # forced left turn
            elif "turnRight" in flags and delta < 0:
                delta += 360
            if abs(delta) >= 3:
                r = turn_radius_nm(TURN_REF_KT)
                turn = {"deg": round(abs(delta)), "dir": "R" if delta > 0 else "L",
                        "radiusNm": round(r, 2), "atKt": TURN_REF_KT, "bankDeg": TURN_BANK_DEG,
                        "estimated": True}
                if "overfly" in flags:
                    turn["style"] = "flyover"                      # pass the fix, then turn
                else:
                    turn["style"] = "flyby"                        # turn starts before the fix
                    if abs(delta) < 180:
                        turn["leadNm"] = round(r * math.tan(math.radians(abs(delta)) / 2), 2)
                l["turn"] = turn


_LEG_COURSE = re.compile(r"(?<![A-Z0-9])(TRK|C|H|T)(\d{3})°")
_LEG_DIST = re.compile(r"g(\d+(?:\.\d)?)w?(NM)?")
_LEG_PROC = re.compile(r"^s\s+(?!C\d{3}°|H\d{3}°|TRK)([A-Z][A-Z0-9-]{2,8})\s")


def parse_fpln_page(display_xml):
    """From an MCDU F-PLN page: per waypoint, the magenta altitude constraint and the
    FMS's own leg annotation shown on the small line above it (course/track into the
    fix, procedure name, leg distance). Returns {ident: {...}}."""
    found = {}
    if not display_xml:
        return found
    try:
        root = ET.fromstring(display_xml)
    except ET.ParseError:
        return found
    lines = [l.text or "" for l in root.iter("line")]
    if not any("SPD/ALT" in l for l in lines):      # not the F-PLN page
        return found
    pending = None
    for line in lines:
        m = _WPT_LINE.match(line)
        if m:
            info = {}
            c = _ALT_CON.search(line)
            if c:
                sign, val = c.groups()
                ft = int(val[2:]) * 100 if val.startswith("FL") else int(val)
                info["altConstraint"] = {"alt": ft, "type": {"+": "atOrAbove", "-": "atOrBelow"}.get(sign, "at"),
                                         "text": sign + val}
            if pending:
                info.update(pending)
            if info:
                found[m.group(1)] = info
            pending = None
            continue
        if line.startswith("s ") and "DEST" not in line:   # small annotation line above the next fix
            ann = {}
            cm = _LEG_COURSE.search(line)
            if cm:
                kind = {"C": "course", "H": "heading", "TRK": "track", "T": "track"}[cm.group(1)]
                ann["fmsLeg"] = {"type": kind, "deg": int(cm.group(2)), "magnetic": True, "text": cm.group(0)}
            pm = _LEG_PROC.match(line)
            if pm and pm.group(1) not in ("TIME", "SPD", "DEST"):
                ann["procedure"] = pm.group(1)
            tail = line.split("°", 1)[-1] if "°" in line else line
            dm = _LEG_DIST.search(tail)
            if dm:
                ann["fmsDistNm"] = float(dm.group(1))
            pending = ann or None
    return found


RUNWAY_DRAW_M = 5000.0        # drawn length: deliberately longer than real so it reads on a map


def _dest_point(lat, lon, course_deg, dist_nm):
    p1, l1, b = math.radians(lat), math.radians(lon), math.radians(course_deg)
    d = dist_nm / EARTH_NM
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return round(math.degrees(p2), 6), round((math.degrees(l2) + 540) % 360 - 180, 6)


def _rwy_number_heading(rwy):
    m = re.match(r"(\d{1,2})", rwy or "")
    return int(m.group(1)) * 10 % 360 if m else None


def build_runways(origin, dep_rwy, dest, arr_rwy, legs):
    """Stylised runway lines (display only): from the threshold the FMS gives, 5 km long,
    heading from the initial course (departure) / final course into the threshold (arrival).
    Falls back to the runway number x10 when the course disagrees by more than 30 deg."""
    out = []
    real = [l for l in legs if not l.get("pseudo")]
    ids = [l["id"] for l in real]

    def make(role, apt, rwy, heading, how):
        thr = real[ids.index(f"{apt}{rwy}")]
        num = _rwy_number_heading(rwy)
        if heading is None or (num is not None and abs((heading - num + 540) % 360 - 180) > 30):
            heading, how = num, "runwayNumber"
        if heading is None:
            return
        end = _dest_point(thr["lat"], thr["lon"], heading, RUNWAY_DRAW_M / 1852.0)
        out.append({"role": role, "airport": apt, "runway": rwy,
                    "start": {"lat": thr["lat"], "lon": thr["lon"]}, "end": {"lat": end[0], "lon": end[1]},
                    "headingTrue": round(heading), "headingFrom": how,
                    "lengthM": RUNWAY_DRAW_M, "stylised": True})

    if origin and dep_rwy and f"{origin}{dep_rwy}" in ids:
        i = ids.index(f"{origin}{dep_rwy}")
        hdg = real[i + 1].get("courseIn") if i + 1 < len(real) else None
        make("departure", origin, dep_rwy, hdg, "initialCourse")
    if dest and arr_rwy and f"{dest}{arr_rwy}" in ids:
        i = ids.index(f"{dest}{arr_rwy}")
        hdg = real[i].get("courseIn")
        make("arrival", dest, arr_rwy, hdg, "finalCourse")
    return out


def parse_constraints(display_xml):
    """Back-compat: only the altitude constraints from an F-PLN page."""
    return {k: v["altConstraint"] for k, v in parse_fpln_page(display_xml).items() if "altConstraint" in v}


def read_plan():
    global _constraint_key, _passed, _last_legs, _history_from_origin
    v = read_values()
    origin = v.get("aircraft.fms.origin") or None
    dest = v.get("aircraft.fms.destination") or None
    cruise, legs = (None, [])
    dep_rwy = arr_rwy = None
    vspeeds = None
    if v.get("aircraft.fms.flightPlanXml"):
        try:
            vs_el = ET.fromstring(v["aircraft.fms.flightPlanXml"]).find(".//vSpeeds")
            if vs_el is not None:
                vspeeds = {k: _num(vs_el.findtext(k)) for k in ("v1", "vr", "v2", "vapp")}
                vspeeds = {k: int(x) for k, x in vspeeds.items() if x}
                vspeeds = vspeeds or None
        except ET.ParseError:
            pass
        cruise, legs = parse_plan_xml(v["aircraft.fms.flightPlanXml"], dest)
        try:
            for rt in ET.fromstring(v["aircraft.fms.flightPlanXml"]).iter("route"):
                if rt.get("type") == "act":
                    dep_rwy = (rt.findtext("originRunway") or "").strip() or None
                    arr_rwy = (rt.findtext("destinationRunway") or "").strip() or None
        except ET.ParseError:
            pass
    ids = tuple(l["id"] for l in legs)
    key = (origin, dest, ids)
    old = _constraint_key
    sequenced = (old is not None and old[:2] == key[:2] and len(ids) > 0
                 and len(ids) < len(old[2]) and old[2][-len(ids):] == ids)
    if old is None or old[:2] != key[:2]:
        _passed = []                    # different flight: no history
        _history_from_origin = bool(legs and origin and legs[0]["id"].startswith(origin))
    if sequenced:                       # waypoint(s) passed: same route, keep constraints + history
        dropped = _last_legs[:len(old[2]) - len(ids)]
        _passed.extend(dict(l, passed=True) for l in dropped)
        _constraint_key = key
    elif key != _constraint_key:        # new or edited route: forget old constraints
        _constraints.clear()
        _constraint_key = key
    _last_legs = [dict(l) for l in legs]
    for disp in ("aircraft.mcdu1.display", "aircraft.mcdu2.display"):
        for ident, info in parse_fpln_page(v.get(disp)).items():
            _constraints.setdefault(ident, {}).update(info)
    for leg in legs:
        leg.update(_constraints.get(leg["id"], {}))
    n_passed = len(_passed)
    legs = [dict(l) for l in _passed] + legs   # full route: passed (flagged) + the Fenix's live plan
    add_geometry(legs)
    return {
        "type": "plan", "source": "fenix-fms",
        "origin": origin, "destination": dest,
        "originRunway": dep_rwy, "destinationRunway": arr_rwy,
        "alternate": v.get("aircraft.fms.alternate") or None,
        "flightNumber": v.get("fenix.cids.flightNumber") or None,
        "cruiseLevel": cruise, "phase": v.get("aircraft.fms.flightPhase") or None,
        "runways": build_runways(origin, dep_rwy, dest, arr_rwy, legs),
        "vSpeeds": vspeeds,
        # The Fenix drops passed waypoints; OFP Tower keeps them (flagged "passed") in front.
        # legs[from] is the FROM (last passed waypoint), legs[to] the TO.
        "active": {"from": n_passed, "to": n_passed + 1} if len(legs) - n_passed >= 2 else None,
        # False when OFP Tower started mid-flight: waypoints passed before that are missing,
        # so measure progress from the origin airport, not from legs[0].
        "historyComplete": _history_from_origin,
        "legs": legs,
    }


if __name__ == "__main__":
    print(json.dumps(read_plan(), indent=1))
