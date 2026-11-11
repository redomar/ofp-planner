"""Test: MCDU entries with no real position (0,0 / out of range) never reach the board (no sim needed)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import fenix_fms as f

def leg(ident, lat, lon):
    return (f"<leg><displayString>{ident}</displayString><via>DCT</via>"
            f"<latitude>{lat}</latitude><longitude>{lon}</longitude><type>Arinc</type></leg>")

xml = ("<fms><cruiseLevel>34000</cruiseLevel><routeData><route type='act'><origin>EDDM</origin>"
       "<destination>EGBB</destination><legs>"
       + leg("EDDM", 0, 0)                 # origin before a runway is chosen
       + leg("LIM", 0.0, 0.0)              # a typed entry the FMS hasn't resolved
       + leg("(LIM)", 48.6, 10.9)          # pseudo waypoint WITH a position: a real point, kept
       + leg("ERNAS", 48.70, 10.95)
       + leg("BAD", 95, 200)               # out of range
       + leg("NULLISH", 0.00001, -0.00002)
       + leg("EQUATOR", 0, 9.5)            # a real place on the equator: kept
       + leg("EGBB33", 52.45, -1.74)
       + "</legs></route></routeData></fms>")
cruise, legs = f.parse_plan_xml(xml, "EGBB")
ids = [l["id"] for l in legs]
print("kept:", ids)
ok = ids == ["(LIM)", "ERNAS", "EQUATOR", "EGBB33"]
print("ALL OK" if ok else "FAILED")
