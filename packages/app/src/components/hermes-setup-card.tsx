import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

export interface HermesSetupCardProps {
  onConfigured: () => void;
  configure: (args: {
    provider: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
  }) => Promise<void>;
}

interface Provider {
  id: string;
  hermesId?: string; // actual hermes provider ID when different from id
  label: string;
  envKey: string;
  models: { id: string; label: string }[];
  needsBaseUrl: boolean;
  needsApiKey: boolean;
  authHintKey?: string; // i18n key for no-key-needed hint
}

const CLI_PROVIDERS: Provider[] = [
  {
    id: "anthropic-cli",
    hermesId: "anthropic",
    label: "Claude Code",
    envKey: "",
    needsApiKey: false,
    needsBaseUrl: false,
    authHintKey: "hermes.setup.authHint.claudeCode",
    models: [
      { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "copilot-acp",
    label: "GitHub Copilot",
    envKey: "",
    needsApiKey: false,
    needsBaseUrl: false,
    authHintKey: "hermes.setup.authHint.copilotAcp",
    models: [{ id: "copilot-acp", label: "Copilot (auto)" }],
  },
  {
    id: "qwen-oauth",
    label: "Qwen (CLI)",
    envKey: "",
    needsApiKey: false,
    needsBaseUrl: false,
    authHintKey: "hermes.setup.authHint.qwenOauth",
    models: [],
  },
  {
    id: "ollama",
    label: "Ollama",
    envKey: "",
    needsApiKey: false,
    needsBaseUrl: true,
    models: [],
  },
];

const API_PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    needsApiKey: true,
    needsBaseUrl: false,
    models: [
      { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    needsApiKey: true,
    needsBaseUrl: false,
    models: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini" },
      { id: "o3", label: "o3" },
      { id: "o1", label: "o1" },
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    needsApiKey: true,
    needsBaseUrl: false,
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    needsApiKey: true,
    needsBaseUrl: false,
    models: [],
  },
];

const ALL_PROVIDERS = [...CLI_PROVIDERS, ...API_PROVIDERS];

function ProviderChip({
  provider,
  active,
  onSelect,
}: {
  provider: Provider;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const chipStyle = useMemo(
    () => [styles.providerChip, active ? styles.providerChipActive : null],
    [active],
  );
  const textStyle = useMemo(
    () => [styles.providerChipText, active ? styles.providerChipTextActive : null],
    [active],
  );
  const handlePress = useCallback(() => onSelect(provider.id), [onSelect, provider.id]);
  return (
    <Pressable onPress={handlePress} style={chipStyle} accessibilityRole="button">
      <Text style={textStyle}>{provider.label}</Text>
    </Pressable>
  );
}

function ModelChip({
  model,
  active,
  onSelect,
}: {
  model: { id: string; label: string };
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const chipStyle = useMemo(
    () => [styles.modelChip, active ? styles.modelChipActive : null],
    [active],
  );
  const textStyle = useMemo(
    () => [styles.modelChipText, active ? styles.modelChipTextActive : null],
    [active],
  );
  const handlePress = useCallback(() => onSelect(model.id), [onSelect, model.id]);
  return (
    <Pressable onPress={handlePress} style={chipStyle} accessibilityRole="button">
      <Text style={textStyle}>{model.label}</Text>
    </Pressable>
  );
}

function ModelSelector({
  provider,
  modelId,
  customModel,
  onSelectModel,
  onChangeCustomModel,
  placeholder,
  placeholderColor,
}: {
  provider: Provider;
  modelId: string;
  customModel: string;
  onSelectModel: (id: string) => void;
  onChangeCustomModel: (text: string) => void;
  placeholder: string;
  placeholderColor: string;
}) {
  if (provider.models.length > 0) {
    return (
      <View style={styles.chipRow}>
        {provider.models.map((m) => (
          <ModelChip key={m.id} model={m} active={m.id === modelId} onSelect={onSelectModel} />
        ))}
      </View>
    );
  }
  return (
    <TextInput
      value={customModel}
      onChangeText={onChangeCustomModel}
      placeholder={placeholder}
      placeholderTextColor={placeholderColor}
      style={styles.textInput}
      autoCapitalize="none"
      autoCorrect={false}
    />
  );
}

function CredentialSection({
  provider,
  apiKey,
  baseUrl,
  onChangeApiKey,
  onChangeBaseUrl,
  authHint,
  apiKeyPlaceholder,
  baseUrlLabel,
  envKeyLabel,
  placeholderColor,
}: {
  provider: Provider;
  apiKey: string;
  baseUrl: string;
  onChangeApiKey: (text: string) => void;
  onChangeBaseUrl: (text: string) => void;
  authHint: string;
  apiKeyPlaceholder: string;
  baseUrlLabel: string;
  envKeyLabel: string;
  placeholderColor: string;
}) {
  if (provider.needsBaseUrl) {
    return (
      <>
        <Text style={styles.label}>{baseUrlLabel}</Text>
        <TextInput
          value={baseUrl}
          onChangeText={onChangeBaseUrl}
          placeholder="http://localhost:11434/v1"
          placeholderTextColor={placeholderColor}
          style={styles.textInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </>
    );
  }
  if (!provider.needsApiKey) {
    return <Text style={styles.authHint}>{authHint}</Text>;
  }
  return (
    <>
      <Text style={styles.label}>{envKeyLabel}</Text>
      <TextInput
        value={apiKey}
        onChangeText={onChangeApiKey}
        placeholder={apiKeyPlaceholder}
        placeholderTextColor={placeholderColor}
        style={styles.textInput}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
    </>
  );
}

export function HermesSetupCard({ onConfigured, configure }: HermesSetupCardProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();

  const [providerId, setProviderId] = useState<string>("anthropic-cli");
  const [modelId, setModelId] = useState<string>("claude-sonnet-4-6");
  const [customModel, setCustomModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434/v1");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = useMemo(
    () => ALL_PROVIDERS.find((p) => p.id === providerId) ?? ALL_PROVIDERS[0],
    [providerId],
  );

  const handleSelectProvider = useCallback((id: string) => {
    setProviderId(id);
    const p = ALL_PROVIDERS.find((x) => x.id === id);
    if (p?.models[0]) setModelId(p.models[0].id);
    else setModelId("");
    setCustomModel("");
    setApiKey("");
    setError(null);
  }, []);

  const handleSelectModel = useCallback((id: string) => {
    setModelId(id);
    setCustomModel("");
  }, []);

  const effectiveModel = provider.models.length > 0 ? modelId : customModel.trim();
  const canSave =
    effectiveModel.length > 0 && (!provider.needsApiKey || apiKey.trim().length > 0) && !isSaving;

  const saveButtonStyle = useMemo(
    () => [styles.saveButton, !canSave ? styles.saveButtonDisabled : null],
    [canSave],
  );

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setIsSaving(true);
    setError(null);
    try {
      await configure({
        provider: provider.hermesId ?? provider.id,
        model: effectiveModel,
        apiKey: apiKey.trim(),
        baseUrl: provider.needsBaseUrl ? baseUrl.trim() : undefined,
      });
      onConfigured();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }, [canSave, configure, provider, effectiveModel, apiKey, baseUrl, onConfigured]);

  const authHint = provider.authHintKey ? t(provider.authHintKey) : "";

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("hermes.setup.title")}</Text>
      <Text style={styles.hint}>{t("hermes.setup.hint")}</Text>

      <Text style={styles.sectionLabel}>{t("hermes.setup.cliSection")}</Text>
      <View style={styles.chipRow}>
        {CLI_PROVIDERS.map((p) => (
          <ProviderChip
            key={p.id}
            provider={p}
            active={p.id === providerId}
            onSelect={handleSelectProvider}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>{t("hermes.setup.apiSection")}</Text>
      <View style={styles.chipRow}>
        {API_PROVIDERS.map((p) => (
          <ProviderChip
            key={p.id}
            provider={p}
            active={p.id === providerId}
            onSelect={handleSelectProvider}
          />
        ))}
      </View>

      <Text style={styles.label}>{t("hermes.setup.modelLabel")}</Text>
      <ModelSelector
        provider={provider}
        modelId={modelId}
        customModel={customModel}
        onSelectModel={handleSelectModel}
        onChangeCustomModel={setCustomModel}
        placeholder={t("hermes.setup.modelPlaceholder")}
        placeholderColor={theme.colors.foregroundMuted}
      />

      <CredentialSection
        provider={provider}
        apiKey={apiKey}
        baseUrl={baseUrl}
        onChangeApiKey={setApiKey}
        onChangeBaseUrl={setBaseUrl}
        authHint={authHint}
        apiKeyPlaceholder={t("hermes.setup.apiKeyPlaceholder")}
        baseUrlLabel={t("hermes.setup.baseUrlLabel")}
        envKeyLabel={provider.envKey}
        placeholderColor={theme.colors.foregroundMuted}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        onPress={handleSave}
        disabled={!canSave}
        style={saveButtonStyle}
        accessibilityRole="button"
      >
        {isSaving ? (
          <ActivityIndicator size="small" color={theme.colors.accentForeground} />
        ) : (
          <Text style={styles.saveButtonText}>{t("hermes.setup.save")}</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  title: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  hint: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    lineHeight: 20,
  },
  sectionLabel: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: theme.spacing[1],
  },
  label: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.medium,
    marginTop: theme.spacing[1],
  },
  authHint: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    lineHeight: 20,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  providerChip: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  providerChipActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  providerChipText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  providerChipTextActive: {
    color: theme.colors.accentForeground,
  },
  modelChip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    borderCurve: "continuous",
    backgroundColor: theme.colors.surface2,
  },
  modelChipActive: {
    backgroundColor: theme.colors.accent,
  },
  modelChipText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  modelChipTextActive: {
    color: theme.colors.accentForeground,
    fontWeight: theme.fontWeight.medium,
  },
  textInput: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  errorText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.destructive,
  },
  saveButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    backgroundColor: theme.colors.accent,
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
    marginTop: theme.spacing[2],
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.accentForeground,
  },
}));
