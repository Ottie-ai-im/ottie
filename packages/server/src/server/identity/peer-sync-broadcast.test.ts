import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildDeviceLinkRedemption } from "./device-link-redeem.js";
import { IdentityService } from "./identity-service.js";
import { signDeviceAddedEvent } from "./device-list-event.js";
import type { StoredDevice } from "./device-types.js";
import {
  buildPeerHello,
  decryptPeerSyncFrame,
  deriveSessionSharedKey,
  encryptPeerSyncFrame,
  PeerHelloSchema,
  PeerSyncFrameSchema,
} from "./peer-sync-handshake.js";
import type { PeerSession, PeerSessionSocket } from "./peer-session-registry.js";

/**
 * Phase 2.f/3 — broadcast + catch-up tests. Drives IdentityService's
 * outbound fan-out path: when a local emit happens (or when a fresh
 * peer session is established), the events log lands on every peer's
 * socket as encrypted PeerSyncFrames.
 *
 * Strategy: stub a couple of fake `PeerSession` objects in the
 * registry by calling `IdentityService.applyInboundDeviceListEvent`
 * indirectly through the test setup that simulates a session-
 * established side-effect. We bypass the dialer/receiver here because
 * those have their own e2e tests — what we care about in these tests
 * is the broadcast + replay logic in IdentityService itself.
 */

const SILENT_LOGGER = pino({ level: "silent" });

let tmpHome: string;
beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "ottie-broadcast-"));
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

/**
 * Build a fake session socket that captures everything sent through it.
 * A "peer" can decrypt frames using the same shared key.
 */
function makeCapturingSocket(): {
  socket: PeerSessionSocket;
  sentFrames: string[];
  closed: boolean;
} {
  const sentFrames: string[] = [];
  let closed = false;
  return {
    sentFrames,
    get closed() {
      return closed;
    },
    socket: {
      send: (data) => {
        if (closed) throw new Error("socket closed");
        sentFrames.push(data);
      },
      close: () => {
        closed = true;
      },
    },
  };
}

/**
 * Inject a peer session into IdentityService's registry directly. This
 * mimics what dialer/receiver would do once they finish handshaking.
 */
function injectSession(
  svc: IdentityService,
  peerDeviceId: string,
  socket: PeerSessionSocket,
): {
  session: PeerSession;
  sharedKeyForPeer: import("@ottie/relay/e2ee").SharedKey;
} {
  // Build a fake handshake just to derive a real shared key both
  // sides agree on. This way the captured frames the test reads back
  // are actually decryptable.
  const ourHello = buildPeerHello({
    selfDeviceId: "us",
    selfSignPrivateKey: generateKeyPairSync("ed25519").privateKey,
  });
  const peerHello = buildPeerHello({
    selfDeviceId: peerDeviceId,
    selfSignPrivateKey: generateKeyPairSync("ed25519").privateKey,
  });
  const sharedKey = deriveSessionSharedKey({
    ourEphPrivKeyB64: ourHello.ephPrivateKeyB64,
    peerEphPubKeyB64: peerHello.hello.ephPubKeyB64,
  });
  const sharedKeyForPeer = deriveSessionSharedKey({
    ourEphPrivKeyB64: peerHello.ephPrivateKeyB64,
    peerEphPubKeyB64: ourHello.hello.ephPubKeyB64,
  });
  const session: PeerSession = {
    peerDeviceId,
    sharedKey,
    socket,
    establishedAtMs: 1,
  };
  // The PeerSessionRegistry is private, but the IdentityService exposes
  // getPeerSessions() so adding a session has to go via either dialer/
  // receiver invocation OR a private getter. Test-only: peek via cast.
  interface WithRegistry {
    peerSessions: { add: (s: PeerSession) => unknown };
  }
  (svc as unknown as WithRegistry).peerSessions.add(session);
  return { session, sharedKeyForPeer };
}

/**
 * Decrypt a captured frame string back to a DeviceListEvent.
 */
function decryptFrame(
  frameJson: string,
  sharedKey: import("@ottie/relay/e2ee").SharedKey,
): unknown {
  const parsed = PeerSyncFrameSchema.parse(JSON.parse(frameJson));
  const plaintext = decryptPeerSyncFrame({ sharedKey, frame: parsed });
  return JSON.parse(plaintext);
}

