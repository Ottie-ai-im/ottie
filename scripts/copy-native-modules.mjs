#!/usr/bin/env node
// Materialize a self-contained node_modules/ tree next to the bundled daemon.
// Walks transitive `dependencies` (NOT dev/optional/peer beyond what pnpm
// already resolved) starting from the externals list, so every `require()`
// the bundle leaves at runtime can resolve.

import { createRequire } from "node:module";
import { mkdirSync, rmSync, cpSync, statSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const SERVER_DIR = join(REPO_ROOT, "packages/server");
const DEST_NM = join(SERVER_DIR, "dist-bundle/node_modules");

// Roots: anywhere a `require()` from the server bundle should be resolved.
const REQUIRE_ROOTS = [join(SERVER_DIR, "package.json")];

// Packages we excluded from the bundle and want shipped in resources/.
const EXTERNALS = [
  "node-pty",
  "sherpa-onnx",
  "sherpa-onnx-node",
  "onnxruntime-node",
  "which",
  "@mariozechner/clipboard",
  "better-sqlite3",
];

// Platform-specific optionals only present for the host triple.
//
// The Claude Agent SDK ships its native CLI binary as a per-platform sibling
// package (e.g. `@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`) and
// resolves it at runtime via
// `createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk-<platform>")`.
// When pnpm only installs the optional for the host triple we still need to
// copy it into the bundled tree, otherwise the SDK throws "Native CLI binary
// for darwin-arm64 not found" the moment any agent is spawned.
const PLATFORM_OPTIONALS = [
  "sherpa-onnx-darwin-arm64",
  "sherpa-onnx-darwin-x64",
  "sherpa-onnx-linux-x64",
  "sherpa-onnx-linux-arm64",
  "sherpa-onnx-win-x64",
  "sherpa-onnx-win-ia32",
  "@anthropic-ai/claude-agent-sdk-darwin-arm64",
  "@anthropic-ai/claude-agent-sdk-darwin-x64",
  "@anthropic-ai/claude-agent-sdk-linux-arm64",
  "@anthropic-ai/claude-agent-sdk-linux-arm64-musl",
  "@anthropic-ai/claude-agent-sdk-linux-x64",
  "@anthropic-ai/claude-agent-sdk-linux-x64-musl",
  "@anthropic-ai/claude-agent-sdk-win32-arm64",
  "@anthropic-ai/claude-agent-sdk-win32-x64",
];

// Resolution context — list of "from" paths where we look up packages.
// We seed with the server package and grow it with each resolved package's
// directory so pnpm's per-package node_modules can be walked.
const resolveFromPaths = new Set(REQUIRE_ROOTS);

function tryResolvePackageJson(name, fromOverride) {
  const fromList = fromOverride ? [fromOverride] : Array.from(resolveFromPaths);
  for (const from of fromList) {
    const req = createRequire(from);
    // Fast path: subpath import. Fails for packages with restrictive
    // `exports` fields (Node returns ERR_PACKAGE_PATH_NOT_EXPORTED).
    try {
      return req.resolve(`${name}/package.json`);
    } catch {}
    // Fallback: enumerate the candidate node_modules directories and look
    // for `<path>/<name>/package.json` on disk.
    let candidates;
    try {
      candidates = req.resolve.paths(name) ?? [];
    } catch {
      candidates = [];
    }
    for (const dir of candidates) {
      const candidate = join(dir, name, "package.json");
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  }
  return null;
}

function copyPackage(name, packageJsonPath, destRoot = DEST_NM) {
  const src = dirname(packageJsonPath);
  const dest = join(destRoot, name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  // dereference: true follows symlinks (pnpm uses them); preserveTimestamps
  // helps reproducibility a little.
  cpSync(src, dest, { recursive: true, dereference: true });
}

function readPackageVersion(packageJsonPath) {
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf-8")).version;
  } catch {
    return null;
  }
}

function readDeps(packageJsonPath) {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return Object.keys(pkg.dependencies ?? {});
  } catch {
    return [];
  }
}

// Map<topLevelPkgName, version> — what we've already placed at dist/node_modules/<name>.
// When a transitive dep needs a *different* version of a package already at
// the top level, we nest it under its parent's node_modules instead.
const topLevelVersions = new Map();
const queue = [
  ...EXTERNALS.map((n) => ({ name: n, parentDir: null, parentDest: null })),
  ...PLATFORM_OPTIONALS.map((n) => ({ name: n, parentDir: null, parentDest: null })),
];
const missing = [];
const optionalSet = new Set(PLATFORM_OPTIONALS);

let copiedCount = 0;
while (queue.length > 0) {
  const { name, parentDir, parentDest } = queue.shift();

  // Resolve the package — prefer the parent's directory so transitive
  // version conflicts (which@5 → isexe@3 vs hoisted isexe@2) pick the
  // version this parent actually depends on.
  const pkgJson = tryResolvePackageJson(name, parentDir);
  if (!pkgJson) {
    if (!optionalSet.has(name)) missing.push(name);
    continue;
  }

  const version = readPackageVersion(pkgJson) ?? "0.0.0";
  const existingVersion = topLevelVersions.get(name);
  let destRoot = DEST_NM;
  let nested = false;

  if (existingVersion === undefined) {
    // First time we see this package — place it at the top level.
    topLevelVersions.set(name, version);
  } else if (existingVersion === version) {
    // Same version already placed — skip the copy.
    continue;
  } else if (parentDest) {
    // Conflict: a different version is at the top level. Nest a copy
    // under the parent's own node_modules so Node's resolver picks it.
    destRoot = join(parentDest, "node_modules");
    nested = true;
  } else {
    // No parent context (top-level external itself) — keep top-level wins.
    continue;
  }

  copyPackage(name, pkgJson, destRoot);
  copiedCount++;
  let tag = "";
  if (optionalSet.has(name)) tag = " (platform optional)";
  else if (nested) tag = " (nested)";
  process.stdout.write(`  ✓ ${name}@${version}${tag}\n`);

  const copiedDest = join(destRoot, name);
  const realPkgJson = (() => {
    try {
      return realpathSync(pkgJson);
    } catch {
      return pkgJson;
    }
  })();
  resolveFromPaths.add(realPkgJson);

  for (const dep of readDeps(pkgJson)) {
    queue.push({
      name: dep,
      parentDir: realPkgJson,
      parentDest: copiedDest,
    });
  }
}

if (missing.length > 0) {
  console.error(`error: required external packages missing: ${missing.join(", ")}`);
  console.error("       run 'pnpm install' first");
  process.exit(1);
}

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = require("node:fs").readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          total += statSync(p).size;
        } catch {}
      }
    }
  }
  return total;
}

function humanSize(n) {
  const units = ["B", "K", "M", "G"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(0)}${units[i]}`;
}

console.log(`copied ${copiedCount} packages; total size ${humanSize(dirSize(DEST_NM))}`);
console.log(`destination: ${relative(REPO_ROOT, DEST_NM)}`);
