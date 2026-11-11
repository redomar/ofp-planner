"""Test: a bounced landing records the FIRST (hard) contact as the landing (no sim needed).

A fake sim replays a landing like EDDM->EGBB 11 Nov: hard contact at -780 fpm / 3.07 G,
back in the air for ~1.2 s, then a soft second contact at -120 fpm."""
import glob, json, os, sys, time
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import recorder

T0 = None
TD1, LIFT, TD2 = 2.05, 2.45, 3.65          # seconds after start: contact, bounce, second contact

def state_at(t):
    if t < TD1:
        return dict(onGround=False, vs=-780.0, gear=max(1.0, 60 - 28 * t), g=0.95)
    if t < LIFT:
        x = t - TD1
        return dict(onGround=True, vs=-300.0, gear=0.0, g=1.0 + 2.07 * min(1.0, x / 0.25))   # peak 3.07
    if t < TD2:
        return dict(onGround=False, vs=-120.0, gear=4.0, g=1.1)
    return dict(onGround=True, vs=-20.0, gear=0.0, g=1.05 if t < TD2 + 0.4 else 1.0)

class FakeSm:
    quit = 0
    def exit(self): pass

class FakeVars:
    def __init__(self, sm): self.fresh = 0
    def fetch(self, keys):
        global T0
        if T0 is None: T0 = time.monotonic()
        s = state_at(time.monotonic() - T0)
        val = {"TITLE": b"Bounce Test", "ATC ID": b"TEST", "NUMBER OF ENGINES": 2.0,
               "SIM ON GROUND": float(s["onGround"]), "VERTICAL SPEED": s["vs"],
               "PLANE ALT ABOVE GROUND MINUS CG": s["gear"], "G FORCE": s["g"],
               "PLANE TOUCHDOWN NORMAL VELOCITY": 2.0 if time.monotonic() - T0 > TD2 else 13.0}
        out = {k: val.get(k[0], 0.0) for k in keys}
        self.fresh = len(keys)
        return out

recorder.connect = lambda dll=None: FakeSm()
recorder.Vars = FakeVars
before = set(glob.glob(os.path.join(HERE, "recordings", "*.jsonl")))
sys.argv = ["recorder.py", "--seconds", "7"]
recorder.main()
new = sorted(set(glob.glob(os.path.join(HERE, "recordings", "*.jsonl"))) - before)
rows = [json.loads(l) for l in open(new[-1], encoding="utf-8")][1:]
os.remove(new[-1])

tds = [td for r in rows for td in r.get("touchdowns", [])]
peak = [r["tdPeakG"] for r in rows if "tdPeakG" in r]
first_line = next(r for r in rows if r.get("touchdowns"))
print("touchdowns:", tds)
print("peak G:", peak)
ok = (len(tds) == 2 and tds[0]["n"] == 1 and not tds[0]["bounce"] and tds[0]["landingRate"] == -780
      and tds[1]["n"] == 2 and tds[1]["bounce"] and tds[1]["landingRate"] == -120
      and first_line["landingRate"] == -780 and len(peak) == 1 and peak[0]["n"] == 1 and peak[0]["peakG"] >= 2.9)
print("ALL OK" if ok else "FAILED")
