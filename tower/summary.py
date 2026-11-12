"""Flight summary for the board's ending screen, built live from the recorder samples.

Message (sent on connect and whenever it changes; every field may be null):
{"type":"summary","v":1,
 "flight":{"origin","destination","flightNumber","callsign","reg","aircraft"},
 "times":{"out","off","on","in"},                 # UTC epoch ms
 "runways":{"departure","arrival"},               # plan runway at take-off / at touchdown
 "landing":{"fpm","tdSim","peakG","bounces"},
 "maxAltFt","maxGsKt","distanceNm",               # distance flown take-off -> touchdown
 "fuel":{"outKg","offKg","onKg","inKg","tripKg","cruiseFfKgH"},
 "complete"}                                      # true from on-blocks (engines off at the stand)

Events:
  out  first movement (gs > 3 kt) on the ground
  off  lift-off
  on   the landing's first contact (touchdown n=1); bounces are later contacts of the same landing
  in   engines all off on the ground after landing; the time is when the aircraft last came to rest
A take-off within 10 minutes of a landing, without stopping in between, is a touch-and-go:
the landing is cleared and the flight goes on. Any other take-off after a landing starts a new
flight, as does a new origin/destination while not airborne (a diversion keeps the flight).
"""
import json
import math
import re

CRUISE_BAND_FT = 1500       # cruise fuel flow: level samples within this of the highest level
LEVEL_VS_FPM = 300
TOUCH_AND_GO_MS = 10 * 60 * 1000
CLIMB_AWAY_FT = 200          # airborne again above this after a landing = touch-and-go (as the recorder)
JUMP_NM_PER_S = 1.0          # faster than ~3600 kt between samples = slew/teleport, not flown


