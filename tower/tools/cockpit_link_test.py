"""Test: cockpit values and MCDU pages over the live link (1.16). No sim, no Fenix needed.

1. Server: a board that connects mid-flight gets probe full:true (all values merged) and the
   last page of each MCDU after the summary and before settings; later changes arrive as
   probe full:false; a new flight keeps the cockpit state; mcdu messages carry no xml.
2. Recorder: with --serve, every probe line and MCDU page written to the file is also published.
"""
import json, os, subprocess, sys, time, types
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import link_server
from websockets.sync.client import connect

ok = True
def check(name, cond, got=""):
    global ok
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else f"   got {got}"))
    ok &= bool(cond)

# ---- 1. server
link_server.SETTINGS_FILE = os.path.join(os.environ.get("TEMP", "."), "cockpit-test-settings.json")
open(link_server.SETTINGS_FILE, "w").write(json.dumps({"type": "relay", "channel": "stream", "msg": {"kind": "settings", "q": "x"}}))
srv = link_server.LinkServer(47896, {"title": "FenixA320", "atcId": "G-ABCD"})
srv.start()
srv.set_plan({"type": "plan", "origin": "EICK", "destination": "EGBB", "flightNumber": "TST123"})
def s(i, **kw):
    r = {"t": 1_800_000_000_000 + i * 1000, "zulu": 80000 + i, "lat": 51.8 + i * 0.001, "lon": -8.5,
         "alt": 500, "gs": 0, "onGround": True, "engines": [True, True]}
    r.update(kw); return r
srv.publish(s(1))
srv.publish_probe({"L:S_FC_FLAPS": 0.0, "L:S_MIP_GEAR": 1.0, "L:I_FCU_AP1": 0.0})
srv.publish_probe({"L:S_FC_FLAPS": 1.0})                    # merged: flaps 1 wins
srv.publish_probe({})                                      # nothing changed: nothing sent
page = {"type": "mcdu", "t": 1, "unit": 1, "title": "CRZ", "text": ["gCRZ", "sACT MODE   UTC DEST wEFOBw"],
        "xml": "<root/>", "zulu": 80001}
srv.publish_mcdu(page)
srv.publish_mcdu({**page, "unit": 2, "title": "FROM TST123", "text": ["sFROMl  sTST123l"]})
srv.publish_mcdu({**page, "unit": 3})                      # not an MCDU: ignored
time.sleep(0.3)
with connect("ws://127.0.0.1:47896", origin="https://plans.massorbit.co.uk") as ws:
    first = [json.loads(ws.recv(timeout=2)) for _ in range(8)]
    kinds = [m.get("type") for m in first]
    check("connect order", kinds == ["hello", "plan", "track", "summary", "probe", "mcdu", "mcdu", "relay"], kinds)
    pf = first[4]
    check("probe full merged", pf.get("full") is True and pf["v"] == {"L:S_FC_FLAPS": 1.0, "L:S_MIP_GEAR": 1.0, "L:I_FCU_AP1": 0.0}, pf)
    m1, m2 = first[5], first[6]
    check("mcdu per unit, codes kept, no xml", m1["unit"] == 1 and m2["unit"] == 2 and m1["text"][0] == "gCRZ"
          and "xml" not in m1 and set(m1) == {"type", "unit", "title", "text", "zulu"}, (m1, m2))
    srv.publish_probe({"L:S_MIP_GEAR": 0.0})
    srv.publish_mcdu({**page, "title": "DES", "text": ["DES"]})
    got = []
    end = time.time() + 1.5
    while time.time() < end:
        try: got.append(json.loads(ws.recv(timeout=0.3)))
        except TimeoutError: pass
    live = [m for m in got if m.get("type") in ("probe", "mcdu")]
    check("later change is probe full:false", any(m.get("type") == "probe" and m.get("full") is False
          and m["v"] == {"L:S_MIP_GEAR": 0.0} for m in live), live)
    check("later page arrives", any(m.get("type") == "mcdu" and m["title"] == "DES" for m in live), live)
