import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";

import { lintPointerEventsWebOnly, scanSourceForPointerEvents } from "./pointer-events-web-only";

const HERE = dirname(fileURLToPath(import.meta.url));

// Uses node:test (built-in) rather than vitest because the worktree path
// contains `.claude/` which the workspace vitest configs explicitly exclude.
// Run with: tsx --test tools/lint/pointer-events-web-only.test.ts

function makeTree(layout: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "pointer-events-"));
  for (const [path, contents] of Object.entries(layout)) {
    const abs = join(root, path);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, contents);
  }
  return root;
}

describe("scanSourceForPointerEvents (single-file)", () => {
  it("flags raw onPointerEnter={fn}", () => {
    const src = `<View onPointerEnter={handlePointerEnter} />`;
    const violations = scanSourceForPointerEvents(src, "fixture.tsx");
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.prop, "onPointerEnter");
  });

  it("flags raw onPointerLeave={fn}", () => {
    const src = `<View onPointerLeave={handlePointerLeave} />`;
    const violations = scanSourceForPointerEvents(src, "fixture.tsx");
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.prop, "onPointerLeave");
  });

  it("does NOT flag isWeb-gated onPointerEnter", () => {
    const src = `<View onPointerEnter={isWeb ? handler : undefined} />`;
    const violations = scanSourceForPointerEvents(src, "fixture.tsx");
    assert.equal(violations.length, 0);
  });

  it("does NOT flag isWeb-gated onPointerLeave", () => {
    const src = `<View onPointerLeave={isWeb ? handler : undefined} />`;
    const violations = scanSourceForPointerEvents(src, "fixture.tsx");
    assert.equal(violations.length, 0);
  });

  it("does NOT flag onPointerDown — rule only catches Enter/Leave", () => {
    const src = `<View onPointerDown={handlePointerDown} />`;
    const violations = scanSourceForPointerEvents(src, "fixture.tsx");
    assert.equal(violations.length, 0);
  });

  it("flags both Enter and Leave on adjacent lines", () => {
    const src = [
      `<View`,
      `  onPointerEnter={handlePointerEnter}`,
      `  onPointerLeave={handlePointerLeave}`,
      `/>`,
    ].join("\n");
    const violations = scanSourceForPointerEvents(src, "fixture.tsx");
    assert.equal(violations.length, 2);
  });

  it("reports 1-based line numbers", () => {
    const src = ["// header", "// blank", `<View onPointerEnter={fn} />`].join("\n");
    const violations = scanSourceForPointerEvents(src, "fixture.tsx");
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.line, 3);
  });
});

describe("lintPointerEventsWebOnly (directory walk)", () => {
  it("flags raw onPointerEnter in a non-web component file", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `<View onPointerEnter={fn} />`,
    });
    const { count, violations } = lintPointerEventsWebOnly(root);
    assert.equal(count, 1);
    assert.equal(violations[0]?.file, "packages/app/src/components/foo.tsx");
  });

  it("does NOT flag .web.tsx files (DOM pointer legitimately works)", () => {
    const root = makeTree({
      "packages/app/src/components/foo.web.tsx": `<View onPointerEnter={fn} />`,
    });
    const { count } = lintPointerEventsWebOnly(root);
    assert.equal(count, 0);
  });

  it("does NOT flag *.test.tsx files", () => {
    const root = makeTree({
      "packages/app/src/components/foo.test.tsx": `<View onPointerEnter={fn} />`,
    });
    const { count } = lintPointerEventsWebOnly(root);
    assert.equal(count, 0);
  });

  it("does NOT flag a file using the canonical isWeb gate", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `<View onPointerEnter={isWeb ? fn : undefined} />`,
    });
    const { count } = lintPointerEventsWebOnly(root);
    assert.equal(count, 0);
  });
});

// CLI-level baseline behavior.
describe("pointer-events-web-only CLI baseline behavior", () => {
  const SCRIPT = resolvePath(HERE, "pointer-events-web-only.ts");

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
      "packages/app/src/components/foo.tsx": `<View onPointerEnter={fn} />`,
    });
    const { code, stderr } = runCli([], root);
    assert.equal(code, 1);
    assert.match(stderr, /No baseline/);
  });

  it("--write-baseline writes a numeric count and exits 0", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `<View onPointerEnter={fn} />`,
    });
    const { code } = runCli(["--write-baseline"], root);
    assert.equal(code, 0);
    const baselinePath = join(root, "tools/lint/pointer-events-web-only.baseline.json");
    assert.equal(existsSync(baselinePath), true);
    const parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
    assert.equal(typeof parsed.count, "number");
    assert.equal(parsed.count, 1);
  });

  it("count == baseline → exit 0", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `<View onPointerEnter={fn} />`,
    });
    runCli(["--write-baseline"], root);
    const { code } = runCli([], root);
    assert.equal(code, 0);
  });

  it("count > baseline → exit 1 with regression message", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `<View onPointerEnter={fn} />`,
    });
    runCli(["--write-baseline"], root);
    writeFileSync(
      join(root, "packages/app/src/components/bar.tsx"),
      `<View onPointerLeave={fn} />`,
    );
    const { code, stderr } = runCli([], root);
    assert.equal(code, 1);
    assert.match(stderr, /regress/);
  });

  it("count < baseline → exit 0 with re-baseline hint", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `<View onPointerEnter={fn} />`,
      "packages/app/src/components/bar.tsx": `<View onPointerLeave={fn} />`,
    });
    runCli(["--write-baseline"], root);
    writeFileSync(
      join(root, "packages/app/src/components/bar.tsx"),
      `<View onPointerLeave={isWeb ? fn : undefined} />`,
    );
    const { code, stderr } = runCli([], root);
    assert.equal(code, 0);
    assert.match(stderr, /count went DOWN/);
  });
});
