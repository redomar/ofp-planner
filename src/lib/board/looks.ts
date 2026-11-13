/**
 * Looks (1.12): what a scene shows at a stage of the flight. A look is a view (G1 … G7b) with its
 * settings: size and corner for the views drawn over the sim, the back sides and timings of the
 * cards that flip, the seatbelt sign. A stage can stack up to three looks (layers), e.g. a strip
 * along the bottom and a map corner above it.
 *
 * In the URL a look is a short token, the view first and only what differs from its defaults:
 *   card            the corner card, medium, top right
 *   card.s.bl       small, bottom left (xs: extra small, for a corner that keeps out of the game)
 *   g6b.l.bnp.e240  the map corner that flips, large, back sides "numbers" then "plan", every 4 min
 *   strip~g6a1.s    two layers: the strip and a small map corner with legs
 * A plain view name ("strip") is a look with its defaults, so every URL from before 1.12 still reads.
 */

export const VIEWS = [
  "full",
  "map",
  "route",
  "frame",
  "mapwin",
  "corner",
  "g6a1",
  "g6a2",
  "g6a3",
  "g6b",
  "card",
  "g7a1",
  "g7a2",
  "g7a3",
  "g7b",
  "strip",
  "pill",
  "line",
  "countdown",
  "ending",
] as const;
export type ShownView = (typeof VIEWS)[number];
export const isView = (v: string): v is ShownView => (VIEWS as readonly string[]).includes(v);

/** The looks that can show the vertical speed. */
export const SHOWS_VS: ShownView[] = ["strip", "pill", "line"];

export type LookSize = "xs" | "s" | "m" | "l";
export type LookPos = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";
export const POSITIONS: LookPos[] = ["tl", "tc", "tr", "ml", "mr", "bl", "bc", "br"];
/** The back sides of a card that flips. */
export type LookBack = "numbers" | "plan" | "route" | "aircraft" | "deck";
const BACK_CODE: Record<LookBack, string> = { numbers: "n", plan: "p", route: "r", aircraft: "a", deck: "d" };

export interface Look {
  v: ShownView;
  size: LookSize;
  pos: LookPos;
  /** Flip cards: the back sides, in turn. */
  backs: LookBack[];
  /** Flip cards: seconds on the front, seconds on the back. */
  every: number;
  hold: number;
  /** The seatbelt sign while it's on. */
  belt: boolean;
  /** 1.13.3, strip and pills: the vertical speed (climbing and descending only, on the pills). */
  vs: boolean;
  /** 1.14, flip cards: the back sides only, `hold` s each (a rotation step that shows the numbers or the plan). */
  only: boolean;
}

export type ViewKind = "screen" | "box" | "bar" | "pill";
export interface ViewInfo {
  name: string;
  code: string;
  note: string;
  /** screen: the whole 16:9 (no size or corner); box, bar and pill float over the sim. */
  kind: ViewKind;
  pos: LookPos;
  flip?: boolean;
  /** The seatbelt sign doesn't go on the moving maps. */
  noBelt?: boolean;
}

export const VIEW_INFO: Record<ShownView, ViewInfo> = {
  full: { name: "Gate screen", code: "G1", note: "The full departure board, with the steps of the flight.", kind: "screen", pos: "tl" },
  map: { name: "Moving map", code: "G3", note: "The map and the flight's facts, full screen.", kind: "screen", pos: "tl", noBelt: true },
  route: { name: "Map with route", code: "G3d", note: "The map, the next fixes and the fuel at the destination.", kind: "screen", pos: "tl", noBelt: true },
  frame: { name: "Frame with sim", code: "G3a", note: "A window for the game, the rail and the map around it.", kind: "screen", pos: "tl" },
  mapwin: { name: "Map with window", code: "G3c", note: "The map, and a window for the game on the rail.", kind: "screen", pos: "tl", noBelt: true },
  corner: { name: "Map corner", code: "G3b", note: "A small map and the facts over the sim.", kind: "box", pos: "br" },
  g6a1: { name: "Corner with legs", code: "G6a·1", note: "The map corner with the fix passed and the next three.", kind: "box", pos: "br" },
  g6a2: { name: "Corner with ribbon", code: "G6a·2", note: "The map corner with the route as a row of arrows.", kind: "box", pos: "br" },
  g6a3: { name: "Corner, next fix", code: "G6a·3", note: "The map corner with the next fix big, two after it.", kind: "box", pos: "br" },
  g6b: { name: "Corner that flips", code: "G6b", note: "The map corner; now and then it turns over to the plan or the numbers.", kind: "box", pos: "br", flip: true },
  card: { name: "Corner card", code: "G5", note: "Destination, progress and the facts.", kind: "box", pos: "tr" },
  g7a1: { name: "Card with legs", code: "G7a·1", note: "The corner card with a table of the next fixes.", kind: "box", pos: "tr" },
  g7a2: { name: "Timeline card", code: "G7a·2", note: "Passed, next, the top of descent and the destination.", kind: "box", pos: "tr" },
  g7a3: { name: "Countdown card", code: "G7a·3", note: "Minutes to the next fix, to the descent and to landing.", kind: "box", pos: "tr" },
  g7b: { name: "Card that flips", code: "G7b", note: "The corner card; now and then it turns over to the route or the numbers.", kind: "box", pos: "tr", flip: true },
  strip: { name: "Strip", code: "G4", note: "One bar along the bottom or the top.", kind: "bar", pos: "bc" },
  pill: { name: "Pill", code: "G5", note: "Flight, route and time to go in one line.", kind: "pill", pos: "tl" },
  line: { name: "Pill with phase", code: "G5b", note: "The pill with the phase in its own colour.", kind: "pill", pos: "tl" },
  countdown: { name: "Countdown", code: "G8", note: "The gate screen with a big countdown to the stream's start.", kind: "screen", pos: "tl", noBelt: true },
  ending: { name: "Ending screen", code: "G9", note: "A window for the game, the flight's numbers and the route flown, a sign-off.", kind: "screen", pos: "tl", noBelt: true },
};

