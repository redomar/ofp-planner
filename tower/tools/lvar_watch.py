"""Read-only: poll candidate vars ~5x/s for N seconds, print every change."""
import sys, time
from SimConnect import SimConnect
from SimConnect.RequestList import Request

DURATION = float(sys.argv[1]) if len(sys.argv) > 1 else 180
names = [
    ("BRAKE PARKING POSITION", "bool"),
    ("L:S_MIP_PARKING_BRAKE", "number"),
    ("CABIN SEATBELTS ALERT SWITCH", "bool"),
    ("L:S_OH_SIGNS", "number"),
    ("CABIN NO SMOKING ALERT SWITCH", "bool"),
    ("L:S_OH_SIGNS_SMOKING", "number"),
    ("L:S_OH_SIGNS_EMER_EXIT_LT", "number"),
    ("L:S_OH_EMER_EXIT_LT", "number"),
    ("L:S_OH_SIGNS_EMER_EXIT", "number"),
    ("L:S_OH_EMER_EXIT_LIGHT", "number"),
    ("L:S_OH_INT_LT_EMER", "number"),
    ("L:S_OH_EXT_LT_EMER_EXIT", "number"),
]
sm = SimConnect()
reqs = [(n, Request((n.encode(), u.encode()), sm, _time=0, _attemps=3)) for n, u in names]
last = {}
start = time.time()
print("watching", flush=True)
while time.time() - start < DURATION:
    for n, r in reqs:
        try:
            v = r.value
        except Exception:
            v = None
        if n not in last:
            print(f"{time.time()-start:6.1f}s initial {n} = {v}", flush=True)
        elif v != last[n]:
            print(f"{time.time()-start:6.1f}s CHANGE  {n}: {last[n]} -> {v}", flush=True)
        last[n] = v
    time.sleep(0.2)
print("done", flush=True)
sm.exit()
