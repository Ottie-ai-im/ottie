import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Logger } from "pino";

import type { PluginCatalogEntry, PluginPlatform } from "./plugin-catalog.js";
import { findCatalogEntry, PLUGIN_CATALOG } from "./plugin-catalog.js";
import type { PluginManager } from "./plugin-manager.js";

export type PluginInstallStatus = "installed" | "not_installed" | "incompatible";

export type PluginInstallProgressPhase =
  | "writing_bridge"
  | "fetching_release"
  | "downloading"
  | "extracting"
  | "installing_app"
  | "done";

export interface PluginInstallProgressEvent {
  pluginId: string;
  phase: PluginInstallProgressPhase;
  bytesLoaded?: number;
  bytesTotal?: number;
  note?: string;
}

export type PluginInstallProgressListener = (event: PluginInstallProgressEvent) => void;

export interface PluginCompanionAppInstall {
  bundleName: string;
  /** "installed" — `.app` exists at preferredInstallPath, ready to launch. */
  /** "manual" — auto-download didn't run / failed; user should download. */
  /** "skipped" — current platform doesn't support a companion app. */
  state: "installed" | "manual" | "skipped";
  /** Where the .app is/should be on disk (macOS only, undefined if skipped). */
  path?: string;
  /** GitHub release page to visit for manual install when state === "manual". */
  releaseBrowserUrl?: string;
  /** Last error if auto-download was attempted and failed. */
  error?: string;
}

export interface PluginListEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  platforms: readonly PluginPlatform[];
  status: PluginInstallStatus;
  companionApp?: {
    bundleName: string;
    state: "installed" | "manual" | "skipped" | "not_installed";
    path?: string;
    releaseBrowserUrl?: string;
  };
}

export interface PluginInstallResult {
  success: boolean;
  pluginId: string;
  bridgeInstalled: boolean;
  companionApp?: PluginCompanionAppInstall;
  error?: string;
}

export interface PluginUninstallResult {
  success: boolean;
  pluginId: string;
  error?: string;
}

export interface PluginLaunchResult {
  success: boolean;
  pluginId: string;
  error?: string;
}

const CURRENT_PLATFORM = process.platform as PluginPlatform | NodeJS.Platform;

function isCompatiblePlatform(entry: PluginCatalogEntry): boolean {
  return (entry.platforms as readonly string[]).includes(CURRENT_PLATFORM);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function rmrf(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true });
}

async function downloadToFile(
  url: string,
  destination: string,
  onProgress?: (loaded: number, total: number | undefined) => void,
): Promise<void> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "ottie-plugin-installer" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  const lengthHeader = response.headers.get("content-length");
  const total = lengthHeader ? Number.parseInt(lengthHeader, 10) : undefined;

  const handle = await fs.open(destination, "w");
  try {
    const reader = response.body.getReader();
    let loaded = 0;
    let lastReport = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        await handle.write(value);
        loaded += value.byteLength;
        // Cap callback frequency at ~10/s to keep WS chatter reasonable.
        const now = Date.now();
        if (onProgress && now - lastReport > 100) {
          onProgress(loaded, total);
          lastReport = now;
        }
      }
    }
    if (onProgress) onProgress(loaded, total);
  } finally {
    await handle.close();
  }
}

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}
interface GithubRelease {
  tag_name?: string;
  assets?: GithubReleaseAsset[];
}

