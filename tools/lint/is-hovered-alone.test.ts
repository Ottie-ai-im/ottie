import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";

import { lintIsHoveredAlone, scanSourceForIsHoveredAlone } from "./is-hovered-alone";

const HERE = dirname(fileURLToPath(import.meta.url));

// Uses node:test (built-in) rather than vitest because the worktree path
// contains `.claude/` which the workspace vitest configs explicitly exclude.
// `node:test` has no exclude list and runs anywhere TypeScript can run via tsx.
// Run with: tsx --test tools/lint/is-hovered-alone.test.ts

function makeTree(layout: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "is-hovered-alone-"));
  for (const [path, contents] of Object.entries(layout)) {
    const abs = join(root, path);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, contents);
  }
  return root;
}

describe("scanSourceForIsHoveredAlone (single-file)", () => {
  it("flags `isHovered &&` visibility gate without companion", () => {
    const src = `<View>{isHovered && <Chevron />}</View>`;
    const violations = scanSourceForIsHoveredAlone(src, "fixture.tsx");
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.line, 1);
  });

  it("does NOT flag `isHovered || isNative` (companion present)", () => {
    const src = `const isActive = isHovered || isExpanded || isNative || isCompact;`;
    const violations = scanSourceForIsHoveredAlone(src, "fixture.tsx");
    assert.equal(violations.length, 0);
  });

  it("does NOT flag `isHovered || isCompact` (companion present)", () => {
    const src = `const show = isHovered || isCompact;`;
    const violations = scanSourceForIsHoveredAlone(src, "fixture.tsx");
    assert.equal(violations.length, 0);
  });

  it("does NOT flag isHovered inside a string literal (no visibility gate)", () => {
    const src = `const description = "isHovered alone";`;
    const violations = scanSourceForIsHoveredAlone(src, "fixture.tsx");
    assert.equal(violations.length, 0);
  });

  it("flags `isHovered ?` ternary without companion", () => {
    const src = `<View>{isHovered ? <A /> : <B />}</View>`;
    const violations = scanSourceForIsHoveredAlone(src, "fixture.tsx");
    assert.equal(violations.length, 1);
  });

  it("does NOT flag a multi-line gate with companion on adjacent line", () => {
    const src = [
      "const isActive =",
      "  isHovered ||",
      "  isExpanded ||",
      "  isNative ||",
      "  isCompact;",
    ].join("\n");
    const violations = scanSourceForIsHoveredAlone(src, "fixture.tsx");
    assert.equal(violations.length, 0);
  });

  it("reports 1-based line numbers", () => {
    const src = ["// header", "// blank", `const a = isHovered && <X/>;`].join("\n");
    const violations = scanSourceForIsHoveredAlone(src, "fixture.tsx");
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.line, 3);
  });

  it("plain `const isHovered = ...` declaration is NOT flagged", () => {
    const src = `const [isHovered, setIsHovered] = useState(false);`;
    const violations = scanSourceForIsHoveredAlone(src, "fixture.tsx");
    assert.equal(violations.length, 0);
  });
});

describe("lintIsHoveredAlone (directory walk)", () => {
  it("flags isHovered-alone in a non-test component file", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `<View>{isHovered && <X/>}</View>`,
    });
    const { count, violations } = lintIsHoveredAlone(root);
    assert.equal(count, 1);
    assert.equal(violations[0]?.file, "packages/app/src/components/foo.tsx");
  });

  it("does NOT flag .web.tsx files (DOM hover legitimately works)", () => {
    const root = makeTree({
      "packages/app/src/components/foo.web.tsx": `<View>{isHovered && <X/>}</View>`,
    });
    const { count } = lintIsHoveredAlone(root);
    assert.equal(count, 0);
  });

  it("does NOT flag *.test.tsx files", () => {
    const root = makeTree({
      "packages/app/src/components/foo.test.tsx": `<View>{isHovered && <X/>}</View>`,
    });
    const { count } = lintIsHoveredAlone(root);
    assert.equal(count, 0);
  });

  it("does NOT flag a file using the canonical fallback expression", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `const a = isHovered || isNative || isCompact;`,
    });
    const { count } = lintIsHoveredAlone(root);
    assert.equal(count, 0);
  });
});

// CLI-level baseline behavior: count == baseline → exit 0;
// count > baseline → exit 1; count < baseline → exit 0 with re-baseline hint.
describe("is-hovered-alone CLI baseline behavior", () => {
  const SCRIPT = resolvePath(HERE, "is-hovered-alone.ts");

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
      "packages/app/src/components/foo.tsx": `<View>{isHovered && <X/>}</View>`,
    });
    const { code, stderr } = runCli([], root);
    assert.equal(code, 1);
    assert.match(stderr, /No baseline/);
  });

  it("--write-baseline writes a numeric count and exits 0", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `<View>{isHovered && <X/>}</View>`,
    });
    const { code } = runCli(["--write-baseline"], root);
    assert.equal(code, 0);
    const baselinePath = join(root, "tools/lint/is-hovered-alone.baseline.json");
    assert.equal(existsSync(baselinePath), true);
    const parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
    assert.equal(typeof parsed.count, "number");
    assert.equal(parsed.count, 1);
  });

  it("count == baseline → exit 0", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `<View>{isHovered && <X/>}</View>`,
    });
    runCli(["--write-baseline"], root);
    const { code } = runCli([], root);
    assert.equal(code, 0);
  });

  it("count > baseline → exit 1 with regression message", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `<View>{isHovered && <X/>}</View>`,
    });
    runCli(["--write-baseline"], root);
    writeFileSync(
      join(root, "packages/app/src/components/bar.tsx"),
      `<View>{isHovered && <Y/>}</View>`,
    );
    const { code, stderr } = runCli([], root);
    assert.equal(code, 1);
    assert.match(stderr, /regress/);
  });

  it("count < baseline → exit 0 with re-baseline hint", () => {
    const root = makeTree({
      "packages/app/src/components/foo.tsx": `<View>{isHovered && <X/>}</View>`,
      "packages/app/src/components/bar.tsx": `<View>{isHovered && <Y/>}</View>`,
    });
    runCli(["--write-baseline"], root);
    writeFileSync(
      join(root, "packages/app/src/components/bar.tsx"),
      `const a = isHovered || isNative || isCompact;`,
    );
    const { code, stderr } = runCli([], root);
    assert.equal(code, 0);
    assert.match(stderr, /count went DOWN/);
  });
});
