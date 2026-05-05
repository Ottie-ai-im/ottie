// Plugin worker entry — loaded once per plugin in a `node:worker_threads`
// Worker. The host (main thread) tells us where to find the plugin's
// `index.js`, we import it, then we proxy WS dispatch + log events across
// the message channel.
//
// Crash isolation: an `uncaughtException` here only kills the worker, not
// the daemon. The host respawns or marks the plugin as failed.
//
// API surface: the worker exposes one `OttiePluginAPI` with a logger and an
// EventEmitter. The host posts `{ kind: "dispatch", message }` for every
// outbound WS message; we re-emit on `events`. The worker posts
// `{ kind: "log", level, msg, fields }` for plugin logging.

import { EventEmitter } from "node:events";
import { parentPort, workerData } from "node:worker_threads";

interface WorkerInit {
  pluginId: string;
  entryUrl: string;
}

interface DispatchEnvelope {
  kind: "dispatch";
  message: { type: string; payload?: unknown } | null;
}

interface ShutdownEnvelope {
  kind: "shutdown";
}

type HostEnvelope = DispatchEnvelope | ShutdownEnvelope;

interface PluginModule {
  activate?: (api: PluginRuntimeApi) => Promise<void> | void;
  deactivate?: () => Promise<void> | void;
}

interface PluginRuntimeApi {
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
    child: (fields: Record<string, unknown>) => PluginRuntimeApi["logger"];
  };
  events: EventEmitter;
}

if (!parentPort) {
  throw new Error("plugin-worker-runtime must be spawned via worker_threads");
}

const { pluginId, entryUrl } = workerData as WorkerInit;
const port = parentPort;

const events = new EventEmitter();
events.setMaxListeners(50);

function postLog(level: "info" | "warn" | "error" | "debug", args: unknown[]): void {
  let msg = "";
  let fields: Record<string, unknown> | undefined;
  if (args.length === 1) {
    if (typeof args[0] === "string") {
      msg = args[0];
    } else {
      fields = args[0] as Record<string, unknown>;
    }
  } else if (args.length >= 2) {
    if (typeof args[0] === "object" && args[0] !== null) {
      fields = args[0] as Record<string, unknown>;
      msg = String(args[1]);
    } else {
      msg = String(args[0]);
    }
  }
  port.postMessage({ kind: "log", level, msg, fields, pluginId });
}

function makeLogger(extra?: Record<string, unknown>): PluginRuntimeApi["logger"] {
  const wrap = (level: "info" | "warn" | "error" | "debug") => {
    return (...args: unknown[]) => {
      if (extra && args.length > 0 && typeof args[0] === "object" && args[0] !== null) {
        args = [{ ...extra, ...(args[0] as Record<string, unknown>) }, ...args.slice(1)];
      } else if (extra) {
        args = [extra, ...args];
      }
      postLog(level, args);
    };
  };
  return {
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
    debug: wrap("debug"),
    child: (fields) => makeLogger(extra ? { ...extra, ...fields } : fields),
  };
}

const api: PluginRuntimeApi = {
  logger: makeLogger({ plugin: pluginId }),
  events,
};

let pluginModule: PluginModule | null = null;

async function bootstrap(): Promise<void> {
  pluginModule = (await import(entryUrl)) as PluginModule;
  if (typeof pluginModule.activate === "function") {
    await pluginModule.activate(api);
    port.postMessage({ kind: "ready", pluginId });
  } else {
    port.postMessage({ kind: "error", pluginId, error: "Plugin missing activate() export" });
  }
}

async function shutdown(): Promise<void> {
  try {
    if (pluginModule && typeof pluginModule.deactivate === "function") {
      await pluginModule.deactivate();
    }
  } finally {
    events.removeAllListeners();
    process.exit(0);
  }
}

port.on("message", (envelope: HostEnvelope) => {
  if (envelope.kind === "dispatch" && envelope.message && typeof envelope.message === "object") {
    const message = envelope.message;
    try {
      events.emit("message", message);
      if (message.type) {
        events.emit(message.type, message.payload);
      }
    } catch (err) {
      api.logger.error({ err }, "Plugin handler threw on dispatched message");
    }
  } else if (envelope.kind === "shutdown") {
    void shutdown();
  }
});

process.on("uncaughtException", (err) => {
  port.postMessage({
    kind: "error",
    pluginId,
    error: err instanceof Error ? err.message : String(err),
  });
});

process.on("unhandledRejection", (err) => {
  port.postMessage({
    kind: "error",
    pluginId,
    error: err instanceof Error ? err.message : String(err),
  });
});

bootstrap().catch((err) => {
  port.postMessage({
    kind: "error",
    pluginId,
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
