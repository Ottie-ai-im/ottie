import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { z } from "zod";

const OttieWorktreeMetadataV1Schema = z.object({
  version: z.literal(1),
  baseRefName: z.string().min(1),
});

const OttieWorktreeMetadataV2Schema = z.object({
  version: z.literal(2),
  baseRefName: z.string().min(1),
  runtime: z
    .object({
      worktreePort: z.number().int().positive(),
    })
    .optional(),
});

const OttieWorktreeMetadataSchema = z.union([
  OttieWorktreeMetadataV1Schema,
  OttieWorktreeMetadataV2Schema,
]);

export type OttieWorktreeMetadata = z.infer<typeof OttieWorktreeMetadataSchema>;

function getGitDirForWorktreeRoot(worktreeRoot: string): string {
  const gitPath = join(worktreeRoot, ".git");
  if (!existsSync(gitPath)) {
    throw new Error(`Not a git repository: ${worktreeRoot}`);
  }

  // In a worktree checkout, `.git` is a file containing `gitdir: <path>`.
  // In a normal checkout, `.git` is a directory.
  try {
    const gitFileContent = readFileSync(gitPath, "utf8");
    const match = gitFileContent.match(/gitdir:\s*(.+)/);
    if (match?.[1]) {
      const raw = match[1].trim();
      return isAbsolute(raw) ? raw : resolve(worktreeRoot, raw);
    }
  } catch {
    // If `.git` is a directory, readFileSync will throw; fall through.
  }

  return gitPath;
}

export function getOttieWorktreeMetadataPath(worktreeRoot: string): string {
  const gitDir = getGitDirForWorktreeRoot(worktreeRoot);
  return join(gitDir, "ottie", "worktree.json");
}

export function normalizeBaseRefName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Base branch is required");
  }
  if (trimmed.startsWith("origin/")) {
    return trimmed.slice("origin/".length);
  }
  return trimmed;
}

export function writeOttieWorktreeMetadata(
  worktreeRoot: string,
  options: { baseRefName: string },
): void {
  const baseRefName = normalizeBaseRefName(options.baseRefName);
  if (baseRefName === "HEAD") {
    throw new Error("Base branch cannot be HEAD");
  }
  if (baseRefName.includes("..") || baseRefName.includes("@{")) {
    throw new Error(`Invalid base branch: ${baseRefName}`);
  }
  if (!/^[0-9A-Za-z._/-]+$/.test(baseRefName)) {
    throw new Error(`Invalid base branch: ${baseRefName}`);
  }

  const metadataPath = getOttieWorktreeMetadataPath(worktreeRoot);
  mkdirSync(join(getGitDirForWorktreeRoot(worktreeRoot), "ottie"), { recursive: true });
  const metadata: OttieWorktreeMetadata = { version: 1, baseRefName };
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export function writeOttieWorktreeRuntimeMetadata(
  worktreeRoot: string,
  options: { worktreePort: number },
): void {
  if (!Number.isInteger(options.worktreePort) || options.worktreePort <= 0) {
    throw new Error(`Invalid worktree runtime port: ${options.worktreePort}`);
  }

  const current = readOttieWorktreeMetadata(worktreeRoot);
  if (!current) {
    throw new Error("Cannot persist worktree runtime metadata: missing base metadata");
  }

  const metadataPath = getOttieWorktreeMetadataPath(worktreeRoot);
  mkdirSync(join(getGitDirForWorktreeRoot(worktreeRoot), "ottie"), { recursive: true });
  const next: OttieWorktreeMetadata = {
    version: 2,
    baseRefName: current.baseRefName,
    runtime: {
      worktreePort: options.worktreePort,
    },
  };
  writeFileSync(metadataPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function readOttieWorktreeMetadata(worktreeRoot: string): OttieWorktreeMetadata | null {
  const metadataPath = getOttieWorktreeMetadataPath(worktreeRoot);
  if (!existsSync(metadataPath)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(metadataPath, "utf8"));
  return OttieWorktreeMetadataSchema.parse(parsed);
}

export function requireOttieWorktreeBaseRefName(worktreeRoot: string): string {
  const metadataPath = getOttieWorktreeMetadataPath(worktreeRoot);
  const metadata = readOttieWorktreeMetadata(worktreeRoot);
  if (!metadata) {
    throw new Error(`Missing Ottie worktree base metadata: ${metadataPath}`);
  }
  return metadata.baseRefName;
}

export function readOttieWorktreeRuntimePort(worktreeRoot: string): number | null {
  const metadata = readOttieWorktreeMetadata(worktreeRoot);
  if (!metadata) {
    return null;
  }
  if (metadata.version === 2 && metadata.runtime?.worktreePort) {
    return metadata.runtime.worktreePort;
  }
  return null;
}
