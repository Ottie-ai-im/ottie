import { sign, verify } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createSelfDevice, loadSelfDevice, selfDeviceFilePath } from "./self-device-store.js";

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "ottie-self-device-test-"));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("loadSelfDevice", () => {
  test("returns null when no file exists", () => {
    expect(loadSelfDevice(tmpHome)).toBeNull();
  });

  test("loads previously written self-device and reconstructs key objects", () => {
    const created = createSelfDevice(tmpHome, "srv_test_123");
    const loaded = loadSelfDevice(tmpHome);

    expect(loaded).not.toBeNull();
    expect(loaded?.stored).toEqual(created.stored);
    expect(loaded?.stored.deviceId).toBe("srv_test_123");
  });

  test("throws on malformed JSON", () => {
    const filePath = selfDeviceFilePath(tmpHome);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, "{not json");
    expect(() => loadSelfDevice(tmpHome)).toThrow();
  });

  test("throws on schema mismatch", () => {
    const filePath = selfDeviceFilePath(tmpHome);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({ wrong: "shape" }));
    expect(() => loadSelfDevice(tmpHome)).toThrow();
  });
});

describe("createSelfDevice", () => {
  test("generates a v:1 record with Ed25519 keys and the given deviceId", () => {
    const bundle = createSelfDevice(tmpHome, "srv_test_456");
    expect(bundle.stored.v).toBe(1);
    expect(bundle.stored.deviceId).toBe("srv_test_456");
    // base64url Ed25519 raw key is 43 chars.
    expect(bundle.stored.signPublicKeyB64).toHaveLength(43);
    expect(bundle.stored.signPrivateKeyB64).toHaveLength(43);
  });

  test("refuses to overwrite an existing self-device", () => {
    createSelfDevice(tmpHome, "srv_test_789");
    expect(() => createSelfDevice(tmpHome, "srv_test_789")).toThrow();
  });

  test("writes file with mode 0o600 (POSIX only)", () => {
    if (process.platform === "win32") return;
    createSelfDevice(tmpHome, "srv_test_perms");
    const mode = statSync(selfDeviceFilePath(tmpHome)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("each call produces a different keypair", () => {
    const a = createSelfDevice(tmpHome, "srv_a");
    rmSync(selfDeviceFilePath(tmpHome));
    const b = createSelfDevice(tmpHome, "srv_b");
    expect(a.stored.signPublicKeyB64).not.toBe(b.stored.signPublicKeyB64);
    expect(a.stored.signPrivateKeyB64).not.toBe(b.stored.signPrivateKeyB64);
  });
});

describe("roundtrip", () => {
  test("signature made by reconstructed private key verifies under reconstructed public key", () => {
    createSelfDevice(tmpHome, "srv_roundtrip");
    const loaded = loadSelfDevice(tmpHome);
    expect(loaded).not.toBeNull();

    const message = Buffer.from("device-bound message");
    const signature = sign(null, message, loaded!.signPrivateKey);
    const ok = verify(null, message, loaded!.signPublicKey, signature);
    expect(ok).toBe(true);
  });
});
