// SessionsScreen — the WeChat-style "Chats" tab.
//
// Plan 02c reshape: replaces the legacy `<AgentList>` with a `<FlatList>` of
// `<ChatRow>` items, sorts pinned rows first (using
// `useChatRowStateStore.getPinnedRowKeys()`), and surfaces the
// `<TopRightAddMenu>` next to the header title.
//
// Empty-state branches:
//   - First-time empty (`!emptyOttiePlayedFirstChats && agents.length===0`):
//     Otter logo + "Your first agent is one tap away" copy.
//     Sets the flag once rendered so subsequent empties show pure copy.
//   - Subsequent empty: pure-copy variant.
//
// Initial-load loader is `<MathCurveLoader>` per UI-SPEC §D-13 (sanctioned
// top-level loader for the chats list).

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, Text, View, type ListRenderItem } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { ChatRow } from "@/components/chat-row";
import { TopRightAddMenu } from "@/components/top-right-add-menu";
import { MathCurveLoader } from "@/components/math-curve-loader";
import { otterAssets } from "@/assets/otter";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { useOnboardingStateStore } from "@/stores/onboarding-state-store";
import { makeRowKey, useChatRowStateStore } from "@/stores/chat-row-state-store";
import { fireDelightToast } from "@/utils/delight-toast";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

export function SessionsScreen({ serverId }: { serverId: string }) {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <SessionsScreenContent serverId={serverId} />;
}

function SessionsScreenContent({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { agents, hasMore, isInitialLoad, isLoadingMore, isRevalidating, loadMore, refreshAll } =
    useAgentHistory({
      serverId,
    });

  // Track user-initiated refresh to avoid showing spinner on background revalidation
  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    refreshAll();
  }, [refreshAll]);

  // Reset manual refresh flag when revalidation completes
  useEffect(() => {
    if (!isRevalidating && isManualRefresh) {
      setIsManualRefresh(false);
    }
  }, [isRevalidating, isManualRefresh]);

  // Pinned rows sort first (by pinnedAt desc, returned by the store helper),
  // then unpinned rows by lastActivityAt desc. Pinned set rebuilds when the
  // store changes — subscribe via a selector for re-renders.
  const pinnedRowKeys = useChatRowStateStore((s) =>
    Object.entries(s.rows)
      .filter(([, value]) => value.pinned)
      .sort(([, a], [, b]) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
      .map(([key]) => key),
  );

  const sortedAgents = useMemo(() => {
    const pinnedSet = new Set(pinnedRowKeys);
    return [...agents].sort((a, b) => {
      const aPinned = pinnedSet.has(makeRowKey(a.serverId, a.id));
      const bPinned = pinnedSet.has(makeRowKey(b.serverId, b.id));
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return b.lastActivityAt.getTime() - a.lastActivityAt.getTime();
    });
  }, [agents, pinnedRowKeys]);

  // First-time empty Otter (D-14): set the flag once the empty branch
  // renders so the next empty shows pure copy.
  const emptyOttiePlayed = useOnboardingStateStore((s) => s.emptyOttiePlayedFirstChats);
  const setEmptyOttiePlayed = useOnboardingStateStore((s) => s.setEmptyOttiePlayedFirstChats);
  const isFirstTime = !emptyOttiePlayed;

  useEffect(() => {
    if (!isInitialLoad && sortedAgents.length === 0 && isFirstTime) {
      setEmptyOttiePlayed(true);
    }
  }, [isInitialLoad, sortedAgents.length, isFirstTime, setEmptyOttiePlayed]);

  useEffect(() => {
    if (!isInitialLoad && sortedAgents.length > 0) {
      fireDelightToast("first-agent");
    }
  }, [isInitialLoad, sortedAgents.length]);

  const listFooterComponent = useMemo(
    () =>
      hasMore ? (
        <View style={styles.footer}>
          <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
            {isLoadingMore ? "Loading..." : "Load more"}
          </Button>
        </View>
      ) : null,
    [hasMore, loadMore, isLoadingMore],
  );

  const renderItem = useCallback<ListRenderItem<AggregatedAgent>>(
    ({ item }) => <ChatRow agent={item} />,
    [],
  );

  const keyExtractor = useCallback((item: AggregatedAgent) => `${item.serverId}:${item.id}`, []);

  const refreshColors = useMemo(
    () => [theme.colors.foregroundMuted],
    [theme.colors.foregroundMuted],
  );

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={isManualRefresh && isRevalidating}
        onRefresh={handleRefresh}
        tintColor={theme.colors.foregroundMuted}
        colors={refreshColors}
      />
    ),
    [isManualRefresh, isRevalidating, handleRefresh, theme.colors.foregroundMuted, refreshColors],
  );

  const headerRight = useMemo(() => <TopRightAddMenu serverId={serverId} />, [serverId]);

  return (
    <View style={styles.container}>
      <MenuHeader title="Chats" rightContent={headerRight} />
      {isInitialLoad ? (
        <View style={styles.loadingContainer}>
          <MathCurveLoader
            brandContext="chats"
            curve="rose-three"
            size={64}
            color={theme.colors.foregroundMuted}
            ariaLabel={t("common.loading")}
          />
        </View>
      ) : null}
      {!isInitialLoad && sortedAgents.length === 0 ? (
        <View style={styles.emptyContainer}>
          {isFirstTime ? (
            <>
              <otterAssets.emptyState size={120} />
              <Text style={styles.emptyHeadingDisplay}>{t("chat.empty.firstTime.heading")}</Text>
              <Text style={styles.emptyBody}>{t("chat.empty.firstTime.body")}</Text>
            </>
          ) : (
            <>
              <Text style={styles.emptyHeading}>{t("chat.empty.heading")}</Text>
              <Text style={styles.emptyBody}>{t("chat.empty.body")}</Text>
            </>
          )}
        </View>
      ) : null}
      {!isInitialLoad && sortedAgents.length > 0 ? (
        <FlatList
          data={sortedAgents}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={refreshControl}
          ListFooterComponent={listFooterComponent}
          showsVerticalScrollIndicator={false}
          onEndReached={hasMore ? loadMore : undefined}
          onEndReachedThreshold={0.4}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingBottom: theme.spacing[6],
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[6],
  },
  // First-time empty heading uses the rounded-display variant per UI-SPEC
  // lines 89-90 (Display variant). Subsequent empty uses the default system
  // family at the same size.
  emptyHeadingDisplay: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily?.rounded,
    letterSpacing: -0.4,
    textAlign: "center",
  },
  emptyHeading: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    textAlign: "center",
  },
  emptyBody: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
    maxWidth: 320,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  footer: {
    alignItems: "center",
    paddingVertical: theme.spacing[4],
  },
}));
