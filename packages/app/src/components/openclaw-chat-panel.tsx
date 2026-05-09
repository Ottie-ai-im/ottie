import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  type TextInputKeyPressEventData,
  View,
} from "react-native";
import { isWeb } from "@/constants/platform";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ArrowUp, Search, X } from "lucide-react-native";

import { useOpenclawAgents } from "@/hooks/use-openclaw-chat";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import {
  useOpenclawChatStore,
  selectConversation,
  type OpenclawTurn,
} from "@/stores/openclaw-chat-store";

export interface OpenclawChatPanelProps {
  serverId: string | null;
}

function AgentChip({
  chip,
  active,
  onSelect,
}: {
  chip: { id: string | null; label: string };
  active: boolean;
  onSelect: (id: string | null) => void;
}) {
  const chipStyle = useMemo(
    () => [styles.agentChip, active ? styles.agentChipActive : null],
    [active],
  );
  const textStyle = useMemo(
    () => [styles.agentChipText, active ? styles.agentChipTextActive : null],
    [active],
  );
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  const handlePress = useCallback(() => onSelect(chip.id), [onSelect, chip.id]);

  return (
    <Pressable
      onPress={handlePress}
      style={chipStyle}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
    >
      <Text style={textStyle}>{chip.label}</Text>
    </Pressable>
  );
}

function PendingBubble({ text }: { text: string }) {
  const pendingBubbleStyle = useMemo(() => [styles.bubble, styles.bubbleAssistant], []);
  const pendingTextStyle = useMemo(() => [styles.bubbleText, styles.bubbleTextMuted], []);
  return (
    <View style={pendingBubbleStyle}>
      <Text style={pendingTextStyle}>{text}</Text>
    </View>
  );
}

function ChatBubble({ turn }: { turn: OpenclawTurn }) {
  let roleStyle;
  if (turn.role === "user") {
    roleStyle = styles.bubbleUser;
  } else if (turn.role === "error") {
    roleStyle = styles.bubbleError;
  } else {
    roleStyle = styles.bubbleAssistant;
  }

  const bubbleStyle = useMemo(() => [styles.bubble, roleStyle], [roleStyle]);
  const textStyle = useMemo(
    () => [
      styles.bubbleText,
      turn.role === "user" ? styles.bubbleTextUser : null,
      turn.role === "error" ? styles.bubbleTextError : null,
    ],
    [turn.role],
  );

  return (
    <View style={bubbleStyle}>
      <Text style={textStyle} selectable>
        {turn.text}
      </Text>
    </View>
  );
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const scrollRef = useRef<ScrollView | null>(null);
  const searchInputRef = useRef<TextInput | null>(null);

  // Cmd+F / Ctrl+F toggles the search bar. Registering only while this panel
  // is mounted means the shortcut falls through to the browser/OS elsewhere.
  const handleSearchShortcut = useCallback(() => {
    setSearchOpen((prev) => !prev);
    return true;
  }, []);
  useKeyboardActionHandler({
    handlerId: `openclaw-chat-search:${serverId ?? "none"}`,
    actions: ["chat.search.toggle"] as const,
    enabled: true,
    priority: 100,
    handle: handleSearchShortcut,
  });

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
  }, []);

  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setSearchQuery("");
    }
  }, [searchOpen]);

  const trimmedQuery = searchQuery.trim();
  const filteredTurns = useMemo(() => {
    if (!searchOpen || !trimmedQuery) return turns;
    const needle = trimmedQuery.toLowerCase();
    return turns.filter((turn) => turn.text.toLowerCase().includes(needle));
  }, [turns, searchOpen, trimmedQuery]);
  const isSearchActive = searchOpen && trimmedQuery.length > 0;
  const showNoMatches = isSearchActive && filteredTurns.length === 0;

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
        return undefined;
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

  const handleKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const nativeEvent = e.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean };
      if (nativeEvent.key === "Enter" && !nativeEvent.shiftKey) {
        void onSend();
      }
    },
    [onSend],
  );

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

  const isSendDisabled = isPending || draft.trim().length === 0;
  const sendButtonStyle = useMemo(
    () => [styles.sendButton, isSendDisabled ? styles.sendButtonDisabled : null],
    [isSendDisabled],
  );

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
            {agentChips.map((chip) => (
              <AgentChip
                key={chip.id ?? "default"}
                chip={chip}
                active={chip.id === agentId}
                onSelect={setAgentId}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {searchOpen ? (
        <View style={styles.searchBar}>
          <Search size={16} color={theme.colors.foregroundMuted} />
          <TextInput
            ref={searchInputRef}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t("openclaw.searchPlaceholder")}
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            testID="openclaw-search-input"
          />
          {isSearchActive ? (
            <Text style={styles.searchCount}>
              {t("openclaw.searchMatchCount", { count: filteredTurns.length })}
            </Text>
          ) : null}
          <Pressable
            onPress={closeSearch}
            accessibilityRole="button"
            accessibilityLabel={t("openclaw.searchClose")}
            style={styles.searchClose}
            testID="openclaw-search-close"
          >
            <X size={16} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>
      ) : null}

      <ScrollView ref={scrollRef} style={styles.log} contentContainerStyle={styles.logContent}>
        {turns.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{t("openclaw.emptyTitle")}</Text>
            <Text style={styles.emptyHint}>{t("openclaw.emptyHint")}</Text>
          </View>
        ) : null}
        {showNoMatches ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyHint}>{t("openclaw.searchEmpty")}</Text>
          </View>
        ) : null}
        {filteredTurns.map((turn) => (
          <ChatBubble key={turn.id} turn={turn} />
        ))}
        {isPending && !searchOpen ? <PendingBubble text={t("openclaw.thinking")} /> : null}
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
          onSubmitEditing={isWeb ? undefined : onSend}
          submitBehavior={isWeb ? undefined : "blurAndSubmit"}
          onKeyPress={isWeb ? handleKeyPress : undefined}
          testID="openclaw-composer-input"
        />
        <Pressable
          onPress={onSend}
          disabled={isSendDisabled}
          style={sendButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("openclaw.send")}
          testID="openclaw-composer-send"
        >
          <ArrowUp size={18} color={theme.colors.accentForeground} />
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderGlass,
    backgroundColor: theme.colors.surface0,
  },
  searchInput: {
    flex: 1,
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    paddingVertical: 0,
  },
  searchCount: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  searchClose: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
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
    backgroundColor: "#0ea5e9",
    borderRadius: theme.borderRadius.full,
  },
  sendButtonDisabled: {
    backgroundColor: theme.colors.surface3,
  },
}));
