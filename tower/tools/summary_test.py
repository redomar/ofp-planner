"""Test: the live flight summary (summary.py) and its place in the link (no sim needed).

python tools/summary_test.py [recording.jsonl]
  synthetic: normal flight, bounce + peak G, touch-and-go, new flight after a turnaround,
             diversion keeps the flight, route change on the ground resets, 0,0 ignored,
             connect order hello -> plan -> track -> summary -> settings, throttling.
  recording: replays samples + plan lines through FlightSummary and prints the result.
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from summary import FlightSummary
import link_server

fails = []
def check(name, cond, got=None):
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else f"   got {got}"))
    if not cond:
        fails.append(name)

T0 = 1_800_000_000_000
def s(i, **kw):
    r = {"t": T0 + i * 1000, "zulu": 64800 + i, "lat": 47.0 + i * 0.001, "lon": 19.0, "alt": 500, "pressAlt": 500,
         "gs": 0, "vs": 0, "onGround": True, "engines": [True, True], "fobKg": 7500 - i * 0.5, "ffKgH": 600}
    r.update(kw)
    return r

def fly(fs, start, end, alt=34000, gs=440, ff=2400):
    for i in range(start, end):
        fs.add(s(i, onGround=False, alt=alt, pressAlt=alt, agl=alt, gs=gs, ffKgH=ff))

PLAN = {"origin": "LHBP", "destination": "LIMC", "flightNumber": "WMT5PL", "originRunway": "13L", "destinationRunway": "35R"}

# --- normal flight with a bounce
fs = FlightSummary({"title": "FenixA320 IAE WF", "atcId": "G-ABCD"})
fs.add(s(0, lat=0.0, lon=0.0))                        # sim loading: ignored
fs.note_plan(PLAN)
fs.add(s(1)); fs.add(s(2, gs=5))                       # out at 2
fs.add(s(3, gs=150))
fly(fs, 4, 200)
fs.note_plan({**PLAN, "destinationRunway": "35L"})     # runway change in descent
fs.add(s(200, gs=140, touchdowns=[{"n": 1, "landingRate": -600, "tdSim": -511}], landingRate=-600, tdSim=-511))
fs.add(s(201, gs=138, onGround=False, agl=11))               # bounce: airborne below 200 ft (tdCount not reset)
fs.add(s(202, gs=136, touchdowns=[{"n": 2, "bounce": True, "landingRate": -70, "tdSim": -104}], landingRate=-70))
fs.add(s(203, gs=120, tdPeakG={"n": 1, "peakG": 1.59}))
for i in range(204, 300): fs.add(s(i, gs=20))
for i in range(300, 330): fs.add(s(i, gs=0))           # comes to rest at 300
fs.add(s(330, gs=0, engines=[False, True]))
fs.add(s(331, gs=0, engines=[False, False]))           # in
d = fs.data()
check("flight", d["flight"] == {"origin": "LHBP", "destination": "LIMC", "flightNumber": "WMT5PL",
                                "callsign": None, "reg": "G-ABCD", "aircraft": "A320"}, d["flight"])
check("times", d["times"] == {"out": T0 + 2000, "off": T0 + 4000, "on": T0 + 200000, "in": T0 + 300000}, d["times"])
check("runways", d["runways"] == {"departure": "13L", "arrival": "35L"}, d["runways"])
check("landing", d["landing"] == {"fpm": -600, "tdSim": -511, "peakG": 1.59, "bounces": 1}, d["landing"])
check("max alt/gs", d["maxAltFt"] == 34000 and d["maxGsKt"] == 440, (d["maxAltFt"], d["maxGsKt"]))
check("distance", d["distanceNm"] == 12, d["distanceNm"])  # 196 s of 0.001 deg lat + the bounce second
check("fuel", d["fuel"]["offKg"] == 7498 and d["fuel"]["onKg"] == 7400 and d["fuel"]["tripKg"] == 98
      and d["fuel"]["cruiseFfKgH"] == 2400, d["fuel"])
check("complete", d["complete"] is True)

# --- touch-and-go keeps the flight; the real landing later wins
fs = FlightSummary(); fs.note_plan(PLAN)
fs.add(s(0, gs=5)); fly(fs, 1, 50)
fs.add(s(50, gs=130, touchdowns=[{"n": 1, "landingRate": -300}]))
fs.add(s(51, gs=130))
fly(fs, 52, 100)
fs.add(s(100, gs=130, touchdowns=[{"n": 1, "landingRate": -150}]))
d = fs.data()
check("touch-and-go keeps off", d["times"]["off"] == T0 + 1000, d["times"])
check("last landing wins", d["times"]["on"] == T0 + 100000 and d["landing"]["fpm"] == -150, d["landing"])

# --- new flight after a turnaround (stopped > 1 min, then takes off again)
for i in range(101, 200): fs.add(s(i, gs=0))
fs.add(s(200, gs=5)); fs.add(s(201, gs=150)); fly(fs, 202, 210)
d = fs.data()
check("turnaround = new flight", d["times"]["off"] == T0 + 202000 and d["times"]["on"] is None
      and d["landing"]["fpm"] is None, d["times"])

# --- diversion keeps the flight; a route change on the ground resets it
fs = FlightSummary(); fs.note_plan(PLAN)
fs.add(s(0, gs=5)); fly(fs, 1, 20)
fs.note_plan({**PLAN, "destination": "LIML"})
d = fs.data()
check("diversion keeps", d["times"]["off"] == T0 + 1000 and d["flight"]["destination"] == "LIML", d)
fs.add(s(20, gs=130, touchdowns=[{"n": 1, "landingRate": -200}]))
for i in range(21, 100): fs.add(s(i, gs=0))
fs.add(s(100, gs=0, engines=[False, False]))
fs.note_plan({**PLAN, "origin": "LIML", "destination": "LHBP"})
d = fs.data()
check("route change on ground resets", d["times"]["off"] is None and d["flight"]["origin"] == "LIML", d["times"])

# --- link: connect order and throttling
from websockets.sync.client import connect
link_server.SETTINGS_FILE = os.path.join(os.environ.get("TEMP", "."), "summary-test-settings.json")
open(link_server.SETTINGS_FILE, "w").write(json.dumps({"type": "relay", "channel": "stream", "msg": {"kind": "settings", "q": "x"}}))
srv = link_server.LinkServer(47897, {"title": "FenixA320", "atcId": "G-ABCD"})
srv.start()
srv.set_plan({"type": "plan", **PLAN})
srv.publish(s(1)); srv.publish(s(2, gs=5)); srv.publish(s(3, gs=150))
for i in range(4, 8): srv.publish(s(i, onGround=False, alt=1000 + i * 500, pressAlt=1000 + i * 500, gs=160))
time.sleep(0.3)
with connect("ws://127.0.0.1:47897", origin="https://plans.massorbit.co.uk") as ws:
    kinds = []
    for _ in range(5):
        kinds.append(json.loads(ws.recv(timeout=2)).get("type"))
    check("connect order", kinds == ["hello", "plan", "track", "summary", "relay"], kinds)
    got = []
    for i in range(8, 14):                               # climbing: running figures only -> throttled
        srv.publish(s(i, onGround=False, alt=5000 + i * 500, pressAlt=5000 + i * 500, gs=170))
    srv.publish(s(14, gs=140, touchdowns=[{"n": 1, "landingRate": -250}]))   # event -> at once
    end = time.time() + 1.5
    while time.time() < end:
        try:
            m = json.loads(ws.recv(timeout=0.3))
        except TimeoutError:
            continue
        if m.get("type") == "summary":
            got.append(m)
    check("throttled to the event", len(got) == 1 and got[0]["landing"]["fpm"] == -250, [g["landing"] for g in got])
srv.stop()
os.remove(link_server.SETTINGS_FILE)

# --- optional: replay a real recording
if len(sys.argv) > 1:
    fs, hello = FlightSummary(), None
    for line in open(sys.argv[1], encoding="utf-8"):
        o = json.loads(line)
        if o.get("kind") == "ofp-recording":
            fs = FlightSummary(o)
        elif o.get("type") == "plan":
            fs.note_plan(o)
        elif "t" in o and "lat" in o:
            fs.add(o)
    d = fs.data()
    from datetime import datetime, timezone
    hm = lambda v: datetime.fromtimestamp(v / 1000, timezone.utc).strftime("%H:%M:%SZ") if v else None
    print("\nREPLAY", os.path.basename(sys.argv[1]))
    print(" ", {k: hm(v) for k, v in d["times"].items()})
    print(" ", json.dumps({k: v for k, v in d.items() if k != "times"}))

print("ALL OK" if not fails else f"FAILED: {fails}")
