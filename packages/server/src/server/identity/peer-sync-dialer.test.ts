import { generateKeyPairSync } from "node:crypto";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

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
import { PeerSyncDialer, type DialerSocket } from "./peer-sync-dialer.js";
import type { RootIdentityBundle } from "./root-identity-store.js";

const SILENT_LOGGER = pino({ level: "silent" });

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
 * Bidirectional fake socket pair: dialer side ↔ peer side. Mirrors the
 * shape used by Phase 2.d / 2.e end-to-end tests; the dialer sees one
 * end and we drive the peer end manually.
 */
function makeFakeSocketPair() {
  type Listener<T extends unknown[]> = (...args: T) => void;
  const dialerOpen: Array<Listener<[]>> = [];
  const dialerMessage: Array<Listener<[unknown, boolean]>> = [];
  const dialerClose: Array<Listener<[number, Buffer]>> = [];
  const dialerError: Array<Listener<[Error]>> = [];

  const peerMessage: Array<Listener<[unknown]>> = [];

  let dialerOpened = false;
  let closed = false;

  const dialerSocket: DialerSocket = {
    send: (data) => {
      if (closed) throw new Error("WebSocket is not open");
      // Forward dialer→peer; peer is the "receiver".
      for (const l of peerMessage) l(data);
    },
    close: (code = 1000, reason = "") => {
      if (closed) return;
      closed = true;
      const reasonBuf = Buffer.from(reason);
      for (const l of dialerClose) l(code, reasonBuf);
    },
    on: (event, listener) => {
      if (event === "open") dialerOpen.push(listener as Listener<[]>);
      if (event === "message") dialerMessage.push(listener as Listener<[unknown, boolean]>);
      if (event === "close") dialerClose.push(listener as Listener<[number, Buffer]>);
      if (event === "error") dialerError.push(listener as Listener<[Error]>);
    },
  };

  return {
    dialerSocket,
    fireDialerOpen: () => {
      if (dialerOpened) return;
      dialerOpened = true;
      for (const l of dialerOpen) l();
    },
    deliverToDialer: (data: unknown, isBinary = false) => {
      if (closed) return;
      for (const l of dialerMessage) l(data, isBinary);
    },
    onPeerMessage: (cb: (data: unknown) => void) => {
      peerMessage.push(cb);
    },
    closeFromPeer: (code = 1000, reason = "peer_closed") => {
      if (closed) return;
      closed = true;
      const reasonBuf = Buffer.from(reason);
      for (const l of dialerClose) l(code, reasonBuf);
    },
    isClosed: () => closed,
  };
}

let dialer: PeerSyncDialer | null = null;
beforeEach(() => {
  dialer = null;
});
afterEach(async () => {
  if (dialer) {
    await dialer.stop();
    dialer = null;
  }
});

