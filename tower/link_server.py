"""OFP Tower (OFP Link stopgap): broadcasts recorder readings to OFP Planner over WebSocket.

Loopback only (127.0.0.1 and ::1), allowed browser origins only.
Runs in background threads; publish() never blocks the recorder loop.

Clients may send exactly one kind of message: a relay
  {"type":"relay","channel":"stream","msg":{...}}
which is forwarded, as the exact same text, to every OTHER connected client
(e.g. Stream panel settings -> the OBS page). Nothing else from clients is
acted on, and nothing a client sends ever reaches the sim.
"""
import json
import queue
import socket
import sys
import threading
import time

from websockets.sync.server import serve

ORIGINS = ["https://plans.massorbit.co.uk", "http://localhost:3000", "http://localhost:8765"]
HOSTS = ["127.0.0.1", "::1"]
VERSION = "0.0.3-stopgap"
import os
SETTINGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "last-settings.json")
RELAY_MAX = 16 * 1024          # relay messages larger than this are ignored
FRAME_MAX = 64 * 1024          # hard cap per incoming frame (connection closes above it)
TRACK_EVERY_S = 30.0           # flown-path backlog: keep a point every 30 s ...
TRACK_EVERY_NM = 2.0           # ... or every 2 nm ...
TRACK_TURN_DEG = 10.0          # ... or after a 10 degree change of track (keeps turns round)
TRACK_MAX = 3000               # thin to every other point above this (very long flights)


def _nm(a, b):
    """Great-circle distance in nm between (lat, lon) pairs."""
    import math
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3440.065 * 2 * math.asin(min(1.0, math.sqrt(h)))


def _bearing(a, b):
    import math
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return math.degrees(math.atan2(y, x)) % 360


class TrackLog:
    """Decimated flown path for this flight, sent to boards that connect late (or reload).

    Points are [zuluSec, lat, lon, altFt]. A new flight starts when the plan's origin or
    destination changes, or when the aircraft takes off again after a landing.
    """

    def __init__(self):
        self.points = []
        self._last = None          # last raw fix (lat, lon)
        self._course = None        # course of the last kept segment
        self._on_ground = None
        self._landed = False
        self._route = None

    def reset(self):
        self.points, self._last, self._course, self._landed = [], None, None, False

    def note_route(self, origin, destination):
        route = (origin or None, destination or None)
        if self._route is not None and route != self._route and any(route):
            self.reset()
        if any(route):
            self._route = route

    def add(self, rec):
        lat, lon, zulu = rec.get("lat"), rec.get("lon"), rec.get("zulu")
        if lat is None or lon is None or zulu is None:
            return
        if abs(lat) < 1e-4 and abs(lon) < 1e-4:     # sim still loading: no real position
            return
        on_ground = rec.get("onGround")
        if self._on_ground is False and on_ground is True:
            self._landed = True
        elif self._on_ground is True and on_ground is False and self._landed:
            self.reset()                             # next flight's take-off
        self._on_ground = on_ground
        moving = (rec.get("gs") or 0) >= 3 or on_ground is False
        if not moving and self.points:
            return                                   # parked: one point is enough
        here = (lat, lon)
        pt = [zulu, round(lat, 5), round(lon, 5), round(rec.get("alt") or 0)]
        if not self.points:
            self.points.append(pt)
            self._last = here
            return
        prev = self.points[-1]
        dist = _nm((prev[1], prev[2]), here)
        if dist < 0.05:
            return
        course = _bearing((prev[1], prev[2]), here)
        turned = self._course is not None and dist >= 0.5 and \
            abs((course - self._course + 180) % 360 - 180) >= TRACK_TURN_DEG
        dt = (zulu - prev[0]) % 86400                # zulu wraps at midnight
        if dt >= TRACK_EVERY_S or dist >= TRACK_EVERY_NM or turned:
            self.points.append(pt)
            self._course = course
            if len(self.points) > TRACK_MAX:
                self.points = self.points[:-1:2] + [self.points[-1]]
        self._last = here

    def message(self):
        return json.dumps({"type": "track", "points": self.points}) if self.points else None


