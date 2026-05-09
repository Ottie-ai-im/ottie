import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Send, X } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { useActiveAiShares } from "@/hooks/use-active-ai-shares";
import { useAiShareTimeline } from "@/hooks/use-ai-share-timeline";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { AiShareTimelineRecordOnWire } from "@server/server/identity/identity-rpc-schemas";

/**
 * Phase 4 v2/c + v2/d — friend-side shared-agent surface. The friend
 * reaches this route from the active-share banner on the friend chat
 * screen. What ships here:
 *
 *   - Header that names the agent + peer + an End button
 *   - Interleaved transcript merging two streams:
 *       · Local "you sent" rows (until the daemon's redactor echoes
 *         the user_message back, at which point the local row is
 *         superseded — we dedupe by promptId)
 *       · Inbound redacted timeline records from the owner (v2/d):
 *         assistant_message, reasoning, error, turn_started/completed
 *   - Compose box that fires `chatP2pAiShareSendPrompt` and resets.
 *   - "Share ended" empty state when `useActiveAiShares` no longer
 *     contains this inviteId (peer ended it, owner's daemon restarted).
 *
 * Bob does NOT see Alice's tool calls. The redactor on the owner's
 * daemon enforces this before any envelope is signed + shipped.
 */

interface LocalPromptEntry {
  /** Local id (separate from the wire promptId for the optimistic case). */
  localId: string;
  body: string;
  status: "sending" | "sent" | "failed";
  error?: string;
  /** Wire id once the daemon ACKs. Useful for v2/d's reconciliation. */
  promptId?: string;
  /**
   * Number of timeline records visible at the moment this prompt was
   * sent — equals the array index where the agent's first response
   * event will land. Lets the merge place this local bubble right
   * before that index so "user said X / agent says Y" appears in the
   * order events actually happened, even though §7 redactor strips
   * the `user_message` echo from the friend's view.
   */
  sentAtTimelineSize: number;
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
  assistantRow: {
    alignSelf: "flex-start",
    maxWidth: "85%",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    gap: 2,
  },
  assistantBody: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  reasoningRow: {
    alignSelf: "flex-start",
    maxWidth: "85%",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  reasoningBody: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    fontStyle: "italic",
  },
  statusPill: {
    alignSelf: "center",
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
  },
  statusPillText: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  inboundError: {
    alignSelf: "center",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  inboundErrorText: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
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

  // Phase 4 v2/d — inbound redacted timeline records from the owner.
  const { records: timelineRecords } = useAiShareTimeline(serverId, inviteId);

  // Merge local "you sent" prompts with inbound timeline records, then
  // dedupe `user_message` echoes from the owner against the local
  // bubbles by promptId. Result is rendered top→bottom.
  const merged = useMemo(
    () => mergeFriendShareTranscript(localPrompts, timelineRecords),
    [localPrompts, timelineRecords],
  );

  const itemCount = merged.length;
  useEffect(() => {
    if (itemCount === 0) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [itemCount]);

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
    const sentAtTimelineSize = timelineRecords.length;
    setLocalPrompts((prev) => [...prev, { localId, body, status: "sending", sentAtTimelineSize }]);
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
  }, [client, draft, inviteId, t, timelineRecords.length]);

  const handleSendPress = useCallback(() => {
    void handleSendPrompt();
  }, [handleSendPrompt]);

  // Web: Enter sends, Shift+Enter inserts a newline. `isComposing`
  // skips IME composition so typing pinyin / Chinese characters
  // doesn't trigger send when the candidate menu's Enter confirms.
  const handleComposerKeyPress = useCallback(
    (
      event: NativeSyntheticEvent<
        TextInputKeyPressEventData & {
          shiftKey?: boolean;
          isComposing?: boolean;
        }
      >,
    ) => {
      if (event.nativeEvent.key !== "Enter") return;
      if (event.nativeEvent.shiftKey) return;
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (submitting || draft.trim().length === 0) return;
      void handleSendPrompt();
    },
    [draft, handleSendPrompt, submitting],
  );

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
  let subtitle = "";
  if (session) {
    if (session.peerOnline === false) {
      subtitle = t("aiShare.headerSubtitleOffline", {
        peer: peerRootPubKey.slice(0, 8),
        defaultValue: "with {{peer}} · peer offline",
      });
    } else {
      subtitle = t("aiShare.headerSubtitle", {
        peer: peerRootPubKey.slice(0, 8),
        defaultValue: "with {{peer}}",
      });
    }
  }

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
            {merged.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateTitle}>
                  {t("aiShare.emptyTitle", { defaultValue: "Nothing sent yet" })}
                </Text>
                <Text style={styles.emptyStateBody}>
                  {t("aiShare.emptyBody", {
                    defaultValue:
                      "Type a prompt below and your friend's agent will run it. Replies show up here as soon as the agent emits them.",
                  })}
                </Text>
              </View>
            ) : (
              merged.map((row) => <FriendShareRow key={row.key} row={row} />)
            )}
          </ScrollView>

          {composerError ? <Text style={styles.composerError}>{composerError}</Text> : null}
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onKeyPress={handleComposerKeyPress}
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
              leftIcon={sendIcon}
              accessibilityLabel={t("aiShare.sendPrompt", { defaultValue: "Send" })}
              testID="ai-share-composer-send"
            />
          </View>
        </>
      )}
    </View>
  );
}

// ----- transcript merge ---------------------------------------------------