def _nm(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3440.065 * 2 * math.asin(min(1.0, math.sqrt(h)))


def _aircraft(title):
    m = re.search(r"(A3\d{2}|A2\d{2}|B7\d7|7\d7|E1\d{2}|CRJ\d*|ATR ?\d+)", title or "", re.I)
    return m.group(1).upper() if m else None


class FlightSummary:
    def __init__(self, hello=None):
        hello = hello or {}
        self._reg = hello.get("atcId") or None
        self._aircraft = _aircraft(hello.get("title"))
        self._origin = self._destination = self._flight_no = None
        self._plan_dep_rwy = self._plan_arr_rwy = None
        self.reset()

    def reset(self):
        self.times = {"out": None, "off": None, "on": None, "in": None}
        self.runways = {"departure": None, "arrival": None}
        self.landing = {"fpm": None, "tdSim": None, "peakG": None, "bounces": None}
        self.fuel = {"outKg": None, "offKg": None, "onKg": None, "inKg": None}
        self.max_alt = self.max_gs = None
        self.distance = 0.0
        self._levels = {}          # flight level (100s of ft) -> [sum ffKgH, n]
        self._on_ground = None
        self._last_fix = None      # (t, lat, lon) while airborne
        self._rest_since = None
        self._stopped_after_on = False
        self._climb_check = False   # lifted off after a landing: bounce unless it climbs away

    # --- inputs -------------------------------------------------------------------------
    def note_plan(self, plan):
        origin, dest = plan.get("origin") or None, plan.get("destination") or None
        if (origin or dest) and self._origin is not None and (origin, dest) != (self._origin, self._destination):
            if self._on_ground is not False:       # on the ground: a new flight (airborne = diversion, kept)
                self.reset_keep_ground()
        if origin or dest:
            self._origin, self._destination = origin, dest
        self._flight_no = plan.get("flightNumber") or self._flight_no
        self._plan_dep_rwy = plan.get("originRunway") or self._plan_dep_rwy
        self._plan_arr_rwy = plan.get("destinationRunway") or self._plan_arr_rwy

    def reset_keep_ground(self):
        g = self._on_ground
        self.reset()
        self._on_ground = g

    def add(self, rec):
        t, lat, lon = rec.get("t"), rec.get("lat"), rec.get("lon")
        if t is None or lat is None or lon is None or (abs(lat) < 1e-4 and abs(lon) < 1e-4):
            return                                  # sim still loading: no real position
        on_ground, gs, fob = rec.get("onGround"), rec.get("gs") or 0, rec.get("fobKg")
        engines = rec.get("engines")
        prev = self._on_ground

        # take-off
        if prev is True and on_ground is False:
            if self.times["on"] is not None:
                if t - self.times["on"] <= TOUCH_AND_GO_MS and not self._stopped_after_on:
                    self._climb_check = True        # a bounce, or a touch-and-go once it climbs away
                else:                               # a new flight from here
                    self.reset()
            if self.times["off"] is None:
                self.times["off"], self.fuel["offKg"] = t, fob
                self.runways["departure"] = self._plan_dep_rwy
                if self.times["out"] is None:
                    self.times["out"], self.fuel["outKg"] = t, fob

        # out: first movement on the ground before take-off
        if on_ground is True and self.times["off"] is None and self.times["out"] is None and gs > 3:
            self.times["out"], self.fuel["outKg"] = t, fob

        # touchdowns (written on the line after the contact)
        tds = rec.get("touchdowns") or ([{"n": 1, "landingRate": rec["landingRate"], "tdSim": rec.get("tdSim")}]
                                        if rec.get("landingRate") is not None else [])
        for td in tds:
            if self.times["off"] is None:
                continue                            # a contact before any take-off (sim loading)
            if td.get("n", 1) == 1:
                self.times["on"], self.fuel["onKg"] = t, fob
                self.runways["arrival"] = self._plan_arr_rwy
                self.landing = {"fpm": td.get("landingRate"), "tdSim": td.get("tdSim"),
                                "peakG": None, "bounces": 0}
                self.times["in"] = self.fuel["inKg"] = None
                self._stopped_after_on = False
            elif self.times["on"] is not None:
                self.landing["bounces"] = (self.landing["bounces"] or 0) + 1
        pg = rec.get("tdPeakG")
        if pg and pg.get("n") == 1 and self.times["on"] is not None and self.landing["peakG"] is None:
            self.landing["peakG"] = pg.get("peakG")

        # airborne figures
        if on_ground is False and self._climb_check and (rec.get("agl") or 0) >= CLIMB_AWAY_FT:
            self._climb_check = False               # touch-and-go: back to flying the same flight
            self.times["on"] = self.fuel["onKg"] = None
            self.runways["arrival"] = None
            self.landing = {"fpm": None, "tdSim": None, "peakG": None, "bounces": None}
        if on_ground is False and self.times["off"] is not None:
            alt =rec.get("pressAlt") if rec.get("pressAlt") is not None else rec.get("alt")
            if alt is not None:
                self.max_alt = alt if self.max_alt is None else max(self.max_alt, alt)
            self.max_gs = gs if self.max_gs is None else max(self.max_gs, gs)
            if self._last_fix is not None:
                d = _nm(self._last_fix[1:], (lat, lon))
                dt = max(0.001, (t - self._last_fix[0]) / 1000)
                if d / dt <= JUMP_NM_PER_S:
                    self.distance += d
            self._last_fix = (t, lat, lon)
            ff, vs = rec.get("ffKgH"), rec.get("vs")
            if ff and alt is not None and alt > 10000 and vs is not None and abs(vs) < LEVEL_VS_FPM:
                b = self._levels.setdefault(int(round(alt / 100.0)), [0.0, 0])
                b[0] += ff
                b[1] += 1
        else:
            self._last_fix = None

        # after landing: rest, and on-blocks when the engines are shut down
        if self.times["on"] is not None and on_ground is True:
            if gs < 1:
                if self._rest_since is None:
                    self._rest_since = t
                if t - self._rest_since > 60000:
                    self._stopped_after_on = True
            else:
                self._rest_since = None
            if self.times["in"] is None and isinstance(engines, list) and engines and not any(engines) and gs < 1:
                self.times["in"] = self._rest_since or t
                self.fuel["inKg"] = fob
                self._stopped_after_on = True
        self._on_ground = on_ground

    # --- output -------------------------------------------------------------------------
    def _cruise_ff(self):
        if not self._levels:
            return None
        top = max(self._levels)
        s = n = 0
        for lvl, (ff, k) in self._levels.items():
            if top - lvl <= CRUISE_BAND_FT / 100:
                s += ff
                n += k
        return round(s / n) if n >= 30 else None   # at least 30 s level near the top

    def data(self):
        f = self.fuel
        trip = round(f["offKg"] - f["onKg"]) if f["offKg"] is not None and f["onKg"] is not None else None
        return {
            "type": "summary", "v": 1,
            "flight": {"origin": self._origin, "destination": self._destination,
                       "flightNumber": self._flight_no, "callsign": None,
                       "reg": self._reg, "aircraft": self._aircraft},
            "times": dict(self.times),
            "runways": dict(self.runways),
            "landing": dict(self.landing),
            "maxAltFt": round(self.max_alt / 100) * 100 if self.max_alt is not None else None,
            "maxGsKt": round(self.max_gs) if self.max_gs is not None else None,
            "distanceNm": round(self.distance) if self.times["off"] is not None else None,
            "fuel": {**{k: (round(v) if v is not None else None) for k, v in f.items()},
                     "tripKg": trip, "cruiseFfKgH": self._cruise_ff()},
            "complete": self.times["in"] is not None,
        }

    def message(self):
        return json.dumps(self.data())

    def key(self):
        """The fields whose change should go out at once (the rest can wait for the next tick)."""
        d = self.data()
        return json.dumps([d["flight"], d["times"], d["runways"], d["landing"], d["complete"]])
