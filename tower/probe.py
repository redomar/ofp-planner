"""Automatic, read-only probe written into every recording (for "Aircraft status" and "Flight deck").

Two kinds of line, told apart from samples by "type":
  {"type":"probe","t":ms,"zulu":s,"v":{"<var>":value,...}}
      candidate SimVars / Fenix L:vars, every PROBE_EVERY_S; only the values that changed
      (the first line has them all). Which ones move with the cockpit is worked out after
      the flight with tools/probe_report.py.
  {"type":"mcdu","t":ms,"zulu":s,"unit":1|2,"title":"FUEL PRED","text":[rows],"xml":"..."}
      an MCDU page as shown, read from the Fenix gateway (the same read-only subscription
      the flight-plan reader uses): when the page changes, and again at most every
      MCDU_SAME_PAGE_S while it stays up with new figures.
Nothing is ever written to the sim or the Fenix.
"""
import re
import sys
import threading
import time
import xml.etree.ElementTree as ET

PROBE_EVERY_S = 5
MCDU_EVERY_S = 2.0
MCDU_SAME_PAGE_S = 30.0

# (name, unit). Standard SimVars first, then Fenix L:var candidates (an unknown L:var reads 0,
# so a candidate only counts once it is seen to move with the switch in the cockpit).
PROBE_VARS = [
    ("LIGHT STROBE", "bool"), ("LIGHT LANDING", "bool"), ("LIGHT TAXI", "bool"), ("LIGHT NAV", "bool"),
    ("LIGHT LOGO", "bool"), ("LIGHT WING", "bool"), ("LIGHT RECOGNITION", "bool"),
    ("APU PCT RPM", "percent"), ("APU SWITCH", "bool"), ("APU GENERATOR SWITCH", "bool"),
    ("EXTERNAL POWER ON:1", "bool"), ("EXTERNAL POWER AVAILABLE:1", "bool"),
    ("BLEED AIR APU", "bool"), ("PRESSURIZATION CABIN ALTITUDE", "feet"),
    ("FLAPS HANDLE INDEX", "number"), ("TRAILING EDGE FLAPS LEFT PERCENT", "percent"),
    ("GEAR HANDLE POSITION", "bool"), ("GEAR TOTAL PCT EXTENDED", "percent"),
    ("SPOILERS HANDLE POSITION", "percent"), ("SPOILERS ARMED", "bool"),
    ("AUTO BRAKE SWITCH CB", "number"), ("AUTOPILOT MASTER", "bool"), ("AUTOPILOT DISENGAGED", "bool"),
    ("AUTOTHROTTLE ACTIVE", "bool"), ("TRANSPONDER STATE:1", "number"), ("TRANSPONDER CODE:1", "number"),
    ("TURB ENG N1:1", "percent"), ("TURB ENG N1:2", "percent"),
    ("ENG ANTI ICE:1", "bool"), ("ENG ANTI ICE:2", "bool"), ("STRUCTURAL DEICE SWITCH", "bool"),
    ("FUEL TANK CENTER QUANTITY", "gallons"), ("TOTAL WEIGHT", "pounds"),
    ("AMBIENT TEMPERATURE", "celsius"), ("SEA LEVEL PRESSURE", "millibars"),
    ("KOHLSMAN SETTING MB:1", "millibars"), ("PUSHBACK STATE", "number"),
    ("ELECTRICAL MAIN BUS VOLTAGE", "volts"),
    ("L:S_OH_EXT_LT_STROBE", "number"), ("L:S_OH_EXT_LT_BEACON", "number"), ("L:S_OH_EXT_LT_WING", "number"),
    ("L:S_OH_EXT_LT_NAV_LOGO", "number"), ("L:S_OH_EXT_LT_RWY_TURNOFF", "number"),
    ("L:S_OH_EXT_LT_LANDING_L", "number"), ("L:S_OH_EXT_LT_LANDING_R", "number"),
    ("L:S_OH_EXT_LT_LANDING_BOTH", "number"), ("L:S_OH_EXT_LT_NOSE", "number"),
    ("L:S_OH_ELEC_APU_MASTER", "number"), ("L:S_OH_ELEC_APU_START", "number"),
    ("L:S_OH_ELEC_EXT_PWR", "number"), ("L:S_OH_ELEC_BAT1", "number"), ("L:S_OH_ELEC_BAT2", "number"),
    ("L:S_OH_PNEUMATIC_APU_BLEED", "number"), ("L:S_OH_PNEUMATIC_PACK_1", "number"),
    ("L:S_OH_PNEUMATIC_PACK_2", "number"), ("L:S_OH_ENG_ANTI_ICE_1", "number"),
    ("L:S_OH_WING_ANTI_ICE", "number"), ("L:S_OH_PROBE_HEAT", "number"),
    ("L:S_FC_FLAPS", "number"), ("L:S_FC_SPEEDBRAKE", "number"), ("L:A_FC_SPEEDBRAKE", "number"),
    ("L:S_MIP_GEAR", "number"), ("L:S_MIP_AUTOBRAKE_LO", "number"), ("L:S_MIP_AUTOBRAKE_MED", "number"),
    ("L:S_MIP_AUTOBRAKE_MAX", "number"), ("L:I_MIP_AUTOBRAKE_LO_L", "number"),
    ("L:I_MIP_AUTOBRAKE_MED_L", "number"), ("L:I_MIP_AUTOBRAKE_MAX_L", "number"),
    ("L:S_XPDR_MODE", "number"), ("L:S_XPDR_OPERATION", "number"), ("L:S_TCAS_MODE", "number"),
    ("L:I_FCU_AP1", "number"), ("L:I_FCU_AP2", "number"), ("L:I_FCU_ATHR", "number"),
    ("L:S_ENG_MASTER_1", "number"), ("L:S_ENG_MASTER_2", "number"), ("L:S_ENG_MODE", "number"),
    ("L:S_OH_INT_LT_DOME", "number"), ("L:S_OH_NAV_IR1_MODE", "number"),
    ("L:N_ELEC_VOLT_BAT1", "number"), ("L:S_CHRONO_ET", "number"),
]


