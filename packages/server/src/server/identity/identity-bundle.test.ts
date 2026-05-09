import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { saveDeviceList } from "./device-list-store.js";
import { IdentityService } from "./identity-service.js";
import { readIdentityExportBundle, identityHomeHasContent } from "./identity-bundle.js";
import { savePeerList } from "./peer-store.js";
import { rootIdentityFilePath } from "./root-identity-store.js";
import { selfDeviceFilePath } from "./self-device-store.js";

const SILENT_LOGGER = pino({ level: "silent" });

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "ottie-identity-bundle-test-"));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("readIdentityExportBundle", () => {
  test("returns null on a fresh daemon with no identity", () => {
    expect(readIdentityExportBundle(tmpHome, { logger: SILENT_LOGGER })).toBeNull();
  });

  test("captures root + selfDevice + devices + peers when present", () => {
    const svc = new IdentityService({
      ottieHome: tmpHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv-test-1", deviceLabel: "Test Daemon" },
    });
    svc.initialize("Wendell");

    // Drop a synthetic peer so the bundle exercises the peers branch.
    savePeerList(
      tmpHome,
      {
        v: 1,
        peers: [
          {
            v: 1,
            peerRootSignPublicKeyB64: "x".repeat(43),
            peerDisplayName: "Test Friend",
            pairedAt: new Date().toISOString(),
            status: "active",
            pairingNonceB64: "z".repeat(43),
            authorizationSignatureB64: "y".repeat(86),
          },
        ],
      },
      SILENT_LOGGER,
    );

    const bundle = readIdentityExportBundle(tmpHome, { logger: SILENT_LOGGER });
    expect(bundle).not.toBeNull();
    expect(bundle?.type).toBe("ottie-identity-export");
    expect(bundle?.rootIdentity.displayName).toBe("Wendell");
    expect(bundle?.selfDevice).not.toBeNull();
    expect(bundle?.devices?.devices.length).toBe(1);
    expect(bundle?.peers?.peers.length).toBe(1);
    expect(bundle?.peers?.peers[0]?.peerDisplayName).toBe("Test Friend");
  });
});

describe("identityHomeHasContent", () => {
  test("false on an empty home", () => {
    expect(identityHomeHasContent(tmpHome)).toBe(false);
  });

  test("true once root.json exists", () => {
    new IdentityService({ ottieHome: tmpHome, logger: SILENT_LOGGER }).initialize("Anyone");
    expect(identityHomeHasContent(tmpHome)).toBe(true);
  });
});

describe("end-to-end: export → wipe → import → identity restored", () => {
  test("a fresh daemon adopts the exported identity verbatim", () => {
    // (1) Source daemon writes a real identity with friend + device records.
    const sourceHome = tmpHome;
    const source = new IdentityService({
      ottieHome: sourceHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv-source", deviceLabel: "Source" },
    });
    source.initialize("Wendell");

    const samplePeer = {
      v: 1 as const,
      peerRootSignPublicKeyB64: "a".repeat(43),
      peerDisplayName: "Buddy",
      pairedAt: new Date().toISOString(),
      status: "active" as const,
      pairingNonceB64: "c".repeat(43),
      authorizationSignatureB64: "b".repeat(86),
    };
    savePeerList(sourceHome, { v: 1, peers: [samplePeer] }, SILENT_LOGGER);

    // (2) Read the export bundle the way the RPC does.
    const exported = readIdentityExportBundle(sourceHome, { logger: SILENT_LOGGER });
    expect(exported).not.toBeNull();
    if (!exported) throw new Error("unreachable");

    // (3) Spin up a new daemon home, simulate "I just installed Ottie".
    const targetHome = mkdtempSync(path.join(os.tmpdir(), "ottie-identity-bundle-target-"));
    try {
      const target = new IdentityService({
        ottieHome: targetHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv-target", deviceLabel: "Target" },
      });
      expect(target.getState().kind).toBe("uninitialized");

      // (4) Adopt the bundle.
      target.adoptIdentityFromImportBundle({
        rootIdentity: exported.rootIdentity,
        selfDevice: exported.selfDevice,
        devices: exported.devices,
        peers: exported.peers,
      });

      // (5) Verify state matches the source.
      expect(target.getState().kind).toBe("loaded");
      expect(target.requireBundle().stored.signPublicKeyB64).toBe(
        exported.rootIdentity.signPublicKeyB64,
      );
      expect(target.requireBundle().stored.displayName).toBe("Wendell");
      expect(target.getPeerList().length).toBe(1);
      expect(target.getPeerList()[0]?.peerDisplayName).toBe("Buddy");
      expect(target.getDeviceList().length).toBe(exported.devices?.devices.length ?? 0);

      // (6) Files actually landed on disk.
      expect(existsSync(rootIdentityFilePath(targetHome))).toBe(true);
      expect(existsSync(selfDeviceFilePath(targetHome))).toBe(true);

      // (7) A fresh service constructed from the target home re-reads the
      // imported identity — proves the import wasn't just an in-memory mutation.
      const reloaded = new IdentityService({
        ottieHome: targetHome,
        logger: SILENT_LOGGER,
        selfDeviceContext: { serverId: "srv-target", deviceLabel: "Target" },
      });
      expect(reloaded.getState().kind).toBe("loaded");
      expect(reloaded.requireBundle().stored.displayName).toBe("Wendell");
    } finally {
      rmSync(targetHome, { recursive: true, force: true });
    }
  });

  test("refuses to adopt onto a daemon that already has an identity", () => {
    const a = new IdentityService({ ottieHome: tmpHome, logger: SILENT_LOGGER });
    a.initialize("First");
    const exported = readIdentityExportBundle(tmpHome, { logger: SILENT_LOGGER });
    expect(exported).not.toBeNull();
    if (!exported) throw new Error("unreachable");

    expect(() =>
      a.adoptIdentityFromImportBundle({
        rootIdentity: exported.rootIdentity,
        selfDevice: exported.selfDevice,
        devices: exported.devices,
        peers: exported.peers,
      }),
    ).toThrow(/loaded/);
  });

  test("works without devices/peers/selfDevice when bundle is sparse", () => {
    const sparseBundle = {
      v: 1 as const,
      type: "ottie-identity-export" as const,
      exportedAt: new Date().toISOString(),
      rootIdentity: {
        v: 1 as const,
        signPublicKeyB64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        signPrivateKeyB64: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        displayName: "SparseUser",
        createdAt: new Date().toISOString(),
      },
      selfDevice: null,
      devices: null,
      peers: null,
    };

    // The placeholder keys above won't decode as real Ed25519, so we use a
    // freshly-minted root and then strip away the optional bits.
    const seed = new IdentityService({ ottieHome: tmpHome, logger: SILENT_LOGGER });
    seed.initialize("RealRoot");
    const exported = readIdentityExportBundle(tmpHome, { logger: SILENT_LOGGER })!;

    const targetHome = mkdtempSync(path.join(os.tmpdir(), "ottie-identity-bundle-sparse-"));
    try {
      const target = new IdentityService({ ottieHome: targetHome, logger: SILENT_LOGGER });
      target.adoptIdentityFromImportBundle({
        rootIdentity: exported.rootIdentity,
        selfDevice: null,
        devices: null,
        peers: null,
      });
      expect(target.getState().kind).toBe("loaded");
      expect(target.getPeerList().length).toBe(0);
    } finally {
      rmSync(targetHome, { recursive: true, force: true });
    }
    void sparseBundle; // satisfy lint about the schema-shape demonstration
    void saveDeviceList; // imported for type safety; unused in this path
  });
});
