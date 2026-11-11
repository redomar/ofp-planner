"""Test: the flown-path backlog ("track" message) - decimation, resets, and order on connect.

    python tools\track_test.py                 synthetic checks only (no sim needed)
    python tools\track_test.py <recording>     also replays a recording and prints the point count
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from link_server import LinkServer, TrackLog
from websockets.sync.client import connect

ok = True
def check(name, cond, extra=""):
    global ok
    ok &= bool(cond)
    print(("PASS " if cond else "FAIL ") + name, extra)

def fix(z, lat, lon, alt=35000, gs=400, ground=False):
    return {"zulu": z, "lat": lat, "lon": lon, "alt": alt, "gs": gs, "onGround": ground}

# 1. decimation: straight cruise at 400 kt for 10 min, 1 Hz -> a point about every 2 nm (18 s)
t = TrackLog()
lon = -0.2
for s in range(600):
    t.add(fix(75600 + s, 51.15, lon))
    lon -= 400 / 3600 / 60 / 0.627    # 400 kt west at lat 51
n = len(t.points)
check("cruise decimation ~2 nm", 28 <= n <= 40, f"({n} points for 66 nm)")

# 2. parked: only one point
t = TrackLog()
for s in range(300):
    t.add(fix(70000 + s, 51.15, -0.19, alt=200, gs=0, ground=True))
check("parked keeps one point", len(t.points) == 1)

# 3. null island ignored
t = TrackLog()
t.add(fix(70000, 0.0, 0.0))
check("0,0 ignored", t.message() is None)

# 4. new route resets; same route does not
t = TrackLog()
t.note_route("EGKK", "EICK")
t.add(fix(70000, 51.15, -0.19))
t.note_route("EGKK", "EICK")
check("same route keeps track", len(t.points) == 1)
t.note_route("EICK", "EGKK")
check("new route resets track", len(t.points) == 0)

# 5. land, taxi, take off again -> reset at the second take-off only
t = TrackLog()
t.add(fix(70000, 51.0, -1.0))
t.add(fix(70060, 51.0, -1.2))
t.add(fix(70100, 51.0, -1.3, alt=300, gs=130, ground=True))     # touchdown
t.add(fix(70200, 51.0, -1.31, alt=300, gs=15, ground=True))     # taxi
before = len(t.points)
t.add(fix(73000, 51.0, -1.31, alt=300, gs=150, ground=False))   # next take-off
check("landing keeps track", before >= 3, f"({before})")
check("next take-off resets", len(t.points) == 1)

# 6. order on connect: hello, plan, track, then samples; track content matches
srv = LinkServer(47899, {"title": "test"})
srv._settings_file = os.path.join(os.environ.get("TEMP", "."), "track_test_settings.json")
srv._settings_msg = None
srv.start()
srv.set_plan({"type": "plan", "origin": "EGKK", "destination": "EICK", "legs": []})
lon = -0.2
for s in range(120):
    srv.publish(fix(75600 + s, 51.15, lon))
    lon -= 0.003
time.sleep(0.3)
kinds = []
with connect("ws://127.0.0.1:47899", additional_headers={"Origin": "http://localhost:8765"}, open_timeout=5) as ws:
    for s in range(3):                 # live samples keep coming once a second
        time.sleep(0.3)
        srv.publish(fix(75720 + s, 51.15, lon))
    end = time.time() + 2
    track = None
    while time.time() < end:
        try:
            o = json.loads(ws.recv(timeout=0.5))
        except TimeoutError:
            break
        kinds.append(o["type"])
        if o["type"] == "track":
            track = o
first = [k for k in kinds if k != "sample"][:3]
check("order hello, plan, track", first == ["hello", "plan", "track"], str(kinds[:5]))
check("track before first sample", "sample" in kinds and kinds.index("track") < kinds.index("sample"))
check("track points shape", track and all(len(p) == 4 for p in track["points"]),
      f"({len(track['points']) if track else 0} points, {len(json.dumps(track)) if track else 0} bytes)")
srv.stop()

# 7. optional: replay a real recording
if len(sys.argv) > 1:
    t = TrackLog()
    raw = 0
    with open(sys.argv[1], encoding="utf-8") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if "lat" in rec:
                raw += 1
                t.add(rec)
    msg = t.message() or ""
    print(f"replay: {raw} samples -> {len(t.points)} points, {len(msg)} bytes")

print("ALL OK" if ok else "FAILED")
