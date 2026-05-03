/**
 * Sanctioned brand contexts for <MathCurveLoader> (Plan 02e Task 3).
 *
 * Per UI-SPEC §D-13, the high-fidelity loader is restricted to 3 "brand moments"
 * to maintain its visual impact and prevent UI fatigue.
 *
 *   1. "chats" - The primary landing list (sessions-screen).
 *   2. "thinking" - Command Center / Palette active processing.
 *   3. "splash" - Cold boot / welcome flow.
 */
export const MATH_CURVE_SANCTIONED_CONTEXTS = ["chats", "thinking", "splash"] as const;

export type MathCurveContext = (typeof MATH_CURVE_SANCTIONED_CONTEXTS)[number];
