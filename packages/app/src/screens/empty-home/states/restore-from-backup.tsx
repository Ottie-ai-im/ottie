import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Upload } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button } from "@/components/ui/button";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { pickIdentityFile } from "@/utils/identity-file-io";
import {
  IdentityExportBundleSchema,
  type IdentityExportBundle,
} from "@server/server/identity/identity-rpc-schemas";

// Restore-from-backup ("登录" path on the welcome screen).
//
// State machine for what the user sees in this card:
//   - no-host:    no daemon paired yet — prompt to pair first
//   - choose:     have an uninitialized daemon — show "pick file" button
//   - preview:    file parsed cleanly — show display name + counts + confirm
//   - importing:  RPC in flight
//   - error:      something went wrong — show message + try-again
//
// Exit paths:
//   - onBack: user dismisses the card
//   - onPair: user wants to pair a different daemon
//   - onCompleted(serverId): import succeeded — caller routes into the host

interface RestoreFromBackupProps {
  /** Currently online uninitialized daemon, or null when nothing is paired. */
  serverId: string | null;
  onBack: () => void;
  onPair: () => void;
  onCompleted: (serverId: string) => void;
}

type Stage =
  | { kind: "choose" }
  | { kind: "preview"; bundle: IdentityExportBundle; fileName: string | null }
  | { kind: "importing" }
  | { kind: "error"; message: string };

export function RestoreFromBackup({
  serverId,
  onBack,
  onPair,
  onCompleted,
}: RestoreFromBackupProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const client = useHostRuntimeClient(serverId ?? "");
  const [stage, setStage] = useState<Stage>({ kind: "choose" });

  const handlePickFile = useCallback(async () => {
    setStage({ kind: "choose" });
    try {
      const picked = await pickIdentityFile();
      if (!picked) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(picked.text);
      } catch {
        setStage({
          kind: "error",
          message: t("emptyHome.restore.errors.invalidJson"),
        });
        return;
      }
      const result = IdentityExportBundleSchema.safeParse(parsed);
      if (!result.success) {
        setStage({
          kind: "error",
          message: t("emptyHome.restore.errors.invalidBundle"),
        });
        return;
      }
      setStage({ kind: "preview", bundle: result.data, fileName: picked.fileName });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStage({ kind: "error", message });
    }
  }, [t]);

  const handleResetToChoose = useCallback(() => setStage({ kind: "choose" }), []);

  const handleConfirmImport = useCallback(async () => {
    if (stage.kind !== "preview" || !client || !serverId) return;
    setStage({ kind: "importing" });
    try {
      const response = await client.identityImport(stage.bundle);
      if (response.error || !response.identity) {
        setStage({
          kind: "error",
          message: response.error ?? t("emptyHome.restore.errors.importFailed"),
        });
        return;
      }
      onCompleted(serverId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStage({ kind: "error", message });
    }
  }, [client, onCompleted, serverId, stage, t]);

  if (!serverId) {
    return (
      <View style={styles.card}>
        <View style={styles.iconBlock}>
          <Upload size={22} color={theme.colors.foreground} />
        </View>
        <Text style={styles.heading}>{t("emptyHome.restore.title")}</Text>
        <Text style={styles.body}>{t("emptyHome.restore.needsHost")}</Text>
        <View style={styles.actions}>
          <Button variant="secondary" size="md" onPress={onBack}>
            {t("emptyHome.comingSoon.back")}
          </Button>
          <Button variant="default" size="md" onPress={onPair}>
            {t("emptyHome.restore.pairButton")}
          </Button>
        </View>
      </View>
    );
  }

  if (stage.kind === "preview") {
    const { bundle } = stage;
    const fingerprint = bundle.rootIdentity.signPublicKeyB64.slice(0, 8);
    const friendCount = bundle.peers?.peers.length ?? 0;
    const deviceCount = bundle.devices?.devices.length ?? 0;
    return (
      <View style={styles.card}>
        <View style={styles.iconBlock}>
          <Upload size={22} color={theme.colors.foreground} />
        </View>
        <Text style={styles.heading}>{t("emptyHome.restore.previewTitle")}</Text>
        <Text style={styles.body}>
          {t("emptyHome.restore.previewIdentity", {
            name: bundle.rootIdentity.displayName,
            fingerprint,
          })}
        </Text>
        <Text style={styles.body}>
          {t("emptyHome.restore.previewCounts", { friends: friendCount, devices: deviceCount })}
        </Text>
        {stage.fileName ? (
          <Text style={styles.bodyMuted}>
            {t("emptyHome.restore.previewSourceFile", { fileName: stage.fileName })}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button variant="secondary" size="md" onPress={handleResetToChoose}>
            {t("common.cancel")}
          </Button>
          <Button variant="default" size="md" onPress={handleConfirmImport}>
            {t("emptyHome.restore.confirmAction")}
          </Button>
        </View>
      </View>
    );
  }

  if (stage.kind === "importing") {
    return (
      <View style={styles.card}>
        <Text style={styles.heading}>{t("emptyHome.restore.importing")}</Text>
        <Text style={styles.body}>{t("emptyHome.restore.importingHint")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.iconBlock}>
        <Upload size={22} color={theme.colors.foreground} />
      </View>
      <Text style={styles.heading}>{t("emptyHome.restore.title")}</Text>
      <Text style={styles.body}>{t("emptyHome.restore.body")}</Text>
      <Text style={styles.bodyMuted}>{t("emptyHome.restore.targetHint")}</Text>
      {stage.kind === "error" ? <Text style={styles.error}>{stage.message}</Text> : null}
      <View style={styles.actions}>
        <Button variant="secondary" size="md" onPress={onBack}>
          {t("emptyHome.comingSoon.back")}
        </Button>
        <Button variant="default" size="md" onPress={handlePickFile}>
          {t("emptyHome.restore.pickAction")}
        </Button>
      </View>
    </View>
  );
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
  bodyMuted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    fontStyle: "italic",
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