# new flight (route change on the ground resets the track): cockpit state stays
srv.set_plan({"type": "plan", "origin": "EGBB", "destination": "EICK", "flightNumber": "TST124"})
time.sleep(0.2)
with connect("ws://127.0.0.1:47896", origin="https://plans.massorbit.co.uk") as ws:
    msgs = [json.loads(ws.recv(timeout=2)) for _ in range(6)]
    pf = next((m for m in msgs if m.get("type") == "probe"), None)
    check("new flight keeps cockpit state", pf and pf["v"]["L:S_MIP_GEAR"] == 0.0 and pf["v"]["L:S_FC_FLAPS"] == 1.0, msgs)
    mc = [m for m in msgs if m.get("type") == "mcdu"]
    check("late joiner gets the newest page", any(m["unit"] == 1 and m["title"] == "DES" for m in mc), mc)
srv.stop()
os.remove(link_server.SETTINGS_FILE)

# ---- 2. recorder publishes what it writes
import recorder, fenix_fms, probe
T0 = time.time()
class FakeVars:
    def __init__(self, sm): self.fresh = True
    def fetch(self, keys):
        el = time.time() - T0
        out = {}
        for k in keys:
            n = k[0]
            if n == "TITLE": out[k] = b"FenixA320 test"
            elif n == "ATC ID": out[k] = b"TEST1"
            elif n == "NUMBER OF ENGINES": out[k] = 2
            elif n == "PLANE LATITUDE": out[k] = 51.15
            elif n == "PLANE LONGITUDE": out[k] = -0.19
            elif n == "ZULU TIME": out[k] = 75600.0 + el
            elif n == "SIM ON GROUND": out[k] = 1
            elif n == "L:S_OH_EXT_LT_STROBE": out[k] = 2 if el > 6 else 0
            else: out[k] = 0
        return out
recorder.connect = lambda dll=None: types.SimpleNamespace(quit=0)
recorder.Vars = FakeVars
fenix_fms.read_plan = lambda: None
fenix_fms.read_values = lambda timeout=6.0, names=None: {"aircraft.mcdu1.display": "<root><title>gCRZ</title><line>sA</line></root>",
                                                         "aircraft.mcdu2.display": None}
_orig = probe.start_mcdu_thread
probe.start_mcdu_thread = lambda q: _orig(q, every=0.5)
pub = {"probe": [], "mcdu": []}
class FakeLink:
    def __init__(self, port, hello): pass
    def start(self): pass
    def stop(self): pass
    def set_plan(self, p): return False
    def publish(self, rec): pass
    def publish_probe(self, v): pub["probe"].append(v)
    def publish_mcdu(self, p): pub["mcdu"].append(p)
link_server.LinkServer = FakeLink
before = set(os.listdir(os.path.join(HERE, "recordings")))
sys.argv = ["recorder.py", "--seconds", "12", "--serve", "--port", "47895"]
recorder.main()
new = sorted(set(os.listdir(os.path.join(HERE, "recordings"))) - before)
path = os.path.join(HERE, "recordings", new[-1])
lines = [json.loads(l) for l in open(path, encoding="utf-8")]
filed_probe = [l["v"] for l in lines if l.get("type") == "probe"]
filed_mcdu = [l for l in lines if l.get("type") == "mcdu"]
check("every probe line published", filed_probe and pub["probe"] == filed_probe, (len(filed_probe), len(pub["probe"])))
check("every mcdu page published, with zulu and codes", len(pub["mcdu"]) == len(filed_mcdu) >= 1
      and pub["mcdu"][0]["text"][0] == "gCRZ" and pub["mcdu"][0].get("zulu"), pub["mcdu"][:1])
check("page title cleaned", filed_mcdu and filed_mcdu[0]["title"] == "CRZ", filed_mcdu[:1])
os.remove(path)
print("ALL OK" if ok else "FAILED")
