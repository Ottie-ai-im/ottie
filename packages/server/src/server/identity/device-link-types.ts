import { z } from "zod";

/**
 * Phase 2.c — wire shape of a device-link offer. The existing device
 * (laptop A) generates one of these, encodes it in a QR/link, and the
 * new device (laptop B / phone) consumes it after the user scans.
 *
 * The offer carries everything the new device needs to:
 *   1. Reach the existing device through the relay (relayEndpoint, serverId).
 *   2. Verify the existing device's identity (rootSignPublicKeyB64) and
 *      show the user "Link this device to <displayName>?".
 *   3. Establish an ephemeral encrypted channel (ephPublicKeyB64), so the
 *      candidate-device record can be sent confidentially even though the
 *      relay only routes opaque bytes.
 *   4. Defeat replay/extension attacks (nonceB64, exp).
 *
 * The corresponding ephemeral *private* key never leaves the existing
 * device — it stays in the pending-offers store until the offer is either
 * redeemed by the new device or expires.
 */
export const DeviceLinkOfferSchema = z.object({
  v: z.literal(1),
  kind: z.literal("device-link"),
  /** Existing daemon's stable server id. New device routes its response here. */
  serverId: z.string().min(1),
  /** Root identity public key — verifiable trust anchor. */
  rootSignPublicKeyB64: z.string().min(1),
  /** Existing identity's display name, shown in the new device's confirm dialog. */
  displayName: z.string().min(1).max(64),
  /** Ephemeral X25519 public key (32 bytes, base64url JWK 'x'). One-time-use. */
  ephPublicKeyB64: z.string().min(1),
  /** 32-byte random nonce, base64url. Prevents replay of stale offers. */
  nonceB64: z.string().min(1),
  /** ISO-8601 expiry. Existing device rejects redemption attempts past this. */
  exp: z.string(),
  /** host:port of the relay. Reused from the daemon's existing relay config. */
  relayEndpoint: z.string().min(1),
});

export type DeviceLinkOffer = z.infer<typeof DeviceLinkOfferSchema>;

/**
 * On-disk / in-memory record kept by the existing device while an offer is
 * outstanding. The ephemeral private key is the secret that lets the existing
 * device decrypt the candidate Device record the new device will send. We
 * never persist this — daemon restarts invalidate any pending offers, which
 * is the right safety property (no zombie offers across reboots).
 */
export interface PendingDeviceLinkOffer {
  /** The wire-shape offer that was encoded into the QR/link. */
  offer: DeviceLinkOffer;
  /** Base64url-encoded X25519 private key matching offer.ephPublicKeyB64. */
  ephPrivateKeyB64: string;
  /** Wall-clock millis at which this offer expires. Mirrors offer.exp. */
  expiresAtMs: number;
}

/**
 * Encode an offer into the canonical deep-link string. Format:
 *
 *   ottie://device-link#payload=<base64url-json>
 *
 * The web app at app.claws.company also accepts this via fragment so users
 * can paste a link in either env. Keeping the payload in the URL fragment
 * (#) rather than query (?) prevents it from leaking into server logs.
 */
export function encodeDeviceLinkOffer(offer: DeviceLinkOffer): string {
  const json = JSON.stringify(offer);
  const b64 = Buffer.from(json, "utf8")
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `ottie://device-link#payload=${b64}`;
}

/**
 * Inverse of `encodeDeviceLinkOffer`. Throws on malformed input or schema
 * mismatch — callers are expected to surface that to the user as
 * "this isn't a valid device-link code".
 */
export function decodeDeviceLinkOffer(input: string): DeviceLinkOffer {
  const marker = "payload=";
  const idx = input.indexOf(marker);
  if (idx < 0) {
    throw new Error("Device-link payload missing 'payload=' marker");
  }
  const b64url = input.slice(idx + marker.length);
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const json = Buffer.from(padded, "base64").toString("utf8");
  const parsed = JSON.parse(json);
  return DeviceLinkOfferSchema.parse(parsed);
}
