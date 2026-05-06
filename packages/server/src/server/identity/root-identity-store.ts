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
  const stored = RootIdentitySchema.parse(JSON.parse(raw));

  const signPublicKey = importEd25519PublicKey(stored.signPublicKeyB64);
  const signPrivateKey = importEd25519PrivateKey(stored.signPrivateKeyB64, stored.signPublicKeyB64);

  log?.info({ filePath }, "Loaded root identity");
  return { stored, signPublicKey, signPrivateKey };
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

  const stored: StoredRootIdentity = {
    v: 1,
    signPublicKeyB64,
    signPrivateKeyB64,
    displayName: trimmedName,
    createdAt: new Date().toISOString(),
  };

  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });

  log?.info({ filePath }, "Created root identity");
  return { stored, signPublicKey: publicKey, signPrivateKey: privateKey };
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

  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });

  log?.info({ filePath, displayName: validated.displayName }, "Imported root identity");
  return { stored: validated, signPublicKey, signPrivateKey };
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
