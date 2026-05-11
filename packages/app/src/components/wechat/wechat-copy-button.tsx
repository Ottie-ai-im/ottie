import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

interface WechatCopyButtonProps {
  text: string;
  /** Optional accessibility label override; defaults to the localized "Copy". */
  label?: string;
}

/**
 * Cross-platform copy button used by suggestion rows and the rewrite
 * panel. Encapsulates `expo-clipboard` invocation, the 1.5s "Copied"
 * affirmation, and the `console.warn` fallback when web clipboard
 * permissions deny the write.
 */
export function WechatCopyButton({ text, label }: WechatCopyButtonProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      // Web rejects setStringAsync when permissions aren't granted; the
      // text remains user-selectable so this is recoverable. Surface as
      // console warn rather than a UI banner.
      // eslint-disable-next-line no-console
      console.warn("[wechat-copy-button] copy failed", err);
    }
  }, [text]);

  return (
    <Pressable
      onPress={handleCopy}
      accessibilityRole="button"
      accessibilityLabel={label ?? t("wechat.detail.copy")}
      style={styles.button}
    >
      {copied ? (
        <>
          <Check size={14} color={theme.colors.foreground} />
          <Text style={styles.label}>{t("wechat.detail.copied")}</Text>
        </>
      ) : (
        <>
          <Copy size={14} color={theme.colors.foregroundMuted} />
          <Text style={styles.label}>{t("wechat.detail.copy")}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
  },
  label: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
}));
