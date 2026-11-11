import json, os, sys
sys.path.insert(0, os.path.expandvars(r"%USERPROFILE%\ofp-link-recorder"))
import fenix_fms as f

p = f.read_plan()
print(p["origin"], "->", p["destination"], p["flightNumber"], "cruise", p["cruiseLevel"], "phase", p["phase"])
for l in p["legs"]:
    print(f"{l['id']:8} flags={','.join(l.get('flags', [])) or '-':18} "
          f"alt={json.dumps(l.get('altConstraint'))} {'(pseudo)' if l.get('pseudo') else ''}{'(missed)' if l.get('missed') else ''}")
