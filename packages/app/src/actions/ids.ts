/**
 * ActionRegistry IDs — dotted.case hierarchy, mirrors the existing
 * `KeyboardActionId` pattern in `packages/app/src/keyboard/actions.ts`.
 *
 * The minimum NAT-01 reference set is the 6 actions enforced by
 * `registry.parity.test.ts`. Per Plan 02a (D-08), this union is extended in
 * Plan 02c (chat-row context-menu items + add-menu items) and Plan 02d
 * (settings deep-link actions). New IDs should be added in alphabetical order
 * within their group.
 */
export type ActionId =
  // NAT-01 minimum reference set (6)
  | "agent.create"
  | "workspace.switch"
  | "session.jump.recent"
  | "permission.decide"
  | "settings.open"
  | "theme.cycle"
  // Chat-row context menu (D-04 — registered by Plan 02c)
  | "chat.menu.pin"
  | "chat.menu.unpin"
  | "chat.menu.markUnread"
  | "chat.menu.markRead"
  | "chat.menu.mute"
  | "chat.menu.unmute"
  | "chat.menu.delete"
  | "chat.menu.rename"
  | "chat.menu.archive"
  // Top-right add menu (D-04 — registered by Plan 02c)
  | "chat.add.newChat"
  | "chat.add.scanToPair"
  | "chat.add.joinHost"
  | "chat.add.createWorkspace"
  // Settings deep-link buckets (D-09 / SET-03 — registered by Plan 02d)
  | "settings.open.account"
  | "settings.open.agents"
  | "settings.open.voice"
  | "settings.open.appearance"
  | "settings.open.advanced"
  | "settings.open.labs";

/**
 * Stable list of every ActionId. Order does not affect dispatch — it only
 * affects iteration in tests / dev tooling. Keep grouped by the same blocks
 * as the union above.
 */
export const ALL_ACTION_IDS: readonly ActionId[] = [
  "agent.create",
  "workspace.switch",
  "session.jump.recent",
  "permission.decide",
  "settings.open",
  "theme.cycle",
  "chat.menu.pin",
  "chat.menu.unpin",
  "chat.menu.markUnread",
  "chat.menu.markRead",
  "chat.menu.mute",
  "chat.menu.unmute",
  "chat.menu.delete",
  "chat.menu.rename",
  "chat.menu.archive",
  "chat.add.newChat",
  "chat.add.scanToPair",
  "chat.add.joinHost",
  "chat.add.createWorkspace",
  "settings.open.account",
  "settings.open.agents",
  "settings.open.voice",
  "settings.open.appearance",
  "settings.open.advanced",
  "settings.open.labs",
] as const;
