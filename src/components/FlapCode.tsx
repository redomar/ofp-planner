"use client";

import { useEffect, useState } from "react";
import { useReplay } from "./replay";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const STEP_MS = 60;

interface Tile {
  ch: string;
  /** Bumped on every change so the drop-in animation replays. */
  n: number;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * An airport code drawn as split-flap tiles (Solari board). On mount each tile
 * flips through a few random characters and drops onto its letter at a random
 * moment. Mount it with key={code} so a new code replays the animation.
 */
export function FlapCode({ code, label }: { code: string; label?: string }) {
  const chars = code.split("");
  const animate = !reducedMotion();
  const [tiles, setTiles] = useState<Tile[]>(() => chars.map((ch) => ({ ch: animate ? " " : ch, n: 0 })));

  useEffect(() => {
    if (!animate) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    chars.forEach((final, i) => {
      const start = 80 + Math.random() * 520;
      const flips = 3 + Math.floor(Math.random() * 5);
      for (let k = 0; k <= flips; k++) {
        const ch = k === flips ? final : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        timers.push(
          setTimeout(() => {
            setTiles((prev) => prev.map((t, j) => (j === i ? { ch, n: t.n + 1 } : t)));
          }, start + k * STEP_MS),
        );
      }
    });
    return () => timers.forEach(clearTimeout);
    // Runs once per mount; the parent keys this component by code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span className="flap" role="img" aria-label={label ?? code}>
      {tiles.map((t, i) => (
        <span className="flap-tile" key={i} aria-hidden="true">
          <span className="flap-ch" key={t.n}>
            {t.ch}
          </span>
        </span>
      ))}
    </span>
  );
}

/** FlapCode that replays its flip whenever its <Replay> wrapper scrolls back into view. */
export function ReplayFlapCode({ code, label }: { code: string; label?: string }) {
  const round = useReplay();
  return <FlapCode key={`${code}-${round}`} code={code} label={label} />;
}

/** Empty tiles for the blank form. */
export function FlapBlank({ count = 4 }: { count?: number }) {
  return (
    <span className="flap flap-blank" aria-label="blank">
      {Array.from({ length: count }, (_, i) => (
        <span className="flap-tile" key={i} aria-hidden="true" />
      ))}
    </span>
  );
}
