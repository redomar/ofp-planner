"use client";

import type { Hour } from "@/lib/wx/forecast";
import { compass, coverAmount } from "@/lib/wx/category";
import { deg3 } from "@/lib/wx/format";

/** Gusts or mean wind at or above this are drawn in amber (caution). */
const STRONG_KT = 25;

/**
 * Wind dial: a compass ring with the arrow entering from the side the wind comes
 * FROM and pointing downwind. Runway-agnostic. Empty ring while unknown.
 */
export function WindDial({ dir, kt, gust, variable, size = 76 }: { dir: number | null; kt: number | null; gust: number | null; variable?: boolean; size?: number }) {
  const known = kt != null && (dir != null || variable);
  const calm = kt != null && kt < 1;
  const strong = (gust ?? kt ?? 0) >= STRONG_KT;
  const label = !known
    ? "Wind unknown"
    : calm
      ? "Wind calm"
      : `Wind ${variable ? "variable" : `from ${deg3(dir)} degrees (${compass(dir)})`} at ${Math.round(kt!)} knots${gust ? `, gusting ${Math.round(gust)}` : ""}`;
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg className="wx-dial" width={size} height={size} viewBox="-40 -40 80 80" role="img" aria-label={label}>
      <circle r="31" className="wx-dial-ring" />
      {ticks.map((t) => (
        <line key={t} y1={-31} y2={t % 90 === 0 ? -26 : -28.5} transform={`rotate(${t})`} className="wx-dial-tick" />
      ))}
      <text y="-33.5" className="wx-dial-n">
        N
      </text>
      {known && !calm && !variable && dir != null && (
        <g transform={`rotate(${dir})`} className={strong ? "wx-arrow strong" : "wx-arrow"}>
          {/* tail at the upwind edge (top when rotated to `dir`), head pointing downwind */}
          <line y1={-27} y2={14} />
          <path d="M0 22 L-6 10 L6 10 Z" />
        </g>
      )}
      {known && (calm || variable) && (
        <text y="4" className="wx-dial-mid">
          {calm ? "CALM" : "VRB"}
        </text>
      )}
    </svg>
  );
}

/** Cloud column: low / mid / high layers as shaded bands, cover % and amount beside. */
export function CloudColumn({ low, mid, high }: { low: number | null; mid: number | null; high: number | null }) {
  const layers: [string, string, number | null, number][] = [
    ["HIGH", "above ~20,000 ft", high, 8],
    ["MID", "~6,500–20,000 ft", mid, 30],
    ["LOW", "below ~6,500 ft", low, 52],
  ];
  const label = layers.map(([n, , v]) => `${n.toLowerCase()} ${v == null ? "unknown" : `${Math.round(v)}%`}`).join(", ");
  return (
    <svg className="wx-cloudcol" viewBox="0 0 160 78" role="img" aria-label={`Cloud cover: ${label}`}>
      <line x1="0" x2="58" y1="74" y2="74" className="wx-ground" />
      {layers.map(([n, , v, y]) => (
        <g key={n}>
          <rect x="2" y={y} width="54" height="16" rx="2" className="wx-layer-bg" />
          {v != null && <rect x="2" y={y} width="54" height="16" rx="2" className="wx-layer" style={{ opacity: Math.max(0.06, v / 100) }} />}
          <text x="64" y={y + 8} className="wx-layer-n">
            {n}
          </text>
          <text x="158" y={y + 8} className="wx-layer-v">
            {v == null ? "—" : `${coverAmount(v)} ${Math.round(v)}%`}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * 25-hour strip centred on the planned hour: hour ticks (UTC), wind arrows + speed,
 * low/mid/high cloud as shaded cells, precipitation as bars. The planned hour is
 * outlined in magenta.
 */
export function WxStrip({ hours, planned }: { hours: (Hour | null)[]; planned: number }) {
  const W = 24;
  const X0 = 44;
  const width = X0 + hours.length * W + 4;
  const rows = { hour: 10, wind: 32, speed: 55, high: 72, mid: 86, low: 100, precip: 112, precipH: 22 };
  const height = rows.precip + rows.precipH + 4;
  const maxP = Math.max(2, ...hours.map((h) => h?.precipMm ?? 0));
  const known = hours.filter(Boolean) as Hour[];
  const summary = known.length
    ? `24-hour outlook around the planned time: wind ${Math.round(Math.min(...known.map((h) => h.windKt ?? 0)))}–${Math.round(
        Math.max(...known.map((h) => h.gustKt ?? h.windKt ?? 0)),
      )} kt, low cloud up to ${Math.round(Math.max(...known.map((h) => h.cloudLow ?? 0)))}%, precipitation up to ${Math.max(
        ...known.map((h) => h.precipMm ?? 0),
      ).toFixed(1)} mm per hour.`
    : "24-hour outlook: no data";
  return (
    <svg className="wx-strip" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary}>
      {[
        ["Wind", rows.wind + 2],
        ["kt", rows.speed],
        ["High", rows.high],
        ["Mid", rows.mid],
        ["Low", rows.low],
        ["Rain", rows.precip + rows.precipH / 2],
      ].map(([t, y]) => (
        <text key={t} x="0" y={y} className="wx-strip-lab">
          {t}
        </text>
      ))}
      <line x1={X0} x2={width - 4} y1={rows.precip + rows.precipH} y2={rows.precip + rows.precipH} className="wx-ground" />
      {hours.map((h, i) => {
        const x = X0 + i * W;
        const cx = x + W / 2;
        const d = h ? new Date(h.t) : null;
        const strong = (h?.gustKt ?? h?.windKt ?? 0) >= STRONG_KT;
        return (
          <g key={i}>
            {d && d.getUTCHours() % 3 === 0 && (
              <text x={cx} y={rows.hour} className="wx-strip-hr">
                {String(d.getUTCHours()).padStart(2, "0")}
              </text>
            )}
            {h?.windDir != null && h.windKt != null && h.windKt >= 1 && (
              <g transform={`translate(${cx} ${rows.wind}) rotate(${h.windDir})`} className={strong ? "wx-arrow strong" : "wx-arrow"}>
                <line y1={-8} y2={4} />
                <path d="M0 9 L-3.5 2.5 L3.5 2.5 Z" />
              </g>
            )}
            {h?.windKt != null && i % 2 === 0 && (
              <text x={cx} y={rows.speed} className={strong ? "wx-strip-v strong" : "wx-strip-v"}>
                {Math.round(h.gustKt != null && h.gustKt >= h.windKt + 10 ? h.gustKt : h.windKt)}
              </text>
            )}
            {(
              [
                [h?.cloudHigh, rows.high],
                [h?.cloudMid, rows.mid],
                [h?.cloudLow, rows.low],
              ] as const
            ).map(([v, y]) => (
              <g key={y}>
                <rect x={x + 1} y={y - 5.5} width={W - 2} height={11} className="wx-layer-bg" />
                {v != null && <rect x={x + 1} y={y - 5.5} width={W - 2} height={11} className="wx-layer" style={{ opacity: Math.max(0.04, v / 100) }} />}
              </g>
            ))}
            {h?.precipMm != null && h.precipMm > 0 && (
              <rect
                x={x + 4}
                width={W - 8}
                y={rows.precip + rows.precipH - Math.max(1.5, (h.precipMm / maxP) * rows.precipH)}
                height={Math.max(1.5, (h.precipMm / maxP) * rows.precipH)}
                className="wx-precip"
              />
            )}
          </g>
        );
      })}
      <rect x={X0 + planned * W + 0.5} y={1} width={W - 1} height={height - 2} rx="2" className="wx-strip-now" />
    </svg>
  );
}
