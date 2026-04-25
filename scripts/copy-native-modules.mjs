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
const REQUIRE_ROOTS = [
  join(SERVER_DIR, "package.json"),
];

// Packages we excluded from the bundle and want shipped in resources/.
const EXTERNALS = [
  "node-pty",
  "sherpa-onnx",
  "sherpa-onnx-node",
  "onnxruntime-node",
  "which",
  "@mariozechner/clipboard",
];

// Platform-specific optionals only present for the host triple.
const PLATFORM_OPTIONALS = [
  "sherpa-onnx-darwin-arm64",
  "sherpa-onnx-darwin-x64",
  "sherpa-onnx-linux-x64",
  "sherpa-onnx-linux-arm64",
  "sherpa-onnx-win-x64",
  "sherpa-onnx-win-ia32",
];

// Resolution context — list of "from" paths where we look up packages.
// We seed with the server package and grow it with each resolved package's
// directory so pnpm's per-package node_modules can be walked.
const resolveFromPaths = new Set(REQUIRE_ROOTS);

function tryResolvePackageJson(name) {
  for (const from of resolveFromPaths) {
    const req = createRequire(from);
    // Fast path: subpath import. Fails for packages with restrictive
    // `exports` fields (Node returns ERR_PACKAGE_PATH_NOT_EXPORTED).
    try {
      return req.resolve(`${name}/package.json`);
    } catch {}
    // Fallback: enumerate the candidate node_modules directories and look
    // for `<path>/<name>/package.json` on disk.
    let candidates;
    try { candidates = req.resolve.paths(name) ?? []; }
    catch { candidates = []; }
    for (const dir of candidates) {
      const candidate = join(dir, name, "package.json");
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  }
  return null;
}

function copyPackage(name, packageJsonPath) {
  const src = dirname(packageJsonPath);
  const dest = join(DEST_NM, name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  // dereference: true follows symlinks (pnpm uses them); preserveTimestamps
  // helps reproducibility a little.
  cpSync(src, dest, { recursive: true, dereference: true });
}

function readDeps(packageJsonPath) {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return Object.keys(pkg.dependencies ?? {});
  } catch {
    return [];
  }
}

const seen = new Set();
const queue = [...EXTERNALS, ...PLATFORM_OPTIONALS];
const missing = [];
const optionalSet = new Set(PLATFORM_OPTIONALS);

let copiedCount = 0;
while (queue.length > 0) {
  const name = queue.shift();
  if (seen.has(name)) continue;
  seen.add(name);

  const pkgJson = tryResolvePackageJson(name);
  if (!pkgJson) {
    if (!optionalSet.has(name)) missing.push(name);
    continue;
  }

  copyPackage(name, pkgJson);
  copiedCount++;
  const tag = optionalSet.has(name) ? " (platform optional)" : "";
  process.stdout.write(`  ✓ ${name}${tag}\n`);

  // After copying, register the source package's REAL path (deref symlink)
  // as a future resolution root so transitive deps reachable through pnpm's
  // per-package node_modules can be found.
  try {
    resolveFromPaths.add(realpathSync(pkgJson));
  } catch {
    resolveFromPaths.add(pkgJson);
  }

  for (const dep of readDeps(pkgJson)) {
    if (!seen.has(dep)) queue.push(dep);
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
    } catch { continue; }
    for (const e of entries) {
      const p = join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try { total += statSync(p).size; } catch {}
      }
    }
  }
  return total;
}

function humanSize(n) {
  const units = ["B", "K", "M", "G"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(0)}${units[i]}`;
}

console.log(`copied ${copiedCount} packages; total size ${humanSize(dirSize(DEST_NM))}`);
console.log(`destination: ${relative(REPO_ROOT, DEST_NM)}`);
