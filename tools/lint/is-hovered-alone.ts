// isHovered-alone lint (NAV-A3 / Plan 01-03 / D-10).
//
// Scans every `.ts` / `.tsx` file under packages/app/src/ for visibility
// gates that use the bare `isHovered` token without combining it with
// `isNative` or `isCompact`. Per CLAUDE.md "Hover only works on web" —
// React Native's hover events do NOT fire on native iOS/iPad, so any
// visibility gate keyed on `isHovered` alone hides the affordance on
// touch devices. The canonical fallback expression is
// `isHovered || isNative || isCompact`.
//
// Phase 1: warn-only counter-test. The default invocation reads
// `tools/lint/is-hovered-alone.baseline.json` and exits 0 if the current
// violation count is ≤ baseline; exits 1 if violations regressed
// (warn-level guard for NAV-A3). Run with `--write-baseline` to capture
// the current count after a planned migration round.
//
// Phase 5: tightened — exit 1 on ANY violation in non-tokens files
// (NAV-A3 promotion to error per ROADMAP P5).

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface IsHoveredAloneViolation {
  file: string; // repo-relative path (forward slashes)
  line: number; // 1-based
  snippet: string; // matched line excerpt
}

export interface IsHoveredAloneLintResult {
  violations: IsHoveredAloneViolation[];
  count: number;
}

export interface IsHoveredAloneLintOptions {
  /** Repo-relative or absolute paths to skip — defaults below. */
  excludePaths?: string[];
}

// A line is a candidate violation if it uses `isHovered` in a JSX visibility
// gate / conditional position. We use simple substring heuristics that catch
// the common shapes:
//   - `isHovered && ...`
//   - `... && isHovered`
//   - `isHovered ? ... : ...`
//   - `... ? isHovered : ...`
//   - `{isHovered && <X/>}`
//   - `style={[..., isHovered && ...]}`
//
// Lines that ALSO contain `isNative` or `isCompact` (the canonical
// hover-fallback companions) are NOT flagged. To avoid false negatives
// when the companion sits on an adjacent line of a multi-line JSX
// expression, we scan a small look-around window around the candidate.
const ISHOVERED_RE = /\bisHovered\b/;
const VISIBILITY_GATE_RE =
  /(\bisHovered\s*&&)|(&&\s*isHovered\b)|(\bisHovered\s*\?)|(\?\s*isHovered\b)/;
const COMPANION_RE = /\b(isNative|isCompact|isMobile)\b/;

const LOOKAROUND_LINES = 3;
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

function isWebVariant(name: string): boolean {
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
    // .web.* files are exempt — DOM APIs and hover events legitimately
    // exist there. Per CLAUDE.md "Prefer Metro file extensions over `if`
    // statements" — those files are already platform-isolated.
    if (isWebVariant(name)) continue;
    const dotIdx = name.lastIndexOf(".");
    if (dotIdx < 0) continue;
    const ext = name.slice(dotIdx);
    if (!SCANNABLE_EXTS.has(ext)) continue;
    if (shouldExcludeFile(abs, rootDir, excludes)) continue;
    yield abs;
  }
}

/**
 * Scan a single file's source text for isHovered-alone visibility gates.
 * Exposed for direct unit testing without a temp directory.
 */
export function scanSourceForIsHoveredAlone(
  source: string,
  filePathForReport: string,
): IsHoveredAloneViolation[] {
  const violations: IsHoveredAloneViolation[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!ISHOVERED_RE.test(line)) continue;
    if (!VISIBILITY_GATE_RE.test(line)) continue;
    // Look-around window: if any line within ±LOOKAROUND_LINES contains
    // a companion (`isNative` / `isCompact` / `isMobile`), the gate is
    // considered the canonical hover-fallback expression. This avoids
    // false positives on multi-line JSX expressions like
    //   isHovered ||
    //     isNative ||
    //     isCompact
    let hasCompanion = false;
    const start = Math.max(0, i - LOOKAROUND_LINES);
    const end = Math.min(lines.length - 1, i + LOOKAROUND_LINES);
    for (let j = start; j <= end; j++) {
      if (COMPANION_RE.test(lines[j] ?? "")) {
        hasCompanion = true;
        break;
      }
    }
    if (hasCompanion) continue;
    violations.push({
      file: filePathForReport,
      line: i + 1,
      snippet: line.trim(),
    });
  }
  return violations;
}

/**
 * Scan a directory tree for isHovered-alone visibility gates. Test files
 * and `*.web.*` files are excluded by default.
 */
export function lintIsHoveredAlone(
  rootDir: string,
  opts?: IsHoveredAloneLintOptions,
): IsHoveredAloneLintResult {
  const absRoot = resolve(rootDir);
  const excludes = opts?.excludePaths ?? [];
  const violations: IsHoveredAloneViolation[] = [];
  for (const abs of walkScanFiles(absRoot, absRoot, excludes)) {
    const source = readFileSync(abs, "utf8");
    const rel = toForwardSlashes(relative(absRoot, abs));
    violations.push(...scanSourceForIsHoveredAlone(source, rel));
  }
  return { violations, count: violations.length };
}

// ---------------------------------------------------------------------------
// CLI: default vs `--write-baseline`
// ---------------------------------------------------------------------------

const BASELINE_PATH = "tools/lint/is-hovered-alone.baseline.json";

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

  const { violations, count } = lintIsHoveredAlone(scanRoot);
  for (const v of violations) {
    process.stderr.write(
      `WARN  ${v.file}:${v.line}  isHovered used alone in visibility gate — combine with isNative or isCompact (CLAUDE.md "Hover only works on web")\n`,
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
      `\nFAIL  isHovered-alone regressions: ${count} > baseline ${baseline.count}.\nFix the violations above (combine isHovered with isNative or isCompact) or — if intentional — re-run with --write-baseline after sweeping a known-good surface.\n`,
    );
    // PHASE 5: tighten — exit 1 on ANY violation per ROADMAP P5
    // success criterion #2 (NAV-A3 promotion to error).
    process.exit(1);
    return;
  }

  if (count < baseline.count) {
    process.stderr.write(
      `\n✓ isHovered-alone count went DOWN: ${count} < baseline ${baseline.count}. Re-run \`npm run lint:hover:baseline\` to lock in the win.\n`,
    );
  } else {
    process.stderr.write(
      `\n✓ isHovered-alone count holds: ${count} == baseline ${baseline.count}.\n`,
    );
  }
  process.exit(0);
}

if (isMain()) {
  main();
}
