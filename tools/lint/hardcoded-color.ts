// Hardcoded-color lint (THM-01 / Plan 01-02 / D-10).
//
// Scans every `.ts` / `.tsx` file under packages/app/src/ for inline
// hex (`#xxx` / `#xxxxxx` / `#xxxxxxxx`) and `rgba?(...)` color literals
// and asserts the count never increases. The token tree under
// `packages/app/src/styles/tokens/` is the legitimate home for raw color
// values and is excluded from the scan.
//
// Phase 1: warn-only. The default invocation reads
// `tools/lint/hardcoded-color.baseline.json` and exits 0 if the current
// violation count is ≤ baseline; exits 1 if violations regressed (CI
// blocker — counter-test guard for THM-01). Run with `--write-baseline`
// to capture the current count after a planned migration round.
//
// Phase 5: tightened — exit 1 on ANY violation in non-tokens files
// (THM-01 promotion to error per ROADMAP P5).

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface HardcodedColorViolation {
  file: string; // repo-relative path (forward slashes)
  line: number; // 1-based
  snippet: string; // matched literal (#xxx or rgba(...))
}

export interface HardcodedColorLintResult {
  violations: HardcodedColorViolation[];
  count: number;
}

export interface HardcodedColorLintOptions {
  /** Repo-relative or absolute paths to skip — defaults to the tokens/ directory. */
  excludePaths?: string[];
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_RE = /\brgba?\(/g;

const SCANNABLE_EXTS = new Set([".ts", ".tsx"]);

/**
 * Default exclusions:
 *  - `packages/app/src/styles/tokens/` — primitive/semantic/component
 *    tokens are where literals legitimately live (per PITFALLS pitfall 5).
 *  - `packages/app/src/styles/theme.ts` — composition root + LEGACY shim;
 *    raw literals here are dead-code that Phase 4 (THM-02..04) deletes
 *    surface-by-surface. Excluding the file from the counter-test keeps
 *    the lint focused on consumer drift.
 *  - `node_modules`, build outputs, `.expo`, `.tsbuild`, etc.
 *
 * Test files (`*.test.ts(x)`, `*.spec.ts(x)`) are also excluded — they
 * legitimately assert against specific palette values for visual-parity
 * guards (see daemon-connection-dot.test.tsx) and a stray hex literal in
 * a test fixture is not a consumer-drift signal.
 */
const DEFAULT_EXCLUDE_PATHS = [
  "packages/app/src/styles/tokens",
  "packages/app/src/styles/theme.ts",
];

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx)$/;

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

function toForwardSlashes(p: string): string {
  return p.split(sep).join("/");
}

function shouldExcludeFile(absPath: string, rootDir: string, excludes: string[]): boolean {
  const rel = toForwardSlashes(relative(rootDir, absPath));
  for (const ex of excludes) {
    const norm = toForwardSlashes(ex);
    // Match if file path starts with the exclude prefix (path-segment safe).
    if (rel === norm || rel.startsWith(`${norm}/`)) return true;
  }
  return false;
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
      continue; // dangling symlink, race etc.
    }
    if (st.isDirectory()) {
      if (shouldExcludeFile(abs, rootDir, excludes)) continue;
      yield* walkScanFiles(abs, rootDir, excludes);
      continue;
    }
    if (!st.isFile()) continue;
    if (TEST_FILE_RE.test(name)) continue;
    const dotIdx = name.lastIndexOf(".");
    if (dotIdx < 0) continue;
    const ext = name.slice(dotIdx);
    // Strip any `.web` / `.native` segment to match `.web.ts` etc.
    const ext2 = name.endsWith(`.web${ext}`) || name.endsWith(`.native${ext}`) ? ext : ext;
    if (!SCANNABLE_EXTS.has(ext2)) continue;
    if (shouldExcludeFile(abs, rootDir, excludes)) continue;
    yield abs;
  }
}

/**
 * Scan a single file's source text. Exposed for direct unit testing
 * without a temp directory.
 */
export function scanSourceForColorLiterals(
  source: string,
  filePathForReport: string,
): HardcodedColorViolation[] {
  const violations: HardcodedColorViolation[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    HEX_RE.lastIndex = 0;
    RGB_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HEX_RE.exec(line)) !== null) {
      violations.push({
        file: filePathForReport,
        line: i + 1,
        snippet: match[0],
      });
    }
    while ((match = RGB_RE.exec(line)) !== null) {
      violations.push({
        file: filePathForReport,
        line: i + 1,
        snippet: match[0],
      });
    }
  }
  return violations;
}

/**
 * Scan a directory tree for hardcoded color literals. The token tree
 * under `packages/app/src/styles/tokens/` is excluded by default.
 */
export function lintHardcodedColors(
  rootDir: string,
  opts?: HardcodedColorLintOptions,
): HardcodedColorLintResult {
  const absRoot = resolve(rootDir);
  const excludes = (opts?.excludePaths ?? DEFAULT_EXCLUDE_PATHS).map((p) =>
    toForwardSlashes(resolve(absRoot, p) === resolve(p) ? p : p),
  );
  const violations: HardcodedColorViolation[] = [];
  for (const abs of walkScanFiles(absRoot, absRoot, excludes)) {
    const source = readFileSync(abs, "utf8");
    const rel = toForwardSlashes(relative(absRoot, abs));
    violations.push(...scanSourceForColorLiterals(source, rel));
  }
  return { violations, count: violations.length };
}

// ---------------------------------------------------------------------------
// CLI: default vs `--write-baseline`
// ---------------------------------------------------------------------------

const DEFAULT_SCAN_ROOT = "packages/app/src";
const BASELINE_PATH = "tools/lint/hardcoded-color.baseline.json";

interface Baseline {
  count: number;
  /** ISO-8601 timestamp captured at baseline write. Informational. */
  capturedAt?: string;
  /** Plan that captured this baseline. Informational. */
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
    plan: "01-02",
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

  const { violations, count } = lintHardcodedColors(scanRoot);
  for (const v of violations) {
    process.stderr.write(
      `WARN  ${v.file}:${v.line}  hardcoded color literal '${v.snippet}' — use a semantic token from @/styles/tokens/semantic.{light,dark}\n`,
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
      `\nFAIL  hardcoded-color regressions: ${count} > baseline ${baseline.count}.\nFix the violations above (use semantic tokens) or — if intentional — re-run with --write-baseline after migrating an existing surface to tokens.\n`,
    );
    // PHASE 5: tighten — exit 1 on ANY violation in non-tokens files
    // (THM-01 promotion to error per ROADMAP P5 success criterion #2).
    process.exit(1);
    return;
  }

  if (count < baseline.count) {
    process.stderr.write(
      `\n✓ hardcoded-color count went DOWN: ${count} < baseline ${baseline.count}. Re-run \`npm run lint:colors:baseline\` to lock in the win.\n`,
    );
  } else {
    process.stderr.write(
      `\n✓ hardcoded-color count holds: ${count} == baseline ${baseline.count}.\n`,
    );
  }
  process.exit(0);
}

if (isMain()) {
  main();
}
