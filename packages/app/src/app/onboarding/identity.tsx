import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

// Phase 1.e — first-run identity setup. Reached via app/index.tsx when the
// daemon's identity/get reports state.kind === "uninitialized". On submit,
// calls identity/initialize on the daemon and bounces back through "/" so
// the index re-evaluates and lands on the workspace.

function resolveServerId(raw: string | string[] | undefined): string | null {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0] ?? null;
  return null;
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scroll: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: theme.spacing[6],
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    width: "100%",
    maxWidth: 420,
    gap: theme.spacing[6],
  },
  copyBlock: {
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    textAlign: "center",
    letterSpacing: -0.4,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    lineHeight: 20,
  },
  field: {
    gap: theme.spacing[2],
  },
  label: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: -0.1,
  },
  input: {
    fontFamily: theme.fontFamily.system,
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.field,
    borderCurve: "continuous",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  helper: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  error: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));

export default function IdentitySetupRoute() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ serverId?: string | string[] }>();
  const serverId = resolveServerId(params.serverId);

  const client = useHostRuntimeClient(serverId ?? "");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Hoist the dynamic root style out of the JSX render path so the array
  // identity is stable across renders (oxlint react-perf rule).
  const rootStyle = useMemo(() => [styles.root, { paddingTop: insets.top }], [insets.top]);

  const handleSubmit = useCallback(async () => {
    if (isSaving) return;
    const trimmed = displayName.trim();
    if (trimmed.length === 0) {
      setError(t("identity.displayNameRequired"));
      return;
    }
    if (trimmed.length > 64) {
      setError(t("identity.displayNameTooLong"));
      return;
    }
    if (!client) {
      // Daemon dropped between mount and submit — bounce back through index.
      router.replace("/");
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      const response = await client.identityInitialize(trimmed);
      if (response.error || !response.identity) {
        setError(response.error ?? "Unknown error");
        return;
      }
      // Success — re-enter index, which now resolves to workspace because
      // identity/get will report "loaded".
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }, [client, displayName, isSaving, router, t]);

  return (
    <View style={rootStyle}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <View style={styles.copyBlock}>
            <Text style={styles.title}>{t("identity.title")}</Text>
            <Text style={styles.subtitle}>{t("identity.subtitle")}</Text>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{t("identity.displayNameLabel")}</Text>
            <TextInput
              testID="identity-display-name-input"
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder={t("identity.displayNamePlaceholder")}
              placeholderTextColor={theme.colors.foregroundMuted}
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
              editable={!isSaving}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              maxLength={64}
            />
            {error ? (
              <Text style={styles.error}>{error}</Text>
            ) : (
              <Text style={styles.helper}>{t("identity.displayNameHelper")}</Text>
            )}
          </View>
          <Button
            testID="identity-create-button"
            variant="default"
            size="lg"
            onPress={handleSubmit}
            disabled={isSaving || !client}
          >
            {isSaving ? t("identity.creating") : t("identity.createButton")}
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}
