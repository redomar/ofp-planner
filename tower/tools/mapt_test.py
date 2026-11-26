"""Test: legs after the approach end are marked "missed", also when the approach ends at a
missed-approach point (e.g. MA26 at LOWI) with no runway leg. No sim needed."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fenix_fms import parse_plan_xml


def xml(legs):
    body = "".join(f"<leg><type>{t}</type><displayString>{i}</displayString><latitude>47.{n:02d}</latitude>"
                   f"<longitude>11.{n:02d}</longitude></leg>" for n, (i, t) in enumerate(legs, 1))
    return f"<plan><cruiseLevel>350</cruiseLevel><route type='act'>{body}</route></plan>"


def missed(legs, dest):
    _, out = parse_plan_xml(xml(legs), dest)
    return [l["id"] for l in out if l.get("missed")]


# LOWI LOC/DME 26: ends at MA26, go-around + hold, then the alternate route from LOWI (kind Origin)
lowi = [("RTT", "Arinc"), ("ADWIG", "Arinc"), ("FF26", "Arinc"), ("MA26", "Arinc"), ("WI700", "Arinc"),
        ("WI002", "Arinc"), ("RTT", "Arinc"), ("HOLD R", "Arinc"), ("LOWI", "Origin"), ("MOGTI", "Arinc"),
        ("LSZH", "Destination")]
got = missed(lowi, "LOWI")
assert got == ["WI700", "WI002", "RTT", "HOLD R", "LOWI", "MOGTI", "LSZH"], got
# usual ILS: runway leg, then the missed approach
got = missed([("CK030", "Arinc"), ("EICK16", "Arinc"), ("CK700", "Arinc"), ("EINN", "Destination")], "EICK")
assert got == ["CK700", "EINN"], got
assert missed([("ABC", "Arinc"), ("DEF", "Arinc")], None) == []
print("ALL OK")
