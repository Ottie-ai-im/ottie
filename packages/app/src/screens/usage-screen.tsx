import { useCallback, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Activity, RefreshCw, Trash2 } from "lucide-react-native";

import { MobileTabHeader } from "@/components/headers/mobile-tab-header";
import { useHosts } from "@/runtime/host-runtime";
import { useUsageSummary } from "@/hooks/use-usage-summary";
import { getProviderAccent, getProviderIcon } from "@/components/provider-icons";
import { confirmDialog } from "@/utils/confirm-dialog";
import { computeGrandTotal, computeProviderBreakdown, useUsageStore } from "@/stores/usage-store";
import type { UsageProviderSummary } from "@server/server/usage/rpc-schemas";

// Daemon emits "claude-code" / "codex". The local store and provider-icons
// catalog use the shorter "claude" / "codex" / "opencode" form. Map daemon
// provider IDs to the shared icon catalog so per-card branding stays consistent
// across both data sources.
const DAEMON_TO_ICON_PROVIDER: Record<string, string> = {
  "claude-code": "claude",
  codex: "codex",
  opencode: "opencode",
};

function iconProviderId(daemonProvider: string): string {
  return DAEMON_TO_ICON_PROVIDER[daemonProvider] ?? daemonProvider;
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return "—";
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function formatRelativeTime(iso: string | null, now: number, t: (k: string, v?: any) => string) {
  if (!iso) return t("usage.never");
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return t("usage.never");
  const diff = ts - now;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.floor(minutes / 60);
  const remM = minutes % 60;
  if (diff > 0) {
    if (hours <= 0) return t("usage.inMinutes", { n: minutes });
    return t("usage.inHoursMinutes", { h: hours, m: remM });
  }
  if (minutes < 60) return t("usage.minutesAgo", { n: minutes });
  if (hours < 24) return t("usage.hoursAgo", { n: hours });
  const days = Math.round(hours / 24);
  return t("usage.daysAgo", { n: days });
}

export function UsageScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const hosts = useHosts();
  const serverId = hosts[0]?.serverId ?? null;
  const { data, isLoading, isFetching, error, refetch } = useUsageSummary(serverId);
  const now = Date.now();

  const records = useUsageStore((s) => s.records);
  const localGrandTotal = useMemo(() => computeGrandTotal(records), [records]);
  const localBreakdown = useMemo(() => computeProviderBreakdown(records), [records]);
  const localResetStore = useUsageStore((s) => s.reset);
  const hasLocalData = localGrandTotal.turnCount > 0;

  const handleResetLocal = useCallback(() => {
    void confirmDialog({
      title: t("usage.resetConfirmTitle"),
      message: t("usage.resetConfirmMessage"),
      confirmLabel: t("usage.reset"),
      cancelLabel: t("common.cancel"),
    }).then((confirmed) => {
      if (confirmed) localResetStore();
    });
  }, [localResetStore, t]);

  const providers = data?.providers ?? [];
  const generatedAt = useMemo(
    () => formatRelativeTime(data?.generatedAt ?? null, now, t),
    [data?.generatedAt, now, t],
  );
  const aggregate = useMemo(() => {
    let totalTokens = 0;
    let estimatedCostUsd = 0;
    let sessionsCount = 0;
    let messagesCount = 0;
    for (const p of providers) {
      totalTokens += p.totalTokens;
      estimatedCostUsd += p.estimatedCostUsd ?? 0;
      sessionsCount += p.sessionsCount;
      messagesCount += p.messagesCount;
    }
    return { totalTokens, estimatedCostUsd, sessionsCount, messagesCount };
  }, [providers]);

  const isEmpty =
    !isLoading && providers.every((p) => p.totalTokens === 0) && localGrandTotal.turnCount === 0;

  return (
    <View style={styles.container}>
      <MobileTabHeader title={t("usage.title")} testID="usage-header" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heading}>
          <Text style={styles.subtitle}>{t("usage.subtitle")}</Text>
        </View>

        <View style={styles.toolbar}>
          <Text style={styles.toolbarMeta}>
            {data ? t("usage.lastUpdated", { time: generatedAt }) : ""}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("usage.refresh")}
            onPress={refetch}
            style={styles.refreshButton}
            testID="usage-refresh"
          >
            <RefreshCw
              size={14}
              color={isFetching ? theme.colors.foregroundMuted : theme.colors.foreground}
            />
            <Text style={styles.refreshLabel}>{t("usage.refresh")}</Text>
          </Pressable>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>{t("usage.errorTitle")}</Text>
            <Text style={styles.errorBody}>{error}</Text>
          </View>
        ) : null}

        {isLoading && !data ? (
          <View style={styles.emptyCard}>
            <Activity size={28} color={theme.colors.foregroundMuted} />
            <Text style={styles.emptyTitle}>{t("usage.loading")}</Text>
          </View>
        ) : null}

        {isEmpty ? (
          <View style={styles.emptyCard}>
            <Activity size={28} color={theme.colors.foregroundMuted} />
            <Text style={styles.emptyTitle}>{t("usage.emptyTitle")}</Text>
            <Text style={styles.emptyHint}>{t("usage.emptyHint")}</Text>
          </View>
        ) : null}

        {!isEmpty && (data || hasLocalData) ? (
          <SummaryBanner
            totalTokens={Math.max(
              aggregate.totalTokens,
              localGrandTotal.inputTokens +
                localGrandTotal.cachedInputTokens +
                localGrandTotal.outputTokens,
            )}
            estimatedCostUsd={Math.max(aggregate.estimatedCostUsd, localGrandTotal.totalCostUsd)}
            sessionsCount={aggregate.sessionsCount}
            providersCount={
              new Set([
                ...providers.filter((p) => p.totalTokens > 0).map((p) => p.provider),
                ...localBreakdown.map((b) => b.provider),
              ]).size
            }
            turnsCount={localGrandTotal.turnCount}
          />
        ) : null}

        {providers.map((p) =>
          p.totalTokens > 0 ? <ProviderCard key={p.provider} provider={p} now={now} /> : null,
        )}

        {hasLocalData ? (
          <View style={styles.manageCard}>
            <View style={styles.manageHeader}>
              <Text style={styles.manageTitle}>{t("usage.manage")}</Text>
            </View>
            <View style={styles.manageRow}>
              <View style={styles.manageRowText}>
                <Text style={styles.manageRowTitle}>{t("usage.resetTotals")}</Text>
                <Text style={styles.manageRowHint}>{t("usage.resetClearHint")}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("usage.reset")}
                onPress={handleResetLocal}
                style={styles.resetButton}
                testID="usage-reset-local"
              >
                <Trash2 size={14} color={theme.colors.destructive} />
                <Text style={styles.resetButtonLabel}>{t("usage.reset")}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

interface SummaryBannerProps {
  totalTokens: number;
  estimatedCostUsd: number;
  sessionsCount: number;
  providersCount: number;
  turnsCount: number;
}

function SummaryBanner({
  totalTokens,
  estimatedCostUsd,
  sessionsCount,
  providersCount,
  turnsCount,
}: SummaryBannerProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryPrimary}>
        <Text style={styles.summaryEyebrow}>{t("usage.totalCost")}</Text>
        <Text style={styles.summaryValue}>{formatCost(estimatedCostUsd)}</Text>
      </View>
      <View style={styles.summaryStatRow}>
        <SummaryStat label={t("usage.totalTokens")} value={formatTokens(totalTokens)} />
        <SummaryStat label={t("usage.sessionsLabel")} value={sessionsCount.toLocaleString()} />
        <SummaryStat label={t("usage.providersLabel")} value={providersCount.toLocaleString()} />
        {turnsCount > 0 ? (
          <SummaryStat label={t("usage.turns")} value={turnsCount.toLocaleString()} />
        ) : null}
      </View>
    </View>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryStatValue}>{value}</Text>
      <Text style={styles.summaryStatLabel}>{label}</Text>
    </View>
  );
}

