import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";

import { PluginManager } from "./plugin-manager.js";
import { PluginInstaller } from "./plugin-installer.js";
import { PLUGIN_CATALOG } from "./plugin-catalog.js";

const silentLogger = pino({ level: "silent" });

async function makeOttieHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "ottie-plugin-test-"));
}

describe("PluginInstaller", () => {
  let ottieHome: string;
  let manager: PluginManager;
  let installer: PluginInstaller;

  beforeEach(async () => {
    ottieHome = await makeOttieHome();
    manager = new PluginManager(ottieHome, silentLogger);
    await manager.initialize();
    installer = new PluginInstaller(ottieHome, silentLogger, manager);
  });
  afterEach(async () => {
    await manager.destroy().catch(() => {});
    await fs.rm(ottieHome, { recursive: true, force: true });
  });

  it("lists every catalog entry with a status", async () => {
    const list = await installer.list();
    expect(list).toHaveLength(PLUGIN_CATALOG.length);
    for (const entry of list) {
      expect(entry.status).toBeDefined();
      expect(["installed", "not_installed", "incompatible"]).toContain(entry.status);
    }
  });

  it("rejects an unknown plugin id on install", async () => {
    const result = await installer.install("does-not-exist");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown/);
  });

  it("writes the bridge files when the platform is supported", async () => {
    const compatible = PLUGIN_CATALOG.find((e) =>
      (e.platforms as readonly string[]).includes(process.platform),
    );
    if (!compatible) return;

    const result = await installer.install(compatible.id);
    expect(result.bridgeInstalled).toBe(true);
    expect(result.success).toBe(true);

    const dir = path.join(ottieHome, "plugins", compatible.id);
    const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf-8"));
    expect(pkg.name).toBe(compatible.id);
    expect(pkg.main).toBe("index.js");

    const bridge = await fs.readFile(path.join(dir, "index.js"), "utf-8");
    expect(bridge).toContain("export function activate");
  });

  it("removes bridge files on uninstall", async () => {
    const compatible = PLUGIN_CATALOG.find((e) =>
      (e.platforms as readonly string[]).includes(process.platform),
    );
    if (!compatible) return;

    await installer.install(compatible.id);
    const dir = path.join(ottieHome, "plugins", compatible.id);
    expect(
      await fs
        .stat(dir)
        .then(() => true)
        .catch(() => false),
    ).toBe(true);

    const result = await installer.uninstall(compatible.id);
    expect(result.success).toBe(true);
    expect(
      await fs
        .stat(dir)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });

  it("flags status as installed once the bridge is on disk", async () => {
    const compatible = PLUGIN_CATALOG.find((e) =>
      (e.platforms as readonly string[]).includes(process.platform),
    );
    if (!compatible) return;

    await installer.install(compatible.id);
    const list = await installer.list();
    const entry = list.find((e) => e.id === compatible.id);
    expect(entry?.status).toBe("installed");
  });

  it("refuses to launch a plugin whose companion app is missing", async () => {
    const compatible = PLUGIN_CATALOG.find(
      (e) =>
        (e.platforms as readonly string[]).includes(process.platform) && e.companionApp != null,
    );
    if (!compatible || process.platform !== "darwin") return;

    await installer.install(compatible.id);
    // Most CI / dev environments won't have CodeIsland.app installed —
    // launch should fail-fast with a readable error rather than spawn `open`.
    const companionPath = compatible.companionApp!.preferredInstallPath;
    const exists = await fs
      .access(companionPath)
      .then(() => true)
      .catch(() => false);
    if (exists) return;

    const result = await installer.launch(compatible.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found|install/i);
  });
});