def _round(v):
    if v is None:
        return None
    if isinstance(v, bytes):
        return v.split(b"\x00", 1)[0].decode("utf-8", "replace")
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    return round(f, 1) if abs(f) < 1000 else round(f)


class ProbeLog:
    def __init__(self):
        self._last = {}

    def line(self, t_ms, zulu, values):
        """values: {(name, unit): raw}. Returns a probe line dict, or None when nothing changed."""
        changed = {}
        for (name, _unit), raw in values.items():
            v = _round(raw)
            if name not in self._last or self._last[name] != v:
                changed[name] = v
                self._last[name] = v
        if not changed:
            return None
        return {"type": "probe", "t": t_ms, "zulu": zulu, "v": changed}


def page_text(display_xml):
    """MCDU display XML -> list of row strings (colour/size markup dropped)."""
    if not display_xml:
        return []
    try:
        root = ET.fromstring(display_xml)
    except ET.ParseError:
        return [re.sub(r"<[^>]+>", " ", display_xml)[:200]]
    rows = []
    for el in root.iter():
        s = (el.text or "").strip()
        if s:
            rows.append(s)
    return rows


def page_title(rows):
    for r in rows:
        s = re.sub(r"[^A-Z0-9/ \-]", " ", r.upper()).strip()
        s = re.sub(r"\s+", " ", s)
        if len(s) >= 3:
            return s[:30]
    return ""


class McduLog:
    def __init__(self):
        self._last = {}          # unit -> (title, xml, sent_at)

    def line(self, t_ms, unit, display_xml, now=None):
        now = time.monotonic() if now is None else now
        if not display_xml:
            return None
        rows = page_text(display_xml)
        title = page_title(rows)
        prev = self._last.get(unit)
        if prev is not None:
            p_title, p_xml, sent = prev
            if display_xml == p_xml:
                return None
            if title == p_title and now - sent < MCDU_SAME_PAGE_S:
                return None
        self._last[unit] = (title, display_xml, now)
        return {"type": "mcdu", "t": t_ms, "unit": unit, "title": title, "text": rows, "xml": display_xml}


def start_mcdu_thread(out_q, every=MCDU_EVERY_S, read=None):
    """Read both MCDU screens (read-only) every few seconds; queue changed pages for the recording."""
    if read is None:
        from fenix_fms import read_values
        read = lambda: read_values(timeout=3.0, names=["aircraft.mcdu1.display", "aircraft.mcdu2.display"])
    log = McduLog()

    def loop():
        warned = False
        while True:
            try:
                v = read()
                t = int(time.time() * 1000)
                for unit in (1, 2):
                    ln = log.line(t, unit, v.get(f"aircraft.mcdu{unit}.display"))
                    if ln:
                        try:
                            out_q.put_nowait(ln)
                        except Exception:
                            pass
                warned = False
            except Exception as e:
                if not warned:
                    print(f"OFP Tower: MCDU screens not readable yet ({type(e).__name__}: {e})", file=sys.stderr)
                    warned = True
            time.sleep(every)

    threading.Thread(target=loop, daemon=True).start()
