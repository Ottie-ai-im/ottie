import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { IdentityService } from "./identity-service.js";
import { createRootIdentity, rootIdentityFilePath } from "./root-identity-store.js";

const SILENT_LOGGER = pino({ level: "silent" });

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "ottie-identity-svc-test-"));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("IdentityService — first run (no identity file)", () => {
  test("getState() reports 'uninitialized'", () => {
    const svc = new IdentityService({ ottieHome: tmpHome, logger: SILENT_LOGGER });
    expect(svc.getState().kind).toBe("uninitialized");
  });

  test("requireBundle() throws when uninitialized", () => {
    const svc = new IdentityService({ ottieHome: tmpHome, logger: SILENT_LOGGER });
    expect(() => svc.requireBundle()).toThrow();
  });

  test("initialize() transitions to 'loaded' and returns the bundle", () => {
    const svc = new IdentityService({ ottieHome: tmpHome, logger: SILENT_LOGGER });
    const bundle = svc.initialize("Wendell");

    expect(svc.getState().kind).toBe("loaded");
    expect(svc.requireBundle().stored.displayName).toBe("Wendell");
    expect(svc.requireBundle().stored).toEqual(bundle.stored);
  });

  test("initialize() persists to disk so a fresh IdentityService picks it up", () => {
    new IdentityService({ ottieHome: tmpHome, logger: SILENT_LOGGER }).initialize("Wendell");

    const reloaded = new IdentityService({ ottieHome: tmpHome, logger: SILENT_LOGGER });
    expect(reloaded.getState().kind).toBe("loaded");
    expect(reloaded.requireBundle().stored.displayName).toBe("Wendell");
  });
});

describe("IdentityService — existing valid identity", () => {
  test("constructor loads it; getState() is 'loaded'", () => {
    const created = createRootIdentity(tmpHome, "Wendell");
    const svc = new IdentityService({ ottieHome: tmpHome, logger: SILENT_LOGGER });

    const state = svc.getState();
    expect(state.kind).toBe("loaded");
    if (state.kind === "loaded") {
      expect(state.bundle.stored).toEqual(created.stored);
    }
  });

  test("initialize() throws when already loaded", () => {
    createRootIdentity(tmpHome, "Wendell");
    const svc = new IdentityService({ ottieHome: tmpHome, logger: SILENT_LOGGER });

    expect(() => svc.initialize("Other")).toThrow(/loaded/);
  });
});

describe("IdentityService — corrupt identity file", () => {
  function writeCorruptIdentity() {
    const filePath = rootIdentityFilePath(tmpHome);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, "{not valid json");
  }

  test("getState() reports 'load-failed' without crashing", () => {
    writeCorruptIdentity();
    const svc = new IdentityService({ ottieHome: tmpHome, logger: SILENT_LOGGER });

    const state = svc.getState();
    expect(state.kind).toBe("load-failed");
    if (state.kind === "load-failed") {
      expect(state.error).toBeInstanceOf(Error);
    }
  });

  test("requireBundle() throws when load-failed", () => {
    writeCorruptIdentity();
    const svc = new IdentityService({ ottieHome: tmpHome, logger: SILENT_LOGGER });
    expect(() => svc.requireBundle()).toThrow();
  });

  test("initialize() refuses to overwrite a load-failed file", () => {
    writeCorruptIdentity();
    const svc = new IdentityService({ ottieHome: tmpHome, logger: SILENT_LOGGER });
    expect(() => svc.initialize("Wendell")).toThrow(/load-failed/);
  });
});

describe("IdentityService — Phase 2.a self-device + device list", () => {
  test("without selfDeviceContext, getSelfDevice() is null and getDeviceList() is empty", () => {
    const svc = new IdentityService({ ottieHome: tmpHome, logger: SILENT_LOGGER });
    svc.initialize("Wendell");
    expect(svc.getSelfDevice()).toBeNull();
    expect(svc.getDeviceList()).toEqual([]);
  });

  test("with selfDeviceContext, initialize() also creates self-device + device list", () => {
    const svc = new IdentityService({
      ottieHome: tmpHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_test_1", deviceLabel: "Test-MacBook" },
    });
    svc.initialize("Wendell");

    const selfDevice = svc.getSelfDevice();
    expect(selfDevice).not.toBeNull();
    expect(selfDevice?.deviceId).toBe("srv_test_1");
    expect(selfDevice?.deviceLabel).toBe("Test-MacBook");
    expect(selfDevice?.role).toBe("daemon");
    expect(selfDevice?.signPublicKeyB64).toHaveLength(43);
    expect(selfDevice?.authorizationSignatureB64).toBeTruthy();

    const list = svc.getDeviceList();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(selfDevice);
  });

  test("on existing identity without self-device, the constructor migrates in place", () => {
    // Seed: create root identity but leave devices.json + self-device.json absent.
    createRootIdentity(tmpHome, "Wendell");

    const svc = new IdentityService({
      ottieHome: tmpHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_migrate", deviceLabel: "Migrated-Mac" },
    });

    expect(svc.getState().kind).toBe("loaded");
    expect(svc.getSelfDevice()?.deviceId).toBe("srv_migrate");
    expect(svc.getDeviceList()).toHaveLength(1);
  });

  test("a fresh IdentityService on the same home reloads the persisted self-device", () => {
    const first = new IdentityService({
      ottieHome: tmpHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_persist", deviceLabel: "Persist-Mac" },
    });
    first.initialize("Wendell");
    const originalKey = first.getSelfDevice()?.signPublicKeyB64;
    expect(originalKey).toBeTruthy();

    const reloaded = new IdentityService({
      ottieHome: tmpHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_persist", deviceLabel: "Persist-Mac" },
    });
    expect(reloaded.getSelfDevice()?.signPublicKeyB64).toBe(originalKey);
    expect(reloaded.getDeviceList()).toHaveLength(1);
  });

  test("constructor with selfDeviceContext but uninitialized identity does NOT create self-device", () => {
    const svc = new IdentityService({
      ottieHome: tmpHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_uninit", deviceLabel: "Uninit" },
    });
    expect(svc.getState().kind).toBe("uninitialized");
    expect(svc.getSelfDevice()).toBeNull();
    expect(svc.getDeviceList()).toEqual([]);
  });
});

