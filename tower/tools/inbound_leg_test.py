"""Test: the Fenix IN-BND leg (made-up far-away position after DIR TO) is put where the aircraft was."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import fenix_fms as f


def xml(legs):
    body = "".join(f"<leg><type>{k}</type><displayString>{i}</displayString><via>DCT</via>"
                   f"<latitude>{la}</latitude><longitude>{lo}</longitude></leg>" for i, k, la, lo in legs)
    return f"<plan><cruiseLevel>37000</cruiseLevel><route type='act'>{body}</route></plan>"


def fake(legs):
    return lambda timeout=6.0, names=None: {"aircraft.fms.origin": "LXGB", "aircraft.fms.destination": "GCTS",
                                            "aircraft.fms.flightPlanXml": xml(legs)}


TNR, CBL = ("TNR", "Arinc", 35.734178, -5.919239), ("CBL", "Arinc", 33.420506, -7.606033)
INBND = ("IN-BND", "Inbound", 42.737099, -0.075489)          # real values from 22 Nov 2026
ok = True

f.read_values = fake([("PPOS", "PresentPosition", 35.962133, -5.659373), TNR, CBL]); p = f.read_plan()
f.read_values = fake([INBND, TNR, CBL]); p = f.read_plan()
l0 = p["legs"][0]
print("with PPOS seen:", l0["id"], l0["lat"], l0["lon"], l0.get("positionFrom"), "TNR dist", p["legs"][1]["distNm"])
ok &= (l0["lat"], l0["lon"]) == (35.962133, -5.659373) and p["legs"][1]["distNm"] < 20
f.read_values = fake([TNR, CBL]); p = f.read_plan()                 # TNR passed: IN-BND kept in history
ok &= p["legs"][0]["id"] == "IN-BND" and p["legs"][0]["lat"] == 35.962133

f._constraint_key = None; f._last_ppos = None; f._inbound_fix = None; f._passed = []   # Tower started late
f.read_values = fake([INBND, TNR, CBL]); p = f.read_plan()
print("no PPOS seen:  ", p["legs"][0]["lat"], p["legs"][0]["lon"], p["legs"][0].get("positionFrom"), "TNR dist", p["legs"][1]["distNm"])
_, b_fake = f._gc(TNR[2], TNR[3], INBND[2], INBND[3])            # still on the FMS inbound course line
_, b_new = f._gc(TNR[2], TNR[3], p["legs"][0]["lat"], p["legs"][0]["lon"])
ok &= abs(p["legs"][1]["distNm"] - f.INBOUND_FALLBACK_NM) < 0.5 and abs(b_fake - b_new) < 0.5

f.read_values = fake([("T-P", "Arinc", 36.0, -5.6), TNR, CBL]); p = f.read_plan()    # ordinary legs untouched
ok &= p["legs"][0]["lat"] == 36.0 and "positionFrom" not in p["legs"][0]
print("ALL OK" if ok else "FAILED")
