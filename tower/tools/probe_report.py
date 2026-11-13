"""After a flight: which probe vars moved with the cockpit, and which MCDU pages were seen.
Usage: python probe_report.py recording.jsonl [--page "FUEL PRED"]"""
import json, sys
from datetime import datetime, timezone

hm = lambda t: datetime.fromtimestamp(t / 1000, timezone.utc).strftime("%H:%M:%SZ")
path = sys.argv[1]
want_page = sys.argv[sys.argv.index("--page") + 1].upper() if "--page" in sys.argv else None
samples, probes, pages = [], [], []
for line in open(path, encoding="utf-8"):
    try:
        o = json.loads(line)
    except ValueError:
        continue
    k = o.get("type")
    if k == "probe": probes.append(o)
    elif k == "mcdu": pages.append(o)
    elif k is None and "lat" in o: samples.append(o)

def ctx(t):
    if not samples: return ""
    s = min(samples, key=lambda r: abs(r["t"] - t))
    where = "ground" if s.get("onGround") else f"{(s.get('pressAlt') or s.get('alt') or 0):.0f} ft"
    return f"({where}, gs {s.get('gs', 0):.0f})"

print(f"{len(probes)} probe lines, {len(pages)} MCDU page lines, {len(samples)} samples")
hist = {}
for p in probes:
    for n, v in p["v"].items():
        hist.setdefault(n, []).append((p["t"], v))
print("\nVARS THAT MOVED")
still = []
for n, h in hist.items():
    if len(h) < 2:
        still.append(f"{n}={h[0][1]}")
        continue
    print(f"  {n}  ({len(h) - 1} changes)")
    for t, v in h[:14]:
        print(f"     {hm(t)}  {v}  {ctx(t)}")
    if len(h) > 14: print(f"     ... {len(h) - 14} more")
print("\nNEVER CHANGED (unknown L:vars read 0)")
for i in range(0, len(still), 4):
    print("  " + "   ".join(still[i:i + 4]))

print("\nMCDU PAGES")
seen = {}
for p in pages:
    seen.setdefault((p["unit"], p["title"]), []).append(p)
for (u, title), ps in sorted(seen.items(), key=lambda kv: kv[1][0]["t"]):
    print(f"  MCDU{u}  {title:30}  x{len(ps):3}  {hm(ps[0]['t'])} .. {hm(ps[-1]['t'])}")
for (u, title), ps in seen.items():
    if want_page and want_page in title or not want_page and any(w in title for w in ("FUEL", "PROG", "PERF", "INIT")):
        print(f"\n  --- MCDU{u} {title} at {hm(ps[-1]['t'])} {ctx(ps[-1]['t'])}")
        for r in ps[-1]["text"]:
            print("    " + r)
