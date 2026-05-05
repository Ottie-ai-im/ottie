import { spawn } from "node:child_process";
import type { Logger } from "pino";

export type InstallMethod = "docker" | "pipx";
export type ServiceId = "open-webui";

export interface InstallResult {
  success: boolean;
  method: InstallMethod;
  serviceId: ServiceId;
  message: string;
  /** Tail of stdout/stderr — last ~50 lines, useful for surfacing errors. */
  output: string;
  /** Port the service is bound to after install. */
  port: number | null;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a command, capture stdout+stderr, return result. Doesn't throw — caller
 * inspects exitCode and combined output. Detached false; we wait for the
 * command (typically `docker run -d` returns within seconds even though the
 * container keeps running).
 */
async function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...options.env },
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(
      () => {
        child.kill("SIGKILL");
      },
      options.timeoutMs ?? 5 * 60_000,
    );
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({
        exitCode: -1,
        stdout,
        stderr: stderr + String(err),
      });
    });
  });
}

function tail(text: string, lines = 50): string {
  const split = text.split("\n");
  return split.slice(-lines).join("\n").trim();
}

const OPEN_WEBUI_CONTAINER_NAME = "ottie-open-webui";
const OPEN_WEBUI_IMAGE = "ghcr.io/open-webui/open-webui:main";
const OPEN_WEBUI_DEFAULT_PORT = 3000;
const OPEN_WEBUI_FALLBACK_PORT = 13000;

/**
 * Check whether `docker` is reachable AND the daemon responds. `which docker`
 * succeeding doesn't mean Docker Desktop is running.
 */
async function isDockerReady(): Promise<boolean> {
  const result = await runCommand("docker", ["info", "--format", "{{.ID}}"], {
    timeoutMs: 5000,
  });
  return result.exitCode === 0;
}

/**
 * If a container with the given name exists, remove it. We do this before
 * `docker run` so re-running install is idempotent (otherwise the second run
 * fails with "name already in use").
 */
async function removeExistingContainer(name: string): Promise<void> {
  // `docker rm -f` succeeds even if the container doesn't exist on newer
  // Docker versions, but errors on older ones. Either way, swallow.
  await runCommand("docker", ["rm", "-f", name], { timeoutMs: 30_000 });
}

async function isPortFree(port: number): Promise<boolean> {
  // We probe via the existing detector logic to keep behavior consistent —
  // if anything responds on the port, treat as taken.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
    });
    clearTimeout(timer);
    return !(response.status > 0 && response.status < 600);
  } catch {
    return true;
  }
}

async function pickPort(): Promise<number> {
  if (await isPortFree(OPEN_WEBUI_DEFAULT_PORT)) return OPEN_WEBUI_DEFAULT_PORT;
  return OPEN_WEBUI_FALLBACK_PORT;
}

async function installOpenWebUiViaDocker(logger: Logger): Promise<InstallResult> {
  if (!(await isDockerReady())) {
    return {
      success: false,
      method: "docker",
      serviceId: "open-webui",
      message: "Docker is installed but not running. Start Docker Desktop and try again.",
      output: "",
      port: null,
    };
  }

  await removeExistingContainer(OPEN_WEBUI_CONTAINER_NAME);
  const port = await pickPort();

  logger.info(
    { service: "open-webui", method: "docker", port },
    "Installing Open WebUI via Docker",
  );

  // `--restart unless-stopped` keeps it alive across machine reboots; the
  // user can `docker stop` to disable.
  // The named volume `ottie-open-webui-data` persists chat history and
  // configuration across container recreations.
  const result = await runCommand(
    "docker",
    [
      "run",
      "-d",
      "--name",
      OPEN_WEBUI_CONTAINER_NAME,
      "--restart",
      "unless-stopped",
      "-p",
      `${port}:8080`,
      "-v",
      "ottie-open-webui-data:/app/backend/data",
      OPEN_WEBUI_IMAGE,
    ],
    { timeoutMs: 5 * 60_000 },
  );

  const combined = `${result.stdout}\n${result.stderr}`;
  if (result.exitCode !== 0) {
    return {
      success: false,
      method: "docker",
      serviceId: "open-webui",
      message: `docker run exited with ${result.exitCode}`,
      output: tail(combined),
      port: null,
    };
  }

  return {
    success: true,
    method: "docker",
    serviceId: "open-webui",
    message: `Open WebUI is starting on port ${port}. First boot may take 30-60s while the image is pulled.`,
    output: tail(combined),
    port,
  };
}

export async function installService(
  serviceId: ServiceId,
  method: InstallMethod,
  logger: Logger,
): Promise<InstallResult> {
  if (serviceId !== "open-webui") {
    return {
      success: false,
      method,
      serviceId,
      message: `Auto-install for "${serviceId}" is not implemented yet.`,
      output: "",
      port: null,
    };
  }
  if (method === "docker") {
    return installOpenWebUiViaDocker(logger);
  }
  return {
    success: false,
    method,
    serviceId,
    message: `Install method "${method}" is not implemented yet. Use Docker or follow the manual install steps.`,
    output: "",
    port: null,
  };
}
