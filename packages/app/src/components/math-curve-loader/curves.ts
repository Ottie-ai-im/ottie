// Six parametric-curve presets used as Ottie's loading / thinking visuals.
//
// Each preset maps a state in the app (thinking, connecting, awaiting human,
// etc.) to a distinct curve. See math-curve-loader/index.tsx for the public
// component that consumes these.
//
// Math is ported from https://paidax01.github.io/math-curve-loaders/ (MIT).

export interface Point {
  x: number;
  y: number;
}

export interface CurvePreset {
  name: CurveName;
  rotate: boolean;
  particleCount: number;
  trailSpan: number;
  durationMs: number;
  rotationDurationMs: number;
  pulseDurationMs: number;
  strokeWidth: number;
  // Sample the curve at progress ∈ [0, 1] with breath ∈ [0.52, 1.0]. Returns
  // viewBox-space coordinates in [0, 100].
  point: (progress: number, detailScale: number) => Point;
}

export type CurveName =
  | "lemniscate-bloom"
  | "spiral-search"
  | "rose-three"
  | "thinking-nine"
  | "cardioid-heart"
  | "butterfly-phase"
  | "lissajous-drift";

const TAU = Math.PI * 2;

// ──────────────────────────────────────────────────────────────────────────
// 🚀 Lemniscate Bloom — splash / boot. Infinity sign, two breathing lobes.
// ──────────────────────────────────────────────────────────────────────────
const LEMNISCATE_A = 20;
const LEMNISCATE_BOOST = 7;
function lemniscatePoint(progress: number, detailScale: number): Point {
  const t = progress * TAU;
  const scale = LEMNISCATE_A + detailScale * LEMNISCATE_BOOST;
  const denom = 1 + Math.sin(t) ** 2;
  return {
    x: 50 + (scale * Math.cos(t)) / denom,
    y: 50 + (scale * Math.sin(t) * Math.cos(t)) / denom,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 🔌 Spiral Search — connecting / pairing. Archimedean-like, opens out and
//    closes back. Reads as "looking for signal".
// ──────────────────────────────────────────────────────────────────────────
const SEARCH_TURNS = 4;
const SEARCH_BASE_RADIUS = 8;
const SEARCH_RADIUS_AMP = 8.5;
const SEARCH_PULSE = 2.4;
const SEARCH_SCALE = 1;
function spiralSearchPoint(progress: number, detailScale: number): Point {
  const t = progress * TAU;
  const angle = t * SEARCH_TURNS;
  const radius =
    SEARCH_BASE_RADIUS + (1 - Math.cos(t)) * (SEARCH_RADIUS_AMP + detailScale * SEARCH_PULSE);
  return {
    x: 50 + Math.cos(angle) * radius * SEARCH_SCALE,
    y: 50 + Math.sin(angle) * radius * SEARCH_SCALE,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 💭 Rose Three — default thinking. r = a cos(3θ). Three clean petals.
// ──────────────────────────────────────────────────────────────────────────
const ROSE_A = 9.2;
const ROSE_A_BOOST = 0.6;
const ROSE_BREATH_BASE = 0.72;
const ROSE_BREATH_BOOST = 0.28;
const ROSE_SCALE = 3.25;
function roseThreePoint(progress: number, detailScale: number): Point {
  const t = progress * TAU;
  const a = ROSE_A + detailScale * ROSE_A_BOOST;
  const r = a * (ROSE_BREATH_BASE + detailScale * ROSE_BREATH_BOOST) * Math.cos(3 * t);
  return {
    x: 50 + Math.cos(t) * r * ROSE_SCALE,
    y: 50 + Math.sin(t) * r * ROSE_SCALE,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 🧠 Thinking Nine — heavy reasoning. Base orbit minus 9-fold rosette.
// ──────────────────────────────────────────────────────────────────────────
const THINK9_BASE_RADIUS = 7;
const THINK9_DETAIL_AMP = 3;
const THINK9_PETALS = 9;
const THINK9_SCALE = 3.9;
function thinkingNinePoint(progress: number, detailScale: number): Point {
  const t = progress * TAU;
  const x =
    THINK9_BASE_RADIUS * Math.cos(t) -
    THINK9_DETAIL_AMP * detailScale * Math.cos(THINK9_PETALS * t);
  const y =
    THINK9_BASE_RADIUS * Math.sin(t) -
    THINK9_DETAIL_AMP * detailScale * Math.sin(THINK9_PETALS * t);
  return {
    x: 50 + x * THINK9_SCALE,
    y: 50 + y * THINK9_SCALE,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 🔒 Cardioid Heart — awaiting human (permission). Slow-breathing heart.
// ──────────────────────────────────────────────────────────────────────────
const CARDIOID_A = 8.8;
const CARDIOID_PULSE = 0.8;
const CARDIOID_SCALE = 2.15;
function cardioidHeartPoint(progress: number, detailScale: number): Point {
  const t = progress * TAU;
  const a = CARDIOID_A + detailScale * CARDIOID_PULSE;
  const r = a * (1 + Math.cos(t));
  // Rotate -90° (swap + negate) so the cusp points down and reads as a heart.
  const baseX = Math.cos(t) * r;
  const baseY = Math.sin(t) * r;
  return {
    x: 50 - baseY * CARDIOID_SCALE,
    y: 50 - baseX * CARDIOID_SCALE,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 🌊 Lissajous Drift — assistant typing / streaming. A 3:4 Lissajous figure
//    with a 90° phase offset; reads as a calm braided knot drifting in place.
//    Replaces the old `•••` dots indicator inside thinking bubbles.
// ──────────────────────────────────────────────────────────────────────────
const LISSAJOUS_AMP = 24;
const LISSAJOUS_AMP_BOOST = 6;
const LISSAJOUS_AX = 3;
const LISSAJOUS_BY = 4;
const LISSAJOUS_PHASE = 1.57;
const LISSAJOUS_Y_SCALE = 0.92;
function lissajousDriftPoint(progress: number, detailScale: number): Point {
  const t = progress * TAU;
  const amp = LISSAJOUS_AMP + detailScale * LISSAJOUS_AMP_BOOST;
  return {
    x: 50 + Math.sin(LISSAJOUS_AX * t + LISSAJOUS_PHASE) * amp,
    y: 50 + Math.sin(LISSAJOUS_BY * t) * (amp * LISSAJOUS_Y_SCALE),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 🦋 Butterfly Phase — empty state. Fluttering, asymmetric, alive.
// ──────────────────────────────────────────────────────────────────────────
const BUTTERFLY_TURNS = 12;
const BUTTERFLY_SCALE = 4.6;
const BUTTERFLY_PULSE = 0.45;
const BUTTERFLY_COS_WEIGHT = 2;
const BUTTERFLY_POWER = 5;
function butterflyPoint(progress: number, detailScale: number): Point {
  const t = progress * Math.PI * BUTTERFLY_TURNS;
  const s =
    Math.exp(Math.cos(t)) -
    BUTTERFLY_COS_WEIGHT * Math.cos(4 * t) -
    Math.sin(t / 12) ** BUTTERFLY_POWER;
  const scale = BUTTERFLY_SCALE + detailScale * BUTTERFLY_PULSE;
  return {
    x: 50 + Math.sin(t) * s * scale,
    y: 50 + Math.cos(t) * s * scale,
  };
}

export const CURVE_PRESETS: Record<CurveName, CurvePreset> = {
  "lemniscate-bloom": {
    name: "lemniscate-bloom",
    rotate: false,
    particleCount: 70,
    trailSpan: 0.4,
    durationMs: 5600,
    rotationDurationMs: 34000,
    pulseDurationMs: 5000,
    strokeWidth: 4.8,
    point: lemniscatePoint,
  },
  "spiral-search": {
    name: "spiral-search",
    rotate: false,
    particleCount: 86,
    trailSpan: 0.28,
    durationMs: 7800,
    rotationDurationMs: 44000,
    pulseDurationMs: 6800,
    strokeWidth: 4.3,
    point: spiralSearchPoint,
  },
  "rose-three": {
    name: "rose-three",
    rotate: true,
    particleCount: 76,
    trailSpan: 0.31,
    durationMs: 5300,
    rotationDurationMs: 28000,
    pulseDurationMs: 4400,
    strokeWidth: 4.6,
    point: roseThreePoint,
  },
  "thinking-nine": {
    name: "thinking-nine",
    rotate: true,
    particleCount: 68,
    trailSpan: 0.39,
    durationMs: 4700,
    rotationDurationMs: 30000,
    pulseDurationMs: 4200,
    strokeWidth: 5.5,
    point: thinkingNinePoint,
  },
  "cardioid-heart": {
    name: "cardioid-heart",
    rotate: false,
    particleCount: 74,
    trailSpan: 0.36,
    durationMs: 6200,
    rotationDurationMs: 36000,
    pulseDurationMs: 5200,
    strokeWidth: 4.9,
    point: cardioidHeartPoint,
  },
  "butterfly-phase": {
    name: "butterfly-phase",
    rotate: false,
    particleCount: 88,
    trailSpan: 0.32,
    durationMs: 9000,
    rotationDurationMs: 50000,
    pulseDurationMs: 7000,
    strokeWidth: 4.4,
    point: butterflyPoint,
  },
  "lissajous-drift": {
    name: "lissajous-drift",
    rotate: false,
    particleCount: 68,
    trailSpan: 0.34,
    durationMs: 6000,
    rotationDurationMs: 36000,
    pulseDurationMs: 5400,
    strokeWidth: 4.7,
    point: lissajousDriftPoint,
  },
};

// Native renderers tick at ~30fps and use far fewer particles than web. The
// visual difference is negligible because particles already taper in radius
// and opacity along the trail. The smaller budget leaves headroom on the JS
// thread for gestures (sidebar pan, etc.) — see renderer.native.tsx.
export const NATIVE_PARTICLE_BUDGET = 28;
export const NATIVE_PATH_STEPS = 140;

export function getNativeParticleCount(preset: CurvePreset): number {
  return Math.min(preset.particleCount, NATIVE_PARTICLE_BUDGET);
}
