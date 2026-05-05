import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { Logger } from "pino";
import type { SessionOutboundMessage } from "../messages.js";

interface ActivePlugin {
  worker: Worker;
  ready: Promise<void>;
}

interface WorkerLogEnvelope {
  kind: "log";
  pluginId: string;
  level: "info" | "warn" | "error" | "debug";
  msg: string;
  fields?: Record<string, unknown>;
}

interface WorkerReadyEnvelope {
  kind: "ready";
  pluginId: string;
}

interface WorkerErrorEnvelope {
  kind: "error";
  pluginId: string;
  error: string;
}

type WorkerEnvelope = WorkerLogEnvelope | WorkerReadyEnvelope | WorkerErrorEnvelope;

const ACTIVATION_TIMEOUT_MS = 10_000;

/**
 * Resolve the runtime path for the worker entry. In dev (tsx watch) the
 * runtime ships as a `.ts` next to this file; in production builds esbuild
 * bundles the daemon and the worker path resolves to a `.js` sibling.
 */
function resolveWorkerEntry(): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  return path.join(dir, "plugin-worker-runtime.js");
}

/**
 * PluginManager — supervises one Worker thread per active plugin.
 *
 * Why workers instead of in-process `import()`:
 *   - A throwing or hanging plugin can't block the daemon main thread or the
 *     WS event loop.
 *   - `unloadPlugin` can `worker.terminate()` even if the plugin's
 *     `deactivate` is misbehaving.
 *   - Memory + open handles are scoped to the worker; reinstalls don't pile
 *     up via the ESM import cache.
 *
 * Notes on isolation: this is process-level isolation within Node, not a
 * security sandbox. Workers still share the daemon's filesystem and network
 * permissions. A real permission system would need Node's experimental
 * `--permission` flag or `vm.createContext`; out of scope here.
 */
export class PluginManager {
  private readonly pluginsDir: string;
  private readonly activePlugins = new Map<string, ActivePlugin>();
  private readonly workerEntry = resolveWorkerEntry();

  constructor(
    private readonly ottieHome: string,
    private readonly logger: Logger,
  ) {
    this.pluginsDir = path.join(this.ottieHome, "plugins");
  }

  public async initialize(): Promise<void> {
    await fs.mkdir(this.pluginsDir, { recursive: true });
    await this.loadAll();
  }

  public async destroy(): Promise<void> {
    const names = Array.from(this.activePlugins.keys());
    await Promise.all(
      names.map((name) =>
        this.unloadPlugin(name).catch((err) => {
          this.logger.error({ err, plugin: name }, "Error deactivating plugin");
        }),
      ),
    );
    this.activePlugins.clear();
  }

  public async loadPlugin(name: string, pluginDir?: string): Promise<void> {
    const dir = pluginDir ?? path.join(this.pluginsDir, name);
    if (this.activePlugins.has(name)) {
      await this.unloadPlugin(name).catch(() => {});
    }
    await this.spawnWorker(name, dir);
  }

  public async unloadPlugin(name: string): Promise<void> {
    const active = this.activePlugins.get(name);
    if (!active) return;
    this.activePlugins.delete(name);
    try {
      // eslint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads postMessage takes no targetOrigin
      active.worker.postMessage({ kind: "shutdown" });
    } catch {}
    const settled = await Promise.race([
      new Promise<true>((resolve) => active.worker.once("exit", () => resolve(true))),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
    ]);
    if (!settled) {
      await active.worker.terminate().catch(() => {});
    }
  }

  public dispatchMessage(message: SessionOutboundMessage): void {
    if (this.activePlugins.size === 0) return;
    const payload = {
      type: message.type,
      payload: (message as { payload?: unknown }).payload,
    };
    for (const [name, active] of this.activePlugins) {
      try {
        // eslint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads postMessage takes no targetOrigin
        active.worker.postMessage({ kind: "dispatch", message: payload });
      } catch (err) {
        this.logger.error({ err, plugin: name }, "Failed to post message to plugin worker");
      }
    }
  }

