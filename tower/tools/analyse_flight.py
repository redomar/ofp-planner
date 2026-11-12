"""Analyse one flight from one or more OFP Tower recordings (in order).
Usage: python analyse_flight.py rec1.jsonl [rec2.jsonl ...]"""
import json, math, sys
from datetime import datetime, timezone

def gc(a, b, c, d):
    a, b, c, d = map(math.radians, (a, b, c, d))
    return 3440.065 * 2 * math.asin(math.sqrt(math.sin((c - a) / 2) ** 2 + math.cos(a) * math.cos(c) * math.sin((d - b) / 2) ** 2))

def hm(t_ms):
    return datetime.fromtimestamp(t_ms / 1000, timezone.utc).strftime("%H:%M:%SZ")

rows, headers, plans, bad = [], [], [], 0
for path in sys.argv[1:]:
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                o = json.loads(line)
            except ValueError:
                bad += 1
                continue
            if o.get("kind") == "ofp-recording":
                headers.append((path.split("\\")[-1], o)); continue
            if o.get("type") == "plan":          # MCDU plan written when it changed
                plans.append(o); continue
            if "t" in o:
                o["_file"] = path.split("\\")[-1]
                rows.append(o)
rows.sort(key=lambda r: r["t"])
print("FILES")
for name, h in headers:
    n = sum(1 for r in rows if r["_file"] == name)
    print(f"  {name}: v{h['v']} {h['title']} {h['atcId']} profile={h['profile']} samples={n}")
print(f"  unreadable lines: {bad}")
print(f"  span: {hm(rows[0]['t'])} -> {hm(rows[-1]['t'])} ({(rows[-1]['t'] - rows[0]['t']) / 60000:.0f} min)")

# gaps
gaps = [(rows[i - 1], rows[i]) for i in range(1, len(rows)) if rows[i]["t"] - rows[i - 1]["t"] > 2500]
print("\nGAPS > 2.5 s")
for a, b in gaps:
    print(f"  {hm(a['t'])} -> {hm(b['t'])}  {(b['t'] - a['t']) / 1000:.0f} s  alt {a['alt']:.0f}->{b['alt']:.0f} ft  ({a['_file']} -> {b['_file']})")

# events
def first(pred, start=0):
    for i in range(start, len(rows)):
        if pred(rows[i]):
            return i
    return None

def changes(key):
    out, prev = [], object()
    for r in rows:
        v = r.get(key)
        if isinstance(v, list): v = tuple(v)
        if v != prev:
            out.append((r["t"], v)); prev = v
    return out

print("\nEVENTS")
ev = []
air = [i for i, r in enumerate(rows) if r["onGround"] is False]
takeoff_i, land_i = (air[0], air[-1] + 1) if air else (None, None)
for key in ("doors", "beacon", "engines", "parkBrake", "seatbelts", "noSmoking", "emerExitLt"):
    for t, v in changes(key):
        ev.append((t, f"{key} = {list(v) if isinstance(v, tuple) else v}"))
if takeoff_i is not None:
    r = rows[takeoff_i]; ev.append((r["t"], f"TAKE-OFF  gs {r['gs']:.0f} kt"))
    # THE landing = the first contact after the last time the aircraft was well clear of the
    # ground; later contacts within 30 s are bounces. (The last air->ground line can be a bounce.)
    contacts = []
    for r in rows:
        for td in r.get("touchdowns") or ([{"landingRate": r["landingRate"], "tdSim": r.get("tdSim")}]
                                         if r.get("landingRate") is not None else []):
            contacts.append((r["t"], td, r))
    if contacts:
        last_climb = max((r["t"] for r in rows if not r["onGround"] and r["agl"] > 300), default=0)
        land = [c for c in contacts if c[0] > last_climb]
        t1, td1, r1 = land[0]
        bounces = [c for c in land[1:] if c[0] - t1 <= 30000]
        peak = next((r["tdPeakG"]["peakG"] for r in rows if r.get("tdPeakG") and r["t"] >= t1), None)
        ev.append((t1, f"TOUCHDOWN  landingRate {td1['landingRate']} fpm, tdSim {td1.get('tdSim')} fpm, "
                       f"gs {r1['gs']:.0f} kt, peak G {peak}, bounces {len(bounces)}"))
        for tb, tdb, rb in bounces:
            ev.append((tb, f"  bounce contact  landingRate {tdb['landingRate']} fpm, tdSim {tdb.get('tdSim')} fpm"))
moving = first(lambda r: r["gs"] > 3)
if moving is not None: ev.append((rows[moving]["t"], "first movement (gs > 3 kt)"))
stopped = None
if land_i is not None:
    for i in range(len(rows) - 1, land_i, -1):
        if rows[i]["gs"] > 3:
            stopped = i + 1; break
    if stopped and stopped < len(rows): ev.append((rows[stopped]["t"], "stopped at gate (last gs > 3 kt)"))
