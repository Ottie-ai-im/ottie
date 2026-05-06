import { verify } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  buildAuthorizedDevice,
  deviceListFilePath,
  loadDeviceList,
  saveDeviceList,
} from "./device-list-store.js";
import { createRootIdentity } from "./root-identity-store.js";
import { deviceAuthorizationPayload } from "./device-types.js";
import type { StoredDeviceList } from "./device-types.js";

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "ottie-device-list-test-"));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("loadDeviceList / saveDeviceList", () => {
  test("returns null when no file exists", () => {
    expect(loadDeviceList(tmpHome)).toBeNull();
  });

  test("save then load roundtrips a list", () => {
    const root = createRootIdentity(tmpHome, "Wendell");
    const device = buildAuthorizedDevice({
      deviceId: "srv_abc",
      deviceLabel: "Wendell-MacBook",
      role: "daemon",
      signPublicKeyB64: "x".repeat(43),
      rootIdentity: root,
    });
    const list: StoredDeviceList = { v: 1, devices: [device] };
    saveDeviceList(tmpHome, list);

    const loaded = loadDeviceList(tmpHome);
    expect(loaded).toEqual(list);
  });

  test("throws on schema mismatch", () => {
    const filePath = deviceListFilePath(tmpHome);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({ devices: "not an array" }));
    expect(() => loadDeviceList(tmpHome)).toThrow();
  });
});

describe("buildAuthorizedDevice", () => {
  test("produces a valid Ed25519 signature that verifies under the root public key", () => {
    const root = createRootIdentity(tmpHome, "Alice");
    const device = buildAuthorizedDevice({
      deviceId: "srv_alice_1",
      deviceLabel: "Alice-laptop",
      role: "daemon",
      signPublicKeyB64: "y".repeat(43),
      rootIdentity: root,
    });

    // Reconstruct the canonical payload and the signature bytes.
    const payload = deviceAuthorizationPayload({
      deviceId: device.deviceId,
      signPublicKeyB64: device.signPublicKeyB64,
      role: device.role,
      authorizedAt: device.authorizedAt,
    });
    // Re-decode base64url → base64 → bytes for verify().
    const sigB64 = device.authorizationSignatureB64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = sigB64 + "=".repeat((4 - (sigB64.length % 4)) % 4);
    const signature = Buffer.from(padded, "base64");

    const ok = verify(null, Buffer.from(payload, "utf8"), root.signPublicKey, signature);
    expect(ok).toBe(true);
  });

  test("a foreign root key does not verify the signature", () => {
    const root = createRootIdentity(tmpHome, "Alice");
    const device = buildAuthorizedDevice({
      deviceId: "srv_alice_1",
      deviceLabel: "Alice-laptop",
      role: "daemon",
      signPublicKeyB64: "y".repeat(43),
      rootIdentity: root,
    });

    // Generate a different root identity in a separate temp dir.
    const otherHome = mkdtempSync(path.join(os.tmpdir(), "ottie-other-root-"));
    const otherRoot = createRootIdentity(otherHome, "Mallory");
    rmSync(otherHome, { recursive: true, force: true });

    const payload = deviceAuthorizationPayload({
      deviceId: device.deviceId,
      signPublicKeyB64: device.signPublicKeyB64,
      role: device.role,
      authorizedAt: device.authorizedAt,
    });
    const sigB64 = device.authorizationSignatureB64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = sigB64 + "=".repeat((4 - (sigB64.length % 4)) % 4);
    const signature = Buffer.from(padded, "base64");

    const ok = verify(null, Buffer.from(payload, "utf8"), otherRoot.signPublicKey, signature);
    expect(ok).toBe(false);
  });

  test("changing any field invalidates the signature", () => {
    const root = createRootIdentity(tmpHome, "Alice");
    const device = buildAuthorizedDevice({
      deviceId: "srv_alice_1",
      deviceLabel: "Alice-laptop",
      role: "daemon",
      signPublicKeyB64: "y".repeat(43),
      rootIdentity: root,
    });

    // Tamper with deviceId in the payload but keep the original signature.
    const tamperedPayload = deviceAuthorizationPayload({
      deviceId: "srv_attacker",
      signPublicKeyB64: device.signPublicKeyB64,
      role: device.role,
      authorizedAt: device.authorizedAt,
    });
    const sigB64 = device.authorizationSignatureB64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = sigB64 + "=".repeat((4 - (sigB64.length % 4)) % 4);
    const signature = Buffer.from(padded, "base64");

    const ok = verify(null, Buffer.from(tamperedPayload, "utf8"), root.signPublicKey, signature);
    expect(ok).toBe(false);
  });
});
