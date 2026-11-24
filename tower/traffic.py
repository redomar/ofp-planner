"""Read-only SimConnect reader for other aircraft around the user and for an airport's parking stands.

Opens its own SimConnect connection (plain ctypes, separate from the recorder's), so the
recorder's single-variable reads are untouched. Nothing is ever written to the sim.

  t = SimTraffic(); t.open()
  t.aircraft(radius_m=60000)   -> [ {objectId, atcId, airline, flightNumber, model, type, title, lat, lon,
                                      altFt, gsKt, hdg, onGround, aiState, aiFrom, aiTo, aiEtaS, aiEtdS,
                                      aiParking, aiRunway, aiAirport, isUser}, ... ]
  t.stands("EKCH")             -> {"icao", "lat", "lon", "stands": [ {name, number, suffix, type, lat, lon,
                                      hdg, radiusM}, ... ]}
"""
import ctypes
import math
import os
import re
import threading
import time
from ctypes import wintypes

HERE = os.path.dirname(os.path.abspath(__file__))
DLL_CANDIDATES = [r"C:\Program Files (x86)\MSFSAddonsLinker\Simconnect_2024\SimConnect.dll", None]

# SimConnect enums used here
DT_INT32, DT_FLOAT32, DT_FLOAT64, DT_STRING32, DT_STRING64, DT_STRING128, DT_STRING256 = 1, 3, 4, 6, 7, 8, 9
OBJ_AIRCRAFT = 2
RECV_EXCEPTION, RECV_OPEN, RECV_QUIT = 1, 2, 3
RECV_SIMOBJECT_DATA_BYTYPE = 9
RECV_FACILITY_DATA, RECV_FACILITY_DATA_END = 28, 29
SIZE = {DT_INT32: 4, DT_FLOAT32: 4, DT_FLOAT64: 8, DT_STRING32: 32, DT_STRING64: 64, DT_STRING128: 128,
        DT_STRING256: 256}

# (key, SimVar, unit, datatype)
AIRCRAFT_FIELDS = [
    ("title", "TITLE", None, DT_STRING256),
    ("atcId", "ATC ID", None, DT_STRING32),
    ("airline", "ATC AIRLINE", None, DT_STRING64),
    ("flightNumber", "ATC FLIGHT NUMBER", None, DT_STRING32),
    ("model", "ATC MODEL", None, DT_STRING32),
    ("type", "ATC TYPE", None, DT_STRING32),
    ("aiState", "AI TRAFFIC STATE", None, DT_STRING32),
    ("aiFrom", "AI TRAFFIC FROMAIRPORT", None, DT_STRING32),
    ("aiTo", "AI TRAFFIC TOAIRPORT", None, DT_STRING32),
    ("aiParking", "AI TRAFFIC ASSIGNED PARKING", None, DT_STRING64),
    ("aiRunway", "AI TRAFFIC ASSIGNED RUNWAY", None, DT_STRING32),
    ("aiAirport", "AI TRAFFIC CURRENT AIRPORT", None, DT_STRING32),
    ("lat", "PLANE LATITUDE", "degrees", DT_FLOAT64),
    ("lon", "PLANE LONGITUDE", "degrees", DT_FLOAT64),
    ("altFt", "PLANE ALTITUDE", "feet", DT_FLOAT64),
    ("gsKt", "GROUND VELOCITY", "knots", DT_FLOAT64),
    ("hdg", "PLANE HEADING DEGREES TRUE", "degrees", DT_FLOAT64),
    ("onGround", "SIM ON GROUND", "bool", DT_FLOAT64),
    ("aiEtaS", "AI TRAFFIC ETA", "seconds", DT_FLOAT64),
    ("aiEtdS", "AI TRAFFIC ETD", "seconds", DT_FLOAT64),
    ("isUser", "IS USER SIM", "bool", DT_FLOAT64),
]

# Facilities API: airport position, then each TAXI_PARKING (offsets in metres from the airport reference)
AIRPORT_FIELDS = [("lat", "LATITUDE", DT_FLOAT64), ("lon", "LONGITUDE", DT_FLOAT64)]
PARKING_FIELDS = [("type", "TYPE", DT_INT32), ("name", "NAME", DT_INT32), ("suffix", "SUFFIX", DT_INT32),
                  ("number", "NUMBER", DT_INT32), ("hdg", "HEADING", DT_FLOAT32), ("radiusM", "RADIUS", DT_FLOAT32),
                  ("biasX", "BIAS_X", DT_FLOAT32), ("biasZ", "BIAS_Z", DT_FLOAT32)]

