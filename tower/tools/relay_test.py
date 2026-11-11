"""Relay test for the OFP Link server (no sim needed)."""
import json, os, sys, time
sys.path.insert(0, os.path.expandvars(r"%USERPROFILE%\ofp-link-recorder"))
import tempfile
import link_server
from link_server import LinkServer
from websockets.sync.client import connect

link_server.SETTINGS_FILE = os.path.join(tempfile.gettempdir(), "ofp-relay-test-settings.json")  # never touch the real file
if os.path.exists(link_server.SETTINGS_FILE):   # start clean: a stored setting is sent on connect
    os.remove(link_server.SETTINGS_FILE)
PORT = 47802
srv = LinkServer(PORT, {"title": "RELAYTEST", "atcId": None, "profile": None, "recording": "relaytest"})
srv.start()
ORIGIN = {"Origin": "https://plans.massorbit.co.uk"}

def drain(ws, secs):
    got = []
    end = time.time() + secs
    while time.time() < end:
        try:
            got.append(ws.recv(timeout=max(0.05, end - time.time())))
        except TimeoutError:
            break
    return got

A = connect(f"ws://127.0.0.1:{PORT}", additional_headers=ORIGIN, open_timeout=5)
B = connect(f"ws://[::1]:{PORT}", additional_headers=ORIGIN, open_timeout=5)
print("A hello:", json.loads(A.recv(timeout=3))["type"], "| B hello:", json.loads(B.recv(timeout=3))["type"])

relay = json.dumps({"type": "relay", "channel": "stream", "msg": {"kind": "settings", "q": "st=strip,pill,pill,full&sc=BRB:frame&late=0"}})
A.send(relay)
gotB, gotA = drain(B, 1.5), drain(A, 0.5)
print("1) A sent relay ->")
print("   B received:", gotB)
print("   B text identical to what A sent:", gotB == [relay])
print("   A received (must be empty):", gotA)

hello = '{"type":"relay","channel":"stream","msg":{"kind":"hello"}}'
B.send(hello)
gotA, gotB = drain(A, 1.5), drain(B, 0.5)
print("2) B sent relay hello -> A received identical:", gotA == [hello], "| B got back (must be empty):", gotB)

A.send(json.dumps({"type": "sample", "lat": 1}))           # non-relay: must be ignored
A.send("not json")
big = json.dumps({"type": "relay", "channel": "stream", "msg": {"pad": "x" * 20000}})
A.send(big)                                                # > 16 KB: must be ignored
print("3) non-relay / junk / >16KB relay -> B received (must be empty):", [m[:60] for m in drain(B, 1.0)])

srv.publish({"t": 1, "lat": 51.5})                         # server samples still reach both
print("4) server sample -> A:", [json.loads(m)["type"] for m in drain(A, 1.0)], "B:", [json.loads(m)["type"] for m in drain(B, 1.0)])
try:
    connect(f"ws://127.0.0.1:{PORT}", additional_headers={"Origin": "https://example.com"}, open_timeout=5)
    print("5) bad origin: CONNECTED (bad)")
except Exception as e:
    print("5) bad origin refused:", type(e).__name__, str(e)[:60])
A.close(); B.close(); srv.stop()
