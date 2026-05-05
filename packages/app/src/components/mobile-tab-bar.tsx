import { useCallback, useMemo, type ComponentType } from "react";
import { Platform, Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Activity, MessagesSquare, Server, Settings, Blocks, Sparkles } from "lucide-react-native";
import { isNative } from "@/constants/platform";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";

export type MobileTab = "chats" | "devices" | "extensions" | "assistants" | "usage" | "settings";

export interface MobileTabBarProps {
  activeTab: MobileTab;
  onSelect: (tab: MobileTab) => void;
}

interface TabSpec {
  id: MobileTab;
  labelKey:
    | "tabs.chats"
    | "tabs.devices"
    | "tabs.extensions"
    | "tabs.assistants"
    | "tabs.usage"
    | "tabs.settings";
  icon: ComponentType<{ size?: number; color?: string }>;
}

const TABS: readonly TabSpec[] = [
  { id: "chats", labelKey: "tabs.chats", icon: MessagesSquare },
  { id: "devices", labelKey: "tabs.devices", icon: Server },
  { id: "extensions", labelKey: "tabs.extensions", icon: Blocks },
  { id: "assistants", labelKey: "tabs.assistants", icon: Sparkles },
  { id: "usage", labelKey: "tabs.usage", icon: Activity },
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
  const { theme } = useUnistyles();
  const containerStyle = useMemo(
    () => [styles.container, { paddingBottom: Math.max(insets.bottom, 8) }],
    [insets.bottom],
  );
  const tabs = TABS.map((tab) => (
    <TabButton key={tab.id} tab={tab} active={tab.id === activeTab} onSelect={onSelect} />
  ));
  if (isNative) {
    return (
      <BlurView
        tint={
          theme.colorScheme === "dark" ? "systemChromeMaterialDark" : "systemChromeMaterialLight"
        }
        intensity={80}
        experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
        style={containerStyle}
        accessibilityRole="tablist"
      >
        {tabs}
      </BlurView>
    );
  }
  return (
    <View style={containerStyle} accessibilityRole="tablist">
      {tabs}
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
  // Long-press on the active tab opens the command-center bottom sheet
  // (Plan 02a UI-SPEC line 313 — native command-center trigger). Long-press
  // on an inactive tab is a no-op so the gesture stays unambiguous.
  const handleLongPress = useCallback(() => {
    if (!active) return;
    useKeyboardShortcutsStore.getState().setCommandCenterOpen(true);
  }, [active]);
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
      onLongPress={handleLongPress}
      delayLongPress={350}
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
