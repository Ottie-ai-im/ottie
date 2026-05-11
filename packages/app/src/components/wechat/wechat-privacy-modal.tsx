import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, Text, View } from "react-native";
import { StyleSheet as RNStyleSheet } from "react-native";
import { StyleSheet } from "react-native-unistyles";

interface WechatPrivacyModalProps {
  visible: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

/**
 * One-time confirmation surfaced before any LLM-bound payload leaves
 * the daemon for the WeChat detail page. Once accepted we set
 * `wechatPrivacyAgreed = true` in AppSettings and never re-prompt
 * unless the user explicitly resets it from Settings → WeChat.
 *
 * Modal-not-Toast on purpose: this is a privacy-meaningful confirm,
 * not a hint. Cancellation navigates back so the user lands in a
 * neutral state rather than staring at a blocked detail page.
 */
export function WechatPrivacyModal({ visible, onAccept, onCancel }: WechatPrivacyModalProps) {
  const { t } = useTranslation();

  const handleRequestClose = useCallback(() => {
    // Hardware back / Esc on web should behave as cancel.
    onCancel();
  }, [onCancel]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleRequestClose}>
      <View style={styles.root}>
        {/* Backdrop is a separate sibling so its opacity (0.5) doesn't
            cascade into the card's text colors. Tapping it is a noop —
            cancellation goes through the explicit "Not now" button so a
            single misclick can't drop the privacy decision. */}
        <View style={styles.backdrop} pointerEvents="none" />
        <View style={styles.cardWrap} pointerEvents="box-none">
          <View style={styles.card}>
            <Text style={styles.title}>{t("wechat.privacy.title")}</Text>
            <Text style={styles.body}>{t("wechat.privacy.body")}</Text>
            <View style={styles.actions}>
              <Pressable
                onPress={onCancel}
                accessibilityRole="button"
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryLabel}>{t("wechat.privacy.cancel")}</Text>
              </Pressable>
              <Pressable onPress={onAccept} accessibilityRole="button" style={styles.primaryButton}>
                <Text style={styles.primaryLabel}>{t("wechat.privacy.accept")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
  },
  backdrop: {
    ...RNStyleSheet.absoluteFillObject,
    // Use the foreground token + opacity rather than a hardcoded
    // rgba — keeps the dim color in sync with the active theme
    // (light vs dark) and stays under the repo's hardcoded-color lint.
    backgroundColor: theme.colors.foreground,
    opacity: 0.5,
  },
  cardWrap: {
    ...RNStyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  card: {
    width: "100%",
    maxWidth: 420,
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    gap: theme.spacing[3],
  },
  title: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    letterSpacing: -0.2,
  },
  body: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  secondaryButton: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  secondaryLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  primaryButton: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.foreground,
  },
  primaryLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.semibold,
  },
}));
