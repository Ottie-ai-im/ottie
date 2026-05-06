import { sign, verify } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  createRootIdentity,
  loadRootIdentity,
  rootIdentityFilePath,
} from "./root-identity-store.js";

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "ottie-identity-test-"));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("loadRootIdentity", () => {
  test("returns null when no identity file exists (first-run signal)", () => {
    expect(loadRootIdentity(tmpHome)).toBeNull();
  });

  test("loads previously written identity and reconstructs key objects", () => {
    const created = createRootIdentity(tmpHome, "Wendell");
    const loaded = loadRootIdentity(tmpHome);

    expect(loaded).not.toBeNull();
    expect(loaded?.stored).toEqual(created.stored);
    expect(loaded?.stored.displayName).toBe("Wendell");
  });

  test("throws when identity file is malformed JSON", () => {
    const filePath = rootIdentityFilePath(tmpHome);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, "{not json");

    expect(() => loadRootIdentity(tmpHome)).toThrow();
  });

  test("throws when identity file is valid JSON but fails schema", () => {
    const filePath = rootIdentityFilePath(tmpHome);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({ wrong: "shape" }));

    expect(() => loadRootIdentity(tmpHome)).toThrow();
  });
});

describe("createRootIdentity", () => {
  test("generates a v:1 identity with Ed25519 keys and the given display name", () => {
    const bundle = createRootIdentity(tmpHome, "Wendell");

    expect(bundle.stored.v).toBe(1);
    expect(bundle.stored.displayName).toBe("Wendell");
    // base64url-encoded Ed25519 raw key is 43 chars (32 bytes, no padding).
    expect(bundle.stored.signPublicKeyB64).toHaveLength(43);
    expect(bundle.stored.signPrivateKeyB64).toHaveLength(43);
    expect(new Date(bundle.stored.createdAt).toString()).not.toBe("Invalid Date");
  });

  test("trims whitespace from displayName", () => {
    const bundle = createRootIdentity(tmpHome, "  Wendell  ");
    expect(bundle.stored.displayName).toBe("Wendell");
  });

  test("rejects empty displayName", () => {
    expect(() => createRootIdentity(tmpHome, "")).toThrow();
    expect(() => createRootIdentity(tmpHome, "   ")).toThrow();
  });

  test("rejects displayName longer than 64 characters", () => {
    const longName = "a".repeat(65);
    expect(() => createRootIdentity(tmpHome, longName)).toThrow();
  });

  test("refuses to overwrite an existing identity", () => {
    createRootIdentity(tmpHome, "Wendell");
    expect(() => createRootIdentity(tmpHome, "OtherUser")).toThrow();
  });

  test("writes the identity file with mode 0o600 (POSIX only)", () => {
    if (process.platform === "win32") return;
    createRootIdentity(tmpHome, "Wendell");
    const filePath = rootIdentityFilePath(tmpHome);
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("each call generates a different keypair", () => {
    const a = createRootIdentity(tmpHome, "A");
    rmSync(rootIdentityFilePath(tmpHome));
    const b = createRootIdentity(tmpHome, "B");
    expect(a.stored.signPublicKeyB64).not.toBe(b.stored.signPublicKeyB64);
    expect(a.stored.signPrivateKeyB64).not.toBe(b.stored.signPrivateKeyB64);
  });
});

describe("roundtrip", () => {
  test("public key recovered from disk verifies signatures made by the corresponding private key", () => {
    createRootIdentity(tmpHome, "Wendell");
    const loaded = loadRootIdentity(tmpHome);
    expect(loaded).not.toBeNull();

    const message = Buffer.from("hello world");
    const signature = sign(null, message, loaded!.signPrivateKey);
    const isValid = verify(null, message, loaded!.signPublicKey, signature);
    expect(isValid).toBe(true);
  });

  test("a foreign signature does not verify against this identity's public key", () => {
    createRootIdentity(tmpHome, "Wendell");
    const loaded = loadRootIdentity(tmpHome);
    expect(loaded).not.toBeNull();

    // Sign with a freshly-generated unrelated key.
    const message = Buffer.from("hello world");
    const fakeBundle = createRootIdentity(
      mkdtempSync(path.join(os.tmpdir(), "ottie-identity-foreign-")),
      "Foreign",
    );
    const foreignSig = sign(null, message, fakeBundle.signPrivateKey);

    const isValid = verify(null, message, loaded!.signPublicKey, foreignSig);
    expect(isValid).toBe(false);
  });
});
