// pointer-events-web-only lint (NAT-03 / Plan 01-03 / D-10).
//
// Scans every `.ts` / `.tsx` file under packages/app/src/ for raw
// `onPointerEnter=` / `onPointerLeave=` JSX props that are NOT gated by
// `isWeb ? ... : undefined`. Per CLAUDE.md "NEVER use onPointerEnter/
// onPointerLeave. They don't fire on native iOS." — these props crash or
// silently no-op on iOS/Android. The canonical safe shape is
// `onPointerEnter={isWeb ? handler : undefined}` (per toast-host.tsx
// :257-258). Files with the `.web.tsx` / `.web.ts` extension are
// exempt — Metro bundles them only for web, where DOM pointer events
// legitimately work.
//
// Phase 1: warn-only counter-test. The default invocation reads
// `tools/lint/pointer-events-web-only.baseline.json` and exits 0 if the
// current violation count is ≤ baseline; exits 1 if violations regressed.
// Run with `--write-baseline` to capture the current count after a
// planned migration round.
//
// Phase 5: tightened — exit 1 on ANY violation per ROADMAP P5
// (NAT-03 promotion to error).

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface PointerEventsViolation {
  file: string; // repo-relative path (forward slashes)
  line: number; // 1-based
  prop: "onPointerEnter" | "onPointerLeave";
  snippet: string; // matched line excerpt
}

export interface PointerEventsLintResult {
  violations: PointerEventsViolation[];
  count: number;
}

export interface PointerEventsLintOptions {
  /** Repo-relative or absolute paths to skip — defaults below. */
  excludePaths?: string[];
}

// JSX-prop-style match: `onPointerEnter=` or `onPointerLeave=` followed
// by either `{` (an expression) or `"` (a string literal). The lint only
// fires when the assigned expression is NOT `isWeb ? ... : undefined` /
// `isWeb && ...` shape.
const POINTER_ENTER_RE = /\bonPointerEnter\s*=/;
const POINTER_LEAVE_RE = /\bonPointerLeave\s*=/;
const ISWEB_GATE_RE = /\bisWeb\s*\?/;
const ISWEB_AND_RE = /\bisWeb\s*&&/;

const SCANNABLE_EXTS = new Set([".ts", ".tsx"]);

const DEFAULT_SCAN_ROOT = "packages/app/src";

const DIR_BLOCKLIST = new Set([
  "node_modules",
  ".expo",
  ".tsbuild",
  ".next",
  ".turbo",
  "dist",
  "build",
  "ios",
  "android",
  "__snapshots__",
]);

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx)$/;

function toForwardSlashes(p: string): string {
  return p.split(sep).join("/");
}

function shouldExcludeFile(absPath: string, rootDir: string, excludes: string[]): boolean {
  const rel = toForwardSlashes(relative(rootDir, absPath));
  for (const ex of excludes) {
    const norm = toForwardSlashes(ex);
    if (rel === norm || rel.startsWith(`${norm}/`)) return true;
  }
  return false;
}

function isWebVariantFile(name: string): boolean {
  return name.endsWith(".web.ts") || name.endsWith(".web.tsx");
}

function* walkScanFiles(dir: string, rootDir: string, excludes: string[]): Generator<string> {
  const entries = readdirSync(dir);
  for (const name of entries) {
    if (DIR_BLOCKLIST.has(name)) continue;
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (shouldExcludeFile(abs, rootDir, excludes)) continue;
      yield* walkScanFiles(abs, rootDir, excludes);
      continue;
    }
    if (!st.isFile()) continue;
    if (TEST_FILE_RE.test(name)) continue;
    // .web.* files are exempt — Metro bundles them only for web, where
    // DOM pointer events legitimately work.
    if (isWebVariantFile(name)) continue;
    const dotIdx = name.lastIndexOf(".");
    if (dotIdx < 0) continue;
    const ext = name.slice(dotIdx);
    if (!SCANNABLE_EXTS.has(ext)) continue;
    if (shouldExcludeFile(abs, rootDir, excludes)) continue;
    yield abs;
  }
}

/**
 * Scan a single file's source text for raw onPointerEnter/onPointerLeave
 * props that are NOT gated by `isWeb ? ... : undefined`. Exposed for
 * direct unit testing without a temp directory.
 */
