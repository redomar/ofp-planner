"""Minimal obs-websocket v5 client (no auth), stdlib only.
Usage: python obsws.py requests.json   -> prints one JSON response per request.
requests.json: [{"type": "GetVersion", "data": {...}, "sleep": 0}, ...]
"""
import base64, json, os, socket, struct, sys, time

HOST, PORT = "127.0.0.1", 4455


class WS:
    def __init__(self):
        self.s = socket.create_connection((HOST, PORT), timeout=15)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET / HTTP/1.1\r\nHost: {HOST}:{PORT}\r\nUpgrade: websocket\r\n"
                        f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                        "Sec-WebSocket-Protocol: obswebsocket.json\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(4096)
        head, self.rest = buf.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise SystemExit("handshake failed: " + head.decode(errors="replace"))

    def _read(self, n):
        while len(self.rest) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise ConnectionError("closed")
            self.rest += chunk
        out, self.rest = self.rest[:n], self.rest[n:]
        return out

    def recv(self):
        data = b""
        while True:
            b1, b2 = self._read(2)
            fin, op, ln = b1 & 0x80, b1 & 0x0F, b2 & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", self._read(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(ln)
            if op == 8:
                raise ConnectionError("server closed: " + payload[2:].decode(errors="replace"))
            if op == 9:
                continue
            data += payload
            if fin:
                return json.loads(data.decode())

    def send(self, obj):
        p = json.dumps(obj).encode()
        hdr = bytes([0x81])
        mask = os.urandom(4)
        if len(p) < 126:
            hdr += bytes([0x80 | len(p)])
        elif len(p) < 65536:
            hdr += bytes([0x80 | 126]) + struct.pack(">H", len(p))
        else:
            hdr += bytes([0x80 | 127]) + struct.pack(">Q", len(p))
        self.s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(p)))


def main():
    reqs = json.load(open(sys.argv[1], encoding="utf-8-sig"))
    ws = WS()
    hello = ws.recv()
    if hello["d"].get("authentication"):
        raise SystemExit("OBS requires authentication; it must be turned off for this script")
    ws.send({"op": 1, "d": {"rpcVersion": 1, "eventSubscriptions": 0}})
    ws.recv()
    for i, r in enumerate(reqs):
        ws.send({"op": 6, "d": {"requestType": r["type"], "requestId": str(i), "requestData": r.get("data", {})}})
        while True:
            m = ws.recv()
            if m.get("op") == 7 and m["d"]["requestId"] == str(i):
                break
        st = m["d"]["requestStatus"]
        print(json.dumps({"req": r["type"], "ok": st["result"], "code": st["code"],
                          "comment": st.get("comment"), "data": m["d"].get("responseData")}))
        sys.stdout.flush()
        if r.get("sleep"):
            time.sleep(r["sleep"])


if __name__ == "__main__":
    main()
