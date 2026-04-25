import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";

import pino from "pino";
import {
  createOttieDaemon,
  type OttieDaemonConfig,
  type OttieOpenAIConfig,
  type OttieSpeechConfig,
} from "../bootstrap.js";
import type { AgentClient, AgentProvider } from "../agent/agent-sdk-types.js";
import { createTestAgentClients } from "./fake-agent-client.js";

interface TestOttieDaemonOptions {
  downloadTokenTtlMs?: number;
  corsAllowedOrigins?: string[];
  listen?: string;
  logger?: Parameters<typeof createOttieDaemon>[1];
  relayEnabled?: boolean;
  relayEndpoint?: string;
  agentClients?: Partial<Record<AgentProvider, AgentClient>>;
  ottieHomeRoot?: string;
  staticDir?: string;
  cleanup?: boolean;
  openai?: OttieOpenAIConfig;
  speech?: OttieSpeechConfig;
  voiceLlmProvider?: OttieDaemonConfig["voiceLlmProvider"];
  voiceLlmProviderExplicit?: boolean;
  voiceLlmModel?: string | null;
  dictationFinalTimeoutMs?: number;
}

export interface TestOttieDaemon {
  config: OttieDaemonConfig;
  daemon: Awaited<ReturnType<typeof createOttieDaemon>>;
  port: number;
  ottieHome: string;
  staticDir: string;
  close: () => Promise<void>;
}

const TEST_DAEMON_START_TIMEOUT_MS = 20_000;

async function startDaemonWithTimeout(
  daemon: Awaited<ReturnType<typeof createOttieDaemon>>,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      const timeoutError = new Error(
        `Timed out starting test daemon after ${timeoutMs}ms`,
      ) as Error & { code?: string };
      timeoutError.code = "TEST_DAEMON_START_TIMEOUT";
      reject(timeoutError);
    }, timeoutMs);

    daemon.start().then(
      () => {
        clearTimeout(timeoutHandle);
        resolve();
        return;
      },
      (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      },
    );
  });
}

export async function createTestOttieDaemon(
  options: TestOttieDaemonOptions = {},
): Promise<TestOttieDaemon> {
  const maxAttempts = 8;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { config, ottieHomeRoot, ottieHome, staticDir } = await prepareTestDaemonConfig(options);
    const logger = options.logger ?? pino({ level: "silent" });
    const daemon = await createOttieDaemon(config, logger);
    try {
      await startDaemonWithTimeout(daemon, TEST_DAEMON_START_TIMEOUT_MS);
      const listenTarget = daemon.getListenTarget();
      if (!listenTarget || listenTarget.type !== "tcp") {
        throw new Error("Test daemon did not expose a bound TCP listen target");
      }

      const close = async (): Promise<void> => {
        await daemon.stop().catch(() => undefined);
        await daemon.agentManager.flush().catch(() => undefined);
        if (options.cleanup ?? true) {
          await new Promise((r) => setTimeout(r, 50));
          await Promise.all([
            rm(ottieHomeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
            rm(staticDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
          ]);
        }
      };

      return {
        config,
        daemon,
        port: listenTarget.port,
        ottieHome,
        staticDir,
        close,
      };
    } catch (error) {
      lastError = error;
      await daemon.stop().catch(() => undefined);
      await Promise.all([
        rm(ottieHomeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
        rm(staticDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
      ]);

      if (
        (!isAddressInUseError(error) && !isStartupTimeoutError(error)) ||
        attempt === maxAttempts - 1
      ) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Failed to start test daemon");
}

interface PreparedTestDaemonConfig {
  config: OttieDaemonConfig;
  ottieHomeRoot: string;
  ottieHome: string;
  staticDir: string;
}

async function prepareTestDaemonConfig(
  options: TestOttieDaemonOptions,
): Promise<PreparedTestDaemonConfig> {
  const ottieHomeRoot =
    options.ottieHomeRoot ?? (await mkdtemp(path.join(os.tmpdir(), "ottie-home-")));
  const ottieHome = path.join(ottieHomeRoot, ".ottie");
  await mkdir(ottieHome, { recursive: true });
  const staticDir = options.staticDir ?? (await mkdtemp(path.join(os.tmpdir(), "ottie-static-")));
  const listenHost = options.listen ?? "127.0.0.1";
  const config: OttieDaemonConfig = {
    listen: `${listenHost}:0`,
    ottieHome,
    corsAllowedOrigins: options.corsAllowedOrigins ?? [],
    hostnames: true,
    mcpEnabled: true,
    staticDir,
    mcpDebug: false,
    agentClients: options.agentClients ?? createTestAgentClients(),
    agentStoragePath: path.join(ottieHome, "agents"),
    relayEnabled: options.relayEnabled ?? false,
    relayEndpoint: options.relayEndpoint ?? "relay.ottie.app:443",
    appBaseUrl: "https://app.ottie.app",
    openai: options.openai,
    speech: options.speech,
    voiceLlmProvider: options.voiceLlmProvider ?? null,
    voiceLlmProviderExplicit: options.voiceLlmProviderExplicit ?? false,
    voiceLlmModel: options.voiceLlmModel ?? null,
    dictationFinalTimeoutMs: options.dictationFinalTimeoutMs,
    downloadTokenTtlMs: options.downloadTokenTtlMs,
  };
  return { config, ottieHomeRoot, ottieHome, staticDir };
}

function isAddressInUseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string };
  return record.code === "EADDRINUSE";
}

function isStartupTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string };
  return record.code === "TEST_DAEMON_START_TIMEOUT";
}
