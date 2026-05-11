import { useCallback, useState } from "react";

import { useAppSettings } from "@/hooks/use-settings";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

/** Tone presets surfaced as buttons in the rewrite panel. */
export const WECHAT_REWRITE_TONES = [
  "formal",
  "shorter",
  "warmer",
  "professional",
  "cooler",
] as const;

export type WechatRewriteTone = (typeof WECHAT_REWRITE_TONES)[number];

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Per-tone instruction phrase woven into the prompt. Kept in Chinese
 * because the Hermes responses are sent back as plaintext to the user
 * and the user is Chinese-speaking — rendering the tone label in the
 * target language gives the LLM a stronger signal than translating it
 * to English would.
 */
const TONE_INSTRUCTIONS: Readonly<Record<WechatRewriteTone, string>> = {
  formal: "更正式、有礼貌",
  shorter: "更简短、精炼,字数减少 30% 左右",
  warmer: "更亲切、温暖、有人情味",
  professional: "更专业、严谨,但不要变得官腔",
  cooler: "更冷淡、保持距离感,但不要冒犯",
};

export interface UseWechatRewriteResult {
  /** Latest rewrite output, or null when never run / draft cleared. */
  result: string | null;
  /** Tone of the most recent successful rewrite — UI uses this to highlight the active pill. */
  activeTone: WechatRewriteTone | null;
  /** True while a rewrite is in flight (any tone). */
  isLoading: boolean;
  /** True for the SPECIFIC tone that's in flight, used to spin only that pill. */
  pendingTone: WechatRewriteTone | null;
  error: string | null;
  /**
   * Invoke a rewrite. No-ops if `draft` is empty or whitespace-only;
   * concurrent calls cancel: latest call wins (we ignore stale responses
   * by checking the request id).
   */
  rewrite: (input: { draft: string; tone: WechatRewriteTone }) => void;
  /** Clear `result` and `error`. Called by the panel when the user edits the draft. */
  reset: () => void;
}

/**
 * Imperative wrapper for the Hermes single-shot RPC, scoped to a tone-
 * driven rewrite. Deliberately stateful (not react-query) because the
 * value is user-triggered, single-shot, and short-lived — caching by
 * (draft, tone) is overkill for an MVP where the user almost always
 * picks a tone, copies, and moves on.
 *
 * Stale-call protection: every invocation increments a local sequence;
 * the result of a prior call that resolves AFTER a newer one is dropped
 * so the UI never flashes back to an old rewrite.
 */
