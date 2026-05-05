// Fetches remaining-quota windows for Claude Code and Codex by calling the
// undocumented OAuth usage endpoints those CLIs talk to. Translated from
// codex-island's UsageFetcher.swift (https://github.com/ericjypark/codex-island).
//
// Claude path is macOS-only on the keychain side: the access token lives in
// the Keychain item "Claude Code-credentials". On other platforms only the
// CLAUDE_CODE_OAUTH_TOKEN env var is consulted. Codex works on every platform
// because its token is plain JSON at ~/.codex/auth.json.

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_USER_AGENT = "claude-code/2.1.121";
const CLAUDE_BETA_HEADER = "oauth-2025-04-20";
const HTTP_TIMEOUT_MS = 8_000;
const KEYCHAIN_TIMEOUT_MS = 3_000;

export interface QuotaWindow {
  /** 0..1 normalized regardless of upstream shape. */
  usedPercent: number;
  /** ISO-8601 string, or null when upstream omits it. */
  resetsAt: string | null;
}

export interface ProviderQuota {
  fiveHour: QuotaWindow | null;
  weekly: QuotaWindow | null;
  plan: string | null;
  error: string | null;
}

const EMPTY_ERROR: (msg: string) => ProviderQuota = (msg) => ({
  fiveHour: null,
  weekly: null,
  plan: null,
  error: msg,
});

// ============================================================================
// Claude
// ============================================================================

interface ClaudeCreds {
  account: string;
  accessToken: string;
  refreshToken: string;
  oauthRaw: Record<string, unknown>;
  subscriptionType: string | null;
}

interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since epoch — matches Claude Code's keychain shape. */
  expiresAt: number;
}

type FetchResult =
  | { kind: "success"; usage: ProviderQuota }
  | { kind: "unauthorized"; error: string }
  | { kind: "rateLimited"; error: string }
  | { kind: "other"; error: string };

export async function fetchClaudeQuota(): Promise<ProviderQuota> {
  let lastError = "auth required — run claude /login";

  // Plan tier ships in the keychain dict only — Anthropic's usage endpoint
  // doesn't echo it back. We peek the keychain even on the env-token path so
  // the chip works for users whose token came from Claude Desktop's child env.
  const cachedCreds = process.platform === "darwin" ? readClaudeCreds() : null;
  const plan = cachedCreds?.subscriptionType ?? null;

  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (envToken && envToken.length > 0) {
    const r = await fetchClaudeUsage(envToken, plan);
    if (r.kind === "success") return r.usage;
    if (r.kind !== "unauthorized") {
      return { fiveHour: null, weekly: null, plan, error: r.error };
    }
    lastError = r.error;
  }

  if (cachedCreds) {
    const r = await fetchClaudeUsage(cachedCreds.accessToken, plan);
    if (r.kind === "success") return r.usage;
    lastError = r.error;

    if (r.kind === "unauthorized") {
      const refreshed = await refreshClaudeToken(cachedCreds.refreshToken);
      if (refreshed) {
        // Anthropic rotates the refresh token on every call, so the one we
        // just used is now invalidated server-side. If we don't write the new
        // pair back, Claude Code's own next refresh attempt 401s and forces
        // the user to re-run /login. Persist the rotated tokens so the
        // keychain stays in sync with what the server considers valid.
        const updated: Record<string, unknown> = {
          ...cachedCreds.oauthRaw,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
        };
        writeClaudeCreds(cachedCreds.account, updated);

        const r2 = await fetchClaudeUsage(refreshed.accessToken, plan);
        if (r2.kind === "success") return r2.usage;
        lastError = r2.error;
      }
    }
  }

  return { fiveHour: null, weekly: null, plan, error: lastError };
}

async function fetchClaudeUsage(token: string, plan: string | null): Promise<FetchResult> {
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": CLAUDE_BETA_HEADER,
        Accept: "application/json",
        "Content-Type": "application/json",
        // Anthropic gates this endpoint on a CLI User-Agent. Without it the
        // request 401s even with a valid token.
        "User-Agent": CLAUDE_USER_AGENT,
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (e) {
    return { kind: "other", error: e instanceof Error ? e.message : String(e) };
  }

  if (resp.status === 401) return { kind: "unauthorized", error: "unauthorized" };
  if (resp.status === 429) return { kind: "rateLimited", error: "rate limited" };

  let body: unknown = null;
  try {
    body = await resp.json();
  } catch {
    // fall through
  }

  if (resp.status !== 200) {
    return { kind: "other", error: `HTTP ${resp.status}` };
  }

  // The endpoint also returns 200 with a rate_limit_error body sometimes;
  // don't trust the status code alone.
  const obj = body as Record<string, unknown> | null;
  const errObj =
    obj && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : null;
  if (errObj && errObj.type === "rate_limit_error") {
    return { kind: "rateLimited", error: "rate limited" };
  }
  if (!obj) {
    return { kind: "other", error: "parse error" };
  }

  return {
    kind: "success",
    usage: {
      fiveHour: parseClaudeWindow(obj.five_hour),
      weekly: parseClaudeWindow(obj.seven_day),
      plan,
      error: null,
    },
  };
}

