import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { Logger } from "pino";
import type { SessionOutboundMessage } from "../messages.js";
import type { OttiePluginAPI } from "./plugin-api.js";

export class PluginManager {
  private readonly pluginsDir: string;
  private readonly api: OttiePluginAPI;
  private readonly activePlugins = new Map<string, any>();

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
    await this.loadPlugins();
  }

  public async destroy(): Promise<void> {
    for (const [name, plugin] of this.activePlugins) {
      try {
        if (typeof plugin.deactivate === "function") {
          await plugin.deactivate();
        }
      } catch (error) {
        this.logger.error({ err: error, plugin: name }, "Error deactivating plugin");
      }
    }
    this.activePlugins.clear();
  }

  private async loadPlugins(): Promise<void> {
    try {
      const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await this.loadPlugin(entry.name, path.join(this.pluginsDir, entry.name));
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.error({ err: error }, "Failed to read plugins directory");
      }
    }
  }

  private async loadPlugin(name: string, pluginDir: string): Promise<void> {
    try {
      const pkgPath = path.join(pluginDir, "package.json");
      const pkgData = await fs.readFile(pkgPath, "utf-8").catch(() => null);
      if (!pkgData) return;

      const pkg = JSON.parse(pkgData);
      const mainFile = pkg.main || "index.js";
      const entryPath = path.join(pluginDir, mainFile);

      const moduleUrl = new URL(`file://${entryPath}`).href;
      const pluginModule = await import(moduleUrl);

      if (typeof pluginModule.activate === "function") {
        await pluginModule.activate(this.api);
        this.activePlugins.set(name, pluginModule);
        this.logger.info({ plugin: name }, "Activated plugin");
      } else {
        this.logger.warn({ plugin: name }, "Plugin missing activate() export");
      }
    } catch (error) {
      this.logger.error({ err: error, plugin: name }, "Failed to load plugin");
    }
  }

  public dispatchMessage(message: SessionOutboundMessage): void {
    try {
      this.api.events.emit("message", message);
      if (message && message.type) {
        this.api.events.emit(message.type, message.payload);
      }
    } catch (error) {
      this.logger.error({ err: error, type: message?.type }, "Error dispatching plugin message");
    }
  }
}
