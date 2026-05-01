// Schema-discipline lint (ARCH-02 / Phase 01 / D-08, D-10).
//
// Scans a TypeScript file for Zod `.describe("...")` strings that contain
// `@deprecated` and asserts every such annotation includes BOTH a `since=vX.Y`
// and a `removeAfter=vX.Y` token, per the convention in
// .planning/research/ARCHITECTURE.md §4.3.
//
// Phase 1: warn-only (always exits 0 from the CLI entry).
// Phase 5: promoted to error (per ROADMAP P5 success criterion #2).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DeprecatedViolation {
  line: number;
  message: string;
}

export interface DeprecatedLintResult {
  violations: DeprecatedViolation[];
}

const DESCRIBE_DEPRECATED_RE = /\.describe\(\s*["'`][^"'`]*@deprecated\b/;
const SINCE_RE = /since=v\d+\.\d+/;
const REMOVE_AFTER_RE = /removeAfter=v\d+\.\d+/;

export function lintDeprecatedAnnotations(filePath: string): DeprecatedLintResult {
  const source = readFileSync(filePath, "utf8");
  return lintDeprecatedAnnotationsString(source);
}

// Only scans Zod `.describe("...")` strings — documentation prose mentioning
// `@deprecated` in `//` or `/** */` comment blocks is intentionally ignored.
export function lintDeprecatedAnnotationsString(source: string): DeprecatedLintResult {
  const violations: DeprecatedViolation[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!DESCRIBE_DEPRECATED_RE.test(line)) continue;

    const hasSince = SINCE_RE.test(line);
    const hasRemoveAfter = REMOVE_AFTER_RE.test(line);
    if (hasSince && hasRemoveAfter) continue;

    const missing: string[] = [];
    if (!hasSince) missing.push("since=vX.Y");
    if (!hasRemoveAfter) missing.push("removeAfter=vX.Y");
    violations.push({
      line: i + 1,
      message: `@deprecated annotation missing ${missing.join(" and ")}`,
    });
  }
  return { violations };
}

const DEFAULT_TARGET = "packages/server/src/shared/messages.ts";

function isMain(): boolean {
  if (typeof process === "undefined") return false;
  const entry = process.argv[1];
  if (!entry) return false;
  // Run via tsx — argv[1] is the source path; resolving keeps the check stable
  // whether invoked from repo root or a workspace package.
  const here = new URL(import.meta.url).pathname;
  return resolve(entry) === resolve(here);
}

function main(): void {
  const target = resolve(process.argv[2] ?? DEFAULT_TARGET);
  const { violations } = lintDeprecatedAnnotations(target);
  for (const v of violations) {
    process.stderr.write(`WARN  ${target}:${v.line}  ${v.message}\n`);
  }
  if (violations.length > 0) {
    process.stderr.write(
      `\n${violations.length} @deprecated annotation warning(s). Phase 1: non-blocking.\n`,
    );
  }
  // PHASE 5: change exit code to 1 when promoting from warn to error per ROADMAP P5 success criterion #2.
  process.exit(0);
}

if (isMain()) {
  main();
}
