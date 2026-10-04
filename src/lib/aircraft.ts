/** Aircraft type designators → manufacturer and model, plus manufacturer colour tones. */
import data from "./aircraft-data.json";

const CATALOGUE = data as unknown as Record<string, [string, string]>;

export interface AircraftInfo {
  maker: string | null;
  model: string | null;
}
export function aircraft(type: string): AircraftInfo {
  const r = CATALOGUE[type];
  return r ? { maker: r[0], model: r[1] } : { maker: null, model: null };
}

export type Tone = "blue" | "green" | "amber" | "red" | "ink";
/** Manufacturer → badge tone. Categories, distinct in hue and lightness; named in the tooltip. */
export function makerTone(maker: string | null): Tone {
  switch (maker) {
    case "Airbus":
      return "blue";
    case "Boeing":
      return "green";
    case "Embraer":
      return "amber";
    case "ATR":
    case "De Havilland Canada":
      return "red";
    default:
      return "ink";
  }
}
