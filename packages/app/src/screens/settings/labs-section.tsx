import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronDown, Mic } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type AppSettings,
  type VoiceControlSettings,
  type VoiceIntentProvider,
  useAppSettings,
} from "@/hooks/use-settings";
import { isWeb } from "@/constants/platform";
import { formatHotkeyLabel, serializeHotkeyFromKeyboardEvent } from "@/voice-control/hotkey-format";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import type { AgentProvider } from "@server/server/agent/agent-sdk-types";
import { voiceController } from "@/voice-control/voice-controller";
import { useSessionStore } from "@/stores/session-store";

type ToggleValue = "off" | "on";

const ON_OFF_OPTIONS: { value: ToggleValue; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
];

const toToggleValue = (enabled: boolean): ToggleValue => (enabled ? "on" : "off");

/**
 * Labs settings section. Houses opt-in beta features. Currently exposes:
 *   - Voice Control · Beta master toggle
 *   - Push-to-talk hotkey picker (web/desktop)
 *   - Floating mic orb visibility (mobile)
 *
 * Adding a future beta? Wrap a new card in <SettingsSection> below the voice
 * card and gate it behind its own settings.betaFeatures.<feature> field.
 */
export function LabsSection() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { settings, updateSettings } = useAppSettings();
  const voice = settings.betaFeatures.voiceControl;

  const updateVoice = useCallback(
    (patch: Partial<VoiceControlSettings>) => {
      const next: AppSettings["betaFeatures"] = {
        ...settings.betaFeatures,
        voiceControl: { ...voice, ...patch },
      };
      void updateSettings({ betaFeatures: next });
    },
    [settings.betaFeatures, voice, updateSettings],
  );

  const handleEnableChange = useCallback(
    (value: ToggleValue) => updateVoice({ enabled: value === "on" }),
    [updateVoice],
  );
  const handleOrbChange = useCallback(
    (value: ToggleValue) => updateVoice({ showFloatingOrb: value === "on" }),
    [updateVoice],
  );
  const handleHotkeyChange = useCallback(
    (next: string | null) => updateVoice({ pushToTalkHotkey: next }),
    [updateVoice],
  );
  const handleIntentProviderChange = useCallback(
    (next: VoiceIntentProvider) => {
      // Switching providers invalidates the previously-picked model id —
      // reset to "default for this provider" so we don't carry a Claude
      // model id over into a Codex selection.
      updateVoice({ intentProvider: next, intentModelId: null });
    },
    [updateVoice],
  );
  const handleIntentModelChange = useCallback(
    (modelId: string | null) => updateVoice({ intentModelId: modelId }),
    [updateVoice],
  );

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const openPicker = useCallback(() => setIsPickerOpen(true), []);
  const closePicker = useCallback(() => setIsPickerOpen(false), []);
  const handlePickerSelect = useCallback(
    (hk: string) => {
      handleHotkeyChange(hk);
      closePicker();
    },
    [handleHotkeyChange, closePicker],
  );
  const handlePickerClear = useCallback(() => {
    handleHotkeyChange(null);
    closePicker();
  }, [handleHotkeyChange, closePicker]);

  const hotkeyChipStyle = useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
      styles.hotkeyChip,
      (Boolean(hovered) || Boolean(pressed)) && styles.hotkeyChipActive,
      !voice.enabled && styles.hotkeyChipDisabled,
    ],
    [voice.enabled],
  );

  const hotkeyLabel = voice.pushToTalkHotkey
    ? formatHotkeyLabel(voice.pushToTalkHotkey)
    : t("settings.labsVoice.hotkeyUnset", { defaultValue: "Not set" });

  return (
    <SettingsSection title={t("settings.labs", { defaultValue: "Labs" })}>
      <View style={settingsStyles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderIcon}>
            <Mic size={theme.iconSize.md} color={theme.colors.foreground} />
          </View>
          <View style={styles.cardHeaderText}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>
                {t("settings.labsVoice.title", { defaultValue: "Voice Control" })}
              </Text>
              <View style={styles.betaPill}>
                <Text style={styles.betaPillText}>BETA</Text>
              </View>
            </View>
            <Text style={settingsStyles.rowHint}>
              {t("settings.labsVoice.description", {
                defaultValue:
                  "Hold a hotkey to speak. Ottie parses your intent and runs commands across the app.",
              })}
            </Text>
          </View>
        </View>

        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.labsVoice.enable", { defaultValue: "Enable voice control" })}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.labsVoice.enableHint", {
                defaultValue: "Master switch for the entire feature.",
              })}
            </Text>
          </View>
          <SegmentedControl
            size="sm"
            value={toToggleValue(voice.enabled)}
            onValueChange={handleEnableChange}
            options={ON_OFF_OPTIONS}
          />
        </View>

        {isWeb ? (
          <View style={ROW_WITH_BORDER_STYLE}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.labsVoice.hotkey", { defaultValue: "Push-to-talk hotkey" })}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.labsVoice.hotkeyHint", {
                  defaultValue: "Hold this key combo to speak. Release to execute.",
                })}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              style={hotkeyChipStyle}
              onPress={openPicker}
              disabled={!voice.enabled}
            >
              <Text style={styles.hotkeyChipText}>{hotkeyLabel}</Text>
            </Pressable>
          </View>
        ) : null}

        {!isWeb ? (
          <View style={ROW_WITH_BORDER_STYLE}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.labsVoice.floatingOrb", {
                  defaultValue: "Floating mic orb",
                })}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.labsVoice.floatingOrbHint", {
                  defaultValue:
                    "Always-on draggable mic button. Long-press to talk, release to execute.",
                })}
              </Text>
            </View>
            <SegmentedControl
              size="sm"
              value={toToggleValue(voice.showFloatingOrb)}
              onValueChange={handleOrbChange}
              options={ON_OFF_OPTIONS}
            />
          </View>
        ) : null}

        <IntentProviderRow
          provider={voice.intentProvider}
          enabled={voice.enabled}
          onChange={handleIntentProviderChange}
        />

        {voice.intentProvider !== "heuristic" ? (
          <IntentModelRow
            provider={voice.intentProvider}
            modelId={voice.intentModelId}
            enabled={voice.enabled}
            onChange={handleIntentModelChange}
          />
        ) : null}

        <QuickTestRow enabled={voice.enabled} />
        <DiagnosticsRow />
      </View>

      {isPickerOpen ? (
        <HotkeyPickerModal
          currentHotkey={voice.pushToTalkHotkey}
          onCancel={closePicker}
          onSelect={handlePickerSelect}
          onClear={handlePickerClear}
        />
      ) : null}
    </SettingsSection>
  );
}

