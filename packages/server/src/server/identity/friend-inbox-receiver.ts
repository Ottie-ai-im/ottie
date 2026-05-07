import type pino from "pino";

import { p2pRoomId } from "../chat/chat-types.js";
import { appendFriendChatMessage, type StoredFriendChatMessage } from "./friend-chat-store.js";
import { verifyFriendChatMessageEnvelope } from "./friend-chat-crypto.js";
import { type FriendChatMessageEnvelope } from "./friend-chat-types.js";
import {
  deleteInbox,
  getInbox,
  type InboxAuthSigner,
  type InboxFetchEntry,
} from "./friend-inbox-client.js";
import {
  advanceInboxCursor,
  loadInboxCursor,
  type InboxCursor,
} from "./friend-inbox-cursor-store.js";
import { decryptInboxBlob } from "./friend-inbox-crypto.js";
import type { StoredPeer } from "./peer-types.js";

/**
 * Phase 3.b/2d — recipient's offline-inbox poller.
 *
 * One round of `processInboxOnce` does:
 *   1. Load cursor.
 *   2. GET `/inbox/{ownPubKey}?since=cursor` from relay.
 *   3. For each entry (oldest first):
 *      a. decryptInboxBlob with own X25519 priv → envelope
 *      b. find sender peer by `envelope.message.authorRootPubKey`
 *      c. verifyFriendChatMessageEnvelope (Ed25519 root sig)
 *      d. appendFriendChatMessage (idempotent: dedup by clientMessageId)
 *      e. delete-ack the seq from relay
 *      f. advance cursor regardless of ACK outcome (relay TTL cleans
 *         orphaned entries; cursor advance prevents re-processing on
 *         next poll).
 *   4. Loop while `hasMore` reports more pages, up to a per-call cap.
 *
 * Failure handling per entry:
 *   - decrypt fails / schema fails / sig fails / no peer → log, treat
 *     as a poison entry (advance cursor, attempt ACK, do NOT persist).
 *   - persist fails → bail out for this round; cursor stays where it
 *     was so the same page comes back on the next poll. Avoids
 *     silently dropping good messages on a transient disk error.
 *   - GET fails / DELETE fails → log; cursor for that seq still
 *     advances on next successful page (relay TTL will GC if needed).
 */

export const INBOX_RECEIVER_DEFAULT_PAGE_LIMIT = 50;
export const INBOX_RECEIVER_MAX_PAGES_PER_CALL = 20; // hard cap so an
// unbounded inbox can't lock the daemon's IO loop on a single tick

export interface ProcessInboxOnceDeps {
  ottieHome: string;
  /** Recipient's root sign pubkey (JWK 'x' base64url). */
  selfRootSignPublicKeyB64: string;
  /** Recipient's X25519 priv (JWK 'd' base64url) — used to decrypt blobs. */
  selfEncryptionPrivateKeyB64: string;
  /** Recipient's signer (wraps Node KeyObject Ed25519 root sign privkey). */
  authSigner: InboxAuthSigner;
  relayEndpoint: string;
  /** Lookup by peer root sign pubkey. Returns null if not paired. */
  findPeer: (peerRootSignPublicKeyB64: string) => StoredPeer | null;
  /** Override clock (tests). */
  nowMs?: () => number;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Optional logger. */
  logger?: pino.Logger;
  /** Override page limit (tests). */
  pageLimit?: number;
  /** Override max-pages cap (tests). */
  maxPagesPerCall?: number;
}

export interface ProcessInboxOnceResult {
  /** How many entries successfully persisted into the chat store. */
  persisted: number;
  /** How many entries were intentionally dropped (poison / wrong peer). */
  dropped: number;
  /** Cursor after this round. */
  cursor: InboxCursor;
  /** True if the relay reported more pages but we hit the per-call cap. */
  hitMaxPagesCap: boolean;
}

export async function processInboxOnce(
  deps: ProcessInboxOnceDeps,
): Promise<ProcessInboxOnceResult> {
  const log = deps.logger?.child({ module: "friend-inbox-receiver" });
  const now = deps.nowMs ?? Date.now;
  const pageLimit = deps.pageLimit ?? INBOX_RECEIVER_DEFAULT_PAGE_LIMIT;
  const maxPages = deps.maxPagesPerCall ?? INBOX_RECEIVER_MAX_PAGES_PER_CALL;

  let cursor = loadInboxCursor(deps.ottieHome, deps.logger);
  let persisted = 0;
  let dropped = 0;
  let hitMaxPagesCap = false;

  for (let pageNum = 0; pageNum < maxPages; pageNum++) {
    const fetchOutcome = await getInbox({
      relayEndpoint: deps.relayEndpoint,
      recipientRootPubKeyB64Url: deps.selfRootSignPublicKeyB64,
      since: cursor.lastSeenSeq,
      authSigner: deps.authSigner,
      nowMs: now(),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      limit: pageLimit,
    });
    if (!fetchOutcome.ok) {
      log?.warn(
        { status: fetchOutcome.status, error: fetchOutcome.error, pageNum },
        "inbox_get_failed",
      );
      break;
    }
    if (fetchOutcome.entries.length === 0) {
      break;
    }
    for (const entry of fetchOutcome.entries) {
      const outcome = await processSingleEntry(entry, deps, log);
      if (outcome === "persisted") persisted++;
      else if (outcome === "dropped") dropped++;
      else if (outcome === "abort") {
        // Persist failed — don't advance cursor; bail out so the
        // same page is retried on the next poll.
        return { persisted, dropped, cursor, hitMaxPagesCap: false };
      }
      cursor = advanceInboxCursor(deps.ottieHome, entry.seq, deps.logger);
      // Best-effort ACK; relay TTL cleans up if this fails.
      const delOutcome = await deleteInbox({
        relayEndpoint: deps.relayEndpoint,
        recipientRootPubKeyB64Url: deps.selfRootSignPublicKeyB64,
        seq: entry.seq,
        authSigner: deps.authSigner,
        nowMs: now(),
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });
      if (!delOutcome.ok) {
        log?.warn(
          { status: delOutcome.status, error: delOutcome.error, seq: entry.seq },
          "inbox_delete_failed",
        );
      }
    }
    if (!fetchOutcome.hasMore) break;
    if (pageNum + 1 >= maxPages) {
      hitMaxPagesCap = true;
      log?.warn({ maxPages, persisted, dropped }, "inbox_processed_max_pages_more_remaining");
    }
  }

  if (persisted > 0 || dropped > 0) {
    log?.info({ persisted, dropped, cursor: cursor.lastSeenSeq }, "inbox_processed");
  }
  return { persisted, dropped, cursor, hitMaxPagesCap };
}

