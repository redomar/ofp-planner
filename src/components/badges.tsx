"use client";

import type { CSSProperties, ReactNode } from "react";
import { aircraft, makerTone } from "@/lib/aircraft";
import { routeColor, textOn } from "@/lib/colors";
import { DAY_NAMES } from "@/lib/data/flight";
import type { AirlineInfo } from "@/lib/data/types";
import { useDisplay, type AirlineTagStyle } from "@/lib/display";
import { cx } from "./ui";

/* ---------- airline name tag (+ flight number) ---------- */

/**
 * The flight's identity: its number or callsign plus the airline's name in a tag in
 * the brand colour. Style and order follow Settings → Display.
 */
export function FlightIdent({
  airline,
  ident,
  fallback,
  style: forced,
  flightFirst: forcedOrder,
}: {
  airline: AirlineInfo | undefined;
  ident: ReactNode;
  /** Shown in the tag when the airline isn't in the manifest. */
  fallback: string;
  style?: AirlineTagStyle;
  flightFirst?: boolean;
}) {
  const d = useDisplay();
  const style = forced ?? d.airlineTag;
  const flightFirst = forcedOrder ?? d.flightFirst;
  const color = routeColor(airline);
  const name = airline?.name ?? fallback;
  const id = <span className="mono ident">{ident}</span>;

  if (style === "split") {
    const brand = (
      <span className="split-al" style={{ background: color, color: textOn(color) }}>
        {name}
      </span>
    );
    return (
      <span className="split-pill">
        {flightFirst ? (
          <>
            {id}
            {brand}
          </>
        ) : (
          <>
            {brand}
            {id}
          </>
        )}
      </span>
    );
  }
  const tag = <AirlineTag name={name} color={color} style={style} />;
  return (
    <span className="ident-row">
      {flightFirst ? (
        <>
          {id}
          {tag}
        </>
      ) : (
        <>
          {tag}
          {id}
        </>
      )}
    </span>
  );
}

export function AirlineTag({ name, color, style }: { name: string; color: string; style: Exclude<AirlineTagStyle, "split"> }) {
  const css: CSSProperties =
    style === "solid" ? { background: color, color: textOn(color) } : ({ ["--c" as string]: color } as CSSProperties);
  return (
    <span className={`al-tag al-${style}`} style={css} title={name}>
      {style === "tint" && <i aria-hidden="true" />}
      {name}
    </span>
  );
}

/* ---------- aircraft type badge with maker tooltip ---------- */

/**
 * An ICAO type as a badge, coloured by manufacturer or by the airline flying it, with a
 * coloured side edge or fully coloured (Settings → Display). Hover or focus shows the
 * manufacturer chip and the full model name.
 */
export function TypeBadge({ type, airline, guessed }: { type: string; airline?: AirlineInfo; guessed?: boolean }) {
  const d = useDisplay();
  const { maker, model } = aircraft(type);
  const tone = makerTone(maker);
  const byAirline = d.typeColour === "airline" && !!airline;
  const brand = routeColor(airline);
  const style: CSSProperties = byAirline
    ? d.typeTheme === "full"
      ? { background: brand, color: textOn(brand), borderColor: brand }
      : ({ ["--c" as string]: brand } as CSSProperties)
    : {};
  const cls = cx("tbadge", d.typeTheme === "side" ? "tb-side" : "tb-full", !byAirline && `tb-${tone}`, byAirline && "tb-brand");
  const text = [maker && model ? `${maker} ${model}.` : "Type not in the catalogue.", `ICAO type designator ${type}.`, guessed ? "The snapshot has no type for this flight; this is the airline's usual type." : null, byAirline ? `Flown by ${airline!.name}.` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={cls}
      style={style}
      tabIndex={0}
      data-tip={text}
      data-tip-title={model && model !== type ? `${type} · ${model}` : type}
      data-tip-chip={maker ?? "Unknown maker"}
      data-tip-chip-color={`var(--${tone === "ink" ? "sunk" : `${tone}-bg`})`}
      data-tip-chip-ink={`var(--${tone})`}
      aria-label={`${type}${model ? `, ${maker} ${model}` : ""}`}
    >
      {type}
    </span>
  );
}

/* ---------- operating days ---------- */

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** How often it flies: "Daily" or "3×" (per week). */
export function freqLabel(days: number[]): string | null {
  if (!days.length) return null;
  return days.length === 7 ? "Daily" : `${days.length}×`;
}

/** The week as seven letter tiles; the days it flies are inked. */
export function WeekStrip({ days }: { days: number[] }) {
  if (!days.length) return <span className="muted">—</span>;
  const names = days.map((d) => DAY_NAMES[d - 1]).join(", ");
  return (
    <span className="wk" role="img" aria-label={days.length === 7 ? "Operates daily" : `Operates ${names}`} title={days.length === 7 ? "Daily" : names}>
      {LETTERS.map((l, i) => (
        <i key={i} className={days.includes(i + 1) ? "on" : undefined} aria-hidden="true">
          {l}
        </i>
      ))}
    </span>
  );
}
