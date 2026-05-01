import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  lintDeprecatedAnnotations,
  lintDeprecatedAnnotationsString,
} from "./deprecated-annotation";

// Uses node:test (built-in) rather than vitest because the worktree path
// contains `.claude/` which the workspace vitest configs explicitly exclude.
// `node:test` has no exclude list and runs anywhere TypeScript can run via tsx.
// Run with: tsx --test tools/lint/deprecated-annotation.test.ts

function tmpFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "deprecated-annotation-"));
  const path = join(dir, "fixture.ts");
  writeFileSync(path, contents);
  return path;
}

describe("lintDeprecatedAnnotations", () => {
  it("compliant annotation passes (since= AND removeAfter= both present)", () => {
    const compliant = `
      chromeEnabled: z
        .boolean()
        .optional()
        .describe("@deprecated since=v1.11 use=\`other\` removeAfter=v1.16"),
    `;
    assert.deepEqual(lintDeprecatedAnnotationsString(compliant).violations, []);
  });

  it("warns when removeAfter= is missing", () => {
    const missingRemoveAfter = `
      legacyHostId: z.string().optional().describe("@deprecated since=v1.10"),
    `;
    const { violations } = lintDeprecatedAnnotationsString(missingRemoveAfter);
    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? "", /removeAfter=vX\.Y/);
  });

  it("warns when since= is missing", () => {
    const missingSince = `
      legacyHostId: z.string().optional().describe("@deprecated removeAfter=v1.16"),
    `;
    const { violations } = lintDeprecatedAnnotationsString(missingSince);
    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? "", /since=vX\.Y/);
  });

  it("warns when both markers are missing", () => {
    const bare = `legacyHostId: z.string().describe("@deprecated"),`;
    const { violations } = lintDeprecatedAnnotationsString(bare);
    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? "", /since=vX\.Y/);
    assert.match(violations[0]?.message ?? "", /removeAfter=vX\.Y/);
  });

  it("ignores @deprecated mentioned in plain comments (documentation prose)", () => {
    const docProse = [
      "// Deprecation annotation convention: every `@deprecated` mark on a field's",
      "// `.describe(...)` MUST include both `since=vX.Y` and `removeAfter=vX.Y`.",
    ].join("\n");
    assert.deepEqual(lintDeprecatedAnnotationsString(docProse).violations, []);
  });

  it("ignores lines without @deprecated", () => {
    const noDeprecation = `
      chromeEnabled: z.boolean().optional().describe("Whether chrome is shown."),
    `;
    assert.deepEqual(lintDeprecatedAnnotationsString(noDeprecation).violations, []);
  });

  it("reports the 1-based line number of each violation", () => {
    const multiline = [
      "// header",
      "// blank",
      `legacyHostId: z.string().describe("@deprecated since=v1.10"),`,
    ].join("\n");
    const { violations } = lintDeprecatedAnnotationsString(multiline);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.line, 3);
  });

  it("reads from disk via lintDeprecatedAnnotations(filePath)", () => {
    const path = tmpFile(`legacyHostId: z.string().describe("@deprecated since=v1.10"),`);
    const { violations } = lintDeprecatedAnnotations(path);
    assert.equal(violations.length, 1);
  });
});
