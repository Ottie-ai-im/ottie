/**
 * Phase 3.b/2b — Cloudflare Worker handler for the offline-message inbox.
 *
 * Routes:
 *   POST   /inbox/:recipientPubKey         (no auth — anyone can drop)
 *   GET    /inbox/:recipientPubKey         (auth via headers — recipient signs)
 *   DELETE /inbox/:recipientPubKey/:seq    (auth via headers — recipient signs)
 *
 * I/O-thin, pure-routing — actual storage goes through a tiny KV-shaped
 * interface so unit tests can substitute an in-memory mock without
 * dragging in Miniflare.
 */

import {
  inboxDeleteAuthPayload,
  inboxEntryKey,
  inboxEntryPrefix,
  inboxFetchAuthPayload,
  inboxMetaKey,
  nextInboxSeq,
  INBOX_AUTH_TIMESTAMP_WINDOW_MS,
  INBOX_ENTRY_TTL_SECONDS,
  INBOX_HEADER_RECIPIENT,
  INBOX_HEADER_SIGNATURE,
  INBOX_HEADER_TIMESTAMP,
  INBOX_MAX_BLOB_BYTES,
  INBOX_MAX_BYTES_PER_RECIPIENT,
  INBOX_MAX_ENTRIES_PER_RECIPIENT,
  type InboxFetchResponseBody,
  type InboxMetaSnapshot,
  type InboxPostResponseBody,
} from "./inbox-types.js";

// ----- KV interface (subset of Cloudflare's KVNamespace we actually use) ---

export interface InboxKVList {
  keys: ReadonlyArray<{ name: string; expiration?: number; metadata?: unknown }>;
  list_complete: boolean;
  cursor?: string;
}

export interface InboxKV {
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  get(key: string, type: "text"): Promise<string | null>;
  put(
    key: string,
    value: ArrayBuffer | string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<InboxKVList>;
}

export interface InboxHandlerDeps {
  inbox: InboxKV;
  /** Override for tests. Production passes Date.now. */
  nowMs?: () => number;
}

// ----- entry point --------------------------------------------------------

/**
 * Returns null if the request URL doesn't match the inbox prefix — so the
 * caller can fall through to other route handlers. Otherwise returns the
 * fully-built Response.
 */
export async function handleInboxRequest(
  request: Request,
  url: URL,
  deps: InboxHandlerDeps,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/inbox/")) {
    return null;
  }
  // /inbox/<recipientPubKey>           → POST or GET
  // /inbox/<recipientPubKey>/<seq>     → DELETE
  const tail = url.pathname.slice("/inbox/".length);
  const parts = tail.split("/").filter((p) => p.length > 0);
  if (parts.length === 0 || parts.length > 2) {
    return jsonError(404, "not_found");
  }
  const recipient = parts[0];
  if (!isValidPubKeyPath(recipient)) {
    return jsonError(400, "invalid_recipient");
  }

  if (request.method === "POST" && parts.length === 1) {
    return handlePostInbox(request, recipient, deps);
  }
  if (request.method === "GET" && parts.length === 1) {
    return handleGetInbox(request, url, recipient, deps);
  }
  if (request.method === "DELETE" && parts.length === 2) {
    return handleDeleteInbox(request, recipient, parts[1], deps);
  }
  return jsonError(405, "method_not_allowed");
}

// ----- POST: drop a new entry --------------------------------------------

