// Per-agent client-only chat-row state.
//
// Pin / mute / unread / archived flags live in AsyncStorage under
// `@ottie:chat-row-state`. This store is intentionally NOT routed through the
// daemon (per Phase 02 CONTEXT Q1 — "client-only state recommendation"); the
// WebSocket schema is unchanged in Plan 02c so old clients keep working
// against new daemons (CLAUDE.md backward-compat rule).
//
// Schema follows `draft-store.ts` and `onboarding-state-store.ts` (zustand
// `persist` middleware + AsyncStorage). Row keys are
// `${serverId}:${agentId}` so the same agent id on different daemons stays
// distinct.
//
// Future plans may migrate this to a daemon-managed cross-device parity
// surface; the seam is intentionally narrow (single record, no cross-row
// invariants) to keep migration reversible.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const CHAT_ROW_STATE_STORAGE_KEY = "@ottie:chat-row-state";
const CHAT_ROW_STORE_VERSION = 2;

export interface ChatRowState {
  pinned: boolean;
  /** Wall-clock ms epoch when the row was last pinned. Null when not pinned. */
  pinnedAt: number | null;
  muted: boolean;
  /** Unread message count. Clamped to 0 — never negative. */
  unread: number;
  /**
   * Tasks completed since the user last opened this chat. Bumped each time the
   * agent transitions from `running` to a terminal state with
   * `attentionReason === "finished"`. Cleared when the agent detail mounts or
   * an explicit "mark seen" action fires. Surfaced as a blue badge in the chat
   * list (alongside the red unread badge). Clamped to 0 — never negative.
   */
  completedCount: number;
  archived: boolean;
}

interface ChatRowStoreState {
  /** Keyed by `${serverId}:${agentId}` — see `makeRowKey`. */
  rows: Record<string, ChatRowState>;
}

interface ChatRowStoreActions {
  getRowState: (rowKey: string) => ChatRowState;
  setPinned: (rowKey: string, pinned: boolean) => void;
  setMuted: (rowKey: string, muted: boolean) => void;
  setUnread: (rowKey: string, count: number) => void;
  incrementUnread: (rowKey: string) => void;
  markRead: (rowKey: string) => void;
  /** Bump completedCount by one. Called on agent `running → finished` transitions. */
  incrementCompleted: (rowKey: string) => void;
  /** Reset completedCount to 0. Called when the user opens the agent detail. */
  clearCompleted: (rowKey: string) => void;
  setArchived: (rowKey: string, archived: boolean) => void;
  remove: (rowKey: string) => void;
  /** Returns row keys that are currently pinned, sorted by pinnedAt desc. */
  getPinnedRowKeys: () => string[];
}

const DEFAULT: ChatRowState = {
  pinned: false,
  pinnedAt: null,
  muted: false,
  unread: 0,
  completedCount: 0,
  archived: false,
};

/**
 * Build the canonical row key. Composed of server + agent id so identical
 * agent ids on two different daemons don't collide.
 */
export function makeRowKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

export const useChatRowStateStore = create<ChatRowStoreState & ChatRowStoreActions>()(
  persist(
    (set, get) => ({
      rows: {},

      getRowState: (rowKey) => get().rows[rowKey] ?? DEFAULT,

      setPinned: (rowKey, pinned) =>
        set((state) => ({
          rows: {
            ...state.rows,
            [rowKey]: {
              ...(state.rows[rowKey] ?? DEFAULT),
              pinned,
              pinnedAt: pinned ? Date.now() : null,
            },
          },
        })),

      setMuted: (rowKey, muted) =>
        set((state) => ({
          rows: {
            ...state.rows,
            [rowKey]: {
              ...(state.rows[rowKey] ?? DEFAULT),
              muted,
            },
          },
        })),

      setUnread: (rowKey, count) =>
        set((state) => ({
          rows: {
            ...state.rows,
            [rowKey]: {
              ...(state.rows[rowKey] ?? DEFAULT),
              unread: Math.max(0, Math.floor(count)),
            },
          },
        })),

      incrementUnread: (rowKey) =>
        set((state) => {
          const previous = state.rows[rowKey] ?? DEFAULT;
          return {
            rows: {
              ...state.rows,
              [rowKey]: {
                ...previous,
                unread: previous.unread + 1,
              },
            },
          };
        }),

      markRead: (rowKey) =>
        set((state) => ({
          rows: {
            ...state.rows,
            [rowKey]: {
              ...(state.rows[rowKey] ?? DEFAULT),
              unread: 0,
            },
          },
        })),

      incrementCompleted: (rowKey) =>
        set((state) => {
          const previous = state.rows[rowKey] ?? DEFAULT;
          return {
            rows: {
              ...state.rows,
              [rowKey]: {
                ...previous,
                completedCount: previous.completedCount + 1,
              },
            },
          };
        }),

      clearCompleted: (rowKey) =>
        set((state) => {
          const previous = state.rows[rowKey];
          if (!previous || previous.completedCount === 0) return state;
          return {
            rows: {
              ...state.rows,
              [rowKey]: {
                ...previous,
                completedCount: 0,
              },
            },
          };
        }),

      setArchived: (rowKey, archived) =>
        set((state) => ({
          rows: {
            ...state.rows,
            [rowKey]: {
              ...(state.rows[rowKey] ?? DEFAULT),
              archived,
            },
          },
        })),

      remove: (rowKey) =>
        set((state) => {
          if (!(rowKey in state.rows)) return state;
          const next = { ...state.rows };
          delete next[rowKey];
          return { rows: next };
        }),

      getPinnedRowKeys: () => {
        const rows = get().rows;
        return Object.entries(rows)
          .filter(([, value]) => value.pinned)
          .sort(([, a], [, b]) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
          .map(([key]) => key);
      },
    }),
    {
      name: CHAT_ROW_STATE_STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      version: CHAT_ROW_STORE_VERSION,
      migrate: (persistedState, version) => {
        // v1 → v2: add `completedCount: 0` to every row.
        if (version < 2 && persistedState && typeof persistedState === "object") {
          const state = persistedState as { rows?: Record<string, Partial<ChatRowState>> };
          if (state.rows) {
            const upgraded: Record<string, ChatRowState> = {};
            for (const [key, row] of Object.entries(state.rows)) {
              upgraded[key] = { ...DEFAULT, ...row, completedCount: 0 };
            }
            return { ...state, rows: upgraded } as ChatRowStoreState & ChatRowStoreActions;
          }
        }
        return persistedState as ChatRowStoreState & ChatRowStoreActions;
      },
    },
  ),
);
