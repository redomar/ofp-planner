/**
 * Side views of the sim A320 family, as plain shape data: no React, so a component and a preview
 * script draw the same aircraft. Not used by any page yet.
 *
 * Everything is in metres, nose tip at x = 0, y up from the fuselage centreline. The nose, tail cone,
 * fin, tailplane, doors, over-wing exits and engine positions are measured from the side views in
 * "Airbus A32X family v1.0" (Wikimedia Commons, CC BY-SA 3.0), scaled by its dimension lines; the
 * wing and nacelle outlines are drawn to match their positions there. Lengths are true per type, so
 * an A321 is drawn longer than an A319 at the same scale.
 *
 * Paint is a set of slots (see SLOTS): only body and tail are required, the rest fall back.
 */

export type AircraftType = "A319" | "A320" | "A321";
export type EngineType = "CFM" | "IAE" | "LEAP";

/** What changes the outline: extra centre tanks don't, so the Fenix A321's ACT options share one. */
export interface Airframe {
  type: AircraftType;
  engine: EngineType;
  sharklets: boolean;
}

/** A simple shape on the fin, centred in its upper half (a logo stand-in). */
export interface TailMark {
  shape: "cross" | "disc" | "bar";
  color: string;
  /** Size as a share of the fin's height above the roof; default 0.3. */
  size?: number;
}

/** Colours by slot. Any CSS colour. */
export interface Paint {
  /** Upper fuselage: the livery's base colour. */
  body: string;
  /** Lower fuselage, below `bellySplit`. Default: body. */
  belly?: string;
  /** A band along the fuselage under the windows. Default: none. */
  cheatline?: string;
  /** The radome, in front of the windscreen. Default: body. */
  nose?: string;
  /** The fin: the colour that says which airline it is. */
  tail: string;
  /** The fin below a diagonal from its leading edge to the rudder. Default: none. */
  tailAccent?: string;
  /** Bands across the fin, top to bottom, behind `tailHoist` if set (a flag). Default: none. */
  tailStripes?: string[];
  /** A band along the fin's leading edge, in front of the stripes (a flag's hoist). Default: none. */
  tailHoist?: string;
  /** A shape on the fin. Default: none. */
  tailMark?: TailMark;
  /** Nacelle cowls; the inlet lip stays metal. Default: body. */
  engines?: string;
  /** Sharklets or wingtip fences. Default: tail. */
  wingtips?: string;
}

/** Where the paint lines fall (metres from the centreline). */
export interface PaintLayout {
  /** Belly below this height; default −0.9. */
  bellySplit?: number;
  /** Cheatline from this height, `cheatlineHeight` tall; default −0.62 and 0.36. */
  cheatlineY?: number;
  cheatlineHeight?: number;
}

/** Parts no livery changes. Any of them can still be overridden. */
export interface Fixed {
  /** Wing, tailplane, pylons. */
  metal: string;
  /** Engine core cowl and exhaust plug. */
  metalDark: string;
  /** Windows and cockpit glass. */
  glass: string;
  /** Engine inlet lips. */
  lip: string;
  /** Outlines and door lines. */
  line: string;
}

export const FIXED: Fixed = { metal: "#c3c8cd", metalDark: "#9aa1a8", glass: "#27323d", lip: "#d9dde1", line: "rgba(20, 28, 38, 0.55)" };

/** The unpainted aircraft: the template before paint. */
export const PLAIN: Paint = { body: "#f7f7f5", tail: "#f7f7f5" };

