"""Fuel flow from cumulative fuel-used counters, for aircraft whose standard ENG FUEL FLOW SimVars
read 0 (iniBuilds A350: L:INI_ENG1/2_FUEL_USED, kg since engine start).

FuelRate.add(t_s, used_kg) returns kg/h over a sliding window (default 30 s), or None while the
window is shorter than min_span_s. A counter that goes down (engine restart, aircraft reload)
clears the history so the drop never shows up as a negative or huge flow.
"""
from collections import deque

RESTART_DROP_KG = 50.0      # a fall bigger than this = the counter restarted (not read jitter)


class FuelRate:
    def __init__(self, window_s=30.0, min_span_s=10.0):
        self.window_s, self.min_span_s = window_s, min_span_s
        self._pts = deque()

    def reset(self):
        self._pts.clear()

    def add(self, t_s, used_kg):
        if used_kg is None:
            return None
        if self._pts and (used_kg < self._pts[-1][1] - RESTART_DROP_KG or t_s <= self._pts[-1][0]):
            self.reset()                       # counter restarted, or the clock went backwards
        if self._pts and used_kg < self._pts[-1][1]:
            return self._rate(t_s, self._pts[-1][1])   # small dip (read jitter): skip the point
        self._pts.append((t_s, used_kg))
        return self._rate(t_s, used_kg)

    def _rate(self, t_s, used_kg):
        while self._pts and t_s - self._pts[0][0] > self.window_s:
            self._pts.popleft()
        t0, u0 = self._pts[0]
        span = t_s - t0
        if span < self.min_span_s:
            return None
        return max(0.0, (used_kg - u0) / span * 3600.0)
