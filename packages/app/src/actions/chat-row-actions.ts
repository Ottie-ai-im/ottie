// Chat-row + top-right add-menu ActionRegistry registrations.
//
// 8 chat.menu.* + 4 chat.add.* + 1 alias for unmute/unpin = 13 total
// `actionRegistry.register` calls.
//
// Pattern follows `built-in-actions.ts` (Plan 02a):
//   - Idempotent `registerChatRowActions()` guarded by a module-scope flag so
//     test contexts that import this module multiple times don't double-
//     register (last-writer-wins is intentional but the parity test expects
//     each id present exactly once).
//   - Handlers use dynamic `await import(...)` for router / store dependencies
//     to keep the static import graph minimal — registration cost is near
//     zero, payload is paid only when a handler actually fires.
//
// Per CONTEXT Q1 these handlers are CLIENT-ONLY — pin/mute/unread state goes
// to AsyncStorage via `useChatRowStateStore`. No daemon WebSocket schema is
// touched.

import { z } from "zod";
import { actionRegistry, defineAction } from "@/actions/registry";

const RowKeyPayload = z
  .object({
    serverId: z.string().min(1),
    agentId: z.string().min(1),
  })
  .strict();

const OptionalServerPayload = z
  .object({
    serverId: z.string().optional(),
  })
  .strict();

const NoArgs = z.object({}).strict();

let registered = false;

/**
 * Idempotent registration. Called once at module load below. Tests that need
 * a clean registry should `vi.resetModules()` before importing.
 */
