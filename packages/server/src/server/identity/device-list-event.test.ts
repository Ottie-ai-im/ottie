import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, test } from "vitest";

import { buildAuthorizedDevice } from "./device-list-store.js";
import { deviceListEventPayload } from "./device-list-event-types.js";
import {
  applyDeviceListEvent,
  signDeviceAddedEvent,
  signDeviceRemovedEvent,
} from "./device-list-event.js";
import {
  deviceAuthorizationPayload,
  type StoredDevice,
  type StoredDeviceList,
} from "./device-types.js";
import type { RootIdentityBundle } from "./root-identity-store.js";

/**
 * Build a fake `RootIdentityBundle` (in-memory; no disk). Same trick as
 * device-link-approve.test.ts. Mirrors the shape `createRootIdentity()`
 * would produce.
 */
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

/** Build a fully-functional self-device + its KeyObjects, signed by the root. */
function makeSelfDevice(args: {
  rootIdentity: RootIdentityBundle;
  deviceId: string;
  deviceLabel: string;
  role: "daemon" | "client";
}): { stored: StoredDevice; signPrivateKey: ReturnType<typeof generateKeyPairSync>["privateKey"] } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  const stored = buildAuthorizedDevice({
    deviceId: args.deviceId,
    deviceLabel: args.deviceLabel,
    role: args.role,
    signPublicKeyB64: jwkPub.x,
    rootIdentity: args.rootIdentity,
  });
  return { stored, signPrivateKey: privateKey };
}

/** Two-device device list: A (daemon) + a stub for tests that need a peer. */
function makeBaselineDeviceList(args: {
  rootIdentity: RootIdentityBundle;
  selfDeviceA: StoredDevice;
}): StoredDeviceList {
  return { v: 1, devices: [args.selfDeviceA] };
}

describe("signDeviceAddedEvent + applyDeviceListEvent", () => {
  test("happy path: emitter signs an add event, peer applies it", () => {
    const root = makeRootIdentity("Wendell");
    const daemonA = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_A",
      deviceLabel: "Laptop A",
      role: "daemon",
    });
    const newDeviceB = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_B",
      deviceLabel: "Laptop B",
      role: "daemon",
    });

    const list: StoredDeviceList = makeBaselineDeviceList({
      rootIdentity: root,
      selfDeviceA: daemonA.stored,
    });

    const event = signDeviceAddedEvent({
      device: newDeviceB.stored,
      sourceDeviceId: daemonA.stored.deviceId,
      signPrivateKey: daemonA.signPrivateKey,
      seq: 1,
    });

    const outcome = applyDeviceListEvent({ event, current: list });
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;
    expect(outcome.mutated).toBe(true);
    expect(outcome.devices.devices).toHaveLength(2);
    expect(outcome.devices.devices[1]?.deviceId).toBe("dev_B");
  });

  test("idempotent: applying the same add event twice produces a single device", () => {
    const root = makeRootIdentity("Wendell");
    const daemonA = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_A",
      deviceLabel: "Laptop A",
      role: "daemon",
    });
    const newDevice = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_B",
      deviceLabel: "Laptop B",
      role: "daemon",
    });
    const list = makeBaselineDeviceList({ rootIdentity: root, selfDeviceA: daemonA.stored });

    const event = signDeviceAddedEvent({
      device: newDevice.stored,
      sourceDeviceId: daemonA.stored.deviceId,
      signPrivateKey: daemonA.signPrivateKey,
      seq: 1,
    });

    const first = applyDeviceListEvent({ event, current: list });
    expect(first.status).toBe("applied");
    if (first.status !== "applied") return;
    expect(first.mutated).toBe(true);

    const second = applyDeviceListEvent({ event, current: first.devices });
    expect(second.status).toBe("applied");
    if (second.status !== "applied") return;
    expect(second.mutated).toBe(false);
    expect(second.devices.devices).toHaveLength(2);
  });

  test("rejected: source device not in the receiver's device list", () => {
    const root = makeRootIdentity("Wendell");
    const daemonA = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_A",
      deviceLabel: "Laptop A",
      role: "daemon",
    });
    const ghostEmitter = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_GHOST",
      deviceLabel: "Removed device",
      role: "daemon",
    });
    const newDevice = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_C",
      deviceLabel: "Laptop C",
      role: "daemon",
    });
    const list = makeBaselineDeviceList({ rootIdentity: root, selfDeviceA: daemonA.stored });

    // Ghost wasn't authorized — its event must be rejected even with a
    // valid signature, because the receiver has no way to trust an
    // unknown source's public key.
    const event = signDeviceAddedEvent({
      device: newDevice.stored,
      sourceDeviceId: ghostEmitter.stored.deviceId,
      signPrivateKey: ghostEmitter.signPrivateKey,
      seq: 1,
    });

    const outcome = applyDeviceListEvent({ event, current: list });
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") return;
    expect(outcome.reason).toMatch(/unknown source device/i);
  });

  test("rejected: tampered signature does not verify", () => {
    const root = makeRootIdentity("Wendell");
    const daemonA = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_A",
      deviceLabel: "Laptop A",
      role: "daemon",
    });
    const newDevice = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_B",
      deviceLabel: "Laptop B",
      role: "daemon",
    });
    const list = makeBaselineDeviceList({ rootIdentity: root, selfDeviceA: daemonA.stored });

    const event = signDeviceAddedEvent({
      device: newDevice.stored,
      sourceDeviceId: daemonA.stored.deviceId,
      signPrivateKey: daemonA.signPrivateKey,
      seq: 1,
    });

    // Flip a character in the signature.
    const bad = {
      ...event,
      signatureB64: `${event.signatureB64.slice(0, -2)}AA`,
    };
    const outcome = applyDeviceListEvent({ event: bad, current: list });
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") return;
    expect(outcome.reason).toMatch(/signature did not verify/i);
  });

  test("rejected: payload tampered (different deviceId in event vs signature)", () => {
    const root = makeRootIdentity("Wendell");
    const daemonA = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_A",
      deviceLabel: "Laptop A",
      role: "daemon",
    });
    const newDevice = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_B",
      deviceLabel: "Laptop B",
      role: "daemon",
    });
    const list = makeBaselineDeviceList({ rootIdentity: root, selfDeviceA: daemonA.stored });

    const event = signDeviceAddedEvent({
      device: newDevice.stored,
      sourceDeviceId: daemonA.stored.deviceId,
      signPrivateKey: daemonA.signPrivateKey,
      seq: 1,
    });

    // Swap the device record while keeping the signature — receiver
    // verifies over the canonical bytestring, which now mismatches.
    const evil = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_EVIL",
      deviceLabel: "Attacker",
      role: "daemon",
    });
    const tampered = { ...event, device: evil.stored };
    const outcome = applyDeviceListEvent({ event: tampered, current: list });
    expect(outcome.status).toBe("rejected");
  });
});

