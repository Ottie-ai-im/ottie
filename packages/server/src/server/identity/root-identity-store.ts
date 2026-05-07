import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import path from "node:path";
import type pino from "pino";

import { RootIdentitySchema, type StoredRootIdentity } from "./identity-types.js";

// TODO(seal-secrets): root identity is stored plaintext (mode 0o600), matching
// the existing `daemon-keypair.json` and `local-token` patterns. A future
// milestone will introduce sealing-at-rest (OS keychain) and migrate all
// sensitive files together — sealing only this one would yield an inconsistent
// threat model. See docs/MULTI-USER-COLLABORATION-DESIGN.md §7 and §13.

const IDENTITY_DIRNAME = "identity";
const IDENTITY_FILENAME = "root.json";

export interface RootIdentityBundle {
  /** Stored fields (the on-disk shape). */
  stored: StoredRootIdentity;
  /** Ed25519 public key as a Node KeyObject for verify() operations. */
  signPublicKey: KeyObject;
  /** Ed25519 private key as a Node KeyObject for sign() operations. */
  signPrivateKey: KeyObject;
  /**
   * Phase 3.b/2a: X25519 public key (raw 32-byte JWK 'x' base64url) for
   * offline-inbox encryption. Always non-empty after `loadRootIdentity` —
   * if the on-disk file pre-dates 3.b/2a, the loader generates a fresh
   * keypair and rewrites the file before returning.
   */
  encryptionPublicKeyB64: string;
  /** Phase 3.b/2a: matching X25519 private key (JWK 'd' base64url). */
  encryptionPrivateKeyB64: string;
}

/**
 * Path to the on-disk root-identity file. Exposed for tests and for callers
 * that need to delete or inspect the file directly.
 */
export function rootIdentityFilePath(ottieHome: string): string {
  return path.join(ottieHome, IDENTITY_DIRNAME, IDENTITY_FILENAME);
}

/**
 * Returns the existing identity bundle if `root.json` exists and parses cleanly.
 *
 * Returns `null` if no identity file exists yet — this is the canonical
 * first-run signal. The UI is expected to prompt the user for a display name
 * and then call `createRootIdentity`.
 *
 * Throws if the file exists but is corrupt or fails schema validation.
 * Callers should surface this so the user can decide whether to recover or
 * wipe `$OTTIE_HOME/identity/`.
 */
export function loadRootIdentity(
  ottieHome: string,
  logger?: pino.Logger,
): RootIdentityBundle | null {
  const log = logger?.child({ module: "root-identity" });
  const filePath = rootIdentityFilePath(ottieHome);

  if (!existsSync(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath, "utf8");
  const parsedStored = RootIdentitySchema.parse(JSON.parse(raw));

  const signPublicKey = importEd25519PublicKey(parsedStored.signPublicKeyB64);
  const signPrivateKey = importEd25519PrivateKey(
    parsedStored.signPrivateKeyB64,
    parsedStored.signPublicKeyB64,
  );

  // Phase 3.b/2a back-compat migration: root.json files written before
  // 3.b/2a don't carry the X25519 encryption keypair. Synthesize one and
  // persist in place so the rest of the codebase can assume the bundle
  // always has these keys. The migration is idempotent — subsequent loads
  // see the populated fields and skip this branch.
  let stored = parsedStored;
  if (!stored.encryptionPublicKeyB64 || !stored.encryptionPrivateKeyB64) {
    const { publicKeyB64, privateKeyB64 } = generateX25519KeyPairB64();
    stored = {
      ...stored,
      encryptionPublicKeyB64: publicKeyB64,
      encryptionPrivateKeyB64: privateKeyB64,
    };
    writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
    log?.info({ filePath }, "Migrated root identity: added X25519 encryption keypair");
  }

  log?.info({ filePath }, "Loaded root identity");
  return {
    stored,
    signPublicKey,
    signPrivateKey,
    // Schema marks the X25519 fields optional for back-compat, but the
    // migration block above guarantees they're populated by this point.
    encryptionPublicKeyB64: stored.encryptionPublicKeyB64 ?? "",
    encryptionPrivateKeyB64: stored.encryptionPrivateKeyB64 ?? "",
  };
}

/**
 * Generates a new Ed25519 keypair for the root identity and writes it to
 * `$OTTIE_HOME/identity/root.json` with mode 0o600.
 *
 * Throws if a root identity already exists at that path — callers should
 * call `loadRootIdentity` first and only call this on a `null` result.
 */
export function createRootIdentity(
  ottieHome: string,
  displayName: string,
  logger?: pino.Logger,
): RootIdentityBundle {
  const log = logger?.child({ module: "root-identity" });

  const trimmedName = displayName.trim();
  if (trimmedName.length === 0) {
    throw new Error("displayName must not be empty");
  }
  if (trimmedName.length > 64) {
    throw new Error("displayName must be 64 characters or fewer");
  }

  const filePath = rootIdentityFilePath(ottieHome);
  if (existsSync(filePath)) {
    throw new Error(`Refusing to overwrite existing root identity at ${filePath}`);
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  const signPublicKeyB64 = exportEd25519PublicKey(publicKey);
  const signPrivateKeyB64 = exportEd25519PrivateKey(privateKey);

  // Phase 3.b/2a: mint a fresh X25519 keypair too. New identities always
  // ship with one; old ones get migrated on next load (see loadRootIdentity).
  const { publicKeyB64: encryptionPublicKeyB64, privateKeyB64: encryptionPrivateKeyB64 } =
    generateX25519KeyPairB64();

  const stored: StoredRootIdentity = {
    v: 1,
    signPublicKeyB64,
    signPrivateKeyB64,
    encryptionPublicKeyB64,
    encryptionPrivateKeyB64,
    displayName: trimmedName,
    createdAt: new Date().toISOString(),
  };

  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });

  log?.info({ filePath }, "Created root identity");
  return {
    stored,
    signPublicKey: publicKey,
    signPrivateKey: privateKey,
    encryptionPublicKeyB64,
    encryptionPrivateKeyB64,
  };
}

