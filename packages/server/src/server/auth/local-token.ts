// Local-daemon authentication primitive (ARCH-03).
//
// Three modes per CONTEXT.md D-13..D-16:
//   - Mode A (loopback-trust)   : default; no token gate; today's `npm run dev` flow.
//   - Mode B (token-file)       : Tauri-bundled flow; reads `$OTTIE_HOME/local-token`.
//   - Mode C (explicit env-var) : `OTTIE_LOCAL_TOKEN` set at daemon start.
//
// The mode is resolved ONCE at daemon bootstrap. The WS upgrade gate
// (`verifyWsClient` in `websocket-server.ts`) consults the resolved mode and
// short-circuits acceptance in Mode A; in Mode B/C it constant-time compares
// `Authorization: Bearer <token>` against the resolved value.
//
// File-on-disk pattern mirrors `daemon-keypair.ts` (mode 0o600, owner-only).

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

import { resolveOttieHome } from "../ottie-home.js";

const TOKEN_FILENAME = "local-token";
const TOKEN_BYTES = 32;
const FILE_MODE = 0o600;

export type LocalTokenMode =
  | { kind: "loopback-trust" }
  | { kind: "token-file"; token: string }
  | { kind: "explicit"; token: string };

/**
 * Resolve the active local-token mode for the current process.
 *
 * Precedence (per D-15):
 *   1. `OTTIE_LOCAL_TOKEN` env var → Mode C.
 *   2. `$OTTIE_HOME/local-token` file present + non-empty → Mode B.
 *   3. Otherwise → Mode A.
 *
 * `ENOENT` on the token file falls through to Mode A. Other filesystem errors
 * propagate (fail-closed per CONVENTIONS.md "Fail explicitly") so a misconfigured
 * file system does not silently drop into the no-auth path.
 */
export async function resolveLocalTokenMode(
  env: NodeJS.ProcessEnv = process.env,
): Promise<LocalTokenMode> {
  if (typeof env.OTTIE_LOCAL_TOKEN === "string" && env.OTTIE_LOCAL_TOKEN.length > 0) {
    return { kind: "explicit", token: env.OTTIE_LOCAL_TOKEN };
  }
  const tokenPath = path.join(resolveOttieHome(env), TOKEN_FILENAME);
  try {
    const raw = await fs.readFile(tokenPath, "utf8");
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      return { kind: "token-file", token: trimmed };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
  return { kind: "loopback-trust" };
}

/**
 * Generate a fresh 32-byte base64url token, write it to `$OTTIE_HOME/local-token`
 * with mode 0o600, and return the token value.
 *
 * Matches `daemon-keypair.ts:63` for the canonical mode-0600 write pattern.
 * Used by the Settings → Advanced regenerate flow (server-side) and indirectly
 * via Tauri's `ensure_local_token()` (Rust side, separate code path).
 */
export async function generateAndWriteLocalToken(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenPath = path.join(resolveOttieHome(env), TOKEN_FILENAME);
  await fs.writeFile(tokenPath, token, { mode: FILE_MODE });
  return token;
}

/**
 * Constant-time bearer-token compare for the WS upgrade gate.
 *
 *   - Mode A (loopback-trust) → always accept (no token configured).
 *   - Mode B/C → require a non-empty provided token of equal length, then
 *     `crypto.timingSafeEqual` for the actual comparison. Length-mismatch
 *     short-circuits to `false` BEFORE timingSafeEqual (which requires
 *     equal-length buffers and would otherwise throw).
 *
 * The constant-time compare prevents timing-side-channel attacks against the
 * bearer token (T-05-07 in the threat register).
 */
export function verifyBearerToken(provided: string | undefined, mode: LocalTokenMode): boolean {
  if (mode.kind === "loopback-trust") {
    return true;
  }
  if (!provided) {
    return false;
  }
  const expected = mode.token;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
