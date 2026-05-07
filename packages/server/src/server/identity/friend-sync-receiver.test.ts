import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, test } from "vitest";

import type { RelayConnectionHandler, RelayCustomHandlerSocket } from "../relay-transport.js";

import { FriendSessionRegistry } from "./friend-session-registry.js";
import { buildFriendHello, encryptFriendSyncFrame } from "./friend-sync-handshake.js";
import { createFriendSyncConnectionHandler } from "./friend-sync-receiver.js";
import type { StoredPeer } from "./peer-types.js";

interface RootKeys {
  signPublicKeyB64: string;
  signPrivateKey: KeyObject;
}

function mintRootKeys(): RootKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  return { signPublicKeyB64: jwkPub.x, signPrivateKey: privateKey };
}

function makePeer(overrides: Partial<StoredPeer> = {}): StoredPeer {
  return {
    v: 1,
    peerRootSignPublicKeyB64: "x".repeat(43),
    peerDisplayName: "Bob",
    pairedAt: "2026-05-05T12:00:00.000Z",
    status: "active",
    pairingNonceB64: "n".repeat(43),
    authorizationSignatureB64: "sig_".padEnd(86, "z"),
    ...overrides,
  };
}

function makeFakeSocket() {
  const messageListeners: Array<(data: unknown, isBinary: boolean) => void> = [];
  const closeListeners: Array<(code: number, reason: Buffer) => void> = [];
  const errorListeners: Array<(err: Error) => void> = [];
  const sent: string[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  let readyState = 1;

  const socket: RelayCustomHandlerSocket = {
    get readyState() {
      return readyState;
    },
    send(data) {
      sent.push(
        typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf8"),
      );
    },
    close(code, reason) {
      closes.push({ code, reason });
      readyState = 3;
    },
    on(event: "message" | "close" | "error", listener: never) {
      if (event === "message") messageListeners.push(listener as never);
      if (event === "close") closeListeners.push(listener as never);
      if (event === "error") errorListeners.push(listener as never);
    },
  };

  return {
    socket,
    sent,
    closes,
    deliver(data: unknown, isBinary = false) {
      for (const l of messageListeners) l(data, isBinary);
    },
    deliverClose(code = 1000, reason = "") {
      for (const l of closeListeners) l(code, Buffer.from(reason));
    },
  };
}

const SILENT_LOGGER = (() => {
  const noop = () => {
    /* no-op */
  };
  const logger: Record<string, unknown> = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
  };
  logger.child = () => logger;
  return logger as never;
})();

async function runHandler(
  handler: RelayConnectionHandler,
  connectionId: string,
  fakeSocket: ReturnType<typeof makeFakeSocket>,
): Promise<void> {
  await handler.handle({
    socket: fakeSocket.socket,
    connectionId,
    logger: SILENT_LOGGER,
  });
}

