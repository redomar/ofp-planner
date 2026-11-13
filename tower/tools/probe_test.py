"""Test: probe and MCDU lines in a recording (no sim, no Fenix needed).

Runs recorder.main() against a fake SimConnect (a strobe light switching on, an unknown
L:var staying 0) and a fake Fenix gateway (MCDU1 on INIT, then FUEL PRED with changing
figures), then checks the file and runs analyse_flight.py and probe_report.py on it.
"""
import json, os, subprocess, sys, time, types
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import recorder, fenix_fms, probe

T_START = time.time()
class FakeVars:
    def __init__(self, sm): self.fresh = True
    def fetch(self, keys):
        el = time.time() - T_START
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
            elif n == "LIGHT STROBE": out[k] = 1 if el > 6 else 0
            elif n == "L:S_OH_EXT_LT_STROBE": out[k] = 2 if el > 6 else 0
            else: out[k] = 0
        return out

recorder.connect = lambda dll=None: types.SimpleNamespace(quit=0)
recorder.Vars = FakeVars
fenix_fms.read_plan = lambda: {"type": "plan", "origin": "EGKK", "destination": "EICK", "flightNumber": "T1",
                               "legs": [{"id": "A", "lat": 51, "lon": -1}, {"id": "B", "lat": 51, "lon": -2}],
                               "active": {"from": 0, "to": 1}}

def disp(title, fob):
    return f"<mcdu><row>{title}</row><row>FOB {fob}</row></mcdu>"
def fake_values(timeout=6.0, names=None):
    el = time.time() - T_START
    if el < 3: return {"aircraft.mcdu1.display": disp("INIT", "-"), "aircraft.mcdu2.display": disp("F-PLN", "-")}
    return {"aircraft.mcdu1.display": disp("FUEL PRED", round(7.5 - el / 100, 2)),
            "aircraft.mcdu2.display": disp("F-PLN", "-")}
fenix_fms.read_values = fake_values
probe.MCDU_SAME_PAGE_S = 3.0          # quick re-capture of a page whose figures change
_orig = probe.start_mcdu_thread
recorder_probe_start = lambda q: _orig(q, every=0.5)
sys.modules["probe"].start_mcdu_thread = recorder_probe_start

before = set(os.listdir(os.path.join(HERE, "recordings")))
sys.argv = ["recorder.py", "--seconds", "12"]
recorder.main()
new = sorted(set(os.listdir(os.path.join(HERE, "recordings"))) - before)
path = os.path.join(HERE, "recordings", new[-1])
lines = [json.loads(l) for l in open(path, encoding="utf-8")]
probes = [l for l in lines if l.get("type") == "probe"]
pages = [l for l in lines if l.get("type") == "mcdu"]
ok = True
def check(name, cond, got=""):
    global ok
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else f"   got {got}"))
    ok &= bool(cond)
check("12 samples", sum(1 for l in lines if l.get("type") is None and "lat" in l) == 12)
check("first probe has every var", len(probes[0]["v"]) == len(probe.PROBE_VARS), len(probes[0]["v"]))
check("later probes only changes", any(set(p["v"]) == {"LIGHT STROBE", "L:S_OH_EXT_LT_STROBE"} for p in probes[1:]),
      [p["v"] for p in probes[1:]])
check("probe every 5 s", len(probes) <= 3, len(probes))
titles = [(p["unit"], p["title"]) for p in pages]
check("pages: INIT, F-PLN, FUEL PRED", (1, "INIT") in titles and (2, "F-PLN") in titles and (1, "FUEL PRED") in titles, titles)
check("same page not every read", titles.count((2, "F-PLN")) == 1, titles)
check("changing page re-captured, throttled", 2 <= titles.count((1, "FUEL PRED")) <= 4, titles)
check("page lines have zulu", all("zulu" in p for p in pages))
a = subprocess.run([sys.executable, os.path.join(HERE, "tools", "analyse_flight.py"), path], capture_output=True, text=True)
check("analyse_flight ignores probe lines", a.returncode == 0 and "samples=12" in a.stdout, a.stderr[-300:])
r = subprocess.run([sys.executable, os.path.join(HERE, "tools", "probe_report.py"), path], capture_output=True, text=True)
check("probe_report shows the strobe moving", r.returncode == 0 and "LIGHT STROBE  (1 changes)" in r.stdout
      and "FUEL PRED" in r.stdout, r.stdout[-800:] + r.stderr[-300:])
os.remove(path)
print("ALL OK" if ok else "FAILED")