function ProviderCard({ provider, now }: { provider: UsageProviderSummary; now: number }) {
  const { t } = useTranslation();
  const blockResetIn = useMemo(
    () => formatRelativeTime(provider.currentBlockResetsAt, now, t),
    [provider.currentBlockResetsAt, now, t],
  );
  const lastUsed = useMemo(
    () => formatRelativeTime(provider.lastMessageAt, now, t),
    [provider.lastMessageAt, now, t],
  );
  const blockProgress = useMemo(() => {
    if (!provider.currentBlockStartedAt || !provider.currentBlockResetsAt) return 0;
    const start = Date.parse(provider.currentBlockStartedAt);
    const end = Date.parse(provider.currentBlockResetsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
    const span = end - start;
    if (span <= 0) return 0;
    return Math.max(0, Math.min(1, (now - start) / span));
  }, [provider.currentBlockStartedAt, provider.currentBlockResetsAt, now]);

  const iconProvider = iconProviderId(provider.provider);
  const ProviderIcon = getProviderIcon(iconProvider);
  const accent = getProviderAccent(iconProvider);

  const providerLabel =
    provider.provider === "claude-code"
      ? t("usage.providers.claudeCode")
      : provider.provider === "codex"
        ? t("usage.providers.codex")
        : provider.provider;

  return (
    <View style={styles.providerCard}>
      <View style={styles.providerHeader}>
        <View style={[styles.providerAvatar, { backgroundColor: accent.background }]}>
          <ProviderIcon size={20} color={accent.foreground} />
        </View>
        <View style={styles.providerHeaderText}>
          <Text style={styles.providerName}>{providerLabel}</Text>
          <Text style={styles.providerMeta}>
            {t("usage.sessionsCount", { n: provider.sessionsCount })}
          </Text>
        </View>
        <View style={styles.providerCostBlock}>
          <Text style={styles.providerCost}>{formatCost(provider.estimatedCostUsd)}</Text>
          <Text style={styles.providerCostLabel}>{t("usage.estimatedCost")}</Text>
        </View>
      </View>

      <View style={styles.statRow}>
        <Stat label={t("usage.totalTokens")} value={formatTokens(provider.totalTokens)} />
        <Stat label={t("usage.weekTokens")} value={formatTokens(provider.weekTokens)} />
      </View>

      <View style={styles.breakdownRow}>
        <Stat label={t("usage.input")} value={formatTokens(provider.inputTokens)} small />
        <Stat label={t("usage.output")} value={formatTokens(provider.outputTokens)} small />
        <Stat label={t("usage.cacheRead")} value={formatTokens(provider.cacheReadTokens)} small />
        {provider.cacheWriteTokens > 0 ? (
          <Stat
            label={t("usage.cacheWrite")}
            value={formatTokens(provider.cacheWriteTokens)}
            small
          />
        ) : null}
      </View>

      {provider.currentBlockResetsAt ? (
        <View style={styles.block}>
          <View style={styles.blockHeader}>
            <Text style={styles.blockLabel}>{t("usage.currentBlock")}</Text>
            <Text style={styles.blockMeta}>{t("usage.resetsIn", { time: blockResetIn })}</Text>
          </View>
          <View style={styles.blockBarTrack}>
            <View
              style={[
                styles.blockBarFill,
                {
                  width: `${(blockProgress * 100).toFixed(1)}%` as unknown as number,
                  backgroundColor: accent.background,
                },
              ]}
            />
          </View>
          <Text style={styles.blockTokens}>
            {t("usage.blockTokens", { tokens: formatTokens(provider.currentBlockTokens) })}
          </Text>
        </View>
      ) : null}

      <Text style={styles.lastUsed}>{t("usage.lastUsed", { time: lastUsed })}</Text>
    </View>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <View style={small ? styles.statSmall : styles.stat}>
      <Text style={small ? styles.statLabelSmall : styles.statLabel}>{label}</Text>
      <Text style={small ? styles.statValueSmall : styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scrollContent: {
    paddingBottom: theme.spacing[16],
  },
  heading: {
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[1],
  },
  subtitle: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[6],
    paddingBottom: theme.spacing[3],
  },
  toolbarMeta: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
  },
  refreshLabel: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  emptyCard: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[6],
    marginHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.glassCard,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  emptyTitle: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    letterSpacing: -0.2,
    marginTop: theme.spacing[2],
  },
  emptyHint: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  errorCard: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[3],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.glassCard,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.destructive,
    gap: theme.spacing[1],
  },
  errorTitle: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.destructive,
  },
  errorBody: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  summaryCard: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[3],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.glassCard,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    gap: theme.spacing[4],
  },
  summaryPrimary: {
    gap: 4,
  },
  summaryEyebrow: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: 32,
    lineHeight: 36,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.foreground,
    letterSpacing: -0.6,
    fontVariant: ["tabular-nums"],
  },
  summaryStatRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[4],
    paddingTop: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderGlass,
  },
  summaryStat: {
    minWidth: 80,
    gap: 2,
  },
  summaryStatValue: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    letterSpacing: -0.2,
    fontVariant: ["tabular-nums"],
  },
  summaryStatLabel: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  providerCard: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[3],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.glassCard,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    gap: theme.spacing[3],
  },
  providerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  providerAvatar: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.lg,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
  providerHeaderText: {
    flex: 1,
    gap: 2,
  },
  providerName: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    letterSpacing: -0.2,
  },
  providerMeta: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  providerCostBlock: {
    alignItems: "flex-end",
    gap: 2,
  },
  providerCost: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    letterSpacing: -0.2,
    fontVariant: ["tabular-nums"],
  },
  providerCostLabel: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  statRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  breakdownRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  stat: {
    flex: 1,
    gap: 2,
  },
  statSmall: {
    minWidth: 80,
    gap: 2,
  },
  statLabel: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  statLabelSmall: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  statValue: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    letterSpacing: -0.2,
    fontVariant: ["tabular-nums"],
  },
  statValueSmall: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  block: {
    paddingTop: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderGlass,
    gap: theme.spacing[2],
  },
  blockHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  blockLabel: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  blockMeta: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  blockBarTrack: {
    height: 6,
    width: "100%",
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.full,
    overflow: "hidden",
  },
  blockBarFill: {
    height: "100%",
    backgroundColor: theme.colors.accent,
  },
  blockTokens: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  lastUsed: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  manageCard: {
    marginHorizontal: theme.spacing[4],
    marginTop: theme.spacing[2],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surfaceGlass,
    borderRadius: theme.borderRadius.glassCard,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
    gap: theme.spacing[3],
  },
  manageHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  manageTitle: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    letterSpacing: -0.2,
  },
  manageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  manageRowText: {
    flex: 1,
    gap: 2,
  },
  manageRowTitle: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  manageRowHint: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.destructive,
  },
  resetButtonLabel: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.destructive,
  },
}));