/** The paint slots, numbered as on the slot diagram. */
export const SLOTS: { n: number; key: keyof Paint; name: string; required: boolean; fallback: string; note: string }[] = [
  { n: 1, key: "body", name: "Body", required: true, fallback: "", note: "Upper fuselage: the base colour of the livery." },
  { n: 2, key: "belly", name: "Belly", required: false, fallback: "body", note: "Lower fuselage below the split line (layout.bellySplit, −0.9 m)." },
  { n: 3, key: "cheatline", name: "Cheatline", required: false, fallback: "none", note: "A band along the fuselage under the windows." },
  { n: 4, key: "nose", name: "Nose", required: false, fallback: "body", note: "The radome, in front of the windscreen." },
  { n: 5, key: "tail", name: "Tail", required: true, fallback: "", note: "The fin. The one colour that says which airline it is." },
  { n: 6, key: "tailAccent", name: "Tail accent", required: false, fallback: "none", note: "The fin below a diagonal from the leading edge to the rudder." },
  { n: 7, key: "tailStripes", name: "Tail stripes", required: false, fallback: "none", note: "Bands across the fin, top to bottom (a flag), behind the hoist." },
  { n: 8, key: "tailHoist", name: "Tail hoist", required: false, fallback: "none", note: "A band along the fin's leading edge, in front of the stripes." },
  { n: 9, key: "tailMark", name: "Tail mark", required: false, fallback: "none", note: "A cross, disc or bar on the fin, in its own colour." },
  { n: 10, key: "engines", name: "Engines", required: false, fallback: "body", note: "Nacelle cowls. The inlet lip stays metal." },
  { n: 11, key: "wingtips", name: "Wingtips", required: false, fallback: "tail", note: "Sharklets or wingtip fences." },
];

/** One shape to draw. `clip` keeps it inside the fuselage or the fin. `line` outlines it. */
export interface Part {
  d: string;
  fill: string;
  line?: boolean;
  clip?: "body" | "fin";
  /** An outline only (no fill), e.g. a door. */
  stroke?: string;
}

export interface Drawing {
  /** viewBox in metres, y already flipped for SVG (draw the parts inside `scale(1 -1)`). */
  viewBox: [number, number, number, number];
  /** Outlines for the clip paths. */
  body: string;
  fin: string;
  parts: Part[];
}

/* ---------- measurements ---------- */

const f = (n: number) => +n.toFixed(3);
const pts = (a: [number, number][]) => a.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L ");
const rect = (x: number, y: number, w: number, h: number, r = 0) =>
  r
    ? `M ${f(x + r)} ${f(y)} H ${f(x + w - r)} Q ${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)} V ${f(y + h - r)} Q ${f(x + w)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)} H ${f(x + r)} Q ${f(x)} ${f(y + h)} ${f(x)} ${f(y + h - r)} V ${f(y + r)} Q ${f(x)} ${f(y)} ${f(x + r)} ${f(y)} Z`
    : `M ${f(x)} ${f(y)} H ${f(x + w)} V ${f(y + h)} H ${f(x)} Z`;

