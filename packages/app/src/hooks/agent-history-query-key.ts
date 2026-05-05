// Query key factory for the agent history list.
//
// The default key (`["agentHistory", serverId]`) corresponds to the *active*
// chat list — archived agents are filtered out by the daemon. When the user
// flips the "show archived" toggle, the hook switches to a separate query
// keyed `["agentHistory", serverId, "archived"]` so React Query keeps the
// two caches independent and the active-list mutations (archive / unarchive
// optimistic updates) don't accidentally invalidate the archived cache.
export function agentHistoryQueryKey(
  serverId: string | null,
  options?: { includeArchived?: boolean },
) {
  if (options?.includeArchived) {
    return ["agentHistory", serverId, "archived"] as const;
  }
  return ["agentHistory", serverId] as const;
}
