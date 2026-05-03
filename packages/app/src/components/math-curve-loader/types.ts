import type { CurveName } from "./curves";
import type { MathCurveContext } from "./sanctioned-uses";

export interface MathCurveLoaderProps {
  /**
   * Required brand context (Plan 02e).
   * Restricts high-fidelity motion to sanctioned brand moments.
   */
  brandContext: MathCurveContext;
  /** Which preset to render. See ./curves for the 6 names. */
  curve: CurveName;
  /** Square edge length in px (web) / dp (native). */
  size: number;
  /** Stroke + particle color. Pass any CSS / RN color string. */
  color: string;
  /** When true, skips the rAF loop and shows a static path with low alpha.
   *  Hook this up to AccessibilityInfo.isReduceMotionEnabled() at the call site. */
  reduceMotion?: boolean;
  /** Optional accessibility label, otherwise the loader is decorative. */
  ariaLabel?: string;
}

export type { CurveName } from "./curves";
