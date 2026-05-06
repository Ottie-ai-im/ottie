import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";

import {
  deviceListEventPayload,
  type DeviceAddedEvent,
  type DeviceListEvent,
  type DeviceRemovedEvent,
} from "./device-list-event-types.js";
import type { StoredDevice, StoredDeviceList } from "./device-types.js";

/**
 * Phase 2.f — pure crypto + state-merge functions for device-list
 * events. Mirrors the layering of device-link-redeem.ts and
 * device-link-approve.ts: I/O-free so the sign/verify/apply roundtrip
 * is fully unit-testable without daemons or relays.
 */

// ----- sign --------------------------------------------------------------

export interface SignDeviceAddedEventInput {
  device: StoredDevice;
  sourceDeviceId: string;
  signPrivateKey: KeyObject;
  seq: number;
  /** Override clock (tests). */
  nowMs?: number;
}

export function signDeviceAddedEvent(input: SignDeviceAddedEventInput): DeviceAddedEvent {
  const emittedAt = new Date(input.nowMs ?? Date.now()).toISOString();
  const partial: Omit<DeviceAddedEvent, "signatureB64"> = {
    v: 1,
    kind: "device-added",
    seq: input.seq,
    sourceDeviceId: input.sourceDeviceId,
    emittedAt,
    device: input.device,
  };
  const signatureB64 = signPayload(
    deviceListEventPayload(partial as DeviceListEvent),
    input.signPrivateKey,
  );
  return { ...partial, signatureB64 };
}

export interface SignDeviceRemovedEventInput {
  removedDeviceId: string;
  sourceDeviceId: string;
  signPrivateKey: KeyObject;
  seq: number;
  nowMs?: number;
}

export function signDeviceRemovedEvent(input: SignDeviceRemovedEventInput): DeviceRemovedEvent {
  const emittedAt = new Date(input.nowMs ?? Date.now()).toISOString();
  const partial: Omit<DeviceRemovedEvent, "signatureB64"> = {
    v: 1,
    kind: "device-removed",
    seq: input.seq,
    sourceDeviceId: input.sourceDeviceId,
    emittedAt,
    removedDeviceId: input.removedDeviceId,
  };
  const signatureB64 = signPayload(
    deviceListEventPayload(partial as DeviceListEvent),
    input.signPrivateKey,
  );
  return { ...partial, signatureB64 };
}

// ----- verify + apply ----------------------------------------------------

export type ApplyEventOutcome =
  | {
      readonly status: "applied";
      readonly devices: StoredDeviceList;
      /** True if the event changed the device list, false if it was a no-op (already applied). */
      readonly mutated: boolean;
    }
  | { readonly status: "rejected"; readonly reason: string };

export interface ApplyDeviceListEventInput {
  event: DeviceListEvent;
  /** Receiver's current device list snapshot. */
  current: StoredDeviceList;
  /**
   * Optional replay-protection: if non-null, an event whose seq is
   * `<= lastSeenSeq[event.sourceDeviceId]` is treated as a no-op
   * (still status:"applied" with mutated:false). Phase 2.f/1+ keeps
   * this map in memory, persisted to events.json.
   */
  lastSeenSeqBySource?: Readonly<Record<string, number>>;
}

/**
 * Verify an event against the receiver's current device list, then merge
 * it. Idempotent: re-applying the same event is a no-op (no change).
 *
 * Rejected events return `{status:"rejected", reason}` instead of
 * throwing — callers can log + continue without unwinding their batch.
 */
export function applyDeviceListEvent(input: ApplyDeviceListEventInput): ApplyEventOutcome {
  // 1. Source must be a known authorized device.
  const source = input.current.devices.find((d) => d.deviceId === input.event.sourceDeviceId);
  if (!source) {
    return {
      status: "rejected",
      reason: `Unknown source device: ${input.event.sourceDeviceId}`,
    };
  }

  // 2. Signature must verify under the source's public key.
  let sourcePubKey: KeyObject;
  try {
    sourcePubKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: source.signPublicKeyB64 },
      format: "jwk",
    });
  } catch (err) {
    return {
      status: "rejected",
      reason: `Source device public key unparseable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (!verifyEventSignature(input.event, sourcePubKey)) {
    return { status: "rejected", reason: "Event signature did not verify" };
  }

  // 3. Replay protection: drop events with stale seq.
  const lastSeen = input.lastSeenSeqBySource?.[input.event.sourceDeviceId];
  if (typeof lastSeen === "number" && input.event.seq <= lastSeen) {
    return { status: "applied", devices: input.current, mutated: false };
  }

  // 4. Merge into device list.
  if (input.event.kind === "device-added") {
    return mergeDeviceAdded(input.current, input.event);
  }
  return mergeDeviceRemoved(input.current, input.event);
}

function mergeDeviceAdded(current: StoredDeviceList, event: DeviceAddedEvent): ApplyEventOutcome {
  const existing = current.devices.find((d) => d.deviceId === event.device.deviceId);
  if (!existing) {
    return {
      status: "applied",
      devices: { v: 1, devices: [...current.devices, event.device] },
      mutated: true,
    };
  }
  // Already present. Idempotent: if the existing entry matches, no-op.
  // If it disagrees on root-signed fields, that's a peer reporting a
  // different version — last-writer-wins by emittedAt would require
  // tracking the per-device "added at" event. For Phase 2.f/0 we keep
  // existing and treat it as already-applied. Phase 2.f/1+ revisits if
  // multi-emitter conflicts become real.
  return { status: "applied", devices: current, mutated: false };
}

function mergeDeviceRemoved(
  current: StoredDeviceList,
  event: DeviceRemovedEvent,
): ApplyEventOutcome {
  const remaining = current.devices.filter((d) => d.deviceId !== event.removedDeviceId);
  if (remaining.length === current.devices.length) {
    // Already absent — idempotent no-op.
    return { status: "applied", devices: current, mutated: false };
  }
  return {
    status: "applied",
    devices: { v: 1, devices: remaining },
    mutated: true,
  };
}

// ----- internal: signature helpers ---------------------------------------

function signPayload(payload: string, privateKey: KeyObject): string {
  const sig = sign(null, Buffer.from(payload, "utf8"), privateKey);
  return sig.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function verifyEventSignature(event: DeviceListEvent, sourcePubKey: KeyObject): boolean {
  const payload = deviceListEventPayload(event);
  const sigBytes = base64UrlDecode(event.signatureB64);
  return verify(null, Buffer.from(payload, "utf8"), sourcePubKey, sigBytes);
}

function base64UrlDecode(b64url: string): Buffer {
  const standard = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (standard.length % 4)) % 4;
  return Buffer.from(standard + "=".repeat(padLen), "base64");
}