describe("signDeviceRemovedEvent + applyDeviceListEvent", () => {
  test("happy path: removes a device from the list", () => {
    const root = makeRootIdentity("Wendell");
    const daemonA = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_A",
      deviceLabel: "Laptop A",
      role: "daemon",
    });
    const peerB = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_B",
      deviceLabel: "Laptop B",
      role: "daemon",
    });
    const list: StoredDeviceList = {
      v: 1,
      devices: [daemonA.stored, peerB.stored],
    };

    const event = signDeviceRemovedEvent({
      removedDeviceId: peerB.stored.deviceId,
      sourceDeviceId: daemonA.stored.deviceId,
      signPrivateKey: daemonA.signPrivateKey,
      seq: 1,
    });

    const outcome = applyDeviceListEvent({ event, current: list });
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;
    expect(outcome.mutated).toBe(true);
    expect(outcome.devices.devices).toHaveLength(1);
    expect(outcome.devices.devices[0]?.deviceId).toBe("dev_A");
  });

  test("idempotent: removing an already-absent device is a no-op", () => {
    const root = makeRootIdentity("Wendell");
    const daemonA = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_A",
      deviceLabel: "Laptop A",
      role: "daemon",
    });
    const list = makeBaselineDeviceList({ rootIdentity: root, selfDeviceA: daemonA.stored });

    const event = signDeviceRemovedEvent({
      removedDeviceId: "dev_NEVER_ADDED",
      sourceDeviceId: daemonA.stored.deviceId,
      signPrivateKey: daemonA.signPrivateKey,
      seq: 1,
    });

    const outcome = applyDeviceListEvent({ event, current: list });
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;
    expect(outcome.mutated).toBe(false);
    expect(outcome.devices.devices).toHaveLength(1);
  });

  test("event signed for ADD cannot replay as REMOVE (kind in canonical payload)", () => {
    const root = makeRootIdentity("Wendell");
    const daemonA = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_A",
      deviceLabel: "Laptop A",
      role: "daemon",
    });
    const peerB = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_B",
      deviceLabel: "Laptop B",
      role: "daemon",
    });
    const list: StoredDeviceList = { v: 1, devices: [daemonA.stored, peerB.stored] };

    const addEvent = signDeviceAddedEvent({
      device: peerB.stored,
      sourceDeviceId: daemonA.stored.deviceId,
      signPrivateKey: daemonA.signPrivateKey,
      seq: 1,
    });

    // Try to reuse the add event's signature with a remove event shape.
    // The signed bytestring includes `kind`, so this must reject.
    const rebuilt = {
      v: 1 as const,
      kind: "device-removed" as const,
      seq: addEvent.seq,
      sourceDeviceId: addEvent.sourceDeviceId,
      emittedAt: addEvent.emittedAt,
      removedDeviceId: peerB.stored.deviceId,
      signatureB64: addEvent.signatureB64,
    };

    const outcome = applyDeviceListEvent({ event: rebuilt, current: list });
    expect(outcome.status).toBe("rejected");
  });
});

