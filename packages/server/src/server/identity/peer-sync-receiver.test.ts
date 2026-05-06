import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "vitest";

import type { RelayConnectionHandler, RelayCustomHandlerSocket } from "../relay-transport.js";

import { buildAuthorizedDevice } from "./device-list-store.js";
import { signDeviceAddedEvent } from "./device-list-event.js";
import type { DeviceListEvent } from "./device-list-event-types.js";
import type { StoredDevice } from "./device-types.js";
import { PeerSessionRegistry } from "./peer-session-registry.js";
import {
  buildPeerHello,
  decryptPeerSyncFrame,
  deriveSessionSharedKey,
  encryptPeerSyncFrame,
  PeerHelloSchema,
} from "./peer-sync-handshake.js";
import { createPeerSyncConnectionHandler } from "./peer-sync-receiver.js";
import type { RootIdentityBundle } from "./root-identity-store.js";

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

function makeRootIdentity(displayName: string): RootIdentityBundle {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  const jwkPriv = privateKey.export({ format: "jwk" }) as { d: string };
  return {
    stored: {
      v: 1,
      signPublicKeyB64: jwkPub.x,
      signPrivateKeyB64: jwkPriv.d,
      displayName,
      createdAt: new Date(1_700_000_000_000).toISOString(),
    },
    signPublicKey: publicKey,
    signPrivateKey: privateKey,
  };
}

function makeAuthorizedDaemonDevice(args: {
  rootIdentity: RootIdentityBundle;
  deviceId: string;
  deviceLabel: string;
}): { stored: StoredDevice; signPrivateKey: ReturnType<typeof generateKeyPairSync>["privateKey"] } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  const stored = buildAuthorizedDevice({
    deviceId: args.deviceId,
    deviceLabel: args.deviceLabel,
    role: "daemon",
    signPublicKeyB64: jwkPub.x,
    rootIdentity: args.rootIdentity,
  });
  return { stored, signPrivateKey: privateKey };
}

/**
 * Build a fake socket on which we can:
 *   - inspect what the handler `send`s back (the responder hello, etc.)
 *   - inject incoming messages as if from the peer
 */
function makeFakeSocket() {
  type Listener<T extends unknown[]> = (...args: T) => void;
  const messageListeners: Array<Listener<[unknown, boolean]>> = [];
  const closeListeners: Array<Listener<[number, Buffer]>> = [];
  const errorListeners: Array<Listener<[Error]>> = [];
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
    fireClose(code = 1000, reason = "") {
      readyState = 3;
      const reasonBuf = Buffer.from(reason);
      for (const l of closeListeners) l(code, reasonBuf);
    },
  };
}

async function runHandler(
  handler: RelayConnectionHandler,
  connectionId: string,
  fake: ReturnType<typeof makeFakeSocket>,
): Promise<void> {
  await handler.handle({
    socket: fake.socket,
    connectionId,
    logger: SILENT_LOGGER,
  });
}