export function useWechatRewrite(serverId: string | null): UseWechatRewriteResult {
  const client = useHostRuntimeClient(serverId ?? "");
  // The Claude model id the user picked from the WeChat detail page's
  // chip selector. Null = let the daemon pick its sensible default
  // (claude-haiku-4-5). Persisted in AppSettings so it survives reloads.
  const { settings } = useAppSettings();
  const modelId = settings.wechatClaudeModelId;

  const [result, setResult] = useState<string | null>(null);
  const [activeTone, setActiveTone] = useState<WechatRewriteTone | null>(null);
  const [pendingTone, setPendingTone] = useState<WechatRewriteTone | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);

  const reset = useCallback(() => {
    setResult(null);
    setActiveTone(null);
    setError(null);
    // Bumping seq invalidates any in-flight call so its late response
    // doesn't paint over the cleared state.
    setSeq((s) => s + 1);
  }, []);

  const rewrite = useCallback(
    (input: { draft: string; tone: WechatRewriteTone }) => {
      /* eslint-disable no-console */
      console.log("[wx-ai] rewrite.invoked", {
        tone: input.tone,
        hasClient: Boolean(client),
        modelId,
        draftLen: input.draft?.length ?? 0,
        draftHead: (input.draft ?? "").slice(0, 30),
      });
      if (!client) {
        console.warn("[wx-ai] rewrite.bailed — no client");
        setError("Not connected");
        return;
      }
      const draft = input.draft.trim();
      if (draft.length === 0) {
        console.warn("[wx-ai] rewrite.bailed — empty draft after trim");
        return;
      }

      const mySeq = seq + 1;
      setSeq(mySeq);
      setPendingTone(input.tone);
      setError(null);

      const prompt = buildRewritePrompt({ draft, tone: input.tone });
      console.log("[wx-ai] rewrite.dispatching", {
        seq: mySeq,
        tone: input.tone,
        promptLen: prompt.length,
        modelId,
      });
      async function runRewrite(): Promise<void> {
        const t0 = performance.now();
        try {
          const res = await client!.wechatLlmComplete({
            prompt,
            modelId,
            timeoutMs: REQUEST_TIMEOUT_MS,
          });
          const elapsed = Math.round(performance.now() - t0);
          if (res.error) {
            throw new Error(res.error);
          }
          const reply = res.reply ?? "";
          console.log("[wx-ai] rewrite.response", {
            seq: mySeq,
            elapsedMs: elapsed,
            replyLen: reply.length,
            replyHead: reply.slice(0, 80),
          });
          // Drop the result if a newer call has started since we kicked off.
          // Without this guard, a slow first response could overwrite a
          // faster second response, producing UI flicker.
          if (seqWasSuperseded(mySeq, setSeq)) {
            console.log("[wx-ai] rewrite.dropped — superseded by newer call", { seq: mySeq });
            return;
          }
          const cleaned = stripWrapping(reply);
          console.log("[wx-ai] rewrite.cleaned", {
            seq: mySeq,
            cleanedLen: cleaned.length,
            cleanedHead: cleaned.slice(0, 80),
          });
          if (cleaned.length === 0) {
            // Daemon throws WechatLlmError with code "empty_reply" in this
            // case, so we'd normally hit the catch block below. But if the
            // model returned only stripWrapping-able junk (quotes /
            // prefixes / nothing of substance), we land here.
            setError("Claude returned a reply but nothing usable after cleaning.");
            setPendingTone(null);
            return;
          }
          setResult(cleaned);
          setActiveTone(input.tone);
          setPendingTone(null);
        } catch (err: unknown) {
          const elapsed = Math.round(performance.now() - t0);
          console.error("[wx-ai] rewrite.error", { seq: mySeq, elapsedMs: elapsed, err });
          if (seqWasSuperseded(mySeq, setSeq)) return;
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          setPendingTone(null);
        }
      }
      void runRewrite();
      /* eslint-enable no-console */
    },
    [client, modelId, seq],
  );

  return {
    result,
    activeTone,
    isLoading: pendingTone !== null,
    pendingTone,
    error,
    rewrite,
    reset,
  };
}

/**
 * Functional state read for an "is mySeq still the latest seq?" check.
 * `setSeq` here is invoked with an updater that returns the same value,
 * so it doesn't actually mutate state — but it gives us synchronous
 * read access that closures over a stale `seq` lexical wouldn't.
 */
function seqWasSuperseded(
  mySeq: number,
  setSeq: (updater: (current: number) => number) => void,
): boolean {
  let superseded = false;
  setSeq((current) => {
    superseded = current !== mySeq;
    return current;
  });
  return superseded;
}

interface BuildRewritePromptInput {
  draft: string;
  tone: WechatRewriteTone;
}

function buildRewritePrompt(input: BuildRewritePromptInput): string {
  const instruction = TONE_INSTRUCTIONS[input.tone];
  return [
    `请把下面这段微信回复改写得${instruction}。保持原意,只输出改写后的内容,不要任何解释、前缀或引号。`,
    "",
    "原文:",
    input.draft,
    "",
    "改写:",
  ].join("\n");
}

/**
 * Some models echo the "改写:" prefix or wrap output in quotes despite
 * the prompt asking them not to. Strip a small set of known prefixes /
 * surrounding quotes so the user gets a clean string they can paste
 * straight into WeChat without trimming.
 */
function stripWrapping(reply: string): string {
  let text = reply.trim();
  text = text.replace(/^改写[::]\s*/, "");
  text = text.replace(/^改写后[::]\s*/, "");
  text = text.replace(/^[「『"'](.+)[」』"']$/s, "$1");
  return text.trim();
}
