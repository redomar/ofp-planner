"""Read-only probe of Fenix gateway subscriptions (graphql-transport-ws / graphql-ws)."""
import json, sys
from websockets.sync.client import connect

URL = "ws://127.0.0.1:8083/graphql"
NAMES = ["fenix.registration", "system.gates.B_HYD_PARKING_BRAKE_SET"]


def run(doc, proto):
    try:
        with connect(URL, subprotocols=[proto], open_timeout=5) as ws:
            ws.send(json.dumps({"type": "connection_init", "payload": {}}))
            ack = json.loads(ws.recv(timeout=5))
            if ack.get("type") not in ("connection_ack",):
                return f"no ack: {ack}"
            start = "subscribe" if proto == "graphql-transport-ws" else "start"
            ws.send(json.dumps({"id": "1", "type": start, "payload": {"query": doc}}))
            out = []
            for _ in range(2):
                m = json.loads(ws.recv(timeout=4))
                if m.get("type") in ("ka", "ping"):
                    continue
                out.append(m)
                if m.get("type") in ("error", "complete"):
                    break
            return json.dumps(out)[:500]
    except Exception as e:
        return f"{type(e).__name__}: {e}"


proto = sys.argv[1] if len(sys.argv) > 1 else "graphql-transport-ws"
names = json.dumps(NAMES)
docs = [
    "subscription { __typename }",
    f"subscription {{ dataRefs(names: {names}) {{ name value }} }}",
    f"subscription {{ dataRef(names: {names}) {{ name value }} }}",
    f"subscription {{ dataRefsChanged(names: {names}) {{ name value }} }}",
    f"subscription {{ dataRef {{ __typename }} }}",
]
for d in docs:
    print("DOC:", d)
    print("  ->", run(d, proto))