type MergedRow =
  | { key: string; kind: "local-prompt"; entry: LocalPromptEntry }
  | { key: string; kind: "user-message"; text: string }
  | { key: string; kind: "assistant"; text: string }
  | { key: string; kind: "reasoning"; text: string }
  | { key: string; kind: "status"; text: "turn_started" | "turn_completed" }
  | { key: string; kind: "error"; message: string };

/**
 * Merge rule: timeline records arrive in monotonic `eventId` order.
 * Each local prompt was sent at a moment when the timeline had some
 * highest `eventId = N`; the agent's response to that prompt arrives
 * later with `eventId > N`. So the local bubble belongs immediately
 * before the first timeline record whose eventId exceeds the prompt's
 * `sentAfterEventId`.
 *
 * Why not dedupe via inbound `user_message` echo: §7 redactor strips
 * `user_message` from the friend's stream (the friend already typed
 * it, no need to round-trip). So we never get an echo to dedupe
 * against — the local bubble is the only record of what the friend
 * said, and we just need to place it in the right slot.
 */
function mergeFriendShareTranscript(
  localPrompts: ReadonlyArray<LocalPromptEntry>,
  timeline: ReadonlyArray<AiShareTimelineRecordOnWire>,
): MergedRow[] {
  // Timeline is already monotonic per owner-side seq when the daemon
  // returns it; preserve that order. Sort prompts by their captured
  // "size of timeline at send time" so multi-prompt sessions interleave
  // correctly: prompt for turn N goes right before the events of turn N.
  const sortedPrompts = [...localPrompts].sort(
    (a, b) => a.sentAtTimelineSize - b.sentAtTimelineSize,
  );
  const out: MergedRow[] = [];
  let promptIdx = 0;

  function pushTimelineEntry(r: AiShareTimelineRecordOnWire): void {
    const e = r.entry;
    switch (e.kind) {
      case "user_message":
        out.push({ key: `tm-${r.eventId}`, kind: "user-message", text: e.text });
        break;
      case "assistant_message":
        out.push({ key: `tm-${r.eventId}`, kind: "assistant", text: e.text });
        break;
      case "reasoning":
        out.push({ key: `tm-${r.eventId}`, kind: "reasoning", text: e.text });
        break;
      case "error":
        out.push({ key: `tm-${r.eventId}`, kind: "error", message: e.message });
        break;
      case "turn_started":
        out.push({ key: `tm-${r.eventId}`, kind: "status", text: "turn_started" });
        break;
      case "turn_completed":
        out.push({ key: `tm-${r.eventId}`, kind: "status", text: "turn_completed" });
        break;
    }
  }

  function pushLocalPrompt(local: LocalPromptEntry): void {
    out.push({ key: `lp-${local.localId}`, kind: "local-prompt", entry: local });
  }

  for (let i = 0; i < timeline.length; i += 1) {
    while (promptIdx < sortedPrompts.length && sortedPrompts[promptIdx]!.sentAtTimelineSize <= i) {
      pushLocalPrompt(sortedPrompts[promptIdx]!);
      promptIdx += 1;
    }
    pushTimelineEntry(timeline[i]!);
  }
  while (promptIdx < sortedPrompts.length) {
    pushLocalPrompt(sortedPrompts[promptIdx]!);
    promptIdx += 1;
  }

  return out;
}

function promptStatusText(
  prompt: LocalPromptEntry,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (prompt.status === "sending") return t("aiShare.statusSending", { defaultValue: "sending…" });
  if (prompt.status === "sent") return t("aiShare.statusSent", { defaultValue: "sent" });
  return t("aiShare.statusFailed", {
    error: prompt.error ?? "",
    defaultValue: "failed: {{error}}",
  });
}

function FriendShareRow({ row }: { row: MergedRow }) {
  const { t } = useTranslation();
  switch (row.kind) {
    case "local-prompt": {
      const prompt = row.entry;
      return (
        <View style={styles.promptRow}>
          <Text style={styles.promptBody}>{prompt.body}</Text>
          <Text
            style={
              prompt.status === "failed"
                ? [styles.promptMeta, styles.promptMetaError]
                : styles.promptMeta
            }
          >
            {promptStatusText(prompt, t)}
          </Text>
        </View>
      );
    }
    case "user-message":
      return (
        <View style={styles.promptRow}>
          <Text style={styles.promptBody}>{row.text}</Text>
          <Text style={styles.promptMeta}>
            {t("aiShare.statusDelivered", { defaultValue: "delivered" })}
          </Text>
        </View>
      );
    case "assistant":
      return (
        <View style={styles.assistantRow}>
          <Text style={styles.assistantBody}>{row.text}</Text>
        </View>
      );
    case "reasoning":
      return (
        <View style={styles.reasoningRow}>
          <Text style={styles.reasoningBody}>{row.text}</Text>
        </View>
      );
    case "status":
      return (
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>
            {row.text === "turn_started"
              ? t("aiShare.turnStarted", { defaultValue: "agent thinking…" })
              : t("aiShare.turnCompleted", { defaultValue: "agent done" })}
          </Text>
        </View>
      );
    case "error":
      return (
        <View style={styles.inboundError}>
          <Text style={styles.inboundErrorText}>
            {t("aiShare.agentError", {
              message: row.message,
              defaultValue: "agent error: {{message}}",
            })}
          </Text>
        </View>
      );
  }
}
