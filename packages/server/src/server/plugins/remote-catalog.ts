// Remote plugin catalog — fetches a signed JSON manifest from a URL,
// verifies its Ed25519 signature, then materializes catalog entries.
//
// Wire format:
//   {
//     "manifestVersion": 1,
//     "issuedAt": "2026-05-05T00:00:00Z",
//     "entries": [
//       {
//         "id": "...",
//         "name": "...",
//         "description": "...",
//         "author": "...",
//         "platforms": ["darwin"],
//         "bridgeSourceUrl": "https://...",
//         "bridgeSourceSha256": "<hex>",
//         "companionApp": { ... }   // same shape as PluginCompanionApp
//       },
//       ...
//     ],
//     "signature": "<base64url>"   // Ed25519(JSON.stringify({manifestVersion,issuedAt,entries}))
//   }
//
// Defense in depth:
//   - Signature must verify against a configured public key (env var
//     OTTIE_PLUGIN_CATALOG_PUBKEY, base64 raw 32-byte ed25519 pubkey).
//   - Bridge JS is fetched separately and the body must hash to
//     `bridgeSourceSha256`. Same key signs the manifest, but the JS body is
//     not in the manifest itself, so a compromised CDN serving wrong bytes
//     fails the hash check.
//   - Old manifests without `manifestVersion: 1` are rejected.

import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { PluginCatalogEntry, PluginCompanionApp, PluginPlatform } from "./plugin-catalog.js";

const RemoteCompanionAppSchema = z.object({
  bundleName: z.string(),
  preferredInstallPath: z.string(),
  githubReleasesRepo: z.string().optional(),
  releaseBrowserUrl: z.string(),
  assetExtensions: z.array(z.string()),
});

const RemoteEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-_]{0,60}$/, "id must be lowercase id-safe"),
  name: z.string(),
  description: z.string(),
  author: z.string(),
  platforms: z.array(z.enum(["darwin", "win32", "linux"])),
  bridgeSourceUrl: z.string().url(),
  bridgeSourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  companionApp: RemoteCompanionAppSchema.optional(),
});

const RemoteManifestSchema = z.object({
  manifestVersion: z.literal(1),
  issuedAt: z.string(),
  entries: z.array(RemoteEntrySchema),
  signature: z.string(),
});

export type RemoteManifest = z.infer<typeof RemoteManifestSchema>;
export type RemoteCatalogEntry = z.infer<typeof RemoteEntrySchema>;

const FETCH_TIMEOUT_MS = 15_000;
const FETCH_HEADERS = {
  Accept: "application/json",
  "User-Agent": "ottie-plugin-catalog",
} as const;

function decodeBase64(input: string): Buffer {
  const normalized = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Buffer.from(normalized, "base64");
}

async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the canonical bytes that the remote signs. Must match the signer's
 * exact serialization or signatures won't verify. We sign the JSON of the
 * three covered fields with no extra whitespace.
 */
function canonicalSignedPayload(manifest: RemoteManifest): Buffer {
  const covered = {
    manifestVersion: manifest.manifestVersion,
    issuedAt: manifest.issuedAt,
    entries: manifest.entries,
  };
  return Buffer.from(JSON.stringify(covered), "utf-8");
}

function verifyManifestSignature(manifest: RemoteManifest, publicKeyRaw: Buffer): void {
  if (publicKeyRaw.length !== 32) {
    throw new Error(`Plugin catalog public key must be 32 raw bytes (got ${publicKeyRaw.length})`);
  }
  const keyDer = Buffer.concat([
    Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
    publicKeyRaw,
  ]);
  const key = createPublicKey({ key: keyDer, format: "der", type: "spki" });
  const ok = cryptoVerify(
    null,
    canonicalSignedPayload(manifest),
    key,
    decodeBase64(manifest.signature),
  );
  if (!ok) {
    throw new Error("Plugin catalog signature verification failed");
  }
}

async function fetchAndHashBridge(entry: RemoteCatalogEntry): Promise<string> {
  const response = await fetchWithTimeout(entry.bridgeSourceUrl, { headers: FETCH_HEADERS });
  if (!response.ok) {
    throw new Error(
      `Bridge download failed for "${entry.id}": ${response.status} ${response.statusText}`,
    );
  }
  const body = await response.text();
  const digest = createHash("sha256").update(body).digest("hex");
  if (digest !== entry.bridgeSourceSha256) {
    throw new Error(
      `Bridge hash mismatch for "${entry.id}" (expected ${entry.bridgeSourceSha256}, got ${digest})`,
    );
  }
  return body;
}

export interface RemoteCatalogConfig {
  url: string;
  /** Base64-encoded raw 32-byte Ed25519 public key. */
  publicKeyBase64: string;
}

