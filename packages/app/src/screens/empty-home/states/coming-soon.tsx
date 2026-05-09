import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Construction } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";

// MVP placeholder for the two paths we have not built yet:
//   - "old-user": folder picker + preview (desktop-only, Phase 1/2)
//   - "device-link": redeem an invite from another machine (Phase 3 ext)
//
// Both surface the same reassurance card so the user knows the path exists
// and where it will live, instead of a dead button.

interface ComingSoonProps {
  reason: "old-user" | "device-link";
  onBack: () => void;
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.card,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[6],
    gap: theme.spacing[4],
  },
  iconBlock: {
    alignSelf: "flex-start",
    width: 44,
    height: 44,
    borderRadius: theme.borderRadius.lg,
    borderCurve: "continuous",
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: -0.2,
  },
  body: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));

export function ComingSoon({ reason, onBack }: ComingSoonProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();

  const headingKey =
    reason === "old-user"
      ? "emptyHome.comingSoon.oldUser.title"
      : "emptyHome.comingSoon.deviceLink.title";
  const bodyKey =
    reason === "old-user"
      ? "emptyHome.comingSoon.oldUser.body"
      : "emptyHome.comingSoon.deviceLink.body";

  return (
    <View style={styles.card}>
      <View style={styles.iconBlock}>
        <Construction size={22} color={theme.colors.foreground} />
      </View>
      <Text style={styles.heading}>{t(headingKey)}</Text>
      <Text style={styles.body}>{t(bodyKey)}</Text>
      <View style={styles.actions}>
        <Button variant="secondary" size="md" onPress={onBack}>
          {t("emptyHome.comingSoon.back")}
        </Button>
      </View>
    </View>
  );
}
