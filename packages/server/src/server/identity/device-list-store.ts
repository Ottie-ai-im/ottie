import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { sign } from "node:crypto";
import path from "node:path";
import type pino from "pino";

import {
  DeviceListSchema,
  type StoredDevice,
  type StoredDeviceList,
  deviceAuthorizationPayload,
} from "./device-types.js";
import type { RootIdentityBundle } from "./root-identity-store.js";

const IDENTITY_DIRNAME = "identity";
const DEVICE_LIST_FILENAME = "devices.json";

export function deviceListFilePath(ottieHome: string): string {
  return path.join(ottieHome, IDENTITY_DIRNAME, DEVICE_LIST_FILENAME);
}

/**
 * Returns the existing device list if `devices.json` exists and parses
 * cleanly. Returns `null` if the file is missing — the caller is expected
 * to seed the list with the self-device entry on first boot.
 *
 * Throws on corrupt or schema-invalid file. We never auto-regenerate the
 * device list: it would silently revoke peer devices the user previously
 * linked.
 */
export function loadDeviceList(ottieHome: string, logger?: pino.Logger): StoredDeviceList | null {
  const log = logger?.child({ module: "device-list" });
  const filePath = deviceListFilePath(ottieHome);
  if (!existsSync(filePath)) {
    return null;
  }
  const raw = readFileSync(filePath, "utf8");
  const stored = DeviceListSchema.parse(JSON.parse(raw));
  log?.info({ filePath, deviceCount: stored.devices.length }, "Loaded device list");
  return stored;
}

/**
 * Atomically write the device list. mkdir(0o700) + write(0o600) match the
 * other identity-folder files. The write is not strictly atomic (no
 * temp-and-rename) because the file is small, single-writer (only this
 * daemon), and we don't have a concurrency story yet — Phase 2.f will
 * tighten this when device-list sync between devices arrives.
 */
export function saveDeviceList(
  ottieHome: string,
  list: StoredDeviceList,
  logger?: pino.Logger,
): void {
  const log = logger?.child({ module: "device-list" });
  const filePath = deviceListFilePath(ottieHome);
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
  log?.info({ filePath, deviceCount: list.devices.length }, "Saved device list");
}

/**
 * Builds a Device record and signs it with the root identity's private
 * signing key, producing the authorization-signature that proves the user
 * authorized this device. The canonical bytestring being signed is defined
 * in `device-types.ts`'s `deviceAuthorizationPayload` so verification
 * elsewhere stays in lockstep.
 */
export function buildAuthorizedDevice(input: {
  deviceId: string;
  deviceLabel: string;
  role: "daemon" | "client";
  signPublicKeyB64: string;
  authorizedAt?: string;
  rootIdentity: RootIdentityBundle;
}): StoredDevice {
  const authorizedAt = input.authorizedAt ?? new Date().toISOString();
  const payload = deviceAuthorizationPayload({
    deviceId: input.deviceId,
    signPublicKeyB64: input.signPublicKeyB64,
    role: input.role,
    authorizedAt,
  });
  const signature = sign(null, Buffer.from(payload, "utf8"), input.rootIdentity.signPrivateKey);
  // Match the wire format of root-identity Ed25519 outputs: 43-char base64url
  // (no padding). Node's `sign()` returns raw bytes; we re-encode for parity
  // with the JWK 'x'/'d' fields used elsewhere.
  const authorizationSignatureB64 = signature
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return {
    v: 1,
    deviceId: input.deviceId,
    deviceLabel: input.deviceLabel,
    role: input.role,
    signPublicKeyB64: input.signPublicKeyB64,
    authorizedAt,
    authorizationSignatureB64,
  };
}
