import { useCallback, useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import { AdaptiveModalSheet, AdaptiveTextInput } from "./adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";

const FLEX_ONE_STYLE = { flex: 1 } as const;

export interface WorkspaceRenameModalProps {
  visible: boolean;
  onClose: () => void;
  serverId: string;
  workspaceId: string;
  /** Original (daemon-derived) name shown in the helper line. */
  workspaceName: string;
  /** Current alias, if any — pre-fills the input. */
  currentAlias: string | null;
}

export function WorkspaceRenameModal({
  visible,
  onClose,
  serverId,
  workspaceId,
  workspaceName,
  currentAlias,
}: WorkspaceRenameModalProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const toast = useToast();
  const inputRef = useRef<TextInput>(null);
  const draftRef = useRef(currentAlias ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (visible) {
      draftRef.current = currentAlias ?? "";
      setErrorMessage("");
    }
  }, [visible, currentAlias]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    onClose();
  }, [isSaving, onClose]);

  const handleChange = useCallback((next: string) => {
    draftRef.current = next;
  }, []);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    const next = draftRef.current.trim();
    if (next.length > 200) {
      setErrorMessage(t("rename.tooLong"));
      return;
    }
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      setErrorMessage(t("rename.hostNotConnected"));
      return;
    }
    try {
      setIsSaving(true);
      setErrorMessage("");
      const payload = await client.setWorkspaceAlias(workspaceId, next);
      if (payload.error) {
        throw new Error(payload.error);
      }
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("rename.failed");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, onClose, serverId, t, toast, workspaceId]);

  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const handleSubmitEditing = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  return (
    <AdaptiveModalSheet
      title={t("rename.title")}
      visible={visible}
      onClose={handleClose}
      testID="workspace-rename-modal"
      desktopMaxWidth={420}
    >
      <Text style={styles.helper}>
        {t("rename.helper", { example: `${t("rename.exampleAlias")} (${workspaceName})` })}
      </Text>

      <View style={styles.field}>
        <Text style={styles.label}>{t("rename.label")}</Text>
        <AdaptiveTextInput
          ref={inputRef}
          testID="workspace-rename-input"
          defaultValue={currentAlias ?? ""}
          onChangeText={handleChange}
          placeholder={workspaceName}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSaving}
          returnKeyType="done"
          onSubmitEditing={handleSubmitEditing}
          maxLength={200}
        />
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}
          variant="secondary"
          onPress={handleClose}
          disabled={isSaving}
        >
          {t("rename.cancel")}
        </Button>
        <Button
          style={FLEX_ONE_STYLE}
          variant="default"
          onPress={handleSavePress}
          disabled={isSaving}
          testID="workspace-rename-submit"
        >
          {isSaving ? t("rename.saving") : t("rename.save")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
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
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  helper: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  helperEm: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  error: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