/** A smooth path through points (Catmull–Rom as cubic Béziers); `M` to the first point, or `L` to carry on a path. */
function through(p: [number, number][], move = true): string {
  let d = `${move ? "M" : "L"} ${f(p[0][0])} ${f(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] ?? p[i],
      b = p[i],
      c = p[i + 1],
      e = p[i + 2] ?? p[i + 1];
    d += ` C ${f(b[0] + (c[0] - a[0]) / 6)} ${f(b[1] + (c[1] - a[1]) / 6)}, ${f(c[0] - (e[0] - b[0]) / 6)} ${f(c[1] - (e[1] - b[1]) / 6)}, ${f(c[0])} ${f(c[1])}`;
  }
  return d;
}

const R = 1.98; // fuselage radius
const REAR = 8.55; // the rear door's leading edge, before the tail end, on every type

/** Traced outlines. Nose: from the tip. Tail parts: metres before the tail end. */
const TRACE = {
  noseTop: [[0, -0.72], [0.05, -0.47], [0.23, -0.19], [0.51, 0.05], [0.79, 0.19], [1.07, 0.3], [1.36, 0.47], [1.64, 0.79], [1.92, 1.03], [2.2, 1.21], [2.48, 1.4], [2.76, 1.54], [3.22, 1.73], [3.6, 1.82], [4.16, 1.92], [4.8, 1.98]] as [number, number][],
  noseBottom: [[0, -0.72], [0.05, -0.98], [0.23, -1.21], [0.42, -1.4], [0.79, -1.59], [1.36, -1.73], [1.82, -1.82], [2.6, -1.92], [3.4, -1.98]] as [number, number][],
  tailBottom: [[10.9, -1.96], [10.33, -1.87], [9.21, -1.73], [8.08, -1.5], [6.96, -1.26], [5.84, -0.89], [4.72, -0.56], [3.6, -0.19], [2.48, 0.19], [1.36, 0.51], [0.23, 0.89]] as [number, number][],
  tailEnd: [0.89, 1.45],
  finFillet: [[9.0, 1.98], [8.64, 2.06], [8.27, 2.2], [7.9, 2.34], [7.52, 2.62], [7.15, 2.94], [7.06, 3.04]] as [number, number][],
  finTip: { le: 2.94, te: 1.03, y: 7.85 },
  finRootTE: [2.52, 1.92],
  tailplane: [[5.95, 0.66], [1.55, 1.57], [1.05, 1.48], [4.2, 0.42], [5.6, 0.45]] as [number, number][],
};

interface Door {
  x: number;
  w: number;
  /** A full door (else an over-wing exit). */
  big: boolean;
}
const door = (x: number): Door => ({ x, w: 0.9, big: true });
const exit = (x: number): Door => ({ x, w: 0.48, big: false });

/** Per type: length, wing root leading edge (2.7 m behind the CFM intake), doors from the nose. */
const TYPES: Record<AircraftType, { L: number; wing: number; doors: Door[] }> = {
  A319: { L: 33.84, wing: 12.75, doors: [door(4.55), exit(13.2), door(33.84 - REAR)] },
  A320: { L: 37.57, wing: 14.0, doors: [door(4.55), exit(13.92), exit(14.77), door(37.57 - REAR)] },
  A321: { L: 44.51, wing: 18.0, doors: [door(4.55), door(13.16), door(24.16), door(44.51 - REAR)] },
};

/** Nacelles: intake x from the wing root, centre height, radii and lengths (m). */
const ENGINES: Record<EngineType, { dx: number; cy: number; rIn: number; rMax: number; fan: number; rFanEnd: number; core: number; rCore0: number; rCore1: number; plug: number }> = {
  // CFM56-5B: short fan cowl, core cowl and plug showing behind it
  CFM: { dx: -2.7, cy: -2.5, rIn: 0.84, rMax: 0.98, fan: 2.55, rFanEnd: 0.84, core: 1.25, rCore0: 0.6, rCore1: 0.44, plug: 0.55 },
  // IAE V2500: one long nacelle, one nozzle, slimmer
  IAE: { dx: -3.0, cy: -2.45, rIn: 0.8, rMax: 0.92, fan: 4.55, rFanEnd: 0.5, core: 0, rCore0: 0, rCore1: 0, plug: 0.4 },
  // LEAP-1A (A320neo): bigger fan, further forward and higher
  LEAP: { dx: -3.35, cy: -2.38, rIn: 1.0, rMax: 1.14, fan: 2.95, rFanEnd: 0.98, core: 1.15, rCore0: 0.62, rCore1: 0.45, plug: 0.5 },
};

/** The widest type plus margins: draw every aircraft on this frame and their lengths compare. */
export const FAMILY_FRAME = 46.5;

/* ---------- shapes ---------- */

function bodyPath(L: number): string {
  const bottom = [...TRACE.noseBottom].reverse();
  const tail = TRACE.tailBottom.map(([b, y]) => [L - b, y] as [number, number]).reverse();
  return [
    through(TRACE.noseTop),
    `L ${f(L - 10.9)} ${R}`,
    `C ${f(L - 6)} ${R}, ${f(L - 2.5)} 1.75, ${f(L - 0.1)} ${TRACE.tailEnd[1]}`,
    `L ${f(L - 0.1)} ${TRACE.tailEnd[0]}`,
    through(tail, false),
    `L ${f(bottom[0][0])} ${f(bottom[0][1])}`,
    through(bottom, false),
    "Z",
  ].join(" ");
}

function finPath(L: number): string {
  const { finFillet, finTip, finRootTE } = TRACE;
  // the trailing edge carries on a little below the roof, under the body, so the join is clean
  const [tb, ty] = finRootTE;
  const k = (ty - 1.4) / (finTip.y - ty);
  return `${through(finFillet.map(([b, y]) => [L - b, y] as [number, number]))} L ${f(L - finTip.le)} ${finTip.y} L ${f(L - finTip.te)} ${finTip.y} L ${f(L - tb - (tb - finTip.te) * k)} 1.4 L ${f(L - 9.2)} 1.4 Z`;
}

function nacelle(e: (typeof ENGINES)[EngineType], x0: number) {
  const xi = x0 + e.dx;
  const { cy, rIn, rMax, fan, rFanEnd } = e;
  const xf = xi + fan;
  const cowl = `M ${f(xi)} ${f(cy + rIn)} C ${f(xi + 0.5)} ${f(cy + rMax)}, ${f(xi + fan * 0.55)} ${f(cy + rMax)}, ${f(xf)} ${f(cy + rFanEnd)} L ${f(xf)} ${f(cy - rFanEnd)} C ${f(xi + fan * 0.55)} ${f(cy - rMax)}, ${f(xi + 0.5)} ${f(cy - rMax)}, ${f(xi)} ${f(cy - rIn)} Z`;
  const lip = `M ${f(xi)} ${f(cy + rIn)} C ${f(xi + 0.12)} ${f(cy + rIn + 0.08)}, ${f(xi + 0.26)} ${f(cy + rIn + 0.1)}, ${f(xi + 0.32)} ${f(cy + rIn + 0.1)} L ${f(xi + 0.32)} ${f(cy - rIn - 0.1)} C ${f(xi + 0.26)} ${f(cy - rIn - 0.1)}, ${f(xi + 0.12)} ${f(cy - rIn - 0.08)}, ${f(xi)} ${f(cy - rIn)} Z`;
  const xc = xf + e.core;
  const core = e.core ? `M ${f(xf)} ${f(cy + e.rCore0)} L ${f(xc)} ${f(cy + e.rCore1)} L ${f(xc)} ${f(cy - e.rCore1)} L ${f(xf)} ${f(cy - e.rCore0)} Z` : "";
  const xe = e.core ? xc : xf;
  const re = e.core ? e.rCore1 * 0.62 : rFanEnd * 0.55;
  const plug = `M ${f(xe)} ${f(cy + re)} L ${f(xe + e.plug)} ${f(cy)} L ${f(xe)} ${f(cy - re)} Z`;
  // pylon: from the top of the nacelle back and up into the wing (drawn under the wing)
  const pylon = `M ${f(xi + 0.9)} ${f(cy + rMax - 0.05)} L ${f(x0 - 0.2)} -1.35 L ${f(x0 + 3.6)} -1.25 L ${f(xf + (e.core ? 0.7 : -0.6))} ${f(cy + 0.55)} Z`;
  return { cowl, lip, core, plug, pylon };
}

const wingPath = (x0: number) =>
  `M ${f(x0)} -1.12 L ${f(x0 + 7.6)} 0.55 L ${f(x0 + 9.1)} 0.47 L ${f(x0 + 6.2)} -1.48 C ${f(x0 + 4)} -1.62, ${f(x0 + 1.2)} -1.6, ${f(x0)} -1.12 Z`;

function wingtipPath(x0: number, sharklets: boolean): string {
  if (sharklets)
    return `M ${f(x0 + 6.95)} 0.49 C ${f(x0 + 7.9)} 0.67, ${f(x0 + 8.25)} 1.3, ${f(x0 + 8.7)} 2.85 L ${f(x0 + 9.4)} 2.99 C ${f(x0 + 9.25)} 1.85, ${f(x0 + 9.3)} 0.87, ${f(x0 + 9.15)} 0.39 Z`;
  return `M ${pts([
    [x0 + 8.2, 0.53],
    [x0 + 8.95, 1.27],
    [x0 + 9.28, 1.22],
    [x0 + 9.16, 0.51],
    [x0 + 9.26, -0.19],
    [x0 + 8.95, -0.25],
    [x0 + 8.2, 0.43],
  ])} Z`;
}

/** Window runs (one dark line each, broken at every door: the door pattern tells the types apart). */
function windowRuns(doors: Door[], L: number): [number, number][] {
  const start = 6.1;
  const gaps = [[0, start - 0.1], ...doors.map((d) => [d.x - 0.3, d.x + d.w + 0.3])];
  const runs: [number, number][] = [];
  for (let x = start; x < L - REAR - 0.5; x += 0.53) {
    if (gaps.some(([a, b]) => x + 0.24 > a && x < b)) continue;
    const r = runs[runs.length - 1];
    if (r && x - r[1] < 0.6) r[1] = x;
    else runs.push([x, x]);
  }
  return runs.map(([a, b]) => [a, b + 0.24]);
}

/** The fin's upper half: where stripes and the mark go (x range at the mark's height, roof to tip). */
function finFrame(L: number) {
  const { finTip } = TRACE;
  const yMid = (R + finTip.y) / 2 + 0.6;
  // leading and trailing edge x at a height (straight parts of the edges)
  const le = (y: number) => L - 7.06 + ((y - 3.04) / (finTip.y - 3.04)) * (7.06 - finTip.le);
  const te = (y: number) => L - 2.52 + ((y - 1.92) / (finTip.y - 1.92)) * (2.52 - finTip.te);
  return { le, te, yMid, top: finTip.y };
}

function markPath(m: TailMark, L: number): string {
  const { le, te, yMid, top } = finFrame(L);
  const s = (m.size ?? 0.3) * (top - R);
  const cx = (le(yMid) + te(yMid)) / 2 + 0.15;
  const cy = yMid;
  if (m.shape === "disc") return `M ${f(cx - s / 2)} ${f(cy)} A ${f(s / 2)} ${f(s / 2)} 0 1 0 ${f(cx + s / 2)} ${f(cy)} A ${f(s / 2)} ${f(s / 2)} 0 1 0 ${f(cx - s / 2)} ${f(cy)} Z`;
  if (m.shape === "bar") return rect(cx - s * 0.6, cy - s * 0.12, s * 1.2, s * 0.24);
  // the Swiss cross: arms a sixth longer than wide, as on the flag
  const a = s / 2,
    w = s * (6 / 20) * 1.1;
  return `M ${pts([
    [cx - w / 2, cy + a],
    [cx + w / 2, cy + a],
    [cx + w / 2, cy + w / 2],
    [cx + a, cy + w / 2],
    [cx + a, cy - w / 2],
    [cx + w / 2, cy - w / 2],
    [cx + w / 2, cy - a],
    [cx - w / 2, cy - a],
    [cx - w / 2, cy - w / 2],
    [cx - a, cy - w / 2],
    [cx - a, cy + w / 2],
    [cx - w / 2, cy + w / 2],
  ])} Z`;
}

/** Bands across the fin, top to bottom; behind a hoist band along the leading edge if there is one. */
function stripeParts(stripes: string[], hoist: string | undefined, L: number): Part[] {
  const { top } = finFrame(L);
  const lo = R - 0.6;
  const h = (top - lo) / stripes.length;
  const out: Part[] = stripes.map((c, i) => ({ d: rect(L - 12, top - (i + 1) * h, 13, h + 0.02), fill: c, clip: "fin" as const }));
  if (hoist) {
    // a band about a third of the fin's chord, parallel to the leading edge
    const { le } = finFrame(L);
    const w = 1.5;
    out.push({ d: `M ${pts([[L - 12, lo], [le(lo) + w, lo], [le(top + 0.2) + w, top + 0.2], [L - 12, top + 0.2]])} Z`, fill: hoist, clip: "fin" });
  }
  return out;
}

/* ---------- the drawing ---------- */

export interface DrawOptions {
  layout?: PaintLayout;
  /** Override any fixed colour. */
  fixed?: Partial<Fixed>;
  /** Frame width in metres: FAMILY_FRAME (default) so lengths compare, or "fit" for this type only. */
  frame?: number | "fit";
}

/** The parts of one aircraft in one paint, in drawing order. */
export function drawAircraft(a: Airframe, paint: Paint = PLAIN, opts: DrawOptions = {}): Drawing {
  const t = TYPES[a.type];
  const L = t.L;
  const x0 = t.wing;
  const fx = { ...FIXED, ...opts.fixed };
  const lay = { bellySplit: -0.9, cheatlineY: -0.62, cheatlineHeight: 0.36, ...opts.layout };
  const e = nacelle(ENGINES[a.engine], x0);
  const body = bodyPath(L);
  const fin = finPath(L);
  const p = {
    belly: paint.belly ?? paint.body,
    nose: paint.nose ?? paint.body,
    engines: paint.engines ?? paint.body,
    wingtips: paint.wingtips ?? paint.tail,
  };
  const parts: Part[] = [];

  // fin first: the fuselage overlaps its root
  parts.push({ d: fin, fill: paint.tail });
  if (paint.tailAccent) parts.push({ d: `M ${pts([[L - 12, 1], [L - 12, 3.3], [L - 6.4, 5.45], [L, 2.2], [L, 1]])} Z`, fill: paint.tailAccent, clip: "fin" });
  if (paint.tailStripes?.length) parts.push(...stripeParts(paint.tailStripes, paint.tailHoist, L));
  else if (paint.tailHoist) parts.push(...stripeParts([paint.tail], paint.tailHoist, L));
  if (paint.tailMark) parts.push({ d: markPath(paint.tailMark, L), fill: paint.tailMark.color, clip: "fin" });
  parts.push({ d: fin, fill: "none", line: true });

  // fuselage and its paint
  parts.push({ d: body, fill: paint.body });
  if (p.belly !== paint.body) parts.push({ d: rect(-1, -3, L + 2, 3 + lay.bellySplit), fill: p.belly, clip: "body" });
  if (paint.cheatline) parts.push({ d: rect(-1, lay.cheatlineY, L + 2, lay.cheatlineHeight), fill: paint.cheatline, clip: "body" });
  if (p.nose !== paint.body) parts.push({ d: `M -1 -3 L 1.25 -3 C 1.45 -1, 1.45 0.4, 1.3 1.2 L -1 1.2 Z`, fill: p.nose, clip: "body" });
  for (const d of t.doors) {
    const y0 = d.big ? -1.05 : -0.05;
    parts.push({ d: rect(d.x, y0, d.w, d.big ? 1.95 : 1.0, 0.18), fill: "none", stroke: fx.line, clip: "body" });
  }
  for (const [a0, b0] of windowRuns(t.doors, L)) parts.push({ d: rect(a0, 0.44, b0 - a0, 0.3, 0.15), fill: fx.glass, clip: "body" });
  // cockpit windows sit just under the nose line: a slanted front pane, then the side panes
  parts.push({ d: "M 1.48 0.5 L 1.86 0.97 L 3.35 1.13 L 3.35 0.55 Z", fill: fx.glass, clip: "body" });
  parts.push({ d: body, fill: "none", line: true });

  // tailplane, pylon (under the wing), wing, wingtip, engine
  parts.push({ d: `M ${pts(TRACE.tailplane.map(([b, y]) => [L - b, y]))} Z`, fill: fx.metal, line: true });
  parts.push({ d: e.pylon, fill: fx.metal, line: true });
  parts.push({ d: wingPath(x0), fill: fx.metal, line: true });
  parts.push({ d: wingtipPath(x0, a.sharklets), fill: p.wingtips, line: true });
  if (e.core) parts.push({ d: e.core, fill: fx.metalDark, line: true });
  parts.push({ d: e.plug, fill: fx.metalDark, line: true });
  parts.push({ d: e.cowl, fill: p.engines, line: true });
  parts.push({ d: e.lip, fill: fx.lip, line: true });

  const width = opts.frame === "fit" ? L + 2 : (opts.frame ?? FAMILY_FRAME);
  return { viewBox: [-1.2, -8.6, width, 12.6], body, fin, parts };
}

/** The drawing as an SVG string (for previews and scripts; the app uses <AircraftProfile>). */
export function aircraftSvg(a: Airframe, paint: Paint = PLAIN, opts: DrawOptions & { id?: string; width?: number; label?: string } = {}): string {
  const dr = drawAircraft(a, paint, opts);
  const id = opts.id ?? "ac";
  const line = { ...FIXED, ...opts.fixed }.line;
  const [vx, vy, vw, vh] = dr.viewBox;
  const w = opts.width ?? 600;
  const nss = 'vector-effect="non-scaling-stroke" stroke-linejoin="round"';
  const parts = dr.parts
    .map((pt) => {
      const clip = pt.clip ? ` clip-path="url(#${id}-${pt.clip})"` : "";
      const stroke = pt.stroke ? ` stroke="${pt.stroke}" stroke-width="0.9" ${nss}` : pt.line ? ` stroke="${line}" stroke-width="0.8" ${nss}` : "";
      return `<path d="${pt.d}" fill="${pt.fill}"${stroke}${clip}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${w}" height="${f((w * vh) / vw)}" role="img" aria-label="${opts.label ?? `${a.type} ${a.engine}`}"><defs><clipPath id="${id}-body"><path d="${dr.body}"/></clipPath><clipPath id="${id}-fin"><path d="${dr.fin}"/></clipPath></defs><g transform="scale(1 -1)">${parts}</g></svg>`;
}
