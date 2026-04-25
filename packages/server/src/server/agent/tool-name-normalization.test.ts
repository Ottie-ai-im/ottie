import { describe, expect, it } from "vitest";

import { getOttieToolLeafName, isOttieToolName } from "./tool-name-normalization.js";

describe("isOttieToolName", () => {
  it("detects Claude Code format", () => {
    expect(isOttieToolName("mcp__ottie__create_agent")).toBe(true);
    expect(isOttieToolName("mcp__ottie__list_agents")).toBe(true);
  });

  it("detects ottie_voice variant", () => {
    expect(isOttieToolName("mcp__ottie_voice__create_agent")).toBe(true);
    expect(isOttieToolName("ottie_voice.create_agent")).toBe(true);
  });

  it("excludes speak tools", () => {
    expect(isOttieToolName("mcp__ottie_voice__speak")).toBe(false);
    expect(isOttieToolName("mcp__ottie__speak")).toBe(false);
    expect(isOttieToolName("ottie.speak")).toBe(false);
  });

  it("detects Codex dot format", () => {
    expect(isOttieToolName("ottie.create_agent")).toBe(true);
  });

  it("rejects non-ottie tools", () => {
    expect(isOttieToolName("Bash")).toBe(false);
    expect(isOttieToolName("Read")).toBe(false);
    expect(isOttieToolName("mcp__other_server__some_tool")).toBe(false);
  });
});

describe("getOttieToolLeafName", () => {
  it("extracts leaf from Claude Code format", () => {
    expect(getOttieToolLeafName("mcp__ottie__create_agent")).toBe("create_agent");
  });

  it("extracts leaf from Codex format", () => {
    expect(getOttieToolLeafName("ottie.create_agent")).toBe("create_agent");
    expect(getOttieToolLeafName("ottie.list_agents")).toBe("list_agents");
  });

  it("returns null for non-ottie tools", () => {
    expect(getOttieToolLeafName("Bash")).toBeNull();
  });
});
