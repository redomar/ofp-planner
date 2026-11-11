"""Test: changed MCDU plans are written into the recording as "plan" lines (no sim needed).

Runs recorder.main() against a fake SimConnect and a fake Fenix plan reader, with --serve,
then checks the file: header, plan lines between samples, unchanged plans not repeated,
and that analyse_flight.py reads it.
"""
import json, os, subprocess, sys, time, types
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import recorder, fenix_fms

# --- fake sim: everything 0 except a position; TITLE says Fenix so the plan thread starts
class FakeVars:
    def __init__(self, sm): self.fresh = True
    def fetch(self, keys):
        out = {}
        for k in keys:
            name = k[0]
            if name == "TITLE": out[k] = b"FenixA319 test"
            elif name == "ATC ID": out[k] = b"TEST1"
            elif name == "NUMBER OF ENGINES": out[k] = 2
            elif name == "PLANE LATITUDE": out[k] = 51.15
            elif name == "PLANE LONGITUDE": out[k] = -0.19
            elif name == "ZULU TIME": out[k] = 75600.0 + time.time() % 100
            elif name == "SIM ON GROUND": out[k] = 1
            else: out[k] = 0
        return out

recorder.connect = lambda dll=None: types.SimpleNamespace(quit=0)
recorder.Vars = FakeVars

# --- fake Fenix plan: changes twice (active waypoint moves), otherwise identical
calls = {"n": 0}
def fake_plan():
    calls["n"] += 1
    step = 0 if calls["n"] < 3 else (1 if calls["n"] < 5 else 2)
    legs = [{"id": i, "lat": 51.0, "lon": -1.0 - n, "eta": f"21:{n:02d}"} for n, i in enumerate(["A", "B", "C", "EICK34"])]
    legs.append({"id": "CK030", "lat": 51.9, "lon": -8.5, "missed": True})
    return {"type": "plan", "origin": "EGKK", "destination": "EICK", "flightNumber": "TEST1",
            "legs": legs, "active": {"from": step, "to": step + 1}}
fenix_fms.read_plan = fake_plan
_orig_thread = recorder.start_fenix_plan_thread
recorder.start_fenix_plan_thread = lambda link, plan_q=None: _orig_thread(link, every=0.4, plan_q=plan_q)

before = set(os.listdir(os.path.join(HERE, "recordings")))
sys.argv = ["recorder.py", "--serve", "--port", "47898", "--seconds", "6"]
recorder.main()
new = sorted(set(os.listdir(os.path.join(HERE, "recordings"))) - before)
path = os.path.join(HERE, "recordings", new[-1])
lines = [json.loads(l) for l in open(path, encoding="utf-8")]
kinds = ["header" if l.get("kind") == "ofp-recording" else l.get("type", "sample") for l in lines]
print("lines:", kinds)
plans = [l for l in lines if l.get("type") == "plan"]
ok = kinds[0] == "header" and kinds.count("sample") == 6
ok &= len(plans) == 3                                  # 3 distinct plans, repeats not written
ok &= [p["active"]["to"] for p in plans] == [1, 2, 3]
ok &= all("zulu" in p and "t" in p for p in plans)
out = subprocess.run([sys.executable, os.path.join(HERE, "tools", "analyse_flight.py"), path],
                     capture_output=True, text=True)
print(out.stdout[out.stdout.find("MCDU PLAN"):])
ok &= out.returncode == 0 and out.stdout.count("EGKK->EICK") == 3
os.remove(path)                                         # test file, not a real flight
print("ALL OK" if ok else "FAILED", out.stderr[-500:] if out.returncode else "")
