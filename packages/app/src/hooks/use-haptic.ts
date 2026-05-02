import { useCallback, useRef } from "react";
import * as Haptics from "expo-haptics";
import { isNative } from "@/constants/platform";
import { useLowPowerMode } from "./use-low-power-mode";

/**
 * useHaptic — single source of truth for native haptic feedback.
 *
 * Per Phase 02 PATTERNS / UI-SPEC (D-18 Haptics), every consumer must go
 * through this hook so we have one place to:
 *   - Honor the user's haptics toggle (`AppSettings.haptics.enabled`)
 *   - Honor low-power mode (skipped to save battery)
 *   - Debounce repeated events of the same kind to avoid haptic spam when a
 *     gesture or animation fires events at 60fps
 *   - No-op cleanly on web (Haptics is a native-only API)
 *
 * The `isLowPowerMode` source is wired by Plan 02e via `expo-battery` (or
 * `false` if unavailable). Plan 02a accepts the input as-is so consumers
 * stay decoupled from the source of low-power state.
 */
export type HapticEvent = "light" | "medium" | "heavy";

export interface UseHapticInput {
  enabled: boolean;
  isLowPowerMode?: boolean;
}

export interface UseHapticResult {
  fire(event: HapticEvent): void;
}

const DEBOUNCE_MS = 200;

export function useHaptic(input: UseHapticInput): UseHapticResult {
  const liveLowPower = useLowPowerMode();
  const isLowPower = input.isLowPowerMode ?? liveLowPower;

  // Per-event last-fired tracking. Light / medium / heavy each get their own
  // debounce window so a "light tap" + "heavy success" within 50ms both
  // still fire.
  const lastFiredRef = useRef<Map<HapticEvent, number>>(new Map());

  const fire = useCallback(
    (event: HapticEvent) => {
      // Web has no native haptic API — drop silently. Don't gate on
      // `Platform.OS` directly per CLAUDE.md.
      if (!isNative) return;

      // User opted out OR battery is low — no-op.
      if (!input.enabled || isLowPower) return;

      const now = Date.now();
      const last = lastFiredRef.current.get(event) ?? 0;
      if (now - last < DEBOUNCE_MS) return;
      lastFiredRef.current.set(event, now);

      // Catch the rejected promise so a failure to talk to the native module
      // never surfaces as an unhandled rejection in dev.
      switch (event) {
        case "light":
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
          return;
        case "medium":
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
          return;
        case "heavy":
          // Heavy maps to a notification haptic per UI-SPEC D-18 — used for
          // success / warning beats rather than tactile feedback on a tap.
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
            () => undefined,
          );
          return;
      }
    },
    [input.enabled, isLowPower],
  );

  return { fire };
}