async function fetchLatestReleaseAsset(
  repo: string,
  preferredExtensions: readonly string[],
): Promise<GithubReleaseAsset | null> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "ottie-plugin-installer",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub releases fetch failed: ${response.status}`);
  }
  const release = (await response.json()) as GithubRelease;
  const assets = release.assets ?? [];
  for (const ext of preferredExtensions) {
    const match = assets.find((a) => a.name.toLowerCase().endsWith(ext.toLowerCase()));
    if (match) return match;
  }
  return null;
}

function runCommand(
  command: string,
  args: readonly string[],
  options?: { cwd?: string; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args as string[], { cwd: options?.cwd });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timer: NodeJS.Timeout | null = null;
    if (options?.timeoutMs) {
      timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error(`${command} timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
    }
    proc.stdout?.on("data", (c: Buffer) => stdoutChunks.push(c));
    proc.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));
    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      if (code !== 0) {
        reject(new Error(`${command} exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.cp(src, dest, { recursive: true, force: true });
}

/**
 * Install a macOS .app from a downloaded asset (.dmg or .zip).
 * Returns the resulting .app path on success.
 */
async function installMacAppFromAsset(params: {
  assetPath: string;
  bundleName: string;
  destinationPath: string;
  logger: Logger;
  onPhase?: (phase: "extracting" | "installing_app", note?: string) => void;
}): Promise<string> {
  const { assetPath, bundleName, destinationPath, logger, onPhase } = params;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ottie-plugin-"));
  try {
    onPhase?.("extracting");
    if (assetPath.toLowerCase().endsWith(".zip")) {
      await runCommand("unzip", ["-q", "-o", assetPath, "-d", tempRoot], { timeoutMs: 60_000 });
    } else if (assetPath.toLowerCase().endsWith(".dmg")) {
      // Mount the DMG, copy the .app out, then detach.
      const mountPoint = path.join(tempRoot, "mount");
      await fs.mkdir(mountPoint, { recursive: true });
      await runCommand(
        "hdiutil",
        ["attach", "-nobrowse", "-noautoopen", "-mountpoint", mountPoint, assetPath],
        { timeoutMs: 60_000 },
      );
      try {
        const entries = await fs.readdir(mountPoint);
        const appEntry = entries.find((e) => e.endsWith(".app"));
        if (!appEntry) {
          throw new Error(".dmg did not contain a .app bundle");
        }
        const stagedPath = path.join(tempRoot, appEntry);
        await copyDirectory(path.join(mountPoint, appEntry), stagedPath);
      } finally {
        await runCommand("hdiutil", ["detach", "-quiet", mountPoint], {
          timeoutMs: 30_000,
        }).catch((err) => {
          logger.warn({ err, mountPoint }, "Failed to detach DMG mount");
        });
      }
    } else {
      throw new Error(`Unsupported asset extension for ${assetPath}`);
    }

    const candidateNames = [`${bundleName}.app`];
    const tempEntries = await fs.readdir(tempRoot);
    const fallbackApp = tempEntries.find((e) => e.endsWith(".app"));
    const matchedName = candidateNames.find((n) => tempEntries.includes(n)) ?? fallbackApp ?? null;
    if (!matchedName) {
      throw new Error("Did not find a .app bundle inside the downloaded asset");
    }

    const stagedAppPath = path.join(tempRoot, matchedName);
    onPhase?.("installing_app", destinationPath);
    await rmrf(destinationPath);
    await copyDirectory(stagedAppPath, destinationPath);
    return destinationPath;
  } finally {
    await rmrf(tempRoot).catch(() => {});
  }
}

export class PluginInstaller {
  private readonly pluginsDir: string;

  constructor(
    private readonly ottieHome: string,
    private readonly logger: Logger,
    private readonly pluginManager: PluginManager,
  ) {
    this.pluginsDir = path.join(this.ottieHome, "plugins");
  }

  /**
   * Return the current state of every catalog entry. Entries whose
   * `platforms` don't include the current OS are flagged "incompatible" so
   * the UI can hide or disable them without filtering on the client.
   */
  async list(): Promise<PluginListEntry[]> {
    const entries: PluginListEntry[] = [];
    for (const entry of PLUGIN_CATALOG) {
      const compatible = isCompatiblePlatform(entry);
      const installedDir = path.join(this.pluginsDir, entry.id);
      const bridgeInstalled = await pathExists(path.join(installedDir, "package.json"));
      let status: PluginInstallStatus;
      if (!compatible) {
        status = "incompatible";
      } else if (bridgeInstalled) {
        status = "installed";
      } else {
        status = "not_installed";
      }

      let companionApp: PluginListEntry["companionApp"];
      if (entry.companionApp && compatible) {
        const exists = await pathExists(entry.companionApp.preferredInstallPath);
        let companionState: "installed" | "manual" | "not_installed";
        if (exists) {
          companionState = "installed";
        } else if (bridgeInstalled) {
          companionState = "manual";
        } else {
          companionState = "not_installed";
        }
        companionApp = {
          bundleName: entry.companionApp.bundleName,
          state: companionState,
          path: exists ? entry.companionApp.preferredInstallPath : undefined,
          releaseBrowserUrl: entry.companionApp.releaseBrowserUrl,
        };
      } else if (entry.companionApp) {
        companionApp = {
          bundleName: entry.companionApp.bundleName,
          state: "skipped",
          releaseBrowserUrl: entry.companionApp.releaseBrowserUrl,
        };
      }

      entries.push({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        author: entry.author,
        platforms: entry.platforms,
        status,
        companionApp,
      });
    }
    return entries;
  }

  async install(pluginId: string): Promise<PluginInstallResult> {
    const entry = findCatalogEntry(pluginId);
    if (!entry) {
      return {
        success: false,
        pluginId,
        bridgeInstalled: false,
        error: `Unknown plugin "${pluginId}"`,
      };
    }
    if (!isCompatiblePlatform(entry)) {
      return {
        success: false,
        pluginId,
        bridgeInstalled: false,
        error: `Plugin "${pluginId}" is not supported on ${CURRENT_PLATFORM}`,
      };
    }

    const installedDir = path.join(this.pluginsDir, entry.id);
    try {
      await fs.mkdir(installedDir, { recursive: true });
      await fs.writeFile(
        path.join(installedDir, "package.json"),
        JSON.stringify(
          { name: entry.id, version: "1.0.0", main: "index.js", type: "module" },
          null,
          2,
        ),
      );
      await fs.writeFile(path.join(installedDir, "index.js"), entry.bridgeSource);
      this.logger.info({ pluginId }, "Plugin bridge installed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, pluginId, bridgeInstalled: false, error: message };
    }

    // Hot-load the freshly written bridge so the user doesn't have to
    // restart the daemon to start receiving events.
    await this.pluginManager
      .loadPlugin(entry.id, installedDir)
      .catch((err) => this.logger.warn({ err, pluginId }, "Hot-load failed; will load next boot"));

    let companionResult: PluginCompanionAppInstall | undefined;
    if (entry.companionApp) {
      companionResult = await this.installCompanionApp(entry);
    }

    return {
      success: true,
      pluginId,
      bridgeInstalled: true,
      companionApp: companionResult,
    };
  }

  async uninstall(pluginId: string): Promise<PluginUninstallResult> {
    const entry = findCatalogEntry(pluginId);
    if (!entry) {
      return { success: false, pluginId, error: `Unknown plugin "${pluginId}"` };
    }
    try {
      await this.pluginManager.unloadPlugin(entry.id).catch((err) => {
        this.logger.warn({ err, pluginId }, "Plugin deactivate threw on uninstall");
      });
      await rmrf(path.join(this.pluginsDir, entry.id));
      this.logger.info({ pluginId }, "Plugin uninstalled");
      return { success: true, pluginId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, pluginId, error: message };
    }
  }

  async launch(pluginId: string): Promise<PluginLaunchResult> {
    const entry = findCatalogEntry(pluginId);
    if (!entry) {
      return { success: false, pluginId, error: `Unknown plugin "${pluginId}"` };
    }
    const companion = entry.companionApp;
    if (!companion) {
      return {
        success: false,
        pluginId,
        error: `Plugin "${pluginId}" has no companion app to launch`,
      };
    }
    if (CURRENT_PLATFORM !== "darwin") {
      return {
        success: false,
        pluginId,
        error: `Companion app launch is currently macOS-only (got ${CURRENT_PLATFORM})`,
      };
    }
    const exists = await pathExists(companion.preferredInstallPath);
    if (!exists) {
      return {
        success: false,
        pluginId,
        error: `Companion app not found at ${companion.preferredInstallPath} — install it first`,
      };
    }
    try {
      await runCommand("open", ["-a", companion.preferredInstallPath], { timeoutMs: 15_000 });
      this.logger.info({ pluginId, app: companion.preferredInstallPath }, "Launched companion app");
      return { success: true, pluginId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, pluginId, error: message };
    }
  }

  private async installCompanionApp(entry: PluginCatalogEntry): Promise<PluginCompanionAppInstall> {
    const companion = entry.companionApp;
    if (!companion) {
      return { bundleName: "", state: "skipped" };
    }
    if (CURRENT_PLATFORM !== "darwin") {
      return { bundleName: companion.bundleName, state: "skipped" };
    }
    if (await pathExists(companion.preferredInstallPath)) {
      return {
        bundleName: companion.bundleName,
        state: "installed",
        path: companion.preferredInstallPath,
      };
    }
    if (!companion.githubReleasesRepo) {
      return {
        bundleName: companion.bundleName,
        state: "manual",
        releaseBrowserUrl: companion.releaseBrowserUrl,
      };
    }

    try {
      const asset = await fetchLatestReleaseAsset(
        companion.githubReleasesRepo,
        companion.assetExtensions,
      );
      if (!asset) {
        this.logger.info(
          { pluginId: entry.id, repo: companion.githubReleasesRepo },
          "No matching companion asset; falling back to manual",
        );
        return {
          bundleName: companion.bundleName,
          state: "manual",
          releaseBrowserUrl: companion.releaseBrowserUrl,
        };
      }

      const tempAssetPath = path.join(os.tmpdir(), `ottie-${entry.id}-${Date.now()}-${asset.name}`);
      await downloadToFile(asset.browser_download_url, tempAssetPath);
      try {
        const installed = await installMacAppFromAsset({
          assetPath: tempAssetPath,
          bundleName: companion.bundleName,
          destinationPath: companion.preferredInstallPath,
          logger: this.logger,
        });
        this.logger.info({ pluginId: entry.id, app: installed }, "Companion app installed");
        return { bundleName: companion.bundleName, state: "installed", path: installed };
      } finally {
        await fs.unlink(tempAssetPath).catch(() => {});
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { err, pluginId: entry.id },
        "Companion app auto-install failed; user can install manually",
      );
      return {
        bundleName: companion.bundleName,
        state: "manual",
        releaseBrowserUrl: companion.releaseBrowserUrl,
        error: message,
      };
    }
  }
}
