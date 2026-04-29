import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { ScreenHeader } from "@/components/headers/screen-header";
import { ScreenTitle } from "@/components/headers/screen-title";

interface MobileTabHeaderProps {
  /**
   * Title rendered in the header. Pass `null`/`undefined` for tabs that
   * intentionally have no title (e.g. the Community placeholder) — the header
   * still reserves the same vertical space so the content under every tab
   * starts at the same baseline.
   */
  title?: string | null;
  trailing?: ReactNode;
  testID?: string;
}

/**
 * Unified header for the four mobile bottom-tab destinations
 * (Chats / Devices / Community / Settings). Builds on the shared
 * `ScreenHeader` so safe-area / traffic-light / status-bar offsets are the
 * same height everywhere — what differs between tabs is only the title.
 */
export function MobileTabHeader({ title, trailing, testID }: MobileTabHeaderProps) {
  const { theme } = useUnistyles();
  const titleNode = useMemo(() => {
    if (!title) {
      // Empty View instead of `null` so the left slot still satisfies the
      // ScreenHeader layout (consistent height across tabs).
      return <View style={styles.emptyTitle} />;
    }
    return <ScreenTitle testID={testID ? `${testID}-title` : undefined}>{title}</ScreenTitle>;
  }, [title, testID]);
  void theme;
  return <ScreenHeader left={titleNode} right={trailing} />;
}

const styles = StyleSheet.create(() => ({
  emptyTitle: {
    height: 1,
  },
}));