describe("IdentityService broadcast — outbound fan-out on local emit", () => {
  test("approveDeviceLink emits a device-added event AND broadcasts it to all peers", async () => {
    // Alice exists with one peer daemon (Bob) already in her device
    // list. Use the existing in-process Phase 2.d/2.e flow to add a
    // fresh device (Charlie). The expected outcome is:
    //   - alice.events log has the device-added event
    //   - the captured frame on Bob's session is the same event,
    //     decryptable + parseable.
    const alice = new IdentityService({
      ottieHome: tmpHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_alice", deviceLabel: "Alice's Mac" },
      relayEndpoint: "test.local:443",
    });
    alice.initialize("Alice");

    // Inject a fake "Bob" session into Alice's registry — pretend
    // Bob's daemon already handshaked with Alice's daemon.
    const bobCapture = makeCapturingSocket();
    const { sharedKeyForPeer: bobSharedKey } = injectSession(alice, "dev_bob", bobCapture.socket);

    // Now Alice approves a device-link from "Charlie".
    // Use the helper test pattern from other suites: directly drive
    // approveDeviceLink via a manually-built pending offer + candidate.
    const offer = alice.generateDeviceLinkOffer();
    if (!offer) throw new Error("offer expected");
    const built = buildDeviceLinkRedemption({
      offer: offer.pending.offer,
      deviceLabel: "Charlie's Phone",
      role: "client",
    });
    // Decrypt + record candidate by calling the receiver handler in-process.
    const handler = alice.createDeviceLinkConnectionHandler();
    const fakeReceiverSock = {
      readyState: 1,
      send: () => undefined,
      close: () => undefined,
      _msg: null as null | ((d: unknown, b: boolean) => void),
      on(event: string, listener: never) {
        if (event === "message") {
          (this as { _msg: null | ((d: unknown, b: boolean) => void) })._msg = listener as never;
        }
      },
    };
    await handler.handle({
      socket: fakeReceiverSock as never,
      connectionId: `device-link:${offer.pending.offer.nonceB64}`,
      logger: SILENT_LOGGER,
    });
    fakeReceiverSock._msg?.(JSON.stringify(built.redemption), false);

    expect(alice.getPendingDeviceLinkCandidates()).toHaveLength(1);
    alice.approveDeviceLink(alice.getPendingDeviceLinkCandidates()[0]!.nonceB64);

    // === Assertions ===
    // The local event log got the device-added event.
    const events = alice.getDeviceListEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("device-added");

    // Bob's socket received exactly one broadcast frame, and it
    // decrypts to the same event Alice logged.
    expect(bobCapture.sentFrames).toHaveLength(1);
    const decoded = decryptFrame(bobCapture.sentFrames[0]!, bobSharedKey);
    expect(decoded).toEqual(events[0]);
  });

  test("a session that fails to send is removed from the registry", () => {
    const alice = new IdentityService({
      ottieHome: tmpHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_alice2", deviceLabel: "Alice2" },
      relayEndpoint: "test.local:443",
    });
    alice.initialize("Alice");

    let closed = false;
    const erroringSocket: PeerSessionSocket = {
      send: () => {
        throw new Error("socket exploded");
      },
      close: () => {
        closed = true;
      },
    };
    injectSession(alice, "dev_bad", erroringSocket);
    expect(alice.getPeerSessions()).toHaveLength(1);

    // Trigger a broadcast by adopting a flow that emits an event.
    // Easiest: build a real signed event and call the private
    // broadcastEvent through the public approveDeviceLink path, but
    // for this isolated test let's just call the sendThenClose
    // pathway via a synthetic emit through tryEmitDeviceAddedEvent.
    interface WithEmit {
      tryEmitDeviceAddedEvent: (d: StoredDevice) => void;
      selfDevice: { stored: StoredDevice };
    }
    const internals = alice as unknown as WithEmit;
    // Use Alice's own self-device record as the "added" — the bug
    // path doesn't care what's added, only that broadcastEvent fires.
    const fakeDevice: StoredDevice = {
      v: 1,
      deviceId: "dev_some_new",
      deviceLabel: "Trigger",
      role: "client",
      signPublicKeyB64: "x".repeat(43),
      authorizedAt: new Date(1_700_000_000_000).toISOString(),
      authorizationSignatureB64: "y".repeat(43),
    };
    internals.tryEmitDeviceAddedEvent(fakeDevice);

    expect(closed).toBe(true);
    expect(alice.getPeerSessions()).toHaveLength(0);
  });
});

