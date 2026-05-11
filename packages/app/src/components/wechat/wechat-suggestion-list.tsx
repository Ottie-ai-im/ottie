import { RefreshCw, Sparkles } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { WechatCopyButton } from "./wechat-copy-button";

interface WechatSuggestionListProps {
  suggestions: readonly string[];
  isFetching: boolean;
  error: string | null;
  /**
   * Hidden until the user opts in for group chats — for private chats the
   * detail page sets `enabled: true` from the start so suggestions appear
   * automatically. We surface a primary "Generate" CTA when the list is
   * empty AND we haven't yet attempted a fetch.
   */
  hasTried: boolean;
  isGroup: boolean;
  /**
   * Number of context messages the user has selected. When > 0 the
   * primary button changes from "Generate" to "Reply (N)" and the
   * regenerate button picks up the same focus.
   */
  selectedCount: number;
  onClearSelection: () => void;
  onGenerate: () => void;
  onRegenerate: () => void;
}

/**
 * Three-row candidate list with per-row Copy. Rows that compress on
 * native and expand to two lines max — anything longer than ~80 chars
 * is unusual for a WeChat reply and a clamp keeps the layout calm.
 */
export function WechatSuggestionList({
  suggestions,
  isFetching,
  error,
  hasTried,
  isGroup,
  selectedCount,
  onClearSelection,
  onGenerate,
  onRegenerate,
}: WechatSuggestionListProps) {
  const { t } = useTranslation();

  const primaryLabel =
    selectedCount > 0
      ? t("wechat.detail.replyToSelected", { count: selectedCount })
      : t("wechat.detail.generate");

  return (
    <View style={styles.root}>
      {selectedCount > 0 ? (
        <View style={styles.selectionBar}>
          <Text style={styles.selectionText} numberOfLines={1}>
            {t("wechat.detail.selectedHint", { count: selectedCount })}
          </Text>
          <Pressable
            onPress={onClearSelection}
            accessibilityRole="button"
            style={styles.iconButton}
          >
            <Text style={styles.iconButtonLabel}>{t("wechat.detail.clearSelection")}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("wechat.detail.suggestionsTitle")}</Text>
        <View style={styles.headerActions}>
          {isFetching ? (
            <View style={styles.headerStatus}>
              <ActivityIndicator size="small" />
              <Text style={styles.headerStatusText}>{t("wechat.detail.generating")}</Text>
            </View>
          ) : null}
          {suggestions.length > 0 || error !== null ? (
            <Pressable onPress={onRegenerate} accessibilityRole="button" style={styles.iconButton}>
              <RefreshCw size={14} />
              <Text style={styles.iconButtonLabel}>{t("wechat.detail.regenerate")}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {error !== null ? (
        <Text style={styles.errorText}>
          {t("wechat.detail.errorPrefix")}: {error}
        </Text>
      ) : null}

      {!isFetching && suggestions.length === 0 && error === null ? (
        <View style={styles.placeholder}>
          <PlaceholderHint isGroup={isGroup} hasTried={hasTried} />
          <Pressable onPress={onGenerate} accessibilityRole="button" style={styles.primaryButton}>
            <Sparkles size={14} />
            <Text style={styles.primaryButtonLabel}>{primaryLabel}</Text>
          </Pressable>
        </View>
      ) : null}

      {suggestions.length > 0 ? (
        <View style={styles.list}>
          {suggestions.map((text) => (
            <SuggestionRow key={text} text={text} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

interface PlaceholderHintProps {
  isGroup: boolean;
  hasTried: boolean;
}

/**
 * Empty-state copy depends on (isGroup, hasTried). Extracted into a
 * tiny named component so the parent doesn't need a nested ternary
 * (oxlint `no-nested-ternary`) and so the conditional reads top-down.
 */
function PlaceholderHint({ isGroup, hasTried }: PlaceholderHintProps) {
  const { t } = useTranslation();
  if (isGroup && !hasTried) {
    return <Text style={styles.placeholderText}>{t("wechat.detail.groupHint")}</Text>;
  }
  if (hasTried) {
    return <Text style={styles.placeholderText}>{t("wechat.detail.noSuggestions")}</Text>;
  }
  return null;
}

interface SuggestionRowProps {
  text: string;
}

function SuggestionRow({ text }: SuggestionRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowText} numberOfLines={3} selectable>
        {text}
      </Text>
      <WechatCopyButton text={text} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderGlass,
    gap: theme.spacing[3],
  },
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface1,
  },
  selectionText: {
    flex: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  headerStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  headerStatusText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  iconButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
  },
  iconButtonLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  errorText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  placeholder: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  placeholderText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  primaryButtonLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  list: {
    gap: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    backgroundColor: theme.colors.surface1,
  },
  rowText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: 20,
  },
}));
