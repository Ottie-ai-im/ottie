import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { defineAction, createActionRegistry, type ActionId } from "@/actions/registry";

describe("ActionRegistry", () => {
  it("Test 1 — defineAction returns an Action whose id matches the provided id", () => {
    const action = defineAction("agent.create", {
      description: "Create a new agent",
      modalities: ["voice", "kbd", "cmdk", "menu"],
      schema: z.object({}).strict(),
      handler: () => undefined,
    });
    expect(action.id).toBe("agent.create" satisfies ActionId);
    expect(action.modalities).toEqual(["voice", "kbd", "cmdk", "menu"]);
  });

  it("Test 2 — registry.register makes getActionById return the action", () => {
    const registry = createActionRegistry();
    const action = defineAction("agent.create", {
      description: "Create a new agent",
      modalities: ["voice", "kbd"],
      schema: z.object({}).strict(),
      handler: () => undefined,
    });
    registry.register(action);
    expect(registry.getActionById("agent.create")?.id).toBe("agent.create");
  });

  it("Test 3 — dispatch invokes the registered handler exactly once with the parsed payload", async () => {
    const registry = createActionRegistry();
    const handler = vi.fn();
    const action = defineAction("workspace.switch", {
      description: "Switch workspace",
      modalities: ["voice", "kbd", "cmdk"],
      schema: z.object({ workspaceId: z.string().min(1) }).strict(),
      handler,
    });
    registry.register(action);
    const result = await registry.dispatch("workspace.switch", { workspaceId: "ws-1" });
    expect(result).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ workspaceId: "ws-1" });
  });

  it("Test 4 — dispatch on an unregistered id returns false and does not throw", async () => {
    const registry = createActionRegistry();
    const result = await registry.dispatch(
      // not registered yet
      "agent.create",
      {},
    );
    expect(result).toBe(false);
  });

  it("Test 5 — searchActions returns actions whose id or description matches", () => {
    const registry = createActionRegistry();
    registry.register(
      defineAction("agent.create", {
        description: "Create a new agent",
        modalities: ["voice", "kbd"],
        schema: z.object({}).strict(),
        handler: () => undefined,
      }),
    );
    registry.register(
      defineAction("settings.open", {
        description: "Open the settings screen",
        modalities: ["voice", "kbd", "cmdk"],
        schema: z.object({}).strict(),
        handler: () => undefined,
      }),
    );
    const matchById = registry.searchActions("agent");
    expect(matchById.map((a) => a.id)).toContain("agent.create");

    const matchByDescription = registry.searchActions("settings");
    expect(matchByDescription.map((a) => a.id)).toContain("settings.open");

    const empty = registry.searchActions("");
    expect(empty.length).toBe(2);
  });

  it("dispatch rejects payloads that fail schema validation without throwing", async () => {
    const registry = createActionRegistry();
    const handler = vi.fn();
    registry.register(
      defineAction("workspace.switch", {
        description: "Switch workspace",
        modalities: ["voice", "kbd"],
        schema: z.object({ workspaceId: z.string().min(1) }).strict(),
        handler,
      }),
    );
    // Missing the required workspaceId
    const result = await registry.dispatch("workspace.switch", {});
    expect(result).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});
