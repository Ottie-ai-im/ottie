import { useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const APP_SETTINGS_KEY = "@ottie:app-settings";
const LEGACY_SETTINGS_KEY = "@ottie:settings";
export const APP_SETTINGS_QUERY_KEY = ["app-settings"] as const;

import { THEME_TO_UNISTYLES, type ThemeName } from "@/styles/theme";

export type SendBehavior = "interrupt" | "queue";
export type ReleaseChannel = "stable" | "beta";

const VALID_THEMES = new Set<string>([...Object.keys(THEME_TO_UNISTYLES), "auto"]);
const VALID_RELEASE_CHANNELS = new Set<string>(["stable", "beta"]);

/**
 * Voice control beta — push-to-talk language driven app navigation.
 * `pushToTalkHotkey` is a serialized key combo string (e.g. "meta+shift+space").
 * `null` means user hasn't picked one yet; the feature stays inert until set.
 *
 * `intentProvider` picks who interprets the transcript:
 *   - "heuristic" — local Jaccard match, instant, no AI, basic commands only
 *   - "claude" / "codex" / "opencode" — daemon does a one-shot LLM call using
 *     the user's existing provider credentials, picks a tool, returns args.
 *
 * `intentModelId` is the specific model within that provider (e.g.
 * `claude-haiku-4-5` for fast routing, `claude-opus-4-7` for accuracy).
 * Null means "let daemon pick the provider's default".
 */
export type VoiceIntentProvider = "heuristic" | "claude" | "codex" | "opencode";

export interface VoiceControlSettings {
  enabled: boolean;
  pushToTalkHotkey: string | null;
  showFloatingOrb: boolean;
  intentProvider: VoiceIntentProvider;
  intentModelId: string | null;
}

/**
 * Container for beta-gated feature toggles. Each feature owns its own
 * sub-config so we can ship/retire features without touching root AppSettings.
 */
export interface BetaFeatureSettings {
  voiceControl: VoiceControlSettings;
}

export interface AppSettings {
  theme: ThemeName | "auto";
  manageBuiltInDaemon: boolean;
  sendBehavior: SendBehavior;
  releaseChannel: ReleaseChannel;
  // Absolute path on the daemon's machine. When set, "New task" creates a
  // sandboxed subfolder here so each task is isolated. Null = no default,
  // user picks a folder per project (legacy behavior).
  defaultWorkspaceRoot: string | null;
  // Opt-in experimental features. Default-off. Each lives behind its own flag
  // inside the Labs settings panel — no surprise behavior on upgrade.
  betaFeatures: BetaFeatureSettings;
}

const VALID_VOICE_INTENT_PROVIDERS = new Set<VoiceIntentProvider>([
  "heuristic",
  "claude",
  "codex",
  "opencode",
]);

const DEFAULT_VOICE_CONTROL_SETTINGS: VoiceControlSettings = {
  enabled: false,
  pushToTalkHotkey: null,
  showFloatingOrb: true,
  // Default to heuristic — zero AI cost, zero latency, works without any
  // provider configured. AI mode is opt-in.
  intentProvider: "heuristic",
  intentModelId: null,
};

const DEFAULT_BETA_FEATURE_SETTINGS: BetaFeatureSettings = {
  voiceControl: DEFAULT_VOICE_CONTROL_SETTINGS,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: "auto",
  manageBuiltInDaemon: true,
  sendBehavior: "interrupt",
  releaseChannel: "stable",
  defaultWorkspaceRoot: null,
  betaFeatures: DEFAULT_BETA_FEATURE_SETTINGS,
};

export interface UseAppSettingsReturn {
  settings: AppSettings;
  isLoading: boolean;
  error: unknown | null;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
}

export function useAppSettings(): UseAppSettingsReturn {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: loadSettingsFromStorage,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const updateSettings = useCallback(
    async (updates: Partial<AppSettings>) => {
      try {
        const prev =
          queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ?? DEFAULT_APP_SETTINGS;
        const next = { ...prev, ...updates };
        queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
        await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
      } catch (err) {
        console.error("[AppSettings] Failed to save settings:", err);
        throw err;
      }
    },
    [queryClient],
  );

  const resetSettings = useCallback(async () => {
    try {
      const next = { ...DEFAULT_APP_SETTINGS };
      queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
      await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
    } catch (err) {
      console.error("[AppSettings] Failed to reset settings:", err);
      throw err;
    }
  }, [queryClient]);

  return {
    settings: data ?? DEFAULT_APP_SETTINGS,
    isLoading: isPending,
    error: error ?? null,
    updateSettings,
    resetSettings,
  };
}

function normalizeBetaFeatures(
  parsed: { betaFeatures?: unknown } | undefined,
): BetaFeatureSettings {
  const raw = parsed?.betaFeatures;
  if (!raw || typeof raw !== "object") {
    return DEFAULT_BETA_FEATURE_SETTINGS;
  }
  const candidate = raw as { voiceControl?: unknown };
  const voiceControlRaw = candidate.voiceControl;
  let voiceControl: VoiceControlSettings;
  if (!voiceControlRaw || typeof voiceControlRaw !== "object") {
    voiceControl = DEFAULT_VOICE_CONTROL_SETTINGS;
  } else {
    const vc = voiceControlRaw as Partial<VoiceControlSettings>;
    voiceControl = {
      enabled:
        typeof vc.enabled === "boolean" ? vc.enabled : DEFAULT_VOICE_CONTROL_SETTINGS.enabled,
      pushToTalkHotkey:
        typeof vc.pushToTalkHotkey === "string" || vc.pushToTalkHotkey === null
          ? vc.pushToTalkHotkey
          : DEFAULT_VOICE_CONTROL_SETTINGS.pushToTalkHotkey,
      showFloatingOrb:
        typeof vc.showFloatingOrb === "boolean"
          ? vc.showFloatingOrb
          : DEFAULT_VOICE_CONTROL_SETTINGS.showFloatingOrb,
      intentProvider:
        typeof vc.intentProvider === "string" &&
        VALID_VOICE_INTENT_PROVIDERS.has(vc.intentProvider as VoiceIntentProvider)
          ? (vc.intentProvider as VoiceIntentProvider)
          : DEFAULT_VOICE_CONTROL_SETTINGS.intentProvider,
      intentModelId:
        typeof vc.intentModelId === "string" || vc.intentModelId === null
          ? vc.intentModelId
          : DEFAULT_VOICE_CONTROL_SETTINGS.intentModelId,
    };
  }
  return { voiceControl };
}

export async function loadSettingsFromStorage(): Promise<AppSettings> {
  try {
    const stored = await AsyncStorage.getItem(APP_SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AppSettings>;
      if (parsed.theme && !VALID_THEMES.has(parsed.theme)) {
        parsed.theme = DEFAULT_APP_SETTINGS.theme;
      }
      if (parsed.releaseChannel && !VALID_RELEASE_CHANNELS.has(parsed.releaseChannel)) {
        parsed.releaseChannel = DEFAULT_APP_SETTINGS.releaseChannel;
      }
      if (
        parsed.defaultWorkspaceRoot !== undefined &&
        parsed.defaultWorkspaceRoot !== null &&
        typeof parsed.defaultWorkspaceRoot !== "string"
      ) {
        parsed.defaultWorkspaceRoot = null;
      }
      // betaFeatures is a nested object — shallow spread loses sub-defaults if
      // the stored payload omits inner fields. Normalize before merge.
      parsed.betaFeatures = normalizeBetaFeatures(parsed);
      return { ...DEFAULT_APP_SETTINGS, ...parsed };
    }

    const legacyStored = await AsyncStorage.getItem(LEGACY_SETTINGS_KEY);
    if (legacyStored) {
      const legacyParsed = JSON.parse(legacyStored) as Record<string, unknown>;
      const next = {
        ...DEFAULT_APP_SETTINGS,
        ...pickAppSettingsFromLegacy(legacyParsed),
      } satisfies AppSettings;
      await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
      return next;
    }

    await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(DEFAULT_APP_SETTINGS));
    return DEFAULT_APP_SETTINGS;
  } catch (error) {
    console.error("[AppSettings] Failed to load settings:", error);
    throw error;
  }
}

function pickAppSettingsFromLegacy(legacy: Record<string, unknown>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (legacy.theme === "dark" || legacy.theme === "light" || legacy.theme === "auto") {
    result.theme = legacy.theme;
  }
  if (typeof legacy.manageBuiltInDaemon === "boolean") {
    result.manageBuiltInDaemon = legacy.manageBuiltInDaemon;
  }
  if (legacy.releaseChannel === "stable" || legacy.releaseChannel === "beta") {
    result.releaseChannel = legacy.releaseChannel;
  }
  return result;
}

export const useSettings = useAppSettings;
