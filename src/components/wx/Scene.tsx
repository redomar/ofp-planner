"use client";

import type { Hour } from "@/lib/wx/forecast";

/**
 * A small illustrated picture of an airport at the planned hour: sky by time of day,
 * sun or moon, mountains for high fields, a cloud layer by low cover, rain or snow,
 * fog by visibility, and a windsock that fills with wind and points downwind.
 * Decorative summary only; the numbers are beside it.
 */
export function Scene({ h, icao, z, headline, elevFt, localHour }: { h: Hour | null; icao: string; z: string; headline: string; elevFt: number | null; localHour: number | null }) {
  const W = 320;
  const H = 200;
  const night = localHour != null && (localHour < 6.5 || localHour >= 19.5);
  const vis = h?.visM ?? 10000;
  const fog = vis < 1000 ? 0.85 : vis < 3000 ? 0.6 : vis < 5000 ? 0.35 : 0;
  const low = (h?.cloudLow ?? 0) / 100;
  const mid = (h?.cloudMid ?? 0) / 100;
  const code = h?.code ?? 0;
  const snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
  const rain = !snow && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95);
  const storm = code >= 95;
  const clear = low + mid < 0.35;
  const mountains = (elevFt ?? 0) >= 1500;
  const kt = h?.windKt ?? 0;
  const fill = Math.min(1, kt / 15);
  // windsock points downwind; on a side view only its left/right lean shows
  const to = (((h?.windDir ?? 0) + 180) % 360) * (Math.PI / 180);
  const dx = Math.sin(to) >= 0 ? 1 : -1;
  const sockLen = 30 * Math.max(0.3, fill);
  const droop = (1 - fill) * 16;
  const plateW = Math.max(130, Math.min(W - 20, headline.length * 6.8 + 22));

  return (
    <svg className={`wb-scene${night ? " night" : ""}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${icao} at ${z}: ${headline}`}>
      <defs>
        <linearGradient id={`sky-${icao}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="sk0" />
          <stop offset="1" className="sk1" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#sky-${icao})`} />
      {clear && !fog && (night ? <circle cx="250" cy="58" r="13" className="sc-moon" /> : <circle cx="250" cy="58" r="17" className="sc-sun" />)}
      {mid > 0.3 && <rect y="34" width={W} height="26" className="sc-cloud mid" opacity={0.25 + mid * 0.45} />}
      {mountains ? (
        <>
          <path className="sc-mtn" d="M0 150 L50 88 L80 114 L122 62 L172 124 L212 78 L262 128 L300 96 L320 112 L320 200 L0 200Z" />
          <path className="sc-snow" d="M113 72 L122 62 L131 72 L126 70 L122 74 L118 70Z M205 86 L212 78 L219 86 L215 84 L212 87 L208 84Z" />
        </>
      ) : (
        <path className="sc-hill" d="M0 154 Q80 136 160 148 T320 144 L320 200 L0 200Z" />
      )}
      {low > 0.1 && <rect y={136 - low * 70} width={W} height={low * 46} className="sc-cloud" opacity={0.35 + low * 0.55} />}
      {(rain || snow) && (
        <g className={snow ? "sc-snowfall" : "sc-rain"}>
          {Array.from({ length: 26 }, (_, i) => {
            const x = 8 + ((i * 37) % W);
            const y = 70 + ((i * 53) % 70);
            return snow ? <circle key={i} cx={x} cy={y} r="1.6" /> : <line key={i} x1={x} y1={y} x2={x - 4} y2={y + 10} />;
          })}
        </g>
      )}
      {storm && <path className="sc-bolt" d="M150 72 L140 98 L150 98 L144 120 L162 90 L152 90 L158 72Z" />}
      <rect y="152" width={W} height="48" className="sc-ground" />
      <rect x="40" y="166" width="240" height="9" className="sc-rwy" />
      <g transform={`translate(${dx > 0 ? 268 : 52} 128)`}>
        <line x1="0" y1="0" x2="0" y2="38" className="sc-pole" />
        <path d={`M0 2 L${dx * sockLen} ${2 + droop} L${dx * sockLen} ${10 + droop} L0 11 Z`} className="sc-sock" />
      </g>
      {fog > 0 && <rect width={W} height={H} className="sc-fog" opacity={fog} />}
      <rect x="8" y="8" width={plateW} height="44" rx="3" className="sc-plate" />
      <text x="16" y="26" className="sc-t">
        {icao} · {z}
      </text>
      <text x="16" y="43" className="sc-s">
        {headline}
      </text>
    </svg>
  );
}
