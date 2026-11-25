import type { AirlineInfo } from "./data/types";

/** Neutral route colour when an airline has no brand colour in the snapshot. */
export const FALLBACK_ROUTE = "#6b7a90";

/** The airline's brand colour for its route lines and colour bars (decorative; maps add a casing for contrast). */
export function routeColor(a: AirlineInfo | undefined | null): string {
  const c = a?.colors?.primary;
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : FALLBACK_ROUTE;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * Text colour on a brand-coloured fill: black or white, whichever contrasts more.
 * Pure black/white guarantees at least 4.58:1 for any fill (WCAG AA for normal text).
 */
export function textOn(hex: string): "#000000" | "#ffffff" {
  const l = luminance(hex);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#ffffff";
}

/** Contrast ratio between two colours (1–21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Hue (0–360), saturation and lightness (0–1) of a hex colour. */
function hsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};
const HIGHLIGHTS = ["#FFD400", "#FF8A00", "#9BE22D", "#22C7E8", "#2F6BFF", "#E0218A"];

/**
 * 1.17.4: a highlight that contrasts with an airline's colour (SAS blue → yellow, easyJet orange →
 * cyan): its own second colour when that is a strong colour well round the wheel (Ryanair's yellow,
 * BA's red), else the vivid highlight furthest round from it; yellow for a colour without a hue.
 */
export function highlightFor(primary: string, secondary?: string | null): string {
  const ok = (h: string | null | undefined): h is string => !!h && /^#[0-9a-f]{6}$/i.test(h);
  if (!ok(primary)) return HIGHLIGHTS[0];
  const [hp, sp] = hsl(primary);
  if (ok(secondary)) {
    const [h2, s2, l2] = hsl(secondary);
    if (s2 > 0.45 && l2 > 0.25 && l2 < 0.75 && hueGap(hp, h2) >= 120) return secondary;
  }
  if (sp < 0.2) return HIGHLIGHTS[0];
  return HIGHLIGHTS.reduce((best, c) => (hueGap(hp, hsl(c)[0]) > hueGap(hp, hsl(best)[0]) ? c : best));
}
