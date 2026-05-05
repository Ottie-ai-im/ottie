import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

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

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let costUsd = 0;
  let messagesCount = 0;
  let firstMs: number | null = null;
  let lastMs: number | null = null;
  let weekTokens = 0;
  let weekCost = 0;

  // 5-hour block: we want the earliest message timestamp within [now-5h, now]
  // as the block anchor; reset is anchor + 5h.
  let blockAnchorMs: number | null = null;
  let blockTokens = 0;

  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: ClaudeUsageEntry;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const usage = entry.message?.usage;
      if (!usage) continue;
      const inT = usage.input_tokens ?? 0;
      const outT = usage.output_tokens ?? 0;
      const crT = usage.cache_read_input_tokens ?? 0;
      const cwT = usage.cache_creation_input_tokens ?? 0;
      const total = inT + outT + crT + cwT;
      if (total === 0) continue;
      inputTokens += inT;
      outputTokens += outT;
      cacheReadTokens += crT;
      cacheWriteTokens += cwT;
      const cost = costForUsage(entry.message?.model, usage);
      costUsd += cost;
      messagesCount += 1;

      const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
      if (Number.isFinite(ts)) {
        if (firstMs === null || ts < firstMs) firstMs = ts;
        if (lastMs === null || ts > lastMs) lastMs = ts;
        if (ts >= weekCutoff) {
          weekTokens += total;
          weekCost += cost;
        }
        if (ts >= blockCutoff) {
          if (blockAnchorMs === null || ts < blockAnchorMs) blockAnchorMs = ts;
          blockTokens += total;
        }
      }
    }
  }

  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

  return {
    provider: "claude-code",
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    estimatedCostUsd: costUsd,
    sessionsCount: files.length,
    messagesCount,
    firstMessageAt: firstMs !== null ? new Date(firstMs).toISOString() : null,
    lastMessageAt: lastMs !== null ? new Date(lastMs).toISOString() : null,
    currentBlockStartedAt: blockAnchorMs !== null ? new Date(blockAnchorMs).toISOString() : null,
    currentBlockResetsAt:
      blockAnchorMs !== null ? new Date(blockAnchorMs + FIVE_HOURS_MS).toISOString() : null,
    currentBlockTokens: blockTokens,
    weekTokens,
    weekCostUsd: weekCost,
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

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let messagesCount = 0;
  let firstMs: number | null = null;
  let lastMs: number | null = null;
  let weekTokens = 0;
  let blockAnchorMs: number | null = null;
  let blockTokens = 0;

  // For codex, total_token_usage is cumulative within a session — to avoid
  // double-counting we read the LAST token_count event per file.
  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
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
        messagesCount += 1;
      }
    }
    const u = lastUsage?.info?.total_token_usage;
    if (!u) continue;
    const inT = u.input_tokens ?? 0;
    const outT = u.output_tokens ?? 0;
    const crT = u.cached_input_tokens ?? 0;
    const total = inT + outT + crT;
    if (total === 0) continue;
    inputTokens += inT;
    outputTokens += outT;
    cacheReadTokens += crT;
    if (lastTs !== null) {
      if (firstMs === null || lastTs < firstMs) firstMs = lastTs;
      if (lastMs === null || lastTs > lastMs) lastMs = lastTs;
      if (lastTs >= weekCutoff) weekTokens += total;
      if (lastTs >= blockCutoff) {
        if (blockAnchorMs === null || lastTs < blockAnchorMs) blockAnchorMs = lastTs;
        blockTokens += total;
      }
    }
  }

  const totalTokens = inputTokens + outputTokens + cacheReadTokens;

  return {
    provider: "codex",
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens: 0,
    totalTokens,
    estimatedCostUsd: null,
    sessionsCount: files.length,
    messagesCount,
    firstMessageAt: firstMs !== null ? new Date(firstMs).toISOString() : null,
    lastMessageAt: lastMs !== null ? new Date(lastMs).toISOString() : null,
    currentBlockStartedAt: blockAnchorMs !== null ? new Date(blockAnchorMs).toISOString() : null,
    currentBlockResetsAt:
      blockAnchorMs !== null ? new Date(blockAnchorMs + FIVE_HOURS_MS).toISOString() : null,
    currentBlockTokens: blockTokens,
    weekTokens,
    weekCostUsd: null,
  };
}

export async function getUsageSummary(): Promise<UsageSummary> {
  const home = os.homedir();
  const [claude, codex] = await Promise.all([aggregateClaude(home), aggregateCodex(home)]);
  return {
    generatedAt: new Date().toISOString(),
    providers: [claude, codex],
  };
}