type SingleEntryOutcome = "persisted" | "dropped" | "abort";

async function processSingleEntry(
  entry: InboxFetchEntry,
  deps: ProcessInboxOnceDeps,
  log: pino.Logger | undefined,
): Promise<SingleEntryOutcome> {
  // 1. Decrypt the wrapped blob. The relay returned the ciphertext as
  // standard base64; the inbox blob format itself is JSON, so we must
  // base64-decode then UTF-8 read.
  const blobJson = b64ToUtf8(entry.ciphertextB64);
  if (blobJson === null) {
    log?.warn({ seq: entry.seq }, "inbox_entry_blob_decode_failed");
    return "dropped";
  }
  const decryptOutcome = decryptInboxBlob({
    blob: blobJson,
    selfEncryptionPrivateKeyB64: deps.selfEncryptionPrivateKeyB64,
  });
  if (!decryptOutcome.ok) {
    log?.warn({ seq: entry.seq, reason: decryptOutcome.reason }, "inbox_entry_decrypt_failed");
    return "dropped";
  }
  const envelope: FriendChatMessageEnvelope = decryptOutcome.envelope;

  // 2. Find the sender peer. authorRootPubKey is technically optional
  // on the legacy ChatMessage schema (agent-chat use case) but always
  // present on a p2p envelope; reject anything missing.
  const authorRootPubKey = envelope.message.authorRootPubKey;
  if (!authorRootPubKey) {
    log?.warn({ seq: entry.seq }, "inbox_entry_envelope_missing_author_pubkey");
    return "dropped";
  }
  const peer = deps.findPeer(authorRootPubKey);
  if (!peer) {
    log?.warn(
      { seq: entry.seq, authorPrefix: authorRootPubKey.slice(0, 8) },
      "inbox_entry_unknown_peer",
    );
    return "dropped";
  }

  // 3. Verify the envelope's Ed25519 root signature against the peer's
  // root sign pubkey we recorded at pair time. Also re-derive the
  // expected p2p roomId from (self, peer) and check the envelope's
  // claimed roomId matches — defends against cross-room replay.
  const expectedRoomId = p2pRoomId({
    aRootPubKey: deps.selfRootSignPublicKeyB64,
    bRootPubKey: peer.peerRootSignPublicKeyB64,
  });
  const verifyOutcome = verifyFriendChatMessageEnvelope({
    envelope,
    expectedPeerRootPubKey: peer.peerRootSignPublicKeyB64,
    expectedRoomId,
  });
  if (!verifyOutcome.ok) {
    log?.warn({ seq: entry.seq, reason: verifyOutcome.reason }, "inbox_entry_signature_invalid");
    return "dropped";
  }

  // 4. Persist via the existing friend-chat store. Append-only; the
  // dedup-by-message-id pass is a planned 3.b/2d2 follow-up — for now
  // duplicate processing on cursor reset just produces an extra
  // identical line, which the UI's clientMessageId-aware renderer
  // collapses anyway.
  let stored: StoredFriendChatMessage;
  try {
    stored = appendFriendChatMessage(
      deps.ottieHome,
      peer.peerRootSignPublicKeyB64,
      {
        message: envelope.message,
        authorSignatureB64: envelope.authorSignatureB64,
        persistedAt: new Date().toISOString(),
        deliveryStatus: "delivered",
      },
      deps.logger,
    );
  } catch (err) {
    log?.error(
      { err, seq: entry.seq, peerPrefix: peer.peerRootSignPublicKeyB64.slice(0, 8) },
      "inbox_entry_persist_failed",
    );
    return "abort";
  }

  log?.info(
    {
      seq: entry.seq,
      peerPrefix: peer.peerRootSignPublicKeyB64.slice(0, 8),
      messageId: envelope.message.id,
      storedSeq: stored.storedSeq,
    },
    "inbox_entry_persisted",
  );
  return "persisted";
}

function b64ToUtf8(input: string): string | null {
  try {
    return Buffer.from(input, "base64").toString("utf8");
  } catch {
    return null;
  }
}