// Stable composite style — labs section reuses the same shared row+border
// pair the existing settings sections use. Keeping it module-scope avoids
// rebuilding the array on every render.
const ROW_WITH_BORDER_STYLE = [settingsStyles.row, settingsStyles.rowBorder];
const QUICK_TEST_ROW_STYLE = [
  settingsStyles.row,
  settingsStyles.rowBorder,
  { flexDirection: "column" as const, alignItems: "stretch" as const },
];

// ---------------------------------------------------------------------------
// Quick test buttons — fire commands directly without speech, useful for
// validating that handlers + bridge + ghost cursor work end-to-end without
// needing to speak each time.
// ---------------------------------------------------------------------------

interface QuickTestSpec {
  commandName: string;
  label: string;
}

const QUICK_TEST_COMMANDS: QuickTestSpec[] = [
  { commandName: "open_file_explorer", label: "Open files" },
  { commandName: "close_file_explorer", label: "Close files" },
  { commandName: "toggle_focus_mode", label: "Toggle focus" },
  { commandName: "list_agents", label: "List agents" },
  { commandName: "open_settings", label: "Open settings" },
  { commandName: "interrupt_active_agent", label: "Interrupt agent" },
];

interface QuickTestRowProps {
  enabled: boolean;
}

function QuickTestRow({ enabled }: QuickTestRowProps) {
  return (
    <View style={QUICK_TEST_ROW_STYLE}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Quick test</Text>
        <Text style={settingsStyles.rowHint}>
          Click a button to fire a command directly — same flow as voice (countdown, ghost cursor,
          handler) without needing to speak.
        </Text>
        <View style={styles.quickTestButtons}>
          {QUICK_TEST_COMMANDS.map((spec) => (
            <QuickTestButton key={spec.commandName} spec={spec} enabled={enabled} />
          ))}
        </View>
      </View>
    </View>
  );
}

interface QuickTestButtonProps {
  spec: QuickTestSpec;
  enabled: boolean;
}

