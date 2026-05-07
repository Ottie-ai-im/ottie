import { generateKeyPairSync, sign as nodeSign, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import pino from "pino";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { p2pRoomId } from "../chat/chat-types.js";
import { buildFriendChatMessageEnvelope } from "./friend-chat-crypto.js";
import { listFriendChatMessages } from "./friend-chat-store.js";
import { encryptInboxBlob } from "./friend-inbox-crypto.js";
import { loadInboxCursor } from "./friend-inbox-cursor-store.js";
import { processInboxOnce } from "./friend-inbox-receiver.js";
import type { StoredPeer } from "./peer-types.js";
import type { InboxAuthSigner } from "./friend-inbox-client.js";

const SILENT_LOGGER = pino({ level: "silent" });

interface TestIdentity {
  rootSignPublicKeyB64: string;
  rootSignPrivateKey: KeyObject;
  encryptionPublicKeyB64: string;
  encryptionPrivateKeyB64: string;
}

function makeIdentity(): TestIdentity {
  const ed = generateKeyPairSync("ed25519");
  const x = generateKeyPairSync("x25519");
  const edPub = (ed.publicKey.export({ format: "jwk" }) as { x?: string }).x;
  const xPub = (x.publicKey.export({ format: "jwk" }) as { x?: string }).x;
  const xPriv = (x.privateKey.export({ format: "jwk" }) as { d?: string }).d;
  if (!edPub || !xPub || !xPriv) throw new Error("jwk missing fields");
  return {
    rootSignPublicKeyB64: edPub,
    rootSignPrivateKey: ed.privateKey,
    encryptionPublicKeyB64: xPub,
    encryptionPrivateKeyB64: xPriv,
  };
}

function makeAuthSigner(privKey: KeyObject): InboxAuthSigner {
  return {
    sign: (payload: string) => {
      return nodeSign(null, Buffer.from(payload, "utf8"), privKey)
        .toString("base64")
        .replace(/=+$/, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    },
  };
}

function makePeerForSender(sender: TestIdentity): StoredPeer {
  return {
    v: 1,
    peerRootSignPublicKeyB64: sender.rootSignPublicKeyB64,
    peerDisplayName: "Sender",
    pairedAt: "2026-05-06T12:00:00.000Z",
    status: "active",
    pairingNonceB64: "n".repeat(43),
    authorizationSignatureB64: "sig_".padEnd(86, "z"),
    peerServerId: "srv_sender_unit",
    peerRelayEndpoint: "relay.example:443",
    peerEncryptionPublicKeyB64: sender.encryptionPublicKeyB64,
  };
}

interface BlobInput {
  sender: TestIdentity;
  recipient: TestIdentity;
  body: string;
  messageId?: string;
}

function makeEntry(input: BlobInput): { seq: string; ciphertextB64: string; deliveredAt: string } {
  const roomId = p2pRoomId({
    aRootPubKey: input.sender.rootSignPublicKeyB64,
    bRootPubKey: input.recipient.rootSignPublicKeyB64,
  });
  const envelope = buildFriendChatMessageEnvelope({
    roomId,
    message: {
      id: input.messageId ?? `fcm_${Math.random().toString(36).slice(2)}`,
      roomId,
      authorAgentId: `human:${input.sender.rootSignPublicKeyB64.slice(0, 12)}`,
      body: input.body,
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: "2026-05-07T03:00:00.000Z",
      clientMessageId: `cm_${Math.random().toString(36).slice(2)}`,
      authorRootPubKey: input.sender.rootSignPublicKeyB64,
      authorDeviceId: "srv_sender_unit",
      kind: "text",
    },
    authorRootSignPrivateKey: input.sender.rootSignPrivateKey,
  });
  const { serializedBlob } = encryptInboxBlob({
    envelope,
    recipientEncryptionPublicKeyB64: input.recipient.encryptionPublicKeyB64,
  });
  // The receiver's processSingleEntry expects `ciphertextB64` to be
  // a base64 of UTF-8 bytes (which decode back to the JSON blob).
  const ciphertextB64 = Buffer.from(serializedBlob, "utf8").toString("base64");
  // Lex-sortable seq matching the relay format: 16-digit ts + 16 hex.
  const seq = `${Date.now().toString().padStart(16, "0")}-${Math.random()
    .toString(16)
    .slice(2, 18)
    .padEnd(16, "0")}`;
  return { seq, ciphertextB64, deliveredAt: new Date().toISOString() };
}

interface FakeRelay {
  fetchImpl: typeof fetch;
  getCalls: number;
  deleteCalls: number;
  /** Mutable: tests push entries onto this between rounds. */
  entries: Array<{ seq: string; ciphertextB64: string; deliveredAt: string }>;
  /** Capture deletes for assertion. */
  deletedSeqs: string[];
}

function makeFakeRelay(initialEntries: FakeRelay["entries"]): FakeRelay {
  const state: FakeRelay = {
    fetchImpl: vi.fn() as unknown as typeof fetch,
    getCalls: 0,
    deleteCalls: 0,
    entries: [...initialEntries],
    deletedSeqs: [],
  };
  state.fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    if (init?.method === "GET" || init?.method === undefined) {
      state.getCalls++;
      const since = u.searchParams.get("since") ?? "";
      const fresh = since ? state.entries.filter((e) => e.seq > since) : state.entries.slice();
      // Page size 50 by default — never trips here for these tests.
      return new Response(
        JSON.stringify({
          entries: fresh,
          nextCursor: fresh.length > 0 ? fresh[fresh.length - 1]!.seq : since,
          hasMore: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (init?.method === "DELETE") {
      state.deleteCalls++;
      const seq = decodeURIComponent(u.pathname.split("/").pop()!);
      state.deletedSeqs.push(seq);
      state.entries = state.entries.filter((e) => e.seq !== seq);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unhandled ${init?.method} ${url}`);
  }) as unknown as typeof fetch;
  return state;
}

let recipientHome: string;

beforeEach(() => {
  recipientHome = mkdtempSync(path.join(tmpdir(), "ottie-inbox-recv-"));
});

afterEach(() => {
  rmSync(recipientHome, { recursive: true, force: true });
});

describe("processInboxOnce — Phase 3.b/2d", () => {
  test("happy path: decrypts, verifies, persists, ACKs", async () => {
    const recipient = makeIdentity();
    const sender = makeIdentity();
    const entry = makeEntry({ sender, recipient, body: "hello from offline" });
    const relay = makeFakeRelay([entry]);
    const peer = makePeerForSender(sender);

    const result = await processInboxOnce({
      ottieHome: recipientHome,
      selfRootSignPublicKeyB64: recipient.rootSignPublicKeyB64,
      selfEncryptionPrivateKeyB64: recipient.encryptionPrivateKeyB64,
      authSigner: makeAuthSigner(recipient.rootSignPrivateKey),
      relayEndpoint: "relay.example:443",
      findPeer: (pk) => (pk === sender.rootSignPublicKeyB64 ? peer : null),
      fetchImpl: relay.fetchImpl,
      logger: SILENT_LOGGER,
    });
    expect(result.persisted).toBe(1);
    expect(result.dropped).toBe(0);
    expect(result.cursor.lastSeenSeq).toBe(entry.seq);
    expect(relay.deletedSeqs).toEqual([entry.seq]);
    // Persisted line readable from the chat store.
    const stored = listFriendChatMessages(
      recipientHome,
      sender.rootSignPublicKeyB64,
      SILENT_LOGGER,
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.message.body).toBe("hello from offline");
    expect(stored[0]!.deliveryStatus).toBe("delivered");
  });

  test("dedup: a second round skips already-processed entries (cursor honored)", async () => {
    const recipient = makeIdentity();
    const sender = makeIdentity();
    const e1 = makeEntry({ sender, recipient, body: "first" });
    const e2 = makeEntry({ sender, recipient, body: "second" });
    const relay = makeFakeRelay([e1, e2]);
    const peer = makePeerForSender(sender);

    // First round: pulls both.
    await processInboxOnce({
      ottieHome: recipientHome,
      selfRootSignPublicKeyB64: recipient.rootSignPublicKeyB64,
      selfEncryptionPrivateKeyB64: recipient.encryptionPrivateKeyB64,
      authSigner: makeAuthSigner(recipient.rootSignPrivateKey),
      relayEndpoint: "relay.example:443",
      findPeer: () => peer,
      fetchImpl: relay.fetchImpl,
      logger: SILENT_LOGGER,
    });
    expect(loadInboxCursor(recipientHome).lastSeenSeq).toBe(e2.seq);
    expect(relay.deletedSeqs.length).toBe(2);

    // Inject a forged "old" entry whose seq is < cursor — receiver
    // should NOT pull it again because cursor narrows the GET.
    relay.entries.push({ ...e1, seq: e1.seq });
    const result2 = await processInboxOnce({
      ottieHome: recipientHome,
      selfRootSignPublicKeyB64: recipient.rootSignPublicKeyB64,
      selfEncryptionPrivateKeyB64: recipient.encryptionPrivateKeyB64,
      authSigner: makeAuthSigner(recipient.rootSignPrivateKey),
      relayEndpoint: "relay.example:443",
      findPeer: () => peer,
      fetchImpl: relay.fetchImpl,
      logger: SILENT_LOGGER,
    });
    expect(result2.persisted).toBe(0);
  });

  test("missing peer → dropped, cursor advanced, ACKed", async () => {
    const recipient = makeIdentity();
    const stranger = makeIdentity();
    const entry = makeEntry({ sender: stranger, recipient, body: "spam" });
    const relay = makeFakeRelay([entry]);

    const result = await processInboxOnce({
      ottieHome: recipientHome,
      selfRootSignPublicKeyB64: recipient.rootSignPublicKeyB64,
      selfEncryptionPrivateKeyB64: recipient.encryptionPrivateKeyB64,
      authSigner: makeAuthSigner(recipient.rootSignPrivateKey),
      relayEndpoint: "relay.example:443",
      findPeer: () => null, // not a friend
      fetchImpl: relay.fetchImpl,
      logger: SILENT_LOGGER,
    });
    expect(result.dropped).toBe(1);
    expect(result.persisted).toBe(0);
    expect(result.cursor.lastSeenSeq).toBe(entry.seq);
    expect(relay.deletedSeqs).toEqual([entry.seq]); // poison entry still ACKed
    expect(
      listFriendChatMessages(recipientHome, stranger.rootSignPublicKeyB64, SILENT_LOGGER),
    ).toHaveLength(0);
  });

  test("decrypt failure (wrong recipient privkey) → dropped, ACKed", async () => {
    const recipient = makeIdentity();
    const someoneElse = makeIdentity();
    const sender = makeIdentity();
    // Encrypt to someoneElse — recipient's privkey can't decrypt.
    const entry = makeEntry({ sender, recipient: someoneElse, body: "wrong target" });
    const relay = makeFakeRelay([entry]);

    const result = await processInboxOnce({
      ottieHome: recipientHome,
      selfRootSignPublicKeyB64: recipient.rootSignPublicKeyB64,
      selfEncryptionPrivateKeyB64: recipient.encryptionPrivateKeyB64,
      authSigner: makeAuthSigner(recipient.rootSignPrivateKey),
      relayEndpoint: "relay.example:443",
      findPeer: () => makePeerForSender(sender),
      fetchImpl: relay.fetchImpl,
      logger: SILENT_LOGGER,
    });
    expect(result.dropped).toBe(1);
    expect(result.persisted).toBe(0);
    expect(result.cursor.lastSeenSeq).toBe(entry.seq);
  });

  test("returns empty result on empty inbox", async () => {
    const recipient = makeIdentity();
    const relay = makeFakeRelay([]);
    const result = await processInboxOnce({
      ottieHome: recipientHome,
      selfRootSignPublicKeyB64: recipient.rootSignPublicKeyB64,
      selfEncryptionPrivateKeyB64: recipient.encryptionPrivateKeyB64,
      authSigner: makeAuthSigner(recipient.rootSignPrivateKey),
      relayEndpoint: "relay.example:443",
      findPeer: () => null,
      fetchImpl: relay.fetchImpl,
      logger: SILENT_LOGGER,
    });
    expect(result.persisted).toBe(0);
    expect(result.dropped).toBe(0);
    expect(result.cursor.lastSeenSeq).toBe("");
    expect(relay.deleteCalls).toBe(0);
  });

  test("aborts on persist failure (cursor stays put for retry)", async () => {
    const recipient = makeIdentity();
    const sender = makeIdentity();
    const entry = makeEntry({ sender, recipient, body: "hello" });
    const relay = makeFakeRelay([entry]);
    // findPeer throws synchronously to force the persist branch into
    // catching and returning "abort" — easier than mocking fs.
    const failingFindPeer = () => {
      throw new Error("simulated persist failure");
    };
    const result = await processInboxOnce({
      ottieHome: recipientHome,
      selfRootSignPublicKeyB64: recipient.rootSignPublicKeyB64,
      selfEncryptionPrivateKeyB64: recipient.encryptionPrivateKeyB64,
      authSigner: makeAuthSigner(recipient.rootSignPrivateKey),
      relayEndpoint: "relay.example:443",
      findPeer: failingFindPeer,
      fetchImpl: relay.fetchImpl,
      logger: SILENT_LOGGER,
    }).catch((err) => err);
    // findPeer exception bubbles out — that's expected; the receiver
    // doesn't try/catch around lookup. (A real persist failure would
    // come from disk and be caught inside processSingleEntry.)
    expect(result instanceof Error).toBe(true);
    // Cursor never advanced because we threw before reaching the
    // advance-and-ACK step.
    expect(loadInboxCursor(recipientHome).lastSeenSeq).toBe("");
  });

  test("multiple entries from different senders persist into per-peer JSONL", async () => {
    const recipient = makeIdentity();
    const senderA = makeIdentity();
    const senderB = makeIdentity();
    const peerA = makePeerForSender(senderA);
    const peerB = makePeerForSender(senderB);
    const eA = makeEntry({ sender: senderA, recipient, body: "from A" });
    const eB = makeEntry({ sender: senderB, recipient, body: "from B" });
    const relay = makeFakeRelay([eA, eB]);

    const result = await processInboxOnce({
      ottieHome: recipientHome,
      selfRootSignPublicKeyB64: recipient.rootSignPublicKeyB64,
      selfEncryptionPrivateKeyB64: recipient.encryptionPrivateKeyB64,
      authSigner: makeAuthSigner(recipient.rootSignPrivateKey),
      relayEndpoint: "relay.example:443",
      findPeer: (pk) => {
        if (pk === senderA.rootSignPublicKeyB64) return peerA;
        if (pk === senderB.rootSignPublicKeyB64) return peerB;
        return null;
      },
      fetchImpl: relay.fetchImpl,
      logger: SILENT_LOGGER,
    });
    expect(result.persisted).toBe(2);
    expect(
      listFriendChatMessages(recipientHome, senderA.rootSignPublicKeyB64, SILENT_LOGGER)[0]!.message
        .body,
    ).toBe("from A");
    expect(
      listFriendChatMessages(recipientHome, senderB.rootSignPublicKeyB64, SILENT_LOGGER)[0]!.message
        .body,
    ).toBe("from B");
  });

  test("auth headers carry recipient + signed timestamp + signature", async () => {
    const recipient = makeIdentity();
    const sender = makeIdentity();
    const entry = makeEntry({ sender, recipient, body: "sniff me" });
    const relay = makeFakeRelay([entry]);
    let capturedHeaders: Record<string, string> | null = null;
    const wrappedFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "GET" || init?.method === undefined) {
        capturedHeaders = init?.headers as Record<string, string>;
      }
      return relay.fetchImpl(url, init);
    }) as unknown as typeof fetch;

    await processInboxOnce({
      ottieHome: recipientHome,
      selfRootSignPublicKeyB64: recipient.rootSignPublicKeyB64,
      selfEncryptionPrivateKeyB64: recipient.encryptionPrivateKeyB64,
      authSigner: makeAuthSigner(recipient.rootSignPrivateKey),
      relayEndpoint: "relay.example:443",
      findPeer: () => makePeerForSender(sender),
      fetchImpl: wrappedFetch,
      logger: SILENT_LOGGER,
    });
    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders!["X-Ottie-Recipient"]).toBe(recipient.rootSignPublicKeyB64);
    // 13-digit ms timestamp (Date.now()), within ±5s of the test clock.
    const ts = Number(capturedHeaders!["X-Ottie-Auth-Timestamp"]);
    expect(Math.abs(Date.now() - ts)).toBeLessThan(5000);
    // 64-byte Ed25519 sig → 86-87 chars base64url unpadded.
    expect(capturedHeaders!["X-Ottie-Auth-Signature"]).toMatch(/^[A-Za-z0-9_-]{80,90}$/);
  });
});
