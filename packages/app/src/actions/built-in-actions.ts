/**
 * Built-in NAT-01 reference actions.
 *
 * Registers the 6 minimum action ids enforced by `registry.parity.test.ts`:
 *
 *   - agent.create
 *   - workspace.switch
 *   - session.jump.recent
 *   - permission.decide
 *   - settings.open
 *   - theme.cycle
 *
 * Why a separate module from `voice-control/voice-commands.ts`?
 *
 *   1. Tests can import this module without pulling in the entire voice-runtime
 *      stack (expo-router .tsx, voice-command-bridge react components, etc.).
 *   2. Each handler resolves `router` / stores via dynamic import so the static
 *      import graph stays minimal — registration is a near-zero cost,
 *      handlers pay the cost only when actually fired.
 *
 * Plan 02c will register chat-row context-menu actions; Plan 02d will register
 * settings-deep-link actions. Both should follow this same pattern: a
 * side-effect module + a `registerBuiltInActions`-style entry point.
 */
import { z } from "zod";
import { actionRegistry, defineAction } from "@/actions/registry";

let registered = false;

/**
 * Idempotent registration. Called once at module load below; tests that need
 * a clean registry should `vi.resetModules()` before importing.
 */
export function registerBuiltInActions(): void {
  if (registered) return;
  registered = true;

  // ---------------------------------------------------------------------------
  // agent.create — voice + cmdk + menu + kbd
  // Opens the project picker to create a new agent. Mirrors the
  // command-center "new-agent" action in `use-command-center.ts`.
  // ---------------------------------------------------------------------------
  actionRegistry.register(
    defineAction("agent.create", {
      description: "Create a new agent / open the project picker",
      modalities: ["voice", "kbd", "cmdk", "menu"],
      schema: z.object({}).strict(),
      handler: async () => {
        const { useKeyboardShortcutsStore } = await import("@/stores/keyboard-shortcuts-store");
        useKeyboardShortcutsStore.getState().setProjectPickerOpen(true);
      },
    }),
  );

  // ---------------------------------------------------------------------------
  // workspace.switch — voice + cmdk + menu
  // Navigates to a workspace by serverId + workspaceId.
  // ---------------------------------------------------------------------------
  actionRegistry.register(
    defineAction("workspace.switch", {
      description: "Switch the active workspace",
      modalities: ["voice", "cmdk", "menu"],
      schema: z
        .object({
          serverId: z.string().min(1),
          workspaceId: z.string().min(1),
        })
        .strict(),
      handler: async ({ serverId, workspaceId }) => {
        const { router } = await import("expo-router");
        const { buildHostWorkspaceRoute } = await import("@/utils/host-routes");
        router.navigate(buildHostWorkspaceRoute(serverId, workspaceId));
      },
    }),
  );

  // ---------------------------------------------------------------------------
  // session.jump.recent — voice + cmdk + kbd
  // Opens the command center scrolled to recent agents (the existing cmdk
  // panel already shows agents — this just opens it).
  // ---------------------------------------------------------------------------
  actionRegistry.register(
    defineAction("session.jump.recent", {
      description: "Jump to a recent session",
      modalities: ["voice", "cmdk", "kbd"],
      schema: z.object({}).strict(),
      handler: async () => {
        const { useKeyboardShortcutsStore } = await import("@/stores/keyboard-shortcuts-store");
        useKeyboardShortcutsStore.getState().setCommandCenterOpen(true);
      },
    }),
  );

  // ---------------------------------------------------------------------------
  // permission.decide — voice + menu + kbd
  // Approves or denies the active permission request. Plan 02c wires the
  // actual permission-store action; for now this is a no-op shim that
  // satisfies the parity contract (modalities + locale presence) without
  // overstepping into Plan 03's ARCH-01 work.
  // ---------------------------------------------------------------------------
  actionRegistry.register(
    defineAction("permission.decide", {
      description: "Approve or deny the active permission request",
      modalities: ["voice", "menu", "kbd"],
      schema: z
        .object({
          decision: z.enum(["approve", "deny"]).optional(),
        })
        .strict(),
      handler: () => {
        // Wired in Plan 02c (chat-row context menu) via permission-store.
        // No-op here keeps the action discoverable for cmdk + voice without
        // duplicating logic that doesn't exist yet.
      },
    }),
  );

  // ---------------------------------------------------------------------------
  // settings.open — voice + cmdk + kbd
  // Navigates to /settings.
  // ---------------------------------------------------------------------------
  actionRegistry.register(
    defineAction("settings.open", {
      description: "Open the settings screen",
      modalities: ["voice", "cmdk", "kbd"],
      schema: z.object({}).strict(),
      handler: async () => {
        const { router } = await import("expo-router");
        const { buildSettingsRoute } = await import("@/utils/host-routes");
        router.push(buildSettingsRoute());
      },
    }),
  );

  // ---------------------------------------------------------------------------
  // theme.cycle — voice + cmdk + kbd
  // Cycles the theme through light → dark → system. Wires to the existing
  // keyboard "theme.cycle" handler if registered; otherwise a no-op.
  // ---------------------------------------------------------------------------
  actionRegistry.register(
    defineAction("theme.cycle", {
      description: "Cycle the app theme (light / dark / system)",
      modalities: ["voice", "cmdk", "kbd"],
      schema: z.object({}).strict(),
      handler: async () => {
        // Defer to the existing keyboard dispatcher which knows how to cycle
        // theme. If no handler is registered yet (during early module load),
        // the dispatch returns false silently.
        const { keyboardActionDispatcher } = await import("@/keyboard/keyboard-action-dispatcher");
        keyboardActionDispatcher.dispatch({
          // The keyboard dispatcher's KeyboardActionDefinition union doesn't
          // include "theme.cycle" yet (only the existing scoped actions),
          // but cast is safe — handlers filter by id, mismatched ids return
          // false and we accept that no-op.
          id: "theme.cycle" as never,
          scope: "global" as never,
        });
      },
    }),
  );
}

// Side-effect: register on first import.
registerBuiltInActions();
