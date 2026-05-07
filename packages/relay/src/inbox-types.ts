/**
 * Phase 3.b/2b — relay-side offline message inbox.
 *
 * Wire-shape constants and canonical payload builders for the HTTP inbox
 * API. Senders POST encrypted blobs addressed to a recipient's root
 * pubkey (no auth — anyone can drop). Recipients fetch and ack with an
 * Ed25519-signed challenge proving control of the root key.
 *
 * Storage is Cloudflare KV (eventually consistent — recipients tolerate
 * a brief convergence window, same as live friend-sync). Keys live under
 * the `inbox:msg:{recipientPubKey}:{seq}` prefix; seq is a lex-sortable
 * timestamp + random suffix so KV-LIST returns oldest-first naturally.
 *
 * The blob in the value is opaque to the relay — it's a NaCl-box
 * ciphertext that only the recipient (with their identity X25519 private
 * key — see Phase 3.b/2a) can decrypt. The inner plaintext is a
 * `FriendChatMessageEnvelope` carrying the sender's root signature, so
 * authenticity verification happens entirely at the recipient.
 */

// ----- size + quota limits ------------------------------------------------

/** Max ciphertext size per POST. Larger uploads → 413. */
export const INBOX_MAX_BLOB_BYTES = 64 * 1024;

/** Max stored entries per recipient before POST → 507. */
export const INBOX_MAX_ENTRIES_PER_RECIPIENT = 1000;

/** Max total bytes per recipient before POST → 507. */
export const INBOX_MAX_BYTES_PER_RECIPIENT = 10 * 1024 * 1024;

/** TTL applied to every inbox entry. */
export const INBOX_ENTRY_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Auth-timestamp tolerance for GET/DELETE proofs. Wider than necessary
 * for clock skew; tighter than naïve "no replay protection" (network-
 * level adversary still has at most this window to replay an
 * intercepted proof, which they couldn't have intercepted under HTTPS
 * anyway — this is defense-in-depth).
 */
export const INBOX_AUTH_TIMESTAMP_WINDOW_MS = 60_000;

// ----- key-space conventions ---------------------------------------------

/** KV key prefix for inbox entries. {seq} part is lex-sortable. */
export function inboxEntryKey(args: { recipientRootPubKeyB64Url: string; seq: string }): string {
  return `inbox:msg:${args.recipientRootPubKeyB64Url}:${args.seq}`;
}

/** KV key prefix used by LIST when fetching all of a recipient's entries. */
export function inboxEntryPrefix(recipientRootPubKeyB64Url: string): string {
  return `inbox:msg:${recipientRootPubKeyB64Url}:`;
}

/** KV key for a recipient's metadata blob (running totals for quota check). */
export function inboxMetaKey(recipientRootPubKeyB64Url: string): string {
  return `inbox:meta:${recipientRootPubKeyB64Url}`;
}

/**
 * Generate a new entry seq. Format: 16-char zero-padded ms-since-epoch +
 * 8 hex chars of randomness. Lex-sortable (oldest-first when KV LIST
 * returns), low collision risk (~1 in 4 billion per ms even under heavy
 * concurrent POST load).
 */
export function nextInboxSeq(nowMs: number = Date.now()): string {
  const tsPart = nowMs.toString().padStart(16, "0");
  const randPart = randomHex(8);
  return `${tsPart}-${randPart}`;
}

function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

// ----- canonical signed payloads -----------------------------------------

/**
 * What the recipient's root sign privkey signs to authenticate a fetch.
 * Bound to action + recipient pubkey + timestamp so a leaked fetch proof
 * can only authenticate fetches for the same recipient within the
 * timestamp window.
 *
 *   ottie-inbox-fetch-v1
 *   {recipientRootPubKeyB64Url}
 *   {timestampMs}
 */
export function inboxFetchAuthPayload(args: {
  recipientRootPubKeyB64Url: string;
  timestampMs: number;
}): string {
  return ["ottie-inbox-fetch-v1", args.recipientRootPubKeyB64Url, String(args.timestampMs)].join(
    "\n",
  );
}

/**
 * What the recipient's root sign privkey signs to authenticate a delete.
 * Bound to specific seq so a leaked delete proof can only delete that
 * one entry, not arbitrarily wipe the inbox.
 *
 *   ottie-inbox-delete-v1
 *   {recipientRootPubKeyB64Url}
 *   {timestampMs}
 *   {seq}
 */
export function inboxDeleteAuthPayload(args: {
  recipientRootPubKeyB64Url: string;
  timestampMs: number;
  seq: string;
}): string {
  return [
    "ottie-inbox-delete-v1",
    args.recipientRootPubKeyB64Url,
    String(args.timestampMs),
    args.seq,
  ].join("\n");
}

// ----- HTTP header names -------------------------------------------------

export const INBOX_HEADER_RECIPIENT = "X-Ottie-Recipient";
export const INBOX_HEADER_TIMESTAMP = "X-Ottie-Auth-Timestamp";
export const INBOX_HEADER_SIGNATURE = "X-Ottie-Auth-Signature";

// ----- response shapes ---------------------------------------------------

export interface InboxPostResponseBody {
  /** Lex-sortable seq the entry was stored under. Echo back to caller. */
  seq: string;
  /** ISO timestamp (server clock) when the entry was durably stored. */
  deliveredAt: string;
}

export interface InboxFetchResponseBody {
  entries: ReadonlyArray<{
    seq: string;
    /** Standard base64 encoding of the stored ciphertext. */
    ciphertextB64: string;
    /** ISO timestamp the entry was durably stored. */
    deliveredAt: string;
  }>;
  /**
   * The seq of the most recent entry returned. Recipients persist this
   * as their cursor; subsequent fetches pass it as `?since=...` to skip
   * already-pulled entries. Empty string if the page was empty.
   */
  nextCursor: string;
  /** True when KV reports more entries beyond this page. */
  hasMore: boolean;
}

export interface InboxMetaSnapshot {
  /** Number of entries currently stored under this recipient. */
  entryCount: number;
  /** Sum of ciphertext lengths currently stored. */
  totalBytes: number;
  /** Last entry's stored timestamp, ISO. Empty when meta is fresh. */
  lastDeliveredAt: string;
}
