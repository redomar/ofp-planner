"use client";

import { useEffect, useState } from "react";

/** True once web fonts have loaded, so text measured after that uses the real face. */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);
  return ready;
}

let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

/**
 * Width in px of the widest of `texts` set in the condensed label face (the airline tag's
 * font: Barlow Condensed 700, uppercase, 0.05em tracking) at `size` px.
 */
export function widestLabel(texts: Iterable<string>, size = 13): number {
  if (typeof document === "undefined") return 0;
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return 0;
  const family = getComputedStyle(document.documentElement).getPropertyValue("--f-cond").trim() || "sans-serif";
  ctx.font = `700 ${size}px ${family}`;
  let max = 0;
  for (const t of texts) {
    const key = `${ctx.font}|${t}`;
    let w = cache.get(key);
    if (w == null) {
      const s = t.toUpperCase();
      w = ctx.measureText(s).width + s.length * size * 0.05;
      cache.set(key, w);
    }
    if (w > max) max = w;
  }
  return Math.ceil(max);
}
