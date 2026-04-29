import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";
import type {
  VoiceRouteCommand,
  VoiceRouteRequestPayload,
  VoiceRouteResultPayload,
} from "./voice-intent-routing-types.js";

/**
 * Voice intent routing — one-shot LLM tool selection.
 *
 * Takes a transcript + a serialized command catalog, asks Claude (via the
 * same Claude Agent SDK chat uses) to pick a tool, and returns a
 * structured result the session handler emits over the WebSocket.
 *
 * Auth strategy: we route through `@anthropic-ai/claude-agent-sdk`'s
 * `query()` so credentials flow through the SAME pipeline that the rest of
 * Ottie's Claude Code chat uses — `claude` CLI OAuth tokens, the system
 * keychain, ANTHROPIC_API_KEY, AWS Bedrock, Google Vertex, all of it. Users
 * who can chat with Claude in Ottie can use voice routing with no extra
 * setup.
 *
 * Trade-off: each call spawns a Claude Code subprocess (~500ms-1s startup
 * overhead). Acceptable for voice control v1 where the user already
 * tolerates a 2s confirmation countdown. A future optimization can call
 * `startup()` once at daemon boot to keep a warm subprocess ready, dropping
 * routing latency to sub-second.
 *
 * Output format: we ask Claude to return JSON of shape
 * `{"command": "<name>" | null, "params": <object>}` in its assistant
 * response. Tool-use isn't used here because (a) we'd have to define tools
 * via an in-process MCP server, which is overkill for "pick a name from a
 * list", and (b) JSON output is cheaper to parse than tool_use blocks
 * across the SDK's iterator surface.
 *
 * Errors are NEVER thrown to the caller — every failure path returns a
 * structured `{ matched: false, error }` result so the client always sees a
 * clean fallback signal.
 */

