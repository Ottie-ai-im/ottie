import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { fetchClaudeQuota, fetchCodexQuota, type ProviderQuota } from "./quota-fetcher.js";

// Per-million-token USD pricing for Claude models. Used to estimate cost when
// the user is on subscription — these are list prices, so the number is an
// upper-bound estimate, not what they're actually billed.
const CLAUDE_PRICING: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  "claude-opus-4": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-opus-4-1": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-opus-4-5": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-opus-4-7": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet-4": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

const DEFAULT_PRICING = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

export interface ProviderUsage {
  provider: "claude-code" | "codex";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  sessionsCount: number;
  messagesCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  // 5-hour window: anchor is the first message inside the current open block.
  // null when there's been no activity in the last 5 hours.
  currentBlockStartedAt: string | null;
  currentBlockResetsAt: string | null;
  currentBlockTokens: number;
  // 7-day rolling sums.
  weekTokens: number;
  weekCostUsd: number | null;
  // Live quota windows fetched from the provider's OAuth usage endpoint.
  // Independent from the locally-derived `currentBlock*` fields above:
  // those are computed from session logs, these are what the provider's
  // backend says is left on the subscription. May be null when the daemon
  // can't read the OAuth token (e.g. Linux/Windows host with no env var) or
  // the endpoint failed.
  quotaFiveHourUsedPercent: number | null;
  quotaFiveHourResetsAt: string | null;
  quotaWeeklyUsedPercent: number | null;
  quotaWeeklyResetsAt: string | null;
  planTier: string | null;
  quotaError: string | null;
}

export interface UsageSummary {
  generatedAt: string;
  providers: ProviderUsage[];
}

interface ClaudeUsageEntry {
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  timestamp?: string;
}

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function pricingFor(model: string | undefined) {
  if (!model) return DEFAULT_PRICING;
  for (const key of Object.keys(CLAUDE_PRICING)) {
    if (model.includes(key)) return CLAUDE_PRICING[key]!;
  }
  return DEFAULT_PRICING;
}

function costForUsage(
  model: string | undefined,
  usage: NonNullable<NonNullable<ClaudeUsageEntry["message"]>["usage"]>,
): number {
  const p = pricingFor(model);
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return (
    (input * p.input + output * p.output + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite) /
    1_000_000
  );
}

interface ClaudeAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  messagesCount: number;
  firstMs: number | null;
  lastMs: number | null;
  weekTokens: number;
  weekCost: number;
  blockAnchorMs: number | null;
  blockTokens: number;
}

/** Update time-window fields on a ClaudeAccumulator for a known-finite timestamp. */
function applyClaudeTimestamp(
  acc: ClaudeAccumulator,
  ts: number,
  total: number,
  cost: number,
  weekCutoff: number,
  blockCutoff: number,
): void {
  if (acc.firstMs === null || ts < acc.firstMs) acc.firstMs = ts;
  if (acc.lastMs === null || ts > acc.lastMs) acc.lastMs = ts;
  if (ts >= weekCutoff) {
    acc.weekTokens += total;
    acc.weekCost += cost;
  }
  if (ts >= blockCutoff) {
    if (acc.blockAnchorMs === null || ts < acc.blockAnchorMs) acc.blockAnchorMs = ts;
    acc.blockTokens += total;
  }
}

/** Process one JSONL line from a Claude session file into the accumulator. */
function processClaudeLine(
  line: string,
  weekCutoff: number,
  blockCutoff: number,
  acc: ClaudeAccumulator,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let entry: ClaudeUsageEntry;
  try {
    entry = JSON.parse(trimmed);
  } catch {
    return;
  }
  const usage = entry.message?.usage;
  if (!usage) return;
  const inT = usage.input_tokens ?? 0;
  const outT = usage.output_tokens ?? 0;
  const crT = usage.cache_read_input_tokens ?? 0;
  const cwT = usage.cache_creation_input_tokens ?? 0;
  const total = inT + outT + crT + cwT;
  if (total === 0) return;
  acc.inputTokens += inT;
  acc.outputTokens += outT;
  acc.cacheReadTokens += crT;
  acc.cacheWriteTokens += cwT;
  const cost = costForUsage(entry.message?.model, usage);
  acc.costUsd += cost;
  acc.messagesCount += 1;
  const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
  if (Number.isFinite(ts)) {
    applyClaudeTimestamp(acc, ts, total, cost, weekCutoff, blockCutoff);
  }
}

interface CodexAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  messagesCount: number;
  firstMs: number | null;
  lastMs: number | null;
  weekTokens: number;
  blockAnchorMs: number | null;
  blockTokens: number;
}

/**
 * Scan JSONL lines of a Codex session file and return the last cumulative
 * token-usage payload together with its timestamp, incrementing the message
 * counter on `acc` as a side effect.
 */
