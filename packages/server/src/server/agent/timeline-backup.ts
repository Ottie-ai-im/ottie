// Local backup for the SQLite timeline DB.
//
// We don't ship anything cloud-side — backups live entirely on the user's
// machine under `$OTTIE_HOME/backups/`. Two modes:
//
//   1. Scheduled snapshot. Every `intervalMs` (default 24h) the daemon runs
//      `VACUUM INTO 'timeline-{ISO}.sqlite3'`. SQLite's atomic, hot-snapshot
//      operation that doesn't require pausing writes — the same primitive
//      used by Litestream. Old snapshots beyond `keep` count are deleted.
//
//   2. On-demand export. Callers (CLI / IPC) can request a snapshot to an
//      arbitrary path. Same primitive, just with the destination chosen by
//      the caller.
//
// We never delete the live DB during backup. Restoring a snapshot is a
// manual operation: stop the daemon, swap files, restart. (See README — we
// deliberately leave the destructive step to the user.)
//
// Failure posture: snapshot errors are logged but never propagate up to
// crash the daemon. Losing a backup window is preferable to losing the
// daemon process itself.

import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";

interface BackupLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
}

export interface TimelineBackupSchedulerOptions {
  /** Path to the live SQLite database. Snapshots use VACUUM INTO so we just need a connection. */
  liveDb: Database.Database;
  /** Directory snapshots land in. Created lazily. Default `$OTTIE_HOME/backups`. */
  backupsDir: string;
  /** How often to snapshot. Default once per day. Set to 0 to disable. */
  intervalMs?: number;
  /** Number of snapshots to retain (FIFO eviction). Default 7. */
  keep?: number;
  logger?: BackupLogger;
}

export interface TimelineBackupHandle {
  start(): void;
  stop(): void;
  /** Manually trigger a snapshot now. Resolves with the file path written. */
  snapshotNow(targetPath?: string): Promise<string>;
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_KEEP = 7;
const SNAPSHOT_PREFIX = "timeline-";
const SNAPSHOT_SUFFIX = ".sqlite3";

export function createTimelineBackupScheduler(
  options: TimelineBackupSchedulerOptions,
): TimelineBackupHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const keep = Math.max(1, options.keep ?? DEFAULT_KEEP);
  const logger = options.logger;
  let timer: ReturnType<typeof setInterval> | null = null;

  function snapshotPath(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z"); // keep Z for clarity, swap colons for filesystem safety
    return join(options.backupsDir, `${SNAPSHOT_PREFIX}${stamp}${SNAPSHOT_SUFFIX}`);
  }

  async function snapshotNow(target?: string): Promise<string> {
    const dest = target ?? snapshotPath();
    mkdirSync(options.backupsDir, { recursive: true });
    // VACUUM INTO is the SQLite-blessed hot-backup primitive. It writes a
    // consistent snapshot to a new file without locking out writers on the
    // live DB beyond a brief checkpoint. Synchronous in better-sqlite3.
    options.liveDb.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    enforceRetention(options.backupsDir, keep, logger);
    logger?.info("timeline backup snapshot written", { dest });
    return dest;
  }

  function start(): void {
    if (intervalMs <= 0) {
      logger?.info("timeline backup scheduler disabled (intervalMs=0)");
      return;
    }
    if (timer) return;
    // Take the first snapshot 30s after start so we don't collide with
    // daemon-boot work. Subsequent snapshots fire on `intervalMs`.
    const firstShotTimer = setTimeout(() => {
      void snapshotNow().catch((err) => {
        logger?.warn("timeline backup snapshot failed (initial)", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      timer = setInterval(() => {
        void snapshotNow().catch((err) => {
          logger?.warn("timeline backup snapshot failed (scheduled)", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, intervalMs);
    }, 30_000);
    // Track the timer so stop() can cancel pre-first-shot too.
    timer = firstShotTimer as unknown as ReturnType<typeof setInterval>;
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      clearTimeout(timer as unknown as ReturnType<typeof setTimeout>);
      timer = null;
    }
  }

  return { start, stop, snapshotNow };
}

interface SnapshotEntry {
  path: string;
  mtimeMs: number;
}

function enforceRetention(dir: string, keep: number, logger?: BackupLogger): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const snapshots: SnapshotEntry[] = [];
  for (const name of entries) {
    if (!name.startsWith(SNAPSHOT_PREFIX) || !name.endsWith(SNAPSHOT_SUFFIX)) continue;
    const full = join(dir, name);
    try {
      const stat = statSync(full);
      snapshots.push({ path: full, mtimeMs: stat.mtimeMs });
    } catch {
      // ignore unreadable entries
    }
  }
  if (snapshots.length <= keep) return;
  // Newest first.
  snapshots.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const stale = snapshots.slice(keep);
  for (const entry of stale) {
    try {
      rmSync(entry.path, { force: true });
      logger?.info("timeline backup snapshot evicted", { path: entry.path });
    } catch (err) {
      logger?.warn("timeline backup retention failed to remove", {
        path: entry.path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