describe("PeerSyncDialer.start — initiator handshake", () => {
  test("happy path: dialer sends hello → peer responds → session registered", async () => {
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
    const wire = makeFakeSocketPair();

    let peerSawDialerHello: unknown = null;
    wire.onPeerMessage((data) => {
      peerSawDialerHello = JSON.parse(typeof data === "string" ? data : String(data));
    });

    dialer = new PeerSyncDialer({
      selfDeviceId: local.stored.deviceId,
      selfSignPrivateKey: local.signPrivateKey,
      relayEndpoint: "test.local:443",
      getLocalDeviceList: () => [local.stored, peer.stored],
      sessions,
      applyInboundEvent: () => undefined,
      logger: SILENT_LOGGER,
      createSocket: () => wire.dialerSocket,
    });
    dialer.start();
    wire.fireDialerOpen();

    // Dialer should have sent its hello (claiming to be local).
    const dialerHello = PeerHelloSchema.parse(peerSawDialerHello);
    expect(dialerHello.fromDeviceId).toBe("dev_local");

    // Peer responds with its own hello.
    const peerHello = buildPeerHello({
      selfDeviceId: peer.stored.deviceId,
      selfSignPrivateKey: peer.signPrivateKey,
    });
    wire.deliverToDialer(JSON.stringify(peerHello.hello));

    // Session registered.
    expect(sessions.list()).toHaveLength(1);
    const session = sessions.get("dev_peer");
    expect(session).not.toBeNull();

    // The session's shared key should match what peer derives.
    const peerKey = deriveSessionSharedKey({
      ourEphPrivKeyB64: peerHello.ephPrivateKeyB64,
      peerEphPubKeyB64: dialerHello.ephPubKeyB64,
    });
    const frame = encryptPeerSyncFrame({ sharedKey: peerKey, plaintext: "hi" });
    expect(decryptPeerSyncFrame({ sharedKey: session!.sharedKey, frame })).toBe("hi");
  });

  test("rejects peer hello with mismatched fromDeviceId (peer routing bug / attacker)", async () => {
    const root = makeRootIdentity("W");
    const local = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_local",
      deviceLabel: "Local",
    });
    const targetPeer = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_target",
      deviceLabel: "Target",
    });
    const otherPeer = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_other",
      deviceLabel: "Other",
    });
    const sessions = new PeerSessionRegistry();
    const wire = makeFakeSocketPair();

    dialer = new PeerSyncDialer({
      selfDeviceId: local.stored.deviceId,
      selfSignPrivateKey: local.signPrivateKey,
      relayEndpoint: "test.local:443",
      getLocalDeviceList: () => [local.stored, targetPeer.stored, otherPeer.stored],
      sessions,
      applyInboundEvent: () => undefined,
      logger: SILENT_LOGGER,
      createSocket: () => wire.dialerSocket,
    });
    dialer.start();
    wire.fireDialerOpen();

    // Peer responds, but the hello claims a different fromDeviceId.
    // (We dialed dev_target via the relay's serverId routing, but the
    // hello says it's dev_other.)
    const wrongHello = buildPeerHello({
      selfDeviceId: otherPeer.stored.deviceId,
      selfSignPrivateKey: otherPeer.signPrivateKey,
    });
    wire.deliverToDialer(JSON.stringify(wrongHello.hello));

    expect(sessions.list()).toHaveLength(0);
    expect(wire.isClosed()).toBe(true);
  });

  test("rejects peer hello with bad signature", async () => {
    const root = makeRootIdentity("W");
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
    const wire = makeFakeSocketPair();

    dialer = new PeerSyncDialer({
      selfDeviceId: local.stored.deviceId,
      selfSignPrivateKey: local.signPrivateKey,
      relayEndpoint: "test.local:443",
      getLocalDeviceList: () => [local.stored, peer.stored],
      sessions,
      applyInboundEvent: () => undefined,
      logger: SILENT_LOGGER,
      createSocket: () => wire.dialerSocket,
    });
    dialer.start();
    wire.fireDialerOpen();

    const forgedHello = buildPeerHello({
      selfDeviceId: peer.stored.deviceId,
      selfSignPrivateKey: attacker.signPrivateKey, // wrong key
    });
    wire.deliverToDialer(JSON.stringify(forgedHello.hello));

    expect(sessions.list()).toHaveLength(0);
    expect(wire.isClosed()).toBe(true);
  });

  test("session is removed from registry when socket closes", async () => {
    const root = makeRootIdentity("W");
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
    const wire = makeFakeSocketPair();

    dialer = new PeerSyncDialer({
      selfDeviceId: local.stored.deviceId,
      selfSignPrivateKey: local.signPrivateKey,
      relayEndpoint: "test.local:443",
      getLocalDeviceList: () => [local.stored, peer.stored],
      sessions,
      applyInboundEvent: () => undefined,
      logger: SILENT_LOGGER,
      createSocket: () => wire.dialerSocket,
    });
    dialer.start();
    wire.fireDialerOpen();

    const peerHello = buildPeerHello({
      selfDeviceId: peer.stored.deviceId,
      selfSignPrivateKey: peer.signPrivateKey,
    });
    wire.deliverToDialer(JSON.stringify(peerHello.hello));
    expect(sessions.list()).toHaveLength(1);

    wire.closeFromPeer(1000, "peer_left");
    expect(sessions.list()).toHaveLength(0);
  });

  test("post-handshake: encrypted event frame from peer is decrypted and applied", async () => {
    const root = makeRootIdentity("W");
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
    const wire = makeFakeSocketPair();
    const applied: DeviceListEvent[] = [];

    let peerSawDialerHello: unknown = null;
    wire.onPeerMessage((data) => {
      peerSawDialerHello = JSON.parse(typeof data === "string" ? data : String(data));
    });

    dialer = new PeerSyncDialer({
      selfDeviceId: local.stored.deviceId,
      selfSignPrivateKey: local.signPrivateKey,
      relayEndpoint: "test.local:443",
      getLocalDeviceList: () => [local.stored, peer.stored],
      sessions,
      applyInboundEvent: (e) => applied.push(e),
      logger: SILENT_LOGGER,
      createSocket: () => wire.dialerSocket,
    });
    dialer.start();
    wire.fireDialerOpen();

    const dialerHello = PeerHelloSchema.parse(peerSawDialerHello);
    const peerHello = buildPeerHello({
      selfDeviceId: peer.stored.deviceId,
      selfSignPrivateKey: peer.signPrivateKey,
    });
    wire.deliverToDialer(JSON.stringify(peerHello.hello));

    const peerKey = deriveSessionSharedKey({
      ourEphPrivKeyB64: peerHello.ephPrivateKeyB64,
      peerEphPubKeyB64: dialerHello.ephPubKeyB64,
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
    wire.deliverToDialer(JSON.stringify(frame));

    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual(event);
  });
});

