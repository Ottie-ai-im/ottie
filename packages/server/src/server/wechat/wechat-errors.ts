/**
 * Failure modes of WechatService — discriminated by `kind` so callers branch
 * on typed states (e.g. surface a "run sudo wx init" wizard for
 * `not_initialized` vs a transient retry for `daemon_timeout`). Each kind
 * maps to a specific wx-cli stderr signature documented in
 * `/tmp/wx-cli-research/wx-cli/src/cli/transport.rs` and `src/cli/init.rs`
 * at the time of integration (2026-05).
 */
export type WechatErrorKind =
  | "binary_not_found"
  | "not_initialized"
  | "wechat_not_running"
  | "codesign_required"
  | "daemon_timeout"
  | "permission_denied"
  | "invalid_json"
  | "unknown";

export interface WechatServiceErrorInput {
  kind: WechatErrorKind;
  message: string;
  exitCode?: number | null;
  stderr?: string;
}

export class WechatServiceError extends Error {
  readonly kind: WechatErrorKind;
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(input: WechatServiceErrorInput) {
    super(input.message);
    this.name = "WechatServiceError";
    this.kind = input.kind;
    this.exitCode = input.exitCode ?? null;
    this.stderr = input.stderr ?? "";
  }
}

const STDERR_SIGNATURES: ReadonlyArray<{ kind: WechatErrorKind; pattern: RegExp }> = [
  { kind: "wechat_not_running", pattern: /找不到\s*WeChat\s*进程/ },
  {
    kind: "codesign_required",
    pattern: /task_for_pid\s*失败.*kr=5|codesign\s+--force\s+--deep\s+--sign/,
  },
  { kind: "daemon_timeout", pattern: /wx-daemon\s*启动超时/ },
  { kind: "not_initialized", pattern: /读取\s*config\.json\s*失败|找不到.*config\.json/ },
  { kind: "permission_denied", pattern: /无法写入\s*~\/\.wx-cli|Permission\s+denied/i },
];

export function classifyWechatStderr(stderr: string): WechatErrorKind {
  for (const sig of STDERR_SIGNATURES) {
    if (sig.pattern.test(stderr)) return sig.kind;
  }
  return "unknown";
}
