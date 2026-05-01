/**
 * Regression test: each NAT-01 reference action is registered in the shared
 * `actionRegistry` so voice / keyboard / cmdk / menu surfaces can dispatch
 * by id.
 *
 * Plan 02a Task 2 Test 2: importing `built-in-actions.ts` (which is also
 * imported by voice-commands.ts) registers the 6 NAT-01 reference actions on
 * module load.
 *
 * Plan 02a Task 2 Test 3: smoke for `searchActions("settings.open")`.
 *
 * We import `built-in-actions` directly (not voice-commands.ts) because
 * voice-commands.ts pulls in expo-router .tsx files that the vitest pipeline
 * does not transform. Both modules register the same actions; the contract
 * we care about — "the 6 reference ids are dispatchable by anyone" — is
 * captured by either entry point.
 */
import { describe, it, expect } from "vitest";

describe("built-in-actions → actionRegistry routing", () => {
  it("Test 2 — importing built-in-actions.ts registers the 6 NAT-01 reference actions", async () => {
    // Side-effect import: registration happens at module load.
    await import("@/actions/built-in-actions");
    const { actionRegistry } = await import("@/actions/registry");
    const ids = new Set(actionRegistry.list().map((a) => a.id));
    expect(ids.has("agent.create")).toBe(true);
    expect(ids.has("workspace.switch")).toBe(true);
    expect(ids.has("session.jump.recent")).toBe(true);
    expect(ids.has("permission.decide")).toBe(true);
    expect(ids.has("settings.open")).toBe(true);
    expect(ids.has("theme.cycle")).toBe(true);
  });

  it("Test 3 — registered settings.open action is reachable from kbd + cmdk modalities", async () => {
    await import("@/actions/built-in-actions");
    const { actionRegistry } = await import("@/actions/registry");
    const settingsResults = actionRegistry.searchActions("settings.open");
    const settings = settingsResults.find((a) => a.id === "settings.open");
    expect(settings).toBeDefined();
    expect(settings?.modalities).toContain("kbd");
    expect(settings?.modalities).toContain("cmdk");
  });
});