describe("createPeerSyncConnectionHandler", () => {
  test("matches connectionIds with the peer-sync: prefix only", () => {
    const sessions = new PeerSessionRegistry();
    const localDevice = makeAuthorizedDaemonDevice({
      rootIdentity: makeRootIdentity("W"),
      deviceId: "self",
      deviceLabel: "Self",
    });
    const handler = createPeerSyncConnectionHandler({
      selfDeviceId: localDevice.stored.deviceId,
      selfSignPrivateKey: localDevice.signPrivateKey,
      getLocalDeviceList: () => [localDevice.stored],
      sessions,
      applyInboundEvent: () => undefined,
    });
    expect(handler.matches("peer-sync:abc")).toBe(true);
    expect(handler.matches("device-link:abc")).toBe(false);
    expect(handler.matches("peer-sync-but-not-prefix")).toBe(false);
  });

  test("happy path: incoming hello → responder hello sent → session registered", async () => {
    const root = makeRootIdentity("Wendell");
    const local = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_local",
      deviceLabel: "Local",
    });
    const peer = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_peer",
      deviceLabel: "Peer",
    });

    const sessions = new PeerSessionRegistry();
    const applied: DeviceListEvent[] = [];
    const handler = createPeerSyncConnectionHandler({
      selfDeviceId: local.stored.deviceId,
      selfSignPrivateKey: local.signPrivateKey,
      getLocalDeviceList: () => [local.stored, peer.stored],
      sessions,
      applyInboundEvent: (e) => applied.push(e),
    });

    const fake = makeFakeSocket();
    await runHandler(handler, "peer-sync:abc123", fake);

    // Peer sends its hello.
    const peerHello = buildPeerHello({
      selfDeviceId: peer.stored.deviceId,
      selfSignPrivateKey: peer.signPrivateKey,
    });
    fake.deliver(JSON.stringify(peerHello.hello));

    // Handler should have responded with our hello.
    expect(fake.sent).toHaveLength(1);
    const ourHello = PeerHelloSchema.parse(JSON.parse(fake.sent[0]!));
    expect(ourHello.fromDeviceId).toBe("dev_local");
    expect(fake.closes).toHaveLength(0);

    // Session registered, key derivable on both sides.
    expect(sessions.list()).toHaveLength(1);
    const session = sessions.get("dev_peer");
    expect(session).not.toBeNull();

    const peerKey = deriveSessionSharedKey({
      ourEphPrivKeyB64: peerHello.ephPrivateKeyB64,
      peerEphPubKeyB64: ourHello.ephPubKeyB64,
    });

    // Send an event-shaped frame from the peer; handler should decrypt
    // and call applyInboundEvent.
    const fakeEvent = signDeviceAddedEvent({
      device: peer.stored,
      sourceDeviceId: peer.stored.deviceId,
      signPrivateKey: peer.signPrivateKey,
      seq: 1,
    });
    const frame = encryptPeerSyncFrame({
      sharedKey: peerKey,
      plaintext: JSON.stringify(fakeEvent),
    });
    fake.deliver(JSON.stringify(frame));

    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual(fakeEvent);
  });

  test("rejects hello from a peer not in local device list", async () => {
    const root = makeRootIdentity("Wendell");
    const local = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_local",
      deviceLabel: "Local",
    });
    const ghost = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_ghost",
      deviceLabel: "Ghost",
    });

    const sessions = new PeerSessionRegistry();
    const handler = createPeerSyncConnectionHandler({
      selfDeviceId: local.stored.deviceId,
      selfSignPrivateKey: local.signPrivateKey,
      getLocalDeviceList: () => [local.stored], // no ghost!
      sessions,
      applyInboundEvent: () => undefined,
    });

    const fake = makeFakeSocket();
    await runHandler(handler, "peer-sync:abc", fake);

    const ghostHello = buildPeerHello({
      selfDeviceId: ghost.stored.deviceId,
      selfSignPrivateKey: ghost.signPrivateKey,
    });
    fake.deliver(JSON.stringify(ghostHello.hello));

    expect(sessions.list()).toHaveLength(0);
    expect(fake.closes[0]?.code).toBe(1008);
    expect(fake.closes[0]?.reason).toMatch(/unknown_peer/);
  });

  test("rejects hello with invalid signature", async () => {
    const root = makeRootIdentity("Wendell");
    const local = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_local",
      deviceLabel: "Local",
    });
    const peer = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_peer",
      deviceLabel: "Peer",
    });
    const attacker = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_peer", // claim peer's id
      deviceLabel: "Forged",
    });

    const sessions = new PeerSessionRegistry();
    const handler = createPeerSyncConnectionHandler({
      selfDeviceId: local.stored.deviceId,
      selfSignPrivateKey: local.signPrivateKey,
      getLocalDeviceList: () => [local.stored, peer.stored],
      sessions,
      applyInboundEvent: () => undefined,
    });

    const fake = makeFakeSocket();
    await runHandler(handler, "peer-sync:abc", fake);

    // Hello signed by attacker but claiming peer's id.
    const forgedHello = buildPeerHello({
      selfDeviceId: peer.stored.deviceId,
      selfSignPrivateKey: attacker.signPrivateKey,
    });
    fake.deliver(JSON.stringify(forgedHello.hello));

    expect(sessions.list()).toHaveLength(0);
    expect(fake.closes[0]?.code).toBe(1008);
    expect(fake.closes[0]?.reason).toMatch(/hello_verify_failed/);
  });

  test("rejects malformed hello (bad schema)", async () => {
    const root = makeRootIdentity("Wendell");
    const local = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_local",
      deviceLabel: "Local",
    });
    const sessions = new PeerSessionRegistry();
    const handler = createPeerSyncConnectionHandler({
      selfDeviceId: local.stored.deviceId,
      selfSignPrivateKey: local.signPrivateKey,
      getLocalDeviceList: () => [local.stored],
      sessions,
      applyInboundEvent: () => undefined,
    });
    const fake = makeFakeSocket();
    await runHandler(handler, "peer-sync:abc", fake);
    fake.deliver(JSON.stringify({ kind: "wrong", v: 99 }));
    expect(fake.closes[0]?.code).toBe(1008);
    expect(fake.closes[0]?.reason).toMatch(/bad_hello_schema/);
  });

  test("rejects post-handshake frame with tampered ciphertext (closes session)", async () => {
    const root = makeRootIdentity("Wendell");
    const local = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_local",
      deviceLabel: "Local",
    });
    const peer = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_peer",
      deviceLabel: "Peer",
    });

    const sessions = new PeerSessionRegistry();
    const applied: DeviceListEvent[] = [];
    const handler = createPeerSyncConnectionHandler({
      selfDeviceId: local.stored.deviceId,
      selfSignPrivateKey: local.signPrivateKey,
      getLocalDeviceList: () => [local.stored, peer.stored],
      sessions,
      applyInboundEvent: (e) => applied.push(e),
    });

    const fake = makeFakeSocket();
    await runHandler(handler, "peer-sync:abc", fake);

    const peerHello = buildPeerHello({
      selfDeviceId: peer.stored.deviceId,
      selfSignPrivateKey: peer.signPrivateKey,
    });
    fake.deliver(JSON.stringify(peerHello.hello));
    expect(sessions.list()).toHaveLength(1);

    const ourHello = PeerHelloSchema.parse(JSON.parse(fake.sent[0]!));
    const peerKey = deriveSessionSharedKey({
      ourEphPrivKeyB64: peerHello.ephPrivateKeyB64,
      peerEphPubKeyB64: ourHello.ephPubKeyB64,
    });
    const event = signDeviceAddedEvent({
      device: peer.stored,
      sourceDeviceId: peer.stored.deviceId,
      signPrivateKey: peer.signPrivateKey,
      seq: 1,
    });
    const frame = encryptPeerSyncFrame({
      sharedKey: peerKey,
      plaintext: JSON.stringify(event),
    });
    const tampered = {
      ...frame,
      ciphertextB64: `${frame.ciphertextB64.slice(0, -5)}AAAAA`,
    };
    fake.deliver(JSON.stringify(tampered));

    expect(applied).toHaveLength(0);
    // Session is torn down so the peer reconnects with a fresh handshake.
    const lastClose = fake.closes.at(-1);
    expect(lastClose?.code).toBe(1008);
    expect(lastClose?.reason).toMatch(/decrypt_failed/);
  });

  test("session is removed from registry when socket closes", async () => {
    const root = makeRootIdentity("Wendell");
    const local = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_local",
      deviceLabel: "Local",
    });
    const peer = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_peer",
      deviceLabel: "Peer",
    });
    const sessions = new PeerSessionRegistry();
    const handler = createPeerSyncConnectionHandler({
      selfDeviceId: local.stored.deviceId,
      selfSignPrivateKey: local.signPrivateKey,
      getLocalDeviceList: () => [local.stored, peer.stored],
      sessions,
      applyInboundEvent: () => undefined,
    });
    const fake = makeFakeSocket();
    await runHandler(handler, "peer-sync:abc", fake);
    fake.deliver(
      JSON.stringify(
        buildPeerHello({
          selfDeviceId: peer.stored.deviceId,
          selfSignPrivateKey: peer.signPrivateKey,
        }).hello,
      ),
    );
    expect(sessions.list()).toHaveLength(1);
    fake.fireClose(1000, "peer_left");
    expect(sessions.list()).toHaveLength(0);
  });
});

