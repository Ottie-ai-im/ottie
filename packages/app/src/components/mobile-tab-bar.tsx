import { useCallback, useMemo, type ComponentType } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { MessagesSquare, Server, Settings, Users } from "lucide-react-native";

export type MobileTab = "chats" | "devices" | "community" | "settings";

export interface MobileTabBarProps {
  activeTab: MobileTab;
  onSelect: (tab: MobileTab) => void;
}

interface TabSpec {
  id: MobileTab;
  labelKey: "tabs.chats" | "tabs.devices" | "tabs.community" | "tabs.settings";
  icon: ComponentType<{ size?: number; color?: string }>;
}

const TABS: readonly TabSpec[] = [
  { id: "chats", labelKey: "tabs.chats", icon: MessagesSquare },
  { id: "devices", labelKey: "tabs.devices", icon: Server },
  { id: "community", labelKey: "tabs.community", icon: Users },
  { id: "settings", labelKey: "tabs.settings", icon: Settings },
];

/**
 * IM-style bottom tab bar for the mobile shell. Sits flush against the
 * safe-area inset and uses the macOS/iOS 26 glass treatment so the chat
 * background reads through.
 *
 * Only mount this on a compact form factor — desktop has its own resizable
 * left sidebar and doesn't need this strip.
 */
export function MobileTabBar({ activeTab, onSelect }: MobileTabBarProps) {
  const insets = useSafeAreaInsets();
  const containerStyle = useMemo(
    () => [styles.container, { paddingBottom: Math.max(insets.bottom, 8) }],
    [insets.bottom],
  );
  return (
    <View style={containerStyle} accessibilityRole="tablist">
      {TABS.map((tab) => (
        <TabButton key={tab.id} tab={tab} active={tab.id === activeTab} onSelect={onSelect} />
      ))}
    </View>
  );
}

function TabButton({
  tab,
  active,
  onSelect,
}: {
  tab: TabSpec;
  active: boolean;
  onSelect: (tab: MobileTab) => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const label = t(tab.labelKey);
  const handlePress = useCallback(() => onSelect(tab.id), [onSelect, tab.id]);
  const buttonStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.button,
      pressed ? styles.buttonPressed : null,
    ],
    [],
  );
  const iconColor = active ? theme.colors.accent : theme.colors.foregroundMuted;
  const labelStyle = useMemo(
    () => [styles.label, { color: iconColor }, active ? styles.labelActive : null],
    [iconColor, active],
  );
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  const Icon = tab.icon;
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="tab"
      accessibilityState={accessibilityState}
      accessibilityLabel={label}
      testID={`mobile-tab-${tab.id}`}
      style={buttonStyle}
    >
      <Icon size={22} color={iconColor} />
      <Text style={labelStyle}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-around",
    paddingTop: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    backgroundColor: theme.colors.surfaceGlassStrong,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderGlass,
  },
  button: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
  },
  buttonPressed: {
    backgroundColor: theme.colors.surfaceGlassHover,
  },
  label: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    letterSpacing: -0.1,
  },
  labelActive: {
    fontWeight: theme.fontWeight.semibold,
  },
}));
