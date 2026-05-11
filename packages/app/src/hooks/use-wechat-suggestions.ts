import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useAppSettings } from "@/hooks/use-settings";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { WechatMessage } from "@server/server/wechat/wechat-types";

const SUGGESTIONS_STALE_MS = 5 * 60_000;
const SUGGESTIONS_GC_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;

export interface UseWechatSuggestionsInput {
  serverId: string | null;
  chatId: string | null;
  /** Display name of the counterparty — surfaced in the prompt so the LLM addresses them. */
  chatLabel: string;
  /** Group chats skip auto-generation (high noise). User clicks "Generate" to opt in. */
  isGroup: boolean;
  messages: readonly WechatMessage[];
  /**
   * Keys (matching `messageKey()` from wechat-context-view) of messages
   * the user explicitly wants the AI to address. Empty = "use full
   * context". Non-empty = "focus on these specific messages, the rest
   * is just background". Lets the user point the AI at, say, the last 3
   * questions someone fired at them in a row.
   */
  focusKeys: ReadonlySet<string>;
  /**
   * Function from `messageKey()` so the hook doesn't need to import the
   * component-level helper directly (keeps the dependency graph one-way:
   * components → hooks, never the reverse).
   */
  messageKey: (msg: WechatMessage, idx: number) => string;
  /**
   * User-typed transcripts for voice messages, keyed by `messageKey()`.
   * When a row's content is `[语音]` and its key is in this map, the
   * substitution happens server-side-of-the-prompt: the LLM sees the
   * real text, not the placeholder, so it can actually craft a reply.
   */
  annotations: Readonly<Record<string, string>>;
  /**
   * When false, the query stays disabled. The detail page sets this true
   * for private chats once history has loaded; group chats flip it on
   * demand from a button press.
   */
  enabled: boolean;
}

export interface UseWechatSuggestionsResult {
  suggestions: readonly string[];
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  /**
   * Force a fresh generation, bypassing the 5-minute cache. Used by the
   * "Regenerate" button and as the explicit opt-in path for group chats.
   */
  regenerate: () => Promise<void>;
}

/**
 * Wrap `client.sendHermesMessage` to produce 3 candidate replies for the
 * current chat context. We don't add a dedicated daemon RPC because the
 * existing hermes path is single-shot and accepts any text — we just
 * craft a self-contained prompt and split the reply on numbered lines.
 *
 * Caching: react-query keyed by (serverId, chatId, lastTimestamp). When
 * a new message arrives the latest timestamp changes → key changes →
 * cache miss → automatic regeneration. Identical context within the 5
 * minute staleTime returns the cached suggestions instantly.
 */
export function useWechatSuggestions(input: UseWechatSuggestionsInput): UseWechatSuggestionsResult {
  const {
    serverId,
    chatId,
    chatLabel,
    isGroup,
    messages,
    enabled,
    focusKeys,
    messageKey,
    annotations,
  } = input;
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  // The Claude model id picked from the WeChat detail page's chip
  // selector. Null = daemon's sensible default (claude-haiku-4-5).
  // Persisted in AppSettings so it survives reloads.
  const { settings } = useAppSettings();
  const modelId = settings.wechatClaudeModelId;
  const queryClient = useQueryClient();

  const lastTimestamp = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const ts = messages[i]?.timestamp;
      if (typeof ts === "number") return ts;
    }
    return null;
  }, [messages]);

  // Stable signature of which messages the user has selected (sorted +
  // joined) so a different focus set produces a fresh query key and
  // re-fires the LLM. Empty set = `""` = "use full context".
  const focusSignature = useMemo(() => {
    if (focusKeys.size === 0) return "";
    return [...focusKeys].sort().join("|");
  }, [focusKeys]);

  // Annotations also enter the queryKey so newly transcribed voice
  // messages invalidate cached suggestions — without this the LLM
  // would keep replying based on the stale "[语音]" placeholder.
  const annotationsSignature = useMemo(() => {
    const keys = Object.keys(annotations).sort();
    if (keys.length === 0) return "";
    return keys.map((k) => `${k}=${annotations[k]?.length ?? 0}`).join("|");
  }, [annotations]);

  const queryKey = useMemo(
    () =>
      [
        "wechat-suggestions",
        serverId,
        chatId,
        modelId ?? null,
        lastTimestamp,
        isGroup ? "group" : "private",
        focusSignature,
        annotationsSignature,
      ] as const,
    [serverId, chatId, modelId, lastTimestamp, isGroup, focusSignature, annotationsSignature],
  );

  const query = useQuery({
    queryKey,
    enabled:
      enabled &&
      Boolean(serverId && chatId && client && isConnected && messages.length > 0 && lastTimestamp),
    staleTime: SUGGESTIONS_STALE_MS,
    gcTime: SUGGESTIONS_GC_MS,
    // No automatic retries on failure — when the model is misconfigured
    // (e.g. returns empty), one round-trip already proved it; retrying 3
    // more times burns tokens and hammers the Hermes server. The user
    // gets a clear error and a "Regenerate" button if they fix the
    // underlying issue.
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      /* eslint-disable no-console */
      if (!client) {
        console.warn("[wx-ai] suggestions.bailed — no client");
        return [] as readonly string[];
      }
      const prompt = buildSuggestionsPrompt({
        chatLabel,
        messages,
        isGroup,
        focusKeys,
        messageKey,
        annotations,
      });
      console.log("[wx-ai] suggestions.dispatching", {
        chatId,
        chatLabel,
        isGroup,
        messageCount: messages.length,
        modelId,
        promptLen: prompt.length,
      });
      const t0 = performance.now();
      try {
        const res = await client.wechatLlmComplete({
          prompt,
          modelId,
          timeoutMs: REQUEST_TIMEOUT_MS,
        });
        const elapsed = Math.round(performance.now() - t0);
        if (res.error) {
          throw new Error(res.error);
        }
        const reply = res.reply ?? "";
        const parsed = parseNumberedReplies(reply);
        console.log("[wx-ai] suggestions.response", {
          elapsedMs: elapsed,
          replyLen: reply.length,
          replyHead: reply.slice(0, 120),
          parsedCount: parsed.length,
          parsedHead: parsed.map((p) => p.slice(0, 30)),
        });
        return parsed;
      } catch (err) {
        const elapsed = Math.round(performance.now() - t0);
        console.error("[wx-ai] suggestions.error", { elapsedMs: elapsed, err });
        throw err;
      }
      /* eslint-enable no-console */
    },
  });

  const regenerate = useCallback(async (): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log("[wx-ai] suggestions.regenerate", { chatId, isGroup });
    await queryClient.invalidateQueries({ queryKey });
  }, [chatId, isGroup, queryClient, queryKey]);

  return {
    suggestions: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    regenerate,
  };
}

