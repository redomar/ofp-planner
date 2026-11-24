"""Test: traffic and stands messages for the departures board (no sim needed). Spec: docs/OFP-LINK.md 1.17."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import traffic as T

APT = {"icao": "EKCH", "lat": 55.618, "lon": 12.656}
NOW = 1_800_000_000


def sim(cs, lat=55.62, lon=12.65, gnd=True, title="FSLTL_FAIB_B738_RYS-Buzz", **kw):
    r = {"objectId": kw.pop("oid", 1), "atcId": cs, "title": title, "model": "737", "airline": "Rednose",
         "lat": lat, "lon": lon, "altFt": 20.0, "gsKt": 0.0, "hdg": 90.0, "onGround": gnd, "isUser": False,
         "aiState": "STATE_WAIT_INIT_CONFIRM", "aiFrom": "", "aiTo": "", "aiParking": "", "aiEtaS": 0.0, "aiEtdS": 0.0}
    r.update(kw)
    return r


tracker = [
    {"flight_icao": "DLH98D", "tail_number": "D-AIZZ", "aircraft_icao": "A320", "origin": "EDDF", "final_destination": "EKCH",
     "lat": 55.9, "lon": 12.4, "altitude": 25245, "altitude_agl": 25000, "airspeed": 410, "skynet_enabled": 1},
    {"flight_icao": "SAS2864", "tail_number": "SE-ROA", "aircraft_icao": "A20N", "origin": "EKCH", "final_destination": "",
     "lat": 55.627, "lon": 12.646, "altitude": -336, "altitude_agl": 2, "airspeed": 1, "skynet_enabled": 0},
    {"flight_icao": None, "tail_number": "OY-KAM", "lat": 55.627, "lon": 12.645, "altitude_agl": 0, "skynet_enabled": 1},
    {"flight_icao": "FAR001", "lat": 40.0, "lon": -3.0, "altitude_agl": 0, "skynet_enabled": 1},
    {"flight_icao": "RYR77VD", "aircraft_icao": "B738", "origin": "EGSS", "final_destination": "EKCH",
     "lat": 55.7, "lon": 12.7, "altitude": 3000, "altitude_agl": 2900, "airspeed": 180, "skynet_enabled": 1},
]
rows = [
    sim("RYR77VD", gnd=False, altFt=3100, gsKt=190),               # also in the tracker: tracker row wins
    sim("", title="FSLTL A20N SAS Scandinavian"),                 # parked static without callsign: left out
    sim("OY-KAM", isUser=True, title="FenixA320 IAE WF"),         # the user: left out
    sim("SAS87F", title="FSLTL A20N SAS"),                         # user's flight number via user_ids: left out
    sim("TAP783", gnd=False, title="Asobo PassiveAircraft A320 CEO", altFt=36000, gsKt=443),
    sim("SAS1204", title="FSLTL A20N SAS Scandinavian", gsKt=12, aiState="taxi out", aiParking="Gate C 30, GATE med (23 m)"),
    sim("FAR1", lat=50.0, lon=8.0),                                # > 100 nm from EKCH: left out
    sim("SAS2184", lat=56.29, lon=12.857, gsKt=90),                # on the ground at another airport: left out
    sim("SAS9", lat=55.9, lon=12.9, gnd=False, altFt=5000),        # airborne 20 nm out: kept
    sim("SWR125A", title="FSLTL_BCS3_BTI-Baltic", aiFrom="LSZH", aiTo="EKCH", aiEtaS=600.0),
]
m = T.traffic_message(APT, rows, [{k: p.get(k) for k in T.SI_KEEP} for p in tracker],
                      user_ids=["OY-KAM", "SAS87F"], now=NOW)
by = {a["callsign"]: a for a in m["aircraft"]}
ok = m["type"] == "traffic" and m["airport"] == "EKCH"
ok &= set(by) == {"RYR77VD", "TAP783", "SAS1204", "SWR125A", "DLH98D", "SAS2864", "SAS9"}
ok &= by["RYR77VD"]["src"] == "SKY" and by["RYR77VD"]["from"] == "EGSS"        # tracker replaced the sim row
ok &= by["TAP783"]["src"] == "AI" and by["TAP783"]["type"] == "A320" and "from" not in by["TAP783"]
ok &= by["SAS1204"]["src"] == "SI" and by["SAS1204"]["state"] == "taxi out" and by["SAS1204"]["parking"].startswith("Gate C 30")
ok &= "state" not in by["TAP783"]                                                 # STATE_WAIT_INIT_CONFIRM dropped
ok &= by["SWR125A"]["eta"] == NOW + 600 and by["SWR125A"]["type"] == "BCS3"
ok &= by["DLH98D"]["src"] == "SKY" and by["DLH98D"]["onGround"] is False and by["DLH98D"]["alt"] == 25245
ok &= by["SAS2864"]["src"] == "SI" and by["SAS2864"]["onGround"] is True and "alt" not in by["SAS2864"]
ok &= "to" not in by["SAS2864"]                                                    # empty destination omitted
txt = json.dumps(m)
ok &= not any(w in txt for w in ("displayname", "userId", "Email", "api_key", "group_code", "OY-KAM", "OYKAM"))
print("traffic:", len(m["aircraft"]), "aircraft;", sorted(by))

st = {"icao": "EKCH", "lat": 55.6, "lon": 12.6, "stands": [
    {"name": "D2", "kind": "GATE_MEDIUM", "lat": 55.62, "lon": 12.65, "hdg": 90, "radiusM": 23.0},
    {"name": "V1", "kind": "VEHICLE", "lat": 55.62, "lon": 12.65, "hdg": 0, "radiusM": 5.0},
    {"name": "", "kind": "RAMP_GA_SMALL", "lat": 55.62, "lon": 12.65, "hdg": 0, "radiusM": 8.0}]}
sm = T.stands_message(st)
ok &= sm == {"type": "stands", "airport": "EKCH", "stands": [{"name": "D2", "lat": 55.62, "lon": 12.65, "radius": 23.0}]}
ok &= T.stand_label({"name": 15, "number": 2, "suffix": 0}) == "D2" and T.stand_label({"name": 10, "number": 12, "suffix": 0}) == "12"

# LinkServer keeps both for late joiners
import link_server
ls = link_server.LinkServer.__new__(link_server.LinkServer)
ls._track_lock = __import__("threading").Lock(); ls._stands_msg = ls._traffic_msg = None
sent = []; ls._enqueue = lambda msg, exclude=None: sent.append(json.loads(msg)["type"])
ls.set_stands(sm); ls.set_stands(sm); ls.set_traffic(m)
ok &= sent == ["stands", "traffic"] and json.loads(ls._stands_msg)["airport"] == "EKCH"
print("ALL OK" if ok else "FAILED")
