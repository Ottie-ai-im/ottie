/**
 * Modality enum — every input surface that can dispatch into ActionRegistry.
 *
 * The CI parity test (`registry.parity.test.ts`) enforces that every NAT-01
 * reference action is reachable from at least 2 modalities on web/Tauri so
 * input drift between voice / keyboard / cmdk / long-press menus stays
 * impossible.
 */
export type Modality = "voice" | "kbd" | "cmdk" | "menu" | "gesture";

export const ALL_MODALITIES: readonly Modality[] = [
  "voice",
  "kbd",
  "cmdk",
  "menu",
  "gesture",
] as const;
