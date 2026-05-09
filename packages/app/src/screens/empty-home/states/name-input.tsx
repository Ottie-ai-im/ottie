import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { getHostRuntimeStore, useHostRuntimeClient } from "@/runtime/host-runtime";

// Inline nickname form. Reachable from EmptyHomeCard's "我是新用户" CTA.
//
// Behaviour:
//   - If a daemon is online, submit calls identityInitialize on it. On
//     success the parent routes to that daemon's host root.
//   - If no daemon is online, the form shows a "先连接一个设备" hint and
//     surfaces a "Pair" shortcut so the user can come back here later.

interface NameInputProps {
  onlineServerId: string | null;
  onPair: () => void;
  onBack: () => void;
  onCompleted: (serverId: string) => void;
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
  heading: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: -0.2,
  },
  inputWrap: {
    gap: theme.spacing[2],
  },
  input: {
    fontFamily: theme.fontFamily.system,
    backgroundColor: theme.colors.surface0,
    borderRadius: theme.borderRadius.field,
    borderCurve: "continuous",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  inputFocused: {
    borderColor: theme.colors.foreground,
  },
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  hint: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    borderCurve: "continuous",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  hintText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  submit: {
    backgroundColor: theme.colors.foreground,
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[3],
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  submitDisabled: {
    opacity: theme.opacity[50],
  },
  submitText: {
    color: theme.colors.surface0,
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: -0.1,
  },
}));

export function NameInput({ onlineServerId, onPair, onBack, onCompleted }: NameInputProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const client = useHostRuntimeClient(onlineServerId ?? "");
  const [name, setName] = useState("");
  const [focused, setFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const isNameValid = trimmed.length > 0 && trimmed.length <= 64;
  const canPress = isNameValid && !submitting;

  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);

  const inputStyle = useMemo(() => [styles.input, focused ? styles.inputFocused : null], [focused]);

  // Black-on-white primary CTA — rendered as a raw Pressable rather than
  // the shared Button component because Button's "default" variant fills
  // with `accent` (light blue) which renders almost invisibly on the
  // surface1 card. Same aesthetic as CtaCard's primary icon block.
  const submitStyle = useMemo(
    () => [styles.submit, !canPress ? styles.submitDisabled : null],
    [canPress],
  );

  // Submit semantics:
  //   1. Connect to the local daemon if not already connected.
  //   2. Inspect identity state on that daemon:
  //        - "loaded"        — already initialized (e.g. user already
  //                            registered before). Skip straight to the
  //                            main page; the typed nickname is ignored
  //                            because identity is immutable here.
  //        - "uninitialized" — fresh daemon. Call identityInitialize
  //                            with the typed nickname.
  //        - "load-failed"   — corrupted identity file. Surface the
  //                            error so the user can intervene.
  //   3. If the local-daemon probe fails entirely, fall back to the
  //      pair modal so the user can target a remote daemon.
  const handleSubmit = useCallback(async () => {
    if (!canPress) return;
    setSubmitting(true);
    setError(null);
    try {
      let activeServerId = onlineServerId;
      let activeClient = client;

      if (!activeServerId || !activeClient) {
        const store = getHostRuntimeStore();
        const profile = await store.connectToLocalhost({ timeoutMs: 8000 });
        if (!profile) {
          onPair();
          return;
        }
        activeServerId = profile.serverId;
        activeClient = store.getClient(activeServerId);
        if (!activeClient) {
          setError(t("emptyHome.nameInput.unknownError"));
          return;
        }
      }

      const status = await activeClient.identityGet();
      const kind = status.state?.kind;

      if (kind === "loaded") {
        onCompleted(activeServerId);
        return;
      }

      if (kind === "load-failed") {
        setError(t("identity.loadFailed"));
        return;
      }

      const response = await activeClient.identityInitialize(trimmed);
      if (response.error || !response.identity) {
        setError(response.error ?? t("emptyHome.nameInput.unknownError"));
        return;
      }
      onCompleted(activeServerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [canPress, client, onCompleted, onPair, onlineServerId, t, trimmed]);

  // Always show "Done" — the click handler now auto-connects to the local
  // daemon if needed, so from the user's POV there is no "pair first" step.
  const submitLabel = submitting
    ? t("emptyHome.nameInput.submitting")
    : t("emptyHome.nameInput.submit");

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{t("emptyHome.nameInput.title")}</Text>

      <View style={styles.inputWrap}>
        <TextInput
          testID="empty-home-name-input"
          style={inputStyle}
          value={name}
          onChangeText={setName}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={t("emptyHome.nameInput.placeholder")}
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus
          editable={!submitting}
          returnKeyType="done"
          maxLength={64}
          onSubmitEditing={handleSubmit}
        />
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <Text style={styles.helper}>{t("emptyHome.nameInput.helper")}</Text>
        )}
      </View>

      <View style={styles.actions}>
        <Button variant="ghost" size="md" onPress={onBack} disabled={submitting}>
          {t("emptyHome.nameInput.back")}
        </Button>
        <Pressable
          testID="empty-home-name-submit"
          accessibilityRole="button"
          onPress={handleSubmit}
          disabled={!canPress}
          style={submitStyle}
        >
          <Text style={styles.submitText}>{submitLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}
