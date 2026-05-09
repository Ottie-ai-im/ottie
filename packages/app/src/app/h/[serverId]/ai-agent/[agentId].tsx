import { useCallback, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Bot, Pencil, SendHorizontal, Trash2 } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { useAiAgentsStore, type AiAgentRuntime } from "@/stores/ai-agents-store";
import { useAiAgentsUiStore } from "@/stores/ai-agents-ui-store";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

// Detail page for a user-created conversation Agent. Surfaces a working
// (single-thread, single-conversation) chat with the configured runtime
// + model + system prompt by reusing the daemon's existing agent
// infrastructure: createAgent → waitForFinish for the first turn,
// sendMessage → waitForFinish for follow-ups. The conversation lives in
// component state for now (per-mount) — once the user navigates away
// and back, a new daemon agent is spawned and history resets. Persisting
// the daemon agentId across reloads is a follow-up.

const RUNTIME_LABEL_KEY: Record<AiAgentRuntime, string> = {
  claude: "newAiAgent.runtime.claude",
  codex: "newAiAgent.runtime.codex",
  copilot: "newAiAgent.runtime.copilot",
  opencode: "newAiAgent.runtime.opencode",
  gemini: "newAiAgent.runtime.gemini",
  pi: "newAiAgent.runtime.pi",
};

// Scratch dir where chat-only conversation agents run. /tmp is guaranteed
// to exist on macOS/Linux. Windows is not on the desktop critical path
// for this milestone — switch to OS temp dir if/when a Windows user trips.
const SCRATCH_CWD = "/tmp";

const TURN_TIMEOUT_MS = 90_000;

interface ChatTurn {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
}

function resolveParam(raw: string | string[] | undefined): string | null {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0] ?? null;
  return null;
}

