/*
 * Wind-arrow model shared by the reader's arrows and the wind lab (/wind-lab):
 * speed → rhythm (bpm), sway amplitudes for gusts / variable sectors / VRB, the
 * chaos share, and the wind categories with their colours. PROPOSAL is the tuned
 * default the reader uses; the lab lets you change every value.
 */

import type { ChaosCfg } from "./engine";

/* ---------------- model ---------------- */

export type Kind = "METAR" | "PWIND" | "AVG" | "CUSTOM";

export interface Sample {
  kind: Kind;
  raw: string;
  note: string;
  dir: number | null; // null = VRB
  spd: number;
  gust: number | null;
  sector: [number, number] | null;
}

export type Mapping = "piecewise" | "linear" | "sqrt" | "log";

export interface Cfg {
  mapping: Mapping;
  anchors: [number, number][]; // [kt, bpm]
  floorBpm: number;
  capBpm: number;
  calmKt: number;
  /** Colour arrows and cards by wind category (otherwise all blue). */
  catColour: boolean;
  capKt: number;
  baseAmp: number;
  ampPerKt: number;
  maxAmp: number;
  useSector: boolean;
  vrbAmp: number;
  ease: string;
  customEase: string;
  beat: "swing" | "cycle";
  speedMul: number;
  size: number;
  randomPhase: boolean;
  guides: boolean;
  paused: boolean;
  reduced: boolean;
  upperDiv: number;
  magVariation: number;
  chaos: ChaosCfg;
  /** Share of the gust / VRB / sector sway handed to the chaos layer (0 = all regular swing). */
  chaosShare: number;
  chaosScope: "gusty" | "all";
  /** Chaos for calm/steady arrows when scope = all, degrees. */
  steadyChaos: number;
  seedRound: number;
}

export const PROPOSAL: Cfg = {
  mapping: "piecewise",
  anchors: [
    [3, 70],
    [10, 130],
    [20, 220],
    [34, 380],
    [45, 500],
  ],
  floorBpm: 70,
  capBpm: 500,
  calmKt: 3,
  catColour: true,
  capKt: 45,
  baseAmp: 3,
  ampPerKt: 1.5,
  maxAmp: 30,
  useSector: true,
  vrbAmp: 40,
  ease: "sine",
  customEase: "cubic-bezier(0.37, 0, 0.63, 1)",
  beat: "swing",
  speedMul: 1,
  size: 72,
  randomPhase: true,
  guides: true,
  paused: false,
  reduced: false,
  upperDiv: 1,
  magVariation: 0,
  chaos: {
    model: "combo",
    freqHz: 0.9,
    freqFromBpm: false,
    freqMul: 0.6,
    kickRate: 0.8,
    kickStrength: 1,
    kickAttackMs: 70,
    kickDecayMs: 380,
    stiffness: 60,
    damping: 6,
    targetRate: 1.2,
  },
  chaosShare: 0.7,
  chaosScope: "gusty",
  steadyChaos: 1.5,
  seedRound: 0,
};

export const EASES: Record<string, string> = {
  linear: "linear",
  ease: "ease",
  "ease-in": "ease-in",
  "ease-out": "ease-out",
  "ease-in-out": "ease-in-out",
  sine: "cubic-bezier(0.37, 0, 0.63, 1)",
  quad: "cubic-bezier(0.45, 0, 0.55, 1)",
  cubic: "cubic-bezier(0.65, 0, 0.35, 1)",
  expo: "cubic-bezier(0.87, 0, 0.13, 1)",
  "back (overshoot)": "cubic-bezier(0.68, -0.4, 0.32, 1.4)",
  "steps(4)": "steps(4, jump-none)",
};

/* ---------------- maths ---------------- */

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function bpmFor(kt: number, c: Cfg) {
  const t = clamp((kt - c.calmKt) / Math.max(1, c.capKt - c.calmKt), 0, 1);
  let bpm: number;
  if (c.mapping === "piecewise") {
    const a = [...c.anchors].sort((x, y) => x[0] - y[0]);
    if (kt <= a[0][0]) bpm = a[0][1];
    else if (kt >= a.at(-1)![0]) bpm = a.at(-1)![1];
    else {
      const i = a.findIndex((p) => p[0] >= kt);
      const [k0, b0] = a[i - 1];
      const [k1, b1] = a[i];
      bpm = b0 + ((kt - k0) / (k1 - k0)) * (b1 - b0);
    }
  } else if (c.mapping === "linear") bpm = c.floorBpm + t * (c.capBpm - c.floorBpm);
  else if (c.mapping === "sqrt") bpm = c.floorBpm + Math.sqrt(t) * (c.capBpm - c.floorBpm);
  else bpm = c.floorBpm + (Math.log1p(t * 9) / Math.log(10)) * (c.capBpm - c.floorBpm);
  return clamp(bpm, c.floorBpm, c.capBpm);
}