interface RouteVoiceIntentArgs {
  request: Pick<
    VoiceRouteRequestPayload,
    "transcript" | "provider" | "modelId" | "commands" | "timeoutMs"
  >;
  logger: Logger;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_CLAUDE_ROUTING_MODEL = "claude-haiku-4-5";

export async function routeVoiceIntent(
  args: RouteVoiceIntentArgs,
): Promise<VoiceRouteResultPayload> {
  const { request, logger } = args;
  const trimmed = request.transcript.trim();
  if (!trimmed) {
    return failure("Empty transcript");
  }

  if (request.provider === "claude") {
    return routeWithClaude({
      transcript: trimmed,
      commands: request.commands,
      modelId: request.modelId ?? null,
      timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      logger,
    });
  }

  // codex / opencode are reserved but not yet implemented. Returning a clean
  // failure means the client knows to fall back to its heuristic matcher.
  return failure(`Voice routing for provider "${request.provider}" is not implemented yet`);
}

interface RouteWithClaudeArgs {
  transcript: string;
  commands: VoiceRouteCommand[];
  modelId: string | null;
  timeoutMs: number;
  logger: Logger;
}

async function routeWithClaude(args: RouteWithClaudeArgs): Promise<VoiceRouteResultPayload> {
  const allowedNames = new Set(args.commands.map((c) => c.name));
  const systemPrompt = buildRouterSystemPrompt(args.commands);

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(
    () => abortController.abort("voice-intent-routing-timeout"),
    args.timeoutMs,
  );

  let resultMessage: SDKResultMessage | null = null;
  try {
    const conversation = query({
      prompt: args.transcript,
      options: {
        abortController,
        model: resolveClaudeModelId(args.modelId),
        systemPrompt,
        // Disable all of Claude Code's built-in tools — voice routing is
        // pure text classification, the model shouldn't be reading or
        // writing files.
        tools: [],
        // No project / user settings load — keeps the call deterministic
        // regardless of what CLAUDE.md is in the daemon's cwd.
        settingSources: [],
        // Prevent multi-turn — we want the first response, period.
        maxTurns: 1,
        // No tool use means no permission prompts; keep default to be safe.
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
      return failure(`Routing timed out after ${args.timeoutMs}ms`);
    }
    args.logger.warn({ err }, "voice-intent-routing: query() threw");
    return failure(err instanceof Error ? err.message : "Claude routing call failed");
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!resultMessage) {
    return failure("Claude routing returned no result message");
  }

  if (resultMessage.subtype !== "success") {
    const reason =
      resultMessage.errors?.find((s) => s.length > 0) ?? `Claude returned ${resultMessage.subtype}`;
    args.logger.warn({ subtype: resultMessage.subtype }, "voice-intent-routing: query failed");
    return failure(reason);
  }

  const parsed = parseRouterJson(resultMessage.result);
  if (!parsed) {
    return failure("Claude reply wasn't valid JSON");
  }
  if (parsed.command === null) {
    return failure("No matching command");
  }
  if (!allowedNames.has(parsed.command)) {
    args.logger.warn(
      { picked: parsed.command },
      "voice-intent-routing: model picked unknown tool",
    );
    return failure(`Model picked unknown command "${parsed.command}"`);
  }

  return {
    matched: true,
    commandName: parsed.command,
    params: parsed.params,
    confidence: null,
    error: null,
  };
}

function failure(error: string): VoiceRouteResultPayload {
  return {
    matched: false,
    commandName: null,
    params: {},
    confidence: null,
    error,
  };
}

function buildRouterSystemPrompt(commands: VoiceRouteCommand[]): string {
  const catalog = commands
    .map((cmd) => {
      const examples = cmd.examples?.length
        ? ` (examples: ${cmd.examples.map((ex) => `"${ex}"`).join(", ")})`
        : "";
      return `- ${cmd.name}: ${cmd.description}${examples}`;
    })
    .join("\n");

  return `You are Ottie's voice command router.

The user spoke a short instruction. Pick EXACTLY ONE command from the catalog below that best matches their intent, and return the call as JSON.

Available commands:
${catalog}

Output rules:
- Respond with ONE JSON object and nothing else (no prose, no code fences).
- Shape: {"command": "<name>" | null, "params": <object>}
- If a command takes no arguments, use {} for params.
- For send_to_active_agent, put the user's intended message in params.text — strip leading "send" / "say" / "tell it" / "发：" / "说" verbs from the transcript.
- For find_workspace, put the keyword the user said into params.query.
- Be permissive about phrasing: "open the files" / "show me the files" / "files please" all map to open_file_explorer.
- If nothing fits, return {"command": null, "params": {}}.
- NEVER invent a command name that isn't in the catalog.`;
}

interface ParsedRouterResponse {
  command: string | null;
  params: Record<string, unknown>;
}

function parseRouterJson(raw: string): ParsedRouterResponse | null {
  // Models occasionally wrap JSON in code fences or add a sentence around
  // it. Extract the first balanced JSON object before parsing.
  const candidate = extractJsonObject(raw);
  if (!candidate) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  const commandRaw = obj.command;
  let command: string | null;
  if (commandRaw === null || commandRaw === undefined) {
    command = null;
  } else if (typeof commandRaw === "string" && commandRaw.length > 0) {
    command = commandRaw;
  } else {
    return null;
  }

  const paramsRaw = obj.params;
  let params: Record<string, unknown>;
  if (paramsRaw && typeof paramsRaw === "object" && !Array.isArray(paramsRaw)) {
    params = paramsRaw as Record<string, unknown>;
  } else {
    params = {};
  }

  return { command, params };
}

function extractJsonObject(raw: string): string | null {
  // Find the first { and the matching }, accounting for nested braces and
  // strings. Tiny state machine — handles the common case where Claude
  // wraps JSON in ```json ... ``` or adds a leading "Here's the JSON:".
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        return raw.slice(start, i + 1);
      }
    }
  }
  return null;
}

function resolveClaudeModelId(modelId: string | null): string {
  if (!modelId) return DEFAULT_CLAUDE_ROUTING_MODEL;
  // Strip Ottie's bracketed window markers like [1m] — the SDK / Anthropic
  // API expect canonical model ids without those embellishments.
  const stripped = modelId.replace(/\[[^\]]*\]$/, "").trim();
  return stripped.length > 0 ? stripped : DEFAULT_CLAUDE_ROUTING_MODEL;
}
