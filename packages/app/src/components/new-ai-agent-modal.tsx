import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronDown, X } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { useAiAgentsUiStore } from "@/stores/ai-agents-ui-store";
import { useAiAgentsStore, type AiAgentRuntime } from "@/stores/ai-agents-store";

// Modal-mounted form for creating a new "conversation AI Agent". Captures
// the four MVP fields agreed in design (name + description + runtime +
// model) plus an optional system prompt. Saves to `useAiAgentsStore`.
//
// Runtime list is currently the static set of providers Ottie supports
// (Claude Code / Codex / OpenCode). Dynamic detection — only showing
// runtimes whose CLI is actually installed — is a follow-up; for the
// sidebar redesign MVP the form lets the user pick anything and the
// chat backend (deferred phase) will surface unavailability.

interface RuntimeOption {
  id: AiAgentRuntime;
  labelKey: string;
  defaultModel: string;
  modelHintKey: string;
}

// Order mirrors the daemon's AGENT_PROVIDER_DEFINITIONS so the picker
// matches the canonical provider list. Each option carries a sensible
// default model — the user can edit before submit.
const RUNTIME_OPTIONS: ReadonlyArray<RuntimeOption> = [
  {
    id: "claude",
    labelKey: "newAiAgent.runtime.claude",
    defaultModel: "claude-sonnet-4-6",
    modelHintKey: "newAiAgent.modelHint.claude",
  },
  {
    id: "codex",
    labelKey: "newAiAgent.runtime.codex",
    defaultModel: "gpt-5",
    modelHintKey: "newAiAgent.modelHint.codex",
  },
  {
    id: "copilot",
    labelKey: "newAiAgent.runtime.copilot",
    defaultModel: "gpt-4.1",
    modelHintKey: "newAiAgent.modelHint.copilot",
  },
  {
    id: "opencode",
    labelKey: "newAiAgent.runtime.opencode",
    defaultModel: "claude-sonnet-4-6",
    modelHintKey: "newAiAgent.modelHint.opencode",
  },
  {
    id: "gemini",
    labelKey: "newAiAgent.runtime.gemini",
    defaultModel: "gemini-2.5-pro",
    modelHintKey: "newAiAgent.modelHint.gemini",
  },
  {
    id: "pi",
    labelKey: "newAiAgent.runtime.pi",
    defaultModel: "",
    modelHintKey: "newAiAgent.modelHint.pi",
  },
];

export function NewAiAgentModal() {
  const open = useAiAgentsUiStore((s) => s.createModalOpen);
  const editingAgentId = useAiAgentsUiStore((s) => s.editingAgentId);
  const close = useAiAgentsUiStore((s) => s.closeCreateModal);
  const create = useAiAgentsStore((s) => s.create);
  const update = useAiAgentsStore((s) => s.update);
  const existingAgent = useAiAgentsStore((s) =>
    editingAgentId ? (s.agents.find((a) => a.id === editingAgentId) ?? null) : null,
  );

  const handleCreate = useCallback(
    (draft: {
      name: string;
      description: string;
      runtime: AiAgentRuntime;
      model: string;
      systemPrompt: string;
    }) => {
      create(draft);
      close();
    },
    [close, create],
  );

  const handleUpdate = useCallback(
    (
      id: string,
      patch: {
        name: string;
        description: string;
        runtime: AiAgentRuntime;
        model: string;
        systemPrompt: string;
      },
    ) => {
      update(id, patch);
      close();
    },
    [close, update],
  );

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <NewAiAgentForm
        existingId={editingAgentId}
        existingValues={existingAgent}
        onCancel={close}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
      />
    </Modal>
  );
}

