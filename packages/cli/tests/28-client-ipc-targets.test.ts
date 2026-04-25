#!/usr/bin/env npx tsx

import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getDaemonHost,
  normalizeDaemonHost,
  resolveDaemonTarget,
  resolveDefaultDaemonHosts,
} from "../src/utils/client.js";
import { resolveCliVersion } from "../src/version.js";

console.log("=== CLI IPC Target Helpers ===\n");

{
  console.log("Test 1: unix hosts resolve to ws+unix URLs");
  const target = resolveDaemonTarget("unix:///tmp/ottie.sock");
  assert.deepStrictEqual(target, {
    type: "ipc",
    url: "ws+unix:///tmp/ottie.sock:/ws",
    socketPath: "/tmp/ottie.sock",
  });
  console.log("✓ unix hosts resolve to ws+unix URLs\n");
}

{
  console.log("Test 2: pipe hosts preserve the Node socketPath transport form");
  const target = resolveDaemonTarget("pipe://\\\\.\\pipe\\ottie-managed-test");
  assert.deepStrictEqual(target, {
    type: "ipc",
    url: "ws://localhost/ws",
    socketPath: "\\\\.\\pipe\\ottie-managed-test",
  });
  console.log("✓ pipe hosts preserve Node socketPath transport form\n");
}

{
  console.log("Test 3: local unix socket paths normalize into IPC daemon targets");
  assert.strictEqual(normalizeDaemonHost("/tmp/ottie.sock"), "unix:///tmp/ottie.sock");
  console.log("✓ local unix socket paths normalize into IPC daemon targets\n");
}

{
  console.log("Test 3b: Windows absolute paths are NOT treated as unix sockets");
  assert.strictEqual(normalizeDaemonHost("C:\\Users\\foo\\.ottie\\ottie.sock"), null);
  assert.strictEqual(normalizeDaemonHost("D:\\project\\socket"), null);
  console.log("✓ Windows absolute paths are not treated as unix sockets\n");
}

{
  console.log("Test 4: default host resolution tries local IPC first, then localhost fallback");
  const ottieHome = mkdtempSync(path.join(os.tmpdir(), "ottie-client-targets-"));
  try {
    mkdirSync(ottieHome, { recursive: true });
    writeFileSync(
      path.join(ottieHome, "ottie.pid"),
      JSON.stringify({ pid: process.pid, listen: "/tmp/ottie-from-pid.sock" }),
    );
    assert.deepStrictEqual(resolveDefaultDaemonHosts({ OTTIE_HOME: ottieHome }), [
      "unix:///tmp/ottie-from-pid.sock",
      "localhost:6767",
    ]);
    const previousHome = process.env.OTTIE_HOME;
    const previousHost = process.env.OTTIE_HOST;
    process.env.OTTIE_HOME = ottieHome;
    delete process.env.OTTIE_HOST;
    assert.strictEqual(getDaemonHost(), "unix:///tmp/ottie-from-pid.sock");
    if (previousHome === undefined) delete process.env.OTTIE_HOME;
    else process.env.OTTIE_HOME = previousHome;
    if (previousHost === undefined) delete process.env.OTTIE_HOST;
    else process.env.OTTIE_HOST = previousHost;
  } finally {
    rmSync(ottieHome, { recursive: true, force: true });
  }
  console.log("✓ default host resolution tries local IPC first, then localhost fallback\n");
}

{
  console.log("Test 5: configured TCP host is preserved before the localhost fallback");
  const ottieHome = mkdtempSync(path.join(os.tmpdir(), "ottie-client-targets-tcp-"));
  try {
    assert.deepStrictEqual(
      resolveDefaultDaemonHosts({
        OTTIE_HOME: ottieHome,
        OTTIE_LISTEN: "127.0.0.1:7777",
      }),
      ["127.0.0.1:7777", "localhost:6767"],
    );
  } finally {
    rmSync(ottieHome, { recursive: true, force: true });
  }
  console.log("✓ configured TCP host is preserved before the localhost fallback\n");
}

{
  console.log("Test 6: CLI app version resolves for daemon hello compatibility");
  assert.match(resolveCliVersion(), /^\d+\.\d+\.\d+/);
  console.log("✓ CLI app version resolves for daemon hello compatibility\n");
}

{
  console.log("Test 7: local IPC still takes priority over configured TCP hosts");
  const ottieHome = mkdtempSync(path.join(os.tmpdir(), "ottie-client-targets-order-"));
  try {
    mkdirSync(ottieHome, { recursive: true });
    writeFileSync(
      path.join(ottieHome, "ottie.pid"),
      JSON.stringify({ pid: process.pid, listen: "/tmp/ottie-priority.sock" }),
    );
    assert.deepStrictEqual(
      resolveDefaultDaemonHosts({
        OTTIE_HOME: ottieHome,
        OTTIE_LISTEN: "127.0.0.1:7777",
      }),
      ["unix:///tmp/ottie-priority.sock", "127.0.0.1:7777", "localhost:6767"],
    );
  } finally {
    rmSync(ottieHome, { recursive: true, force: true });
  }
  console.log("✓ local IPC still takes priority over configured TCP hosts\n");
}

console.log("=== All CLI IPC target tests passed ===");
