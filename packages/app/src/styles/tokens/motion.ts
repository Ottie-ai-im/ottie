// Motion tokens — easing curves, base durations, and the per-preset timing
// values for the math-curve-loader brand visuals.
//
// `curves` and `durations` follow the v1.11 token guidance from research
// §8.6 (standard Material-style cubic-bezier set). `mathCurves` lifts the
// timing primitives (durationMs / rotationDurationMs / pulseDurationMs)
// out of `packages/app/src/components/math-curve-loader/curves.ts` so the
// math file can stay focused on the parametric `point` functions.
//
// Phase 1 is structural, NOT visual (PITFALLS pitfall 1) — every
// `mathCurves.<name>` block matches the previous CURVE_PRESETS values
// byte-for-byte.

export const motion = {
  /** Cubic-bezier easing strings for transitions. */
  curves: {
    standard: "cubic-bezier(0.4, 0, 0.2, 1)",
    enter: "cubic-bezier(0.0, 0, 0.2, 1)",
    exit: "cubic-bezier(0.4, 0, 1, 1)",
  },

  /** Base UI durations (ms). Spring tokens still live on theme.motion.spring. */
  durations: {
    fast: 120,
    normal: 200,
    slow: 320,
  },

  /**
   * Per-preset timing for math-curve-loader. The parametric `point`
   * functions and per-preset `particleCount`/`trailSpan`/`strokeWidth`
   * stay in `components/math-curve-loader/curves.ts` — only the timing
   * primitives are token-grade, since other components may reuse them
   * (e.g. an avatar pulse animation reusing `lemniscateBloom.pulseDurationMs`).
   *
   * Keys are camelCase (lemniscateBloom) — the kebab-case CurveName
   * (`"lemniscate-bloom"`) is mapped at the consumer site in curves.ts.
   */
  mathCurves: {
    lemniscateBloom: {
      durationMs: 5600,
      rotationDurationMs: 34000,
      pulseDurationMs: 5000,
    },
    spiralSearch: {
      durationMs: 7800,
      rotationDurationMs: 44000,
      pulseDurationMs: 6800,
    },
    roseThree: {
      durationMs: 5300,
      rotationDurationMs: 28000,
      pulseDurationMs: 4400,
    },
    thinkingNine: {
      durationMs: 4700,
      rotationDurationMs: 30000,
      pulseDurationMs: 4200,
    },
    cardioidHeart: {
      durationMs: 6200,
      rotationDurationMs: 36000,
      pulseDurationMs: 5200,
    },
    butterflyPhase: {
      durationMs: 9000,
      rotationDurationMs: 50000,
      pulseDurationMs: 7000,
    },
    lissajousDrift: {
      durationMs: 6000,
      rotationDurationMs: 36000,
      pulseDurationMs: 5400,
    },
  },
} as const;