function scanCodexLines(
  lines: string[],
  acc: CodexAccumulator,
): { lastUsage: CodexUsageEntry["payload"]; lastTs: number | null } {
  let lastUsage: CodexUsageEntry["payload"] = undefined;
  let lastTs: number | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: CodexUsageEntry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (entry.payload?.info?.total_token_usage) {
      lastUsage = entry.payload;
      const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
      if (Number.isFinite(ts)) lastTs = ts;
      acc.messagesCount += 1;
    }
  }
  return { lastUsage, lastTs };
}

/** Merge final Codex token counts and time-window fields into the accumulator. */
function applyCodexUsage(
  acc: CodexAccumulator,
  u: NonNullable<NonNullable<NonNullable<CodexUsageEntry["payload"]>["info"]>["total_token_usage"]>,
  lastTs: number | null,
  weekCutoff: number,
  blockCutoff: number,
): void {
  const inT = u.input_tokens ?? 0;
  const outT = u.output_tokens ?? 0;
  const crT = u.cached_input_tokens ?? 0;
  const total = inT + outT + crT;
  if (total === 0) return;
  acc.inputTokens += inT;
  acc.outputTokens += outT;
  acc.cacheReadTokens += crT;
  if (lastTs !== null) {
    if (acc.firstMs === null || lastTs < acc.firstMs) acc.firstMs = lastTs;
    if (acc.lastMs === null || lastTs > acc.lastMs) acc.lastMs = lastTs;
    if (lastTs >= weekCutoff) acc.weekTokens += total;
    if (lastTs >= blockCutoff) {
      if (acc.blockAnchorMs === null || lastTs < acc.blockAnchorMs) acc.blockAnchorMs = lastTs;
      acc.blockTokens += total;
    }
  }
}

/**
 * Process one Codex session file: reads only the last token_count entry
 * (cumulative) and merges into the accumulator.
 */
async function processCodexFile(
  file: string,
  weekCutoff: number,
  blockCutoff: number,
  acc: CodexAccumulator,
): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(file, "utf8");
  } catch {
    return;
  }
  const { lastUsage, lastTs } = scanCodexLines(content.split("\n"), acc);
  const u = lastUsage?.info?.total_token_usage;
  if (!u) return;
  applyCodexUsage(acc, u, lastTs, weekCutoff, blockCutoff);
}

async function listJsonlFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  let stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  }
  return out;
}

async function aggregateClaude(home: string): Promise<ProviderUsage> {
  const root = path.join(home, ".claude", "projects");
  const empty: ProviderUsage = {
    provider: "claude-code",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    sessionsCount: 0,
    messagesCount: 0,
    firstMessageAt: null,
    lastMessageAt: null,
    currentBlockStartedAt: null,
    currentBlockResetsAt: null,
    currentBlockTokens: 0,
    weekTokens: 0,
    weekCostUsd: 0,
    quotaFiveHourUsedPercent: null,
    quotaFiveHourResetsAt: null,
    quotaWeeklyUsedPercent: null,
    quotaWeeklyResetsAt: null,
    planTier: null,
    quotaError: null,
  };

  let files: string[];
  try {
    await fs.access(root);
    files = await listJsonlFiles(root);
  } catch {
    return empty;
  }

  if (files.length === 0) return empty;

  const now = Date.now();
  const weekCutoff = now - WEEK_MS;
  const blockCutoff = now - FIVE_HOURS_MS;

  // 5-hour block: we want the earliest message timestamp within [now-5h, now]
  // as the block anchor; reset is anchor + 5h.
  const acc: ClaudeAccumulator = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    messagesCount: 0,
    firstMs: null,
    lastMs: null,
    weekTokens: 0,
    weekCost: 0,
    blockAnchorMs: null,
    blockTokens: 0,
  };

  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      processClaudeLine(line, weekCutoff, blockCutoff, acc);
    }
  }

  const totalTokens =
    acc.inputTokens + acc.outputTokens + acc.cacheReadTokens + acc.cacheWriteTokens;

  return {
    provider: "claude-code",
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    cacheReadTokens: acc.cacheReadTokens,
    cacheWriteTokens: acc.cacheWriteTokens,
    totalTokens,
    estimatedCostUsd: acc.costUsd,
    sessionsCount: files.length,
    messagesCount: acc.messagesCount,
    firstMessageAt: acc.firstMs !== null ? new Date(acc.firstMs).toISOString() : null,
    lastMessageAt: acc.lastMs !== null ? new Date(acc.lastMs).toISOString() : null,
    currentBlockStartedAt:
      acc.blockAnchorMs !== null ? new Date(acc.blockAnchorMs).toISOString() : null,
    currentBlockResetsAt:
      acc.blockAnchorMs !== null ? new Date(acc.blockAnchorMs + FIVE_HOURS_MS).toISOString() : null,
    currentBlockTokens: acc.blockTokens,
    weekTokens: acc.weekTokens,
    weekCostUsd: acc.weekCost,
    quotaFiveHourUsedPercent: null,
    quotaFiveHourResetsAt: null,
    quotaWeeklyUsedPercent: null,
    quotaWeeklyResetsAt: null,
    planTier: null,
    quotaError: null,
  };
}

