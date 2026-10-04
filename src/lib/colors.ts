import type { AirlineInfo } from "./data/types";

/** Neutral route colour when an airline has no brand colour in the snapshot. */
export const FALLBACK_ROUTE = "#6b7a90";

/** The airline's brand colour for its route lines and colour bars (decorative; maps add a casing for contrast). */
export function routeColor(a: AirlineInfo | undefined | null): string {
  const c = a?.colors?.primary;
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : FALLBACK_ROUTE;
}
