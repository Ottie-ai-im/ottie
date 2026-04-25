#!/usr/bin/env npx tsx

import assert from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveOttieHomePath, resolveOttieWorktreesDir } from "../src/commands/worktree/ls.js";

console.log("=== Worktree LS Path Helper Tests ===\n");

const originalOttieHome = process.env.OTTIE_HOME;

try {
  {
    console.log("Test 1: resolves explicit OTTIE_HOME when set");
    process.env.OTTIE_HOME = "/tmp/ottie-explicit-home";

    assert.strictEqual(resolveOttieHomePath(), "/tmp/ottie-explicit-home");
    assert.strictEqual(resolveOttieWorktreesDir(), "/tmp/ottie-explicit-home/worktrees");
    console.log("\u2713 explicit OTTIE_HOME is respected\n");
  }

  {
    console.log("Test 2: falls back to homedir/.ottie when OTTIE_HOME is unset");
    delete process.env.OTTIE_HOME;

    assert.strictEqual(resolveOttieHomePath(), join(homedir(), ".ottie"));
    assert.strictEqual(resolveOttieWorktreesDir(), join(homedir(), ".ottie", "worktrees"));
    console.log("\u2713 fallback home path is derived from os.homedir()\n");
  }
} finally {
  if (originalOttieHome === undefined) {
    delete process.env.OTTIE_HOME;
  } else {
    process.env.OTTIE_HOME = originalOttieHome;
  }
}

console.log("=== All worktree ls path helper tests passed ===");
