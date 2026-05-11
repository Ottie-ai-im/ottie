import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter, type Href } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, MessageCircle } from "lucide-react-native";

import { WechatSetupWizard } from "@/components/wechat/wechat-setup-wizard";
import { useSidebarWechatSessions } from "@/hooks/use-sidebar-wechat-sessions";
import type { WechatSession } from "@server/server/wechat/wechat-types";

interface SidebarWechatListProps {
  serverId: string | null;
}

/**
 * 4th sidebar section content. Splits sessions into two collapsible
 * sub-groups under the WeChat header — Direct messages (private) and
 * Groups — so the user can fold the noisy group list and keep contacts
 * visible. Visually a tree: sub-headers are slightly indented, items
 * indented further. Both default to expanded; collapsed state lives
 * in component state and resets on app reload (persistence is a
 * follow-up if it surfaces in feedback).
 *
 * Mirrors `SidebarHumansList` for paddings + hover behavior so the
 * tree feels native to the rest of the sidebar.
 */
export function SidebarWechatList({ serverId }: SidebarWechatListProps) {
  const { t } = useTranslation();
  const summary = useSidebarWechatSessions(serverId);

  const [privateCollapsed, setPrivateCollapsed] = useState(false);
  const [groupCollapsed, setGroupCollapsed] = useState(false);
  const togglePrivate = useCallback(() => setPrivateCollapsed((p) => !p), []);
  const toggleGroup = useCallback(() => setGroupCollapsed((p) => !p), []);

  const { privateSessions, groupSessions } = useMemo(() => {
    const priv: WechatSession[] = [];
    const grp: WechatSession[] = [];
    for (const session of summary.sessions) {
      const kind = session.chat_type ?? "private";
      if (kind === "group") grp.push(session);
      else priv.push(session);
    }
    return { privateSessions: priv, groupSessions: grp };
  }, [summary.sessions]);

  if (!serverId) {
    return null;
  }

  if (summary.status === "loading") {
    return (
      <View style={styles.emptyBlock}>
        <Text style={styles.emptyText}>{t("sidebar.wechat.loading")}</Text>
      </View>
    );
  }

  if (summary.status === "unavailable") {
    // Daemon couldn't reach wx-cli. The wizard reads `wechat/state` to
    // figure out which Terminal step is missing and renders the right
    // copyable command — much more useful than a flat "unavailable".
    return <WechatSetupWizard serverId={serverId} />;
  }

  if (summary.sessions.length === 0) {
    return (
      <View style={styles.emptyBlock}>
        <Text style={styles.emptyText}>{t("sidebar.wechat.empty")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.tree}>
      <Subsection
        label={t("sidebar.wechat.private")}
        count={privateSessions.length}
        collapsed={privateCollapsed}
        onToggle={togglePrivate}
        sessions={privateSessions}
        serverId={serverId}
      />
      <Subsection
        label={t("sidebar.wechat.group")}
        count={groupSessions.length}
        collapsed={groupCollapsed}
        onToggle={toggleGroup}
        sessions={groupSessions}
        serverId={serverId}
      />
    </View>
  );
}

interface SubsectionProps {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  sessions: readonly WechatSession[];
  serverId: string;
}

function Subsection({ label, count, collapsed, onToggle, sessions, serverId }: SubsectionProps) {
  const { theme } = useUnistyles();
  // Empty branch still rendered so the user understands the tree
  // structure (and so the count "0" is visible — clearer than a
  // missing branch). Collapsed-by-default would hide that signal.
  const headerStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.subHeader,
      hovered ? styles.subHeaderHovered : null,
    ],
    [],
  );
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);

  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        style={headerStyle}
      >
        <Chevron size={12} color={theme.colors.foregroundMuted} />
        <Text style={styles.subHeaderLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.subHeaderCount} numberOfLines={1}>
          {count}
        </Text>
      </Pressable>
      {collapsed ? null : (
        <View style={styles.subList}>
          {sessions.length === 0 ? (
            <Text style={styles.subEmptyText}>—</Text>
          ) : (
            sessions.map((session) => (
              <SidebarWechatItem key={sessionKey(session)} session={session} serverId={serverId} />
            ))
          )}
        </View>
      )}
    </View>
  );
}

interface SidebarWechatItemProps {
  session: WechatSession;
  serverId: string;
}

function SidebarWechatItem({ session, serverId }: SidebarWechatItemProps) {
  const { theme } = useUnistyles();
  const router = useRouter();

  const handlePress = useCallback(() => {
    const id = session.username ?? session.chat;
    if (!id) return;
    router.push(`/h/${encodeURIComponent(serverId)}/wechat/${encodeURIComponent(id)}` as Href);
  }, [router, serverId, session.chat, session.username]);

  const buttonStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.item,
      hovered ? styles.itemHovered : null,
    ],
    [],
  );

  const label = session.chat ?? session.username ?? "—";
  const unread = session.unread ?? 0;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={buttonStyle}
    >
      <MessageCircle size={14} color={theme.colors.foregroundMuted} />
      <Text style={styles.itemLabel} numberOfLines={1}>
        {label}
      </Text>
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {unread > 99 ? "99+" : String(unread)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Stable React key for a session row. Prefer wxid (immutable) when
 * present; fall back to display name (mutable, but unique among the
 * unread set at any given moment). Both being absent is a wx-cli regress
 * we don't try to recover from — the row gets a generic key and React
 * will warn at runtime, surfacing the schema drift.
 */
function sessionKey(session: WechatSession): string {
  return session.username ?? session.chat ?? "wechat-row";
}

const styles = StyleSheet.create((theme) => ({
  tree: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    gap: theme.spacing[1],
  },
  subHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.sm,
    borderCurve: "continuous",
    minHeight: 24,
  },
  subHeaderHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  subHeaderLabel: {
    flex: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  subHeaderCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  subList: {
    // Indent items further than the sub-header so the tree hierarchy
    // reads visually without an explicit guide line.
    paddingLeft: theme.spacing[2],
    gap: 2,
    marginTop: 2,
  },
  subEmptyText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.sm,
    borderCurve: "continuous",
    minHeight: 28,
  },
  itemHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  itemLabel: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  badge: {
    minWidth: 18,
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 1,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.medium,
  },
  emptyBlock: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  emptyText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
}));
