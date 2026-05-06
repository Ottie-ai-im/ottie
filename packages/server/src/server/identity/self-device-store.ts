import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import path from "node:path";
import type pino from "pino";

import { SelfDeviceSchema, type StoredSelfDevice } from "./device-types.js";

// TODO(seal-secrets): self-device private key is stored plaintext (mode 0o600)
// matching the existing daemon-keypair.json / local-token / root.json patterns.
// A future cross-cutting milestone will seal all sensitive files together.

const IDENTITY_DIRNAME = "identity";
const SELF_DEVICE_FILENAME = "self-device.json";

export interface SelfDeviceBundle {
  stored: StoredSelfDevice;
  signPublicKey: KeyObject;
  signPrivateKey: KeyObject;
}

export function selfDeviceFilePath(ottieHome: string): string {
  return path.join(ottieHome, IDENTITY_DIRNAME, SELF_DEVICE_FILENAME);
}

/**
 * Returns the existing self-device bundle if `self-device.json` exists and
 * parses cleanly. Returns `null` if the file does not exist yet — the caller
 * (typically `ensureSelfDevice`) will then generate one.
 *
 * Throws on corrupt file. We never auto-regenerate a corrupt self-device
 * because doing so would silently change the device's signing identity and
 * invalidate any device-record signatures already on disk.
 */
export function loadSelfDevice(ottieHome: string, logger?: pino.Logger): SelfDeviceBundle | null {
  const log = logger?.child({ module: "self-device" });
  const filePath = selfDeviceFilePath(ottieHome);
  if (!existsSync(filePath)) {
    return null;
  }
  const raw = readFileSync(filePath, "utf8");
  const stored = SelfDeviceSchema.parse(JSON.parse(raw));
  const signPublicKey = importEd25519PublicKey(stored.signPublicKeyB64);
  const signPrivateKey = importEd25519PrivateKey(stored.signPrivateKeyB64, stored.signPublicKeyB64);
  log?.info({ filePath, deviceId: stored.deviceId }, "Loaded self-device keypair");
  return { stored, signPublicKey, signPrivateKey };
}

/**
 * Generates a fresh Ed25519 keypair for this device and writes it to
 * `$OTTIE_HOME/identity/self-device.json` with mode 0o600.
 *
 * Throws if a self-device file already exists at that path.
 */
export function createSelfDevice(
  ottieHome: string,
  deviceId: string,
  logger?: pino.Logger,
): SelfDeviceBundle {
  const log = logger?.child({ module: "self-device" });
  const filePath = selfDeviceFilePath(ottieHome);
  if (existsSync(filePath)) {
    throw new Error(`Refusing to overwrite existing self-device at ${filePath}`);
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signPublicKeyB64 = exportEd25519PublicKey(publicKey);
  const signPrivateKeyB64 = exportEd25519PrivateKey(privateKey);

  const stored: StoredSelfDevice = {
    v: 1,
    deviceId,
    signPublicKeyB64,
    signPrivateKeyB64,
  };

  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });

  log?.info({ filePath, deviceId }, "Created self-device keypair");
  return { stored, signPublicKey: publicKey, signPrivateKey: privateKey };
}

/**
 * Phase 2.e/2: write a `StoredSelfDevice` from the keypair that the
 * device-link sender produced locally. Used only on the new-device side
 * — fresh installs go through `createSelfDevice` instead.
 *
 * Refuses to overwrite an existing self-device file. Pairing this with
 * the same guard on root-identity ensures the adopt-from-link flow can
 * only run on a truly fresh `$OTTIE_HOME`.
 */
export function writeImportedSelfDevice(
  ottieHome: string,
  stored: StoredSelfDevice,
  logger?: pino.Logger,
): SelfDeviceBundle {
  const log = logger?.child({ module: "self-device" });
  const filePath = selfDeviceFilePath(ottieHome);
  if (existsSync(filePath)) {
    throw new Error(
      `Refusing to overwrite existing self-device at ${filePath} — adopt-from-link should only run on a fresh install`,
    );
  }

  const validated = SelfDeviceSchema.parse(stored);
  const signPublicKey = importEd25519PublicKey(validated.signPublicKeyB64);
  const signPrivateKey = importEd25519PrivateKey(
    validated.signPrivateKeyB64,
    validated.signPublicKeyB64,
  );

  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });

  log?.info({ filePath, deviceId: validated.deviceId }, "Imported self-device keypair");
  return { stored: validated, signPublicKey, signPrivateKey };
}

// ----- Ed25519 raw-byte (JWK base64url) serialization ---------------------
// Mirrors the helpers in root-identity-store.ts. Kept duplicated rather than
// shared because the layering between identity-types / device-types is meant
// to stay a tree, not a graph — Phase 1 files don't import Phase 2 files.

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