class LinkServer:
    def __init__(self, port=47800, hello=None):
        self.port = port
        self.hello = dict(hello or {})
        self._clients = set()
        self._lock = threading.Lock()
        self._q = queue.Queue(maxsize=50)
        self._servers = []
        self._plan_msg = None
        self._settings_file = SETTINGS_FILE
        self._settings_msg = None
        self._save_lock = threading.Lock()
        self._saved = False
        self._track = TrackLog()
        self._track_lock = threading.Lock()
        try:   # the last Stream-panel settings survive a restart
            with open(self._settings_file, encoding="utf-8") as f:
                txt = f.read()
            if len(txt) <= RELAY_MAX and json.loads(txt).get("msg", {}).get("kind") == "settings":
                self._settings_msg = txt
        except (OSError, ValueError, AttributeError):
            pass

    def start(self):
        for host in HOSTS:
            try:
                if ":" in host:   # bind IPv6 loopback explicitly (name lookup of "::1" can fail on Windows)
                    sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
                    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                    sock.bind((host, self.port, 0, 0))
                    sock.listen()
                    srv = serve(self._handler, sock=sock, origins=ORIGINS, max_size=FRAME_MAX)
                else:
                    srv = serve(self._handler, host, self.port, origins=ORIGINS, max_size=FRAME_MAX)
            except OSError as e:
                print(f"OFP Tower: could not listen on [{host}]:{self.port}: {e}", file=sys.stderr)
                continue
            self._servers.append(srv)
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            print(f"OFP Tower: listening on ws://{'[::1]' if ':' in host else host}:{self.port}", file=sys.stderr)
        if not self._servers:
            raise SystemExit("OFP Link: no listener could be started")
        threading.Thread(target=self._sender, daemon=True).start()

    def _handler(self, ws):
        hello = {"type": "hello", "app": "ofp-link", "version": VERSION, "sim": "MSFS2024", **self.hello}
        try:
            ws.send(json.dumps(hello))
        except Exception:
            return
        # The track backlog is built and the client joins broadcasts under the same lock that
        # publish() takes, so no sample can arrive before the backlog or fall between them.
        with self._track_lock:
            track_msg = self._track.message()
            for extra in (self._plan_msg, track_msg, self._settings_msg):
                if extra:
                    try:
                        ws.send(extra)
                    except Exception:
                        return
            with self._lock:
                self._clients.add(ws)
        try:
            for raw in ws:
                if isinstance(raw, str) and len(raw) <= RELAY_MAX:
                    try:
                        obj = json.loads(raw)
                        is_relay = obj.get("type") == "relay"
                    except (ValueError, AttributeError):
                        obj, is_relay = None, False
                    if is_relay:
                        self._enqueue(raw, exclude=ws)     # exact text, not back to the sender
                        msg = obj.get("msg")
                        if isinstance(msg, dict) and msg.get("kind") == "settings":
                            self._remember_settings(raw)
        except Exception:
            pass
        finally:
            with self._lock:
                self._clients.discard(ws)

    def _remember_settings(self, raw):
        """Keep the last settings relay (exact text) for clients that connect later, and on disk."""
        with self._save_lock:          # one client thread at a time (several pages can send at once)
            if raw == self._settings_msg and self._saved:
                return
            self._settings_msg = raw
            tmp = f"{self._settings_file}.{threading.get_ident()}.tmp"
            err = None
            for attempt in range(5):   # Windows may briefly lock the file (antivirus / indexer)
                try:
                    with open(tmp, "w", encoding="utf-8") as f:
                        f.write(raw)
                    os.replace(tmp, self._settings_file)
                    self._saved = True
                    return
                except OSError as e:
                    err = e
                    time.sleep(0.05 * (attempt + 1))
            self._saved = False
            try:
                os.remove(tmp)
            except OSError:
                pass
            print(f"OFP Tower: could not save settings (relay still delivered): {err}", file=sys.stderr)

    def set_plan(self, plan):
        """Store the latest flight plan; broadcast it only when it changed."""
        msg = json.dumps(plan)
        if msg == self._plan_msg:
            return False
        with self._track_lock:
            self._track.note_route(plan.get("origin"), plan.get("destination"))
        self._plan_msg = msg
        self._enqueue(msg)
        return True

    def publish(self, rec):
        with self._track_lock:
            self._track.add(rec)
            self._enqueue(json.dumps({"type": "sample", **rec}))

    def _enqueue(self, msg, exclude=None):
        item = (msg, exclude)
        try:
            self._q.put_nowait(item)
        except queue.Full:            # never block the recorder: drop oldest
            try:
                self._q.get_nowait()
                self._q.put_nowait(item)
            except Exception:
                pass

    def _sender(self):
        while True:
            msg, exclude = self._q.get()
            with self._lock:
                clients = [c for c in self._clients if c is not exclude]
            for ws in clients:
                try:
                    ws.send(msg)
                except Exception:
                    with self._lock:
                        self._clients.discard(ws)
                    try:
                        ws.close()
                    except Exception:
                        pass

    def stop(self):
        for srv in self._servers:
            try:
                srv.shutdown()
            except Exception:
                pass