interface NewAiAgentFormProps {
  existingId: string | null;
  existingValues: {
    name: string;
    description: string;
    runtime: AiAgentRuntime;
    model: string;
    systemPrompt: string;
  } | null;
  onCancel: () => void;
  onCreate: (draft: {
    name: string;
    description: string;
    runtime: AiAgentRuntime;
    model: string;
    systemPrompt: string;
  }) => void;
  onUpdate: (
    id: string,
    patch: {
      name: string;
      description: string;
      runtime: AiAgentRuntime;
      model: string;
      systemPrompt: string;
    },
  ) => void;
}

function NewAiAgentForm({
  existingId,
  existingValues,
  onCancel,
  onCreate,
  onUpdate,
}: NewAiAgentFormProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [runtime, setRuntime] = useState<AiAgentRuntime>(RUNTIME_OPTIONS[0]!.id);
  const [model, setModel] = useState(RUNTIME_OPTIONS[0]!.defaultModel);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [runtimePickerOpen, setRuntimePickerOpen] = useState(false);

  // Reset form when modal opens (or switches between create/edit). The
  // useEffect on existingId pull the existing values into the local state
  // when editing, or clears them when creating.
  useEffect(() => {
    if (existingValues) {
      setName(existingValues.name);
      setDescription(existingValues.description);
      setRuntime(existingValues.runtime);
      setModel(existingValues.model);
      setSystemPrompt(existingValues.systemPrompt);
    } else {
      setName("");
      setDescription("");
      setRuntime(RUNTIME_OPTIONS[0]!.id);
      setModel(RUNTIME_OPTIONS[0]!.defaultModel);
      setSystemPrompt("");
    }
  }, [existingValues]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && trimmedName.length <= 64;

  const selectedRuntime = RUNTIME_OPTIONS.find((opt) => opt.id === runtime) ?? RUNTIME_OPTIONS[0]!;

  const handleRuntimeSelect = useCallback((next: AiAgentRuntime) => {
    setRuntime(next);
    setRuntimePickerOpen(false);
    const opt = RUNTIME_OPTIONS.find((o) => o.id === next);
    if (opt) {
      setModel(opt.defaultModel);
    }
  }, []);

  const handleToggleRuntimePicker = useCallback(() => {
    setRuntimePickerOpen((prev) => !prev);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    const draft = {
      name: trimmedName,
      description: description.trim(),
      runtime,
      model: model.trim() || selectedRuntime.defaultModel,
      systemPrompt: systemPrompt.trim(),
    };
    if (existingId) {
      onUpdate(existingId, draft);
    } else {
      onCreate(draft);
    }
  }, [
    canSubmit,
    description,
    existingId,
    model,
    onCreate,
    onUpdate,
    runtime,
    selectedRuntime.defaultModel,
    systemPrompt,
    trimmedName,
  ]);

  const submitButtonStyle = useMemo(
    () => ({ backgroundColor: theme.colors.foreground, borderColor: theme.colors.foreground }),
    [theme.colors.foreground],
  );
  const submitTextStyle = useMemo(
    () => ({ color: theme.colors.surface0 }),
    [theme.colors.surface0],
  );

  return (
    <View style={styles.root}>
      <Pressable style={styles.backdrop} onPress={onCancel} testID="new-ai-agent-backdrop" />
      <View style={styles.cardOuter} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {existingId ? t("newAiAgent.editTitle") : t("newAiAgent.title")}
            </Text>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel={t("newAiAgent.cancel")}
              style={styles.closeButton}
            >
              <X size={18} color={theme.colors.foregroundMuted} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Field label={t("newAiAgent.name")}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder={t("newAiAgent.namePlaceholder")}
                placeholderTextColor={theme.colors.foregroundMuted}
                autoFocus
                maxLength={64}
                testID="new-ai-agent-name"
              />
            </Field>

            <Field label={t("newAiAgent.description")} hint={t("newAiAgent.descriptionHint")}>
              <TextInput
                style={styles.input}
                value={description}
                onChangeText={setDescription}
                placeholder={t("newAiAgent.descriptionPlaceholder")}
                placeholderTextColor={theme.colors.foregroundMuted}
                maxLength={140}
              />
            </Field>

            <Field label={t("newAiAgent.runtime.label")}>
              <Pressable
                onPress={handleToggleRuntimePicker}
                style={styles.dropdownTrigger}
                accessibilityRole="button"
              >
                <Text style={styles.dropdownLabel}>{t(selectedRuntime.labelKey)}</Text>
                <ChevronDown size={16} color={theme.colors.foregroundMuted} />
              </Pressable>
              {runtimePickerOpen ? (
                <View style={styles.dropdownPanel}>
                  {RUNTIME_OPTIONS.map((opt) => (
                    <RuntimeOptionRow
                      key={opt.id}
                      option={opt}
                      selected={opt.id === runtime}
                      onSelect={handleRuntimeSelect}
                    />
                  ))}
                </View>
              ) : null}
            </Field>

            <Field label={t("newAiAgent.model")} hint={t(selectedRuntime.modelHintKey)}>
              <TextInput
                style={styles.input}
                value={model}
                onChangeText={setModel}
                placeholder={selectedRuntime.defaultModel}
                placeholderTextColor={theme.colors.foregroundMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </Field>

            <Field label={t("newAiAgent.systemPrompt")} hint={t("newAiAgent.systemPromptHint")}>
              <TextInput
                style={styles.textarea}
                value={systemPrompt}
                onChangeText={setSystemPrompt}
                placeholder={t("newAiAgent.systemPromptPlaceholder")}
                placeholderTextColor={theme.colors.foregroundMuted}
                multiline
                textAlignVertical="top"
              />
            </Field>
          </ScrollView>

          <View style={styles.actions}>
            <Button variant="ghost" size="md" onPress={onCancel}>
              {t("newAiAgent.cancel")}
            </Button>
            <Button
              testID="new-ai-agent-submit"
              variant="default"
              size="lg"
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={submitButtonStyle}
              textStyle={submitTextStyle}
            >
              {existingId ? t("newAiAgent.save") : t("newAiAgent.create")}
            </Button>
          </View>
        </View>
      </View>
    </View>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

function RuntimeOptionRow({
  option,
  selected,
  onSelect,
}: {
  option: RuntimeOption;
  selected: boolean;
  onSelect: (next: AiAgentRuntime) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    onSelect(option.id);
  }, [onSelect, option.id]);
  const rowStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.dropdownRow,
      hovered ? styles.dropdownRowHovered : null,
      selected ? styles.dropdownRowSelected : null,
    ],
    [selected],
  );
  return (
    <Pressable onPress={handlePress} style={rowStyle} accessibilityRole="menuitem">
      <Text style={styles.dropdownLabel}>{t(option.labelKey)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  backdrop: {
    ...({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const),
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  cardOuter: {
    width: "100%",
    maxWidth: 520,
    paddingHorizontal: theme.spacing[6],
  },
  card: {
    backgroundColor: theme.colors.surface0,
    borderRadius: theme.borderRadius.card,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
    maxHeight: 640,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  closeButton: {
    padding: theme.spacing[1],
  },
  scrollContent: {
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[4],
    gap: theme.spacing[4],
  },
  field: {
    gap: theme.spacing[1.5],
  },
  fieldLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  fieldHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  input: {
    fontFamily: theme.fontFamily.system,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.field,
    borderCurve: "continuous",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  textarea: {
    fontFamily: theme.fontFamily.system,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.field,
    borderCurve: "continuous",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    borderWidth: 1,
    borderColor: theme.colors.border,
    minHeight: 96,
  },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.field,
    borderCurve: "continuous",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    minHeight: 44,
  },
  dropdownLabel: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  dropdownPanel: {
    marginTop: theme.spacing[1],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.field,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  dropdownRow: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  dropdownRowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  dropdownRowSelected: {
    backgroundColor: theme.colors.surface2,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
}));
