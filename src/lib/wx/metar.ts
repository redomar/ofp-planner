/**
 * Current METAR from VATSIM's public METAR service (CORS-enabled, no key):
 * https://metar.vatsim.net/<ICAO>?format=json → [{ id, metar }]. It's the real-world
 * METAR as used on the VATSIM network, which is also what most sims inject live.
 * Decoding covers the essentials only; the raw report is always shown beside it.
 */
import { cacheGet, cachePut } from "./cache";
import { flightCategory, type Category } from "./category";

const API = "https://metar.vatsim.net/";

export interface CloudLayer {
  amount: string; // FEW SCT BKN OVC VV
  baseFt: number | null;
  type: string | null; // CB / TCU
}

export interface Metar {
  raw: string;
  /** Observation time (ms), from the DDHHMMZ group. */
  observed: number | null;
  windDir: number | null; // null with VRB
  variable: boolean;
  windKt: number | null;
  gustKt: number | null;
  visM: number | null;
  cavok: boolean;
  clouds: CloudLayer[];
  /** Present-weather groups as written (-RA, TSRA, BR…). */
  weather: string[];
  temp: number | null;
  dew: number | null;
  qnh: number | null; // hPa
  ceilingFt: number | null;
  category: Category | null;
}

const KT: Record<string, number> = { KT: 1, MPS: 1.943844, KMH: 0.539957 };

/** DDHHMM in the current or previous month, as ms. */
function obsTime(dd: number, hh: number, mm: number, now = new Date()): number {
  let t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dd, hh, mm);
  if (t > now.getTime() + 86400_000) t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, dd, hh, mm);
  return t;
}

export function decodeMetar(raw: string): Metar {
  const m: Metar = {
    raw,
    observed: null,
    windDir: null,
    variable: false,
    windKt: null,
    gustKt: null,
    visM: null,
    cavok: false,
    clouds: [],
    weather: [],
    temp: null,
    dew: null,
    qnh: null,
    ceilingFt: null,
    category: null,
  };
  // ignore the trend / remarks
  const body = raw.split(/\s(?:BECMG|TEMPO|NOSIG|RMK)\b/)[0];
  for (const tok of body.trim().split(/\s+/)) {
    let r: RegExpMatchArray | null;
    if ((r = tok.match(/^(\d{2})(\d{2})(\d{2})Z$/))) m.observed = obsTime(+r[1], +r[2], +r[3]);
    else if ((r = tok.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/))) {
      const f = KT[r[4]];
      m.variable = r[1] === "VRB";
      m.windDir = m.variable ? null : +r[1];
      m.windKt = Math.round(+r[2] * f);
      m.gustKt = r[3] ? Math.round(+r[3] * f) : null;
    } else if (tok === "CAVOK") {
      m.cavok = true;
      m.visM = 10000;
    } else if ((r = tok.match(/^(\d{4})(?:NDV)?$/)) && m.visM == null) m.visM = +r[1] === 9999 ? 10000 : +r[1];
    else if ((r = tok.match(/^(?:(\d+)\s?)?(?:(\d)\/(\d))?SM$/)) || (r = tok.match(/^P?(\d+)SM$/))) {
      const whole = r[1] ? +r[1] : 0;
      const frac = r[2] && r[3] ? +r[2] / +r[3] : 0;
      m.visM = Math.round((whole + frac) * 1609.344);
    } else if ((r = tok.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$/)))
      m.clouds.push({ amount: r[1], baseFt: r[2] === "///" ? null : +r[2] * 100, type: r[3] ?? null });
    else if ((r = tok.match(/^(M?\d{2})\/(M?\d{2})?$/))) {
      const t = (s: string) => (s.startsWith("M") ? -Number(s.slice(1)) : Number(s));
      m.temp = t(r[1]);
      m.dew = r[2] ? t(r[2]) : null;
    } else if ((r = tok.match(/^Q(\d{4})$/))) m.qnh = +r[1];
    else if ((r = tok.match(/^A(\d{4})$/))) m.qnh = Math.round(+r[1] * 0.338639);
    else if (/^(?:[-+]|VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+$/.test(tok) || tok === "TS")
      m.weather.push(tok);
  }
  const ceil = m.clouds.filter((c) => /BKN|OVC|VV/.test(c.amount) && c.baseFt != null).map((c) => c.baseFt!);
  m.ceilingFt = ceil.length ? Math.min(...ceil) : null;
  m.category = m.visM != null || m.clouds.length || m.cavok ? flightCategory(m.ceilingFt, m.visM) : null;
  return m;
}

/** Plain-English gloss of common present-weather groups. */
export function weatherText(code: string): string {
  const parts: [RegExp, string][] = [
    [/^-/, "light "],
    [/^\+/, "heavy "],
    [/VC/, "nearby "],
    [/MI/, "shallow "],
    [/BC/, "patches of "],
    [/DR/, "drifting "],
    [/BL/, "blowing "],
    [/SH/, "showers of "],
    [/TS/, "thunderstorm "],
    [/FZ/, "freezing "],
    [/DZ/, "drizzle "],
    [/RA/, "rain "],
    [/SN/, "snow "],
    [/SG/, "snow grains "],
    [/PL/, "ice pellets "],
    [/GR/, "hail "],
    [/GS/, "small hail "],
    [/BR/, "mist "],
    [/FG/, "fog "],
    [/HZ/, "haze "],
    [/FU/, "smoke "],
    [/DU/, "dust "],
    [/SA/, "sand "],
    [/SQ/, "squalls "],
  ];
  const s = parts.filter(([re]) => re.test(code)).map(([, t]) => t).join("").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : code;
}

export async function fetchMetar(
  icao: string,
  { force = false, signal }: { force?: boolean; signal?: AbortSignal } = {},
): Promise<{ data: string | null; at: number }> {
  if (!force) {
    const hit = cacheGet<string | null>(icao, "metar");
    if (hit) return hit;
  }
  const res = await fetch(`${API}${encodeURIComponent(icao)}?format=json`, { signal });
  if (!res.ok) throw new Error(`METAR service replied ${res.status}.`);
  const j = await res.json().catch(() => null);
  const raw = Array.isArray(j) && typeof j[0]?.metar === "string" ? (j[0].metar as string).trim() : null;
  const at = Date.now();
  cachePut(icao, "metar", raw, at);
  return { data: raw, at };
}
