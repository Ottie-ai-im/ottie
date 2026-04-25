import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { acquirePidLock, getPidLockInfo, releasePidLock, updatePidLock } from "./pid-lock.js";

describe("pid-lock ownership", () => {
  test("writes and releases lock for explicit owner pid", async () => {
    const ottieHome = await mkdtemp(join(tmpdir(), "ottie-pid-lock-owner-"));
    const ownerPid = process.pid + 10_000;

    try {
      await (
        acquirePidLock as unknown as (
          home: string,
          sockPath: string | null,
          options: { ownerPid: number },
        ) => Promise<void>
      )(ottieHome, null, { ownerPid });

      const lock = await getPidLockInfo(ottieHome);
      expect(lock?.pid).toBe(ownerPid);
      expect(lock?.listen).toBeNull();

      await (
        updatePidLock as unknown as (
          home: string,
          patch: { listen: string },
          options: { ownerPid: number },
        ) => Promise<void>
      )(ottieHome, { listen: "127.0.0.1:6767" }, { ownerPid });

      const updatedLock = await getPidLockInfo(ottieHome);
      expect(updatedLock?.listen).toBe("127.0.0.1:6767");

      await (
        releasePidLock as unknown as (home: string, options: { ownerPid: number }) => Promise<void>
      )(ottieHome, { ownerPid: ownerPid + 1 });
      const lockAfterWrongOwnerRelease = await getPidLockInfo(ottieHome);
      expect(lockAfterWrongOwnerRelease?.pid).toBe(ownerPid);

      await (
        releasePidLock as unknown as (home: string, options: { ownerPid: number }) => Promise<void>
      )(ottieHome, { ownerPid });
      const lockAfterOwnerRelease = await getPidLockInfo(ottieHome);
      expect(lockAfterOwnerRelease).toBeNull();
    } finally {
      await rm(ottieHome, { recursive: true, force: true });
    }
  });
});
