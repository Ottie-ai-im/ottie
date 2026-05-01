/**
 * Settings deep-link ActionRegistry registrations (Plan 02d).
 *
 * Registers the 6 `settings.open.{bucket}` ActionIds so cmd-K palette and
 * voice surfaces can deep-link directly to a 5-bucket sub-page (D-09) or the
 * Labs sub-page (D-10). `settings.open` itself is already registered by
 * `built-in-actions.ts` — don't duplicate it here.
 *
 * Pattern matches `chat-row-actions.ts`:
 *   - Idempotent `registerSettingsActions()` guarded by a module-scope flag.
 *   - Handlers resolve `router` and `host-routes` via dynamic `await import`
 *     so the static import graph stays minimal and registration cost is near
 *     zero — handlers pay the cost only when actually fired.
 *   - Side-effect `registerSettingsActions()` invocation at the bottom keeps
 *     this module register-on-first-import, same as the other actions modules.
 */

import { z } from "zod";
import { actionRegistry, defineAction } from "@/actions/registry";

const NoArgs = z.object({}).strict();

let registered = false;

/**
 * Idempotent registration. Called once at module load below. Tests that need
 * a clean registry should `vi.resetModules()` before importing.
 */
export function registerSettingsActions(): void {
  if (registered) return;
  registered = true;

  // ---------------------------------------------------------------------------
  // settings.open.{account|agents|voice|appearance|advanced} — 5 D-09 buckets.
  // Each opens the corresponding bucket sub-page via `buildSettingsBucketRoute`.
  // SET-03 contract: ≤2 taps from any screen via cmd-K → action.
  // ---------------------------------------------------------------------------

  actionRegistry.register(
    defineAction("settings.open.account", {
      description: "Open Account settings",
      modalities: ["cmdk", "voice"],
      schema: NoArgs,
      handler: async () => {
        const { router } = await import("expo-router");
        const { buildSettingsBucketRoute } = await import("@/utils/host-routes");
        router.push(buildSettingsBucketRoute("account"));
      },
    }),
  );

  actionRegistry.register(
    defineAction("settings.open.agents", {
      description: "Open Agents settings",
      modalities: ["cmdk", "voice"],
      schema: NoArgs,
      handler: async () => {
        const { router } = await import("expo-router");
        const { buildSettingsBucketRoute } = await import("@/utils/host-routes");
        router.push(buildSettingsBucketRoute("agents"));
      },
    }),
  );

  actionRegistry.register(
    defineAction("settings.open.voice", {
      description: "Open Voice settings",
      modalities: ["cmdk", "voice"],
      schema: NoArgs,
      handler: async () => {
        const { router } = await import("expo-router");
        const { buildSettingsBucketRoute } = await import("@/utils/host-routes");
        router.push(buildSettingsBucketRoute("voice"));
      },
    }),
  );

  actionRegistry.register(
    defineAction("settings.open.appearance", {
      description: "Open Appearance settings",
      modalities: ["cmdk", "voice"],
      schema: NoArgs,
      handler: async () => {
        const { router } = await import("expo-router");
        const { buildSettingsBucketRoute } = await import("@/utils/host-routes");
        router.push(buildSettingsBucketRoute("appearance"));
      },
    }),
  );

  actionRegistry.register(
    defineAction("settings.open.advanced", {
      description: "Open Advanced settings",
      modalities: ["cmdk", "voice"],
      schema: NoArgs,
      handler: async () => {
        const { router } = await import("expo-router");
        const { buildSettingsBucketRoute } = await import("@/utils/host-routes");
        router.push(buildSettingsBucketRoute("advanced"));
      },
    }),
  );

  // ---------------------------------------------------------------------------
  // settings.open.labs — direct Labs sub-page deep-link (D-10).
  // Routes through the existing `/settings/labs` slug rather than the new
  // bucket route so the registry-driven labs section continues to render
  // through `[section].tsx`.
  // ---------------------------------------------------------------------------

  actionRegistry.register(
    defineAction("settings.open.labs", {
      description: "Open Labs settings",
      modalities: ["cmdk", "voice"],
      schema: NoArgs,
      handler: async () => {
        const { router } = await import("expo-router");
        const { buildSettingsSectionRoute } = await import("@/utils/host-routes");
        router.push(buildSettingsSectionRoute("labs"));
      },
    }),
  );
}

// Side-effect: register on first import.
registerSettingsActions();
