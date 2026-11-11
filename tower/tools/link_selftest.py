"""Self-test for link_server without the sim: replays real recorded lines as fake readings."""
import json, os, subprocess, sys, threading, time
sys.path.insert(0, os.path.expandvars(r"%USERPROFILE%\ofp-link-recorder"))
from link_server import LinkServer
from websockets.sync.client import connect

REC = os.path.expandvars(r"%USERPROFILE%\ofp-link-recorder\recordings\20261110-194202.jsonl")
lines = [json.loads(l) for l in open(REC, encoding="utf-8")][1:]

srv = LinkServer(47800, {"title": "SELFTEST", "atcId": "TEST", "profile": "Fenix", "recording": "selftest"})
srv.start()

def feeder():
    i = 0
    while True:
        srv.publish(lines[i % len(lines)])
        i += 1
        time.sleep(1)
threading.Thread(target=feeder, daemon=True).start()

print("--- listening sockets on 47800:")
print(subprocess.run(["powershell", "-NoProfile", "-Command",
      "Get-NetTCPConnection -LocalPort 47800 -State Listen | ForEach-Object { $_.LocalAddress }"],
      capture_output=True, text=True).stdout.strip())

def try_client(label, uri, origin, n=3):
    print(f"--- {label}: {uri} Origin={origin}")
    try:
        hdrs = {"Origin": origin} if origin else None
        with connect(uri, additional_headers=hdrs, open_timeout=5) as ws:
            for k in range(n + 1):
                m = json.loads(ws.recv(timeout=5))
                if m["type"] == "hello":
                    print("  hello:", json.dumps(m))
                else:
                    keep = {x: m.get(x) for x in ("type", "zulu", "lat", "lon", "onGround", "parkBrake", "seatbelts", "noSmoking", "emerExitLt", "landingRate", "tdSim")}
                    print("  sample:", json.dumps(keep))
    except Exception as e:
        print(f"  REFUSED/ERROR: {type(e).__name__}: {e}")

try_client("allowed, IPv4", "ws://127.0.0.1:47800", "https://plans.massorbit.co.uk")
try_client("allowed, IPv6", "ws://[::1]:47800", "https://plans.massorbit.co.uk", n=1)
try_client("bad origin", "ws://127.0.0.1:47800", "https://example.com")
try_client("no origin", "ws://127.0.0.1:47800", None)

lan = None
try:
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(("192.168.68.1", 80)); lan = s.getsockname()[0]; s.close()
except Exception:
    pass
if lan:
    try_client("LAN address (must fail)", f"ws://{lan}:47800", "https://plans.massorbit.co.uk", n=0)
srv.stop()
print("--- done")
