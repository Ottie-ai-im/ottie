// SessionsScreen — the WeChat-style "Chats" tab.
//
// Layout:
//   - MenuHeader ("Chats")
//   - SearchInput (filters by title / cwd / serverLabel)
//   - FlatList of mixed items: ONLINE / OFFLINE section headers + ChatRows
//
// Grouping (Plan B — "what you can control"):
//   - Online  : status !== "closed"  (initializing | idle | running | error)
//   - Offline : status === "closed"
// Within each group: pinned rows first (pinnedAt desc), then by lastActivityAt desc.
//
// Selection: a row is highlighted when usePathname() matches its detail route.
//
// Empty-state branches:
//   - First-time empty (`!emptyOttiePlayedFirstChats && agents.length===0`):
//     Otter logo + "Your first agent is one tap away" copy.
//   - Subsequent empty: pure-copy variant.
//   - Search-empty: pure-copy variant ("No results").
//
// Initial-load loader is `<MathCurveLoader>` per UI-SPEC §D-13.

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, Text, View, type ListRenderItem } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/combobox";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ChatRow } from "@/components/chat-row";
import { MathCurveLoader } from "@/components/math-curve-loader";
import { otterAssets } from "@/assets/otter";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { useOnboardingStateStore } from "@/stores/onboarding-state-store";
import { makeRowKey, useChatRowStateStore } from "@/stores/chat-row-state-store";
import { fireDelightToast } from "@/utils/delight-toast";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { shortenPath } from "@/utils/shorten-path";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

type ListItem =
  | { type: "header"; key: string; label: string; count: number }
  | { type: "row"; key: string; agent: AggregatedAgent; selected: boolean };

function isOnline(agent: AggregatedAgent): boolean {
  return agent.status !== "closed";
}

export function SessionsScreen({ serverId }: { serverId: string }) {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <SessionsScreenContent serverId={serverId} />;
}

type ScopeValue = "active" | "archived";

