/**
 * Airline paint schemes for <AircraftProfile> (lib/profile), keyed by ICAO airline code. Preliminary: colours only
 * (no logos or lettering), from each airline's brand colours where published and photos otherwise.
 * Not used by any page yet.
 */
import type { Airframe, Paint, PaintLayout } from "./profile";

export interface Livery {
  airline: string;
  paint: Paint;
  layout?: PaintLayout;
  /** An airframe the airline flies, for previews. */
  sample: Airframe;
  /** Where the colours come from, and what the scheme leaves out. */
  notes: string;
}

export const LIVERIES: Record<string, Livery> = {
  EZY: {
    airline: "easyJet",
    // "easyOrange", Pantone 021C (trademarked); orange tail, engines and sharklets on white
    paint: { body: "#ffffff", tail: "#ff6600", engines: "#ff6600", wingtips: "#ff6600" },
    sample: { type: "A320", engine: "LEAP", sharklets: true },
    notes: "Pantone 021C orange. Leaves out the logo on the tail and the fuselage lettering.",
  },
  WZZ: {
    airline: "Wizz Air",
    // Wizz Pink and Wizz Purple (approximations: not given in the brand guidelines)
    paint: { body: "#ffffff", tail: "#312782", tailAccent: "#d3007f", engines: "#d3007f", wingtips: "#d3007f" },
    sample: { type: "A321", engine: "LEAP", sharklets: true },
    notes: "Pink #D3007F and purple #312782 are close approximations. Newer aircraft swap the purple for Wizz Cobalt; the tail's swoosh is simplified to a diagonal.",
  },
  SWR: {
    airline: "Swiss",
    paint: { body: "#ffffff", tail: "#e2001a", tailMark: { shape: "cross", color: "#ffffff", size: 0.34 }, wingtips: "#ffffff" },
    sample: { type: "A320", engine: "CFM", sharklets: true },
    notes: "Red tail with the white Swiss cross; no official hex found, #E2001A is the usual Swiss red. Leaves out the fuselage lettering.",
  },
  UAE: {
    airline: "Emirates",
    // the UAE flag on the fin: a red hoist, then green, white and black
    paint: { body: "#ffffff", tail: "#d71921", tailHoist: "#d71921", tailStripes: ["#00732f", "#ffffff", "#000000"], wingtips: "#d71921" },
    sample: { type: "A321", engine: "LEAP", sharklets: true },
    notes: "Emirates flies no A320s: for trying the scheme only. The 2023 livery's flag flows in 3D; here it's flat. Red wingtips as on the 2023 livery. Leaves out the gold lettering.",
  },
};