export function registerChatRowActions(): void {
  if (registered) return;
  registered = true;

  // ---------------------------------------------------------------------------
  // chat.menu.* — context-menu actions (long-press on native, right-click on
  // web). All take `{ serverId, agentId }` so dispatch is row-targeted.
  // ---------------------------------------------------------------------------

  actionRegistry.register(
    defineAction("chat.menu.pin", {
      description: "Pin chat row to the top of the chats list",
      modalities: ["menu", "cmdk"],
      schema: RowKeyPayload,
      handler: async ({ serverId, agentId }) => {
        const { useChatRowStateStore, makeRowKey } = await import("@/stores/chat-row-state-store");
        useChatRowStateStore.getState().setPinned(makeRowKey(serverId, agentId), true);
      },
    }),
  );

  actionRegistry.register(
    defineAction("chat.menu.unpin", {
      description: "Unpin chat row",
      modalities: ["menu", "cmdk"],
      schema: RowKeyPayload,
      handler: async ({ serverId, agentId }) => {
        const { useChatRowStateStore, makeRowKey } = await import("@/stores/chat-row-state-store");
        useChatRowStateStore.getState().setPinned(makeRowKey(serverId, agentId), false);
      },
    }),
  );

  actionRegistry.register(
    defineAction("chat.menu.markUnread", {
      description: "Mark chat as unread (badge count goes to 1)",
      modalities: ["menu", "cmdk", "gesture"],
      schema: RowKeyPayload,
      handler: async ({ serverId, agentId }) => {
        const { useChatRowStateStore, makeRowKey } = await import("@/stores/chat-row-state-store");
        useChatRowStateStore.getState().setUnread(makeRowKey(serverId, agentId), 1);
      },
    }),
  );

  actionRegistry.register(
    defineAction("chat.menu.markRead", {
      description: "Mark chat as read (clears the unread badge)",
      modalities: ["menu", "cmdk", "gesture"],
      schema: RowKeyPayload,
      handler: async ({ serverId, agentId }) => {
        const { useChatRowStateStore, makeRowKey } = await import("@/stores/chat-row-state-store");
        useChatRowStateStore.getState().markRead(makeRowKey(serverId, agentId));
      },
    }),
  );

  actionRegistry.register(
    defineAction("chat.menu.mute", {
      description: "Mute chat notifications (badge fades to neutral color)",
      modalities: ["menu", "cmdk", "gesture"],
      schema: RowKeyPayload,
      handler: async ({ serverId, agentId }) => {
        const { useChatRowStateStore, makeRowKey } = await import("@/stores/chat-row-state-store");
        useChatRowStateStore.getState().setMuted(makeRowKey(serverId, agentId), true);
      },
    }),
  );

  actionRegistry.register(
    defineAction("chat.menu.unmute", {
      description: "Unmute chat notifications",
      modalities: ["menu", "cmdk"],
      schema: RowKeyPayload,
      handler: async ({ serverId, agentId }) => {
        const { useChatRowStateStore, makeRowKey } = await import("@/stores/chat-row-state-store");
        useChatRowStateStore.getState().setMuted(makeRowKey(serverId, agentId), false);
      },
    }),
  );

  actionRegistry.register(
    defineAction("chat.menu.delete", {
      description: "Delete chat from the local chats list",
      modalities: ["menu", "gesture"],
      schema: RowKeyPayload,
      // Note: full delete flow including the undo-toast is wired by the row
      // component. This handler removes the local row state — the actual
      // archive call (when the daemon is connected) lives in the row press
      // handler so the user-visible undo can surface.
      handler: async ({ serverId, agentId }) => {
        const { useChatRowStateStore, makeRowKey } = await import("@/stores/chat-row-state-store");
        useChatRowStateStore.getState().remove(makeRowKey(serverId, agentId));
      },
    }),
  );

  actionRegistry.register(
    defineAction("chat.menu.rename", {
      description: "Rename chat (opens the rename modal)",
      modalities: ["menu", "cmdk"],
      schema: RowKeyPayload,
      // Rename modal is opened by the consumer (sessions-screen.tsx) — the
      // registry entry exists so cmdk / voice surfaces can discover the
      // action even when no row is the active anchor. The cmdk consumer
      // surfaces the rename modal once a row is selected.
      handler: () => {
        /* opens rename modal — wired by sessions-screen */
      },
    }),
  );

  actionRegistry.register(
    defineAction("chat.menu.archive", {
      description: "Archive chat (hides from the active list)",
      modalities: ["menu", "cmdk"],
      schema: RowKeyPayload,
      handler: async ({ serverId, agentId }) => {
        const { useChatRowStateStore, makeRowKey } = await import("@/stores/chat-row-state-store");
        useChatRowStateStore.getState().setArchived(makeRowKey(serverId, agentId), true);
      },
    }),
  );

  actionRegistry.register(
    defineAction("chat.menu.unarchive", {
      description: "Restore an archived chat — resumes the agent from persistence",
      modalities: ["menu", "cmdk"],
      schema: RowKeyPayload,
      handler: async ({ serverId, agentId }) => {
        const { getHostRuntimeStore } = await import("@/runtime/host-runtime");
        const client = getHostRuntimeStore().getClient(serverId);
        if (!client) {
          // Daemon not connected — clear the local archive flag so the row
          // resurfaces; the agent will fully reload on the next connection.
          const { useChatRowStateStore, makeRowKey } =
            await import("@/stores/chat-row-state-store");
          useChatRowStateStore.getState().setArchived(makeRowKey(serverId, agentId), false);
          return;
        }
        // refreshAgent: unarchive on daemon, resume from persistence,
        // hydrate timeline. See packages/server/src/server/session.ts:3172
        // (handleRefreshAgentRequest) for the server-side flow.
        await client.refreshAgent(agentId);
        const { useChatRowStateStore, makeRowKey } = await import("@/stores/chat-row-state-store");
        useChatRowStateStore.getState().setArchived(makeRowKey(serverId, agentId), false);
      },
    }),
  );

  // ---------------------------------------------------------------------------
  // chat.add.* — top-right "+ menu" actions (4 items). Most delegate to
  // existing flows — registry entry keeps cmdk / voice / NAT-01 in parity.
  // ---------------------------------------------------------------------------

  actionRegistry.register(
    defineAction("chat.add.newChat", {
      description: "Create a new chat (opens the project picker)",
      modalities: ["menu", "cmdk", "voice", "kbd"],
      schema: OptionalServerPayload,
      handler: async () => {
        const { useKeyboardShortcutsStore } = await import("@/stores/keyboard-shortcuts-store");
        useKeyboardShortcutsStore.getState().setProjectPickerOpen(true);
      },
    }),
  );

  actionRegistry.register(
    defineAction("chat.add.scanToPair", {
      description: "Scan QR code to pair a host",
      modalities: ["menu", "cmdk"],
      schema: NoArgs,
      handler: async () => {
        const { router } = await import("expo-router");
        router.push("/pair-scan");
      },
    }),
  );

  actionRegistry.register(
    defineAction("chat.add.joinHost", {
      description: "Join an existing host (opens settings → add host)",
      modalities: ["menu", "cmdk"],
      schema: NoArgs,
      handler: async () => {
        // Add-host modal is owned by `settings-screen.tsx` (search the file
        // for "settings-add-host"); deep-linking there is the least-surprise
        // surface. A future polish plan can add an inline modal that
        // surfaces from the chats screen directly.
        const { router } = await import("expo-router");
        const { buildSettingsRoute } = await import("@/utils/host-routes");
        router.push(buildSettingsRoute());
      },
    }),
  );

  actionRegistry.register(
    defineAction("chat.add.createWorkspace", {
      description: "Create a new workspace (opens the project picker)",
      modalities: ["menu", "cmdk", "voice"],
      schema: OptionalServerPayload,
      handler: async () => {
        // Workspace setup requires a project to attach to first, so the
        // discoverable entry point on the Chats tab is the project picker —
        // identical surface to `agent.create`. Once a project is selected
        // the existing setup-dialog flow takes over (see workspace-screen).
        const { useKeyboardShortcutsStore } = await import("@/stores/keyboard-shortcuts-store");
        useKeyboardShortcutsStore.getState().setProjectPickerOpen(true);
      },
    }),
  );

  // Phase 2.c-ui — open the "Add device" QR screen for the current host.
  // serverId is required so the new screen can call device/link/generate
  // against the right daemon; without it we fall through to the generic
  // identity settings page which has its own Add device button.
  actionRegistry.register(
    defineAction("chat.add.addDevice", {
      description: "Add another device under your identity (opens QR screen)",
      modalities: ["menu", "cmdk"],
      schema: OptionalServerPayload,
      handler: async (payload) => {
        const { router } = await import("expo-router");
        const serverId = payload?.serverId;
        if (typeof serverId === "string" && serverId.length > 0) {
          router.push({
            pathname: "/onboarding/add-device",
            params: { serverId },
          });
        } else {
          router.push("/settings/identity");
        }
      },
    }),
  );
}

// Side-effect: register on first import.
registerChatRowActions();
