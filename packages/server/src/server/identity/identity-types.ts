import { z } from "zod";

/**
 * RootIdentity is the user's primary identity. It is generated once per
 * ottie installation (per `$OTTIE_HOME`). The signing keypair is the trust
 * anchor: its private key is used ONLY to sign device records under this
 * user. Day-to-day messaging will use device-scoped keys (Phase 2+).
 *
 * Storage: `$OTTIE_HOME/identity/root.json`, mode 0o600, plaintext JSON.
 *
 * NOTE on plaintext: this matches the existing `daemon-keypair.json` and
 * `local-token` patterns. Sealing-at-rest is tracked as a future
 * cross-cutting milestone covering all sensitive files at once — sealing
 * only the identity file would create an inconsistent threat model.
 */
export const RootIdentitySchema = z.object({
  v: z.literal(1),
  /** Ed25519 public key, 32 bytes, base64url-encoded (JWK 'x' field). */
  signPublicKeyB64: z.string().min(1),
  /** Ed25519 private seed, 32 bytes, base64url-encoded (JWK 'd' field). */
  signPrivateKeyB64: z.string().min(1),
  /**
   * Phase 3.b/2a: long-lived X25519 ECDH public key, base64url JWK 'x'
   * (32 bytes raw). Distinct from `signPublicKeyB64` (Ed25519, signing-only)
   * and from the per-handshake ephemeral X25519 keys friend-pair / friend-
   * sync use. Friends store this in their peer record; senders use it as
   * the recipient half of NaCl-box encryption when posting to the offline
   * inbox at relay (the friend-sync session keys are forward-secret and
   * gone by the time the recipient picks up).
   *
   * Optional for back-compat with root.json files written before 3.b/2a.
   * Loader synthesizes + persists this on first read under the new build,
   * so in-memory `RootIdentityBundle.encryptionPublicKey` is always set.
   */
  encryptionPublicKeyB64: z.string().min(1).optional(),
  /** Phase 3.b/2a: matching X25519 private key (JWK 'd', 32 bytes). */
  encryptionPrivateKeyB64: z.string().min(1).optional(),
  /** User-chosen display name. Mutable but rate-limited per design §13 Q9. */
  displayName: z.string().min(1).max(64),
  createdAt: z.string(),
});

export type StoredRootIdentity = z.infer<typeof RootIdentitySchema>;