describe("IdentityService.adoptIdentityFromLink — Phase 2.e/2", () => {
  function buildAdoptionInput() {
    // Generate keys the same way the OLD device would after approving:
    // root identity (Alice's) + a signed device record + a peer-list
    // snapshot. We don't go through the relay here — adoptIdentityFrom
    // Link is the persistence step alone.
    const aliceHome = mkdtempSync(path.join(os.tmpdir(), "ottie-alice-old-"));
    const aliceRoot = createRootIdentity(aliceHome, "Alice");
    rmSync(aliceHome, { recursive: true, force: true });

    // Bob's local device keypair (the new device).
    const bobSigningKey = (() => {
      const { generateKeyPairSync } = require("node:crypto") as typeof import("node:crypto");
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const pub = (publicKey.export({ format: "jwk" }) as { x: string }).x;
      const priv = (privateKey.export({ format: "jwk" }) as { d: string }).d;
      return { pub, priv };
    })();

    // Sign Bob's device with Alice's root.
    const { sign } = require("node:crypto") as typeof import("node:crypto");
    const authorizedAt = new Date(1_700_000_000_000).toISOString();
    const payload = [
      "ottie-device-auth-v1",
      "dev_bob_phone",
      bobSigningKey.pub,
      "client",
      authorizedAt,
    ].join("\n");
    const signature = sign(null, Buffer.from(payload, "utf8"), aliceRoot.signPrivateKey);
    const authorizationSignatureB64 = signature
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    const signedDevice = {
      v: 1 as const,
      deviceId: "dev_bob_phone",
      deviceLabel: "Bob's Phone",
      role: "client" as const,
      signPublicKeyB64: bobSigningKey.pub,
      authorizedAt,
      authorizationSignatureB64,
    };

    return {
      rootIdentity: aliceRoot.stored,
      signedDevice,
      peerDevices: [signedDevice],
      signPrivateKeyB64: bobSigningKey.priv,
    };
  }

  test("writes root.json + self-device.json + devices.json on a fresh home", () => {
    const svc = new IdentityService({
      ottieHome: tmpHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_bob", deviceLabel: "Bob's Phone" },
    });
    expect(svc.getState().kind).toBe("uninitialized");

    const input = buildAdoptionInput();
    svc.adoptIdentityFromLink(input);

    expect(svc.getState().kind).toBe("loaded");
    expect(svc.requireBundle().stored.displayName).toBe(input.rootIdentity.displayName);
    expect(svc.getDeviceList()).toHaveLength(1);
    expect(svc.getDeviceList()[0]?.deviceId).toBe("dev_bob_phone");
  });

  test("a fresh IdentityService on the same home picks the adopted identity up from disk", () => {
    const svc = new IdentityService({
      ottieHome: tmpHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_bob", deviceLabel: "Bob's Phone" },
    });
    const input = buildAdoptionInput();
    svc.adoptIdentityFromLink(input);

    const reloaded = new IdentityService({
      ottieHome: tmpHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_bob", deviceLabel: "Bob's Phone" },
    });
    expect(reloaded.getState().kind).toBe("loaded");
    expect(reloaded.requireBundle().stored).toEqual(input.rootIdentity);
    expect(reloaded.getDeviceList()).toHaveLength(1);
    expect(reloaded.getDeviceList()[0]?.deviceId).toBe("dev_bob_phone");
  });

  test("throws if the daemon is already initialized — adoption only runs on a fresh home", () => {
    const svc = new IdentityService({
      ottieHome: tmpHome,
      logger: SILENT_LOGGER,
      selfDeviceContext: { serverId: "srv_existing", deviceLabel: "Already Mine" },
    });
    svc.initialize("Existing");

    const input = buildAdoptionInput();
    expect(() => svc.adoptIdentityFromLink(input)).toThrow(/already initialized|loaded/i);

    // Existing identity must be untouched.
    expect(svc.requireBundle().stored.displayName).toBe("Existing");
  });
});
