import { useEffect, useMemo } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { useAppSettings } from "@/hooks/use-settings";
import {
  selectGhostCursorGeneration,
  selectGhostCursorPhase,
  selectGhostCursorPosition,
  useGhostCursorStore,
} from "@/voice-control/ghost-cursor-store";

/**
 * Visual ghost cursor — pulses when the AI takes an action so the user can
 * see WHERE the action landed, not just WHAT it did. Inspired by openai/
 * realtime-voice-component's GhostCursorOverlay.
 *
 * Visual: 18px halo ring + 8px solid dot, accent-colored. Springs to the
 * target position over ~280ms, pulses on arrival (scale 1 → 1.4 → 1), then
 * fades out 600ms after settling.
 *
 * Web-only. Native gets nothing — there's no cross-platform "absolute
 * pointer position above the entire UI" model that maps cleanly.
 */

const TRAVEL_MS = 280;
const PULSE_MS = 220;
const FADE_OUT_MS = 320;

export function GhostCursorOverlay() {
  const { theme } = useUnistyles();
  const { settings } = useAppSettings();
  const enabled = settings.betaFeatures.voiceControl.enabled;

  const phase = useGhostCursorStore(selectGhostCursorPhase);
  const position = useGhostCursorStore(selectGhostCursorPosition);
  const generation = useGhostCursorStore(selectGhostCursorGeneration);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(1);

  // Drive position + opacity from store transitions. Generation forces a
  // restart even when target hasn't changed (e.g. same command fired twice).
  useEffect(() => {
    if (phase === "hidden") {
      opacity.value = withTiming(0, { duration: FADE_OUT_MS });
      return;
    }
    if (phase === "approaching") {
      // Fade in fast, glide to position with a smooth ease-out.
      opacity.value = withTiming(1, { duration: 120 });
      translateX.value = withTiming(position.x, {
        duration: TRAVEL_MS,
        easing: Easing.bezier(0.22, 0.84, 0.26, 1),
      });
      translateY.value = withTiming(position.y, {
        duration: TRAVEL_MS,
        easing: Easing.bezier(0.22, 0.84, 0.26, 1),
      });
      return;
    }
    if (phase === "pulsing") {
      // Snap pulse on arrival.
      scale.value = withSequence(
        withTiming(1.45, { duration: PULSE_MS / 2 }),
        withTiming(1, { duration: PULSE_MS / 2 }),
      );
      return;
    }
    if (phase === "leaving") {
      opacity.value = withTiming(0, { duration: FADE_OUT_MS });
    }
  }, [phase, position.x, position.y, generation, translateX, translateY, opacity, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    opacity: opacity.value,
  }));

  const cursorStyle = useMemo(() => [styles.cursor, animatedStyle], [animatedStyle]);
  const haloStyle = useMemo(
    () => [styles.halo, { borderColor: theme.colors.accent }],
    [theme.colors.accent],
  );
  const dotStyle = useMemo(
    () => [styles.dot, { backgroundColor: theme.colors.accentBright }],
    [theme.colors.accentBright],
  );

  if (!enabled) return null;
  if (!isWeb) return null;

  return (
    <View style={styles.layer} pointerEvents="none">
      <Animated.View style={cursorStyle}>
        <View style={haloStyle} />
        <View style={dotStyle} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((_theme) => ({
  layer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
    zIndex: 9500,
  },
  cursor: {
    position: "absolute",
    top: -16,
    left: -16,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    opacity: 0.55,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
}));
