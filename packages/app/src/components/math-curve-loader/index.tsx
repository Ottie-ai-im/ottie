// Public entry point for the math-curve loader.
//
// Metro / Expo bundles `.native.tsx` for iOS+Android and `.web.tsx` for web,
// so the platform-specific renderer is selected at build time. Keep this
// shim thin — anything you add here runs on every platform.

export { MathCurveLoaderRenderer as MathCurveLoader } from "./renderer";
export type { MathCurveLoaderProps, CurveName } from "./types";