/**
 * Phase 2.e/2: write a `StoredRootIdentity` that came IN from another
 * device (over the device-link approval reply) instead of being freshly
 * generated. Used only on the new-device side after the user approved
 * the link on their original device.
 *
 * Refuses to overwrite an existing identity for the same reason
 * `createRootIdentity` does: silently rotating the user's external
 * identity would break every existing friend pairing.
 */
export function writeImportedRootIdentity(
  ottieHome: string,
  stored: StoredRootIdentity,
  logger?: pino.Logger,
): RootIdentityBundle {
  const log = logger?.child({ module: "root-identity" });
  const filePath = rootIdentityFilePath(ottieHome);
  if (existsSync(filePath)) {
    throw new Error(
      `Refusing to overwrite existing root identity at ${filePath} — adopt-from-link should only run on a fresh install`,
    );
  }

  // Validate up-front: schema parse covers shape; key-rebuild covers that
  // the base64url payloads actually decode to a real Ed25519 keypair. If
  // either fails we want to throw before touching the disk.
  const validated = RootIdentitySchema.parse(stored);
  const signPublicKey = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: validated.signPublicKeyB64 },
    format: "jwk",
  });
  const signPrivateKey = createPrivateKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: validated.signPublicKeyB64,
      d: validated.signPrivateKeyB64,
    },
    format: "jwk",
  });

  // Phase 3.b/2a: identity-bearing X25519 keys must travel with the root
  // identity (otherwise the new device couldn't decrypt offline-inbox
  // messages addressed to the shared identity). If the linker's daemon
  // pre-dates 3.b/2a and didn't include them, the new device generates
  // a fresh pair locally. That's a partial-truth: messages already in
  // flight to the OLD device's pubkey won't be readable here, but new
  // friends pairing under this identity from this device onward will see
  // the new pubkey. Once the linker upgrades, both devices end up with
  // matching keys via peer-sync (Phase 2.f) — handled separately.
  let storedWithEncKeys = validated;
  if (!storedWithEncKeys.encryptionPublicKeyB64 || !storedWithEncKeys.encryptionPrivateKeyB64) {
    const { publicKeyB64, privateKeyB64 } = generateX25519KeyPairB64();
    storedWithEncKeys = {
      ...storedWithEncKeys,
      encryptionPublicKeyB64: publicKeyB64,
      encryptionPrivateKeyB64: privateKeyB64,
    };
  }

  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(storedWithEncKeys, null, 2)}\n`, { mode: 0o600 });

  log?.info({ filePath, displayName: storedWithEncKeys.displayName }, "Imported root identity");
  return {
    stored: storedWithEncKeys,
    signPublicKey,
    signPrivateKey,
    encryptionPublicKeyB64: storedWithEncKeys.encryptionPublicKeyB64 ?? "",
    encryptionPrivateKeyB64: storedWithEncKeys.encryptionPrivateKeyB64 ?? "",
  };
}

// ----- Ed25519 raw-byte (JWK base64url) serialization ---------------------
//
// Node's `KeyObject.export({ format: "jwk" })` for Ed25519 yields the 32-byte
// public key in `.x` and the 32-byte private seed in `.d`, both base64url-
// encoded without padding. This is the most compact, vendor-neutral form and
// roundtrips cleanly via `createPublicKey` / `createPrivateKey` with `format:
// "jwk"`. We deliberately avoid PEM (verbose) and DER (binary) on disk.

function exportEd25519PublicKey(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) {
    throw new Error("Ed25519 public key JWK is missing the 'x' field");
  }
  return jwk.x;
}

function exportEd25519PrivateKey(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" }) as { d?: string };
  if (!jwk.d) {
    throw new Error("Ed25519 private key JWK is missing the 'd' field");
  }
  return jwk.d;
}

function importEd25519PublicKey(b64url: string): KeyObject {
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: b64url },
    format: "jwk",
  });
}

function importEd25519PrivateKey(privateB64url: string, publicB64url: string): KeyObject {
  return createPrivateKey({
    key: { kty: "OKP", crv: "Ed25519", x: publicB64url, d: privateB64url },
    format: "jwk",
  });
}

// ----- X25519 (Phase 3.b/2a) ---------------------------------------------
//
// X25519 keypair for offline-inbox encryption. We store the JWK 'x' / 'd'
// base64url forms (raw 32 bytes each) so the on-disk format matches the
// Ed25519 lines above. Senders run nacl.box (Curve25519) with these keys —
// the wire encoding is interchangeable, see friend-sync-handshake.ts for
// prior art using Node-generated X25519 keys with nacl.box from
// @ottie/relay/e2ee.

function generateX25519KeyPairB64(): { publicKeyB64: string; privateKeyB64: string } {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const pubJwk = publicKey.export({ format: "jwk" }) as { x?: string };
  const privJwk = privateKey.export({ format: "jwk" }) as { d?: string };
  if (!pubJwk.x) {
    throw new Error("X25519 public key JWK is missing the 'x' field");
  }
  if (!privJwk.d) {
    throw new Error("X25519 private key JWK is missing the 'd' field");
  }
  return { publicKeyB64: pubJwk.x, privateKeyB64: privJwk.d };
}