describe("PeerSyncDialer.discoverPeers — what counts as a peer", () => {
  test("filters out self + non-daemon roles", async () => {
    const root = makeRootIdentity("W");
    const local = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_local",
      deviceLabel: "Local",
    });
    const daemonPeer = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_daemon_peer",
      deviceLabel: "DaemonPeer",
    });
    const clientPeer: StoredDevice = {
      v: 1,
      deviceId: "dev_client_peer",
      deviceLabel: "PhoneClient",
      role: "client",
      signPublicKeyB64: "x".repeat(43),
      authorizedAt: new Date(1_700_000_000_000).toISOString(),
      authorizationSignatureB64: "y".repeat(43),
    };
    const sessions = new PeerSessionRegistry();

    let dialAttempts = 0;
    const wire = makeFakeSocketPair();
    dialer = new PeerSyncDialer({
      selfDeviceId: local.stored.deviceId,
      selfSignPrivateKey: local.signPrivateKey,
      relayEndpoint: "test.local:443",
      getLocalDeviceList: () => [local.stored, daemonPeer.stored, clientPeer],
      sessions,
      applyInboundEvent: () => undefined,
      logger: SILENT_LOGGER,
      createSocket: () => {
        dialAttempts += 1;
        return wire.dialerSocket;
      },
    });
    dialer.start();
    expect(dialAttempts).toBe(1); // only daemonPeer
  });

  test("refreshTargets picks up newly-added daemon peer without redialing existing", async () => {
    const root = makeRootIdentity("W");
    const local = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_local",
      deviceLabel: "Local",
    });
    const peer1 = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_peer_1",
      deviceLabel: "Peer1",
    });
    const peer2 = makeAuthorizedDaemonDevice({
      rootIdentity: root,
      deviceId: "dev_peer_2",
      deviceLabel: "Peer2",
    });

    const sessions = new PeerSessionRegistry();
    let devices: readonly StoredDevice[] = [local.stored, peer1.stored];
    let dialAttempts = 0;
    const sockets: ReturnType<typeof makeFakeSocketPair>[] = [];

    dialer = new PeerSyncDialer({
      selfDeviceId: local.stored.deviceId,
      selfSignPrivateKey: local.signPrivateKey,
      relayEndpoint: "test.local:443",
      getLocalDeviceList: () => devices,
      sessions,
      applyInboundEvent: () => undefined,
      logger: SILENT_LOGGER,
      createSocket: () => {
        dialAttempts += 1;
        const wire = makeFakeSocketPair();
        sockets.push(wire);
        return wire.dialerSocket;
      },
    });
    dialer.start();
    expect(dialAttempts).toBe(1); // peer1 only

    // New peer added to the device list; refresh and expect a second
    // dial — but no re-dial of peer1.
    devices = [local.stored, peer1.stored, peer2.stored];
    dialer.refreshTargets();
    expect(dialAttempts).toBe(2); // peer1 + peer2
  });
});

describe("PeerSyncDialer.stop", () => {
  test("closes in-flight sockets and stops accepting new dials", async () => {
    const root = makeRootIdentity("W");
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
    const wire = makeFakeSocketPair();

    dialer = new PeerSyncDialer({
      selfDeviceId: local.stored.deviceId,
      selfSignPrivateKey: local.signPrivateKey,
      relayEndpoint: "test.local:443",
      getLocalDeviceList: () => [local.stored, peer.stored],
      sessions,
      applyInboundEvent: () => undefined,
      logger: SILENT_LOGGER,
      createSocket: () => wire.dialerSocket,
    });
    dialer.start();
    expect(wire.isClosed()).toBe(false);

    await dialer.stop();
    expect(wire.isClosed()).toBe(true);

    // refreshTargets after stop is a no-op (doesn't throw, doesn't dial).
    dialer.refreshTargets();
    expect(() => dialer!.start()).toThrow();

    // Set to null so afterEach doesn't double-stop.
    dialer = null;
  });
});