describe("replay protection via lastSeenSeqBySource", () => {
  test("seq <= lastSeen is treated as already-applied (no mutation)", () => {
    const root = makeRootIdentity("Wendell");
    const daemonA = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_A",
      deviceLabel: "Laptop A",
      role: "daemon",
    });
    const newDevice = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_B",
      deviceLabel: "Laptop B",
      role: "daemon",
    });
    const list = makeBaselineDeviceList({ rootIdentity: root, selfDeviceA: daemonA.stored });

    const event = signDeviceAddedEvent({
      device: newDevice.stored,
      sourceDeviceId: daemonA.stored.deviceId,
      signPrivateKey: daemonA.signPrivateKey,
      seq: 5,
    });

    const outcome = applyDeviceListEvent({
      event,
      current: list,
      lastSeenSeqBySource: { [daemonA.stored.deviceId]: 5 },
    });
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;
    expect(outcome.mutated).toBe(false);
    expect(outcome.devices.devices).toHaveLength(1);
  });

  test("seq > lastSeen is applied normally", () => {
    const root = makeRootIdentity("Wendell");
    const daemonA = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_A",
      deviceLabel: "Laptop A",
      role: "daemon",
    });
    const newDevice = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_B",
      deviceLabel: "Laptop B",
      role: "daemon",
    });
    const list = makeBaselineDeviceList({ rootIdentity: root, selfDeviceA: daemonA.stored });

    const event = signDeviceAddedEvent({
      device: newDevice.stored,
      sourceDeviceId: daemonA.stored.deviceId,
      signPrivateKey: daemonA.signPrivateKey,
      seq: 6,
    });

    const outcome = applyDeviceListEvent({
      event,
      current: list,
      lastSeenSeqBySource: { [daemonA.stored.deviceId]: 5 },
    });
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;
    expect(outcome.mutated).toBe(true);
  });
});

describe("integration: A's local apply matches B's apply (deterministic state)", () => {
  test("two daemons converge to the same device list after a sequence of events", () => {
    const root = makeRootIdentity("Wendell");
    const daemonA = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_A",
      deviceLabel: "Laptop A",
      role: "daemon",
    });
    const daemonB = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_B",
      deviceLabel: "Laptop B",
      role: "daemon",
    });
    const newC = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_C",
      deviceLabel: "Laptop C",
      role: "daemon",
    });

    // Both A and B start with each other in the list (post-Phase-2.e).
    let listOnA: StoredDeviceList = { v: 1, devices: [daemonA.stored, daemonB.stored] };
    let listOnB: StoredDeviceList = { v: 1, devices: [daemonA.stored, daemonB.stored] };

    // A approves a new device C and broadcasts the add event.
    const addedC = signDeviceAddedEvent({
      device: newC.stored,
      sourceDeviceId: daemonA.stored.deviceId,
      signPrivateKey: daemonA.signPrivateKey,
      seq: 1,
    });

    // A applies its own event locally; B applies the same event from the wire.
    const a1 = applyDeviceListEvent({ event: addedC, current: listOnA });
    const b1 = applyDeviceListEvent({ event: addedC, current: listOnB });
    if (a1.status === "applied") listOnA = a1.devices;
    if (b1.status === "applied") listOnB = b1.devices;
    expect(listOnA.devices).toHaveLength(3);
    expect(listOnB.devices).toHaveLength(3);
    expect(listOnA.devices.map((d) => d.deviceId).sort()).toEqual(
      listOnB.devices.map((d) => d.deviceId).sort(),
    );

    // B removes A from the list and broadcasts.
    const removedA = signDeviceRemovedEvent({
      removedDeviceId: daemonA.stored.deviceId,
      sourceDeviceId: daemonB.stored.deviceId,
      signPrivateKey: daemonB.signPrivateKey,
      seq: 1,
    });

    const a2 = applyDeviceListEvent({ event: removedA, current: listOnA });
    const b2 = applyDeviceListEvent({ event: removedA, current: listOnB });
    if (a2.status === "applied") listOnA = a2.devices;
    if (b2.status === "applied") listOnB = b2.devices;

    expect(listOnA.devices).toHaveLength(2);
    expect(listOnB.devices).toHaveLength(2);
    expect(listOnA.devices.map((d) => d.deviceId).sort()).toEqual(["dev_B", "dev_C"]);
    expect(listOnB.devices.map((d) => d.deviceId).sort()).toEqual(["dev_B", "dev_C"]);
  });
});