PARKING_NAMES = ["", "PARKING", "N PARKING", "NE PARKING", "E PARKING", "SE PARKING", "S PARKING",
                 "SW PARKING", "W PARKING", "NW PARKING", "GATE", "DOCK"] + [f"GATE {c}" for c in
                                                                              "ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
PARKING_TYPES = ["NONE", "RAMP_GA", "RAMP_GA_SMALL", "RAMP_GA_MEDIUM", "RAMP_GA_LARGE", "RAMP_CARGO",
                 "RAMP_MIL_CARGO", "RAMP_MIL_COMBAT", "GATE_SMALL", "GATE_MEDIUM", "GATE_HEAVY", "DOCK_GA",
                 "FUEL", "VEHICLE", "RAMP_GA_EXTRA", "GATE_EXTRA"]
SUFFIXES = [""] + list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
EARTH_M = 6371008.8


class _Recv(ctypes.Structure):
    _fields_ = [("dwSize", wintypes.DWORD), ("dwVersion", wintypes.DWORD), ("dwID", wintypes.DWORD)]


# WINFUNCTYPE exists only on Windows; the fallback lets the module (and its tests) load elsewhere
DISPATCH = getattr(ctypes, "WINFUNCTYPE", ctypes.CFUNCTYPE)(None, ctypes.POINTER(_Recv), wintypes.DWORD, ctypes.c_void_p)


def _unpack(buf, offset, fields):
    out = {}
    for f in fields:
        key, dt = f[0], f[-1]
        n = SIZE[dt]
        raw = buf[offset:offset + n]
        if dt == DT_FLOAT64:
            v = ctypes.c_double.from_buffer_copy(raw).value
        elif dt == DT_FLOAT32:
            v = ctypes.c_float.from_buffer_copy(raw).value
        elif dt == DT_INT32:
            v = ctypes.c_int32.from_buffer_copy(raw).value
        else:
            v = raw.split(b"\x00", 1)[0].decode("utf-8", "replace").strip()
        out[key] = v
        offset += n
    return out


def stand_label(s):
    """'GATE D', 2, '' -> 'D2'; 'GATE', 12 -> '12'; 'PARKING', 5 -> 'P5'; 'N PARKING' 3 -> 'N3'."""
    name = PARKING_NAMES[s["name"]] if 0 <= s["name"] < len(PARKING_NAMES) else ""
    suf = SUFFIXES[s["suffix"]] if 0 <= s["suffix"] < len(SUFFIXES) else ""
    num = str(s["number"]) if s["number"] else ""
    if name.startswith("GATE "):
        return f"{name[5:]}{num}{suf}"
    if name in ("GATE", "DOCK"):
        return f"{num}{suf}" or name.title()
    if name.endswith("PARKING"):
        pre = name.split()[0] if " " in name else "P"
        return f"{pre}{num}{suf}"
    return f"{num}{suf}"


class SimTraffic:
    def __init__(self, dll_path=None):
        self.dll_path = dll_path
        self.h = wintypes.HANDLE()
        self._lock = threading.Lock()
        self._ac = None
        self._ac_req = 0
        self._fac = {}
        self.exceptions = []
        self.quit = False
        self._cb = DISPATCH(self._dispatch)

    # ---- connection
    def open(self):
        last = None
        for path in ([self.dll_path] if self.dll_path else DLL_CANDIDATES):
            if path is None:
                path = os.path.join(os.path.dirname(__import__("SimConnect").__file__), "SimConnect.dll")
            if not os.path.exists(path):
                continue
            try:
                self.dll = ctypes.WinDLL(path)
                hr = self.dll.SimConnect_Open(ctypes.byref(self.h), b"OFP Tower traffic", None, 0, None, 0)
                if hr == 0:
                    self._define()
                    return self
                last = f"SimConnect_Open hr={hr & 0xffffffff:#x}"
            except OSError as e:
                last = e
        raise ConnectionError(f"traffic: could not open SimConnect ({last})")

    def close(self):
        try:
            self.dll.SimConnect_Close(self.h)
        except Exception:
            pass

    def _define(self):
        add = self.dll.SimConnect_AddToDataDefinition
        add.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int,
                        ctypes.c_float, wintypes.DWORD]
        for key, var, unit, dt in AIRCRAFT_FIELDS:
            add(self.h, 1, var.encode(), unit.encode() if unit else None, dt, 0.0, 0xFFFFFFFF)
        fadd = self.dll.SimConnect_AddToFacilityDefinition
        fadd.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.c_char_p]
        fadd(self.h, 2, b"OPEN AIRPORT")
        for _, f, _ in AIRPORT_FIELDS:
            fadd(self.h, 2, f.encode())
        fadd(self.h, 2, b"OPEN TAXI_PARKING")
        for _, f, _ in PARKING_FIELDS:
            fadd(self.h, 2, f.encode())
        fadd(self.h, 2, b"CLOSE TAXI_PARKING")
        fadd(self.h, 2, b"CLOSE AIRPORT")
        self.dll.SimConnect_RequestDataOnSimObjectType.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD,
                                                                   wintypes.DWORD, ctypes.c_int]
        self.dll.SimConnect_RequestFacilityData.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD,
                                                            ctypes.c_char_p, ctypes.c_char_p]
        self.dll.SimConnect_CallDispatch.argtypes = [wintypes.HANDLE, DISPATCH, ctypes.c_void_p]

    # ---- dispatch
    def _dispatch(self, p, cb, ctx):
        rid = p.contents.dwID
        buf = ctypes.string_at(p, cb)
        if rid == RECV_SIMOBJECT_DATA_BYTYPE:
            # RECV(3) + requestID, objectID, defineID, flags, entry, outOf, defineCount = 10 DWORDs
            req, obj, _d, _f, entry, outof, _c = (int.from_bytes(buf[12 + 4 * i:16 + 4 * i], "little")
                                                 for i in range(7))
            if req == self._ac_req and self._ac is not None:
                row = _unpack(buf, 40, AIRCRAFT_FIELDS)
                row["objectId"] = obj
                self._ac["rows"].append(row)
                if entry + 1 >= outof:
                    self._ac["done"] = True
        elif rid == RECV_FACILITY_DATA:
            # RECV(3) + UserRequestId, UniqueRequestId, ParentUniqueRequestId, Type, IsListItem, ItemIndex, ListSize
            user_req = int.from_bytes(buf[12:16], "little")
            ftype = int.from_bytes(buf[24:28], "little")
            st = self._fac.get(user_req)
            if st is not None:
                st["types"].add(ftype)
                if ftype == 0:                                  # AIRPORT
                    st["airport"] = _unpack(buf, 40, AIRPORT_FIELDS)
                else:
                    st["parkings"].append(_unpack(buf, 40, PARKING_FIELDS))
        elif rid == RECV_FACILITY_DATA_END:
            user_req = int.from_bytes(buf[12:16], "little")
            if user_req in self._fac:
                self._fac[user_req]["done"] = True
        elif rid == RECV_EXCEPTION:
            self.exceptions = (self.exceptions + [int.from_bytes(buf[12:16], "little")])[-20:]
        elif rid == RECV_QUIT:
            self.quit = True

    def _pump(self, until, timeout):
        end = time.monotonic() + timeout
        while time.monotonic() < end and not until():
            self.dll.SimConnect_CallDispatch(self.h, self._cb, None)
            time.sleep(0.01)
        return until()

    # ---- requests
    def aircraft(self, radius_m=60000, timeout=3.0):
        with self._lock:
            self._ac_req = 100 + (self._ac_req + 1) % 1000
            self._ac = {"rows": [], "done": False}
            self.dll.SimConnect_RequestDataOnSimObjectType(self.h, self._ac_req, 1,
                                                           min(int(radius_m), 200000), OBJ_AIRCRAFT)
            self._pump(lambda: self._ac["done"], timeout)
            rows = self._ac["rows"]
            self._ac = None
        for r in rows:
            r["onGround"] = bool(round(r["onGround"]))
            r["isUser"] = bool(round(r["isUser"]))
        return rows

    def stands(self, icao, timeout=8.0):
        with self._lock:
            req = 5000 + len(self._fac)
            st = {"airport": None, "parkings": [], "types": set(), "done": False}
            self._fac[req] = st
            self.dll.SimConnect_RequestFacilityData(self.h, 2, req, icao.upper().encode(), b"")
            self._pump(lambda: st["done"], timeout)
            del self._fac[req]
        apt = st["airport"]
        if not apt:
            return None
        out = []
        for p in st["parkings"]:
            lat, lon = offset_m(apt["lat"], apt["lon"], p["biasZ"], p["biasX"])
            out.append({"name": stand_label(p), "number": p["number"],
                        "kind": PARKING_TYPES[p["type"]] if 0 <= p["type"] < len(PARKING_TYPES) else str(p["type"]),
                        "lat": round(lat, 6), "lon": round(lon, 6), "hdg": round(p["hdg"]),
                        "radiusM": round(p["radiusM"], 1)})
        return {"icao": icao.upper(), "lat": apt["lat"], "lon": apt["lon"], "stands": out,
                "facilityTypes": sorted(st["types"])}


