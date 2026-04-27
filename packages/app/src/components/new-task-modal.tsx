import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Check, FolderPlus, OctagonAlert, Sparkles } from "lucide-react-native";
import type { CheckPathResult } from "@server/client/daemon-client";
import { AdaptiveModalSheet, AdaptiveTextInput } from "./adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useOpenProject } from "@/hooks/use-open-project";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

const FLEX_ONE_STYLE = { flex: 1 } as const;
const CHECK_DEBOUNCE_MS = 500;

const styles = StyleSheet.create((theme) => ({
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  preview: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  statusOk: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  statusInfo: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  statusError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
}));

// Replace filesystem-forbidden chars only. Spaces are preserved — macOS, Linux,
// and iOS-side display handle spaces in folder names fine. Soft guidance only
// (Q3=A): we don't enforce a sandbox boundary, just keep the path usable.
function sanitizeTaskName(input: string): string {
  return input
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^[.\-\s]+/, "")
    .replace(/[.\-\s]+$/, "")
    .slice(0, 120);
}

function joinPath(root: string, name: string): string {
  const trimmedRoot = root.replace(/\/+$/, "");
  return `${trimmedRoot}/${name}`;
}

type ProbeState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "result"; result: CheckPathResult };

export interface NewTaskModalProps {
  visible: boolean;
  onClose: () => void;
  serverId: string;
  defaultWorkspaceRoot: string;
}

export function NewTaskModal({
  visible,
  onClose,
  serverId,
  defaultWorkspaceRoot,
}: NewTaskModalProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const openProject = useOpenProject(serverId);
  const client = useHostRuntimeClient(serverId);

  const inputRef = useRef<TextInput>(null);
  const [taskName, setTaskName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [probe, setProbe] = useState<ProbeState>({ kind: "idle" });

  const sanitized = sanitizeTaskName(taskName);
  const previewPath = sanitized ? joinPath(defaultWorkspaceRoot, sanitized) : defaultWorkspaceRoot;

  // Debounced path check while user types. We only probe the *root*; whether
  // the leaf folder exists is irrelevant since we mkdir -p on submit.
  useEffect(() => {
    if (!visible || !client) return;
    setProbe({ kind: "checking" });
    const handle = setTimeout(() => {
      void client
        .checkPath(defaultWorkspaceRoot)
        .then((result) => setProbe({ kind: "result", result }))
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          setProbe({
            kind: "result",
            result: {
              requestId: "",
              path: defaultWorkspaceRoot,
              status: "error",
              error: msg,
            },
          });
        });
    }, CHECK_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [client, defaultWorkspaceRoot, visible]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setTaskName("");
    setErrorMessage("");
    setProbe({ kind: "idle" });
    inputRef.current?.clear();
    onClose();
  }, [isSaving, onClose]);

  const handleCreate = useCallback(async () => {
    if (isSaving || !client) return;
    const name = sanitizeTaskName(taskName);
    if (!name) {
      setErrorMessage(t("project.newTaskNameRequired"));
      return;
    }
    const fullPath = joinPath(defaultWorkspaceRoot, name);
    try {
      setIsSaving(true);
      setErrorMessage("");
      const result = await openProject(fullPath, { createIfMissing: true });
      if (!result) {
        // Hook returns boolean — surface daemon-side error via a follow-up
        // probe so the user sees something better than a generic message.
        const probeResult = await client.checkPath(fullPath).catch(() => null);
        const probeError = probeResult?.error ?? null;
        setErrorMessage(probeError ?? t("project.newTaskCreateFailed"));
        return;
      }
      handleClose();
    } catch (error) {
      const msg = error instanceof Error ? error.message : t("project.newTaskCreateFailed");
      setErrorMessage(msg);
    } finally {
      setIsSaving(false);
    }
  }, [client, defaultWorkspaceRoot, handleClose, isSaving, openProject, t, taskName]);

  const handleCreatePress = useCallback(() => {
    void handleCreate();
  }, [handleCreate]);

  const statusNode = useMemo(() => {
    if (probe.kind === "idle") return null;
    if (probe.kind === "checking") {
      return <Text style={styles.statusInfo}>{t("project.newTaskCheckingPath")}</Text>;
    }
    const { status, error } = probe.result;
    if (status === "ok") {
      return (
        <View style={styles.statusRow}>
          <Check size={14} color={theme.colors.accent} />
          <Text style={styles.statusOk}>{t("project.newTaskPathOk")}</Text>
        </View>
      );
    }
    if (status === "missing_will_create") {
      return (
        <View style={styles.statusRow}>
          <Sparkles size={14} color={theme.colors.foregroundMuted} />
          <Text style={styles.statusInfo}>{t("project.newTaskPathWillCreate")}</Text>
        </View>
      );
    }
    let fallbackMsg: string;
    if (status === "not_directory") {
      fallbackMsg = t("project.newTaskPathNotDirectory");
    } else if (status === "not_writable") {
      fallbackMsg = t("project.newTaskPathNotWritable");
    } else {
      fallbackMsg = error ?? t("project.newTaskPathError");
    }
    return (
      <View style={styles.statusRow}>
        <OctagonAlert size={14} color={theme.colors.destructive} />
        <Text style={styles.statusError}>{fallbackMsg}</Text>
      </View>
    );
  }, [probe, t, theme.colors.accent, theme.colors.destructive, theme.colors.foregroundMuted]);

  const blockedByProbe =
    probe.kind === "result" &&
    (probe.result.status === "not_directory" || probe.result.status === "not_writable");

  return (
    <AdaptiveModalSheet
      title={t("project.newTaskTitle")}
      visible={visible}
      onClose={handleClose}
      testID="new-task-modal"
    >
      <Text style={styles.helper}>{t("project.newTaskHelper")}</Text>

      <View style={styles.field}>
        <Text style={styles.label}>{t("project.newTaskNameLabel")}</Text>
        <AdaptiveTextInput
          ref={inputRef}
          testID="new-task-name-input"
          accessibilityLabel="new-task-name-input"
          value={taskName}
          onChangeText={setTaskName}
          placeholder={t("project.newTaskNamePlaceholder")}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={handleCreatePress}
        />
        <Text style={styles.preview} numberOfLines={2}>
          {previewPath}
        </Text>
        {statusNode}
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}
          variant="secondary"
          onPress={handleClose}
          disabled={isSaving}
          testID="new-task-cancel"
        >
          {t("common.cancel")}
        </Button>
        <Button
          style={FLEX_ONE_STYLE}
          variant="default"
          onPress={handleCreatePress}
          disabled={isSaving || sanitized.length === 0 || blockedByProbe}
          testID="new-task-submit"
          leftIcon={FolderPlus}
        >
          {isSaving ? t("project.newTaskCreating") : t("project.newTaskCreate")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}
