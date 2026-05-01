import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";

import { lintHardcodedColors, scanSourceForColorLiterals } from "./hardcoded-color";

const HERE = dirname(fileURLToPath(import.meta.url));

// Uses node:test (built-in) rather than vitest because the worktree path
// contains `.claude/` which the workspace vitest configs explicitly exclude.
// `node:test` has no exclude list and runs anywhere TypeScript can run via tsx.
// Run with: tsx --test tools/lint/hardcoded-color.test.ts

function makeTree(layout: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "hardcoded-color-"));
  for (const [path, contents] of Object.entries(layout)) {
    const abs = join(root, path);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, contents);
  }
  return root;
}

describe("scanSourceForColorLiterals (single-file)", () => {
  it("flags hex literals (#xxx and #xxxxxx and #xxxxxxxx)", () => {
    const src = [
      `const a = "#fff";`, // 3-digit hex
      `const b = "#1a1a1e";`, // 6-digit hex
      `const c = "#1a1a1eff";`, // 8-digit hex (with alpha)
    ].join("\n");
    const violations = scanSourceForColorLiterals(src, "fixture.ts");
    assert.equal(violations.length, 3);
    assert.deepEqual(
      violations.map((v) => v.snippet),
      ["#fff", "#1a1a1e", "#1a1a1eff"],
    );
  });

  it("flags rgb() and rgba() literals", () => {
    const src = `
      const fill = "rgba(255, 255, 255, 0.55)";
      const stroke = "rgb(0, 0, 0)";
    `;
    const violations = scanSourceForColorLiterals(src, "fixture.ts");
    assert.equal(violations.length, 2);
    assert.equal(violations[0]?.snippet, "rgba(");
    assert.equal(violations[1]?.snippet, "rgb(");
  });

  it("ignores lines that consume semantic tokens", () => {
    const src = [
      `const tint = theme.surface.glass.tint;`,
      `const muted = theme.text.muted;`,
      `const dot = theme.status.online;`,
    ].join("\n");
    const violations = scanSourceForColorLiterals(src, "fixture.ts");
    assert.equal(violations.length, 0);
  });

  it("reports 1-based line numbers", () => {
    const src = ["// header", "// blank", `const a = "#fff";`].join("\n");
    const violations = scanSourceForColorLiterals(src, "fixture.ts");
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.line, 3);
  });
});

describe("lintHardcodedColors (directory walk)", () => {
  it("flags hex literal in a non-tokens component file", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `export const c = "#1a1a1e";`,
    });
    const { count, violations } = lintHardcodedColors(root);
    assert.equal(count, 1);
    assert.equal(violations[0]?.file, "packages/app/src/components/foo.tsx");
  });

  it("ignores hex literals inside packages/app/src/styles/tokens/", () => {
    const root = makeTree({
      "packages/app/src/styles/tokens/primitives.ts": `export const palette = { white: "#ffffff" };`,
      "packages/app/src/components/foo.tsx": `export const c = "ok"; // no literal`,
    });
    const { count } = lintHardcodedColors(root);
    assert.equal(count, 0);
  });

  it("flags rgba() in a non-tokens file", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `export const fill = "rgba(0, 0, 0, 0.5)";`,
    });
    const { count } = lintHardcodedColors(root);
    assert.equal(count, 1);
  });

  it("does NOT flag a file consuming theme.surface.glass.tint", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `export function Foo() { return theme.surface.glass.tint; }`,
    });
    const { count } = lintHardcodedColors(root);
    assert.equal(count, 0);
  });
});

// CLI-level baseline behavior: count == baseline → exit 0;
// count > baseline → exit 1; count < baseline → exit 0 with re-baseline hint.
describe("hardcoded-color CLI baseline behavior", () => {
  const SCRIPT = resolvePath(HERE, "hardcoded-color.ts");

  function runCli(args: string[], cwd: string): { code: number; stderr: string } {
    const result = spawnSync("npx", ["--yes", "tsx", SCRIPT, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return {
      code: typeof result.status === "number" ? result.status : 1,
      stderr: result.stderr ?? "",
    };
  }

  it("exits 1 with helpful error when no baseline file exists", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `export const c = "#fff";`,
    });
    // Don't pre-create baseline.
    const { code, stderr } = runCli([], root);
    assert.equal(code, 1);
    assert.match(stderr, /No baseline/);
  });

  it("--write-baseline writes a numeric count and exits 0", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `export const c = "#fff";`,
    });
    const { code } = runCli(["--write-baseline"], root);
    assert.equal(code, 0);
    const baselinePath = join(root, "tools/lint/hardcoded-color.baseline.json");
    assert.equal(existsSync(baselinePath), true);
    const parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
    assert.equal(typeof parsed.count, "number");
    assert.equal(parsed.count, 1);
  });

  it("count == baseline → exit 0", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `export const c = "#fff";`,
    });
    runCli(["--write-baseline"], root); // capture baseline=1
    const { code } = runCli([], root);
    assert.equal(code, 0);
  });

  it("count > baseline → exit 1 with regression message", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `export const c = "#fff";`,
    });
    runCli(["--write-baseline"], root); // captures baseline=1
    // Add a new violation
    writeFileSync(
      join(root, "packages/app/src/components/bar.tsx"),
      `export const c = "rgba(0,0,0,0.5)";`,
    );
    const { code, stderr } = runCli([], root);
    assert.equal(code, 1);
    assert.match(stderr, /regress/);
  });

  it("count < baseline → exit 0 with re-baseline hint", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `export const a = "#fff";`,
      "packages/app/src/components/bar.tsx": `export const b = "#000";`,
    });
    runCli(["--write-baseline"], root); // baseline=2
    // Remove one violation
    writeFileSync(
      join(root, "packages/app/src/components/bar.tsx"),
      `export const b = theme.text.muted;`,
    );
    const { code, stderr } = runCli([], root);
    assert.equal(code, 0);
    assert.match(stderr, /count went DOWN/);
  });
});
