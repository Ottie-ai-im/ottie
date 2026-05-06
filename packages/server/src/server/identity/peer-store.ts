import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type pino from "pino";

import { PeerListSchema, type StoredPeer, type StoredPeerList } from "./peer-types.js";

const IDENTITY_DIRNAME = "identity";
const PEER_LIST_FILENAME = "peers.json";

export function peerListFilePath(ottieHome: string): string {
  return path.join(ottieHome, IDENTITY_DIRNAME, PEER_LIST_FILENAME);
}

/**
 * Returns the existing peer list if `peers.json` exists and parses cleanly.
 * Returns `null` if the file is missing — the caller (`IdentityService`)
 * treats null as "fresh install, no friends yet".
 *
 * Throws on corrupt or schema-invalid file. We never auto-regenerate the
 * peer list: re-creating it from scratch would silently un-friend all
 * existing peers, which a user might not notice until they try to send a
 * message later.
 */
export function loadPeerList(ottieHome: string, logger?: pino.Logger): StoredPeerList | null {
  const log = logger?.child({ module: "peer-store" });
  const filePath = peerListFilePath(ottieHome);
  if (!existsSync(filePath)) {
    return null;
  }
  const raw = readFileSync(filePath, "utf8");
  const stored = PeerListSchema.parse(JSON.parse(raw));
  log?.info({ filePath, peerCount: stored.peers.length }, "Loaded peer list");
  return stored;
}

/**
 * Atomically write the peer list. mkdir(0o700) + write(0o600) match the
 * device-list-store conventions. Not literally atomic (no temp-and-
 * rename) because writes are infrequent + single-writer.
 */
export function savePeerList(ottieHome: string, list: StoredPeerList, logger?: pino.Logger): void {
  const log = logger?.child({ module: "peer-store" });
  const filePath = peerListFilePath(ottieHome);
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
  log?.info({ filePath, peerCount: list.peers.length }, "Saved peer list");
}

/**
 * Insert-or-update by `peerRootSignPublicKeyB64`. Returns the updated
 * list (a new object — callers should treat the input as immutable).
 *
 * Idempotent: re-pairing an existing friend overwrites the entry but
 * doesn't duplicate. Status updates (Phase 5 block/unblock) flow
 * through this same path.
 */
export function upsertPeer(list: StoredPeerList, peer: StoredPeer): StoredPeerList {
  const next = list.peers.filter(
    (p) => p.peerRootSignPublicKeyB64 !== peer.peerRootSignPublicKeyB64,
  );
  next.push(peer);
  return { v: 1, peers: next };
}

/**
 * Remove a peer by root pubkey. Phase 5's "remove friend" flow uses this;
 * Phase 3.a never calls it but having the helper here keeps the
 * persistence surface narrow.
 */
export function removePeer(list: StoredPeerList, peerRootSignPublicKeyB64: string): StoredPeerList {
  return {
    v: 1,
    peers: list.peers.filter((p) => p.peerRootSignPublicKeyB64 !== peerRootSignPublicKeyB64),
  };
}
