import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { Sprout, KeyRound } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { CtaCard } from "../cta-card";

interface WelcomeCtaProps {
  onPickNewUser: () => void;
  onPickOldUser: () => void;
  onPickPair: () => void;
  onPickAdvancedLink: () => void;
}

const styles = StyleSheet.create((theme) => ({
  cards: {
    gap: theme.spacing[3],
  },
  footerBlock: {
    marginTop: theme.spacing[6],
    alignItems: "center",
    gap: theme.spacing[1],
  },
  footerLink: {
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
  },
  footerLinkText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

export function WelcomeCta({
  onPickNewUser,
  onPickOldUser,
  onPickPair,
  onPickAdvancedLink,
}: WelcomeCtaProps) {
  const { t } = useTranslation();

  return (
    <View>
      <View style={styles.cards}>
        <CtaCard
          testID="empty-home-cta-new-user"
          icon={Sprout}
          title={t("emptyHome.newUser.title")}
          subtitle={t("emptyHome.newUser.subtitle")}
          emphasis="primary"
          onPress={onPickNewUser}
        />
        <CtaCard
          testID="empty-home-cta-old-user"
          icon={KeyRound}
          title={t("emptyHome.oldUser.title")}
          subtitle={t("emptyHome.oldUser.subtitle")}
          onPress={onPickOldUser}
        />
      </View>

      <View style={styles.footerBlock}>
        <Pressable
          testID="empty-home-footer-pair"
          accessibilityRole="link"
          onPress={onPickPair}
          style={styles.footerLink}
        >
          <Text style={styles.footerLinkText}>{t("emptyHome.footerPair")}</Text>
        </Pressable>
        <Pressable
          testID="empty-home-advanced-device-link"
          accessibilityRole="link"
          onPress={onPickAdvancedLink}
          style={styles.footerLink}
        >
          <Text style={styles.footerLinkText}>{t("emptyHome.advancedDeviceLink")}</Text>
        </Pressable>
      </View>
    </View>
  );
}
