import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { messageKey, WechatContextView } from "@/components/wechat/wechat-context-view";
import { WechatModelPicker } from "@/components/wechat/wechat-model-picker";
import { WechatPrivacyModal } from "@/components/wechat/wechat-privacy-modal";
import { WechatRewritePanel } from "@/components/wechat/wechat-rewrite-panel";
import { WechatSuggestionList } from "@/components/wechat/wechat-suggestion-list";
import { useSidebarWechatSessions } from "@/hooks/use-sidebar-wechat-sessions";
import { useWechatHistory } from "@/hooks/use-wechat-history";
import { useWechatSuggestions } from "@/hooks/use-wechat-suggestions";
import { useAppSettings } from "@/hooks/use-settings";
import {
  selectChatAnnotations,
  useWechatAnnotationsStore,
} from "@/stores/wechat-annotations-store";

function resolveParam(raw: string | string[] | undefined): string | null {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0] ?? null;
  return null;
}

/**
 * Detail page for a single WeChat chat. Layout (top → bottom):
 *
 *   1. Header — back button + chat title
 *   2. Recent message context (last 20)
 *   3. AI candidate replies + per-row Copy
 *
 * Step 6 will append a "rewrite my draft" panel below the suggestions
 * so the surface stays a single scroll.
 *
 * The chat identifier in the URL is whatever the sidebar passed —
 * either a wxid (wxid_…), a group hash (…@chatroom), or a display name
 * fallback. wx-cli's daemon resolves all three forms (src/daemon/query.rs:387).
 */
export default function WechatChatDetail() {
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    chatId?: string | string[];
  }>();
  const serverId = resolveParam(params.serverId);
  const rawChatId = resolveParam(params.chatId);
  const chatId = rawChatId ? safeDecode(rawChatId) : null;

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { theme } = useUnistyles();

  const isGroup = useMemo(() => isGroupChatId(chatId), [chatId]);

  // Resolve the user's WeChat 备注 (display name) for this chat by
  // looking it up in the same sidebar sessions cache the rest of the
  // app already maintains. The URL only carries a wxid (or group hash)
  // because that's what wx-cli accepts; the display name is what the
  // user actually thinks of this contact as ("章总" not
  // "zhangkai297506") and what the LLM should refer to in suggestions.
  // Falls back to the wxid when the contact isn't in the sidebar list
  // (e.g. deep-link to an inactive chat).
  const sidebar = useSidebarWechatSessions(serverId);
  const matchingSession = useMemo(() => {
    if (!chatId) return null;
    return (
      sidebar.sessions.find((s) => (s.username && s.username === chatId) || s.chat === chatId) ??
      null
    );
  }, [chatId, sidebar.sessions]);
  const displayName = matchingSession?.chat ?? chatId ?? "";
  const wxid = matchingSession?.username ?? null;
  // Only show the wxid subtitle when it actually differs from the
  // display name — for contacts whose备注 happens to equal their wxid
  // (rare) we'd otherwise echo the same string twice.
  const showWxidSubtitle = wxid !== null && wxid.length > 0 && wxid !== displayName;
  // Pass the display name into AI prompts so generated replies refer
  // to "章总", not "zhangkai297506".
  const chatLabel = displayName;

  const history = useWechatHistory(serverId, chatId, 20);

  // Privacy gate: AI suggestions / rewrite send chat content to the
  // selected model provider. We block both until the user has explicitly
  // accepted the one-time privacy notice. The acceptance is persisted in
  // AppSettings so subsequent visits skip the prompt.
  const { settings, updateSettings } = useAppSettings();
  const privacyAgreed = settings.wechatPrivacyAgreed;

  // Both private and group chats now require an explicit click on
  // "Generate" / "Reply" before the first LLM call goes out. The
  // earlier "auto-fire on private chat open" flow burned tokens every
  // time the user just glanced at a contact — and it raced with the
  // user's selection, generating once with no focus, then again the
  // moment they tapped a row. Manual-only is the simpler mental model
  // and matches the rewrite panel's behavior.
  const [hasManuallyTriggered, setHasManuallyTriggered] = useState(false);
  const suggestionsEnabled = privacyAgreed && hasManuallyTriggered;

  // Per-message focus selection.
  //
  // Two-stage state on purpose: tapping a row updates `selectedKeys`
  // ONLY (visual highlight + button counter), without re-firing the
  // LLM. The user clicks "回复 N 条" to commit the selection into
  // `committedFocusKeys`, which is what the suggestion hook actually
  // sends to Claude. Without this split, every checkbox tap would burn
  // tokens — which day-1 testing flagged as an immediate problem.
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [committedFocusKeys, setCommittedFocusKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const handleToggleSelect = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const handleClearSelection = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  // Per-chat voice annotations (user-typed transcripts). Lookup is
  // O(1) per row inside the context view and the suggestion prompt
  // substitutes annotated rows so the LLM sees real text instead of
  // "[语音]". Stored in AsyncStorage, survives reloads.
  const annotations = useWechatAnnotationsStore((s) => selectChatAnnotations(s, chatId ?? ""));
  const setAnnotation = useWechatAnnotationsStore((s) => s.setAnnotation);
  const clearAnnotation = useWechatAnnotationsStore((s) => s.clearAnnotation);
  const handleSaveAnnotation = useCallback(
    (key: string, text: string) => {
      if (!chatId) return;
      setAnnotation(chatId, key, text);
    },
    [chatId, setAnnotation],
  );
  const handleClearAnnotation = useCallback(
    (key: string) => {
      if (!chatId) return;
      clearAnnotation(chatId, key);
    },
    [chatId, clearAnnotation],
  );

  const suggestions = useWechatSuggestions({
    serverId,
    chatId,
    chatLabel,
    isGroup,
    messages: history.messages,
    enabled: suggestionsEnabled,
    focusKeys: committedFocusKeys,
    messageKey,
    annotations,
  });

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else if (serverId) {
      // Fallback when the user deep-linked straight here.
      router.replace(`/h/${encodeURIComponent(serverId)}` as never);
    }
  }, [router, serverId]);

  const handleGenerate = useCallback(() => {
    setHasManuallyTriggered(true);
    // Capture the current selection at the moment the user clicks. If
    // they later toggle more rows, the change waits until the next
    // explicit click — no surprise refetches mid-thought.
    setCommittedFocusKeys(new Set(selectedKeys));
    void suggestions.regenerate();
  }, [selectedKeys, suggestions]);

  const handleRegenerate = useCallback(() => {
    setHasManuallyTriggered(true);
    setCommittedFocusKeys(new Set(selectedKeys));
    void suggestions.regenerate();
  }, [selectedKeys, suggestions]);

  const handleAcceptPrivacy = useCallback(() => {
    void updateSettings({ wechatPrivacyAgreed: true });
  }, [updateSettings]);

  const handleCancelPrivacy = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else if (serverId) {
      router.replace(`/h/${encodeURIComponent(serverId)}` as never);
    }
  }, [router, serverId]);

  // Memoize the style array so React Compiler / `react-perf` doesn't see a
  // fresh array literal every render and trigger jsx-no-new-array-as-prop.
  const rootStyle = useMemo(() => [styles.root, { paddingTop: insets.top }], [insets.top]);

  if (!serverId || !chatId) {
    return (
      <View style={rootStyle}>
        <Text style={styles.invalidText}>Invalid route.</Text>
      </View>
    );
  }

  return (
    <View style={rootStyle}>
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t("wechat.detail.back")}
          style={styles.backButton}
        >
          <ChevronLeft size={18} color={theme.colors.foregroundMuted} />
          <Text style={styles.backLabel}>{t("wechat.detail.back")}</Text>
        </Pressable>
        <View style={styles.titleColumn}>
          <Text style={styles.title} numberOfLines={1}>
            {displayName}
          </Text>
          {showWxidSubtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              ({wxid})
            </Text>
          ) : null}
        </View>
      </View>

      <WechatModelPicker serverId={serverId} />

      <HistoryArea
        isLoading={history.isLoading}
        error={history.error}
        messages={history.messages}
        chatLabel={chatLabel}
        isGroup={isGroup}
        selectedKeys={selectedKeys}
        onToggleSelect={handleToggleSelect}
        annotations={annotations}
        onSaveAnnotation={handleSaveAnnotation}
        onClearAnnotation={handleClearAnnotation}
      />

      <WechatSuggestionList
        suggestions={suggestions.suggestions}
        isFetching={suggestions.isFetching}
        error={suggestions.error}
        hasTried={
          suggestionsEnabled && (suggestions.suggestions.length > 0 || suggestions.error !== null)
        }
        isGroup={isGroup}
        selectedCount={selectedKeys.size}
        onClearSelection={handleClearSelection}
        onGenerate={handleGenerate}
        onRegenerate={handleRegenerate}
      />

      <WechatRewritePanel serverId={serverId} />

      <WechatPrivacyModal
        visible={!privacyAgreed}
        onAccept={handleAcceptPrivacy}
        onCancel={handleCancelPrivacy}
      />
    </View>
  );
}

