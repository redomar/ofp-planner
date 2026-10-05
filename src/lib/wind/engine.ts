/*
 * Wind-arrow motion engine for the lab (excluded from git).
 * angle(t) = steady sway (bpm + easing) + chaos layer × chaos amplitude
 */

export type ChaosModel = "none" | "sines" | "noise" | "kicks" | "spring" | "combo";

export interface ChaosCfg {
  model: ChaosModel;
  /** Wobble frequency for sines / noise, Hz. */
  freqHz: number;
  /** Tie the wobble frequency to the sway rhythm (multiplier of swing rate) instead of fixed Hz. */
  freqFromBpm: boolean;
  freqMul: number;
  /** Gust kicks per second at a 10 kt gust spread (scales with spread). */
  kickRate: number;
  /** Kick size as a fraction of the chaos amplitude (random 40–100% of this). */
  kickStrength: number;
  kickAttackMs: number;
  kickDecayMs: number;
  /** Spring vane. */
  stiffness: number;
  damping: number;
  targetRate: number;
}

/* ---------- easing ---------- */

const NAMED: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

export function makeEase(css: string): (x: number) => number {
  const steps = css.match(/^steps\((\d+)/);
  if (steps) {
    const n = Number(steps[1]);
    return (x) => Math.round(x * (n - 1)) / (n - 1);
  }
  let p = NAMED[css];
  const m = css.match(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
  if (m) p = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (!p) p = NAMED.linear;
  const [x1, y1, x2, y2] = p;
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  const dbx = (t: number) => 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t;
  return (x) => {
    let t = x;
    for (let i = 0; i < 6; i++) {
      const d = dbx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= (bx(t) - x) / d;
      t = Math.min(1, Math.max(0, t));
    }
    return by(t);
  };
}

/* ---------- randomness ---------- */

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1-D value noise in [-1, 1] (cosine-interpolated lattice, two octaves). */
function valueNoise(seed: number) {
  const lattice = new Map<number, number>();
  const at = (i: number) => {
    if (!lattice.has(i)) lattice.set(i, rng(seed * 7919 + i * 104729)() * 2 - 1);
    if (lattice.size > 512) lattice.delete(lattice.keys().next().value as number);
    return lattice.get(i)!;
  };
  const oct = (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const w = (1 - Math.cos(f * Math.PI)) / 2;
    return at(i) * (1 - w) + at(i + 1) * w;
  };
  return (x: number) => (oct(x) * 0.7 + oct(x * 2.3 + 17) * 0.3) / 1;
}

/* ---------- one arrow's motion ---------- */

export interface SwayInput {
  /** Regular swing amplitude, degrees. */
  amp: number;
  /** Chaos amplitude, degrees (0 = metronome only). */
  chaosAmp: number;
  /** One swing (tick → tock), ms. */
  swingMs: number;
  /** Gust spread in kt (drives kick rate); VRB passes an equivalent. */
  spread: number;
  ease: (x: number) => number;
  seed: number;
  chaos: ChaosCfg;
  maxDeg: number;
}

export function createSway(input: SwayInput) {
  const r = rng(input.seed);
  const noise = valueNoise(input.seed);
  const phases = [r() * 6.283, r() * 6.283, r() * 6.283];
  const kicks: { t0: number; mag: number }[] = [];
  let springX = 0;
  let springV = 0;
  let springTarget = 0;
  let input_ = input;

  const freq = () => (input_.chaos.freqFromBpm ? (1000 / input_.swingMs) * input_.chaos.freqMul : input_.chaos.freqHz);

  const sines = (t: number) => {
    const f = freq();
    const s = t / 1000;
    return (Math.sin(6.283 * f * s + phases[0]) + 0.6 * Math.sin(6.283 * f * 1.618 * s + phases[1]) + 0.4 * Math.sin(6.283 * f * 2.71 * s + phases[2])) / 2;
  };

  const kickLayer = (t: number, dt: number) => {
    const c = input_.chaos;
    const rate = c.kickRate * Math.max(0.3, input_.spread / 10);
    if (r() < rate * (dt / 1000)) kicks.push({ t0: t, mag: (r() < 0.5 ? -1 : 1) * (0.4 + 0.6 * r()) * c.kickStrength });
    let sum = 0;
    for (let i = kicks.length - 1; i >= 0; i--) {
      const age = t - kicks[i].t0;
      if (age > c.kickDecayMs * 6) {
        kicks.splice(i, 1);
        continue;
      }
      sum += kicks[i].mag * (1 - Math.exp(-age / Math.max(1, c.kickAttackMs))) * Math.exp(-age / Math.max(1, c.kickDecayMs));
    }
    return Math.max(-1.4, Math.min(1.4, sum));
  };

  const springLayer = (dt: number) => {
    const c = input_.chaos;
    if (r() < c.targetRate * Math.max(0.3, input_.spread / 10) * (dt / 1000)) springTarget = r() * 2 - 1;
    const h = Math.min(dt, 40) / 1000;
    for (let i = 0; i < 4; i++) {
      const a = c.stiffness * (springTarget - springX) - c.damping * springV;
      springV += a * (h / 4);
      springX += springV * (h / 4);
    }
    return springX;
  };

  return {
    update(next: SwayInput) {
      input_ = next;
    },
    /** Returns { angle, base, chaos } in degrees at time t (ms), given frame dt (ms). */
    step(t: number, dt: number) {
      const { amp, chaosAmp, swingMs, ease, chaos, maxDeg } = input_;
      const swings = t / swingMs;
      const k = Math.floor(swings);
      const frac = swings - k;
      const pos = -1 + 2 * ease(frac);
      const base = amp * (k % 2 === 0 ? pos : -pos);

      let u = 0;
      switch (chaos.model) {
        case "sines":
          u = sines(t);
          break;
        case "noise":
          u = noise((t / 1000) * freq());
          break;
        case "kicks":
          u = kickLayer(t, dt);
          break;
        case "spring":
          u = springLayer(dt);
          break;
        case "combo":
          u = 0.45 * sines(t) + kickLayer(t, dt);
          break;
        default:
          u = 0;
      }
      const c = chaosAmp * u;
      const angle = Math.max(-maxDeg, Math.min(maxDeg, base + c));
      return { angle, base, chaos: c };
    },
  };
}

/* ---------- one shared animation loop ---------- */

type Sub = (t: number, dt: number) => void;
const subs = new Set<Sub>();
let raf = 0;
let last = 0;
let clock = 0;
export const loop = { speed: 1, paused: false };

function frame(now: number) {
  const dt = last ? Math.min(100, now - last) : 16;
  last = now;
  if (!loop.paused) {
    clock += dt * loop.speed;
    subs.forEach((s) => s(clock, dt * loop.speed));
  }
  raf = subs.size ? requestAnimationFrame(frame) : 0;
}

export function subscribe(s: Sub) {
  subs.add(s);
  if (!raf) {
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  return () => {
    subs.delete(s);
  };
}