export function scanSourceForPointerEvents(
  source: string,
  filePathForReport: string,
): PointerEventsViolation[] {
  const violations: PointerEventsViolation[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const hasEnter = POINTER_ENTER_RE.test(line);
    const hasLeave = POINTER_LEAVE_RE.test(line);
    if (!hasEnter && !hasLeave) continue;
    // If the same line contains an `isWeb ? ... : undefined` gate or
    // `isWeb && ...` short-circuit, the prop is considered safe.
    const gated = ISWEB_GATE_RE.test(line) || ISWEB_AND_RE.test(line);
    if (gated) continue;
    if (hasEnter) {
      violations.push({
        file: filePathForReport,
        line: i + 1,
        prop: "onPointerEnter",
        snippet: line.trim(),
      });
    }
    if (hasLeave) {
      violations.push({
        file: filePathForReport,
        line: i + 1,
        prop: "onPointerLeave",
        snippet: line.trim(),
      });
    }
  }
  return violations;
}

/**
 * Scan a directory tree for raw onPointerEnter/onPointerLeave props.
 * `*.web.tsx` / `*.web.ts` files and tests are excluded by default.
 */
export function lintPointerEventsWebOnly(
  rootDir: string,
  opts?: PointerEventsLintOptions,
): PointerEventsLintResult {
  const absRoot = resolve(rootDir);
  const excludes = opts?.excludePaths ?? [];
  const violations: PointerEventsViolation[] = [];
  for (const abs of walkScanFiles(absRoot, absRoot, excludes)) {
    const source = readFileSync(abs, "utf8");
    const rel = toForwardSlashes(relative(absRoot, abs));
    violations.push(...scanSourceForPointerEvents(source, rel));
  }
  return { violations, count: violations.length };
}

// ---------------------------------------------------------------------------
// CLI: default vs `--write-baseline`
// ---------------------------------------------------------------------------

const BASELINE_PATH = "tools/lint/pointer-events-web-only.baseline.json";

interface Baseline {
  count: number;
  capturedAt?: string;
  plan?: string;
}

function readBaseline(absPath: string): Baseline | null {
  try {
    const raw = readFileSync(absPath, "utf8");
    const parsed = JSON.parse(raw) as Baseline;
    if (typeof parsed.count !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBaseline(absPath: string, count: number): void {
  const payload: Baseline = {
    count,
    capturedAt: new Date().toISOString(),
    plan: "01-03",
  };
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function isMain(): boolean {
  if (typeof process === "undefined") return false;
  const entry = process.argv[1];
  if (!entry) return false;
  const here = new URL(import.meta.url).pathname;
  return resolve(entry) === resolve(here);
}

function main(): void {
  const args = process.argv.slice(2);
  const writeBaselineFlag = args.includes("--write-baseline");
  const scanRoot = resolve(args.find((a) => !a.startsWith("--")) ?? DEFAULT_SCAN_ROOT);
  const baselinePath = resolve(BASELINE_PATH);

  const { violations, count } = lintPointerEventsWebOnly(scanRoot);
  for (const v of violations) {
    process.stderr.write(
      `WARN  ${v.file}:${v.line}  ${v.prop} used outside .web.* without isWeb gate (CLAUDE.md "NEVER use onPointerEnter/onPointerLeave")\n`,
    );
  }

  if (writeBaselineFlag) {
    writeBaseline(baselinePath, count);
    process.stderr.write(`\n✓ Baseline written to ${BASELINE_PATH}: count=${count}\n`);
    process.exit(0);
  }

  const baseline = readBaseline(baselinePath);
  if (!baseline) {
    process.stderr.write(
      `\nERROR  No baseline at ${BASELINE_PATH}. Run with --write-baseline to capture one.\n`,
    );
    process.exit(1);
    return;
  }

  if (count > baseline.count) {
    process.stderr.write(
      `\nFAIL  pointer-events regressions: ${count} > baseline ${baseline.count}.\nFix the violations above (gate with \`isWeb ? handler : undefined\` or move into a .web.tsx file) or — if intentional — re-run with --write-baseline after sweeping a known-good surface.\n`,
    );
    // PHASE 5: tighten — exit 1 on ANY violation per ROADMAP P5
    // success criterion #2 (NAT-03 promotion to error).
    process.exit(1);
    return;
  }

  if (count < baseline.count) {
    process.stderr.write(
      `\n✓ pointer-events count went DOWN: ${count} < baseline ${baseline.count}. Re-run \`npm run lint:pointer-events:baseline\` to lock in the win.\n`,
    );
  } else {
    process.stderr.write(
      `\n✓ pointer-events count holds: ${count} == baseline ${baseline.count}.\n`,
    );
  }
  process.exit(0);
}

if (isMain()) {
  main();
}
