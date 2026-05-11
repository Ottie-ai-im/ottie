import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Check, Mic, Pencil } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { WechatMessage } from "@server/server/wechat/wechat-types";

interface WechatContextViewProps {
  messages: readonly WechatMessage[];
  /** Display name of the counterparty — used to label the "other" side. */
  chatLabel: string;
  isGroup: boolean;
  /** Set of selected message keys (see `messageKey`). Tap toggles inclusion. */
  selectedKeys: ReadonlySet<string>;
  onToggleSelect: (key: string) => void;
  /**
   * User-typed transcripts for voice messages, keyed by `messageKey()`.
   * When a row's content is `[语音]` and its key is in this map, the
   * annotation replaces the placeholder both visually and in the
   * suggestion prompt that goes to the LLM.
   */
  annotations: Readonly<Record<string, string>>;
  onSaveAnnotation: (messageKey: string, text: string) => void;
  onClearAnnotation: (messageKey: string) => void;
}

/**
 * WeChat-style transcript: bubbles, with my messages on the right and
 * the counterparty's on the left. Deliberately muted color palette
 * (light grays, no saturated greens) to match the user's "professional
 * minimal" preference — drops the iconic `#95EC69` for `surface2`.
 *
 * Sender attribution rule (matches what wx-cli actually surfaces):
 *   - private chat: empty `sender` = counterparty (wx-cli source
 *     query.rs:621-644), non-empty = me. Aligned right when me.
 *   - group chat: every message has a sender name. We can't tell
 *     which one is "me" without my own wxid — so groups render
 *     everyone on the left with a name label above the bubble. v2
 *     idea: pass the user's own display name from settings to flip
 *     self-messages right.
 *
 * Tap to select: any bubble can be tapped to mark it as a focus
 * target for AI suggestions ("回复 N 条" button down below). Selected
 * bubbles gain a darker border + check icon. The tap doesn't fire any
 * AI call by itself; that's deferred to the explicit Reply button so
 * we don't burn tokens on every accidental tap.
 */
export function WechatContextView({
  messages,
  chatLabel,
  isGroup,
  selectedKeys,
  onToggleSelect,
  annotations,
  onSaveAnnotation,
  onClearAnnotation,
}: WechatContextViewProps) {
  const { t } = useTranslation();

  if (messages.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t("wechat.detail.noHistory")}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {messages.map((msg, idx) => {
        const key = messageKey(msg, idx);
        const role = resolveRole(msg, isGroup);
        const senderLabel = resolveSenderLabel(msg, role, chatLabel);
        const rawContent = (msg.content ?? "").trim();
        return (
          <BubbleRow
            key={key}
            messageKey={key}
            role={role}
            senderLabel={senderLabel}
            content={rawContent}
            annotation={annotations[key] ?? null}
            isSelected={selectedKeys.has(key)}
            onToggleSelect={onToggleSelect}
            onSaveAnnotation={onSaveAnnotation}
            onClearAnnotation={onClearAnnotation}
          />
        );
      })}
    </ScrollView>
  );
}

type Role = "self" | "other";

interface BubbleRowProps {
  messageKey: string;
  role: Role;
  /**
   * Label rendered above the bubble. Empty string hides the label
   * (private chats: identity is implicit from left/right placement).
   */
  senderLabel: string;
  content: string;
  annotation: string | null;
  isSelected: boolean;
  onToggleSelect: (key: string) => void;
  onSaveAnnotation: (key: string, text: string) => void;
  onClearAnnotation: (key: string) => void;
}

function BubbleRow({
  messageKey: key,
  role,
  senderLabel,
  content,
  annotation,
  isSelected,
  onToggleSelect,
  onSaveAnnotation,
  onClearAnnotation,
}: BubbleRowProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation ?? "");

  const isVoice = isVoiceMessage(content);
  const displayContent = annotation && annotation.length > 0 ? annotation : content;

  const handleEditStart = useCallback(() => {
    setDraft(annotation ?? "");
    setEditing(true);
  }, [annotation]);
  const handleEditCancel = useCallback(() => {
    setEditing(false);
    setDraft(annotation ?? "");
  }, [annotation]);
  const handleEditSave = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      onClearAnnotation(key);
    } else {
      onSaveAnnotation(key, trimmed);
    }
    setEditing(false);
  }, [draft, key, onClearAnnotation, onSaveAnnotation]);

  // Bubble tap = select for AI focus (uniform across voice + non-voice).
  // The pencil icon inside voice bubbles is a separate Pressable that
  // intercepts the tap and opens the editor — so bubble vs pencil are
  // two distinct affordances on the same row.
  const handleBubblePress = useCallback(() => {
    onToggleSelect(key);
  }, [key, onToggleSelect]);

  const accessibilityState = useMemo(() => ({ checked: isSelected }), [isSelected]);
  const rowStyle = role === "self" ? styles.rowSelf : styles.rowOther;
  const bubbleStyle = useMemo(() => {
    const base = role === "self" ? styles.bubbleSelf : styles.bubbleOther;
    return [base, isSelected ? styles.bubbleSelected : null];
  }, [role, isSelected]);
  const textStyle = role === "self" ? styles.contentSelf : styles.contentOther;

  return (
    <View style={rowStyle}>
      {senderLabel.length > 0 ? (
        <Text style={role === "self" ? styles.senderSelf : styles.senderOther} numberOfLines={1}>
          {senderLabel}
        </Text>
      ) : null}
      {editing ? (
        <View style={styles.editorBlock} key="editor">
          <View style={styles.editorHeader}>
            <Mic size={12} color={theme.colors.foregroundMuted} />
            <Text style={styles.editorHeaderLabel} numberOfLines={1}>
              [语音]
            </Text>
          </View>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t("wechat.detail.voiceAnnotatePlaceholder")}
            placeholderTextColor={theme.colors.foregroundMuted}
            multiline
            autoFocus
            style={styles.editorInput}
          />
          <View style={styles.editorActions}>
            <Pressable
              onPress={handleEditCancel}
              accessibilityRole="button"
              style={styles.editorCancelButton}
            >
              <Text style={styles.editorCancelLabel}>{t("wechat.detail.voiceAnnotateCancel")}</Text>
            </Pressable>
            <Pressable
              onPress={handleEditSave}
              accessibilityRole="button"
              style={styles.editorSaveButton}
            >
              <Text style={styles.editorSaveLabel}>{t("wechat.detail.voiceAnnotateSave")}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={handleBubblePress}
          accessibilityRole="checkbox"
          accessibilityState={accessibilityState}
          accessibilityLabel={displayContent}
          style={bubbleStyle}
        >
          <View style={styles.contentRow}>
            {isVoice ? (
              <Mic size={12} color={theme.colors.foregroundMuted} style={styles.voiceIcon} />
            ) : null}
            <Text style={textStyle} selectable>
              {displayContent}
            </Text>
            {isVoice ? (
              <Pressable
                onPress={handleEditStart}
                accessibilityRole="button"
                accessibilityLabel={
                  annotation
                    ? t("wechat.detail.voiceAnnotateEdit")
                    : t("wechat.detail.voiceAnnotateHint")
                }
                hitSlop={8}
                style={styles.pencilButton}
              >
                <Pencil size={12} color={theme.colors.foreground} />
              </Pressable>
            ) : null}
          </View>
          {isSelected ? (
            <View style={styles.selectionMark}>
              <Check size={10} color={theme.colors.foreground} />
            </View>
          ) : null}
        </Pressable>
      )}
    </View>
  );
}