# ---------------------------------------------------------------- other sources (read-only HTTP)
SI_TRACKER_URL = "https://tracker.sayintentions.ai/api/map"     # public, undocumented: poll >= 60 s
SI_FLIGHT_URL = "http://127.0.0.1:43117/flightJSON"              # SayIntentions client, own flight only
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) OFP-Tower"
# Only these tracker fields ever leave this module (no names, user ids, group codes, missions).
SI_KEEP = ("flight_icao", "tail_number", "aircraft_icao", "origin", "final_destination", "flight_plan_origin",
           "flight_plan_destination", "flight_rules", "flight_type", "lat", "lon", "altitude_agl", "altitude",
           "airspeed", "heading", "minutes_to_tod", "landing_rate", "paused", "skynet_enabled", "va_name")


def _get_json(url, timeout=30):
    import json
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def si_tracker_near(lat, lon, radius_nm, exclude=()):
    """SayIntentions pilots (SkyNet or not) within radius_nm, whitelisted fields only."""
    out = []
    excl = {e.replace("-", "").upper() for e in exclude if e}
    for p in _get_json(SI_TRACKER_URL):
        if not isinstance(p, dict) or p.get("lat") is None or p.get("lon") is None:
            continue
        ids = {(p.get("flight_icao") or "").upper(), (p.get("tail_number") or "").replace("-", "").upper()}
        if ids & excl:
            continue
        if dist_m(lat, lon, p["lat"], p["lon"]) > radius_nm * 1852:
            continue
        out.append({k: p.get(k) for k in SI_KEEP})
    return out