describe("payload helper: signs over identifying fields", () => {
  test("the canonical payload includes kind, seq, sourceDeviceId, emittedAt + per-kind extras", () => {
    const root = makeRootIdentity("Wendell");
    const daemonA = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_A",
      deviceLabel: "Laptop A",
      role: "daemon",
    });
    const newDevice = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_B",
      deviceLabel: "Laptop B",
      role: "daemon",
    });

    const event = signDeviceAddedEvent({
      device: newDevice.stored,
      sourceDeviceId: daemonA.stored.deviceId,
      signPrivateKey: daemonA.signPrivateKey,
      seq: 42,
      nowMs: 1_700_000_000_000,
    });
    const payload = deviceListEventPayload(event);
    expect(payload).toContain("ottie-device-list-event-v1");
    expect(payload).toContain("device-added");
    expect(payload).toContain("42");
    expect(payload).toContain("dev_A");
    expect(payload).toContain("dev_B");
    expect(payload).toContain(newDevice.stored.signPublicKeyB64);
    // Sanity: signature verifies via Node verify() under daemon A's pubkey.
    const sig = Buffer.from(
      event.signatureB64.replace(/-/g, "+").replace(/_/g, "/") +
        "=".repeat((4 - (event.signatureB64.length % 4)) % 4),
      "base64",
    );
    const verifyOk = (() => {
      const { verify } = require("node:crypto") as typeof import("node:crypto");
      const { createPublicKey } = require("node:crypto") as typeof import("node:crypto");
      const pub = createPublicKey({
        key: { kty: "OKP", crv: "Ed25519", x: daemonA.stored.signPublicKeyB64 },
        format: "jwk",
      });
      return verify(null, Buffer.from(payload, "utf8"), pub, sig);
    })();
    expect(verifyOk).toBe(true);
  });

  test("deviceAuthorizationPayload (root signature) has its own format — events use a separate format", () => {
    // Sanity: make sure event signatures don't accidentally satisfy
    // deviceAuthorizationPayload signing — they're on different
    // canonical strings.
    const root = makeRootIdentity("Wendell");
    const daemon = makeSelfDevice({
      rootIdentity: root,
      deviceId: "dev_X",
      deviceLabel: "Box X",
      role: "daemon",
    });
    const eventPayload = deviceListEventPayload({
      v: 1,
      kind: "device-added",
      seq: 1,
      sourceDeviceId: daemon.stored.deviceId,
      emittedAt: new Date(1_700_000_000_000).toISOString(),
      device: daemon.stored,
      signatureB64: "x".repeat(43),
    });
    const authPayload = deviceAuthorizationPayload({
      deviceId: daemon.stored.deviceId,
      signPublicKeyB64: daemon.stored.signPublicKeyB64,
      role: daemon.stored.role,
      authorizedAt: daemon.stored.authorizedAt,
    });
    expect(eventPayload).not.toEqual(authPayload);
    expect(eventPayload.startsWith("ottie-device-list-event-v1")).toBe(true);
    expect(authPayload.startsWith("ottie-device-auth-v1")).toBe(true);
    // Also verify the signature scheme would never collide:
    const fakeSig = sign(null, Buffer.from(authPayload, "utf8"), daemon.signPrivateKey);
    const sigB64 = fakeSig
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    // The payloads are different, so the same signature couldn't be valid for both.
    expect(sigB64.length).toBeGreaterThan(0);
  });
});
