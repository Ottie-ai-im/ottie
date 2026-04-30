// One-shot migration: import legacy `<rootDir>/<agentId>.jsonl` files into
// the new SQLite timeline store, then leave a `.imported` sentinel so we
// don't redo the work on every daemon start.
//
// We do NOT delete the .jsonl files — they're kept as an extra safety net
// for the user to copy off if the SQLite migration ever turns out to be
// botched. A separate "drop legacy" admin command will remove them later.
//
// Failure mode: if any single file is malformed we log and skip that agent
// but continue with the rest. The daemon should boot even if one agent's
// history is unreadable.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import type { SqliteAgentTimelineStore } from "./sqlite-agent-timeline-store.js";

const SENTINEL_FILENAME = ".jsonl-imported";

interface ImportSummary {
  filesScanned: number;
  agentsImported: number;
  rowsImported: number;
  skipped: string[];
}

interface ImportLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
}

export interface ImportLegacyJsonlOptions {
  /** Directory that used to hold per-agent JSONL files. Same as the new SQLite root dir. */
  jsonlRootDir: string;
  store: SqliteAgentTimelineStore;
  logger?: ImportLogger;
}

export async function importLegacyJsonlIfNeeded(
  options: ImportLegacyJsonlOptions,
): Promise<ImportSummary | null> {
  const { jsonlRootDir, store, logger } = options;

  if (!existsSync(jsonlRootDir)) {
    return null;
  }

  const sentinelPath = join(jsonlRootDir, SENTINEL_FILENAME);
  if (existsSync(sentinelPath)) {
    return null;
  }

  let entries: string[];
  try {
    entries = readdirSync(jsonlRootDir);
  } catch (err) {
    logger?.warn("legacy timeline import: could not read jsonl root", {
      jsonlRootDir,
      error: (err as Error).message,
    });
    return null;
  }

  const summary: ImportSummary = {
    filesScanned: 0,
    agentsImported: 0,
    rowsImported: 0,
    skipped: [],
  };

  for (const filename of entries) {
    if (!filename.endsWith(".jsonl")) continue;
    summary.filesScanned += 1;
    const agentId = filename.slice(0, -".jsonl".length);
    const fullPath = join(jsonlRootDir, filename);
    let rows: AgentTimelineRow[];
    try {
      rows = parseJsonlFile(fullPath);
    } catch (err) {
      logger?.warn("legacy timeline import: failed to parse jsonl", {
        agentId,
        error: (err as Error).message,
      });
      summary.skipped.push(agentId);
      continue;
    }
    if (rows.length === 0) continue;

    // Skip if SQLite already has rows for this agent (re-import is a no-op
    // anyway thanks to INSERT OR IGNORE, but skipping the work is cheap).
    const existingMax = await store.getLatestCommittedSeq(agentId);
    if (existingMax >= rows[rows.length - 1]!.seq) {
      continue;
    }

    try {
      await store.bulkInsert(agentId, rows);
      summary.agentsImported += 1;
      summary.rowsImported += rows.length;
    } catch (err) {
      logger?.warn("legacy timeline import: bulkInsert failed", {
        agentId,
        error: (err as Error).message,
      });
      summary.skipped.push(agentId);
    }
  }

  // Drop the sentinel only after a successful pass — even partial success
  // counts; failures were logged per-agent. Re-running won't double-insert
  // because PK + INSERT OR IGNORE makes the path idempotent.
  try {
    mkdirSync(jsonlRootDir, { recursive: true });
    writeFileSync(
      sentinelPath,
      JSON.stringify(
        {
          importedAt: new Date().toISOString(),
          ...summary,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (err) {
    logger?.warn("legacy timeline import: could not write sentinel", {
      error: (err as Error).message,
    });
  }

  if (summary.agentsImported > 0 || summary.skipped.length > 0) {
    logger?.info("imported legacy jsonl timelines into sqlite", {
      filesScanned: summary.filesScanned,
      agentsImported: summary.agentsImported,
      rowsImported: summary.rowsImported,
      skipped: summary.skipped.length,
    });
  }

  return summary;
}

function parseJsonlFile(filePath: string): AgentTimelineRow[] {
  const text = readFileSync(filePath, "utf8");
  const rows: AgentTimelineRow[] = [];
  let lineNum = 0;
  for (const line of text.split("\n")) {
    lineNum += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Skip malformed line — same posture as the legacy reader.
      continue;
    }
    if (!isValidRow(parsed)) continue;
    rows.push(parsed);
  }
  rows.sort((a, b) => a.seq - b.seq);
  // Drop dupes by seq (keep first occurrence — JSONL appends only).
  const deduped: AgentTimelineRow[] = [];
  let lastSeq = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (row.seq <= lastSeq) continue;
    deduped.push(row);
    lastSeq = row.seq;
  }
  void lineNum;
  return deduped;
}

function isValidRow(value: unknown): value is AgentTimelineRow {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.seq === "number" &&
    typeof v.timestamp === "string" &&
    typeof v.item === "object" &&
    v.item !== null
  );
}
