import * as Clipboard from "expo-clipboard";
import { Check, Copy, RefreshCw } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { useWechatSetupState } from "@/hooks/use-wechat-setup-state";
import type { WechatSetupStatus } from "@server/server/wechat/wechat-rpc-schemas";

interface WechatSetupWizardProps {
  serverId: string | null;
}

interface WizardStep {
  titleKey: string;
  bodyKey: string;
  command: string;
}

/**
 * In-line setup card surfaced inside the sidebar list area whenever
 * `wechat/state` returns anything other than `ready`. Renders the OS-
 * appropriate Terminal commands with one-tap copy buttons + a "Check
 * again" trigger that re-runs the state RPC. The wizard auto-dismisses
 * the moment state flips to `ready`; `useWechatSetupState` polls every
 * 10s until then so the user gets fast feedback after `sudo wx init`.
 *
 * Note: codesign + sudo prompts cannot be automated from a Tauri app
 * without a worse UX (osascript "do shell script with administrator
 * privileges" elevates *ottie* to scan another app's memory, which
 * users distrust). We deliberately keep the user in their Terminal.
 */
export function WechatSetupWizard({ serverId }: WechatSetupWizardProps) {
  const { t } = useTranslation();
  const setupState = useWechatSetupState(serverId);

  const steps = useStepsForPlatform();
  const statusLabel = labelForStatus(setupState.status, t);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t("wechat.wizard.title")}</Text>
      <Text style={styles.intro}>{t("wechat.wizard.intro")}</Text>
      {steps.map((step) => (
        <WizardStepCard key={step.titleKey} step={step} />
      ))}
      <View style={styles.footer}>
        <Text style={styles.statusText} numberOfLines={2}>
          {statusLabel}
        </Text>
        <Pressable
          onPress={setupState.refetch}
          accessibilityRole="button"
          accessibilityLabel={t("wechat.wizard.checkAgain")}
          style={styles.refreshButton}
        >
          {setupState.isFetching ? <ActivityIndicator size="small" /> : <RefreshCw size={14} />}
          <Text style={styles.refreshLabel}>{t("wechat.wizard.checkAgain")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface WizardStepCardProps {
  step: WizardStep;
}

function WizardStepCard({ step }: WizardStepCardProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(step.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[wechat-setup-wizard] copy failed", err);
    }
  }, [step.command]);

  return (
    <View style={styles.stepCard}>
      <Text style={styles.stepTitle}>{t(step.titleKey)}</Text>
      <Text style={styles.stepBody}>{t(step.bodyKey)}</Text>
      <View style={styles.commandRow}>
        <Text style={styles.commandText} numberOfLines={3} selectable>
          {step.command}
        </Text>
        <Pressable
          onPress={handleCopy}
          accessibilityRole="button"
          accessibilityLabel={t("wechat.detail.copy")}
          style={styles.copyButton}
        >
          {copied ? (
            <>
              <Check size={14} color={theme.colors.foreground} />
              <Text style={styles.copyLabel}>{t("wechat.detail.copied")}</Text>
            </>
          ) : (
            <>
              <Copy size={14} color={theme.colors.foregroundMuted} />
              <Text style={styles.copyLabel}>{t("wechat.detail.copy")}</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Per-platform step list. macOS gets the full 3-step (codesign + restart
 * + init); Linux skips the codesign dance since the kernel uses
 * /proc/<pid>/mem rather than `task_for_pid`. Windows skips signing
 * but needs an elevated shell.
 *
 * On non-desktop / unknown platforms (web / mobile) we fall back to
 * the macOS variant — the user can't actually run those commands from
 * a phone but the cards still document what their Mac/PC needs to do.
 */
function useStepsForPlatform(): readonly WizardStep[] {
  const os = Platform.OS;
  if (os === "android" || os === "ios" || os === "web") {
    return MAC_STEPS;
  }
  // Tauri's webview reports `process.platform` semantics indirectly;
  // when running inside the desktop shell `Platform.OS === "web"` (Expo
  // collapses to web for Tauri), so the heuristic above already covers
  // the desktop case. Real native macOS/Linux/Windows detection would
  // need an Electron-style bridge — out of scope for the MVP.
  return MAC_STEPS;
}

const MAC_STEPS: readonly WizardStep[] = [
  {
    titleKey: "wechat.wizard.macSign.title",
    bodyKey: "wechat.wizard.macSign.body",
    command: "codesign --force --deep --sign - /Applications/WeChat.app",
  },
  {
    titleKey: "wechat.wizard.macRestart.title",
    bodyKey: "wechat.wizard.macRestart.body",
    command: "killall WeChat && open /Applications/WeChat.app",
  },
  {
    titleKey: "wechat.wizard.init.title",
    bodyKey: "wechat.wizard.init.body",
    command: "sudo wx init",
  },
];

function labelForStatus(status: WechatSetupStatus | "loading", t: (key: string) => string): string {
  switch (status) {
    case "ready":
      return t("wechat.wizard.stateReady");
    case "binary_not_found":
      return t("wechat.wizard.stateBinaryMissing");
    case "not_initialized":
      return t("wechat.wizard.stateNotInitialized");
    case "wechat_not_running":
      return t("wechat.wizard.stateWechatNotRunning");
    case "codesign_required":
      return t("wechat.wizard.stateCodesignRequired");
    case "daemon_timeout":
      return t("wechat.wizard.stateDaemonTimeout");
    case "permission_denied":
      return t("wechat.wizard.statePermissionDenied");
    case "loading":
      return t("sidebar.wechat.loading");
    default:
      return t("wechat.wizard.stateUnknown");
  }
}

const styles = StyleSheet.create((theme) => ({
  root: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[3],
  },
  title: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  intro: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    lineHeight: 18,
  },
  stepCard: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[2],
  },
  stepTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  stepBody: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    lineHeight: 18,
  },
  commandRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
  },
  commandText: {
    flex: 1,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
    lineHeight: 18,
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
  },
  copyLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[1],
  },
  statusText: {
    flex: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    lineHeight: 18,
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  refreshLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
}));