async function handlePostInbox(
  request: Request,
  recipient: string,
  deps: InboxHandlerDeps,
): Promise<Response> {
  const blob = await request.arrayBuffer();
  if (blob.byteLength === 0) {
    return jsonError(400, "empty_body");
  }
  if (blob.byteLength > INBOX_MAX_BLOB_BYTES) {
    return jsonError(413, "blob_too_large");
  }

  const meta = await loadMeta(recipient, deps);
  if (meta.entryCount >= INBOX_MAX_ENTRIES_PER_RECIPIENT) {
    return jsonError(507, "recipient_quota_entries");
  }
  if (meta.totalBytes + blob.byteLength > INBOX_MAX_BYTES_PER_RECIPIENT) {
    return jsonError(507, "recipient_quota_bytes");
  }

  const now = (deps.nowMs ?? Date.now)();
  const seq = nextInboxSeq(now);
  const deliveredAt = new Date(now).toISOString();

  await deps.inbox.put(inboxEntryKey({ recipientRootPubKeyB64Url: recipient, seq }), blob, {
    expirationTtl: INBOX_ENTRY_TTL_SECONDS,
  });
  // Meta update is best-effort and intentionally non-atomic. KV is
  // eventually consistent; under heavy concurrent POST load we may
  // briefly over-count and reject some legitimate writes (or briefly
  // under-count and let one excess write through). Either is fine for a
  // soft quota gating spam — the 7-day TTL is the real bound on growth.
  const updatedMeta: InboxMetaSnapshot = {
    entryCount: meta.entryCount + 1,
    totalBytes: meta.totalBytes + blob.byteLength,
    lastDeliveredAt: deliveredAt,
  };
  await deps.inbox.put(inboxMetaKey(recipient), JSON.stringify(updatedMeta));

  const body: InboxPostResponseBody = { seq, deliveredAt };
  return jsonOk(200, body);
}

// ----- GET: fetch entries newer than cursor ------------------------------

async function handleGetInbox(
  request: Request,
  url: URL,
  recipient: string,
  deps: InboxHandlerDeps,
): Promise<Response> {
  const auth = await verifyAuthHeaders({
    request,
    recipient,
    deps,
    payloadBuilder: (timestampMs) =>
      inboxFetchAuthPayload({ recipientRootPubKeyB64Url: recipient, timestampMs }),
  });
  if (!auth.ok) return auth.response;

  const since = url.searchParams.get("since") ?? "";
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 0, 1), 100) : 50;

  // KV LIST returns keys in alphabetical order; our seq format makes
  // that chronological. Use the cursor parameter to skip everything
  // up to and including the recipient's last-seen seq.
  const prefix = inboxEntryPrefix(recipient);
  const result = await deps.inbox.list({ prefix, limit });
  // Filter out keys whose seq is <= since (already pulled by recipient).
  const fresh = since
    ? result.keys.filter((k) => k.name.slice(prefix.length) > since)
    : result.keys;

  const entries: Array<{ seq: string; ciphertextB64: string; deliveredAt: string }> = [];
  for (const key of fresh) {
    const seq = key.name.slice(prefix.length);
    const blob = await deps.inbox.get(key.name, "arrayBuffer");
    if (!blob) continue;
    entries.push({
      seq,
      ciphertextB64: arrayBufferToBase64(blob),
      // Seq's first 16 chars are the ms timestamp; turn into ISO so
      // recipients can render "delivered at" without a second roundtrip.
      deliveredAt: deliveredAtFromSeq(seq),
    });
  }

  const body: InboxFetchResponseBody = {
    entries,
    nextCursor: entries.length > 0 ? entries[entries.length - 1].seq : since,
    hasMore: !result.list_complete,
  };
  return jsonOk(200, body);
}

// ----- DELETE: ack one entry --------------------------------------------

async function handleDeleteInbox(
  request: Request,
  recipient: string,
  seq: string,
  deps: InboxHandlerDeps,
): Promise<Response> {
  if (!isValidSeq(seq)) {
    return jsonError(400, "invalid_seq");
  }
  const auth = await verifyAuthHeaders({
    request,
    recipient,
    deps,
    payloadBuilder: (timestampMs) =>
      inboxDeleteAuthPayload({ recipientRootPubKeyB64Url: recipient, timestampMs, seq }),
  });
  if (!auth.ok) return auth.response;

  const key = inboxEntryKey({ recipientRootPubKeyB64Url: recipient, seq });
  const existing = await deps.inbox.get(key, "arrayBuffer");
  await deps.inbox.delete(key);

  // Shrink meta by this entry's size if we knew the entry. Best-effort —
  // KV can be eventually consistent and a parallel POST may already have
  // updated meta; if our subtraction goes briefly negative it will
  // recover on next POST cycle.
  if (existing) {
    const meta = await loadMeta(recipient, deps);
    const updated: InboxMetaSnapshot = {
      entryCount: Math.max(0, meta.entryCount - 1),
      totalBytes: Math.max(0, meta.totalBytes - existing.byteLength),
      lastDeliveredAt: meta.lastDeliveredAt,
    };
    await deps.inbox.put(inboxMetaKey(recipient), JSON.stringify(updated));
  }
  return new Response(null, { status: 204 });
}

