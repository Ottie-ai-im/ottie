import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";

/**
 * One-shot LLM completion for WeChat AI features. Runs through the
 * `@anthropic-ai/claude-agent-sdk` `query()` API so credentials flow
 * through the SAME pipeline that the rest of Ottie's Claude Code chat
 * uses — the user's `claude` CLI OAuth tokens, system keychain,
 * `ANTHROPIC_API_KEY`, AWS Bedrock, Google Vertex, all of it. If the
 * Providers panel shows "Claude · Available", this works with no extra
 * setup. Mirrors the pattern from
 * `packages/server/src/server/voice/voice-intent-routing.ts`.
 *
 * Why not Hermes: Hermes is an external aiohttp gateway that needs its
 * own provider config + auth. Day-1 testing showed real users have
 * Hermes installed-but-misconfigured (anthropic provider declared but
 * no Anthropic credentials, falling back to free-plan ChatGPT and
 * silently returning empty streams). Going direct to Claude is the
 * "use what's already working" path.
 *
 * Why no tools / max 1 turn: WeChat suggestions and rewrites are pure
 * text classification / rewriting. We don't want Claude reading the
 * user's filesystem or running shells — disabling tools makes the call
 * deterministic and avoids permission prompts that would break the
 * fire-and-forget UX.
 */

export interface RunWechatClaudeArgs {
  prompt: string;
  /** Defaults to the SDK's resolved Claude default if omitted. */
  modelId?: string | null;
  timeoutMs?: number;
  logger: Logger;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5";

export class WechatLlmError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WechatLlmError";
    this.code = code;
  }
}

/**
 * Run a single text prompt through Claude. Returns the assistant's
 * reply as a string. Throws `WechatLlmError` on timeout, abort, or
 * upstream API failure — no silent empties.
 */
export async function runWechatClaudeCompletion(args: RunWechatClaudeArgs): Promise<string> {
  const trimmed = args.prompt.trim();
  if (trimmed.length === 0) {
    throw new WechatLlmError("empty_prompt", "Prompt is empty after trim");
  }

  const abortController = new AbortController();
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutHandle = setTimeout(() => abortController.abort("wechat-llm-timeout"), timeoutMs);

  let resultMessage: SDKResultMessage | null = null;
  try {
    const conversation = query({
      prompt: trimmed,
      options: {
        abortController,
        model: args.modelId?.trim() || DEFAULT_CLAUDE_MODEL,
        // Disable tools — pure text in/text out. No file reads, no
        // shells, no MCP. Avoids permission prompts breaking UX.
        tools: [],
        // No project / user settings load so the call stays
        // deterministic regardless of which CLAUDE.md / agent rules
        // happen to exist in the daemon's cwd.
        settingSources: [],
        // First response only.
        maxTurns: 1,
        permissionMode: "default",
      },
    });

    for await (const msg of conversation) {
      if (msg.type === "result") {
        resultMessage = msg;
        break;
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      throw new WechatLlmError("timeout", `Claude call timed out after ${timeoutMs}ms`);
    }
    args.logger.warn({ err }, "wechat-llm: claude query() threw");
    throw new WechatLlmError(
      "claude_failed",
      err instanceof Error ? err.message : "Claude call failed",
    );
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!resultMessage) {
    throw new WechatLlmError("no_result", "Claude returned no result message");
  }

  if (resultMessage.subtype !== "success") {
    const reason =
      resultMessage.errors?.find((s) => s.length > 0) ??
      `Claude returned subtype "${resultMessage.subtype}"`;
    throw new WechatLlmError("claude_subtype_failure", reason);
  }

  const reply = resultMessage.result?.trim() ?? "";
  if (reply.length === 0) {
    throw new WechatLlmError("empty_reply", "Claude returned an empty reply");
  }
  return reply;
}
