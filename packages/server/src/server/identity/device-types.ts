import { z } from "zod";

/**
 * A Device represents a single ottie installation (daemon-host or
 * client-only) linked to a RootIdentity. Phase 2.a creates the first
 * device on each daemon — the daemon itself, role="daemon", deviceId
 * matching the persisted server-id. Subsequent phases add the link-flow
 * for additional devices (laptop #2, phone) under the same identity.
 *
 * Wire shape: this is what gets persisted on disk and what the existing
 * device sends to the new device during the link handshake. Private
 * fields (signPrivateKeyB64, etc.) are NEVER part of this schema.
 */
export const DeviceSchema = z.object({
  v: z.literal(1),
  /** UUID. For role="daemon", matches the daemon's server-id. */
  deviceId: z.string().min(1),
  /** Human-readable label. Defaults to hostname for daemon-role devices. */
  deviceLabel: z.string().min(1).max(64),
  /** Whether this device runs a daemon (laptop/server) or is a client-only (phone/web). */
  role: z.enum(["daemon", "client"]),
  /**
   * Ed25519 public signing key (32 bytes, base64url JWK 'x'). Used by this
   * device to sign messages it originates. The corresponding private key
   * stays on the device only — never sent over the wire.
   */
  signPublicKeyB64: z.string().min(1),
  authorizedAt: z.string(),
  /**
   * Last time this device was observed online. Optional because a freshly
   * authorized device hasn't connected yet. Updated by the daemon when it
   * boots (for self-device) or via cross-device sync (for peer devices).
   */
  lastSeenAt: z.string().optional(),
  /**
   * Signature by the root identity's signing key over a canonical bytestring
   * containing deviceId + signPublicKeyB64 + role + authorizedAt. Proves the
   * user explicitly authorized this device. base64url-encoded (43 chars).
   */
  authorizationSignatureB64: z.string().min(1),
});

export type StoredDevice = z.infer<typeof DeviceSchema>;

/**
 * The on-disk shape of `$OTTIE_HOME/identity/devices.json`. The list always
 * contains at least one entry — the self-device — for any initialized
 * identity. Phase 2.d+ adds peer devices to the list via the link-flow.
 */
export const DeviceListSchema = z.object({
  v: z.literal(1),
  devices: z.array(DeviceSchema),
});

export type StoredDeviceList = z.infer<typeof DeviceListSchema>;

/**
 * The on-disk shape of `$OTTIE_HOME/identity/self-device.json`. Holds the
 * private signing key for THIS device — separate file from devices.json
 * so that a "share my device list publicly" path (future) never accidentally
 * leaks the private key.
 */
export const SelfDeviceSchema = z.object({
  v: z.literal(1),
  deviceId: z.string().min(1),
  /** Ed25519 private seed (32 bytes, base64url JWK 'd'). */
  signPrivateKeyB64: z.string().min(1),
  /** Mirror of the public key for convenience; must match what's in devices.json. */
  signPublicKeyB64: z.string().min(1),
});

export type StoredSelfDevice = z.infer<typeof SelfDeviceSchema>;

/**
 * Canonical bytestring that the root identity signs to authorize a device.
 * Format pinned here so signing and verification stay in lockstep across
 * code paths.
 */
export function deviceAuthorizationPayload(input: {
  deviceId: string;
  signPublicKeyB64: string;
  role: "daemon" | "client";
  authorizedAt: string;
}): string {
  return [
    "ottie-device-auth-v1",
    input.deviceId,
    input.signPublicKeyB64,
    input.role,
    input.authorizedAt,
  ].join("\n");
}
