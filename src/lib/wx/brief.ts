/**
 * Turning a forecast hour into the brief's words: a one-line summary, hazard badges, advice
 * across both ends, and the hour coded like a METAR (marked FCST, an estimate).
 */
import { wmoSevere, wmoText, type Category } from "./category";
import type { Forecast, Hour } from "./forecast";
import { hourAt } from "./forecast";
import { deg3, vis } from "./format";

export const CAT_RANK: Record<Category, number> = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };

export type HazTone = "red" | "amber" | "blue" | "green";
export interface Hazard {
  tone: HazTone;
  label: string;
  note: string;
}

/** "Fog · vis 300 m · sky obscured" / "Clear sky · calm". */
export function summary(h: Hour | null): string {
  if (!h) return "No forecast";
  const parts: string[] = [];
  parts.push(wmoText(h.code) ?? "Weather");
  if (h.visM != null && h.visM < 9999) parts.push(`vis ${vis(h.visM)}`);
  if (h.ceilingFt === 0) parts.push("sky obscured");
  else if (h.ceilingFt != null && h.ceilingFt < 5000) parts.push(`cloud ${h.ceilingFt.toLocaleString("en-GB")} ft`);
  if (h.windKt != null) parts.push(h.windKt < 3 ? "calm" : h.windKt >= 15 ? `wind ${Math.round(h.windKt)} kt` : "");
  return parts.filter(Boolean).join(" · ");
}

/** Short headline for the picture: conditions, plus the cloud state. */
export function headline(h: Hour | null): string {
  if (!h) return "No forecast";
  const c = h.ceilingFt;
  return `${wmoText(h.code) ?? "Weather"}${c === 0 ? ", sky obscured" : c != null ? `, cloud at ${c.toLocaleString("en-GB")} ft` : ""}`;
}

export function hazards(h: Hour | null): Hazard[] {
  if (!h) return [];
  const out: Hazard[] = [];
  const spread = h.temp != null && h.dew != null ? h.temp - h.dew : null;
  if (h.visM != null && h.visM < 1500) out.push({ tone: "red", label: "Low visibility", note: "Under 1,500 m: expect low-visibility procedures; plan an ILS / autoland." });
  if (h.ceilingFt === 0) out.push({ tone: "red", label: "Sky obscured", note: "Cloud base at the surface." });
  else if (h.ceilingFt != null && h.ceilingFt < 500) out.push({ tone: "red", label: "Low cloud", note: `Cloud base about ${h.ceilingFt} ft (estimated).` });
  if (spread != null && spread < 1.5 && !(h.visM != null && h.visM < 1000)) out.push({ tone: "amber", label: "Fog risk", note: "Temperature and dew point within 1.5 °C." });
  if (h.gustKt != null && h.windKt != null && h.gustKt >= h.windKt + 10) out.push({ tone: "amber", label: "Gusts", note: `Gusting ${Math.round(h.gustKt)} kt.` });
  if (h.windKt != null && h.windKt >= 25) out.push({ tone: "amber", label: "Strong wind", note: `${Math.round(h.windKt)} kt mean wind.` });
  if (wmoSevere(h.code)) out.push({ tone: "red", label: "Severe weather", note: `${wmoText(h.code)} forecast.` });
  if (h.temp != null && h.temp <= 2 && ((h.precipMm ?? 0) > 0 || (spread ?? 9) < 3)) out.push({ tone: "amber", label: "Icing risk", note: "Near-freezing and moist: check anti-ice." });
  if ((h.precipProb ?? 0) >= 40 && !wmoSevere(h.code)) out.push({ tone: "blue", label: "Precip", note: `${Math.round(h.precipProb!)}% chance of precipitation.` });
  if (!out.length) out.push({ tone: "green", label: "No hazards", note: "Nothing notable forecast." });
  return out;
}

/** First hour after `from` (within `span` h) whose category is MVFR or better. */
export function clearsAt(fc: Forecast, fromMs: number, span = 12): Hour | null {
  for (let i = 0; i < fc.time.length; i++) {
    const t = fc.time[i] * 1000;
    if (t <= fromMs) continue;
    if (t > fromMs + span * 3600_000) break;
    const h = hourAt(fc, i);
    if (h.category && CAT_RANK[h.category] <= 1) return h;
  }
  return null;
}