function SessionsScreenContent({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const pathname = usePathname();
  const [scope, setScope] = useState<ScopeValue>("active");
  const { agents, hasMore, isInitialLoad, isLoadingMore, isRevalidating, loadMore, refreshAll } =
    useAgentHistory({
      serverId,
      includeArchived: scope === "archived",
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

  const [query, setQuery] = useState("");

  // Pinned set drives intra-group ordering (pinned first, then lastActivityAt desc).
  const rows = useChatRowStateStore((s) => s.rows);
  const pinnedSet = useMemo(() => {
    const out = new Set<string>();
    for (const [key, value] of Object.entries(rows)) {
      if (value.pinned) out.add(key);
    }
    return out;
  }, [rows]);

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => {
      const haystack = [a.title ?? "", a.cwd ? shortenPath(a.cwd) : "", a.serverLabel]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [agents, query]);

  const sortFn = useCallback(
    (a: AggregatedAgent, b: AggregatedAgent) => {
      const aPinned = pinnedSet.has(makeRowKey(a.serverId, a.id));
      const bPinned = pinnedSet.has(makeRowKey(b.serverId, b.id));
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return b.lastActivityAt.getTime() - a.lastActivityAt.getTime();
    },
    [pinnedSet],
  );

  const { onlineAgents, offlineAgents } = useMemo(() => {
    const online: AggregatedAgent[] = [];
    const offline: AggregatedAgent[] = [];
    for (const a of filteredAgents) {
      (isOnline(a) ? online : offline).push(a);
    }
    online.sort(sortFn);
    offline.sort(sortFn);
    return { onlineAgents: online, offlineAgents: offline };
  }, [filteredAgents, sortFn]);

  const listItems = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];
    const selectedKey = pickSelectedKey(pathname, filteredAgents);
    if (onlineAgents.length > 0) {
      items.push({
        type: "header",
        key: "header-online",
        label: t("chat.section.online", { defaultValue: "ONLINE" }),
        count: onlineAgents.length,
      });
      for (const agent of onlineAgents) {
        const key = `${agent.serverId}:${agent.id}`;
        items.push({ type: "row", key, agent, selected: key === selectedKey });
      }
    }
    if (offlineAgents.length > 0) {
      items.push({
        type: "header",
        key: "header-offline",
        label: t("chat.section.offline", { defaultValue: "OFFLINE" }),
        count: offlineAgents.length,
      });
      for (const agent of offlineAgents) {
        const key = `${agent.serverId}:${agent.id}`;
        items.push({ type: "row", key, agent, selected: key === selectedKey });
      }
    }
    return items;
  }, [onlineAgents, offlineAgents, pathname, filteredAgents, t]);

  const totalAgents = agents.length;

  // First-time empty Otter (D-14): set the flag once the empty branch
  // renders so the next empty shows pure copy.
  const emptyOttiePlayed = useOnboardingStateStore((s) => s.emptyOttiePlayedFirstChats);
  const setEmptyOttiePlayed = useOnboardingStateStore((s) => s.setEmptyOttiePlayedFirstChats);
  const isFirstTime = !emptyOttiePlayed;

  useEffect(() => {
    if (scope !== "active") return;
    if (!isInitialLoad && totalAgents === 0 && isFirstTime) {
      setEmptyOttiePlayed(true);
    }
  }, [scope, isInitialLoad, totalAgents, isFirstTime, setEmptyOttiePlayed]);

  useEffect(() => {
    if (scope !== "active") return;
    if (!isInitialLoad && totalAgents > 0) {
      fireDelightToast("first-agent");
    }
  }, [scope, isInitialLoad, totalAgents]);

  const listFooterComponent = useMemo(
    () =>
      hasMore ? (
        <View style={styles.footer}>
          <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
            {isLoadingMore ? t("common.loading") : t("chat.loadMore")}
          </Button>
        </View>
      ) : null,
    [hasMore, loadMore, isLoadingMore],
  );

  const renderItem = useCallback<ListRenderItem<ListItem>>(({ item }) => {
    if (item.type === "header") {
      return (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>
            {item.label} · {item.count}
          </Text>
        </View>
      );
    }
    return <ChatRow agent={item.agent} selected={item.selected} />;
  }, []);

  const keyExtractor = useCallback((item: ListItem) => item.key, []);

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

  const showInitialEmpty = !isInitialLoad && totalAgents === 0;
  const showSearchEmpty = !isInitialLoad && totalAgents > 0 && listItems.length === 0;

  const scopeOptions = useMemo(
    () =>
      [
        {
          value: "active" as const,
          label: t("chat.scope.active", { defaultValue: "Active" }),
          testID: "chat-scope-active",
        },
        {
          value: "archived" as const,
          label: t("chat.scope.archived", { defaultValue: "Archived" }),
          testID: "chat-scope-archived",
        },
      ] satisfies ReadonlyArray<{ value: ScopeValue; label: string; testID: string }>,
    [t],
  );

  let initialEmptyView: React.ReactNode = null;
  if (showInitialEmpty) {
    if (scope === "archived") {
      initialEmptyView = (
        <>
          <Text style={styles.emptyHeading}>
            {t("chat.empty.archived.heading", { defaultValue: "No archived chats" })}
          </Text>
          <Text style={styles.emptyBody}>
            {t("chat.empty.archived.body", {
              defaultValue: "Chats you archive will show up here.",
            })}
          </Text>
        </>
      );
    } else if (isFirstTime) {
      initialEmptyView = (
        <>
          <otterAssets.emptyState size={120} />
          <Text style={styles.emptyHeadingDisplay}>{t("chat.empty.firstTime.heading")}</Text>
          <Text style={styles.emptyBody}>{t("chat.empty.firstTime.body")}</Text>
        </>
      );
    } else {
      initialEmptyView = (
        <>
          <Text style={styles.emptyHeading}>{t("chat.empty.heading")}</Text>
          <Text style={styles.emptyBody}>{t("chat.empty.body")}</Text>
        </>
      );
    }
  }

  return (
    <View style={styles.container}>
      <MenuHeader title={t("chat.title")} />
      <View style={styles.searchBar}>
        <SearchInput
          placeholder={t("chat.searchPlaceholder", { defaultValue: "Search..." })}
          value={query}
          onChangeText={setQuery}
        />
      </View>
      <View style={styles.scopeBar}>
        <SegmentedControl<ScopeValue>
          options={scopeOptions}
          value={scope}
          onValueChange={setScope}
          size="sm"
          testID="chat-scope-toggle"
        />
      </View>
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
      {showInitialEmpty ? <View style={styles.emptyContainer}>{initialEmptyView}</View> : null}
      {showSearchEmpty ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyHeading}>
            {t("chat.search.empty", { defaultValue: "No results" })}
          </Text>
        </View>
      ) : null}
      {!isInitialLoad && listItems.length > 0 ? (
        <FlatList
          data={listItems}
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

function pickSelectedKey(pathname: string | null, agents: AggregatedAgent[]): string | null {
  if (!pathname) return null;
  for (const agent of agents) {
    const route = buildHostAgentDetailRoute(agent.serverId, agent.id);
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return `${agent.serverId}:${agent.id}`;
    }
  }
  return null;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  searchBar: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  scopeBar: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingBottom: theme.spacing[6],
  },
  sectionHeader: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
  },
  sectionHeaderText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: 0.6,
    color: theme.colors.foregroundMuted,
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