// ----- auth helper -------------------------------------------------------

async function verifyAuthHeaders(args: {
  request: Request;
  recipient: string;
  deps: InboxHandlerDeps;
  payloadBuilder: (timestampMs: number) => string;
}): Promise<{ ok: true } | { ok: false; response: Response }> {
  const headerRecipient = args.request.headers.get(INBOX_HEADER_RECIPIENT);
  const headerTimestamp = args.request.headers.get(INBOX_HEADER_TIMESTAMP);
  const headerSignature = args.request.headers.get(INBOX_HEADER_SIGNATURE);
  if (!headerRecipient || !headerTimestamp || !headerSignature) {
    return { ok: false, response: jsonError(401, "missing_auth_headers") };
  }
  if (headerRecipient !== args.recipient) {
    return { ok: false, response: jsonError(401, "auth_recipient_mismatch") };
  }
  const timestampMs = parseInt(headerTimestamp, 10);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, response: jsonError(401, "invalid_timestamp") };
  }
  const now = (args.deps.nowMs ?? Date.now)();
  if (Math.abs(now - timestampMs) > INBOX_AUTH_TIMESTAMP_WINDOW_MS) {
    return { ok: false, response: jsonError(410, "timestamp_outside_window") };
  }

  let pubKeyBytes: Uint8Array;
  try {
    pubKeyBytes = base64UrlToBytes(args.recipient);
  } catch {
    return { ok: false, response: jsonError(400, "invalid_recipient_encoding") };
  }
  if (pubKeyBytes.byteLength !== 32) {
    return { ok: false, response: jsonError(400, "invalid_recipient_size") };
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlToBytes(headerSignature);
  } catch {
    return { ok: false, response: jsonError(400, "invalid_signature_encoding") };
  }
  if (sigBytes.byteLength !== 64) {
    return { ok: false, response: jsonError(400, "invalid_signature_size") };
  }

  const payload = args.payloadBuilder(timestampMs);
  const payloadBytes = new TextEncoder().encode(payload);

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "raw",
      pubKeyBytes as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    return { ok: false, response: jsonError(400, "import_pubkey_failed") };
  }

  const verified = await crypto.subtle.verify(
    { name: "Ed25519" },
    cryptoKey,
    sigBytes as BufferSource,
    payloadBytes as BufferSource,
  );
  if (!verified) {
    return { ok: false, response: jsonError(401, "signature_verify_failed") };
  }
  return { ok: true };
}

// ----- meta storage helpers ---------------------------------------------

async function loadMeta(recipient: string, deps: InboxHandlerDeps): Promise<InboxMetaSnapshot> {
  const raw = await deps.inbox.get(inboxMetaKey(recipient), "text");
  if (!raw) {
    return { entryCount: 0, totalBytes: 0, lastDeliveredAt: "" };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<InboxMetaSnapshot>;
    return {
      entryCount: typeof parsed.entryCount === "number" ? parsed.entryCount : 0,
      totalBytes: typeof parsed.totalBytes === "number" ? parsed.totalBytes : 0,
      lastDeliveredAt: typeof parsed.lastDeliveredAt === "string" ? parsed.lastDeliveredAt : "",
    };
  } catch {
    return { entryCount: 0, totalBytes: 0, lastDeliveredAt: "" };
  }
}

// ----- response helpers --------------------------------------------------

function jsonOk(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ----- format validation -------------------------------------------------

function isValidPubKeyPath(s: string): boolean {
  // 32 bytes raw → 43 chars base64url unpadded. Reject anything else.
  return /^[A-Za-z0-9_-]{43}$/.test(s);
}

function isValidSeq(s: string): boolean {
  // 16-digit ts + "-" + 16 hex chars (8 bytes). See nextInboxSeq.
  return /^[0-9]{16}-[0-9a-f]{16}$/.test(s);
}

function deliveredAtFromSeq(seq: string): string {
  const tsPart = seq.slice(0, 16);
  const ms = parseInt(tsPart, 10);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString();
}

// ----- base64url helpers --------------------------------------------------

function base64UrlToBytes(input: string): Uint8Array {
  const standard = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (standard.length % 4)) % 4;
  const padded = standard + "=".repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
