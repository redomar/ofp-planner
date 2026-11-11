"""Test: waypoints the Fenix drops are kept as 'passed' (no sim needed)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import fenix_fms as f

ROUTE = [("EDDM26L", 48.34, 11.75), ("AAA", 48.5, 10.0), ("BBB", 49.0, 8.0), ("CCC", 50.0, 6.0),
         ("DDD", 51.0, 3.0), ("EGBB33", 52.45, -1.74)]

def xml(legs):
    body = "".join(f"<leg><displayString>{i}</displayString><via>DCT</via><ETA>1500</ETA>"
                   f"<latitude>{la}</latitude><longitude>{lo}</longitude><type>Arinc</type></leg>" for i, la, lo in legs)
    return (f"<fms><cruiseLevel>34000</cruiseLevel><routeData><route type='act'><origin>EDDM</origin>"
            f"<destination>EGBB</destination><legs>{body}</legs></route></routeData></fms>")

def fake(legs, origin="EDDM"):
    return lambda: {"aircraft.fms.origin": origin, "aircraft.fms.destination": "EGBB",
                    "aircraft.fms.flightPlanXml": xml(legs), "aircraft.fms.flightPhase": "Cruise"}

def show(tag, p):
    print(f"{tag:28} legs={[l['id'] + ('*' if l.get('passed') else '') for l in p['legs']]} "
          f"active={p['active']} historyComplete={p['historyComplete']}")

ok = True
for step, cut in enumerate([0, 0, 2, 3, 3]):
    f.read_values = fake(ROUTE[cut:])
    p = f.read_plan()
    show(f"read {step + 1}: Fenix starts at {ROUTE[cut][0]}", p)
    ok &= [l["id"] for l in p["legs"]] == [r[0] for r in ROUTE]
    ok &= p["active"]["from"] == cut and p["legs"][p["active"]["from"]]["id"] == ROUTE[cut][0]
    ok &= all(l.get("passed") for l in p["legs"][:cut]) and not any(l.get("passed") for l in p["legs"][cut:])
    ok &= p["historyComplete"] is True

f.read_values = fake([("X1", 40, 0), ("X2", 41, 0)], origin="LFPG")    # a different flight
p = f.read_plan(); show("new flight LFPG", p)
ok &= p["active"]["from"] == 0 and not any(l.get("passed") for l in p["legs"])

f._constraint_key = None                                                  # OFP Tower started mid-flight
f.read_values = fake(ROUTE[3:])
p = f.read_plan(); show("started mid-flight at CCC", p)
ok &= p["historyComplete"] is False and p["active"]["from"] == 0
print("ALL OK" if ok else "FAILED")
