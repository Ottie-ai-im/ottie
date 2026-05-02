import { MathCurveLoaderRenderer as MathCurveLoaderBase } from "./renderer";
import type { MathCurveLoaderProps, CurveName } from "./types";

/**
 * Public entry point for the math-curve loader.
 *
 * SCOPE ENFORCEMENT (THM-03): This high-motion animation is reserved exclusively
 * for the SplashOverlay and the SessionsScreen (Chat Tab) loading state.
 * It must NOT be used as a generic button loader or for background tasks.
 */
export function MathCurveLoader(props: MathCurveLoaderProps) {
  return <MathCurveLoaderBase {...props} />;
}

export type { MathCurveLoaderProps, CurveName };
