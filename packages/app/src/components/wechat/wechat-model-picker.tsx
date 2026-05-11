import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { CombinedModelSelector } from "@/components/combined-model-selector";
import { useAppSettings } from "@/hooks/use-settings";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import type { AgentModelDefinition, AgentProvider } from "@server/server/agent/agent-sdk-types";

interface WechatModelPickerProps {
  serverId: string | null;
}

const WECHAT_PROVIDER: AgentProvider = "claude";

/**
 * Compact dropdown selector for the Claude model that powers WeChat AI
 * suggestions and rewrites. Reuses Ottie's existing
 * `CombinedModelSelector` (the same one shown on the agent status bar
 * and in the new-agent flow) — searchable popover with favorites — so
 * the picker visually matches the rest of the app instead of inventing
 * a new affordance.
 *
 * Codex models are present in the providers snapshot too, but the
 * daemon's `wechatLlmComplete` only knows how to drive Claude in v1
 * (one-shot via `@anthropic-ai/claude-agent-sdk`). We gate provider
 * selection so only the Claude entry is interactive — other providers
 * stay visible but disabled, signalling the v2 expansion path.
 */
export function WechatModelPicker({ serverId }: WechatModelPickerProps) {
  const { settings, updateSettings } = useAppSettings();
  const { entries, isLoading } = useProvidersSnapshot(serverId);

  const providerDefinitions = useMemo(() => buildProviderDefinitions(entries ?? []), [entries]);

  const allProviderModels = useMemo(() => {
    const map = new Map<string, AgentModelDefinition[]>();
    for (const entry of entries ?? []) {
      if (entry.models && entry.models.length > 0) {
        map.set(entry.provider, entry.models);
      }
    }
    return map;
  }, [entries]);

  const selectedModel = useMemo(() => {
    const stored = settings.wechatClaudeModelId;
    if (stored) return stored;
    const claudeModels = allProviderModels.get(WECHAT_PROVIDER) ?? [];
    const claudeDefault = claudeModels.find((m) => m.isDefault) ?? claudeModels[0];
    return claudeDefault?.id ?? "";
  }, [allProviderModels, settings.wechatClaudeModelId]);

  const canSelectProvider = useCallback((p: string) => p === WECHAT_PROVIDER, []);

  const handleSelect = useCallback(
    (provider: AgentProvider, modelId: string) => {
      if (provider !== WECHAT_PROVIDER) return;
      void updateSettings({ wechatClaudeModelId: modelId });
    },
    [updateSettings],
  );

  if (!serverId) return null;

  return (
    <View style={styles.row}>
      <CombinedModelSelector
        providerDefinitions={providerDefinitions}
        allProviderModels={allProviderModels}
        selectedProvider={WECHAT_PROVIDER}
        selectedModel={selectedModel}
        canSelectProvider={canSelectProvider}
        onSelect={handleSelect}
        isLoading={isLoading}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
}));
