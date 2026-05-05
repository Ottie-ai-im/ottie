import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";

import {
  fetchRemoteCatalog,
  readRemoteCatalogConfigFromEnv,
  __test,
  type RemoteManifest,
} from "./remote-catalog.js";

interface KeyPair {
  publicKeyBase64: string;
  privateKeyDer: Buffer;
}

function generateTestKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // Strip the SPKI header to get the raw 32-byte key.
  const spki = publicKey.export({ format: "der", type: "spki" });
  const raw = spki.subarray(spki.length - 32);
  return {
    publicKeyBase64: Buffer.from(raw).toString("base64"),
    privateKeyDer: privateKey.export({ format: "der", type: "pkcs8" }) as Buffer,
  };
}

function signManifest(
  privateKeyDer: Buffer,
  partial: Omit<RemoteManifest, "signature">,
): RemoteManifest {
  const payload = __test.canonicalSignedPayload({ ...partial, signature: "" });
  const sig = cryptoSign(null, payload, {
    key: privateKeyDer,
    format: "der",
    type: "pkcs8",
  });
  return { ...partial, signature: sig.toString("base64") };
}

interface ManifestFixture {
  manifest: RemoteManifest;
  bridgeBody: string;
  bridgeSha256: string;
  publicKeyBase64: string;
  privateKeyDer: Buffer;
}

function makeFixture(): ManifestFixture {
  const keys = generateTestKeyPair();
  const bridgeBody = "export function activate(api){api.logger.info('hi')}";
  const bridgeSha256 = createHash("sha256").update(bridgeBody).digest("hex");
  const partial: Omit<RemoteManifest, "signature"> = {
    manifestVersion: 1,
    issuedAt: "2026-05-05T00:00:00Z",
    entries: [
      {
        id: "test-plugin",
        name: "Test Plugin",
        description: "A plugin used in tests",
        author: "test",
        platforms: ["darwin", "linux", "win32"],
        bridgeSourceUrl: "https://example.invalid/bridge.js",
        bridgeSourceSha256: bridgeSha256,
      },
    ],
  };
  const manifest = signManifest(keys.privateKeyDer, partial);
  return {
    manifest,
    bridgeBody,
    bridgeSha256,
    publicKeyBase64: keys.publicKeyBase64,
    privateKeyDer: keys.privateKeyDer,
  };
}

function mockFetch(handlers: Record<string, () => Response>): void {
  vi.stubGlobal("fetch", async (url: string | URL): Promise<Response> => {
    const key = typeof url === "string" ? url : url.toString();
    const handler = handlers[key];
    if (!handler) {
      throw new Error(`Unexpected fetch ${key}`);
    }
    return handler();
  });
}

describe("fetchRemoteCatalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns entries when signature + bridge hash both verify", async () => {
    const fx = makeFixture();
    mockFetch({
      "https://example.invalid/manifest.json": () =>
        new Response(JSON.stringify(fx.manifest), { status: 200 }),
      "https://example.invalid/bridge.js": () => new Response(fx.bridgeBody, { status: 200 }),
    });
    const entries = await fetchRemoteCatalog({
      url: "https://example.invalid/manifest.json",
      publicKeyBase64: fx.publicKeyBase64,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("test-plugin");
    expect(entries[0]?.bridgeSource).toBe(fx.bridgeBody);
  });

  it("rejects manifests signed with the wrong key", async () => {
    const fx = makeFixture();
    const otherKeys = generateTestKeyPair();
    mockFetch({
      "https://example.invalid/manifest.json": () =>
        new Response(JSON.stringify(fx.manifest), { status: 200 }),
    });
    await expect(
      fetchRemoteCatalog({
        url: "https://example.invalid/manifest.json",
        publicKeyBase64: otherKeys.publicKeyBase64,
      }),
    ).rejects.toThrow(/signature/i);
  });

  it("rejects bridge JS that doesn't match the declared sha256", async () => {
    const fx = makeFixture();
    mockFetch({
      "https://example.invalid/manifest.json": () =>
        new Response(JSON.stringify(fx.manifest), { status: 200 }),
      "https://example.invalid/bridge.js": () =>
        new Response("// tampered bridge", { status: 200 }),
    });
    await expect(
      fetchRemoteCatalog({
        url: "https://example.invalid/manifest.json",
        publicKeyBase64: fx.publicKeyBase64,
      }),
    ).rejects.toThrow(/hash mismatch/i);
  });

  it("rejects unknown manifest versions", async () => {
    const fx = makeFixture();
    const tampered = { ...fx.manifest, manifestVersion: 2 };
    mockFetch({
      "https://example.invalid/manifest.json": () =>
        new Response(JSON.stringify(tampered), { status: 200 }),
    });
    await expect(
      fetchRemoteCatalog({
        url: "https://example.invalid/manifest.json",
        publicKeyBase64: fx.publicKeyBase64,
      }),
    ).rejects.toThrow();
  });

  it("rejects manifests with mutated entries (signature breaks)", async () => {
    const fx = makeFixture();
    const tampered: RemoteManifest = {
      ...fx.manifest,
      entries: [
        {
          ...fx.manifest.entries[0]!,
          author: "attacker",
        },
      ],
    };
    mockFetch({
      "https://example.invalid/manifest.json": () =>
        new Response(JSON.stringify(tampered), { status: 200 }),
    });
    await expect(
      fetchRemoteCatalog({
        url: "https://example.invalid/manifest.json",
        publicKeyBase64: fx.publicKeyBase64,
      }),
    ).rejects.toThrow(/signature/i);
  });
});

describe("readRemoteCatalogConfigFromEnv", () => {
  beforeEach(() => {
    delete process.env.OTTIE_PLUGIN_CATALOG_URL;
    delete process.env.OTTIE_PLUGIN_CATALOG_PUBKEY;
  });

  it("returns null when neither env var is set", () => {
    expect(readRemoteCatalogConfigFromEnv()).toBeNull();
  });

  it("returns null when only one env var is set", () => {
    process.env.OTTIE_PLUGIN_CATALOG_URL = "https://example.invalid/manifest.json";
    expect(readRemoteCatalogConfigFromEnv()).toBeNull();
  });

  it("returns config when both env vars are set", () => {
    process.env.OTTIE_PLUGIN_CATALOG_URL = "https://example.invalid/manifest.json";
    process.env.OTTIE_PLUGIN_CATALOG_PUBKEY = "AAAA";
    expect(readRemoteCatalogConfigFromEnv()).toEqual({
      url: "https://example.invalid/manifest.json",
      publicKeyBase64: "AAAA",
    });
  });
});
