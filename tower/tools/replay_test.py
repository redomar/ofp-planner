"""Test: the sim's replay is left out of the flight (replay.py, summary, track). No sim needed.

python tools/replay_test.py [recording.jsonl ...]
  synthetic: a flight lands and shuts down; a replay jumps into the air, touches down twice and
             jumps across the map; the summary and track keep the real flight. Jumping back ends it;
             so does 2 minutes still on the ground. Time compression (sim rate x8) is not a replay.
  recordings: counts samples flagged as replay and prints the summary with them left out.
"""
import json, os, sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from replay import ReplayGuard
from summary import FlightSummary
from link_server import TrackLog

fails = []
def check(name, cond, got=None):
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else f"   got {got}"))
    if not cond: fails.append(name)

T0 = 1_800_000_000_000
def s(i, lat, lon, **kw):
    r = {"t": T0 + i * 1000, "zulu": 50000 + i, "lat": lat, "lon": lon, "alt": 200, "pressAlt": 200,
         "gs": 0, "vs": 0, "onGround": True, "engines": [True, True], "fobKg": 5000 - i * 0.1, "ffKgH": 600}
    r.update(kw); return r

g, fs, tr = ReplayGuard(), FlightSummary({"atcId": "G-ABCD"}), TrackLog()
fs.note_plan({"origin": "EKCH", "destination": "BIKF", "flightNumber": "TST123"})
flags = []
def feed(r):
    if g.check(r): r["replay"] = True
    flags.append(bool(r.get("replay")))
    fs.add(r); tr.add(r)

lat, lon, i = 64.0, -22.0, 0
feed(s(i, lat, lon)); i += 1
for k in range(30):                                   # take-off roll 0 -> 145 kt
    lon -= k * 5 / 3600 / 60 / 0.44                   # nm -> deg lon at 64N
    feed(s(i, lat, lon, gs=k * 5)); i += 1
for k in range(200):                                  # fly east->west at 300 kt (0.083 nm/s)
    lon -= 0.003
    feed(s(i, lat, lon, onGround=False, alt=10000, pressAlt=10000, agl=10000, gs=300)); i += 1
feed(s(i, lat, lon, gs=130, touchdowns=[{"n": 1, "landingRate": -96, "tdSim": -74}])); i += 1
for k in range(40):
    feed(s(i, lat, lon, gs=max(0, 120 - k * 4))); i += 1
stand = (lat, lon)
for k in range(30):
    feed(s(i, lat, lon, gs=0)); i += 1
feed(s(i, lat, lon, gs=0, engines=[False, False])); i += 1
before = fs.data(); track_before = len(tr.points)
check("real flight complete before replay", before["complete"] and before["landing"]["fpm"] == -96, before["times"])

# replay: jump 11 nm into the air at 0 kt, fly, touch down twice, jump 850 nm away, land again
feed(s(i, lat - 0.12, lon - 0.3, onGround=False, alt=4500, gs=0, engines=[False, False])); i += 1
for k in range(20):
    feed(s(i, lat - 0.12, lon - 0.3 + k * 0.002, onGround=False, alt=2000, gs=125)); i += 1
feed(s(i, lat, lon - 0.25, gs=122, touchdowns=[{"n": 1, "landingRate": -142, "tdSim": -116}])); i += 1
feed(s(i, lat, lon - 0.248, onGround=False, alt=300, agl=300, gs=125)); i += 1
feed(s(i, 51.8, -8.48, onGround=False, alt=700, gs=114)); i += 1          # 850 nm jump
for k in range(10):
    feed(s(i, 51.8 + k * 0.0005, -8.48, onGround=False, alt=600 - k * 50, gs=120)); i += 1
feed(s(i, 51.806, -8.48, gs=118, touchdowns=[{"n": 1, "landingRate": -300}])); i += 1
after = fs.data()
check("replay samples flagged", sum(flags[-34:]) == 34, flags[-34:])
check("summary keeps the real flight", after == before, (after["times"], after["landing"]))
check("track keeps the real flight", len(tr.points) == track_before, len(tr.points))
feed(s(i, *stand, gs=0, engines=[False, False])); i += 1                  # replay ends: back at the stand
check("jump back ends the replay", flags[-1] is False and not g.active, flags[-1])
check("still the real flight", fs.data() == before)

# ends after 2 min still on the ground (a reposition to a new gate, no jump back)
g2 = ReplayGuard(); r0 = s(0, 55.6, 12.6)
g2.check(r0); g2.check(s(1, 51.0, -1.0))
check("reposition starts as replay", g2.active)
for k in range(2, 125): last = g2.check(s(k, 51.0, -1.0))
check("2 min still on the ground ends it", last is False and not g2.active)

# sim rate x8 in cruise: 480 kt covers 1.07 nm per wall second, 8 sim seconds -> not a jump
g3 = ReplayGuard(); lo = 0.0; hits = 0
for k in range(100):
    lo += 480 / 3600 * 8 / 60
    hits += g3.check({"t": T0 + k * 1000, "zulu": 40000 + k * 8, "lat": 52.0, "lon": lo, "gs": 480, "onGround": False})
check("time compression is not a replay", hits == 0, hits)

# a normal touch-and-go is not a replay
g4 = ReplayGuard(); hits = 0
for k in range(60):
    hits += g4.check({"t": T0 + k * 1000, "zulu": k, "lat": 52.0 + k * 130 / 3600 / 60, "lon": 0.0,
                      "gs": 130, "onGround": 20 <= k < 30})
check("touch-and-go is not a replay", hits == 0, hits)

for path in sys.argv[1:]:
    g, fs, n, nr = ReplayGuard(), FlightSummary(), 0, 0
    for line in open(path, encoding="utf-8"):
        o = json.loads(line)
        if o.get("kind") == "ofp-recording": fs = FlightSummary(o)
        elif o.get("type") == "plan": fs.note_plan(o)
        elif o.get("type") is None and "lat" in o:
            n += 1
            if g.check(o) or o.get("replay"): o["replay"] = True; nr += 1
            fs.add(o)
    d = fs.data()
    from datetime import datetime, timezone
    hm = lambda v: datetime.fromtimestamp(v / 1000, timezone.utc).strftime("%H:%M") if v else None
    print(f"\n{os.path.basename(path)}: {nr}/{n} samples are replay")
    print("  ", {k: hm(v) for k, v in d["times"].items()}, d["landing"], d["distanceNm"], "nm, complete", d["complete"])

print("ALL OK" if not fails else f"FAILED: {fails}")
