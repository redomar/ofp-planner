"""Test: last settings relay is remembered, persisted, and sent to later clients."""
import json, os, sys, time, tempfile
sys.path.insert(0, os.path.expandvars(r"%USERPROFILE%\ofp-link-recorder"))
import link_server
from link_server import LinkServer
from websockets.sync.client import connect

tmpfile = os.path.join(tempfile.gettempdir(), "ofp-last-settings-test.json")
if os.path.exists(tmpfile):
    os.remove(tmpfile)
link_server.SETTINGS_FILE = tmpfile          # keep the real file untouched by the test
O = {"Origin": "https://plans.massorbit.co.uk"}

def drain(ws, secs):
    got, end = [], time.time() + secs
    while time.time() < end:
        try:
            got.append(ws.recv(timeout=max(0.05, end - time.time())))
        except TimeoutError:
            break
    return got

s1 = LinkServer(47803); s1.start()
settings = json.dumps({"type": "relay", "channel": "stream", "msg": {"kind": "settings", "q": "st=pill,pill,strip,full&sc=BRB:frame&late=0"}})
other = json.dumps({"type": "relay", "channel": "stream", "msg": {"kind": "hello"}})
with connect("ws://127.0.0.1:47803", additional_headers=O) as A:
    A.recv(timeout=3)
    A.send(settings); A.send(other)                 # a later non-settings relay must not replace it
    time.sleep(0.5)
print("1) A sent settings + a hello relay, then disconnected")
print("   file saved, identical:", open(tmpfile, encoding="utf-8").read() == settings)
with connect("ws://[::1]:47803", additional_headers=O) as C:
    got = drain(C, 1.0)
print("2) C connects later, receives:", [json.loads(m)["type"] + ("/" + json.loads(m)["msg"]["kind"] if json.loads(m).get("msg") else "") for m in got])
print("   settings text identical:", settings in got)
s1.stop()

s2 = LinkServer(47804); s2.start()               # 'restart': new server reads the file
with connect("ws://127.0.0.1:47804", additional_headers=O) as D:
    got = drain(D, 1.0)
print("3) after restart, new client receives settings identical:", settings in got, "| messages:", len(got))
s2.stop()
os.remove(tmpfile)
