import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  type WriteFileOptions,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type pino from "pino";

import { ChatMessageSchema, type ChatMessage } from "../chat/chat-types.js";

/**
 * Phase 3.b/1d — append-only durable store for p2p chat messages,
 * keyed by peer rootPubKey.
 *
 * Design choices:
 *   - One JSONL file per peer — easy to inspect, easy to grep, no
 *     contention with the existing `durable-chat-message-store.ts`
 *     (which is heavyweight: WAL, multi-room indexing, subscription
 *     manager). 3.b/3 will graft these into the chats list at the UI
 *     layer; the daemon-side storage stays simple.
 *   - The file name uses a sha256 of the rootPubKey (truncated to
 *     32 hex chars) so a peer's pubkey doesn't appear directly in a
 *     file path that might end up in shell history / logs / etc. The
 *     pubkey is recoverable from the message bodies inside.
 *   - Append-only: every send / receive appends one line. Read paths
 *     parse the whole file (small for personal-scale use; revisit
 *     if/when chat history grows).
 *
 * Storage layout:
 *
 *   $OTTIE_HOME/chat/friends/{sha256(peerRootPubKey).slice(0,32)}.jsonl
 *
 * Each line is a `StoredFriendChatMessage` (extends ChatMessage with
 * required `seq` / `clientMessageId` / `authorRootPubKey`). The
 * envelope's signature is stored alongside the message so the file is
 * self-verifiable: an offline tool can re-check every signature without
 * the live peer.
 */

const CHAT_DIRNAME = "chat";
const FRIENDS_DIRNAME = "friends";

export interface StoredFriendChatMessage {
  /** Mirrors the in-flight ChatMessage exactly. */
  message: ChatMessage;
  /** Original signature from the envelope, base64url. */
  authorSignatureB64: string;
  /** ISO timestamp when this daemon persisted the line. */
  persistedAt: string;
  /**
   * Per-room monotonic seq, assigned at persist time. NOT the same as
   * `message.seq` (which is reserved for the agent-chat WAL). Lets
   * Phase 3.b/3 do "everything after seq N" cursor sync.
   */
  storedSeq: number;
}

export function friendChatDirPath(ottieHome: string): string {
  return path.join(ottieHome, CHAT_DIRNAME, FRIENDS_DIRNAME);
}

export function friendChatFilePath(ottieHome: string, peerRootPubKey: string): string {
  const safe = sha256Hex(peerRootPubKey).slice(0, 32);
  return path.join(friendChatDirPath(ottieHome), `${safe}.jsonl`);
}

/**
 * Append a friend-chat line to the per-peer JSONL. Creates the
 * `$OTTIE_HOME/chat/friends/` dir on demand with mode 0o700.
 */
export function appendFriendChatMessage(
  ottieHome: string,
  peerRootPubKey: string,
  entry: Omit<StoredFriendChatMessage, "storedSeq">,
  logger?: pino.Logger,
): StoredFriendChatMessage {
  const dir = friendChatDirPath(ottieHome);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = friendChatFilePath(ottieHome, peerRootPubKey);

  // Compute next seq by scanning. Cheap for typical chat volumes
  // (<10k lines per friend). Phase 3.b/3 may add a sidecar cursor
  // file if profiling shows this becomes a bottleneck.
  const existing = listFriendChatMessages(ottieHome, peerRootPubKey, logger);
  const storedSeq = (existing[existing.length - 1]?.storedSeq ?? 0) + 1;

  const stored: StoredFriendChatMessage = { ...entry, storedSeq };
  const line = `${JSON.stringify(stored)}\n`;
  // O_APPEND on POSIX is atomic for writes <= PIPE_BUF (4 KiB on
  // macOS / 4-64 KiB on Linux). A typical chat line is well under
  // that — concurrent appends from different daemons under the same
  // identity would still interleave at line boundaries.
  const opts: WriteFileOptions = { mode: 0o600 };
  appendFileSync(filePath, line, opts);
  logger?.child({ module: "friend-chat-store" }).info(
    {
      peerRootPubKeyPrefix: peerRootPubKey.slice(0, 8),
      storedSeq,
      messageId: entry.message.id,
    },
    "friend_chat_message_persisted",
  );
  return stored;
}

/**
 * Read every persisted line for `peerRootPubKey`. Returns [] when the
 * file doesn't exist yet. Bad lines (corrupt JSON, schema-fail) are
 * skipped with a warning so a single bad write doesn't poison the
 * whole history.
 */
export function listFriendChatMessages(
  ottieHome: string,
  peerRootPubKey: string,
  logger?: pino.Logger,
): readonly StoredFriendChatMessage[] {
  const filePath = friendChatFilePath(ottieHome, peerRootPubKey);
  if (!existsSync(filePath)) return [];
  const log = logger?.child({ module: "friend-chat-store" });
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const out: StoredFriendChatMessage[] = [];
  for (const [i, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      log?.warn(
        { err, lineNumber: i + 1, peerRootPubKeyPrefix: peerRootPubKey.slice(0, 8) },
        "friend_chat_store_unparseable_line_skipped",
      );
      continue;
    }
    const validated = StoredFriendChatMessageInternal.safeParse(parsed);
    if (!validated.success) {
      log?.warn(
        {
          issues: validated.error.issues,
          lineNumber: i + 1,
          peerRootPubKeyPrefix: peerRootPubKey.slice(0, 8),
        },
        "friend_chat_store_schema_fail_line_skipped",
      );
      continue;
    }
    out.push(validated.data);
  }
  return out;
}

/**
 * Snapshot of all peers we have any chat history with. Phase 3.b/3 uses
 * this to populate the chats list. Returns peerRootPubKey only; caller
 * cross-references against peers.json for displayName / status.
 */
export function listFriendChatPeers(ottieHome: string): readonly string[] {
  const dir = friendChatDirPath(ottieHome);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  // The dir name is sha256(pubkey).slice(0,32), so we can't recover
  // the pubkey from the filename. Instead, peek at the first line of
  // each file — every line carries `message.authorRootPubKey` (sender)
  // OR we infer the peer from peers.json. For simplicity here we
  // return the digests; callers cross-check with peers.json by
  // computing the same digest for each peer.
  return files.map((f) => f.replace(/\.jsonl$/, ""));
}

// ----- internal: schema for stored lines ---------------------------------
//
// Defined inline (not exported) because the on-disk shape is internal
// to this store. The wire shape lives in `friend-chat-types.ts`.

import { z } from "zod";

const StoredFriendChatMessageInternal = z.object({
  message: ChatMessageSchema,
  authorSignatureB64: z.string().min(1),
  persistedAt: z.string(),
  storedSeq: z.number().int().positive(),
});

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