interface BuildPromptInput {
  chatLabel: string;
  messages: readonly WechatMessage[];
  isGroup: boolean;
  focusKeys: ReadonlySet<string>;
  messageKey: (msg: WechatMessage, idx: number) => string;
  annotations: Readonly<Record<string, string>>;
}

/**
 * Build a single self-contained prompt the hermes single-shot RPC can
 * answer. We tell the LLM the convention (empty sender = counterparty
 * for private chats; explicit sender names for groups) so it doesn't
 * misattribute. Output format is enforced as numbered lines so the
 * client-side parser can split deterministically.
 *
 * When the user has selected specific messages (`focusKeys` non-empty),
 * those rows are tagged `[需要回复]` in the transcript and the
 * instruction shifts to "directly address the tagged messages". The
 * full transcript still goes in so the LLM has surrounding context,
 * but the focus is unambiguous.
 */
function buildSuggestionsPrompt(input: BuildPromptInput): string {
  const { chatLabel, messages, isGroup, focusKeys, messageKey, annotations } = input;
  const hasFocus = focusKeys.size > 0;

  const transcript = messages
    .map((m, idx) => {
      const key = messageKey(m, idx);
      const rawContent = (m.content ?? "").trim();
      // Voice messages (or any other placeholder content) get replaced
      // by the user's typed annotation when present, so the LLM sees
      // real text instead of "[语音]". Falls through to raw when no
      // annotation exists.
      const annotation = annotations[key];
      const content = annotation && annotation.length > 0 ? annotation : rawContent;
      const focusTag = hasFocus && focusKeys.has(key) ? " [需要回复]" : "";
      if (isGroup) {
        const who = m.sender && m.sender.length > 0 ? m.sender : chatLabel;
        return `${who}: ${content}${focusTag}`;
      }
      // Private chat: empty sender means the counterparty (wx-cli source:
      // src/daemon/query.rs:621-644). Non-empty means me.
      const who = m.sender && m.sender.length > 0 ? "我" : chatLabel;
      return `${who}: ${content}${focusTag}`;
    })
    .join("\n");

  const audience = isGroup
    ? `这是一个群聊「${chatLabel}」的最近消息。`
    : `这是我和「${chatLabel}」在微信上的最近聊天记录。`;

  const instruction = hasFocus
    ? `请帮我生成 3 个简短中文回复候选,**直接回应**标记为 [需要回复] 的消息(其它消息只作背景理解)。每个候选一行,以 "1. " "2. " "3. " 开头,不要任何额外解释。`
    : `请帮我生成 3 个简短中文回复候选,每个一行,以 "1. " "2. " "3. " 开头,不要任何额外解释。`;

  return [
    audience,
    instruction,
    `回复要求:口语化、自然、贴合上下文,长度像日常聊天(10-30 字),不要太正式。`,
    "",
    "聊天记录:",
    transcript,
    "",
    "请生成 3 个候选:",
  ].join("\n");
}

const NUMBERED_LINE = /^\s*([123])\s*[.、)]\s*(.+?)\s*$/;

/**
 * Extract numbered candidate lines from the LLM's free-form reply. We're
 * lenient on punctuation (`.` `、` `)`) and tolerate prose surrounding
 * the list. Returns up to 3 candidates; fewer is OK — the UI handles
 * the empty case explicitly so the user knows to retry.
 */
function parseNumberedReplies(reply: string): readonly string[] {
  const out: string[] = [];
  for (const line of reply.split(/\r?\n/)) {
    const match = NUMBERED_LINE.exec(line);
    if (!match) continue;
    const text = match[2]?.trim();
    if (text) out.push(text);
    if (out.length >= 3) break;
  }
  return out;
}
