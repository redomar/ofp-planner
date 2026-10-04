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
