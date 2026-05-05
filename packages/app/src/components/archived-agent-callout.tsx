import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { FOOTER_HEIGHT, MAX_CONTENT_WIDTH } from "@/constants/layout";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import { Button } from "@/components/ui/button";
import { makeRowKey, useChatRowStateStore } from "@/stores/chat-row-state-store";
import type { Theme } from "@/styles/theme";

interface ArchivedAgentCalloutProps {
  serverId: string;
  agentId: string;
}

export function ArchivedAgentCallout({ serverId, agentId }: ArchivedAgentCalloutProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const [isUnarchiving, setIsUnarchiving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { style: keyboardAnimatedStyle } = useKeyboardShiftStyle({ mode: "translate" });

  const containerStyle = useMemo(
    () => [styles.container, { paddingBottom: insets.bottom }, keyboardAnimatedStyle],
    [insets.bottom, keyboardAnimatedStyle],
  );

  const handleUnarchive = useCallback(async () => {
    if (!client || !isConnected || isUnarchiving) return;
    setIsUnarchiving(true);
    setErrorMessage(null);
    try {
      // refreshAgent on the daemon: unarchives, resumes from persistence,
      // hydrates the timeline. Mirror the local archive flag so the row
      // resurfaces in the active chat list immediately.
      await client.refreshAgent(agentId);
      useChatRowStateStore.getState().setArchived(makeRowKey(serverId, agentId), false);
    } catch (error) {
      console.error("[ArchivedAgentCallout] Failed to unarchive agent:", error);
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      setIsUnarchiving(false);
    }
    // Note: we deliberately do NOT clear `isUnarchiving` on the success
    // branch — the agent panel re-renders with `archivedAt = null` and the
    // composer replaces this callout, so the spinner stays put through the
    // transition rather than flashing back to the idle state.
  }, [client, isConnected, isUnarchiving, agentId, serverId]);

  return (
    <Animated.View style={containerStyle}>
      <View style={styles.inputAreaContainer}>
        <View style={styles.inputAreaContent}>
          <View style={styles.callout}>
            <View style={styles.copyColumn}>
              <Text style={styles.calloutTitle}>
                {t("chat.archivedCallout.title", { defaultValue: "Conversation archived" })}
              </Text>
              <Text style={styles.calloutBody}>
                {t("chat.archivedCallout.body", {
                  defaultValue: "Resume to reload the full history and keep chatting.",
                })}
              </Text>
              {errorMessage ? <Text style={styles.calloutError}>{errorMessage}</Text> : null}
            </View>
            <Button
              size="sm"
              variant="secondary"
              onPress={handleUnarchive}
              disabled={!isConnected || isUnarchiving}
              leftIcon={isUnarchiving ? UnarchiveSpinner : undefined}
            >
              {isUnarchiving
                ? t("chat.archivedCallout.resuming", { defaultValue: "Resuming…" })
                : t("chat.archivedCallout.resume", { defaultValue: "Resume" })}
            </Button>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

function UnarchiveSpinner() {
  return <ActivityIndicator size="small" />;
}

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    flexDirection: "column",
    position: "relative",
  },
  inputAreaContainer: {
    position: "relative",
    minHeight: FOOTER_HEIGHT,
    marginHorizontal: "auto",
    alignItems: "center",
    width: "100%",
    overflow: "visible",
    padding: theme.spacing[4],
  },
  inputAreaContent: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
  },
  callout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius["2xl"],
    paddingVertical: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
    paddingHorizontal: {
      xs: theme.spacing[4],
      md: theme.spacing[6],
    },
  },
  copyColumn: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  calloutTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  calloutBody: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  calloutError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
    marginTop: 2,
  },
})) as unknown as Record<string, object>;
