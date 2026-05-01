// Native swipe-left actions for chat rows.
//
// Wraps `ReanimatedSwipeable` from react-native-gesture-handler/ReanimatedSwipeable
// (the variant whose `renderRightActions` callback exposes
// `dragX: SharedValue<number>` — the legacy `Swipeable` from the package
// root only provides RN Animated values which we can't observe with
// `useAnimatedReaction`).
//
// Threshold haptics (B5 — exact-literal constants enforced by verify gate):
//   SWIPE_LIGHT_THRESHOLD = 90  → light haptic when finger crosses 90px
//   SWIPE_HEAVY_THRESHOLD = 120 → heavy haptic when finger crosses 120px
//
// Per-gesture debounce flags live on the UI thread (`useSharedValue<boolean>`).
// They re-arm whenever the finger returns near the origin (<10px) so a series
// of swipes still fires haptics on each crossing.
//
// On web this file is NOT loaded — chat-row.tsx renders its children directly
// on web (gesture-handler doesn't ship a usable web Swipeable here, and hover-
// quick-actions handles the same semantic affordances).

import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { useAnimatedReaction, runOnJS, useSharedValue } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useHaptic } from "@/hooks/use-haptic";
import { actionRegistry } from "@/actions/registry";

// UI-SPEC line 60 — exact-literal threshold constants. The B5 verify gate
// greps for these literals; never derive them from a config or a prop.
const SWIPE_LIGHT_THRESHOLD = 90;
const SWIPE_HEAVY_THRESHOLD = 120;

export interface ChatRowSwipeActionsProps {
  serverId: string;
  agentId: string;
  children: ReactNode;
  onDelete?: () => void;
}

export function ChatRowSwipeActions({
  serverId,
  agentId,
  children,
  onDelete,
}: ChatRowSwipeActionsProps) {
  // useHaptic is settings-aware via Plan 02a; AppSettings doesn't expose
  // `haptics.enabled` yet, so the conservative default is `true`. Plan 02e
  // (polish sweep) wires `expo-battery` for `isLowPowerMode` and surfaces
  // the user toggle.
  const haptic = useHaptic({ enabled: true, isLowPowerMode: false });

  // Stable bound references — react-perf rules forbid creating bind() calls
  // inline in JSX. Memoize the JS-thread haptic dispatchers once per haptic
  // instance change.
  const fireLight = useCallback(() => haptic.fire("light"), [haptic]);
  const fireHeavy = useCallback(() => haptic.fire("heavy"), [haptic]);

  const renderRightActions = useCallback(
    (_progress: SharedValue<number>, dragX: SharedValue<number>) => (
      <ChatRowSwipeActionGroup
        serverId={serverId}
        agentId={agentId}
        dragX={dragX}
        onDelete={onDelete}
        fireLight={fireLight}
        fireHeavy={fireHeavy}
      />
    ),
    [serverId, agentId, onDelete, fireLight, fireHeavy],
  );

  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={SWIPE_HEAVY_THRESHOLD}
      renderRightActions={renderRightActions}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

/**
 * The right-actions group is its own component so we can run hooks
 * (`useAnimatedReaction`, `useSharedValue`) inside it without breaking
 * rules-of-hooks (`renderRightActions` is itself a callback that could be
 * called multiple times per render).
 */
function ChatRowSwipeActionGroup({
  serverId,
  agentId,
  dragX,
  onDelete,
  fireLight,
  fireHeavy,
}: {
  serverId: string;
  agentId: string;
  dragX: SharedValue<number>;
  onDelete?: () => void;
  fireLight: () => void;
  fireHeavy: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();

  // Per-gesture flags on the UI thread; reset when finger returns near origin.
  const firedLight = useSharedValue(false);
  const firedHeavy = useSharedValue(false);

  useAnimatedReaction(
    () => Math.abs(dragX.value),
    (current) => {
      // Re-arm when finger near origin so subsequent swipes still trigger.
      if (current < 10) {
        firedLight.value = false;
        firedHeavy.value = false;
        return;
      }
      if (
        current >= SWIPE_LIGHT_THRESHOLD &&
        current < SWIPE_HEAVY_THRESHOLD &&
        !firedLight.value
      ) {
        firedLight.value = true;
        runOnJS(fireLight)();
      }
      if (current >= SWIPE_HEAVY_THRESHOLD && !firedHeavy.value) {
        firedHeavy.value = true;
        runOnJS(fireHeavy)();
      }
    },
    [],
  );

  const handleMarkRead = useCallback(() => {
    void actionRegistry.dispatch("chat.menu.markRead", { serverId, agentId });
  }, [serverId, agentId]);

  const handleMute = useCallback(() => {
    void actionRegistry.dispatch("chat.menu.mute", { serverId, agentId });
  }, [serverId, agentId]);

  const handleDelete = useCallback(() => {
    onDelete?.();
    void actionRegistry.dispatch("chat.menu.delete", { serverId, agentId });
  }, [serverId, agentId, onDelete]);

  // Memoize all the inline arrays / objects passed to JSX style props so
  // react-perf doesn't flag them on every render.
  const neutralActionStyle = useMemo(
    () => [styles.action, { backgroundColor: theme.colors.surface2 }],
    [theme.colors.surface2],
  );
  const destructiveActionStyle = useMemo(
    () => [styles.action, { backgroundColor: theme.colors.destructive }],
    [theme.colors.destructive],
  );
  const destructiveLabelStyle = useMemo(
    () => [styles.actionLabel, { color: theme.colors.destructiveForeground }],
    [theme.colors.destructiveForeground],
  );

  return (
    <View style={styles.actionGroup}>
      <Pressable
        accessibilityLabel={t("chat.swipe.markRead")}
        style={neutralActionStyle}
        onPress={handleMarkRead}
      >
        <Text style={styles.actionLabel}>{t("chat.swipe.markRead")}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel={t("chat.swipe.mute")}
        style={neutralActionStyle}
        onPress={handleMute}
      >
        <Text style={styles.actionLabel}>{t("chat.swipe.mute")}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel={t("chat.swipe.delete")}
        style={destructiveActionStyle}
        onPress={handleDelete}
      >
        <Text style={destructiveLabelStyle}>{t("chat.swipe.delete")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  actionGroup: {
    flexDirection: "row",
  },
  action: {
    width: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
}));
