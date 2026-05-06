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
