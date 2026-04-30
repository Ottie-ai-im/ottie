import { useCallback, useEffect, useMemo } from "react";
import { Pressable, StyleSheet as RNStyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Mic } from "lucide-react-native";
import { isNative } from "@/constants/platform";
import { useAppSettings } from "@/hooks/use-settings";
import { selectVoicePhase, useVoiceControlStore } from "@/voice-control/voice-control-store";
import { voiceController } from "@/voice-control/voice-controller";

/**
 * Mobile-only "floating mic ball" — WeChat / Messenger style permanent
 * overlay. Draggable: long-press anywhere on the orb starts recording,
 * release stops it. The orb persists across navigation while the master
 * voice toggle is on AND the showFloatingOrb flag is true.
 *
 * Phase 1 wires only the long-press → store transitions. Phase 2 adds the
 * actual audio capture and a transient pill above the orb showing transcript +
 * action log (we'll likely lift the desktop pill body into a shared component
 * for that).
 */

const ORB_SIZE = 56;
const ORB_MARGIN = 16;

export function VoiceFloatingOrb() {
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { settings } = useAppSettings();
  const voice = settings.betaFeatures.voiceControl;
  const phase = useVoiceControlStore(selectVoicePhase);

  // Default position: bottom-right, above safe area.
  const initialX = windowWidth - ORB_SIZE - ORB_MARGIN;
  const initialY = windowHeight - ORB_SIZE - ORB_MARGIN - insets.bottom - 80;

  const translationX = useSharedValue(initialX);
  const translationY = useSharedValue(initialY);
  const offsetX = useSharedValue(initialX);
  const offsetY = useSharedValue(initialY);
  const scale = useSharedValue(1);

  // Reposition on viewport resize so the orb doesn't drift off-screen.
  useEffect(() => {
    const maxX = windowWidth - ORB_SIZE - ORB_MARGIN;
    const maxY = windowHeight - ORB_SIZE - ORB_MARGIN - insets.bottom;
    if (translationX.value > maxX) {
      translationX.value = maxX;
      offsetX.value = maxX;
    }
    if (translationY.value > maxY) {
      translationY.value = maxY;
      offsetY.value = maxY;
    }
  }, [windowWidth, windowHeight, insets.bottom, translationX, translationY, offsetX, offsetY]);

  const handlePressIn = useCallback(() => {
    scale.value = withTiming(0.92, { duration: 100 });
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { damping: 12 });
  }, [scale]);

  const handleLongPress = useCallback(() => {
    voiceController.startPushToTalk();
  }, []);

  const handleRelease = useCallback(() => {
    if (phase === "recording") {
      voiceController.stopPushToTalk();
    }
  }, [phase]);

  // Drag-to-reposition gesture on the orb. Disabled while recording so the
  // user doesn't accidentally drag mid-talk.
  const dragGesture = Gesture.Pan()
    .enabled(phase === "idle")
    .onUpdate((event) => {
      const maxX = windowWidth - ORB_SIZE - ORB_MARGIN;
      const maxY = windowHeight - ORB_SIZE - ORB_MARGIN - insets.bottom;
      const minX = ORB_MARGIN;
      const minY = ORB_MARGIN + insets.top;
      translationX.value = Math.max(minX, Math.min(maxX, offsetX.value + event.translationX));
      translationY.value = Math.max(minY, Math.min(maxY, offsetY.value + event.translationY));
    })
    .onEnd(() => {
      offsetX.value = translationX.value;
      offsetY.value = translationY.value;
      // Snap to nearest edge (left or right) for that "magnetic toolbar" feel
      // most floating-mic implementations use.
      const center = translationX.value + ORB_SIZE / 2;
      const targetX = center < windowWidth / 2 ? ORB_MARGIN : windowWidth - ORB_SIZE - ORB_MARGIN;
      translationX.value = withSpring(targetX, { damping: 18 });
      offsetX.value = targetX;
    });

  const orbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translationX.value },
      { translateY: translationY.value },
      { scale: scale.value },
    ],
  }));

  const isRecording = phase === "recording";

  const animatedContainerStyle = useMemo(() => [styles.orbContainer, orbStyle], [orbStyle]);
  const orbPressableStyle = useMemo(
    () => [styles.orb, isRecording && styles.orbRecording],
    [isRecording],
  );

  if (!isNative) return null;
  if (!voice.enabled) return null;
  if (!voice.showFloatingOrb) return null;

  return (
    <View style={ORB_OVERLAY_STYLE} pointerEvents="box-none">
      <GestureDetector gesture={dragGesture}>
        <Animated.View style={animatedContainerStyle}>
          <Pressable
            style={orbPressableStyle}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onLongPress={handleLongPress}
            onPress={handleRelease}
            delayLongPress={250}
            accessibilityRole="button"
            accessibilityLabel="Voice control"
            testID="voice-control-floating-orb"
          >
            <Mic size={24} color={theme.colors.accentForeground} />
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const ORB_OVERLAY_STYLE = RNStyleSheet.absoluteFillObject;

const styles = StyleSheet.create((theme) => ({
  orbContainer: {
    position: "absolute",
    width: ORB_SIZE,
    height: ORB_SIZE,
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.md,
  },
  orbRecording: {
    backgroundColor: theme.colors.accentBright,
    borderWidth: 3,
    borderColor: theme.colors.surface0,
  },
}));