  private async loadAll(): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.error({ err: error }, "Failed to read plugins directory");
      }
      return;
    }
    await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map((entry) =>
          this.spawnWorker(entry.name, path.join(this.pluginsDir, entry.name)).catch((err) => {
            this.logger.error({ err, plugin: entry.name }, "Failed to load plugin");
          }),
        ),
    );
  }

  private async spawnWorker(name: string, pluginDir: string): Promise<void> {
    const pkgPath = path.join(pluginDir, "package.json");
    const pkgData = await fs.readFile(pkgPath, "utf-8").catch(() => null);
    if (!pkgData) return;
    let pkg: { main?: string };
    try {
      pkg = JSON.parse(pkgData) as { main?: string };
    } catch (err) {
      this.logger.error({ err, plugin: name }, "Plugin package.json is not valid JSON");
      return;
    }
    const mainFile = pkg.main || "index.js";
    const entryPath = path.join(pluginDir, mainFile);
    const entryUrl = `${new URL(`file://${entryPath}`).href}?reload=${Date.now()}`;

    // resourceLimits is the closest thing Node offers to a per-plugin
    // sandbox. A misbehaving plugin that allocates aggressively will hit the
    // 256MiB old-generation cap and the worker exits with an OOM, taking
    // only itself down. CPU isn't directly limited, but the activation
    // timeout above + idle event-loop nature of plugins makes runaway loops
    // observable: the worker stops processing dispatches and the host can
    // restart it. (True permission sandboxing — fs/net allowlists — would
    // require Node's experimental `--permission` flag, which is daemon-wide
    // and out of scope here.)
    const worker = new Worker(this.workerEntry, {
      workerData: { pluginId: name, entryUrl },
      stderr: true,
      stdout: true,
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 32,
        codeRangeSizeMb: 64,
        stackSizeMb: 4,
      },
    });

    let resolveReady!: () => void;
    let rejectReady!: (err: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const timeout = setTimeout(() => {
      rejectReady(new Error(`Plugin "${name}" did not activate within ${ACTIVATION_TIMEOUT_MS}ms`));
      void worker.terminate().catch(() => {});
    }, ACTIVATION_TIMEOUT_MS);

    worker.on("message", (envelope: WorkerEnvelope) => {
      if (envelope.kind === "log") {
        this.handleWorkerLog(envelope);
      } else if (envelope.kind === "ready") {
        clearTimeout(timeout);
        resolveReady();
      } else if (envelope.kind === "error") {
        clearTimeout(timeout);
        rejectReady(new Error(envelope.error));
        this.logger.error({ plugin: name, error: envelope.error }, "Plugin worker reported error");
      }
    });

    worker.on("error", (err) => {
      clearTimeout(timeout);
      rejectReady(err);
      this.logger.error({ err, plugin: name }, "Plugin worker errored");
    });

    worker.on("exit", (code) => {
      clearTimeout(timeout);
      this.activePlugins.delete(name);
      if (code !== 0) {
        this.logger.warn({ plugin: name, code }, "Plugin worker exited unexpectedly");
      }
    });

    this.activePlugins.set(name, { worker, ready });
    try {
      await ready;
      this.logger.info({ plugin: name }, "Activated plugin");
    } catch (err) {
      this.activePlugins.delete(name);
      await worker.terminate().catch(() => {});
      throw err;
    }
  }

  private handleWorkerLog(envelope: WorkerLogEnvelope): void {
    const child = this.logger.child({ module: "plugin", plugin: envelope.pluginId });
    const fields = envelope.fields ?? {};
    switch (envelope.level) {
      case "info":
        child.info(fields, envelope.msg);
        return;
      case "warn":
        child.warn(fields, envelope.msg);
        return;
      case "error":
        child.error(fields, envelope.msg);
        return;
      case "debug":
        child.debug(fields, envelope.msg);
        return;
      default:
        child.info(fields, envelope.msg);
    }
  }
}
