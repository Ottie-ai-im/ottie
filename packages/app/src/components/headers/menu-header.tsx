import { useCallback, useMemo, type ReactNode } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronLeft, PanelLeft } from "lucide-react-native";
import { ScreenHeader } from "./screen-header";
import { ScreenTitle } from "./screen-title";
import { HeaderToggleButton } from "./header-toggle-button";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getShortcutOs } from "@/utils/shortcut-platform";

interface MenuHeaderProps {
  title?: string;
  rightContent?: ReactNode;
  borderless?: boolean;
}

interface SidebarMenuToggleProps {
  style?: StyleProp<ViewStyle>;
  tooltipSide?: "left" | "right" | "top" | "bottom";
  testID?: string;
  nativeID?: string;
}

export function SidebarMenuToggle({
  style,
  tooltipSide = "right",
  testID = "menu-button",
  nativeID = "menu-button",
}: SidebarMenuToggleProps = {}) {
  const { theme } = useUnistyles();
  const isMobile = useIsCompactFormFactor();
  const isOpen = usePanelStore((state) => selectIsAgentListOpen(state, { isCompact: isMobile }));
  const toggleAgentListForLayout = usePanelStore((state) => state.toggleAgentListForLayout);
  const toggleShortcutKeys = useMemo(
    () => (getShortcutOs() === "mac" ? ["mod", "B"] : ["mod", "."]),
    [],
  );

  const menuIconColor =
    !isMobile && isOpen ? theme.colors.foreground : theme.colors.foregroundMuted;

  const handlePress = useCallback(() => {
    toggleAgentListForLayout({ isCompact: isMobile });
  }, [toggleAgentListForLayout, isMobile]);

  const accessibilityState = useMemo(() => ({ expanded: isOpen }), [isOpen]);

  return (
    <HeaderToggleButton
      onPress={handlePress}
      tooltipLabel="Toggle sidebar"
      tooltipKeys={toggleShortcutKeys}
      tooltipSide={tooltipSide}
      testID={testID}
      nativeID={nativeID}
      style={style}
      accessible
      accessibilityRole="button"
      accessibilityLabel={isOpen ? "Close menu" : "Open menu"}
      accessibilityState={accessibilityState}
    >
      {isMobile ? (
        <ChevronLeft size={theme.iconSize.md} color={menuIconColor} />
      ) : (
        <PanelLeft size={theme.iconSize.md} color={menuIconColor} />
      )}
    </HeaderToggleButton>
  );
}

export function MenuHeader({ title, rightContent, borderless }: MenuHeaderProps) {
  return (
    <ScreenHeader
      left={
        <>
          <SidebarMenuToggle />
          {title && <ScreenTitle>{title}</ScreenTitle>}
        </>
      }
      right={rightContent}
      leftStyle={styles.left}
      borderless={borderless}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  left: {
    gap: theme.spacing[2],
  },
}));
