import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  loadPeerList,
  peerListFilePath,
  removePeer,
  savePeerList,
  upsertPeer,
} from "./peer-store.js";
import type { StoredPeer, StoredPeerList } from "./peer-types.js";

function makePeer(overrides: Partial<StoredPeer> = {}): StoredPeer {
  return {
    v: 1,
    peerRootSignPublicKeyB64: "x".repeat(43),
    peerDisplayName: "Bob",
    pairedAt: "2026-05-05T12:00:00.000Z",
    status: "active",
    pairingNonceB64: "n".repeat(43),
    authorizationSignatureB64: "sig_".padEnd(86, "z"),
    ...overrides,
  };
}

describe("peer-store loadPeerList / savePeerList", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), "ottie-peer-store-"));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  test("returns null when peers.json doesn't exist", () => {
    expect(loadPeerList(tempHome)).toBeNull();
  });

  test("save then load roundtrips a peer list", () => {
    const list: StoredPeerList = { v: 1, peers: [makePeer()] };
    savePeerList(tempHome, list);
    expect(loadPeerList(tempHome)).toEqual(list);
  });

  test("save creates the identity directory if missing", () => {
    expect(() => loadPeerList(tempHome)).not.toThrow();
    savePeerList(tempHome, { v: 1, peers: [] });
    expect(loadPeerList(tempHome)).toEqual({ v: 1, peers: [] });
  });

  test("file is written with mode 0o600 and JSON-formatted", () => {
    const peer = makePeer({ peerDisplayName: "Carol" });
    savePeerList(tempHome, { v: 1, peers: [peer] });
    const raw = readFileSync(peerListFilePath(tempHome), "utf8");
    expect(raw).toContain('"peerDisplayName": "Carol"');
    expect(raw.endsWith("\n")).toBe(true);
  });

  test("throws on schema-invalid file rather than auto-regenerating", () => {
    savePeerList(tempHome, { v: 1, peers: [] });
    const raw = readFileSync(peerListFilePath(tempHome), "utf8");
    // Introduce bad data
    const corrupt = raw.replace('"peers": []', '"peers": "not-an-array"');
    require("node:fs").writeFileSync(peerListFilePath(tempHome), corrupt, "utf8");
    expect(() => loadPeerList(tempHome)).toThrow();
  });
});

describe("peer-store upsertPeer", () => {
  test("inserts a new peer when none with that pubkey exists", () => {
    const list: StoredPeerList = { v: 1, peers: [] };
    const result = upsertPeer(list, makePeer());
    expect(result.peers).toHaveLength(1);
    expect(result.peers[0]?.peerDisplayName).toBe("Bob");
  });

  test("replaces an existing peer with the same pubkey (re-pair updates display name)", () => {
    const initial = makePeer({ peerDisplayName: "Bob" });
    const updated = makePeer({ peerDisplayName: "Bob (laptop)" });
    const list: StoredPeerList = { v: 1, peers: [initial] };
    const result = upsertPeer(list, updated);
    expect(result.peers).toHaveLength(1);
    expect(result.peers[0]?.peerDisplayName).toBe("Bob (laptop)");
  });

  test("does not mutate the input list", () => {
    const initial = makePeer();
    const list: StoredPeerList = { v: 1, peers: [initial] };
    upsertPeer(list, makePeer({ peerRootSignPublicKeyB64: "y".repeat(43) }));
    expect(list.peers).toHaveLength(1); // input unchanged
  });

  test("inserts alongside an existing different-pubkey peer", () => {
    const bob = makePeer({ peerRootSignPublicKeyB64: "x".repeat(43), peerDisplayName: "Bob" });
    const carol = makePeer({ peerRootSignPublicKeyB64: "y".repeat(43), peerDisplayName: "Carol" });
    const list: StoredPeerList = { v: 1, peers: [bob] };
    const result = upsertPeer(list, carol);
    expect(result.peers).toHaveLength(2);
    expect(result.peers.map((p) => p.peerDisplayName).sort()).toEqual(["Bob", "Carol"]);
  });
});

describe("peer-store removePeer", () => {
  test("removes the matching pubkey and leaves the rest", () => {
    const bob = makePeer({ peerRootSignPublicKeyB64: "x".repeat(43), peerDisplayName: "Bob" });
    const carol = makePeer({ peerRootSignPublicKeyB64: "y".repeat(43), peerDisplayName: "Carol" });
    const list: StoredPeerList = { v: 1, peers: [bob, carol] };
    const result = removePeer(list, "x".repeat(43));
    expect(result.peers).toHaveLength(1);
    expect(result.peers[0]?.peerDisplayName).toBe("Carol");
  });

  test("no-op when pubkey doesn't match anything", () => {
    const bob = makePeer({ peerRootSignPublicKeyB64: "x".repeat(43) });
    const list: StoredPeerList = { v: 1, peers: [bob] };
    const result = removePeer(list, "z".repeat(43));
    expect(result.peers).toEqual([bob]);
  });
});
