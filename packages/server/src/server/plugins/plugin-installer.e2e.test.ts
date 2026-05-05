import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import pino from "pino";

import { PluginManager } from "./plugin-manager.js";
import { PluginInstaller } from "./plugin-installer.js";
import { BUILTIN_PLUGIN_CATALOG, setRemoteCatalogEntries } from "./plugin-catalog.js";

const silentLogger = pino({ level: "silent" });

async function makeOttieHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "ottie-plugin-e2e-"));
}

interface MockEndpoints {
  releaseJson: () => Response;
  assetBinary: () => Response;
}

function mockGithubApi(endpoints: MockEndpoints, repo: string, assetName: string): void {
  vi.stubGlobal("fetch", async (input: string | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === `https://api.github.com/repos/${repo}/releases/latest`) {
      return endpoints.releaseJson();
    }
    if (url.endsWith(assetName)) {
      return endpoints.assetBinary();
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
}

async function makeFakeAppZip(bundleName: string): Promise<Buffer> {
  const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ottie-plugin-fixture-"));
  const appDir = path.join(stagingRoot, `${bundleName}.app`);
  const contentsDir = path.join(appDir, "Contents", "MacOS");
  await fs.mkdir(contentsDir, { recursive: true });
  await fs.writeFile(path.join(contentsDir, bundleName), "fake binary");
  await fs.writeFile(
    path.join(appDir, "Contents", "Info.plist"),
    '<?xml version="1.0"?><plist></plist>',
  );

  const zipPath = path.join(stagingRoot, `${bundleName}.zip`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("zip", ["-q", "-r", zipPath, `${bundleName}.app`], { cwd: stagingRoot });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`zip exited ${code}`));
      else resolve();
    });
  });
  const buf = await fs.readFile(zipPath);
  await fs.rm(stagingRoot, { recursive: true, force: true });
  return buf;
}

describe("PluginInstaller end-to-end (mock GitHub)", () => {
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
    vi.unstubAllGlobals();
    await manager.destroy().catch(() => {});
    await fs.rm(ottieHome, { recursive: true, force: true });
    setRemoteCatalogEntries([]);
  });

  it("installs a remote catalog plugin: signature → bridge → companion .app", async () => {
    if (process.platform !== "darwin") return;

    // Replace the catalog with a fully-controlled remote entry.
    const installRoot = path.join(ottieHome, "Applications", "FakeApp.app");
    setRemoteCatalogEntries([
      {
        id: "fake-companion",
        name: "Fake Companion",
        description: "Test companion plugin",
        author: "test",
        platforms: ["darwin"],
        bridgeSource:
          "export function activate(api){api.logger.info('hi')}\nexport function deactivate(){}",
        companionApp: {
          bundleName: "FakeApp",
          preferredInstallPath: installRoot,
          githubReleasesRepo: "test-org/fake-app",
          releaseBrowserUrl: "https://github.com/test-org/fake-app/releases/latest",
          assetExtensions: [".zip"],
        },
      },
    ]);

    const fakeAppZip = await makeFakeAppZip("FakeApp");
    mockGithubApi(
      {
        releaseJson: () =>
          new Response(
            JSON.stringify({
              tag_name: "v1.0.0",
              assets: [
                {
                  name: "FakeApp.zip",
                  browser_download_url: "https://example.invalid/FakeApp.zip",
                },
              ],
            }),
            { status: 200 },
          ),
        assetBinary: () =>
          new Response(fakeAppZip, {
            status: 200,
            headers: { "content-length": String(fakeAppZip.length) },
          }),
      },
      "test-org/fake-app",
      "FakeApp.zip",
    );

    const phases: string[] = [];
    const result = await installer.install("fake-companion", (event) => {
      phases.push(event.phase);
    });

    expect(result.success).toBe(true);
    expect(result.bridgeInstalled).toBe(true);
    expect(result.companionApp?.state).toBe("installed");
    expect(result.companionApp?.path).toBe(installRoot);
    expect(phases).toContain("writing_bridge");
    expect(phases).toContain("downloading");
    expect(phases).toContain("installing_app");
    expect(phases).toContain("done");

    // Bridge files actually on disk
    const bridgeFile = await fs.readFile(
      path.join(ottieHome, "plugins", "fake-companion", "index.js"),
      "utf-8",
    );
    expect(bridgeFile).toContain("activate");

    // Companion .app actually on disk
    const stat = await fs.stat(installRoot);
    expect(stat.isDirectory()).toBe(true);
    const appBinary = await fs.readFile(path.join(installRoot, "Contents", "MacOS", "FakeApp"));
    expect(appBinary.toString()).toBe("fake binary");
  }, 30_000);

  it("falls back to manual install when GitHub releases API is unreachable", async () => {
    if (process.platform !== "darwin") return;

    const installRoot = path.join(ottieHome, "Applications", "OtherApp.app");
    setRemoteCatalogEntries([
      {
        id: "fake-no-release",
        name: "Fake No Release",
        description: "Companion that has no release asset",
        author: "test",
        platforms: ["darwin"],
        bridgeSource: "export function activate(){}",
        companionApp: {
          bundleName: "OtherApp",
          preferredInstallPath: installRoot,
          githubReleasesRepo: "test-org/no-release",
          releaseBrowserUrl: "https://github.com/test-org/no-release/releases/latest",
          assetExtensions: [".dmg"],
        },
      },
    ]);

    vi.stubGlobal(
      "fetch",
      async (): Promise<Response> => new Response("not found", { status: 404 }),
    );

    const result = await installer.install("fake-no-release");
    expect(result.success).toBe(true);
    expect(result.bridgeInstalled).toBe(true);
    expect(result.companionApp?.state).toBe("manual");
    expect(result.companionApp?.releaseBrowserUrl).toBe(
      "https://github.com/test-org/no-release/releases/latest",
    );
  }, 30_000);

  it("preserves built-in catalog entries even when remote entries are added", async () => {
    setRemoteCatalogEntries([]);
    const list = await installer.list();
    const builtinIds = new Set(BUILTIN_PLUGIN_CATALOG.map((e) => e.id));
    for (const builtinId of builtinIds) {
      expect(list.some((e) => e.id === builtinId)).toBe(true);
    }
  });
});