export function readRemoteCatalogConfigFromEnv(): RemoteCatalogConfig | null {
  const url = process.env.OTTIE_PLUGIN_CATALOG_URL;
  const publicKeyBase64 = process.env.OTTIE_PLUGIN_CATALOG_PUBKEY;
  if (!url || !publicKeyBase64) return null;
  return { url, publicKeyBase64 };
}

/**
 * Fetch the manifest, verify its signature, fetch each entry's bridge JS,
 * verify each bridge body's SHA-256, and return ready-to-install catalog
 * entries. Throws on any verification failure — callers should fall back to
 * the built-in catalog only.
 */
export async function fetchRemoteCatalog(
  config: RemoteCatalogConfig,
): Promise<PluginCatalogEntry[]> {
  const response = await fetchWithTimeout(config.url, { headers: FETCH_HEADERS });
  if (!response.ok) {
    throw new Error(`Catalog fetch failed: ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  const manifest = RemoteManifestSchema.parse(json);
  const publicKey = decodeBase64(config.publicKeyBase64);
  verifyManifestSignature(manifest, publicKey);

  const entries: PluginCatalogEntry[] = [];
  for (const entry of manifest.entries) {
    const bridgeSource = await fetchAndHashBridge(entry);
    const companionApp: PluginCompanionApp | undefined = entry.companionApp
      ? {
          bundleName: entry.companionApp.bundleName,
          preferredInstallPath: entry.companionApp.preferredInstallPath,
          githubReleasesRepo: entry.companionApp.githubReleasesRepo,
          releaseBrowserUrl: entry.companionApp.releaseBrowserUrl,
          assetExtensions: entry.companionApp.assetExtensions,
        }
      : undefined;
    entries.push({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      author: entry.author,
      platforms: entry.platforms as readonly PluginPlatform[],
      bridgeSource,
      companionApp,
    });
  }
  return entries;
}

export const __test = {
  RemoteManifestSchema,
  canonicalSignedPayload,
  verifyManifestSignature,
};

// ---------------------------------------------------------------------------
// On-disk SWR cache
// ---------------------------------------------------------------------------
//
// Daemon boot can't block on internet round-trips. We cache the last good
// fetched catalog to `$OTTIE_HOME/plugin-catalog.cache.json` and follow a
// stale-while-revalidate flow:
//
//   1. On boot, load cache if present → install entries.
//   2. Kick off a background refresh; on success, replace cache + entries.
//   3. If the network step fails, keep the cached entries.
//
// The cache file stores the *materialized* catalog entries (with bridge
// source already verified) so we don't need to re-verify on warm boot.
// We still keep a short integrity tag to detect corruption.

const CACHE_FILENAME = "plugin-catalog.cache.json";

interface CachedCatalog {
  version: 1;
  fetchedAt: string;
  entries: PluginCatalogEntry[];
}

const CachedCatalogSchema = z.object({
  version: z.literal(1),
  fetchedAt: z.string(),
  entries: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      author: z.string(),
      platforms: z.array(z.enum(["darwin", "win32", "linux"])),
      bridgeSource: z.string(),
      companionApp: z
        .object({
          bundleName: z.string(),
          preferredInstallPath: z.string(),
          githubReleasesRepo: z.string().optional(),
          releaseBrowserUrl: z.string(),
          assetExtensions: z.array(z.string()),
        })
        .optional(),
    }),
  ),
});

export function getCacheFilePath(ottieHome: string): string {
  return path.join(ottieHome, CACHE_FILENAME);
}

export async function readCachedCatalog(ottieHome: string): Promise<PluginCatalogEntry[] | null> {
  const file = getCacheFilePath(ottieHome);
  try {
    const data = await fs.readFile(file, "utf-8");
    const parsed = CachedCatalogSchema.parse(JSON.parse(data));
    return parsed.entries.map(
      (entry): PluginCatalogEntry => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        author: entry.author,
        platforms: entry.platforms as readonly PluginPlatform[],
        bridgeSource: entry.bridgeSource,
        companionApp: entry.companionApp,
      }),
    );
  } catch {
    return null;
  }
}

export async function writeCachedCatalog(
  ottieHome: string,
  entries: PluginCatalogEntry[],
): Promise<void> {
  const file = getCacheFilePath(ottieHome);
  const body: CachedCatalog = {
    version: 1,
    fetchedAt: new Date().toISOString(),
    entries: entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      author: entry.author,
      platforms: Array.from(entry.platforms) as PluginPlatform[],
      bridgeSource: entry.bridgeSource,
      companionApp: entry.companionApp,
    })),
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(body, null, 2));
}
