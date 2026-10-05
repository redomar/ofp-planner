"use client";

import { useEffect, useRef } from "react";
import { createSway, makeEase, subscribe } from "@/lib/wind/engine";
import { CATS, EASES, PROPOSAL, compute, type Kind } from "@/lib/wind/model";

const ease = makeEase(EASES[PROPOSAL.ease] ?? PROPOSAL.customEase);

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Stable per-arrow seed so each arrow sways differently but the same on every visit. */
function seedOf(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * A wind arrow (pointing where the wind blows to) that sways like a windsock, tuned in
 * the wind lab (/wind-lab, model in lib/wind): faster with more wind, wider and
 * irregular with gusts or a variable sector, and coloured by wind category. It only
 * animates while on screen, and stands still with reduced motion.
 */
export function WindArrow({
  dir,
  spd,
  gust = null,
  sector = null,
  kind,
  size = 16,
  label,
}: {
  dir: number;
  spd: number;
  gust?: number | null;
  /** Variable sector from a METAR "dddVddd" group, degrees. */
  sector?: [number, number] | null;
  kind: Exclude<Kind, "CUSTOM">;
  size?: number;
  label?: string;
}) {
  const d = compute({ kind, raw: "", note: "", dir, spd, gust, sector }, PROPOSAL);
  const shownDir = sector && PROPOSAL.useSector ? d.centre : dir;
  const cat = CATS[d.cat];
  const ref = useRef<HTMLSpanElement>(null);
  const input = { amp: d.amp, chaosAmp: d.chaosAmp, swingMs: d.swingMs, spread: d.kickSpread, ease, seed: seedOf(`${kind}${dir}${spd}${gust}${sector}`), chaos: PROPOSAL.chaos, maxDeg: d.limit + 10 };
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    const eng = createSway(latest.current);
    let stop: (() => void) | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !stop) {
        stop = subscribe((t, dt) => {
          eng.update(latest.current);
          el.style.transform = `rotate(${eng.step(t, dt).angle.toFixed(2)}deg)`;
        });
      } else if (!e.isIntersecting && stop) {
        stop();
        stop = null;
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      stop?.();
    };
  }, []);

  const text = `${label ?? `Wind from ${dir}°`}. ${cat.label} wind.`;
  return (
    <span
      className="wind-arrow"
      style={{ ["--cat" as string]: cat.color }}
      tabIndex={0}
      data-tip={`${label ?? `Wind from ${dir}°`}. ${cat.label}: ${cat.rule(PROPOSAL.calmKt)}.`}
      data-tip-chip={cat.label}
      data-tip-chip-color={cat.color}
      data-tip-chip-ink={cat.ink}
    >
      <span className="wind-sway" ref={ref}>
        <svg width={size} height={size} viewBox="-8 -8 16 16" role="img" aria-label={text}>
          <g transform={`rotate(${shownDir + 180})`}>
            <path d="M0 -7 L4 1 L1 0 L1 7 L-1 7 L-1 0 L-4 1 Z" fill="var(--cat)" stroke="var(--ink)" strokeWidth={size < 24 ? 0.9 : 0.45} strokeLinejoin="round" />
          </g>
        </svg>
      </span>
    </span>
  );
}

/** "050–130" (decoded METAR variable group) → [50, 130]. */
export function parseSector(v: string | null | undefined): [number, number] | null {
  const m = v?.match(/^(\d{3})\D+(\d{3})$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
