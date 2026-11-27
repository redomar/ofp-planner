"""Test: fuel flow from cumulative fuel-used counters (iniBuilds A350). No sim needed."""
import json, os, sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from fuel_rate import FuelRate

fr = FuelRate()
# cruise: 2.43 kg/s total = 8,750 kg/h (the 2026-11-27 A350 reading), 1 Hz samples
out = [fr.add(t, 18512.0 + t * 8750 / 3600) for t in range(0, 40)]
assert all(v is None for v in out[:10]), out[:10]            # needs 10 s before it reports
assert all(abs(v - 8750) < 1 for v in out[10:]), out[10:]
# one late/duplicated tick must not spike it (window average)
fr2 = FuelRate()
for t in range(0, 30):
    v = fr2.add(t, 1000 + t * 2.0 + (5.0 if t == 20 else 0.0))   # a +5 kg blip at t=20
assert abs(v - 7200) < 1, v
# counter restart (engine restart / reload): history cleared, no negative flow
v = fr2.add(30, 3.0)
assert v is None, v
for t in range(31, 45):
    v = fr2.add(t, 3.0 + (t - 30) * 1.0)
assert abs(v - 3600) < 1, v
# engines off: counters stand still -> 0
fr3 = FuelRate()
for t in range(0, 15):
    v = fr3.add(t, 500.0)
assert v == 0.0, v
assert fr3.add(16, None) is None
# the A350 profile names the counters
prof = json.load(open(os.path.join(HERE, "profiles.json"), encoding="utf-8"))["profiles"]
a350 = next(p for p in prof if p["name"] == "iniBuilds A350")
assert a350["fuelUsed"] == ["L:INI_ENG1_FUEL_USED", "L:INI_ENG2_FUEL_USED"]
print("ALL OK")
