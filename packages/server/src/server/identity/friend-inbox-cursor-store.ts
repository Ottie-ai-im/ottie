import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type pino from "pino";

import { z } from "zod";

/**
 * Phase 3.b/2d — persistent cursor for the offline-inbox poller.
 *
 * Stores the highest seq this daemon has already pulled from
 * `relay /inbox/{ownPubKey}`. Subsequent polls pass the cursor as
 * `?since=cursor` to skip already-processed entries.
 *
 * Why a separate file instead of folding it into root.json: the cursor
 * is hot (updated on every successful inbox roundtrip — multiple times
 * per minute under heavy traffic) while root.json is cold (rotates only
 * on identity migration). Splitting them keeps the auth-critical file
 * out of the IO churn, and makes recovery cheap: deleting just this
 * file replays the inbox safely (the chat store dedups by message id —
 * see `appendFriendChatMessage`'s clientMessageId path planned in
 * 3.b/2d2 as a follow-up).
 */

const CURSOR_DIRNAME = "identity";
const CURSOR_FILENAME = "inbox-cursor.json";

const InboxCursorSchema = z.object({
  v: z.literal(1),
  /** Lex-sortable seq from relay /inbox; "" means "start from the beginning". */
  lastSeenSeq: z.string(),
  /** ISO timestamp of the most recent successful update. Diagnostic only. */
  updatedAt: z.string(),
});
export type InboxCursor = z.infer<typeof InboxCursorSchema>;

export function inboxCursorFilePath(ottieHome: string): string {
  return path.join(ottieHome, CURSOR_DIRNAME, CURSOR_FILENAME);
}

/**
 * Returns the persisted cursor, a fresh "" cursor if no file exists, or
 * a fresh "" cursor on schema parse failure (logged). The "fresh on
 * parse failure" choice trades safety for resilience: a corrupt cursor
 * file would otherwise jam every future fetch, and the worst case from
 * resetting it is re-pulling whatever messages are still inside the
 * 7-day inbox TTL — a duplicate-line incident at most.
 */
export function loadInboxCursor(ottieHome: string, logger?: pino.Logger): InboxCursor {
  const log = logger?.child({ module: "inbox-cursor" });
  const filePath = inboxCursorFilePath(ottieHome);
  if (!existsSync(filePath)) {
    return { v: 1, lastSeenSeq: "", updatedAt: new Date(0).toISOString() };
  }
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = InboxCursorSchema.parse(JSON.parse(raw));
    return parsed;
  } catch (err) {
    log?.warn({ err, filePath }, "Inbox cursor file unreadable / unparseable — resetting to empty");
    return { v: 1, lastSeenSeq: "", updatedAt: new Date(0).toISOString() };
  }
}

export function saveInboxCursor(
  ottieHome: string,
  cursor: InboxCursor,
  logger?: pino.Logger,
): void {
  const log = logger?.child({ module: "inbox-cursor" });
  const filePath = inboxCursorFilePath(ottieHome);
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(cursor, null, 2)}\n`, { mode: 0o600 });
  log?.debug({ filePath, lastSeenSeq: cursor.lastSeenSeq.slice(0, 16) }, "Saved inbox cursor");
}

/**
 * Convenience: read, mutate, persist. Returns the new cursor so the
 * receiver can pass it back into the next poll without re-reading.
 */
export function advanceInboxCursor(
  ottieHome: string,
  newSeq: string,
  logger?: pino.Logger,
): InboxCursor {
  const updated: InboxCursor = {
    v: 1,
    lastSeenSeq: newSeq,
    updatedAt: new Date().toISOString(),
  };
  saveInboxCursor(ottieHome, updated, logger);
  return updated;
}