/** The picker's groups. */
export const VIEW_GROUPS: { k: string; name: string; views: ShownView[] }[] = [
  { k: "screens", name: "Full screens", views: ["full", "map", "route", "frame", "mapwin"] },
  { k: "corners", name: "Map corners", views: ["corner", "g6a1", "g6a2", "g6a3", "g6b"] },
  { k: "cards", name: "Cards", views: ["card", "g7a1", "g7a2", "g7a3", "g7b"] },
  { k: "bars", name: "Strips and pills", views: ["strip", "pill", "line"] },
  { k: "ends", name: "Start and end", views: ["countdown", "ending"] },
];

export const BACKS: { k: LookBack; name: string; note: string; ready: boolean; needs?: string }[] = [
  { k: "numbers", name: "By the numbers", note: "Distance and time to the next fix, the descent and landing; fuel, wind, drift.", ready: true },
  { k: "plan", name: "The FMS plan", note: "The next fixes in the MCDU's colours, constraints and V-speeds.", ready: true },
  { k: "route", name: "The whole route", note: "Every fix on one line, where you are, the trip's times.", ready: true },
  { k: "aircraft", name: "Aircraft status", note: "Weights, engines, gear, flaps, temperatures.", ready: false, needs: "after a probe flight on the PC" },
  { k: "deck", name: "Flight deck", note: "Autopilot modes, the FCU, the PROG and FUEL PRED pages.", ready: false, needs: "after the MCDU page work on the PC" },
];

/**
 * 1.15: the back sides a screen shows: only the ready ones. The others ("Aircraft status", "Flight
 * deck") stay readable in links but are hidden everywhere until the probe gives them real data.
 */
export const shownBacks = (bs: LookBack[]): LookBack[] => bs.filter((b) => BACKS.find((x) => x.k === b)?.ready);

export const SIZES: { k: LookSize; name: string }[] = [
  { k: "xs", name: "Extra small" },
  { k: "s", name: "Small" },
  { k: "m", name: "Medium" },
  { k: "l", name: "Large" },
];

export function look(v: ShownView, p: Partial<Omit<Look, "v">> = {}): Look {
  const i = VIEW_INFO[v];
  return { v, size: "m", pos: i.pos, backs: i.flip ? ["numbers", "plan"] : [], every: 180, hold: 45, belt: !i.noBelt, vs: true, only: false, ...p };
}

/** A token as a look; null when its view isn't one. Unknown parts are skipped. */
export function lookFrom(token: string): Look | null {
  const [v, ...parts] = token.trim().split(".");
  if (!isView(v)) return null;
  const l = look(v);
  for (const p of parts) {
    if (p === "xs" || p === "s" || p === "m" || p === "l") l.size = p;
    else if ((POSITIONS as string[]).includes(p)) l.pos = p as LookPos;
    else if (/^b[nprad]{1,5}$/.test(p)) {
      const bs = [...p.slice(1)].map((c) => (Object.keys(BACK_CODE) as LookBack[]).find((k) => BACK_CODE[k] === c)!);
      l.backs = [...new Set(bs)];
    } else if (/^e\d{2,4}$/.test(p)) l.every = Math.max(30, Math.min(1800, Number(p.slice(1))));
    else if (/^h\d{1,3}$/.test(p)) l.hold = Math.max(10, Math.min(300, Number(p.slice(1))));
    else if (p === "nb") l.belt = false;
    else if (p === "wb") l.belt = true;
    else if (p === "nvs") l.vs = false;
    else if (p === "bo") l.only = true;
  }
  return l;
}

