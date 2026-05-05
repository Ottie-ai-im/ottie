import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { Logger } from "pino";
import type { SessionOutboundMessage } from "../messages.js";
import type { OttiePluginAPI } from "./plugin-api.js";

interface ActivePlugin {
  module: {
    activate?: (api: OttiePluginAPI) => Promise<void> | void;
    deactivate?: () => Promise<void> | void;
  };
}

export class PluginManager {
  private readonly pluginsDir: string;
  private readonly api: OttiePluginAPI;
  private readonly activePlugins = new Map<string, ActivePlugin>();

  constructor(
    private readonly ottieHome: string,
    private readonly logger: Logger,
  ) {
    this.pluginsDir = path.join(this.ottieHome, "plugins");
    this.api = {
      logger: this.logger.child({ module: "plugin-api" }),
      events: new EventEmitter(),
    };
  }

  public async initialize(): Promise<void> {
    await fs.mkdir(this.pluginsDir, { recursive: true });
    await this.loadAll();
  }

  public async destroy(): Promise<void> {
    for (const [name] of this.activePlugins) {
      await this.unloadPlugin(name).catch((err) => {
        this.logger.error({ err, plugin: name }, "Error deactivating plugin");
      });
    }
    this.activePlugins.clear();
  }

  /**
   * (Re)load a single plugin by directory name. Used by the installer to
   * activate freshly installed bridges without restarting the daemon.
   */
  public async loadPlugin(name: string, pluginDir?: string): Promise<void> {
    const dir = pluginDir ?? path.join(this.pluginsDir, name);
    if (this.activePlugins.has(name)) {
      await this.unloadPlugin(name).catch(() => {});
    }
    await this.loadFromDirectory(name, dir);
  }

  /**
   * Deactivate a plugin and forget it. The on-disk files are *not* removed —
   * the installer handles that separately so this method is safe to call
   * during reload.
   */
  public async unloadPlugin(name: string): Promise<void> {
    const active = this.activePlugins.get(name);
    if (!active) return;
    try {
      if (typeof active.module.deactivate === "function") {
        await active.module.deactivate();
      }
    } finally {
      this.activePlugins.delete(name);
    }
  }

  private async loadAll(): Promise<void> {
    try {
      const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await this.loadFromDirectory(entry.name, path.join(this.pluginsDir, entry.name));
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.error({ err: error }, "Failed to read plugins directory");
      }
    }
  }

  private async loadFromDirectory(name: string, pluginDir: string): Promise<void> {
    try {
      const pkgPath = path.join(pluginDir, "package.json");
      const pkgData = await fs.readFile(pkgPath, "utf-8").catch(() => null);
      if (!pkgData) return;

      const pkg = JSON.parse(pkgData) as { main?: string };
      const mainFile = pkg.main || "index.js";
      const entryPath = path.join(pluginDir, mainFile);

      // Cache-bust each load so reinstall actually picks up the new code.
      const moduleUrl = `${new URL(`file://${entryPath}`).href}?reload=${Date.now()}`;
      const pluginModule = (await import(moduleUrl)) as ActivePlugin["module"];

      if (typeof pluginModule.activate === "function") {
        await pluginModule.activate(this.api);
        this.activePlugins.set(name, { module: pluginModule });
        this.logger.info({ plugin: name }, "Activated plugin");
      } else {
        this.logger.warn({ plugin: name }, "Plugin missing activate() export");
      }
    } catch (error) {
      this.logger.error({ err: error, plugin: name }, "Failed to load plugin");
      throw error;
    }
  }

  public dispatchMessage(message: SessionOutboundMessage): void {
    try {
      this.api.events.emit("message", message);
      if (message && message.type) {
        this.api.events.emit(message.type, (message as { payload?: unknown }).payload);
      }
    } catch (error) {
      this.logger.error({ err: error, type: message?.type }, "Error dispatching plugin message");
    }
  }
}
