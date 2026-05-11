import { Wand2 } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { WechatCopyButton } from "./wechat-copy-button";
import {
  useWechatRewrite,
  WECHAT_REWRITE_TONES,
  type WechatRewriteTone,
} from "@/hooks/use-wechat-rewrite";

interface WechatRewritePanelProps {
  serverId: string | null;
}

/**
 * "Type a draft, AI polishes it" panel. Sits below the AI suggestions
 * on the detail page so the layout reads top-down: see context → pick a
 * suggestion OR write your own → polish → copy.
 *
 * Editing the draft clears the previous rewrite so a stale result
 * doesn't accidentally get copied for new content. Each tone pill is a
 * button; the in-flight tone shows a small spinner so the user knows
 * which request is pending.
 */
export function WechatRewritePanel({ serverId }: WechatRewritePanelProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [draft, setDraft] = useState("");
  const rewrite = useWechatRewrite(serverId);

  const handleDraftChange = useCallback(
    (next: string) => {
      setDraft(next);
      // Editing the draft invalidates any prior rewrite — surfacing it
      // for new content would be confusing and easy to copy by mistake.
      if (rewrite.result !== null || rewrite.error !== null) {
        rewrite.reset();
      }
    },
    [rewrite],
  );

  const handlePickTone = useCallback(
    (tone: WechatRewriteTone) => {
      // eslint-disable-next-line no-console
      console.log("[wx-ai] tone.click", {
        tone,
        draftLen: draft.length,
        isLoading: rewrite.isLoading,
        pendingTone: rewrite.pendingTone,
      });
      if (draft.trim().length === 0) {
        // eslint-disable-next-line no-console
        console.warn("[wx-ai] tone.bailed — empty draft");
        return;
      }
      rewrite.rewrite({ draft, tone });
    },
    [draft, rewrite],
  );

  const draftEmpty = draft.trim().length === 0;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Wand2 size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.headerTitle}>{t("wechat.rewrite.title")}</Text>
      </View>

      <TextInput
        value={draft}
        onChangeText={handleDraftChange}
        placeholder={t("wechat.rewrite.draftPlaceholder")}
        placeholderTextColor={theme.colors.foregroundMuted}
        multiline
        style={styles.input}
        accessibilityLabel={t("wechat.rewrite.title")}
      />

      <View style={styles.toneRow}>
        {WECHAT_REWRITE_TONES.map((tone) => (
          <ToneChip
            key={tone}
            tone={tone}
            disabled={draftEmpty || rewrite.isLoading}
            isPending={rewrite.pendingTone === tone}
            isActive={rewrite.activeTone === tone && rewrite.result !== null}
            onPress={handlePickTone}
          />
        ))}
      </View>

      {rewrite.error !== null ? (
        <Text style={styles.errorText}>
          {t("wechat.detail.errorPrefix")}: {rewrite.error}
        </Text>
      ) : null}

      {rewrite.isLoading && rewrite.result === null ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" />
          <Text style={styles.loadingText}>{t("wechat.rewrite.rewriting")}</Text>
        </View>
      ) : null}

      {rewrite.result !== null ? (
        <View style={styles.resultBlock}>
          <Text style={styles.resultText} selectable>
            {rewrite.result}
          </Text>
          <WechatCopyButton text={rewrite.result} />
        </View>
      ) : null}
    </View>
  );
}

interface ToneChipProps {
  tone: WechatRewriteTone;
  disabled: boolean;
  isPending: boolean;
  isActive: boolean;
  onPress: (tone: WechatRewriteTone) => void;
}

function ToneChip({ tone, disabled, isPending, isActive, onPress }: ToneChipProps) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onPress(tone), [onPress, tone]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t(`wechat.rewrite.tones.${tone}`)}
      style={resolveChipStyle(disabled, isActive)}
    >
      {isPending ? <ActivityIndicator size="small" /> : null}
      <Text style={isActive ? styles.chipLabelActive : styles.chipLabel}>
        {t(`wechat.rewrite.tones.${tone}`)}
      </Text>
    </Pressable>
  );
}

function resolveChipStyle(disabled: boolean, isActive: boolean) {
  if (disabled) return styles.chipDisabled;
  if (isActive) return styles.chipActive;
  return styles.chip;
}

const styles = StyleSheet.create((theme) => ({
  root: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderGlass,
    gap: theme.spacing[2],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  headerTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  input: {
    minHeight: 64,
    maxHeight: 160,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    textAlignVertical: "top",
  },
  toneRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  chipActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.foreground,
    backgroundColor: theme.colors.surface2,
  },
  chipDisabled: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    opacity: 0.4,
  },
  chipLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  chipLabelActive: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.semibold,
  },
  errorText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  loadingText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  resultBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    backgroundColor: theme.colors.surface1,
  },
  resultText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: 20,
  },
}));
