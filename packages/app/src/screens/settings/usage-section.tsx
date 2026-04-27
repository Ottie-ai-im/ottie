import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  computeGrandTotal,
  computeProviderBreakdown,
  useUsageStore,
  type UsageTotals,
} from "@/stores/usage-store";

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

function formatCostUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "$0.00";
  }
  if (value < 0.01) {
    return "<$0.01";
  }
  return `$${value.toFixed(2)}`;
}

function formatTimestamp(value: number | null): string | null {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString();
  } catch {
    return null;
  }
}

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

const ROW_WITH_BORDER_STYLE = [settingsStyles.row, settingsStyles.rowBorder];

interface UsageRowProps {
  title: string;
  hint?: string | null;
  value: string;
  withBorder?: boolean;
}

function UsageRow({ title, hint, value, withBorder = false }: UsageRowProps) {
  return (
    <View style={withBorder ? ROW_WITH_BORDER_STYLE : settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        {hint ? <Text style={settingsStyles.rowHint}>{hint}</Text> : null}
      </View>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

interface TotalsCardProps {
  totals: UsageTotals;
}

function TotalsCard({ totals }: TotalsCardProps) {
  const { t } = useTranslation();
  const totalInput = totals.inputTokens + totals.cachedInputTokens;
  return (
    <View style={settingsStyles.card}>
      <UsageRow
        title={t("usage.totalCost")}
        hint={t("usage.totalCostHint")}
        value={formatCostUsd(totals.totalCostUsd)}
      />
      <UsageRow
        title={t("usage.inputTokens")}
        hint={t("usage.inputTokensHint")}
        value={formatTokens(totalInput)}
        withBorder
      />
      <UsageRow
        title={t("usage.cachedInput")}
        value={formatTokens(totals.cachedInputTokens)}
        withBorder
      />
      <UsageRow
        title={t("usage.outputTokens")}
        value={formatTokens(totals.outputTokens)}
        withBorder
      />
      <UsageRow title={t("usage.turns")} value={totals.turnCount.toLocaleString()} withBorder />
    </View>
  );
}

export function UsageSection() {
  const { t } = useTranslation();
  const records = useUsageStore((state) => state.records);
  const firstRecordedAt = useUsageStore((state) => state.firstRecordedAt);
  const lastRecordedAt = useUsageStore((state) => state.lastRecordedAt);
  const reset = useUsageStore((state) => state.reset);

  const grandTotal = useMemo(() => computeGrandTotal(records), [records]);
  const providerBreakdown = useMemo(() => computeProviderBreakdown(records), [records]);

  const handleReset = useCallback(() => {
    void confirmDialog({
      title: t("usage.resetConfirmTitle"),
      message: t("usage.resetConfirmMessage"),
      confirmLabel: t("usage.reset"),
      cancelLabel: t("common.cancel"),
    }).then((confirmed) => {
      if (confirmed) {
        reset();
      }
      return;
    });
  }, [reset, t]);

  const hasData = grandTotal.turnCount > 0;
  const trackingSinceText = formatTimestamp(firstRecordedAt);
  const lastTurnText = formatTimestamp(lastRecordedAt);

  return (
    <View>
      <SettingsSection title={t("usage.totalTitle")}>
        <TotalsCard totals={grandTotal} />
        <Text style={styles.disclaimer}>{t("usage.disclaimer")}</Text>
        {trackingSinceText ? (
          <Text style={styles.disclaimer}>
            {lastTurnText && lastTurnText !== trackingSinceText
              ? t("usage.trackingSinceWithLast", {
                  since: trackingSinceText,
                  last: lastTurnText,
                })
              : t("usage.trackingSince", { since: trackingSinceText })}
          </Text>
        ) : null}
      </SettingsSection>

      {providerBreakdown.length > 0 ? (
        <SettingsSection title={t("usage.byProvider")}>
          <View style={settingsStyles.card}>
            {providerBreakdown.map((entry, index) => (
              <UsageRow
                key={entry.provider}
                title={providerLabel(entry.provider)}
                hint={t("usage.providerSummary", {
                  count: entry.agentCount,
                  tokens: formatTokens(
                    entry.totals.inputTokens +
                      entry.totals.cachedInputTokens +
                      entry.totals.outputTokens,
                  ),
                })}
                value={formatCostUsd(entry.totals.totalCostUsd)}
                withBorder={index > 0}
              />
            ))}
          </View>
        </SettingsSection>
      ) : null}

      <SettingsSection title={t("usage.manage")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("usage.resetTotals")}</Text>
              <Text style={settingsStyles.rowHint}>
                {hasData ? t("usage.resetClearHint") : t("usage.nothingRecorded")}
              </Text>
            </View>
            <Button variant="secondary" size="sm" onPress={handleReset} disabled={!hasData}>
              {t("usage.reset")}
            </Button>
          </View>
        </View>
      </SettingsSection>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  value: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontVariant: ["tabular-nums"],
  },
  disclaimer: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[2],
    marginLeft: theme.spacing[1],
  },
}));