function QuickTestButton({ spec, enabled }: QuickTestButtonProps) {
  const handlePress = useCallback(() => {
    voiceController.testRun(spec.commandName);
  }, [spec.commandName]);

  const buttonStyle = useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
      styles.quickTestButton,
      (Boolean(hovered) || Boolean(pressed)) && styles.quickTestButtonActive,
      !enabled && styles.quickTestButtonDisabled,
    ],
    [enabled],
  );

  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      disabled={!enabled}
      style={buttonStyle}
    >
      <Text style={styles.quickTestButtonText}>{spec.label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Diagnostics — show the current voiceIntentRouting feature flag from
// daemon's serverInfo so the user can self-verify whether they're talking
// to a daemon that supports AI routing.
// ---------------------------------------------------------------------------

interface DiagnosticLine {
  label: string;
  tone: "ok" | "warn" | "muted";
}

function DiagnosticsRow() {
  const hosts = useHosts();
  const probeServerId = hosts[0]?.serverId ?? null;
  const isConnected = useHostRuntimeIsConnected(probeServerId ?? "");
  const features = useSessionStore(
    (state) => (probeServerId ? state.sessions[probeServerId]?.serverInfo?.features : null) ?? null,
  );

  const lines = useMemo<DiagnosticLine[]>(() => {
    if (!probeServerId) {
      return [{ label: "No host registered — open 'Add host' in settings", tone: "warn" }];
    }
    const out: DiagnosticLine[] = [];
    out.push({
      label: isConnected ? "Connection: ✓ online" : "Connection: ✗ offline (daemon unreachable)",
      tone: isConnected ? "ok" : "warn",
    });
    if (!isConnected) {
      out.push({
        label:
          "Likely cause: daemon not running OR host record points to stale port — try 'Add host' to re-discover.",
        tone: "muted",
      });
      return out;
    }
    if (!features) {
      out.push({ label: "Server info: ⏳ handshake pending", tone: "muted" });
      return out;
    }
    out.push({ label: "Server info: ✓ received", tone: "ok" });
    if (features.voiceIntentRouting === true) {
      out.push({ label: "AI routing: ✓ supported · ready", tone: "ok" });
    } else {
      out.push({
        label: "AI routing: ✗ not advertised — daemon is old, rebuild & restart",
        tone: "warn",
      });
    }
    return out;
  }, [probeServerId, isConnected, features]);

  return (
    <View style={ROW_WITH_BORDER_STYLE}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Diagnostics</Text>
        {lines.map((line) => (
          <DiagnosticLineText key={line.label} line={line} />
        ))}
        {probeServerId ? (
          <Text style={styles.diagnosticServerId} numberOfLines={1}>
            host: {probeServerId}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function DiagnosticLineText({ line }: { line: DiagnosticLine }) {
  const lineStyle = useMemo(() => {
    if (line.tone === "ok") return [settingsStyles.rowHint, styles.diagnosticOk];
    if (line.tone === "warn") return [settingsStyles.rowHint, styles.diagnosticWarn];
    return settingsStyles.rowHint;
  }, [line.tone]);
  return <Text style={lineStyle}>{line.label}</Text>;
}

// ---------------------------------------------------------------------------
// Intent provider + model selection rows
// ---------------------------------------------------------------------------

const INTENT_PROVIDER_OPTIONS: { id: VoiceIntentProvider; label: string; hint: string }[] = [
  {
    id: "heuristic",
    label: "Heuristic (no AI)",
    hint: "Local matcher. Fast, free, basic commands only.",
  },
  {
    id: "claude",
    label: "Claude",
    hint: "Use your Anthropic key — best for natural language.",
  },
  {
    id: "codex",
    label: "Codex (GPT)",
    hint: "Use your OpenAI key for routing.",
  },
  {
    id: "opencode",
    label: "OpenCode",
    hint: "Use your OpenCode setup for routing.",
  },
];

interface IntentProviderRowProps {
  provider: VoiceIntentProvider;
  enabled: boolean;
  onChange: (next: VoiceIntentProvider) => void;
}

function IntentProviderRow({ provider, enabled, onChange }: IntentProviderRowProps) {
  const { theme } = useUnistyles();
  const selected = INTENT_PROVIDER_OPTIONS.find((opt) => opt.id === provider);

  const triggerStyle = useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
      styles.dropdownTrigger,
      (Boolean(hovered) || Boolean(pressed)) && styles.dropdownTriggerActive,
      !enabled && styles.dropdownTriggerDisabled,
    ],
    [enabled],
  );

  return (
    <View style={ROW_WITH_BORDER_STYLE}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Intent routing</Text>
        <Text style={settingsStyles.rowHint}>
          {selected?.hint ?? "Decide which AI parses your speech into commands."}
        </Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          accessibilityRole="button"
          accessibilityLabel="Intent provider"
          disabled={!enabled}
          style={triggerStyle}
        >
          <Text style={styles.dropdownTriggerText}>{selected?.label ?? "Heuristic"}</Text>
          <ChevronDown size={14} color={theme.colors.foregroundMuted} />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {INTENT_PROVIDER_OPTIONS.map((opt) => (
            <IntentProviderItem
              key={opt.id}
              option={opt}
              selected={opt.id === provider}
              onSelect={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

interface IntentProviderItemProps {
  option: { id: VoiceIntentProvider; label: string };
  selected: boolean;
  onSelect: (id: VoiceIntentProvider) => void;
}

function IntentProviderItem({ option, selected, onSelect }: IntentProviderItemProps) {
  const handleSelect = useCallback(() => onSelect(option.id), [option.id, onSelect]);
  const itemTextStyle = useMemo(
    () => [styles.dropdownItemText, selected && styles.dropdownItemTextSelected],
    [selected],
  );
  return (
    <DropdownMenuItem onSelect={handleSelect}>
      <Text style={itemTextStyle}>{option.label}</Text>
    </DropdownMenuItem>
  );
}

interface IntentModelRowProps {
  provider: Exclude<VoiceIntentProvider, "heuristic">;
  modelId: string | null;
  enabled: boolean;
  onChange: (modelId: string | null) => void;
}

/**
 * Lists models available for the selected provider, populated by
 * {@link useProvidersSnapshot} for the first connected host. The user's API
 * key on different servers usually exposes the same models, so showing one
 * host's snapshot here is fine — pick "default" if the user wants to defer
 * the choice to whatever the daemon decides at routing time.
 */
function IntentModelRow({ provider, modelId, enabled, onChange }: IntentModelRowProps) {
  const { theme } = useUnistyles();
  const hosts = useHosts();
  // Use the first host's snapshot as the canonical model list. If the user
  // has multiple hosts with different model availability, they can still
  // switch via "Default" which lets the daemon pick at routing time.
  const probeServerId = hosts[0]?.serverId ?? null;
  const snapshot = useProvidersSnapshot(probeServerId);
  const matchingProvider: AgentProvider = provider;

  const models = useMemo(() => {
    const entry = snapshot.entries?.find((e) => e.provider === matchingProvider);
    return entry?.models ?? [];
  }, [snapshot.entries, matchingProvider]);

  const selectedModel = models.find((m) => m.id === modelId);
  const triggerLabel = selectedModel?.label ?? (modelId === null ? "Default model" : modelId);

  const handleClearSelection = useCallback(() => onChange(null), [onChange]);

  const triggerStyle = useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
      styles.dropdownTrigger,
      (Boolean(hovered) || Boolean(pressed)) && styles.dropdownTriggerActive,
      !enabled && styles.dropdownTriggerDisabled,
    ],
    [enabled],
  );
  const defaultItemStyle = useMemo(
    () => [styles.dropdownItemText, modelId === null && styles.dropdownItemTextSelected],
    [modelId],
  );

  return (
    <View style={ROW_WITH_BORDER_STYLE}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Routing model</Text>
        <Text style={settingsStyles.rowHint}>
          {models.length === 0
            ? "Connect a host to load available models."
            : `${models.length} model${models.length === 1 ? "" : "s"} available — Haiku/Sonnet are faster, Opus is most accurate.`}
        </Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          accessibilityRole="button"
          accessibilityLabel="Routing model"
          disabled={!enabled}
          style={triggerStyle}
        >
          <Text style={styles.dropdownTriggerText} numberOfLines={1}>
            {triggerLabel}
          </Text>
          <ChevronDown size={14} color={theme.colors.foregroundMuted} />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={handleClearSelection}>
            <Text style={defaultItemStyle}>Default model</Text>
          </DropdownMenuItem>
          {models.map((model) => (
            <IntentModelItem
              key={model.id}
              modelId={model.id}
              label={model.label}
              description={model.description}
              selected={model.id === modelId}
              onSelect={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

interface IntentModelItemProps {
  modelId: string;
  label: string;
  description?: string;
  selected: boolean;
  onSelect: (modelId: string) => void;
}

function IntentModelItem({
  modelId,
  label,
  description,
  selected,
  onSelect,
}: IntentModelItemProps) {
  const handleSelect = useCallback(() => onSelect(modelId), [modelId, onSelect]);
  const labelStyle = useMemo(
    () => [styles.dropdownItemLabel, selected && styles.dropdownItemTextSelected],
    [selected],
  );
  return (
    <DropdownMenuItem onSelect={handleSelect}>
      <View style={styles.dropdownItemColumn}>
        <Text style={labelStyle}>{label}</Text>
        {description ? (
          <Text style={styles.dropdownItemDescription} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
    </DropdownMenuItem>
  );
}

// ---------------------------------------------------------------------------

interface HotkeyPickerModalProps {
  currentHotkey: string | null;
  onSelect: (hotkey: string) => void;
  onClear: () => void;
  onCancel: () => void;
}

/**
 * Web-only hotkey capture modal. Listens for the next key combo (modifier +
 * non-modifier) and serializes it via {@link serializeHotkeyFromKeyboardEvent}.
 * On native we don't render this — the orb replaces the hotkey.
 */
function HotkeyPickerModal({ currentHotkey, onSelect, onClear, onCancel }: HotkeyPickerModalProps) {
  const [captured, setCaptured] = useState<string | null>(null);

  useEffect(() => {
    if (!isWeb || typeof document === "undefined") {
      return;
    }
    const handler = (event: KeyboardEvent) => {
      // Ignore modifier-only presses; wait for the actual key.
      if (
        event.key === "Meta" ||
        event.key === "Shift" ||
        event.key === "Control" ||
        event.key === "Alt"
      ) {
        return;
      }
      // Escape cancels the picker.
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      const serialized = serializeHotkeyFromKeyboardEvent(event);
      if (serialized) {
        event.preventDefault();
        event.stopPropagation();
        setCaptured(serialized);
      }
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () => {
      document.removeEventListener("keydown", handler, { capture: true });
    };
  }, [onCancel]);

  const handleConfirm = useCallback(() => {
    if (captured) {
      onSelect(captured);
    }
  }, [captured, onSelect]);

  const previewLabel = useMemo(() => {
    if (captured) return formatHotkeyLabel(captured);
    if (currentHotkey) return formatHotkeyLabel(currentHotkey);
    return "—";
  }, [captured, currentHotkey]);

  const saveButtonStyle = useMemo(
    () => [styles.modalActionPrimary, !captured && styles.modalActionDisabled],
    [captured],
  );

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Set push-to-talk hotkey</Text>
          <Text style={styles.modalHint}>Press the key combo you want to use. Esc to cancel.</Text>
          <View style={styles.modalPreview}>
            <Text style={styles.modalPreviewText}>{previewLabel}</Text>
          </View>
          <View style={styles.modalActions}>
            <Pressable style={styles.modalActionGhost} onPress={onClear}>
              <Text style={styles.modalActionGhostText}>Clear</Text>
            </Pressable>
            <Pressable style={styles.modalActionGhost} onPress={onCancel}>
              <Text style={styles.modalActionGhostText}>Cancel</Text>
            </Pressable>
            <Pressable style={saveButtonStyle} onPress={handleConfirm} disabled={!captured}>
              <Text style={styles.modalActionPrimaryText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  cardHeader: {
    flexDirection: "row",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  cardHeaderIcon: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  cardHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginBottom: 2,
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  betaPill: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  betaPillText: {
    color: theme.colors.accentForeground,
    fontSize: 10,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: 0.5,
  },
  hotkeyChip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  hotkeyChipActive: {
    backgroundColor: theme.colors.surface3,
  },
  hotkeyChipDisabled: {
    opacity: 0.5,
  },
  hotkeyChipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    maxWidth: 220,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  dropdownTriggerActive: {
    backgroundColor: theme.colors.surface3,
  },
  dropdownTriggerDisabled: {
    opacity: 0.5,
  },
  dropdownTriggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
  },
  dropdownItemText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  dropdownItemTextSelected: {
    color: theme.colors.accent,
    fontWeight: theme.fontWeight.semibold,
  },
  dropdownItemColumn: {
    flexDirection: "column",
    gap: 2,
    flexShrink: 1,
    minWidth: 0,
  },
  dropdownItemLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  dropdownItemDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  quickTestRow: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  quickTestButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginTop: theme.spacing[3],
  },
  quickTestButton: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  quickTestButtonActive: {
    backgroundColor: theme.colors.surface3,
    borderColor: theme.colors.accent,
  },
  quickTestButtonDisabled: {
    opacity: 0.5,
  },
  quickTestButtonText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  diagnosticOk: {
    color: theme.colors.success,
  },
  diagnosticWarn: {
    color: theme.colors.palette.amber[500],
  },
  diagnosticServerId: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    marginTop: 2,
    fontFamily: "monospace",
  },
  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    paddingHorizontal: theme.spacing[6],
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[6],
    gap: theme.spacing[4],
  },
  modalTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  modalHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  modalPreview: {
    paddingVertical: theme.spacing[6],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  modalPreviewText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: 1,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  modalActionGhost: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  modalActionGhostText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  modalActionPrimary: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.accent,
  },
  modalActionPrimaryText: {
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  modalActionDisabled: {
    opacity: 0.5,
  },
}));