/** A look as its token: the view, then only what differs from its defaults. */
export function lookTo(l: Look): string {
  const d = look(l.v);
  const out: string[] = [l.v];
  if (l.size !== d.size) out.push(l.size);
  if (l.pos !== d.pos && VIEW_INFO[l.v].kind !== "screen") out.push(l.pos);
  if (VIEW_INFO[l.v].flip) {
    if (l.backs.join() !== d.backs.join() && l.backs.length) out.push(`b${l.backs.map((b) => BACK_CODE[b]).join("")}`);
    if (l.every !== d.every) out.push(`e${l.every}`);
    if (l.hold !== d.hold) out.push(`h${l.hold}`);
    if (l.only) out.push("bo");
  }
  if (l.belt !== d.belt) out.push(l.belt ? "wb" : "nb");
  if (!l.vs && SHOWS_VS.includes(l.v)) out.push("nvs");
  return out.join(".");
}

/** Up to three looks stacked: "strip~g6a1.s". */
export type Layers = Look[];
export const MAX_LAYERS = 3;
export function layersFrom(token: string): Layers | null {
  const ls = token
    .split("~")
    .slice(0, MAX_LAYERS)
    .map(lookFrom)
    .filter((x): x is Look => x != null);
  return ls.length ? ls : null;
}
export const layersTo = (ls: Layers) => ls.map(lookTo).join("~");
export const sameLayers = (a: Layers, b: Layers) => layersTo(a) === layersTo(b);
export const layers = (v: ShownView, p: Partial<Omit<Look, "v">> = {}): Layers => [look(v, p)];
/** Drawn over the sim: every layer floats (nothing paints the whole screen). */
export const overSim = (ls: Layers) => ls.every((l) => VIEW_INFO[l.v].kind !== "screen" || l.v === "frame" || l.v === "mapwin" || l.v === "ending");

/* ---------- 1.14: rotations ---------- */

/**
 * A stage can turn through looks: steps in order, each shown for `secs`, round and round. A step
 * can hold alternatives, one per time round (the map corner with the legs, then the numbers, …).
 * In the URL: steps joined by ">", alternatives by "|", the seconds after "@":
 *   line@240>g6a1.mr|g6b.mr.bn.bo@30>strip@120
 * One step with one look is written as the look alone, so every token from before reads as it was.
 */
export interface Step {
  alts: Layers[];
  secs: number;
}
export type Turns = Step[];
export const MAX_STEPS = 8;
export const MAX_ALTS = 6;
export const STEP_MIN_S = 10;
export const STEP_MAX_S = 1800;
export const STEP_DEFAULT_S = 60;
const clampSecs = (n: number) => Math.max(STEP_MIN_S, Math.min(STEP_MAX_S, Math.round(n)));

export const turnsOf = (ls: Layers, secs = STEP_DEFAULT_S): Turns => [{ alts: [ls], secs }];

/** A stage's token as its turns; null when a part isn't a look. */
export function turnsFrom(token: string): Turns | null {
  const steps: Turns = [];
  for (const part of token.split(">").slice(0, MAX_STEPS)) {
    const at = part.lastIndexOf("@");
    const body = at >= 0 ? part.slice(0, at) : part;
    const secs = at >= 0 && /^\d{1,4}$/.test(part.slice(at + 1)) ? clampSecs(Number(part.slice(at + 1))) : STEP_DEFAULT_S;
    const alts = body.split("|").slice(0, MAX_ALTS).map(layersFrom);
    if (!alts.length || alts.some((a) => a == null)) return null;
    steps.push({ alts: alts as Layers[], secs });
  }
  return steps.length ? steps : null;
}

export function turnsTo(t: Turns): string {
  if (t.length === 1 && t[0].alts.length === 1) return layersTo(t[0].alts[0]);
  return t.map((st) => `${st.alts.map(layersTo).join("|")}@${clampSecs(st.secs)}`).join(">");
}
export const sameTurns = (a: Turns, b: Turns) => turnsTo(a) === turnsTo(b);
/** Turns through more than one look. */
export const turning = (t: Turns) => t.length > 1 || t[0].alts.length > 1;

/**
 * What a stage shows `elapsed` ms after it began: the step (round and round), the alternative for
 * this time round, and when that step began (ms into the stage), for a flip card's back sides.
 */
export function stepAt(t: Turns, elapsed: number): { ls: Layers; i: number; alt: number; from: number } {
  if (!turning(t)) return { ls: t[0].alts[0], i: 0, alt: 0, from: 0 };
  const cycle = t.reduce((n, st) => n + st.secs, 0) * 1000;
  const e = Math.max(0, elapsed);
  const round = Math.floor(e / cycle);
  let r = e - round * cycle;
  for (let i = 0; i < t.length; i++) {
    const len = t[i].secs * 1000;
    if (r < len || i === t.length - 1) {
      const alt = round % t[i].alts.length;
      return { ls: t[i].alts[alt], i, alt, from: e - r };
    }
    r -= len;
  }
  return { ls: t[0].alts[0], i: 0, alt: 0, from: 0 };
}

/** Every look a stage can show (for "is it all over the sim"). */
export const allLayers = (t: Turns): Layers => t.flatMap((st) => st.alts.flat());
