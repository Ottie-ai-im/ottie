import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { DeviceListEventStore, eventsFilePath } from "./device-list-event-store.js";
import type { DeviceListEvent } from "./device-list-event-types.js";

const SILENT_LOGGER = pino({ level: "silent" });

let home: string;
beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "ottie-event-store-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function makeFakeEvent(args: {
  kind?: "device-added" | "device-removed";
  sourceDeviceId: string;
  seq: number;
}): DeviceListEvent {
  if (args.kind === "device-removed") {
    return {
      v: 1,
      kind: "device-removed",
      seq: args.seq,
      sourceDeviceId: args.sourceDeviceId,
      emittedAt: new Date(1_700_000_000_000 + args.seq).toISOString(),
      removedDeviceId: "dev_X",
      signatureB64: "x".repeat(43),
    };
  }
  return {
    v: 1,
    kind: "device-added",
    seq: args.seq,
    sourceDeviceId: args.sourceDeviceId,
    emittedAt: new Date(1_700_000_000_000 + args.seq).toISOString(),
    device: {
      v: 1,
      deviceId: `dev_added_${args.seq}`,
      deviceLabel: "Added",
      role: "daemon",
      signPublicKeyB64: "y".repeat(43),
      authorizedAt: new Date(1_700_000_000_000).toISOString(),
      authorizationSignatureB64: "z".repeat(43),
    },
    signatureB64: "x".repeat(43),
  };
}

describe("DeviceListEventStore.loadOrCreate", () => {
  test("returns an empty store on a fresh home", () => {
    const store = DeviceListEventStore.loadOrCreate(home, SILENT_LOGGER);
    expect(store.list()).toHaveLength(0);
    expect(store.nextSelfSeq("dev_anything")).toBe(1);
    expect(store.lastSeenSeqBySource()).toEqual({});
  });

  test("reloads previously-appended events from disk", () => {
    const store1 = DeviceListEventStore.loadOrCreate(home, SILENT_LOGGER);
    store1.append(makeFakeEvent({ sourceDeviceId: "dev_A", seq: 1 }));
    store1.append(makeFakeEvent({ sourceDeviceId: "dev_A", seq: 2 }));
    store1.append(makeFakeEvent({ sourceDeviceId: "dev_B", seq: 1 }));

    const store2 = DeviceListEventStore.loadOrCreate(home, SILENT_LOGGER);
    expect(store2.list()).toHaveLength(3);
    expect(store2.nextSelfSeq("dev_A")).toBe(3);
    expect(store2.nextSelfSeq("dev_B")).toBe(2);
    expect(store2.nextSelfSeq("dev_NEW")).toBe(1);
    expect(store2.lastSeenSeqBySource()).toEqual({ dev_A: 2, dev_B: 1 });
  });

  test("file is written with mode 0o600 and identity dir 0o700", () => {
    const store = DeviceListEventStore.loadOrCreate(home, SILENT_LOGGER);
    store.append(makeFakeEvent({ sourceDeviceId: "dev_A", seq: 1 }));
    const filePath = eventsFilePath(home);
    const fs = require("node:fs") as typeof import("node:fs");
    const stat = fs.statSync(filePath);
    // mode bits — bottom 9 bits should be 0o600 = 384.
    expect(stat.mode & 0o777).toBe(0o600);
    const dirStat = fs.statSync(path.dirname(filePath));
    expect(dirStat.mode & 0o777).toBe(0o700);
  });
});

describe("DeviceListEventStore.append", () => {
  test("appends in order and persists to disk", () => {
    const store = DeviceListEventStore.loadOrCreate(home, SILENT_LOGGER);
    store.append(makeFakeEvent({ sourceDeviceId: "dev_A", seq: 1 }));
    store.append(makeFakeEvent({ sourceDeviceId: "dev_A", seq: 2 }));
    expect(store.list()).toHaveLength(2);
    expect(store.list()[0]?.seq).toBe(1);
    expect(store.list()[1]?.seq).toBe(2);
  });

  test("accepts mixed kinds and sources", () => {
    const store = DeviceListEventStore.loadOrCreate(home, SILENT_LOGGER);
    store.append(makeFakeEvent({ sourceDeviceId: "dev_A", seq: 1 }));
    store.append(makeFakeEvent({ kind: "device-removed", sourceDeviceId: "dev_B", seq: 1 }));
    store.append(makeFakeEvent({ sourceDeviceId: "dev_A", seq: 2 }));
    expect(store.list()).toHaveLength(3);
    expect(store.lastSeenSeqBySource()).toEqual({ dev_A: 2, dev_B: 1 });
  });
});

describe("DeviceListEventStore.nextSelfSeq + lastSeenSeqBySource", () => {
  test("nextSelfSeq is 1 for a never-seen source", () => {
    const store = DeviceListEventStore.loadOrCreate(home, SILENT_LOGGER);
    expect(store.nextSelfSeq("dev_X")).toBe(1);
  });

  test("nextSelfSeq is highest seq + 1 for a seen source", () => {
    const store = DeviceListEventStore.loadOrCreate(home, SILENT_LOGGER);
    store.append(makeFakeEvent({ sourceDeviceId: "dev_A", seq: 7 }));
    store.append(makeFakeEvent({ sourceDeviceId: "dev_A", seq: 3 }));
    expect(store.nextSelfSeq("dev_A")).toBe(8);
  });

  test("lastSeenSeqBySource returns a fresh object each call", () => {
    const store = DeviceListEventStore.loadOrCreate(home, SILENT_LOGGER);
    store.append(makeFakeEvent({ sourceDeviceId: "dev_A", seq: 1 }));
    const first = store.lastSeenSeqBySource();
    store.append(makeFakeEvent({ sourceDeviceId: "dev_A", seq: 2 }));
    const second = store.lastSeenSeqBySource();
    expect(first).toEqual({ dev_A: 1 });
    expect(second).toEqual({ dev_A: 2 });
    // Mutating one snapshot must not corrupt the other.
    first.dev_A = 999;
    expect(second.dev_A).toBe(2);
  });
});
