"use client";

import { useId, useMemo } from "react";
import { drawAircraft, FIXED, PLAIN, type Airframe, type DrawOptions, type Paint } from "@/lib/profile";

/**
 * An A320-family aircraft from the side, in any paint (see lib/profile for the slots and lib/liveries
 * for airline schemes). It scales to its container's width; on the default frame every type shares
 * one scale, so an A321 is drawn longer than an A319. Not used by any page yet.
 */
export function AircraftProfile({
  airframe,
  paint = PLAIN,
  layout,
  fixed,
  frame,
  label,
  className,
}: {
  airframe: Airframe;
  paint?: Paint;
  label: string;
  className?: string;
} & DrawOptions) {
  // clip paths are looked up by id across the page: each drawing needs its own
  const id = useId().replace(/:/g, "");
  const dr = useMemo(() => drawAircraft(airframe, paint, { layout, fixed, frame }), [airframe, paint, layout, fixed, frame]);
  const line = fixed?.line ?? FIXED.line;
  return (
    <svg className={className} viewBox={dr.viewBox.join(" ")} role="img" aria-label={label} style={{ display: "block", width: "100%", height: "auto" }}>
      <defs>
        <clipPath id={`${id}-body`}>
          <path d={dr.body} />
        </clipPath>
        <clipPath id={`${id}-fin`}>
          <path d={dr.fin} />
        </clipPath>
      </defs>
      <g transform="scale(1 -1)">
        {dr.parts.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill={p.fill}
            clipPath={p.clip ? `url(#${id}-${p.clip})` : undefined}
            stroke={p.stroke ?? (p.line ? line : undefined)}
            strokeWidth={p.stroke ? 0.9 : p.line ? 0.8 : undefined}
            strokeLinejoin="round"
            vectorEffect={p.stroke || p.line ? "non-scaling-stroke" : undefined}
          />
        ))}
      </g>
    </svg>
  );
}
