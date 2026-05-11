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
import { ArrowUp } from "lucide-react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useHermesModels } from "@/hooks/use-hermes-chat";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import {
  useHermesChatStore,
  selectHermesConversation,
  type HermesTurn,
} from "@/stores/hermes-chat-store";
import { HermesSetupCard } from "@/components/hermes-setup-card";

export interface HermesChatPanelProps {
  serverId: string | null;
}

function ModelChip({
  chip,
  active,
  onSelect,
}: {
  chip: { id: string | null; label: string };
  active: boolean;
  onSelect: (id: string | null) => void;
}) {
  const chipStyle = useMemo(
    () => [styles.modelChip, active ? styles.modelChipActive : null],
    [active],
  );
  const textStyle = useMemo(
    () => [styles.modelChipText, active ? styles.modelChipTextActive : null],
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

function ChatBubble({ turn }: { turn: HermesTurn }) {
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

export function HermesChatPanel({ serverId }: HermesChatPanelProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const { models } = useHermesModels(serverId, true);
  const client = useHostRuntimeClient(serverId ?? "");

  const conversation = useHermesChatStore((s) => selectHermesConversation(s, serverId ?? ""));
  const appendTurn = useHermesChatStore((s) => s.appendTurn);
  const setPending = useHermesChatStore((s) => s.setPending);
  const setSelectedModel = useHermesChatStore((s) => s.setSelectedModel);
  const turns = conversation.turns;
  const isPending = conversation.pending !== null;
  const modelId = conversation.selectedModelId;

  const queryClient = useQueryClient();

  const { data: setupState } = useQuery({
    queryKey: ["hermes-setup", serverId],
    // client is guaranteed non-null by `enabled`
    queryFn: () => client!.checkHermesSetup(),
    enabled: !!serverId && !!client,
    staleTime: 30_000,
  });

  const handleConfigured = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["hermes-setup", serverId] });
  }, [queryClient, serverId]);

  const handleConfigure = useCallback(
    (args: { provider: string; model: string; apiKey: string; baseUrl?: string }) => {
      if (!client) throw new Error("Not connected");
      return client.configureHermes(args);
    },
    [client],
  );

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<ScrollView | null>(null);

  const handleSearchShortcut = useCallback(() => false, []);
  useKeyboardActionHandler({
    handlerId: `hermes-chat-search:${serverId ?? "none"}`,
    actions: ["chat.search.toggle"] as const,
    enabled: false,
    priority: 90,
    handle: handleSearchShortcut,
  });

  const setModelId = useCallback(
    (id: string | null) => {
      if (!serverId) return;
      setSelectedModel(serverId, id);
    },
    [serverId, setSelectedModel],
  );

  const onSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || !serverId || !client || isPending) return;
    const requestId = `hm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userTurn: HermesTurn = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
      ts: Date.now(),
    };
    appendTurn(serverId, userTurn);
    setPending(serverId, { id: requestId, modelId, startedAt: Date.now() });
    setDraft("");

    client
      .sendHermesMessage({ text, modelId, requestId })
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
        console.error("[hermes-chat-panel] send failed", err);
        appendTurn(serverId, {
          id: `e-${Date.now()}`,
          role: "error",
          text: err instanceof Error ? err.message : String(err),
          ts: Date.now(),
        });
      })
      .finally(() => {
        setPending(serverId, null);
      });

    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [draft, serverId, client, isPending, appendTurn, setPending, modelId]);

  const handleKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const nativeEvent = e.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean };
      if (nativeEvent.key === "Enter" && !nativeEvent.shiftKey) {
        void onSend();
      }
    },
    [onSend],
  );

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [turns.length]);

  const modelChips = useMemo(() => {
    const items: Array<{ id: string | null; label: string }> = [
      { id: null, label: t("hermes.defaultModel") },
    ];
    for (const m of models) items.push({ id: m.id, label: m.label });
    return items;
  }, [models, t]);

  const isSendDisabled = isPending || draft.trim().length === 0;
  const sendButtonStyle = useMemo(
    () => [styles.sendButton, isSendDisabled ? styles.sendButtonDisabled : null],
    [isSendDisabled],
  );

  if (setupState?.configured === false) {
    return <HermesSetupCard onConfigured={handleConfigured} configure={handleConfigure} />;
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={64}
      style={styles.root}
    >
      {modelChips.length > 1 ? (
        <View style={styles.modelBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.modelBarContent}
          >
            {modelChips.map((chip) => (
              <ModelChip
                key={chip.id ?? "default"}
                chip={chip}
                active={chip.id === modelId}
                onSelect={setModelId}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <ScrollView ref={scrollRef} style={styles.log} contentContainerStyle={styles.logContent}>
        {turns.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{t("hermes.emptyTitle")}</Text>
            <Text style={styles.emptyHint}>{t("hermes.emptyHint")}</Text>
          </View>
        ) : null}
        {turns.map((turn) => (
          <ChatBubble key={turn.id} turn={turn} />
        ))}
        {isPending ? <PendingBubble text={t("hermes.thinking")} /> : null}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t("hermes.placeholder")}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
          multiline
          editable={!isPending}
          onSubmitEditing={isWeb ? undefined : onSend}
          submitBehavior={isWeb ? undefined : "blurAndSubmit"}
          onKeyPress={isWeb ? handleKeyPress : undefined}
          testID="hermes-composer-input"
        />
        <Pressable
          onPress={onSend}
          disabled={isSendDisabled}
          style={sendButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("hermes.send")}
          testID="hermes-composer-send"
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
  modelBar: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderGlass,
  },
  modelBarContent: {
    flexDirection: "row",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  modelChip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    borderCurve: "continuous",
    backgroundColor: theme.colors.surface2,
  },
  modelChipActive: {
    backgroundColor: theme.colors.accent,
  },
  modelChipText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  modelChipTextActive: {
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
    backgroundColor: theme.colors.surface3,
  },
}));
