import {
  Text,
  Pressable,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ExternalLink, GitPullRequest } from "lucide-react-native";
import { openExternalUrl } from "@/utils/open-external-url";
import type { PrHint } from "@/hooks/use-checkout-pr-status-query";

export function getWorkspacePrIconColor(
  theme: ReturnType<typeof useUnistyles>["theme"],
  state: PrHint["state"],
) {
  switch (state) {
    case "merged":
      return theme.colors.palette.zinc[400];
    case "open":
      return theme.colors.palette.green[500];
    case "closed":
      return theme.colors.palette.red[500];
  }
}

export function PrBadge({ hint }: { hint: PrHint }) {
  const { theme } = useUnistyles();
  const [isHovered, setIsHovered] = useState(false);
  const activeColor = isHovered ? theme.colors.foreground : theme.colors.foregroundMuted;
  const iconColor = getWorkspacePrIconColor(theme, hint.state);

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
  }, []);

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      void openExternalUrl(hint.url);
    },
    [hint.url],
  );

  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);

  const prBadgeTextStyle = useMemo(
    () => [prBadgeStyles.text, { color: activeColor }],
    [activeColor],
  );

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Pull request #${hint.number}`}
      hitSlop={4}
      onPressIn={handlePressIn}
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={prBadgePressableStyle}
    >
      {isHovered ? (
        <ExternalLink size={12} color={activeColor} />
      ) : (
        <GitPullRequest size={12} color={iconColor} />
      )}
      <Text style={prBadgeTextStyle} numberOfLines={1}>
        #{hint.number}
      </Text>
    </Pressable>
  );
}

function prBadgePressableStyle({ pressed }: PressableStateCallbackType) {
  return [prBadgeStyles.badge, pressed && prBadgeStyles.badgePressed];
}

const prBadgeStyles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  badgePressed: {
    opacity: 0.82,
  },
  text: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 14,
  },
}));