/** One or two plain sentences across both ends. */
export function advice(dep: { icao: string; h: Hour | null; fc: Forecast | null; at: number | null }, arr: { icao: string; h: Hour | null }): string {
  const s: string[] = [];
  const bad = (h: Hour | null) => !!h?.category && CAT_RANK[h.category] >= 2;
  const lowVis = (h: Hour | null) => (h?.visM != null && h.visM < 1500) || h?.ceilingFt === 0;
  if (lowVis(dep.h)) s.push(`Expect low-visibility procedures at ${dep.icao}.`);
  else if (bad(dep.h)) s.push(`Instrument departure conditions at ${dep.icao}.`);
  if (bad(dep.h) && dep.fc && dep.at != null) {
    const c = clearsAt(dep.fc, dep.at);
    if (c) s.push(`A departure after ${new Date(c.t).toISOString().slice(11, 13)}Z is ${c.category}.`);
  }
  if (lowVis(arr.h)) s.push(`Low visibility at ${arr.icao}: plan an ILS / autoland and alternate fuel.`);
  else if (bad(arr.h)) s.push(`Plan an instrument approach at ${arr.icao}.`);
  for (const [icao, h] of [
    [dep.icao, dep.h],
    [arr.icao, arr.h],
  ] as const)
    if (h?.gustKt != null && h.windKt != null && h.gustKt >= h.windKt + 10) s.push(`Gusts to ${Math.round(h.gustKt)} kt at ${icao}.`);
  return s.length ? s.join(" ") : "No significant weather at either end.";
}

/** The forecast hour coded like a METAR (est.): FCST EGKK 060724Z 00000KT 0300 FG VV001 12/12 Q1021. */
export function fcstLine(icao: string, h: Hour, at: number): string {
  const d = new Date(at);
  const stamp = `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
  const kt = Math.round(h.windKt ?? 0);
  const wind = kt < 1 ? "00000KT" : `${deg3(h.windDir) ?? "VRB"}${String(kt).padStart(2, "0")}${h.gustKt != null && h.gustKt >= kt + 10 ? `G${Math.round(h.gustKt)}` : ""}KT`;
  const v = h.visM ?? 10000;
  const code = h.code ?? 0;
  const wx =
    code === 45 || code === 48 ? (v < 1000 ? "FG" : "BR")
    : code >= 95 ? "TSRA"
    : code >= 71 && code <= 77 ? "SN"
    : code >= 85 && code <= 86 ? "SHSN"
    : code >= 80 && code <= 82 ? "SHRA"
    : code >= 61 && code <= 67 ? (code === 65 ? "+RA" : code === 61 ? "-RA" : "RA")
    : code >= 51 && code <= 57 ? "DZ"
    : "";
  const low = h.cloudLow ?? 0;
  const mid = h.cloudMid ?? 0;
  const amt = (p: number) => (p >= 88 ? "OVC" : p >= 50 ? "BKN" : p >= 25 ? "SCT" : "FEW");
  const cloud = h.ceilingFt === 0 || (wx === "FG" && h.ceilingFt == null) ? "VV001" : h.ceilingFt != null ? `${amt(Math.max(low, mid))}${String(Math.max(1, Math.round(h.ceilingFt / 100))).padStart(3, "0")}` : low >= 10 ? `${amt(low)}030` : mid >= 10 ? `${amt(mid)}080` : "";
  const cavok = v >= 9999 && !wx && low < 10 && mid < 10;
  const tt = (n: number | null) => (n == null ? "//" : (n < 0 ? "M" : "") + String(Math.abs(Math.round(n))).padStart(2, "0"));
  return ["FCST", icao, stamp, wind, ...(cavok ? ["CAVOK"] : [v >= 9999 ? "9999" : String(Math.round(v / 100) * 100).padStart(4, "0"), wx, cloud || "NSC"]), `${tt(h.temp)}/${tt(h.dew)}`, h.qnh != null ? `Q${Math.round(h.qnh)}` : ""]
    .filter(Boolean)
    .join(" ");
}

/** METAR / FCST token classes for colouring (wind, visibility, weather, cloud, temperature, QNH). */
export function tokenClass(t: string): string | null {
  if (/KT$/.test(t)) return "tk-wind";
  if (/^\d{4}$/.test(t) || t === "CAVOK" || /^\d{3}V\d{3}$/.test(t)) return "tk-vis";
  if (/^[-+]?(VC)?(MI|BC|SH|TS|FZ)?(DZ|RA|SN|SG|PL|GR|GS|BR|FG|FU|HZ|SQ|FC|TS)+$/.test(t)) return "tk-wx";
  if (/^(FEW|SCT|BKN|OVC|VV|NSC|NCD|SKC|CLR)/.test(t)) return "tk-cld";
  if (/^M?\d\d\/M?\d\d$|\/\//.test(t)) return "tk-temp";
  if (/^[QA]\d{4}$/.test(t)) return "tk-q";
  return null;
}
