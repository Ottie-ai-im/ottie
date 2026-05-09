import { generateKeyPairSync, type KeyObject } from "node:crypto";
import pino from "pino";
import { describe, expect, test } from "vitest";

import type { RelayConnectionHandler, RelayCustomHandlerSocket } from "../relay-transport.js";

import { FriendSessionRegistry } from "./friend-session-registry.js";
import { encryptFriendSyncFrame } from "./friend-sync-handshake.js";
import { FriendSyncDialer, type FriendDialerSocket } from "./friend-sync-dialer.js";
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

/**
 * Mint a pair of root keypairs `(smaller, larger)` ordered by their
 * pubkey strings. The dialer's tie-break for simultaneous-connect
 * prevents the side with the *larger* pubkey from dialing, so tests
 * that exercise the dialer end-to-end need the dialer to be on the
 * smaller side.
 */
function mintOrderedRootKeyPair(): { dialer: RootKeys; receiver: RootKeys } {
  while (true) {
    const a = mintRootKeys();
    const b = mintRootKeys();
    if (a.signPublicKeyB64 === b.signPublicKeyB64) continue;
    return a.signPublicKeyB64 < b.signPublicKeyB64
      ? { dialer: a, receiver: b }
      : { dialer: b, receiver: a };
  }
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
    peerServerId: "srv_bob",
    peerRelayEndpoint: "relay.claws.company:443",
    ...overrides,
  };
}

const SILENT_LOGGER = pino({ level: process.env.E2E_DEBUG === "1" ? "debug" : "silent" });

/**
 * Pair an outbound `FriendDialerSocket` with an inbound
 * `RelayCustomHandlerSocket`. Frames sent on one show up on the other.
 */
function pairFakeSockets() {
  type Listener<T extends unknown[]> = (...args: T) => void;
  const dialerOpen: Array<Listener<[]>> = [];
  const dialerMessage: Array<Listener<[unknown, boolean]>> = [];
  const dialerClose: Array<Listener<[number, Buffer]>> = [];
  const dialerError: Array<Listener<[Error]>> = [];

  const receiverMessage: Array<Listener<[unknown, boolean]>> = [];
  const receiverClose: Array<Listener<[number, Buffer]>> = [];
  const receiverError: Array<Listener<[Error]>> = [];

  let dialerReady = 1;
  let receiverReady = 1;

  const dialerSocket: FriendDialerSocket = {
    send: (data) => {
      for (const l of receiverMessage) l(data, false);
    },
    close: (code = 1000, reason = "") => {
      if (dialerReady === 3) return;
      dialerReady = 3;
      const reasonBuf = Buffer.from(reason);
      for (const l of dialerClose) l(code, reasonBuf);
      // Mirror to receiver side so it sees the close.
      if (receiverReady !== 3) {
        receiverReady = 3;
        for (const l of receiverClose) l(code, reasonBuf);
      }
    },
    on: (event, listener) => {
      if (event === "open") dialerOpen.push(listener as Listener<[]>);
      if (event === "message") dialerMessage.push(listener as Listener<[unknown, boolean]>);
      if (event === "close") dialerClose.push(listener as Listener<[number, Buffer]>);
      if (event === "error") dialerError.push(listener as Listener<[Error]>);
    },
  };

  const receiverSocket: RelayCustomHandlerSocket = {
    get readyState() {
      return receiverReady;
    },
    send: (data) => {
      const text =
        typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf8");
      for (const l of dialerMessage) l(text, false);
    },
    close: (code = 1000, reason = "") => {
      if (receiverReady === 3) return;
      receiverReady = 3;
      const reasonBuf = Buffer.from(reason);
      for (const l of receiverClose) l(code, reasonBuf);
      if (dialerReady !== 3) {
        dialerReady = 3;
        for (const l of dialerClose) l(code, reasonBuf);
      }
    },
    on: (event: "message" | "close" | "error", listener: never) => {
      if (event === "message") receiverMessage.push(listener as Listener<[unknown, boolean]>);
      if (event === "close") receiverClose.push(listener as Listener<[number, Buffer]>);
      if (event === "error") receiverError.push(listener as Listener<[Error]>);
    },
  };

  return {
    dialerSocket,
    receiverSocket,
    fireDialerOpen: () => {
      for (const l of dialerOpen) l();
    },
  };
}

