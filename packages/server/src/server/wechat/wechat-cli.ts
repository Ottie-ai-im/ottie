import { spawn } from "node:child_process";
import { once } from "node:events";
import type { Logger } from "pino";

import { classifyWechatStderr, WechatServiceError } from "./wechat-errors.js";

export interface RunWxCommandInput {
  /** wx subcommand and its args, e.g. ["sessions", "-n", "20", "--json"] */
  args: string[];
  /** Resolved absolute path to the wx binary (or shim). */
  binaryPath: string;
  /** Hard ceiling for the spawn. Default: 20s — covers wx-daemon's 15s startup window plus headroom. */
  timeoutMs?: number;
  /** Extra env merged into `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export interface RunWxCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Spawn `wx` with the given args, capture both streams, return the result.
 * Doesn't throw on non-zero exit — callers inspect `exitCode` and decide
 * whether to raise a typed `WechatServiceError`. Mirrors the canonical
 * Ottie pattern from `server/local-services/service-installer.ts` (the
 * non-PTY subprocess wrapper).
 */
export async function runWxCommand(input: RunWxCommandInput): Promise<RunWxCommandResult> {
  const timeoutMs = input.timeoutMs ?? 20_000;
  const child = spawn(input.binaryPath, input.args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...input.env },
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);

  try {
    // `events.once` resolves on 'close' (with [exitCode, signal]) and rejects
    // when 'error' fires first (e.g. ENOENT for a missing binary). Single
    // settlement point, no manual resolve gymnastics.
    const [code] = (await once(child, "close")) as [number | null];
    return { exitCode: code ?? -1, stdout, stderr, timedOut };
  } catch (err) {
    return {
      exitCode: -1,
      stdout,
      stderr: stderr + String(err),
      timedOut,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export interface RunWxJsonCommandInput {
  /** Subcommand args WITHOUT `--json` (this helper appends it). */
  args: string[];
  binaryPath: string;
  timeoutMs?: number;
  logger: Logger;
}

/**
 * Append `--json`, run, and either parse the stdout JSON or raise a typed
 * `WechatServiceError`. The wx-cli CLI handlers themselves strip the
 * daemon's `{ok, error, data}` envelope before printing (see
 * `src/cli/sessions.rs:8-11` etc.), so what we receive is already the
 * inner payload — usually an array.
 */
export async function runWxJsonCommand(input: RunWxJsonCommandInput): Promise<unknown> {
  const result = await runWxCommand({
    args: [...input.args, "--json"],
    binaryPath: input.binaryPath,
    timeoutMs: input.timeoutMs,
  });

  if (result.timedOut) {
    throw new WechatServiceError({
      kind: "daemon_timeout",
      message: `wx command timed out after ${input.timeoutMs ?? 20_000}ms: ${input.args.join(" ")}`,
      exitCode: result.exitCode,
      stderr: result.stderr,
    });
  }

  if (result.exitCode !== 0) {
    const kind = classifyWechatStderr(result.stderr);
    const head = result.stderr.trim().slice(0, 500);
    throw new WechatServiceError({
      kind,
      message: `wx ${input.args[0] ?? ""} failed (exit ${result.exitCode}): ${head}`,
      exitCode: result.exitCode,
      stderr: result.stderr,
    });
  }

  const trimmed = result.stdout.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (err) {
    input.logger.warn(
      { args: input.args, stdoutHead: trimmed.slice(0, 200) },
      "wx stdout was not valid JSON",
    );
    throw new WechatServiceError({
      kind: "invalid_json",
      message: `wx ${input.args[0] ?? ""} produced invalid JSON: ${(err as Error).message}`,
      exitCode: result.exitCode,
      stderr: result.stderr,
    });
  }
}
