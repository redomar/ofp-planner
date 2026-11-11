"""Test: many pages sending settings at once must not break saving (no sim needed)."""
import json, os, sys, tempfile, threading, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import link_server
from link_server import LinkServer
from websockets.sync.client import connect

tmpfile = os.path.join(tempfile.gettempdir(), "ofp-concurrent-settings-test.json")
link_server.SETTINGS_FILE = tmpfile          # never touch the real file
O = {"Origin": "https://plans.massorbit.co.uk"}
PORT = 47805
srv = LinkServer(PORT); srv.start()

N, ROUNDS = 8, 25
clients = [connect(f"ws://127.0.0.1:{PORT}", additional_headers=O) for _ in range(N)]
for c in clients:
    c.recv(timeout=3)
go = threading.Barrier(N)

def reader(ws):                  # keep reading, like a real page, so keepalive pings get answered
    try:
        for _ in ws:
            pass
    except Exception:
        pass

for c in clients:
    threading.Thread(target=reader, args=(c,), daemon=True).start()

def blast(i, ws):
    go.wait()
    for r in range(ROUNDS):
        ws.send(json.dumps({"type": "relay", "channel": "stream", "msg": {"kind": "settings", "q": f"st=strip&c={i}-{r}"}}))

ts = [threading.Thread(target=blast, args=(i, c)) for i, c in enumerate(clients)]
[t.start() for t in ts]; [t.join() for t in ts]
time.sleep(1.5)
saved = json.loads(open(tmpfile, encoding="utf-8").read())
leftovers = [f for f in os.listdir(os.path.dirname(tmpfile)) if f.startswith("ofp-concurrent-settings-test.json.") and f.endswith(".tmp")]
print("saved file is a valid settings relay:", saved["msg"]["kind"] == "settings", "|", saved["msg"]["q"])
print("in-memory and file agree:", srv._settings_msg == open(tmpfile, encoding="utf-8").read())
print("leftover .tmp files (must be empty):", leftovers)
for c in clients:
    c.close()
srv.stop()
os.remove(tmpfile)
