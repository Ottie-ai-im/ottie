import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Send, X } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { useActiveAiShares } from "@/hooks/use-active-ai-shares";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

/**
 * Phase 4 v2/c — friend-side shared-agent surface. The friend reaches
 * this route from the active-share banner on the friend chat screen.
 * What we ship here:
 *
 *   - Header that names the agent + peer + an End button
 *   - A locally-buffered "you sent" list (since the timeline-streaming-
 *     back direction is v2/d). Each row is just the prompt text + a
 *     status: "sending" | "sent" | "failed: …".
 *   - Compose box that fires `chatP2pAiShareSendPrompt` and resets.
 *   - "Share ended" empty state when `useActiveAiShares` no longer
 *     contains this inviteId (peer ended it, or our daemon restarted
 *     and the v1/v2 in-memory registry is gone).
 *
 * Owner sees the prompt land in their existing AgentManager pipeline
 * (not surfaced on this screen until v2/d).
 */

interface LocalPromptEntry {
  /** Local id (separate from the wire promptId for the optimistic case). */
  localId: string;
  body: string;
  status: "sending" | "sent" | "failed";
  error?: string;
  /** Wire id once the daemon ACKs. Useful for v2/d's reconciliation. */
  promptId?: string;
}

function resolveParam(raw: string | string[] | undefined): string | null {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0] ?? null;
  return null;
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderGlass,
    gap: theme.spacing[2],
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingRight: theme.spacing[2],
  },
  backLabel: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  titleColumn: {
    flex: 1,
  },
  title: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  subtitle: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  endButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  endButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  endButtonText: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  body: {
    flex: 1,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  emptyState: {
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[4],
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyStateTitle: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  emptyStateBody: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    textAlign: "center",
  },
  promptList: {
    gap: theme.spacing[2],
  },
  promptRow: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    gap: 2,
  },
  promptBody: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  promptMeta: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  promptMetaError: {
    color: theme.colors.destructive,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderGlass,
  },
  composerInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 160,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    backgroundColor: theme.colors.surface1,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.base,
  },
  composerError: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  endedBanner: {
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[4],
    alignItems: "center",
    gap: theme.spacing[3],
  },
}));