function makeTurnId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function AiAgentDetailRoute() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    agentId?: string | string[];
  }>();
  const serverId = resolveParam(params.serverId);
  const agentId = resolveParam(params.agentId);
  const agent = useAiAgentsStore((s) =>
    agentId ? (s.agents.find((a) => a.id === agentId) ?? null) : null,
  );
  const remove = useAiAgentsStore((s) => s.remove);
  const openEdit = useAiAgentsUiStore((s) => s.openEditModal);
  const client = useHostRuntimeClient(serverId ?? "");

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const daemonAgentIdRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const handleEdit = useCallback(() => {
    if (agentId) openEdit(agentId);
  }, [agentId, openEdit]);

  const handleDelete = useCallback(() => {
    if (agentId) remove(agentId);
  }, [agentId, remove]);

  const trimmedDraft = draft.trim();
  const canSend = Boolean(agent && client && trimmedDraft.length > 0 && !sending);

  // Single-turn flow:
  //   - First turn: createAgent({ initialPrompt }) so the daemon spawns the
  //     runtime and processes the prompt in one go. The agent sticks around
  //     so subsequent turns reuse it.
  //   - Subsequent turns: sendMessage(agentId, text) — waitForFinish then
  //     reads the latest assistant response from `lastMessage`.
  const handleSend = useCallback(async () => {
    if (!canSend || !agent || !client) return;
    const text = trimmedDraft;
    const userTurnId = makeTurnId();
    setTurns((prev) => [...prev, { id: userTurnId, role: "user", text }]);
    setDraft("");
    setSending(true);

    try {
      let activeAgentId = daemonAgentIdRef.current;

      if (!activeAgentId) {
        const created = await client.createAgent({
          provider: agent.runtime,
          cwd: SCRATCH_CWD,
          title: agent.name || "AI Agent",
          model: agent.model || undefined,
          systemPrompt: agent.systemPrompt || undefined,
          initialPrompt: text,
        });
        activeAgentId = created.id;
        daemonAgentIdRef.current = activeAgentId;
      } else {
        await client.sendMessage(activeAgentId, text);
      }

      const result = await client.waitForFinish(activeAgentId, TURN_TIMEOUT_MS);
      if (result.status === "timeout") {
        setTurns((prev) => [
          ...prev,
          { id: makeTurnId(), role: "error", text: t("aiAgentChat.timeout") },
        ]);
        return;
      }
      if (result.status === "error") {
        setTurns((prev) => [
          ...prev,
          {
            id: makeTurnId(),
            role: "error",
            text: result.error ?? t("aiAgentChat.unknownError"),
          },
        ]);
        return;
      }
      const reply = (result.lastMessage ?? "").trim();
      setTurns((prev) => [
        ...prev,
        {
          id: makeTurnId(),
          role: "assistant",
          text: reply || t("aiAgentChat.emptyResponse"),
        },
      ]);
    } catch (err) {
      setTurns((prev) => [
        ...prev,
        {
          id: makeTurnId(),
          role: "error",
          text: err instanceof Error ? err.message : String(err),
        },
      ]);
    } finally {
      setSending(false);
      // Defer scroll to next frame so the new bubble has laid out.
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [agent, canSend, client, t, trimmedDraft]);

  const sendButtonStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.sendButton,
      !canSend ? styles.sendButtonDisabled : null,
      pressed && canSend ? styles.sendButtonPressed : null,
    ],
    [canSend],
  );

  const sendIconColor = canSend ? theme.colors.surface0 : theme.colors.foregroundMuted;

  const profileSummary = useMemo(() => {
    if (!agent) return null;
    return [t(RUNTIME_LABEL_KEY[agent.runtime]), agent.model].filter(Boolean).join(" · ");
  }, [agent, t]);

  if (!agent) {
    return (
      <View style={styles.root}>
        <View style={styles.emptyBlock}>
          <Text style={styles.title}>{t("aiAgentDetail.notFound")}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.iconBlock}>
            <Bot size={20} color={theme.colors.foreground} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {agent.name}
            </Text>
            {profileSummary ? (
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {profileSummary}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.headerActions}>
          <Button variant="ghost" size="sm" leftIcon={Pencil} onPress={handleEdit}>
            {t("aiAgentDetail.edit")}
          </Button>
          <Button variant="ghost" size="sm" leftIcon={Trash2} onPress={handleDelete}>
            {t("aiAgentDetail.delete")}
          </Button>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {agent.description ? (
          <View style={styles.descBlock}>
            <Text style={styles.descText}>{agent.description}</Text>
          </View>
        ) : null}

        {turns.length === 0 && !sending ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>{t("aiAgentChat.placeholder")}</Text>
          </View>
        ) : null}

        {turns.map((turn) => (
          <ChatBubble key={turn.id} turn={turn} />
        ))}

        {sending ? (
          <View style={styles.assistantBubble}>
            <Text style={styles.assistantText}>{t("aiAgentChat.thinking")}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={t("aiAgentChat.inputPlaceholder")}
          placeholderTextColor={theme.colors.foregroundMuted}
          editable={!sending}
          multiline
          onSubmitEditing={handleSend}
          blurOnSubmit
          testID="ai-agent-chat-input"
        />
        <Pressable
          onPress={handleSend}
          disabled={!canSend}
          style={sendButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("aiAgentChat.send")}
          testID="ai-agent-chat-send"
        >
          <SendHorizontal size={18} color={sendIconColor} />
        </Pressable>
      </View>
    </View>
  );
}

function ChatBubble({ turn }: { turn: ChatTurn }) {
  if (turn.role === "user") {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{turn.text}</Text>
        </View>
      </View>
    );
  }
  if (turn.role === "error") {
    return (
      <View style={styles.errorBubble}>
        <Text style={styles.errorText}>{turn.text}</Text>
      </View>
    );
  }
  return (
    <View style={styles.assistantBubble}>
      <Text style={styles.assistantText}>{turn.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    flexShrink: 1,
    minWidth: 0,
  },
  iconBlock: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.md,
    borderCurve: "continuous",
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flexShrink: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  headerSubtitle: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  headerActions: {
    flexDirection: "row",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[3],
    maxWidth: 760,
    width: "100%",
    alignSelf: "center",
  },
  descBlock: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.card,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  descText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    lineHeight: 20,
  },
  placeholder: {
    alignItems: "center",
    paddingVertical: theme.spacing[8],
  },
  placeholderText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  userRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  userBubble: {
    backgroundColor: theme.colors.foreground,
    borderRadius: theme.borderRadius.bubble,
    borderCurve: "continuous",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    maxWidth: "80%",
  },
  userText: {
    color: theme.colors.surface0,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  assistantBubble: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.bubble,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    maxWidth: "90%",
    alignSelf: "flex-start",
  },
  assistantText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  errorBubble: {
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.destructive,
    borderWidth: 1,
    borderRadius: theme.borderRadius.card,
    borderCurve: "continuous",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    alignSelf: "flex-start",
    maxWidth: "90%",
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  input: {
    flex: 1,
    fontFamily: theme.fontFamily.system,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.field,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    minHeight: 44,
    maxHeight: 160,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: theme.borderRadius.md,
    borderCurve: "continuous",
    backgroundColor: theme.colors.foreground,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    backgroundColor: theme.colors.surface2,
  },
  sendButtonPressed: {
    opacity: 0.8,
  },
  title: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  emptyBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
}));
