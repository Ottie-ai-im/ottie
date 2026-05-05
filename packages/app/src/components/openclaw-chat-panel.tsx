import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react-native";

import { useOpenclawAgents } from "@/hooks/use-openclaw-chat";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import {
  useOpenclawChatStore,
  selectConversation,
  type OpenclawTurn,
} from "@/stores/openclaw-chat-store";

export interface OpenclawChatPanelProps {
  serverId: string | null;
}

/**
 * Native Ottie chat panel for OpenClaw. Differs from the trivial
 * request-response version in two ways:
 *
 *  1. Conversation state lives in `useOpenclawChatStore` (Zustand +
 *     AsyncStorage). Switching tabs unmounts this component but the
 *     turns survive — when the user navigates back the log is still
 *     there.
 *
 *  2. The send mutation is dispatched against the *daemon client*
 *     directly (not a TanStack mutation tied to the component
 *     lifecycle), and onResolve writes to the store. So even if the
 *     user navigates away while OpenClaw is thinking, the eventual
 *     reply still lands in the store and shows up next time the
 *     panel mounts. Server-side push notifications (added in the
 *     same commit) cover the "wake the user up" case.
 */
export function OpenclawChatPanel({ serverId }: OpenclawChatPanelProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const { agents } = useOpenclawAgents(serverId, true);
  const client = useHostRuntimeClient(serverId ?? "");

  const conversation = useOpenclawChatStore((s) => selectConversation(s, serverId ?? ""));
  const appendTurn = useOpenclawChatStore((s) => s.appendTurn);
  const setPending = useOpenclawChatStore((s) => s.setPending);
  const setSelectedAgent = useOpenclawChatStore((s) => s.setSelectedAgent);
  const turns = conversation.turns;
  const isPending = conversation.pending !== null;
  const agentId = conversation.selectedAgentId;

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<ScrollView | null>(null);

  const setAgentId = useCallback(
    (id: string | null) => {
      if (!serverId) return;
      setSelectedAgent(serverId, id);
    },
    [serverId, setSelectedAgent],
  );

  const onSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || !serverId || !client || isPending) return;
    const requestId = `oc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userTurn: OpenclawTurn = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
      ts: Date.now(),
    };
    appendTurn(serverId, userTurn);
    setPending(serverId, { id: requestId, agentId, startedAt: Date.now() });
    setDraft("");

    // Fire-and-forget: dispatch the send against the long-lived
    // daemon client. The promise can resolve after this component
    // unmounts; appendTurn writes to the global store, which is
    // observed by whichever component (this one or a remount) is
    // showing the conversation.
    client
      .sendOpenclawMessage({ text, agentId, requestId })
      .then((result) => {
        appendTurn(serverId, {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: result.reply || "(empty reply)",
          ts: Date.now(),
        });
      })
      .catch((err: unknown) => {
        const raw = err instanceof Error ? err.message : String(err);
        const friendly =
          raw.toLowerCase().includes("unknown request schema") ||
          raw.toLowerCase().includes("unknown_schema")
            ? `${raw}\n\nTip: your Ottie daemon is older than this client and doesn't know about openclaw/chat/send. Restart the daemon (or run "pnpm build:daemon" if you're in a dev checkout) to pick up the new RPC.`
            : raw;
        console.error("[openclaw-chat-panel] send failed", err);
        appendTurn(serverId, {
          id: `e-${Date.now()}`,
          role: "error",
          text: friendly,
          ts: Date.now(),
        });
      })
      .finally(() => {
        setPending(serverId, null);
      });

    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [draft, serverId, client, isPending, appendTurn, setPending, agentId]);

  // Auto-scroll when new turns arrive (covers the case where reply
  // lands while the panel is mounted).
  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [turns.length]);

  const agentChips = useMemo(() => {
    const items: Array<{ id: string | null; label: string }> = [
      { id: null, label: t("openclaw.defaultAgent") },
    ];
    for (const a of agents) items.push({ id: a.id, label: a.label });
    return items;
  }, [agents, t]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={64}
      style={styles.root}
    >
      {agentChips.length > 1 ? (
        <View style={styles.agentBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.agentBarContent}
          >
            {agentChips.map((chip) => {
              const active = chip.id === agentId;
              return (
                <Pressable
                  key={chip.id ?? "default"}
                  onPress={() => setAgentId(chip.id)}
                  style={[styles.agentChip, active ? styles.agentChipActive : null]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.agentChipText, active ? styles.agentChipTextActive : null]}>
                    {chip.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <ScrollView ref={scrollRef} style={styles.log} contentContainerStyle={styles.logContent}>
        {turns.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{t("openclaw.emptyTitle")}</Text>
            <Text style={styles.emptyHint}>{t("openclaw.emptyHint")}</Text>
          </View>
        ) : null}
        {turns.map((turn) => (
          <View
            key={turn.id}
            style={[
              styles.bubble,
              turn.role === "user"
                ? styles.bubbleUser
                : turn.role === "error"
                  ? styles.bubbleError
                  : styles.bubbleAssistant,
            ]}
          >
            <Text
              style={[
                styles.bubbleText,
                turn.role === "user" ? styles.bubbleTextUser : null,
                turn.role === "error" ? styles.bubbleTextError : null,
              ]}
              selectable
            >
              {turn.text}
            </Text>
          </View>
        ))}
        {isPending ? (
          <View style={[styles.bubble, styles.bubbleAssistant]}>
            <Text style={[styles.bubbleText, styles.bubbleTextMuted]}>
              {t("openclaw.thinking")}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t("openclaw.placeholder")}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
          multiline
          editable={!isPending}
          onSubmitEditing={onSend}
          submitBehavior="blurAndSubmit"
          testID="openclaw-composer-input"
        />
        <Pressable
          onPress={onSend}
          disabled={isPending || draft.trim().length === 0}
          style={[
            styles.sendButton,
            isPending || draft.trim().length === 0 ? styles.sendButtonDisabled : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t("openclaw.send")}
          testID="openclaw-composer-send"
        >
          <Send size={18} color={theme.colors.accentForeground} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
  },
  agentBar: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderGlass,
  },
  agentBarContent: {
    flexDirection: "row",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  agentChip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    borderCurve: "continuous",
    backgroundColor: theme.colors.surface2,
  },
  agentChipActive: {
    backgroundColor: theme.colors.accent,
  },
  agentChipText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  agentChipTextActive: {
    color: theme.colors.accentForeground,
    fontWeight: theme.fontWeight.medium,
  },
  log: {
    flex: 1,
    minHeight: 0,
  },
  logContent: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[8],
    gap: theme.spacing[1],
  },
  emptyTitle: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  emptyHint: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  bubble: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.glassCard,
    borderCurve: "continuous",
    maxWidth: "85%",
  },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: theme.colors.accent,
  },
  bubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  bubbleError: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.surfaceGlass,
    borderWidth: 1,
    borderColor: theme.colors.destructive,
  },
  bubbleText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: 20,
  },
  bubbleTextUser: {
    color: theme.colors.accentForeground,
  },
  bubbleTextMuted: {
    color: theme.colors.foregroundMuted,
    fontStyle: "italic",
  },
  bubbleTextError: {
    color: theme.colors.destructive,
  },
  bottomError: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.destructive,
    textAlign: "center",
    marginTop: theme.spacing[2],
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderGlass,
    backgroundColor: theme.colors.surface0,
  },
  input: {
    flex: 1,
    maxHeight: 140,
    minHeight: 36,
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.glassCard,
    borderCurve: "continuous",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  sendButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
    borderRadius: theme.borderRadius.full,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
}));
