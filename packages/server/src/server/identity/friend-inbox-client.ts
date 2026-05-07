/**
 * Phase 3.b/2c — HTTP client for the relay-side offline inbox.
 *
 * Thin wrapper around `fetch` for the three relay routes added in
 * Phase 3.b/2b:
 *
 *   POST   /inbox/{recipientPubKey}                  (used by sender)
 *   GET    /inbox/{recipientPubKey}?since=...         (3.b/2d, recipient pull)
 *   DELETE /inbox/{recipientPubKey}/{seq}             (3.b/2d, ack)
 *
 * Auth (GET / DELETE only): callers pass an `authSigner` that knows how
 * to produce an Ed25519 signature over the canonical fetch/delete
 * payload — keeps this module crypto-free so it can be tested with a
 * stub signer.
 */

// Inlined values mirror packages/relay/src/inbox-types.ts. We don't
// import from @ottie/relay at runtime here because (a) the relay's
// package re-exports a ton of Cloudflare-specific bindings the daemon
// doesn't need, and (b) keeping these as a small pinned list flags
// future drift loudly: a wire-shape change in 3.b/2b mandates an
// explicit code update on this side.
const INBOX_HEADER_RECIPIENT = "X-Ottie-Recipient";
const INBOX_HEADER_TIMESTAMP = "X-Ottie-Auth-Timestamp";
const INBOX_HEADER_SIGNATURE = "X-Ottie-Auth-Signature";

export interface PostInboxInput {
  /** Relay base, e.g. "relay.claws.company:443". */
  relayEndpoint: string;
  /** Recipient's root sign pubkey (JWK 'x' base64url). */
  recipientRootPubKeyB64Url: string;
  /** Already-encrypted inbox blob bytes (typically a JSON-encoded `InboxBlob`). */
  body: string | ArrayBuffer | Uint8Array;
  /** Override fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface PostInboxResult {
  ok: true;
  /** Lex-sortable seq the entry was stored under. Echoes back from relay. */
  seq: string;
  /** Server's ISO timestamp at storage time. */
  deliveredAt: string;
}

export type PostInboxOutcome = PostInboxResult | { ok: false; status: number; error: string };

export async function postInbox(input: PostInboxInput): Promise<PostInboxOutcome> {
  const url = buildInboxUrl(input.relayEndpoint, input.recipientRootPubKeyB64Url);
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      body: input.body as BodyInit,
      headers: { "Content-Type": "application/octet-stream" },
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: `Inbox POST network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    let serverError = "";
    try {
      const text = await response.text();
      serverError = text.length > 0 ? text : response.statusText;
    } catch {
      serverError = response.statusText;
    }
    return { ok: false, status: response.status, error: serverError };
  }
  let parsed: { seq?: unknown; deliveredAt?: unknown };
  try {
    parsed = (await response.json()) as { seq?: unknown; deliveredAt?: unknown };
  } catch (err) {
    return {
      ok: false,
      status: response.status,
      error: `Inbox POST response was not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  if (typeof parsed.seq !== "string" || typeof parsed.deliveredAt !== "string") {
    return {
      ok: false,
      status: response.status,
      error: "Inbox POST response missing seq or deliveredAt",
    };
  }
  return { ok: true, seq: parsed.seq, deliveredAt: parsed.deliveredAt };
}

// ----- 3.b/2d: GET / DELETE clients ---------------------------------------

export interface InboxAuthSigner {
  /**
   * Produce an Ed25519 signature (raw 64 bytes, base64url, no padding)
   * over the given canonical payload string. Callers in 3.b/2d build
   * `inboxFetchAuthPayload` / `inboxDeleteAuthPayload` (mirrored below)
   * and pass the result through this signer; the signer wraps a Node
   * `KeyObject` from the loaded RootIdentityBundle.
   */
  sign: (payload: string) => string | Promise<string>;
}

export interface InboxFetchEntry {
  seq: string;
  /** Raw ciphertext bytes as the relay returned them, base64-encoded. */
  ciphertextB64: string;
  /** Server's ISO timestamp at storage time. */
  deliveredAt: string;
}

export interface GetInboxInput {
  relayEndpoint: string;
  /** Recipient's root sign pubkey (JWK 'x' base64url) — used in URL + auth. */
  recipientRootPubKeyB64Url: string;
  /** "" to start from the oldest entry. */
  since: string;
  /** Recipient's signer (wraps the loaded root sign privkey). */
  authSigner: InboxAuthSigner;
  /** ms-since-epoch the recipient is currently using. */
  nowMs: number;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Optional ?limit hint. Server clamps. */
  limit?: number;
}

export type GetInboxOutcome =
  | {
      ok: true;
      entries: ReadonlyArray<InboxFetchEntry>;
      nextCursor: string;
      hasMore: boolean;
    }
  | { ok: false; status: number; error: string };

