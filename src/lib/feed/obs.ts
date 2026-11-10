"use client";

import { useEffect, useState } from "react";

/**
 * The OBS scene this page is showing in, when it runs as an OBS browser source (OBS adds
 * window.obsstudio there; anywhere else this returns null and does nothing). Reading the current
 * scene needs the source's Page permissions set to at least "Read access to user information";
 * the obsSceneChanged event then follows every switch.
 *
 * Untested in OBS from here: built on OBS's documented browser-source API.
 */
interface ObsStudio {
  getCurrentScene?: (cb: (scene: { name?: string } | null) => void) => void;
}

export function useObsScene(): string | null {
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => {
    const obs = (window as unknown as { obsstudio?: ObsStudio }).obsstudio;
    if (!obs) return;
    let live = true;
    try {
      obs.getCurrentScene?.((s) => live && setScene(s?.name ?? null));
    } catch {
      /* no permission: the event below still tells us on the next switch */
    }
    const onChange = (e: Event) => {
      const name = (e as CustomEvent<{ name?: string }>).detail?.name;
      if (typeof name === "string") setScene(name);
    };
    window.addEventListener("obsSceneChanged", onChange);
    return () => {
      live = false;
      window.removeEventListener("obsSceneChanged", onChange);
    };
  }, []);
  return scene;
}

/** Inside OBS? (for the Stream panel to say whether the scene rules can work here) */
export const inObs = () => typeof window !== "undefined" && "obsstudio" in window;