for t, e in sorted(ev):
    print(f"  {hm(t)}  {e}")

# flight numbers
print("\nFLIGHT")
alts = [r.get("pressAlt") or r["alt"] for r in rows]
top = max(range(len(rows)), key=lambda i: alts[i])
print(f"  highest: {alts[top]:.0f} ft at {hm(rows[top]['t'])}  (pressAlt where recorded, else true alt)")
print(f"  max gs: {max(r['gs'] for r in rows):.0f} kt   max climb vs: {max(r['vs'] for r in rows):.0f}   max descent vs: {min(r['vs'] for r in rows):.0f}")
dist = sum(gc(rows[i - 1]["lat"], rows[i - 1]["lon"], rows[i]["lat"], rows[i]["lon"]) for i in range(1, len(rows)))
print(f"  distance flown/taxied: {dist:.0f} nm   start {rows[0]['lat']:.4f},{rows[0]['lon']:.4f}  end {rows[-1]['lat']:.4f},{rows[-1]['lon']:.4f}")
if takeoff_i is not None:
    print(f"  block: {hm(rows[moving]['t'])} -> {hm(rows[stopped]['t']) if stopped and stopped < len(rows) else '?'}   air time: {(rows[land_i]['t'] - rows[takeoff_i]['t']) / 60000:.0f} min")
fuel = [(r["t"], r["fobKg"]) for r in rows if r.get("fobKg") is not None]
if fuel:
    print(f"  fuel on board: first {fuel[0][1]:.0f} kg, last {fuel[-1][1]:.0f} kg (refuels before/after the flight count here)")
    if takeoff_i is not None:
        f_to = next((r["fobKg"] for r in rows[takeoff_i:] if r.get("fobKg") is not None), None)
        f_ld = next((r["fobKg"] for r in reversed(rows[:land_i + 1]) if r.get("fobKg") is not None), None)
        if f_to is not None and f_ld is not None:
            print(f"  trip fuel take-off -> landing: {f_to:.0f} kg -> {f_ld:.0f} kg = {f_to - f_ld:.0f} kg burned")
    cr = [r["ffKgH"] for r in rows if r.get("ffKgH") and (r.get("pressAlt") or 0) > 30000]
    if cr: print(f"  cruise fuel flow above FL300: avg {sum(cr) / len(cr):.0f} kg/h")
diff = [(r["pressAlt"] - r["alt"]) for r in rows if r.get("pressAlt") is not None and (r.get("pressAlt") or 0) > 25000]
if diff: print(f"  pressAlt - true alt above FL250: {min(diff):.0f} .. {max(diff):.0f} ft")

# landing detail
if land_i is not None:
    print("\nLANDING (last 30 s airborne + 5 s after)")
    t0 = rows[land_i]["t"]
    win = [r for r in rows if t0 - 30000 <= r["t"] <= t0 + 5000]
    dts = [win[i]["t"] - win[i - 1]["t"] for i in range(1, len(win))]
    print(f"  samples: {len(win)}  median dt {sorted(dts)[len(dts) // 2]} ms  (lines are 1 Hz; the 100 ms touchdown polling below 200 ft feeds landingRate/touchdowns, not extra lines)")
    for r in win:
        if r["t"] >= t0 - 3000:
            print(f"  {hm(r['t'])}.{r['t'] % 1000:03d}  agl {r['agl']:6.1f}  vs {r['vs']:6.0f}  gs {r['gs']:5.1f}  onGround {r['onGround']}")
    print("  (bounces: see the TOUCHDOWN event above; 1 Hz lines can miss a short bounce)")

# data quality
print("\nDATA QUALITY")
frozen = 0
for i in range(1, len(rows)):
    a, b = rows[i - 1], rows[i]
    if not b["onGround"] and a["lat"] == b["lat"] and a["lon"] == b["lon"] and a["alt"] == b["alt"]:
        frozen += 1
print(f"  airborne samples identical to the previous one (stale reads): {frozen}")
print(f"  seatbelt / signs readings missing: {sum(1 for r in rows if r.get('seatbelts') is None)}")

# MCDU plan changes (recordings from 2026-11-12 on)
print("\nMCDU PLAN")
if not plans:
    print("  no plan lines in this recording (older recording, or OFP Tower ran without the live link)")
plans.sort(key=lambda p: p["t"])
for p in plans:
    legs = p.get("legs") or []
    act = p.get("active") or {}
    to = legs[act["to"]]["id"] if act.get("to") is not None and act["to"] < len(legs) else "-"
    live = [l for l in legs if not l.get("missed") and not l.get("passed")]
    end = [l for l in legs if not l.get("missed")]
    eta = end[-1].get("eta") if end else None
    print(f"  {hm(p['t'])}  {p.get('origin')}->{p.get('destination')} {p.get('phase') or '':8}"
          f" legs {len(legs):3} (ahead {len(live):2})  to {to:8} last {end[-1]['id'] if end else '-':8} eta {eta}")