/**
 * wx-cli emits "[语音]" as the placeholder content for voice messages
 * (src/daemon/query.rs `fmt_content`). Detect both the exact form and
 * the case where wx-cli prefixed the placeholder onto other text —
 * either way the user gets the chance to type a transcript.
 */
function isVoiceMessage(content: string): boolean {
  return content === "[语音]" || content.startsWith("[语音]");
}

function resolveRole(msg: WechatMessage, isGroup: boolean): Role {
  if (isGroup) {
    // Without knowing my own wxid we can't reliably detect self in
    // groups. Render everyone on the left so layout stays predictable;
    // sender label above the bubble identifies them.
    return "other";
  }
  // Private chat — wx-cli emits empty sender for the counterparty
  // (src/daemon/query.rs:621-644). Non-empty = me.
  return msg.sender && msg.sender.length > 0 ? "self" : "other";
}

function resolveSenderLabel(msg: WechatMessage, role: Role, chatLabel: string): string {
  // Private chat: identity is implicit from left/right placement, no
  // label needed inside the row.
  if (role === "self") return "";
  if (msg.sender && msg.sender.length > 0) return msg.sender;
  return chatLabel;
}

/**
 * Stable key for a message row. local_id is wx-cli's internal id (most
 * stable); falls back to (timestamp, idx) when missing.
 */
export function messageKey(msg: WechatMessage, idx: number): string {
  if (typeof msg.local_id === "number") return `lid-${msg.local_id}`;
  if (typeof msg.timestamp === "number") return `ts-${msg.timestamp}-${idx}`;
  return `idx-${idx}`;
}

const BUBBLE_MAX_WIDTH_PCT = "78%" as const;

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
  },
  empty: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[6],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  rowOther: {
    alignItems: "flex-start",
    maxWidth: BUBBLE_MAX_WIDTH_PCT,
    alignSelf: "flex-start",
    gap: 2,
  },
  rowSelf: {
    alignItems: "flex-end",
    maxWidth: BUBBLE_MAX_WIDTH_PCT,
    alignSelf: "flex-end",
    gap: 2,
  },
  senderOther: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[2],
  },
  senderSelf: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[2],
  },
  // Other party's bubble — light surface, soft border, top-left corner
  // square-ish to lean toward the sender side (subtle WeChat-ish tail
  // hint without an actual tail SVG).
  bubbleOther: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderTopLeftRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  // Self bubble — pale mint (palette.green[200]). Recognisable as the
  // "WeChat green" family without the eye-popping saturation of the
  // canonical #95EC69. The 200 shade reads well on light surfaces with
  // the foreground text color and stays muted enough to fit the
  // "professional minimal" palette the user asked for.
  bubbleSelf: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderTopRightRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.palette.green[200],
    borderWidth: 1,
    borderColor: theme.colors.palette.green[200],
  },
  // Selection feedback: the bubble border darkens to match the
  // foreground color. Pairs with the small check mark in the corner.
  bubbleSelected: {
    borderColor: theme.colors.foreground,
  },
  contentOther: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: 20,
  },
  contentSelf: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: 20,
  },
  selectionMark: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 16,
    height: 16,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.foreground,
    alignItems: "center",
    justifyContent: "center",
  },
  contentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[1],
  },
  voiceIcon: {
    marginTop: 4,
  },
  pencilButton: {
    marginLeft: theme.spacing[1],
    marginTop: 2,
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    alignSelf: "flex-start",
  },
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  editorHeaderLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  editorBlock: {
    width: 280,
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[2],
  },
  editorInput: {
    minHeight: 48,
    maxHeight: 120,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: 18,
    textAlignVertical: "top",
  },
  editorActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  editorCancelButton: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.sm,
  },
  editorCancelLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  editorSaveButton: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.foreground,
  },
  editorSaveLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.semibold,
  },
}));