interface CodexUsageEntry {
  type?: string;
  payload?: {
    info?: {
      total_token_usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cached_input_tokens?: number;
      };
    };
  };
  timestamp?: string;
}

async function aggregateCodex(home: string): Promise<ProviderUsage> {
  const root = path.join(home, ".codex", "sessions");
  const empty: ProviderUsage = {
    provider: "codex",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    // Codex is flat-fee subscription — no meaningful USD estimate.
    estimatedCostUsd: null,
    sessionsCount: 0,
    messagesCount: 0,
    firstMessageAt: null,
    lastMessageAt: null,
    currentBlockStartedAt: null,
    currentBlockResetsAt: null,
    currentBlockTokens: 0,
    weekTokens: 0,
    weekCostUsd: null,
    quotaFiveHourUsedPercent: null,
    quotaFiveHourResetsAt: null,
    quotaWeeklyUsedPercent: null,
    quotaWeeklyResetsAt: null,
    planTier: null,
    quotaError: null,
  };

  let files: string[];
  try {
    await fs.access(root);
    files = await listJsonlFiles(root);
  } catch {
    return empty;
  }
  if (files.length === 0) return empty;

  const now = Date.now();
  const weekCutoff = now - WEEK_MS;
  const blockCutoff = now - FIVE_HOURS_MS;

  // For codex, total_token_usage is cumulative within a session — to avoid
  // double-counting we read the LAST token_count event per file.
  const acc: CodexAccumulator = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    messagesCount: 0,
    firstMs: null,
    lastMs: null,
    weekTokens: 0,
    blockAnchorMs: null,
    blockTokens: 0,
  };

  for (const file of files) {
    await processCodexFile(file, weekCutoff, blockCutoff, acc);
  }

  const totalTokens = acc.inputTokens + acc.outputTokens + acc.cacheReadTokens;

  return {
    provider: "codex",
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    cacheReadTokens: acc.cacheReadTokens,
    cacheWriteTokens: 0,
    totalTokens,
    estimatedCostUsd: null,
    sessionsCount: files.length,
    messagesCount: acc.messagesCount,
    firstMessageAt: acc.firstMs !== null ? new Date(acc.firstMs).toISOString() : null,
    lastMessageAt: acc.lastMs !== null ? new Date(acc.lastMs).toISOString() : null,
    currentBlockStartedAt:
      acc.blockAnchorMs !== null ? new Date(acc.blockAnchorMs).toISOString() : null,
    currentBlockResetsAt:
      acc.blockAnchorMs !== null ? new Date(acc.blockAnchorMs + FIVE_HOURS_MS).toISOString() : null,
    currentBlockTokens: acc.blockTokens,
    weekTokens: acc.weekTokens,
    weekCostUsd: null,
    quotaFiveHourUsedPercent: null,
    quotaFiveHourResetsAt: null,
    quotaWeeklyUsedPercent: null,
    quotaWeeklyResetsAt: null,
    planTier: null,
    quotaError: null,
  };
}

function mergeQuota(provider: ProviderUsage, quota: ProviderQuota): ProviderUsage {
  return {
    ...provider,
    quotaFiveHourUsedPercent: quota.fiveHour ? quota.fiveHour.usedPercent : null,
    quotaFiveHourResetsAt: quota.fiveHour ? quota.fiveHour.resetsAt : null,
    quotaWeeklyUsedPercent: quota.weekly ? quota.weekly.usedPercent : null,
    quotaWeeklyResetsAt: quota.weekly ? quota.weekly.resetsAt : null,
    planTier: quota.plan,
    quotaError: quota.error,
  };
}

export async function getUsageSummary(): Promise<UsageSummary> {
  const home = os.homedir();
  const [claude, codex, claudeQuota, codexQuota] = await Promise.all([
    aggregateClaude(home),
    aggregateCodex(home),
    fetchClaudeQuota().catch(
      (e: unknown) =>
        ({
          fiveHour: null,
          weekly: null,
          plan: null,
          error: e instanceof Error ? e.message : String(e),
        }) as ProviderQuota,
    ),
    fetchCodexQuota().catch(
      (e: unknown) =>
        ({
          fiveHour: null,
          weekly: null,
          plan: null,
          error: e instanceof Error ? e.message : String(e),
        }) as ProviderQuota,
    ),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    providers: [mergeQuota(claude, claudeQuota), mergeQuota(codex, codexQuota)],
  };
}
