// Cold-open total-unread popup (WeChat-style "{n} unread messages" pill).
//
// UI-SPEC §D-06 / line 192 — surfaces once per app launch when the splash
// dismisses and the aggregate unread count > 0. After 1.5s it fades out.
// Module-scoped `let hasShown = false` ensures we don't re-fire on every
// route change. Refresh / desktop relaunch resets the flag (intentional —
// it's the "this is the splash" semantic).
//
// Mounted by `splash-overlay.tsx` after the splash fades; it self-skips when
// `totalUnread <= 0` and unmounts after the timer.

import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { GlassSurface } from "@/components/ui/glass-surface";

const POPUP_DURATION_MS = 1500; // UI-SPEC line 192 / D-06
const FADE_OUT_MS = 240;

// Module-scoped one-shot per app launch. Mirrors `splash-overlay.tsx`.
let hasShown = false;

export interface TotalUnreadPopupProps {
  totalUnread: number;
  testID?: string;
}

export function TotalUnreadPopup({ totalUnread, testID }: TotalUnreadPopupProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [visible, setVisible] = useState(!hasShown && totalUnread > 0);

  useEffect(() => {
    if (hasShown) return;
    if (totalUnread <= 0) return;
    hasShown = true;
    const timer = setTimeout(() => setVisible(false), POPUP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [totalUnread]);

  const labelStyle = useMemo(
    () => [styles.label, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );

  if (!visible || totalUnread <= 0) return null;

  return (
    <View
      testID={testID ?? "total-unread-popup"}
      style={styles.container}
      accessibilityLiveRegion="polite"
      pointerEvents="none"
    >
      <GlassSurface radius="pill">
        <Text style={labelStyle}>{t("chat.unread.totalPopup", { count: totalUnread })}</Text>
      </GlassSurface>
    </View>
  );
}

// Exposed for tests + the polish-sweep haptic wiring (Plan 02e).
export const TOTAL_UNREAD_POPUP_DURATION_MS = POPUP_DURATION_MS;
export const TOTAL_UNREAD_POPUP_FADE_OUT_MS = FADE_OUT_MS;

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    top: 80,
    alignSelf: "center",
    zIndex: 9998,
  },
  label: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
}));