interface HistoryAreaProps {
  isLoading: boolean;
  error: string | null;
  messages: ReturnType<typeof useWechatHistory>["messages"];
  chatLabel: string;
  isGroup: boolean;
  selectedKeys: ReadonlySet<string>;
  onToggleSelect: (key: string) => void;
  annotations: Readonly<Record<string, string>>;
  onSaveAnnotation: (key: string, text: string) => void;
  onClearAnnotation: (key: string) => void;
}

/**
 * Loading / error / loaded triage extracted into a small component so
 * the parent doesn't trip oxlint's `no-nested-ternary`. Keeps the
 * detail-page render top-down readable.
 */
function HistoryArea({
  isLoading,
  error,
  messages,
  chatLabel,
  isGroup,
  selectedKeys,
  onToggleSelect,
  annotations,
  onSaveAnnotation,
  onClearAnnotation,
}: HistoryAreaProps) {
  const { t } = useTranslation();
  if (isLoading) {
    return (
      <View style={styles.loadingBlock}>
        <ActivityIndicator size="small" />
        <Text style={styles.loadingText}>{t("wechat.detail.loadingHistory")}</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.loadingBlock}>
        <Text style={styles.errorText}>
          {t("wechat.detail.errorPrefix")}: {error}
        </Text>
      </View>
    );
  }
  return (
    <WechatContextView
      messages={messages}
      chatLabel={chatLabel}
      isGroup={isGroup}
      selectedKeys={selectedKeys}
      onToggleSelect={onToggleSelect}
      annotations={annotations}
      onSaveAnnotation={onSaveAnnotation}
      onClearAnnotation={onClearAnnotation}
    />
  );
}

/**
 * Group chats from wx-cli always use the `<hash>@chatroom` username
 * form (Tencent's internal representation). When the sidebar didn't
 * have a username we'd land here with the display name instead — those
 * default to "private" treatment, which is the safest default.
 */
function isGroupChatId(chatId: string | null): boolean {
  if (!chatId) return false;
  return chatId.includes("@chatroom");
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
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
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  titleColumn: {
    flex: 1,
    marginLeft: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: -0.2,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    letterSpacing: -0.1,
  },
  loadingBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
  },
  loadingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  invalidText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[4],
  },
}));
