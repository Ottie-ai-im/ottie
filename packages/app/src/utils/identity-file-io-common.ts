// Cross-platform file I/O for identity export/import. Metro picks
// `.web.ts` or `.native.ts` at build time. The shared types live here so
// both platforms agree on the contract.

export interface IdentityFileSaveInput {
  /** Base name without extension. UI passes the user's display name; we sanitize. */
  baseName: string;
  /** Pretty-printed JSON to write. */
  jsonContent: string;
}

export interface IdentityFilePickResult {
  /** Raw text the file contained. UI parses + zod-validates. */
  text: string;
  /** File name as reported by the OS. Just for logging — not trusted. */
  fileName: string | null;
}

/**
 * Sanitize a base name into something safe to use as a file name. Keeps
 * letters/digits/CJK; replaces everything else with a hyphen. Stripped to
 * 64 chars max so we don't trip filesystem limits on edge cases.
 */
export function sanitizeIdentityFileBase(baseName: string): string {
  const trimmed = baseName.trim();
  const safe = trimmed.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "");
  return (safe || "ottie-identity").slice(0, 64);
}

/**
 * Build the standard file name `ottie-identity-<base>-<YYYYMMDD>.json`. Used
 * by both export entry points so the user sees a consistent suggested name.
 */
export function buildIdentityFileName(baseName: string): string {
  const safe = sanitizeIdentityFileBase(baseName);
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `ottie-identity-${safe}-${yyyy}${mm}${dd}.json`;
}