describe("IdentityService catch-up replay — onSessionEstablished", () => {
  test("when a fresh session is added, all existing log events are replayed to that peer", () => {
    const alice = new IdentityService({
      ottieHome: tmpHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_alice_catchup", deviceLabel: "Alice" },
      relayEndpoint: "test.local:443",
    });
    alice.initialize("Alice");

    // Pre-seed the events log with two real events. We can't easily
    // call signDeviceAddedEvent without Alice's self-device key
    // exposed, so reach into the private slot.
    interface WithPrivate {
      events: { append: (e: ReturnType<typeof signDeviceAddedEvent>) => void };
      selfDevice: {
        stored: { signPublicKeyB64: string };
        signPrivateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
      };
      selfDeviceContext: { serverId: string };
    }
    const internals = alice as unknown as WithPrivate;
    const synthDevice: StoredDevice = {
      v: 1,
      deviceId: "dev_x",
      deviceLabel: "X",
      role: "daemon",
      signPublicKeyB64: internals.selfDevice.stored.signPublicKeyB64,
      authorizedAt: new Date(1_700_000_000_000).toISOString(),
      authorizationSignatureB64: "z".repeat(43),
    };
    for (const seq of [1, 2]) {
      internals.events.append(
        signDeviceAddedEvent({
          device: synthDevice,
          sourceDeviceId: internals.selfDeviceContext.serverId,
          signPrivateKey: internals.selfDevice.signPrivateKey,
          seq,
        }),
      );
    }
    expect(alice.getDeviceListEvents()).toHaveLength(2);

    // Inject a fresh peer session and call the public replay hook by
    // simulating what the dialer/receiver would do.
    const peerCapture = makeCapturingSocket();
    const { sharedKeyForPeer } = injectSession(alice, "dev_peer_late", peerCapture.socket);

    interface WithReplay {
      replayEventsToPeer: (peerDeviceId: string) => void;
    }
    (alice as unknown as WithReplay).replayEventsToPeer("dev_peer_late");

    expect(peerCapture.sentFrames).toHaveLength(2);
    const ev1 = decryptFrame(peerCapture.sentFrames[0]!, sharedKeyForPeer);
    const ev2 = decryptFrame(peerCapture.sentFrames[1]!, sharedKeyForPeer);
    expect((ev1 as { seq: number }).seq).toBe(1);
    expect((ev2 as { seq: number }).seq).toBe(2);
  });

  test("replay is a no-op when there are no events", () => {
    const alice = new IdentityService({
      ottieHome: tmpHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_alice_empty", deviceLabel: "Alice" },
      relayEndpoint: "test.local:443",
    });
    alice.initialize("Alice");

    const peerCapture = makeCapturingSocket();
    injectSession(alice, "dev_peer_empty", peerCapture.socket);

    interface WithReplay {
      replayEventsToPeer: (peerDeviceId: string) => void;
    }
    (alice as unknown as WithReplay).replayEventsToPeer("dev_peer_empty");
    expect(peerCapture.sentFrames).toHaveLength(0);
  });
});

describe("end-to-end: broadcast frame round-trips through PeerHello-style ECDH", () => {
  test("captured frame from broadcastEvent decrypts under the peer's matching shared key", () => {
    const alice = new IdentityService({
      ottieHome: tmpHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_alice_e2e_b", deviceLabel: "Alice" },
      relayEndpoint: "test.local:443",
    });
    alice.initialize("Alice");

    const peerCapture = makeCapturingSocket();
    const { sharedKeyForPeer } = injectSession(alice, "dev_p", peerCapture.socket);

    // Trigger a broadcast via tryEmitDeviceAddedEvent.
    interface WithEmitOnly {
      tryEmitDeviceAddedEvent: (d: StoredDevice) => void;
    }
    const fakeDevice: StoredDevice = {
      v: 1,
      deviceId: "dev_new",
      deviceLabel: "New",
      role: "daemon",
      signPublicKeyB64: "x".repeat(43),
      authorizedAt: new Date(1_700_000_000_000).toISOString(),
      authorizationSignatureB64: "y".repeat(43),
    };
    (alice as unknown as WithEmitOnly).tryEmitDeviceAddedEvent(fakeDevice);

    expect(peerCapture.sentFrames).toHaveLength(1);
    const frame = PeerSyncFrameSchema.parse(JSON.parse(peerCapture.sentFrames[0]!));
    const plaintext = decryptPeerSyncFrame({ sharedKey: sharedKeyForPeer, frame });
    const event = JSON.parse(plaintext) as { kind: string; device: { deviceLabel: string } };
    expect(event.kind).toBe("device-added");
    expect(event.device.deviceLabel).toBe("New");

    // Sanity: peer can encrypt back through the same key.
    const reply = encryptPeerSyncFrame({
      sharedKey: sharedKeyForPeer,
      plaintext: "ack",
    });
    expect(PeerHelloSchema.safeParse(reply).success).toBe(false); // not a hello
    expect(PeerSyncFrameSchema.safeParse(reply).success).toBe(true);
  });
});