function makeLocalId(): string {
  return `lp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function FriendShareInvitePage() {
  const params = useLocalSearchParams<{
    serverId: string;
    peerRootPubKey: string;
    inviteId: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const queryClient = useQueryClient();

  const serverId = resolveParam(params.serverId);
  const peerRootPubKey = resolveParam(params.peerRootPubKey);
  const inviteId = resolveParam(params.inviteId);

  const client = useHostRuntimeClient(serverId ?? "");
  const { sessions, isLoading } = useActiveAiShares(serverId, peerRootPubKey ?? undefined);
  const session = useMemo(
    () => sessions.find((s) => s.inviteId === inviteId) ?? null,
    [inviteId, sessions],
  );

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [localPrompts, setLocalPrompts] = useState<LocalPromptEntry[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  const promptCount = localPrompts.length;
  useEffect(() => {
    if (promptCount === 0) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [promptCount]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else if (serverId && peerRootPubKey) {
      router.replace({
        pathname: "/h/[serverId]/friend/[peerRootPubKey]",
        params: { serverId, peerRootPubKey },
      });
    } else {
      router.replace("/settings/identity");
    }
  }, [peerRootPubKey, router, serverId]);

  const handleSendPrompt = useCallback(async () => {
    const body = draft.trim();
    if (body.length === 0 || !client || !inviteId) return;
    const localId = makeLocalId();
    setLocalPrompts((prev) => [...prev, { localId, body, status: "sending" }]);
    setSubmitting(true);
    setComposerError(null);
    try {
      const response = await client.chatP2pAiShareSendPrompt({ inviteId, body });
      if (response.error || !response.promptId) {
        const errMsg = response.error ?? t("aiShare.sendPromptFailed");
        setLocalPrompts((prev) =>
          prev.map((p) => (p.localId === localId ? { ...p, status: "failed", error: errMsg } : p)),
        );
        setComposerError(errMsg);
        return;
      }
      setLocalPrompts((prev) =>
        prev.map((p) =>
          p.localId === localId
            ? { ...p, status: "sent", promptId: response.promptId ?? undefined }
            : p,
        ),
      );
      setDraft("");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setLocalPrompts((prev) =>
        prev.map((p) => (p.localId === localId ? { ...p, status: "failed", error: errMsg } : p)),
      );
      setComposerError(errMsg);
    } finally {
      setSubmitting(false);
    }
  }, [client, draft, inviteId, t]);

  const handleSendPress = useCallback(() => {
    void handleSendPrompt();
  }, [handleSendPrompt]);

  const handleEndShare = useCallback(async () => {
    if (!client || !inviteId) return;
    setEnding(true);
    try {
      await client.chatP2pAiShareEnd({ inviteId });
    } finally {
      setEnding(false);
      void queryClient.invalidateQueries({ queryKey: ["ai-share-active", serverId] });
      handleBack();
    }
  }, [client, handleBack, inviteId, queryClient, serverId]);

  const endButtonStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.endButton,
      hovered ? styles.endButtonHovered : null,
    ],
    [],
  );

  const rootStyle = useMemo(
    () => [styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }],
    [insets.bottom, insets.top],
  );
  const sendIcon = useMemo(
    () => <Send size={16} color={theme.colors.palette.white} />,
    [theme.colors.palette.white],
  );

  if (!serverId || !peerRootPubKey || !inviteId) {
    return (
      <View style={rootStyle}>
        <View style={styles.endedBanner}>
          <Text style={styles.emptyStateTitle}>
            {t("aiShare.invalidRoute", { defaultValue: "Invalid share link" })}
          </Text>
          <Button variant="secondary" onPress={handleBack}>
            {t("common.back")}
          </Button>
        </View>
      </View>
    );
  }

  const title = session
    ? t("aiShare.headerTitle", {
        label: session.agentLabel,
        defaultValue: "Sharing {{label}}",
      })
    : t("aiShare.endedTitle", { defaultValue: "AI share ended" });
  const subtitle = session
    ? t("aiShare.headerSubtitle", {
        peer: peerRootPubKey.slice(0, 8),
        defaultValue: "with {{peer}}",
      })
    : "";

  return (
    <View style={rootStyle}>
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
        >
          <ChevronLeft size={20} color={theme.colors.foregroundMuted} />
          <Text style={styles.backLabel}>{t("common.back")}</Text>
        </Pressable>
        <View style={styles.titleColumn}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {session ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("p2pChat.activeShareEnd", { defaultValue: "End session" })}
            onPress={() => void handleEndShare()}
            disabled={ending}
            style={endButtonStyle}
            testID="ai-share-end-button"
          >
            <X size={14} color={theme.colors.foregroundMuted} />
            <Text style={styles.endButtonText}>
              {ending
                ? t("p2pChat.activeShareEnding", { defaultValue: "Ending…" })
                : t("p2pChat.activeShareEnd", { defaultValue: "End session" })}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {!session && !isLoading ? (
        <View style={styles.endedBanner}>
          <Text style={styles.emptyStateTitle}>
            {t("aiShare.endedTitle", { defaultValue: "AI share ended" })}
          </Text>
          <Text style={styles.emptyStateBody}>
            {t("aiShare.endedBody", {
              defaultValue:
                "This share is no longer active. Either you or the owner ended it, or the owner's daemon restarted.",
            })}
          </Text>
          <Button variant="secondary" onPress={handleBack}>
            {t("common.back")}
          </Button>
        </View>
      ) : (
        <>
          <ScrollView
            ref={scrollRef}
            style={styles.body}
            contentContainerStyle={styles.promptList}
            keyboardShouldPersistTaps="handled"
            testID="ai-share-prompts-scroll"
          >
            {localPrompts.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateTitle}>
                  {t("aiShare.emptyTitle", { defaultValue: "Nothing sent yet" })}
                </Text>
                <Text style={styles.emptyStateBody}>
                  {t("aiShare.emptyBody", {
                    defaultValue:
                      "Type a prompt below and your friend's agent will run it. The agent's replies show up on the owner's screen — your view here will fill in once v2/d ships.",
                  })}
                </Text>
              </View>
            ) : (
              localPrompts.map((prompt) => (
                <View key={prompt.localId} style={styles.promptRow}>
                  <Text style={styles.promptBody}>{prompt.body}</Text>
                  <Text
                    style={
                      prompt.status === "failed"
                        ? [styles.promptMeta, styles.promptMetaError]
                        : styles.promptMeta
                    }
                  >
                    {prompt.status === "sending"
                      ? t("aiShare.statusSending", { defaultValue: "sending…" })
                      : prompt.status === "sent"
                        ? t("aiShare.statusSent", { defaultValue: "sent" })
                        : t("aiShare.statusFailed", {
                            error: prompt.error ?? "",
                            defaultValue: "failed: {{error}}",
                          })}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>

          {composerError ? <Text style={styles.composerError}>{composerError}</Text> : null}
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t("aiShare.composerPlaceholder", {
                defaultValue: "Send a prompt to the shared agent…",
              })}
              placeholderTextColor={theme.colors.foregroundMuted}
              multiline
              style={styles.composerInput}
              editable={!submitting}
              testID="ai-share-composer-input"
            />
            <Button
              variant="default"
              onPress={handleSendPress}
              disabled={submitting || draft.trim().length === 0}
              testID="ai-share-composer-send"
            >
              {sendIcon}
            </Button>
          </View>
        </>
      )}
    </View>
  );
}