def si_own_flight():
    """The user's flight as SayIntentions sees it (whitelisted flightJSON fields only), or None.
    Used for the chosen airport when there is no Fenix plan, and to leave the user out of the tracker rows."""
    try:
        fd = _get_json(SI_FLIGHT_URL, timeout=3).get("flight_details") or {}
    except Exception:
        return None
    cf = fd.get("current_flight") or {}
    return {"origin": cf.get("flight_origin") or None, "destination": cf.get("flight_destination") or None,
            "callsign": fd.get("callsign_icao") or None, "gate": (cf.get("assigned_gate") or "").strip() or None}


_TYPE_RE = re.compile(r"^(?=.{3,4}$)[A-Z]{1,3}[0-9][0-9A-Z]{0,2}$")
_NOT_TYPES = {"FSLTL", "FAIB", "TFS", "OSP", "FSPXAI", "ZZZZ", "CEO", "NEO"}


def icao_type(title, model=None):
    """ICAO type from the livery title ('FSLTL_FAIB_B738_RYS-Buzz' -> 'B738', 'FSLTL A20N SAS' -> 'A20N',
    'Asobo PassiveAircraft B737-700F' -> 'B737'), else ATC MODEL when it looks like one ('A320'), else None."""
    for tok in re.split(r"[\s_\-]+", (title or "").upper()):
        if tok not in _NOT_TYPES and _TYPE_RE.match(tok):
            return tok
    m = (model or "").strip().upper()
    return m if _TYPE_RE.match(m) else None


def sim_source(row, si_refs=()):
    """SayIntentions' dispatcher injects FSLTL models (and names its aircraft in L:SIAI_*_REF);
    MSFS's own traffic is 'Asobo PassiveAircraft ...'."""
    if row.get("objectId") in si_refs or (row.get("title") or "").upper().startswith("FSLTL"):
        return "SI"
    return "AI"