export type Cat = "calm" | "light" | "moderate" | "high" | "gale" | "storm";

/**
 * Wind categories on the weather-severity ramp: grey still air, green gentle, then the
 * Met Office warning colours yellow → amber → red, and purple for storm (beyond red,
 * as on wind maps). Fills are vivid, so arrows carry an ink outline and badges are
 * filled chips whose text colour (--wc-*-ink) passes AA. Neighbouring colours stay
 * apart for red-green and blue-yellow colour blindness too.
 */
export const CATS: Record<Cat, { label: string; color: string; ink: string; rule: (calmKt: number) => string }> = {
  calm: { label: "Calm", color: "var(--wc-calm)", ink: "var(--wc-calm-ink)", rule: (c) => `≤ ${c} kt` },
  light: { label: "Light", color: "var(--wc-light)", ink: "var(--wc-light-ink)", rule: (c) => `${c + 1}–10 kt` },
  moderate: { label: "Moderate", color: "var(--wc-moderate)", ink: "var(--wc-moderate-ink)", rule: () => "11–19 kt" },
  high: { label: "High", color: "var(--wc-high)", ink: "var(--wc-high-ink)", rule: () => "≥ 20 kt or gusts ≥ 28" },
  gale: { label: "Gale", color: "var(--wc-gale)", ink: "var(--wc-gale-ink)", rule: () => "≥ 34 kt or gusts ≥ 43" },
  storm: { label: "Storm", color: "var(--wc-storm)", ink: "var(--wc-storm-ink)", rule: () => "≥ 48 kt" },
};

/** High = Met Office strong-wind warning (20 kt mean / 28 kt gusts); gale (34 / 43) and storm (48, force 10); calm from the config. */
export function category(kt: number, gust: number | null, calmKt: number): Cat {
  const g = gust ?? 0;
  if (kt >= 48) return "storm";
  if (kt >= 34 || g >= 43) return "gale";
  if (kt >= 20 || g >= 28) return "high";
  if (kt > 10) return "moderate";
  if (kt > calmKt) return "light";
  return "calm";
}

export function compute(s: Sample, c: Cfg) {
  const scaleKt = s.kind === "AVG" ? s.spd / Math.max(1, c.upperDiv) : s.spd;
  const bpm = bpmFor(scaleKt, c);
  const swingMs = (c.beat === "swing" ? 60000 : 30000) / bpm;
  const spread = s.gust != null ? s.gust - s.spd : 0;
  const chaosOn = c.chaos.model !== "none";
  const share = chaosOn ? c.chaosShare : 0;

  // "Unsteady" sway = what gusts, a variable sector or VRB add on top of the base sway.
  let unsteady = s.gust != null ? c.ampPerKt * spread : 0;
  let sectorHalf: number | null = null;
  let centre = s.dir ?? 0;
  let why = s.gust != null ? "gust" : "base";
  if (s.sector && c.useSector) {
    let w = s.sector[1] - s.sector[0];
    if (w < 0) w += 360;
    sectorHalf = w / 2;
    centre = (s.sector[0] + sectorHalf) % 360;
    if (sectorHalf - c.baseAmp > unsteady) {
      unsteady = sectorHalf - c.baseAmp;
      why = "sector";
    }
  }
  if (s.dir == null) {
    unsteady = c.vrbAmp - c.baseAmp;
    why = "VRB";
  }
  unsteady = Math.max(0, unsteady);
  const limit = s.dir == null ? Math.max(c.maxAmp, c.vrbAmp) : c.maxAmp;
  let amp = Math.min(limit, c.baseAmp + unsteady * (1 - share));
  let chaosAmp = Math.min(limit, unsteady * share);
  if (chaosOn && c.chaosScope === "all" && unsteady === 0) chaosAmp = c.steadyChaos;
  if (!chaosOn) {
    amp = Math.min(limit, c.baseAmp + unsteady);
    chaosAmp = 0;
  }
  // VRB/kick spread equivalent for kick rate
  const kickSpread = s.dir == null ? 10 : sectorHalf != null && why === "sector" ? sectorHalf / 4 : spread;
  // AVG WIND is categorised on the same scaled speed that drives its rhythm.
  const cat = category(scaleKt, s.gust != null && s.kind !== "AVG" ? s.gust : null, c.calmKt);
  return { scaleKt, bpm, swingMs, cycleHz: 1000 / (swingMs * 2), spread, amp, chaosAmp, sectorHalf, centre, cat, why, kickSpread, limit };
}
