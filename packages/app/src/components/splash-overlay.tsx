import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Animated, { FadeOut } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { AppleHelloEffect } from "@/components/apple-hello-effect";
import { otterAssets } from "@/assets/otter";
import { TotalUnreadPopup } from "@/components/total-unread-popup";
import { useChatRowStateStore } from "@/stores/chat-row-state-store";

const SPLASH_DURATION_MS = 2200;
const FADE_OUT_MS = 420;
const TOTAL_VISIBLE_MS = SPLASH_DURATION_MS + 200;

/**
 * Module-scoped flag — splash plays once per app launch (not persisted).
 * Refreshing the page or relaunching the desktop shell triggers it again,
 * which matches the "this is the splash" mental model on mobile too.
 */
let hasShown = false;

function pickGreeting(language: string | undefined): string {
  if (!language) return "Hello";
  const lower = language.toLowerCase();
  if (lower.startsWith("zh")) return "你好";
  if (lower.startsWith("ja")) return "こんにちは";
  if (lower.startsWith("ko")) return "안녕";
  if (lower.startsWith("es")) return "Hola";
  if (lower.startsWith("fr")) return "Bonjour";
  if (lower.startsWith("de")) return "Hallo";
  if (lower.startsWith("ru")) return "Привет";
  return "Hello";
}

/**
 * Full-screen splash overlay that plays the Apple-style "hello" reveal once
 * per app launch and then fades out, leaving the app shell underneath. On
 * subsequent navigations within the same session it short-circuits to null.
 *
 * Mounted at the root so it covers every route on first paint.
 */
export function SplashOverlay() {
  const { i18n } = useTranslation();
  const { theme } = useUnistyles();
  const [visible, setVisible] = useState(!hasShown);

  useEffect(() => {
    if (hasShown) return;
    hasShown = true;
    const timer = setTimeout(() => setVisible(false), TOTAL_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, []);

  const greeting = useMemo(() => pickGreeting(i18n.language), [i18n.language]);

  const containerStyle = useMemo(
    () => [styles.container, { backgroundColor: theme.colors.surface0 }],
    [theme.colors.surface0],
  );

  // Aggregate unread across every chat row (CONTEXT Q1 — chat-row state is
  // client-only; the daemon is never asked for a server-side total). The
  // selector is computed from the store snapshot so a single rebuild fires
  // when any row's unread changes.
  const totalUnread = useChatRowStateStore((s) => {
    let sum = 0;
    for (const row of Object.values(s.rows)) {
      sum += row.unread;
    }
    return sum;
  });

  if (!visible) {
    // After the splash dismisses, surface the WeChat-style total-unread popup
    // for ~1.5s when there's at least 1 unread message. The popup itself
    // owns its `hasShown` module flag so it fires once per app launch.
    return totalUnread > 0 ? <TotalUnreadPopup totalUnread={totalUnread} /> : null;
  }

  return (
    <Animated.View
      style={containerStyle}
      pointerEvents="auto"
      exiting={FadeOut.duration(FADE_OUT_MS)}
    >
      <View style={styles.center} pointerEvents="none">
        <View style={styles.logo}>
          <otterAssets.logo size={48} />
        </View>
        <AppleHelloEffect text={greeting} width={280} durationMs={SPLASH_DURATION_MS} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[6],
  },
  logo: {
    marginBottom: theme.spacing[2],
  },
}));
