import { createOttieDaemon } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { resolveOttieHome } from "./ottie-home.js";
import { createRootLogger } from "./logger.js";
import { loadPersistedConfig } from "./persisted-config.js";
import { acquirePidLock, PidLockError, releasePidLock, updatePidLock } from "./pid-lock.js";
import type { DaemonLifecycleIntent } from "./bootstrap.js";
import { fixPathEnv } from "../utils/fix-path.js";

type SupervisorLifecycleMessage =
  | {
      type: "ottie:shutdown";
    }
  | {
      type: "ottie:restart";
      reason?: string;
    };

interface BootstrapResult {
  ottieHome: string;
  logger: ReturnType<typeof createRootLogger>;
  config: ReturnType<typeof loadConfig>;
}

function bootstrapFromEnvironment(): BootstrapResult {
  // Ensure PATH is fixed on macOS before we start resolving config or logger.
  fixPathEnv();

  try {
    const ottieHome = resolveOttieHome();
    const persistedConfig = loadPersistedConfig(ottieHome);
    const logger = createRootLogger(persistedConfig, { ottieHome });
    const config = loadConfig(ottieHome);
    return { ottieHome, logger, config };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

function applyCliFlagOverrides(config: ReturnType<typeof loadConfig>): void {
  if (process.argv.includes("--no-relay")) {
    config.relayEnabled = false;
  }
  if (process.argv.includes("--no-mcp")) {
    config.mcpEnabled = false;
  }
  if (process.argv.includes("--no-inject-mcp")) {
    config.mcpInjectIntoAgents = false;
  }
}

async function main() {
  const { ottieHome, logger, config } = bootstrapFromEnvironment();
  let daemon: Awaited<ReturnType<typeof createOttieDaemon>> | null = null;
  let shutdownPromise: Promise<number> | null = null;
  let exitHookInstalled = false;
  const supervised = process.env.OTTIE_SUPERVISED === "1" && typeof process.send === "function";
  let pidLockAcquired = false;

  applyCliFlagOverrides(config);

  const installExitHook = () => {
    if (exitHookInstalled || !shutdownPromise) {
      return;
    }
    exitHookInstalled = true;
    void shutdownPromise.then((exitCode) => {
      process.exit(exitCode);
    });
  };

  const beginShutdown = (
    signal: string,
    options?: {
      successExitCode?: number;
    },
  ) => {
    if (!shutdownPromise) {
      logger.info(`${signal} received, shutting down gracefully...`);

      shutdownPromise = (async () => {
        const forceExit = setTimeout(() => {
          logger.warn("Forcing shutdown - HTTP server didn't close in time");
          process.exit(1);
        }, 10000);

        try {
          if (!daemon) {
            logger.error("Shutdown requested before daemon initialization completed");
            clearTimeout(forceExit);
            return 1;
          }
          await daemon.stop();
          if (pidLockAcquired) {
            await releasePidLock(ottieHome);
            pidLockAcquired = false;
          }
          clearTimeout(forceExit);
          logger.info("Server closed");
          return options?.successExitCode ?? 0;
        } catch (err) {
          clearTimeout(forceExit);
          logger.error({ err }, "Shutdown failed");
          return 1;
        }
      })();
    } else {
      logger.info(`${signal} received while shutdown is already in progress`);
    }

    installExitHook();
  };

  const sendSupervisorLifecycleMessage = (message: SupervisorLifecycleMessage): boolean => {
    if (typeof process.send !== "function") {
      return false;
    }
    try {
      process.send(message);
      return true;
    } catch (err) {
      logger.error({ err, message }, "Failed to send lifecycle IPC message to supervisor");
      return false;
    }
  };

  const handleLifecycleIntent = (intent: DaemonLifecycleIntent) => {
    if (intent.type === "shutdown") {
      logger.warn(
        { clientId: intent.clientId, requestId: intent.requestId },
        "Shutdown requested via websocket",
      );
      if (sendSupervisorLifecycleMessage({ type: "ottie:shutdown" })) {
        return;
      }
      beginShutdown("shutdown lifecycle intent");
      return;
    }

    logger.warn(
      { clientId: intent.clientId, requestId: intent.requestId, reason: intent.reason },
      "Restart requested via websocket",
    );
    if (
      sendSupervisorLifecycleMessage({
        type: "ottie:restart",
        ...(intent.reason ? { reason: intent.reason } : {}),
      })
    ) {
      return;
    }
    beginShutdown("restart lifecycle intent", { successExitCode: 0 });
  };

  try {
    if (!supervised) {
      await acquirePidLock(ottieHome, null);
      pidLockAcquired = true;
    }

    daemon = await createOttieDaemon(
      {
        ...config,
        onLifecycleIntent: handleLifecycleIntent,
      },
      logger,
    );
  } catch (err) {
    if (pidLockAcquired) {
      await releasePidLock(ottieHome);
      pidLockAcquired = false;
    }
    if (err instanceof PidLockError) {
      logger.error({ pid: err.existingLock?.pid }, err.message);
      process.exit(1);
    }
    logger.fatal({ err }, "Daemon bootstrap failed");
    throw err;
  }

  try {
    await daemon.start();
    if (!supervised) {
      const listenTarget = daemon.getListenTarget();
      const listen =
        listenTarget?.type === "tcp"
          ? `${listenTarget.host}:${listenTarget.port}`
          : listenTarget?.path;
      if (!listen) {
        throw new Error("Daemon did not expose a listen target after startup");
      }
      await updatePidLock(ottieHome, { listen });
    }
  } catch (err) {
    if (pidLockAcquired) {
      await releasePidLock(ottieHome);
      pidLockAcquired = false;
    }
    if (err instanceof PidLockError) {
      logger.error({ pid: err.existingLock?.pid }, err.message);
      process.exit(1);
    }
    logger.fatal({ err }, "Daemon failed to start listening");
    throw err;
  }

  process.on("SIGTERM", () => beginShutdown("SIGTERM"));
  process.on("SIGINT", () => beginShutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception — daemon crashing");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "Unhandled promise rejection — daemon crashing");
    process.exit(1);
  });
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  // Give pino streams a moment to flush the fatal log entry to daemon.log
  // before the process exits. Without this, async file streams may lose the
  // last few entries that explain why the daemon crashed.
  setTimeout(() => process.exit(1), 200);
});
