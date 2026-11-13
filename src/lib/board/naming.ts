/** 1.13: the airline's names as the user gave them. No imports at run time (the tests load it as it is). */
import type { GateFlight } from "./gate";

/**
 * 1.13: the flight with the names the user gave: the airline's name on the screen, and its code at
 * the front of the flight number ("W4 5PL" for "W6 5PL"). Unchanged when neither is set.
 */
export function namedFlight(f: GateFlight, an: string, ac: string): GateFlight {
  if (!an && !ac) return f;
  const flightNo = ac ? (/^\S+\s+\S/.test(f.flightNo) ? f.flightNo.replace(/^\S+/, ac) : `${ac} ${f.flightNo}`) : f.flightNo;
  return { ...f, airline: an || f.airline, flightNo };
}