describe("PeerSessionRegistry", () => {
  test("adding a duplicate peer closes the prior session and replaces", () => {
    const registry = new PeerSessionRegistry();
    const closes1: Array<{ code?: number; reason?: string }> = [];
    const closes2: Array<{ code?: number; reason?: string }> = [];
    const sock1 = {
      send: () => undefined,
      close: (code?: number, reason?: string) => closes1.push({ code, reason }),
    };
    const sock2 = {
      send: () => undefined,
      close: (code?: number, reason?: string) => closes2.push({ code, reason }),
    };
    registry.add({
      peerDeviceId: "p1",
      sharedKey: new Uint8Array(32) as never,
      socket: sock1,
      establishedAtMs: 1,
    });
    const displaced = registry.add({
      peerDeviceId: "p1",
      sharedKey: new Uint8Array(32) as never,
      socket: sock2,
      establishedAtMs: 2,
    });
    expect(displaced?.establishedAtMs).toBe(1);
    expect(closes1[0]?.code).toBe(1008);
    expect(registry.get("p1")?.establishedAtMs).toBe(2);
    expect(registry.list()).toHaveLength(1);
  });

  test("closeAll closes everything and clears", () => {
    const registry = new PeerSessionRegistry();
    const closes: number[] = [];
    for (let i = 0; i < 3; i++) {
      registry.add({
        peerDeviceId: `p${i}`,
        sharedKey: new Uint8Array(32) as never,
        socket: {
          send: () => undefined,
          close: (code) => {
            if (typeof code === "number") closes.push(code);
          },
        },
        establishedAtMs: i,
      });
    }
    registry.closeAll("test");
    expect(closes).toHaveLength(3);
    expect(registry.list()).toHaveLength(0);
  });

  test("decrypt sanity-check: encrypted frame from peer round-trips through receiver session", () => {
    // Just to nail down: the SharedKey in the registry is the right
    // type the encrypt/decrypt helpers expect. (Catches any future
    // divergence between the registry's type and the handshake's.)
    const a = (() => {
      const root = makeRootIdentity("W");
      return makeAuthorizedDaemonDevice({
        rootIdentity: root,
        deviceId: "dev_a",
        deviceLabel: "A",
      });
    })();
    const ah = buildPeerHello({
      selfDeviceId: a.stored.deviceId,
      selfSignPrivateKey: a.signPrivateKey,
    });
    const b = (() => {
      const root = makeRootIdentity("W");
      return makeAuthorizedDaemonDevice({
        rootIdentity: root,
        deviceId: "dev_b",
        deviceLabel: "B",
      });
    })();
    const bh = buildPeerHello({
      selfDeviceId: b.stored.deviceId,
      selfSignPrivateKey: b.signPrivateKey,
    });
    const aKey = deriveSessionSharedKey({
      ourEphPrivKeyB64: ah.ephPrivateKeyB64,
      peerEphPubKeyB64: bh.hello.ephPubKeyB64,
    });
    const bKey = deriveSessionSharedKey({
      ourEphPrivKeyB64: bh.ephPrivateKeyB64,
      peerEphPubKeyB64: ah.hello.ephPubKeyB64,
    });
    const registry = new PeerSessionRegistry();
    registry.add({
      peerDeviceId: "dev_b",
      sharedKey: aKey,
      socket: { send: () => undefined, close: () => undefined },
      establishedAtMs: 1,
    });
    const session = registry.get("dev_b")!;
    const frame = encryptPeerSyncFrame({ sharedKey: bKey, plaintext: "hello" });
    expect(decryptPeerSyncFrame({ sharedKey: session.sharedKey, frame })).toBe("hello");
  });
});
