"""Tell the sim's replay (or any slew/teleport) apart from flying.

Real flights never move faster than their ground speed allows, even under sim rate (dt is taken
from the sim clock, so x4/x8 time compression is fine). A replay starts with a jump away from
where the aircraft is, and usually jumps again as it loops. While replaying, samples are marked
"replay": true; the flight summary and the flown track ignore them.

The replay is over when the aircraft jumps back to the spot it was on before the first jump
(within 0.1 nm, and stopped again if it was stopped), or after it has sat still on the ground for 2 minutes with no jump (a real reposition to
a new gate, ready for the next flight).
"""
import math

JUMP_MIN_NM = 0.3        # a jump is more than this ...
JUMP_FACTOR = 3.0        # ... and more than 3x what its ground speed could cover (+0.2 nm)
BACK_NM = 0.1            # back on this spot (stopped, as before) = replay over. Tight on purpose:
                         # a replayed landing at the same airport touches down well within 1 nm
REST_EXIT_MS = 120_000   # or still on the ground this long without a jump


def _nm(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3440.065 * 2 * math.asin(min(1.0, math.sqrt(h)))


class ReplayGuard:
    def __init__(self):
        self.active = False
        self._prev = None        # (t, zulu, lat, lon, gs)
        self._anchor = None      # where the aircraft really was before the replay
        self._rest = None

    def check(self, rec):
        """Feed every sample in order; returns True while it belongs to a replay."""
        t, z, lat, lon = rec.get("t"), rec.get("zulu"), rec.get("lat"), rec.get("lon")
        if t is None or lat is None or lon is None or (abs(lat) < 1e-4 and abs(lon) < 1e-4):
            return self.active
        gs = rec.get("gs") or 0
        prev, self._prev = self._prev, (t, z, lat, lon, gs)
        jumped = False
        if prev is not None:
            dt = (t - prev[0]) / 1000
            if z is not None and prev[1] is not None:
                dz = (z - prev[1]) % 86400
                if dz < 43200:
                    dt = max(dt, dz)             # sim rate: the sim clock runs faster than the wall
            dt = max(dt, 0.2)
            d = _nm((prev[2], prev[3]), (lat, lon))
            jumped = d > JUMP_MIN_NM and d > JUMP_FACTOR * max(gs, prev[4]) / 3600 * dt + 0.2
        if jumped:
            if not self.active:
                self.active, self._anchor, self._rest = True, (prev[2], prev[3], prev[4] < 1), None
            elif (_nm(self._anchor[:2], (lat, lon)) <= BACK_NM
                  and (gs < 1) == self._anchor[2]):
                self.active, self._anchor, self._rest = False, None, None
                return False
            else:
                self._rest = None
        elif self.active:
            if rec.get("onGround") and gs < 1:
                self._rest = t if self._rest is None else self._rest
                if t - self._rest >= REST_EXIT_MS:
                    self.active, self._anchor, self._rest = False, None, None
                    return False
            else:
                self._rest = None
        return self.active
