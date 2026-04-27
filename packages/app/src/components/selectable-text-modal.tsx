import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";

interface SelectableTextModalProps {
  visible: boolean;
  text: string;
  title?: string;
  onClose: () => void;
}

export function SelectableTextModal({ visible, text, title, onClose }: SelectableTextModalProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible && copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
      setCopied(false);
    }
  }, [visible]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyAll = useCallback(async () => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => {
      setCopied(false);
      copyTimeoutRef.current = null;
    }, 1500);
  }, [text]);

  return (
    <AdaptiveModalSheet
      title={title ?? t("selectableText.title")}
      visible={visible}
      onClose={onClose}
      scrollable
    >
      <View style={styles.body}>
        <Text style={styles.hint}>{t("selectableText.hint")}</Text>
        <TextInput
          value={text}
          editable={false}
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
          style={styles.textInput}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("selectableText.copyAll")}
          onPress={handleCopyAll}
          style={styles.copyButton}
        >
          {copied ? <Check size={16} color="#10b981" /> : <Copy size={16} color="#a1a1aa" />}
          <Text style={styles.copyButtonText}>
            {copied ? t("selectableText.copied") : t("selectableText.copyAll")}
          </Text>
        </Pressable>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    paddingHorizontal: theme.spacing[6],
    paddingBottom: theme.spacing[6],
    gap: theme.spacing[3],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  textInput: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.5,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[3],
    minHeight: 120,
  },
  copyButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  copyButtonText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
