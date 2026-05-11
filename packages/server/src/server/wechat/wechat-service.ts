import { existsSync } from "node:fs";
import { delimiter, sep } from "node:path";
import type { Logger } from "pino";

import { runWxCommand, runWxJsonCommand } from "./wechat-cli.js";
import { WechatServiceError } from "./wechat-errors.js";
import {
  WechatMessageListSchema,
  WechatSessionListSchema,
  type WechatChatType,
  type WechatMessage,
  type WechatSession,
} from "./wechat-types.js";

export interface WechatServiceOptions {
  ottieHome: string;
  logger: Logger;
  /**
   * Absolute path to the `wx` binary (or shim). When omitted, the service
   * resolves it from `PATH` lazily on first call and caches the result.
   * Pass an explicit path when ottie ships wx as a Tauri sidecar (Step 2)
   * — that location lives outside `PATH` but is owned by the daemon.
   */
  wxBinaryPath?: string;
  /** Default per-command timeout. Default 20s — covers wx-daemon's 15s startup window plus headroom. */
  defaultTimeoutMs?: number;
}

export interface ListSessionsInput {
  limit?: number;
}

export interface ListUnreadInput {
  limit?: number;
  /**
   * wx-cli's `--filter` allows: `private | group | official_account | folded`.
   * Pass `["private", "group"]` for the inbox use case (real human chats
   * only, no public-account or folded entries).
   */
  filter?: WechatChatType[];
}

export interface ReadHistoryInput {
  /**
   * Display name OR wxid OR `<hash>@chatroom`. wx-cli's daemon resolves all
   * three (src/daemon/query.rs:387-410). Prefer `username` (wxid) when
   * available — display names can change over time.
   */
  chat: string;
  limit?: number;
  /** ISO date or `"YYYY-MM-DD HH:MM"` — wx-cli accepts both. */
  since?: string;
  until?: string;
}

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_LIMIT = 2_000;

export class WechatService {
  private readonly logger: Logger;
  private readonly defaultTimeoutMs: number;
  private resolvedBinaryPath: string | null;

  constructor(options: WechatServiceOptions) {
    this.logger = options.logger.child({ component: "wechat-service" });
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.resolvedBinaryPath = options.wxBinaryPath ?? null;
    void options.ottieHome;
  }

  /**
   * Returns the resolved wx binary path, in priority order:
   *   1. Explicit constructor injection (`wxBinaryPath`)
   *   2. `OTTIE_WX_BINARY` env var — set by the Tauri daemon wrapper when
   *      the bundled sidecar copy is present
   *   3. `PATH` lookup with platform-aware extension probing
   *
   * Caches the first hit. Throws `WechatServiceError({kind: "binary_not_found"})`
   * when none match — callers surface the Setup Wizard at that point.
   */
  resolveBinaryPath(): string {
    if (this.resolvedBinaryPath) return this.resolvedBinaryPath;
    const fromEnv = process.env["OTTIE_WX_BINARY"];
    if (fromEnv && existsSync(fromEnv)) {
      this.resolvedBinaryPath = fromEnv;
      return fromEnv;
    }
    const found = findOnPath("wx");
    if (!found) {
      throw new WechatServiceError({
        kind: "binary_not_found",
        message:
          "wx binary not found. Set OTTIE_WX_BINARY, install via `npm i -g @jackwener/wx-cli`, or pass wxBinaryPath.",
      });
    }
    this.resolvedBinaryPath = found;
    return found;
  }

  async listSessions(input: ListSessionsInput = {}): Promise<WechatSession[]> {
    const args = ["sessions"];
    if (input.limit !== undefined) {
      args.push("-n", String(this.normalizeLimit(input.limit)));
    }
    const raw = await runWxJsonCommand({
      args,
      binaryPath: this.resolveBinaryPath(),
      timeoutMs: this.defaultTimeoutMs,
      logger: this.logger,
    });
    return WechatSessionListSchema.parse(raw ?? []);
  }

  async listUnread(input: ListUnreadInput = {}): Promise<WechatSession[]> {
    const args = ["unread"];
    if (input.limit !== undefined) {
      args.push("-n", String(this.normalizeLimit(input.limit)));
    }
    if (input.filter && input.filter.length > 0) {
      args.push("--filter", input.filter.join(","));
    }
    const raw = await runWxJsonCommand({
      args,
      binaryPath: this.resolveBinaryPath(),
      timeoutMs: this.defaultTimeoutMs,
      logger: this.logger,
    });
    return WechatSessionListSchema.parse(raw ?? []);
  }

  async readHistory(input: ReadHistoryInput): Promise<WechatMessage[]> {
    const chat = input.chat.trim();
    if (chat.length === 0) {
      throw new WechatServiceError({
        kind: "unknown",
        message: "readHistory requires a non-empty chat selector",
      });
    }
    const args = ["history", chat];
    if (input.limit !== undefined) {
      args.push("-n", String(this.normalizeLimit(input.limit)));
    }
    if (input.since) args.push("--since", input.since);
    if (input.until) args.push("--until", input.until);
    const raw = await runWxJsonCommand({
      args,
      binaryPath: this.resolveBinaryPath(),
      timeoutMs: this.defaultTimeoutMs,
      logger: this.logger,
    });
    return WechatMessageListSchema.parse(raw ?? []);
  }

  /**
   * Plain-text status of the wx-cli daemon. wx-cli prints e.g.
   * "wx-daemon 运行中 (PID 12345)" or "wx-daemon 未运行" to stdout. Locale
   * variants and whitespace are tolerated by the loose regex below.
   */
  async daemonStatus(): Promise<DaemonStatus> {
    const result = await runWxCommand({
      args: ["daemon", "status"],
      binaryPath: this.resolveBinaryPath(),
      timeoutMs: 5_000,
    });
    const combined = `${result.stdout}\n${result.stderr}`;
    const pidMatch = combined.match(/PID\s+(\d+)/i);
    const running = /运行中|running/i.test(combined) || pidMatch !== null;
    return {
      running,
      pid: pidMatch && pidMatch[1] ? parseInt(pidMatch[1], 10) : null,
    };
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit)) return 20;
    return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
  }
}

function findOnPath(name: string): string | null {
  const pathEnv = process.env["PATH"] ?? "";
  const exts =
    process.platform === "win32"
      ? (process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";")
      : [""];
  for (const dir of pathEnv.split(delimiter)) {
    if (dir.length === 0) continue;
    const base = `${dir}${dir.endsWith(sep) ? "" : sep}${name}`;
    for (const ext of exts) {
      const candidate = `${base}${ext}`;
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