function parseClaudeWindow(d: unknown): QuotaWindow | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  let raw: number | undefined;
  if (typeof o.utilization === "number") raw = o.utilization;
  else if (typeof o.used_percent === "number") raw = o.used_percent;
  if (raw === undefined) return null;
  const normalized = raw > 1 ? raw / 100 : raw;
  let resetsAt: string | null = null;
  if (typeof o.resets_at === "number") {
    resetsAt = new Date(o.resets_at * 1000).toISOString();
  } else if (typeof o.resets_at === "string") {
    const ms = Date.parse(o.resets_at);
    if (Number.isFinite(ms)) resetsAt = new Date(ms).toISOString();
  }
  return { usedPercent: Math.max(0, Math.min(1, normalized)), resetsAt };
}

async function refreshClaudeToken(refreshToken: string): Promise<RefreshedTokens | null> {
  let resp: Response;
  try {
    resp = await fetch("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (resp.status !== 200) return null;

  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return null;
  }
  const o = body as Record<string, unknown> | null;
  if (!o || typeof o.access_token !== "string" || typeof o.refresh_token !== "string") {
    return null;
  }
  // expires_in is seconds; Claude Code stores absolute ms.
  const expiresIn = typeof o.expires_in === "number" ? o.expires_in : 28_800;
  return {
    accessToken: o.access_token,
    refreshToken: o.refresh_token,
    expiresAt: Math.floor(Date.now() + expiresIn * 1000),
  };
}

function readClaudeCreds(): ClaudeCreds | null {
  const account = readClaudeKeychainAccount();
  if (!account) return null;

  const out = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-s", "Claude Code-credentials", "-a", account, "-w"],
    { encoding: "utf8", timeout: KEYCHAIN_TIMEOUT_MS },
  );
  if (out.status !== 0) return null;
  const raw = (out.stdout ?? "").trim();
  if (!raw) return null;

  let outer: unknown;
  try {
    outer = JSON.parse(raw);
  } catch {
    return null;
  }
  const outerObj = outer as Record<string, unknown> | null;
  const oauth =
    outerObj && typeof outerObj.claudeAiOauth === "object" && outerObj.claudeAiOauth !== null
      ? (outerObj.claudeAiOauth as Record<string, unknown>)
      : null;
  if (!oauth || typeof oauth.accessToken !== "string" || typeof oauth.refreshToken !== "string") {
    return null;
  }
  return {
    account,
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    oauthRaw: oauth,
    subscriptionType: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : null,
  };
}

// `security add-generic-password -U` requires the original account name to
// find and update the existing item. The metadata listing shapes the line as:
//     "acct"<blob>="ericpark"
// pull the value from inside the trailing quotes.
function readClaudeKeychainAccount(): string | null {
  const out = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-s", "Claude Code-credentials"],
    { encoding: "utf8", timeout: KEYCHAIN_TIMEOUT_MS },
  );
  for (const line of (out.stdout ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(`"acct"`)) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) return null;
    const value = trimmed.slice(eq + 1);
    if (!value.startsWith(`"`) || !value.endsWith(`"`) || value.length < 2) return null;
    const inner = value.slice(1, -1);
    return inner.length > 0 ? inner : null;
  }
  return null;
}

// Updates the existing `Claude Code-credentials` keychain item in place
// (`-U` flag) so the rotated OAuth tokens persist. Best-effort: a failure
// here means the next quota refresh will pay the same rotation cost again,
// but Claude Code itself recovers because the fresh refresh_token we wrote
// — if the write actually landed — works.
function writeClaudeCreds(account: string, oauth: Record<string, unknown>): boolean {
  const json = JSON.stringify({ claudeAiOauth: oauth });
  const out = spawnSync(
    "/usr/bin/security",
    ["add-generic-password", "-U", "-s", "Claude Code-credentials", "-a", account, "-w", json],
    { encoding: "utf8", timeout: KEYCHAIN_TIMEOUT_MS },
  );
  return out.status === 0;
}

// ============================================================================
// Codex
// ============================================================================

export async function fetchCodexQuota(): Promise<ProviderQuota> {
  const token = await readCodexAccessToken();
  if (!token) return EMPTY_ERROR("no codex auth");

  let resp: Response;
  try {
    resp = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (e) {
    return EMPTY_ERROR(e instanceof Error ? e.message : String(e));
  }
  if (!resp.ok) return EMPTY_ERROR(`HTTP ${resp.status}`);

  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return EMPTY_ERROR("parse error");
  }
  const obj = body as Record<string, unknown> | null;
  const rl =
    obj && typeof obj.rate_limit === "object" && obj.rate_limit !== null
      ? (obj.rate_limit as Record<string, unknown>)
      : null;
  if (!rl) return EMPTY_ERROR("parse error");

  return {
    fiveHour: parseCodexWindow(rl.primary_window),
    weekly: parseCodexWindow(rl.secondary_window),
    plan: obj && typeof obj.plan_type === "string" ? (obj.plan_type as string) : null,
    error: null,
  };
}

async function readCodexAccessToken(): Promise<string | null> {
  const p = path.join(os.homedir(), ".codex", "auth.json");
  try {
    const data = await fs.readFile(p, "utf8");
    const json = JSON.parse(data) as Record<string, unknown>;
    const tokens =
      json && typeof json.tokens === "object" && json.tokens !== null
        ? (json.tokens as Record<string, unknown>)
        : null;
    const token = tokens && typeof tokens.access_token === "string" ? tokens.access_token : null;
    return token && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function parseCodexWindow(d: unknown): QuotaWindow | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const used = typeof o.used_percent === "number" ? o.used_percent : 0;
  let resetsAt: string | null = null;
  if (typeof o.reset_at === "number") {
    resetsAt = new Date(o.reset_at * 1000).toISOString();
  }
  return { usedPercent: Math.max(0, Math.min(1, used / 100)), resetsAt };
}