ON_FIELD_NM = 3.0             # an aircraft on the ground further than this from the airport is elsewhere

REAL_STATES = {"sleep", "flt plan", "startup", "preflight support", "clearance", "push back 1", "push back 2",
               "pre taxi out", "taxi out", "takeoff 1", "takeoff 2", "t&g depart", "enroute", "pattern", "landing",
               "rollout", "go around", "taxi in", "shutdown", "postflight support"}


def traffic_message(airport, sim_rows, tracker_rows, user_ids=(), radius_nm=100, si_refs=(), now=None):
    """{"type":"traffic","airport":ICAO,"aircraft":[...]} per docs/OFP-LINK.md "Traffic and stands (1.17)".
    airport: {"icao","lat","lon"}. Only aircraft with a callsign, never the user's own, never personal fields."""
    now = time.time() if now is None else now
    user = {u.replace("-", "").upper() for u in user_ids if u}
    out, by_cs = [], {}

    def near(lat, lon, on_ground=False):
        # On the ground: only at this airport (else a parked aircraft at a neighbour field reads as a departure)
        lim = ON_FIELD_NM if on_ground else radius_nm
        return dist_m(airport["lat"], airport["lon"], lat, lon) <= lim * 1852

    for r in sim_rows or []:
        cs = (r.get("atcId") or "").replace("-", "").replace(" ", "").upper()
        if r.get("isUser") or not cs or cs in user or not near(r["lat"], r["lon"], bool(r["onGround"])):
            continue
        a = {"callsign": cs, "src": sim_source(r, si_refs), "lat": round(r["lat"], 5), "lon": round(r["lon"], 5),
             "alt": round(r["altFt"]), "gs": round(r["gsKt"]), "onGround": bool(r["onGround"])}
        t = icao_type(r.get("title"), r.get("model"))
        if t:
            a["type"] = t
        if r.get("aiFrom"):
            a["from"] = r["aiFrom"]
        if r.get("aiTo"):
            a["to"] = r["aiTo"]
        if r.get("aiFrom") or r.get("aiTo"):        # schedule times only mean something with a schedule
            if r.get("aiEtdS"):
                a["etd"] = int(now + r["aiEtdS"])
            if r.get("aiEtaS"):
                a["eta"] = int(now + r["aiEtaS"])
        if r.get("aiParking"):
            a["parking"] = r["aiParking"]
        if (r.get("aiState") or "").strip().lower() in REAL_STATES:
            a["state"] = r["aiState"].strip().lower()
        by_cs[cs] = len(out)
        out.append(a)
    for p in tracker_rows or []:
        cs = (p.get("flight_icao") or "").upper() or (p.get("tail_number") or "").replace("-", "").upper()
        tail = (p.get("tail_number") or "").replace("-", "").upper()
        gnd = (p.get("altitude_agl") if p.get("altitude_agl") is not None else 9999) < 50
        if not cs or cs in user or tail in user or p.get("lat") is None or not near(p["lat"], p["lon"], gnd):
            continue
        a = {"callsign": cs, "src": "SKY" if p.get("skynet_enabled") == 1 else "SI",
             "lat": round(p["lat"], 5), "lon": round(p["lon"], 5),
             "onGround": (p.get("altitude_agl") if p.get("altitude_agl") is not None else 9999) < 50,
             "gs": round(p.get("airspeed") or 0)}
        if not a["onGround"] and p.get("altitude") is not None:
            a["alt"] = round(p["altitude"])
        if p.get("aircraft_icao") and _TYPE_RE.match(str(p["aircraft_icao"]).upper()):
            a["type"] = str(p["aircraft_icao"]).upper()
        orig = p.get("origin") or p.get("flight_plan_origin")
        dest = p.get("final_destination") or p.get("flight_plan_destination")
        if orig:
            a["from"] = orig
        if dest:
            a["to"] = dest
        if cs in by_cs:                     # also a sim object: the tracker row has the route, keep it
            out[by_cs[cs]] = a
        else:
            by_cs[cs] = len(out)
            out.append(a)
    return {"type": "traffic", "airport": airport["icao"], "aircraft": out}