export async function getInbox(input: GetInboxInput): Promise<GetInboxOutcome> {
  const params = new URLSearchParams();
  if (input.since) params.set("since", input.since);
  if (input.limit) params.set("limit", String(input.limit));
  const qs = params.toString();
  const url = `${buildInboxUrl(input.relayEndpoint, input.recipientRootPubKeyB64Url)}${
    qs ? `?${qs}` : ""
  }`;
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers = await buildAuthHeaders({
    recipient: input.recipientRootPubKeyB64Url,
    payload: inboxFetchAuthPayload({
      recipientRootPubKeyB64Url: input.recipientRootPubKeyB64Url,
      timestampMs: input.nowMs,
    }),
    timestampMs: input.nowMs,
    authSigner: input.authSigner,
  });
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET", headers });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: `Inbox GET network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    return readErrorBody(response, "Inbox GET failed");
  }
  let parsed: {
    entries?: unknown;
    nextCursor?: unknown;
    hasMore?: unknown;
  };
  try {
    parsed = (await response.json()) as typeof parsed;
  } catch (err) {
    return {
      ok: false,
      status: response.status,
      error: `Inbox GET response was not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  if (
    !Array.isArray(parsed.entries) ||
    typeof parsed.nextCursor !== "string" ||
    typeof parsed.hasMore !== "boolean"
  ) {
    return {
      ok: false,
      status: response.status,
      error: "Inbox GET response missing entries / nextCursor / hasMore",
    };
  }
  const validEntries: InboxFetchEntry[] = [];
  for (const raw of parsed.entries) {
    if (
      typeof raw === "object" &&
      raw !== null &&
      typeof (raw as { seq?: unknown }).seq === "string" &&
      typeof (raw as { ciphertextB64?: unknown }).ciphertextB64 === "string" &&
      typeof (raw as { deliveredAt?: unknown }).deliveredAt === "string"
    ) {
      validEntries.push(raw as InboxFetchEntry);
    }
  }
  return {
    ok: true,
    entries: validEntries,
    nextCursor: parsed.nextCursor,
    hasMore: parsed.hasMore,
  };
}

export interface DeleteInboxInput {
  relayEndpoint: string;
  recipientRootPubKeyB64Url: string;
  seq: string;
  authSigner: InboxAuthSigner;
  nowMs: number;
  fetchImpl?: typeof fetch;
}

export type DeleteInboxOutcome = { ok: true } | { ok: false; status: number; error: string };

export async function deleteInbox(input: DeleteInboxInput): Promise<DeleteInboxOutcome> {
  const url = `${buildInboxUrl(input.relayEndpoint, input.recipientRootPubKeyB64Url)}/${encodeURIComponent(
    input.seq,
  )}`;
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers = await buildAuthHeaders({
    recipient: input.recipientRootPubKeyB64Url,
    payload: inboxDeleteAuthPayload({
      recipientRootPubKeyB64Url: input.recipientRootPubKeyB64Url,
      timestampMs: input.nowMs,
      seq: input.seq,
    }),
    timestampMs: input.nowMs,
    authSigner: input.authSigner,
  });
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "DELETE", headers });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: `Inbox DELETE network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    return readErrorBody(response, "Inbox DELETE failed");
  }
  return { ok: true };
}

// ----- internal: auth headers + error body --------------------------------

async function buildAuthHeaders(args: {
  recipient: string;
  payload: string;
  timestampMs: number;
  authSigner: InboxAuthSigner;
}): Promise<Record<string, string>> {
  const sig = await args.authSigner.sign(args.payload);
  return {
    [INBOX_HEADER_RECIPIENT]: args.recipient,
    [INBOX_HEADER_TIMESTAMP]: String(args.timestampMs),
    [INBOX_HEADER_SIGNATURE]: sig,
  };
}

async function readErrorBody(
  response: Response,
  prefix: string,
): Promise<{ ok: false; status: number; error: string }> {
  let serverError = "";
  try {
    const text = await response.text();
    serverError = text.length > 0 ? text : response.statusText;
  } catch {
    serverError = response.statusText;
  }
  return { ok: false, status: response.status, error: `${prefix}: ${serverError}` };
}

/**
 * Canonical fetch-auth payload, mirrors
 * `packages/relay/src/inbox-types.ts::inboxFetchAuthPayload`. Pinned —
 * any change here MUST land alongside the relay-side change.
 */
export function inboxFetchAuthPayload(args: {
  recipientRootPubKeyB64Url: string;
  timestampMs: number;
}): string {
  return ["ottie-inbox-fetch-v1", args.recipientRootPubKeyB64Url, String(args.timestampMs)].join(
    "\n",
  );
}

/** Mirror of `inboxDeleteAuthPayload` on the relay side. */
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

// ----- internal -----------------------------------------------------------

function buildInboxUrl(relayEndpoint: string, recipient: string): string {
  // relayEndpoint is `host:port` per existing convention (see
  // friend-pair-sender.buildRelayWebSocketUrl). Always TLS — the relay
  // serves only over wss/https in production.
  return `https://${relayEndpoint}/inbox/${encodeURIComponent(recipient)}`;
}

// Unused header-name re-exports to make linking obvious if 3.b/2d wires
// these into a fetch / delete request.
export { INBOX_HEADER_RECIPIENT, INBOX_HEADER_SIGNATURE, INBOX_HEADER_TIMESTAMP };