async function runReceiver(
  handler: RelayConnectionHandler,
  connectionId: string,
  socket: RelayCustomHandlerSocket,
): Promise<void> {
  await handler.handle({ socket, connectionId, logger: SILENT_LOGGER });
}

describe("FriendSyncDialer end-to-end against createFriendSyncConnectionHandler", () => {
  test("happy path: handshake completes both sides + frames flow both directions", async () => {
    // Bob is the dialer, so he needs the smaller pubkey to satisfy
    // the simultaneous-connect tie-break.
    const ordered = mintOrderedRootKeyPair();
    const bob = ordered.dialer;
    const alice = ordered.receiver;
    const aliceSessions = new FriendSessionRegistry();
    const bobSessions = new FriendSessionRegistry();
    const aliceReceived: Array<{ peerRootPubKey: string; payload: unknown }> = [];
    const bobReceived: Array<{ peerRootPubKey: string; payload: unknown }> = [];

    // Alice's daemon (responder).
    const aliceHandler = createFriendSyncConnectionHandler({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
      getLocalPeerList: () => [
        makePeer({ peerRootSignPublicKeyB64: bob.signPublicKeyB64, peerDisplayName: "Bob" }),
      ],
      sessions: aliceSessions,
      applyInboundPayload: (input) => aliceReceived.push(input),
    });

    // Bob's daemon (initiator) — only the dialer side. We stub the
    // socket factory to plug into Alice's receiver directly.
    const bobDialer = new FriendSyncDialer({
      selfRootPubKey: bob.signPublicKeyB64,
      selfDeviceId: "srv_bob",
      selfRootSignPrivateKey: bob.signPrivateKey,
      getLocalPeerList: () => [
        makePeer({
          peerRootSignPublicKeyB64: alice.signPublicKeyB64,
          peerDisplayName: "Alice",
          peerServerId: "srv_alice",
          peerRelayEndpoint: "relay.claws.company:443",
        }),
      ],
      sessions: bobSessions,
      applyInboundPayload: (input) => bobReceived.push(input),
      logger: SILENT_LOGGER,
      createSocket: () => {
        const { dialerSocket, receiverSocket, fireDialerOpen } = pairFakeSockets();
        // Hand Alice's receiver the inbound socket. We schedule the
        // dialer 'open' event on the next tick so the dialer can attach
        // its listeners first.
        void runReceiver(aliceHandler, "friend-sync:test-nonce", receiverSocket).then(() => {
          fireDialerOpen();
          return undefined;
        });
        return dialerSocket;
      },
    });

    bobDialer.start();

    // Wait a few ticks for the SIGMA-I handshake to settle.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setImmediate(r));
    }

    expect(aliceSessions.list()).toHaveLength(1);
    expect(bobSessions.list()).toHaveLength(1);
    const aliceSide = aliceSessions.get(bob.signPublicKeyB64);
    const bobSide = bobSessions.get(alice.signPublicKeyB64);
    expect(aliceSide?.peerDeviceId).toBe("srv_bob");
    expect(bobSide?.peerDeviceId).toBe("srv_alice");

    // Bob → Alice: encrypt with Bob's view of the shared key, deliver
    // through the dialer socket. The receiver decrypts via Alice's view
    // (same key, both sides ECDH'd to it).
    if (!bobSide || !aliceSide) throw new Error("expected both sides registered");
    bobSide.socket.send(
      JSON.stringify(
        encryptFriendSyncFrame({
          sharedKey: bobSide.sharedKey,
          plaintext: JSON.stringify({ kind: "ping", body: "hello alice" }),
        }),
      ),
    );

    await new Promise((r) => setImmediate(r));
    expect(aliceReceived).toHaveLength(1);
    expect(aliceReceived[0]?.payload).toEqual({ kind: "ping", body: "hello alice" });

    // Alice → Bob too.
    aliceSide.socket.send(
      JSON.stringify(
        encryptFriendSyncFrame({
          sharedKey: aliceSide.sharedKey,
          plaintext: JSON.stringify({ kind: "pong", body: "hi bob" }),
        }),
      ),
    );
    await new Promise((r) => setImmediate(r));
    expect(bobReceived).toHaveLength(1);
    expect(bobReceived[0]?.payload).toEqual({ kind: "pong", body: "hi bob" });

    await bobDialer.stop();
  });

  test("dialer skips peers without peerServerId / peerRelayEndpoint", async () => {
    const alice = mintRootKeys();
    const stranger = mintRootKeys();
    let factoryCalls = 0;
    const dialer = new FriendSyncDialer({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
      getLocalPeerList: () => [
        // Pre-3.b/1a peer — no peerServerId.
        makePeer({
          peerRootSignPublicKeyB64: stranger.signPublicKeyB64,
          peerServerId: undefined,
          peerRelayEndpoint: undefined,
        }),
      ],
      sessions: new FriendSessionRegistry(),
      applyInboundPayload: () => {},
      logger: SILENT_LOGGER,
      createSocket: () => {
        factoryCalls += 1;
        // Should not be called — dialer must skip the peer.
        throw new Error("createSocket must not be called for peers without routing info");
      },
    });
    dialer.start();
    await new Promise((r) => setImmediate(r));
    expect(factoryCalls).toBe(0);
    await dialer.stop();
  });

  test("dialer skips peers in status=blocked or removed", async () => {
    const alice = mintRootKeys();
    const stranger = mintRootKeys();
    let factoryCalls = 0;
    const dialer = new FriendSyncDialer({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
      getLocalPeerList: () => [
        makePeer({
          peerRootSignPublicKeyB64: stranger.signPublicKeyB64,
          status: "blocked",
        }),
      ],
      sessions: new FriendSessionRegistry(),
      applyInboundPayload: () => {},
      logger: SILENT_LOGGER,
      createSocket: () => {
        factoryCalls += 1;
        throw new Error("must not dial blocked peer");
      },
    });
    dialer.start();
    await new Promise((r) => setImmediate(r));
    expect(factoryCalls).toBe(0);
    await dialer.stop();
  });

  test("refreshTargets picks up newly-paired peers without restart", async () => {
    const ordered = mintOrderedRootKeyPair();
    const alice = ordered.dialer;
    const bob = ordered.receiver;
    const peers: StoredPeer[] = [];
    let factoryCalls = 0;
    const dialer = new FriendSyncDialer({
      selfRootPubKey: alice.signPublicKeyB64,
      selfDeviceId: "srv_alice",
      selfRootSignPrivateKey: alice.signPrivateKey,
      getLocalPeerList: () => peers,
      sessions: new FriendSessionRegistry(),
      applyInboundPayload: () => {},
      logger: SILENT_LOGGER,
      createSocket: () => {
        factoryCalls += 1;
        // Return a stub socket that does nothing — we're only checking
        // the dialer attempts a connection at all.
        return {
          send: () => {},
          close: () => {},
          on: () => {},
        } as unknown as FriendDialerSocket;
      },
    });
    dialer.start();
    await new Promise((r) => setImmediate(r));
    expect(factoryCalls).toBe(0);

    // A fresh pair lands → IdentityService calls refreshFriendDialerTargets.
    peers.push(
      makePeer({
        peerRootSignPublicKeyB64: bob.signPublicKeyB64,
        peerServerId: "srv_bob",
        peerRelayEndpoint: "relay.claws.company:443",
      }),
    );
    dialer.refreshTargets();
    await new Promise((r) => setImmediate(r));
    expect(factoryCalls).toBe(1);

    await dialer.stop();
  });
});