def stands_message(st):
    """{"type":"stands","airport":ICAO,"stands":[{name,lat,lon,radius}]} (VEHICLE spots skipped)."""
    return {"type": "stands", "airport": st["icao"],
            "stands": [{"name": s["name"], "lat": s["lat"], "lon": s["lon"], "radius": s["radiusM"]}
                       for s in st["stands"] if s["kind"] != "VEHICLE" and s["name"]]}


AT_AIRPORT_NM = 5.0           # on the ground within this of the origin/destination = at that airport
TRAFFIC_EVERY_S = 15
TRACKER_EVERY_S = 60
SIM_RADIUS_M = 200000          # SimConnect's maximum; around the user, then filtered to 100 nm of the airport


def start_traffic_thread(link, ctx, user_ids, every=TRAFFIC_EVERY_S, tracker_every=TRACKER_EVERY_S):
    """Every `every` s: pick the chosen airport (origin until take-off, then destination), send its stands once,
    and the aircraft around it. ctx: shared dict the recorder updates {"onGround": bool|None, "tookOff": bool}.
    user_ids: the user's ATC ID etc. (never sent; used to leave the user out)."""
    import json as _json
    import sys as _sys

    def route():
        try:
            plan = _json.loads(link._plan_msg) if link._plan_msg else {}
        except ValueError:
            plan = {}
        o, d, fn = plan.get("origin"), plan.get("destination"), plan.get("flightNumber")
        si = si_own_flight() or {}
        return (o or si.get("origin"), d or si.get("destination"), [fn, si.get("callsign")])

    def loop():
        sim = None
        stands_cache, tracker, tracker_at, last_route, warned = {}, [], 0.0, None, set()
        while True:
            try:
                o, d, extra_ids = route()
                if (o, d) != last_route:
                    if last_route is not None and ctx.get("onGround"):
                        ctx["tookOff"] = False          # a new flight planned on the ground
                    last_route = (o, d)
                if sim is None or sim.quit:
                    sim = SimTraffic().open()

                def stands_for(code):
                    if code and code not in stands_cache:
                        stands_cache[code] = sim.stands(code) or {"icao": code, "lat": None, "lon": None, "stands": []}
                    return stands_cache.get(code)

                icao = (d if ctx.get("tookOff") else o) or d or o
                # On the ground the airport the aircraft is actually at wins (OFP Tower restarted after landing,
                # or the FMS still holds the last flight's plan).
                if ctx.get("onGround") and ctx.get("lat") is not None:
                    for code in (o, d):
                        s = stands_for(code)
                        if s and s["lat"] is not None and \
                                dist_m(ctx["lat"], ctx["lon"], s["lat"], s["lon"]) <= AT_AIRPORT_NM * 1852:
                            icao = code
                            break
                if not icao:
                    time.sleep(every)
                    continue
                st = stands_for(icao)
                if st["lat"] is None:
                    time.sleep(every)
                    continue
                link.set_stands(stands_message(st))      # only goes out when the airport changed
                apt = {"icao": icao, "lat": st["lat"], "lon": st["lon"]}
                if time.time() - tracker_at >= tracker_every:
                    tracker_at = time.time()
                    try:
                        tracker = si_tracker_near(apt["lat"], apt["lon"], 100)
                    except Exception as e:
                        if "tracker" not in warned:
                            print(f"OFP Tower: SayIntentions tracker not readable ({type(e).__name__}: {e})",
                                  file=_sys.stderr)
                            warned.add("tracker")
                rows = sim.aircraft(radius_m=SIM_RADIUS_M)
                link.set_traffic(traffic_message(apt, rows, tracker, user_ids=list(user_ids) + extra_ids))
                warned.discard("sim")
            except Exception as e:
                if "sim" not in warned:
                    print(f"OFP Tower: traffic not readable yet ({type(e).__name__}: {e})", file=_sys.stderr)
                    warned.add("sim")
                if sim is not None:
                    sim.close()
                sim = None
            time.sleep(every)

    threading.Thread(target=loop, daemon=True).start()


def offset_m(lat, lon, north_m, east_m):
    dlat = north_m / EARTH_M
    dlon = east_m / (EARTH_M * math.cos(math.radians(lat)))
    return lat + math.degrees(dlat), lon + math.degrees(dlon)


def dist_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_M * math.asin(min(1.0, math.sqrt(a)))
