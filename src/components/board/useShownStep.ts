"use client";

import { useState } from "react";
import type { GateState } from "@/lib/board/gate";
import { stepAt, type Layers, type Turns } from "@/lib/board/looks";
import type { FlightPlan, FlightState } from "@/lib/feed/core";
import { shownTurns } from "./GateViews";

export interface ShownStep {
  ls: Layers;
  /** Changes with the stage, the scene, the rotation and its step: a new key fades the step in. */
  key: string;
  /** When this step began (ms), for a flip card's back sides. */
  from: number;
  turns: Turns;
}

/**
 * 1.15: what a screen shows now, one rule for the OBS screen and the page's preview: the stage's
 * looks (view=auto: hold, then the scene rule, then the stage table) and, when they rotate, the
 * step from when the stage (or scene, or rotation) began on this page.
 */
export function useShownStep(g: Pick<GateState, "view" | "stages" | "scenes" | "hold">, live: FlightState | null, scene: string | null, plan: FlightPlan | null, now: number): ShownStep {
  const shown = shownTurns(g, live, scene, plan);
  // reset while rendering when the key changes, from the page's clock (React's pattern for state that follows a prop)
  const [from, setFrom] = useState<{ key: string; at: number } | null>(null);
  if (from?.key !== shown.key) setFrom({ key: shown.key, at: now });
  const at = from?.key === shown.key ? from.at : now;
  const step = stepAt(shown.turns, now - at);
  return { ls: step.ls, key: `${shown.key}#${step.i}.${step.alt}`, from: at + step.from, turns: shown.turns };
}