describe("createFriendSyncConnectionHandler", () => {
  test("matches connectionIds with the friend-sync: prefix only", () => {
    const alice = mintRootKeys();
    const handler = createFriendSyncConnectionHandler({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
      getLocalPeerList: () => [],
      sessions: new FriendSessionRegistry(),
      applyInboundPayload: () => {},
    });
    expect(handler.matches("friend-sync:nonce")).toBe(true);
    expect(handler.matches("friend-pair:nonce")).toBe(false);
    expect(handler.matches("peer-sync:nonce")).toBe(false);
  });

  test("happy path: handshakes with a known peer, registers session, sends reply hello", async () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const sessions = new FriendSessionRegistry();
    const peer = makePeer({
      peerRootSignPublicKeyB64: bob.signPublicKeyB64,
      peerDisplayName: "Bob",
    });
    const handler = createFriendSyncConnectionHandler({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
      getLocalPeerList: () => [peer],
      sessions,
      applyInboundPayload: () => {},
    });

    const fake = makeFakeSocket();
    await runHandler(handler, "friend-sync:nnnn", fake);

    const bobHello = buildFriendHello({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_bob",
      selfRootSignPrivateKey: bob.signPrivateKey,
    });
    fake.deliver(JSON.stringify(bobHello.hello));

    expect(sessions.list()).toHaveLength(1);
    const session = sessions.get(bob.signPublicKeyB64);
    expect(session?.peerDeviceId).toBe("srv_bob");
    // Receiver replied with its own hello.
    expect(fake.sent.length).toBe(1);
    const reply = JSON.parse(fake.sent[0]!);
    expect(reply.kind).toBe("friend-hello");
    expect(reply.fromRootPubKey).toBe(alice.signPublicKeyB64);
  });

  test("rejects hello from an unknown peer (not in peers.json)", async () => {
    const alice = mintRootKeys();
    const stranger = mintRootKeys();
    const handler = createFriendSyncConnectionHandler({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
      getLocalPeerList: () => [],
      sessions: new FriendSessionRegistry(),
      applyInboundPayload: () => {},
    });

    const fake = makeFakeSocket();
    await runHandler(handler, "friend-sync:n", fake);
    const hello = buildFriendHello({
      selfRootPubKey: stranger.signPublicKeyB64,
      selfDeviceId: "srv_stranger",
      selfRootSignPrivateKey: stranger.signPrivateKey,
    }).hello;
    fake.deliver(JSON.stringify(hello));

    expect(fake.closes[0]?.code).toBe(1008);
    expect(fake.closes[0]?.reason).toBe("unknown_peer");
  });

  test("rejects hello with a forged signature", async () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const eve = mintRootKeys();
    const sessions = new FriendSessionRegistry();
    const peer = makePeer({ peerRootSignPublicKeyB64: bob.signPublicKeyB64 });
    const handler = createFriendSyncConnectionHandler({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
      getLocalPeerList: () => [peer],
      sessions,
      applyInboundPayload: () => {},
    });

    // Eve signs but claims Bob's pubkey — verify fails.
    const forged = buildFriendHello({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_eve",
      selfRootSignPrivateKey: eve.signPrivateKey,
    }).hello;

    const fake = makeFakeSocket();
    await runHandler(handler, "friend-sync:n", fake);
    fake.deliver(JSON.stringify(forged));

    expect(fake.closes[0]?.code).toBe(1008);
    expect(fake.closes[0]?.reason).toBe("hello_verify_failed");
    expect(sessions.list()).toHaveLength(0);
  });

  test("rejects malformed JSON before parsing schema", async () => {
    const alice = mintRootKeys();
    const handler = createFriendSyncConnectionHandler({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
      getLocalPeerList: () => [],
      sessions: new FriendSessionRegistry(),
      applyInboundPayload: () => {},
    });
    const fake = makeFakeSocket();
    await runHandler(handler, "friend-sync:n", fake);
    fake.deliver("not json {{{");
    expect(fake.closes[0]?.code).toBe(1003);
  });

  test("rejects oversized hello frames", async () => {
    const alice = mintRootKeys();
    const handler = createFriendSyncConnectionHandler({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
      getLocalPeerList: () => [],
      sessions: new FriendSessionRegistry(),
      applyInboundPayload: () => {},
    });
    const fake = makeFakeSocket();
    await runHandler(handler, "friend-sync:n", fake);
    fake.deliver("x".repeat(256 * 1024 + 1));
    expect(fake.closes[0]?.code).toBe(1009);
  });

  test("post-handshake: decrypts inbound frames + dispatches to applyInboundPayload", async () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const sessions = new FriendSessionRegistry();
    const peer = makePeer({ peerRootSignPublicKeyB64: bob.signPublicKeyB64 });
    const received: Array<{ peerRootPubKey: string; payload: unknown }> = [];
    const handler = createFriendSyncConnectionHandler({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
      getLocalPeerList: () => [peer],
      sessions,
      applyInboundPayload: (input) => received.push(input),
    });

    const fake = makeFakeSocket();
    await runHandler(handler, "friend-sync:n", fake);
    const bobHello = buildFriendHello({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_bob",
      selfRootSignPrivateKey: bob.signPrivateKey,
    });
    fake.deliver(JSON.stringify(bobHello.hello));

    const session = sessions.get(bob.signPublicKeyB64);
    expect(session).not.toBeNull();
    if (!session) return;

    // Bob's daemon would derive the same key from its side and encrypt
    // a chat-message-like JSON payload. We use the receiver's session
    // sharedKey directly here since both sides match.
    const frame = encryptFriendSyncFrame({
      sharedKey: session.sharedKey,
      plaintext: JSON.stringify({ kind: "chat-message", body: "hello" }),
    });
    fake.deliver(JSON.stringify(frame));

    expect(received).toHaveLength(1);
    expect(received[0]?.peerRootPubKey).toBe(bob.signPublicKeyB64);
    expect(received[0]?.payload).toEqual({ kind: "chat-message", body: "hello" });
  });

  test("session is removed when socket closes", async () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const sessions = new FriendSessionRegistry();
    const peer = makePeer({ peerRootSignPublicKeyB64: bob.signPublicKeyB64 });
    const handler = createFriendSyncConnectionHandler({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
      getLocalPeerList: () => [peer],
      sessions,
      applyInboundPayload: () => {},
    });

    const fake = makeFakeSocket();
    await runHandler(handler, "friend-sync:n", fake);
    const bobHello = buildFriendHello({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_bob",
      selfRootSignPrivateKey: bob.signPrivateKey,
    });
    fake.deliver(JSON.stringify(bobHello.hello));

    expect(sessions.list()).toHaveLength(1);
    fake.deliverClose(1006, "peer_gone");
    expect(sessions.list()).toHaveLength(0);
  });

  test("calls onSessionEstablished after handshake (3.b/2 inbox-drain hook)", async () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const peer = makePeer({ peerRootSignPublicKeyB64: bob.signPublicKeyB64 });
    const onEstablishedCalls: string[] = [];
    const handler = createFriendSyncConnectionHandler({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
      getLocalPeerList: () => [peer],
      sessions: new FriendSessionRegistry(),
      applyInboundPayload: () => {},
      onSessionEstablished: (rootPubKey) => onEstablishedCalls.push(rootPubKey),
    });

    const fake = makeFakeSocket();
    await runHandler(handler, "friend-sync:n", fake);
    const bobHello = buildFriendHello({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_bob",
      selfRootSignPrivateKey: bob.signPrivateKey,
    });
    fake.deliver(JSON.stringify(bobHello.hello));

    expect(onEstablishedCalls).toEqual([bob.signPublicKeyB64]);
  });
});
