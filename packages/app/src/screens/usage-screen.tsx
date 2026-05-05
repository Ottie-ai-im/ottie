import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Activity, RefreshCw } from "lucide-react-native";

import { MobileTabHeader } from "@/components/headers/mobile-tab-header";
import { useHosts } from "@/runtime/host-runtime";
import { useUsageSummary } from "@/hooks/use-usage-summary";
import type { UsageProviderSummary } from "@server/server/usage/rpc-schemas";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
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

function formatCost(usd: number | null): string {
  if (usd === null) return "—";
  if (usd < 0.01) return "$0.00";
  return `$${usd.toFixed(2)}`;
}

export function UsageScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const hosts = useHosts();
  const serverId = hosts[0]?.serverId ?? null;
  const { data, isLoading, isFetching, error, refetch } = useUsageSummary(serverId);
  const now = Date.now();

  const providers = data?.providers ?? [];
  const generatedAt = useMemo(
    () => formatRelativeTime(data?.generatedAt ?? null, now, t),
    [data?.generatedAt, now, t],
  );

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

        {data && providers.every((p) => p.totalTokens === 0) ? (
          <View style={styles.emptyCard}>
            <Activity size={28} color={theme.colors.foregroundMuted} />
            <Text style={styles.emptyTitle}>{t("usage.emptyTitle")}</Text>
            <Text style={styles.emptyHint}>{t("usage.emptyHint")}</Text>
          </View>
        ) : null}

        {providers.map((p) =>
          p.totalTokens > 0 ? <ProviderCard key={p.provider} provider={p} now={now} /> : null,
        )}
      </ScrollView>
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

  const providerLabel =
    provider.provider === "claude-code"
      ? t("usage.providers.claudeCode")
      : t("usage.providers.codex");

  return (
    <View style={styles.providerCard}>
      <View style={styles.providerHeader}>
        <Text style={styles.providerName}>{providerLabel}</Text>
        <Text style={styles.providerMeta}>
          {t("usage.sessionsCount", { n: provider.sessionsCount })}
        </Text>
      </View>

      <View style={styles.statRow}>
        <Stat label={t("usage.totalTokens")} value={formatTokens(provider.totalTokens)} />
        <Stat label={t("usage.weekTokens")} value={formatTokens(provider.weekTokens)} />
        <Stat label={t("usage.estimatedCost")} value={formatCost(provider.estimatedCostUsd)} />
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
                { width: `${(blockProgress * 100).toFixed(1)}%` as unknown as number },
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
    justifyContent: "space-between",
    alignItems: "center",
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
  },
  statValueSmall: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
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
}));
