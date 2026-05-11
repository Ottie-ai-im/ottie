import { z } from "zod";

import { WechatChatTypeSchema, WechatMessageSchema, WechatSessionSchema } from "./wechat-types.js";

/**
 * RPC + push-event schemas for the WeChat sidebar feature. All payload
 * fields are `.optional()` per the repo-wide WS backward-compat rule
 * (CLAUDE.md): old daemons that don't populate a field, or new fields added
 * later, must keep parsing on both sides without crashing.
 *
 * Schema naming follows the chat-rpc-schemas convention:
 *   <topic>/<verb>            request   (client → server)
 *   <topic>/<verb>/response   response  (server → client)
 *   <topic>/<noun>            push event (server → client)
 */

// ─── Setup state ────────────────────────────────────────────────────────

/**
 * Coarse setup state for the Setup Wizard. Surfaces "what's missing right
 * now?" so the UI can render the right copyable Terminal command. Mirrors
 * the WechatErrorKind discriminator on the daemon side, plus an explicit
 * `ready` for the green-light case.
 */
export const WechatSetupStatusSchema = z
  .enum([
    "ready",
    "binary_not_found",
    "not_initialized",
    "wechat_not_running",
    "codesign_required",
    "daemon_timeout",
    "permission_denied",
    "unknown",
  ])
  .catch("unknown");

export type WechatSetupStatus = z.infer<typeof WechatSetupStatusSchema>;

export const WechatStateRequestSchema = z.object({
  type: z.literal("wechat/state"),
  requestId: z.string(),
});

export const WechatStateResponseSchema = z.object({
  type: z.literal("wechat/state/response"),
  payload: z.object({
    requestId: z.string(),
    status: WechatSetupStatusSchema.optional(),
    /** Human-readable detail surfaced to the wizard (one-line, localised on the client). */
    detail: z.string().nullable().optional(),
    /** wx-cli daemon process id, when running. */
    daemonPid: z.number().int().nullable().optional(),
    error: z.string().nullable(),
  }),
});

// ─── Subscribe / unsubscribe to live unread updates ─────────────────────

/**
 * Opt the session in to live `wechat/unread_update` push events. The
 * response carries the current unread snapshot so the client can paint
 * immediately without a separate list call. Idempotent — re-subscribing
 * just re-sends the snapshot.
 */
export const WechatSubscribeRequestSchema = z.object({
  type: z.literal("wechat/subscribe"),
  requestId: z.string(),
  /**
   * Optional filter forwarded to `wx unread --filter`. Defaults to
   * `["private", "group"]` on the daemon (real human chats only,
   * suppressing official accounts and the folded inbox).
   */
  filter: z.array(WechatChatTypeSchema).optional(),
});

export const WechatSubscribeResponseSchema = z.object({
  type: z.literal("wechat/subscribe/response"),
  payload: z.object({
    requestId: z.string(),
    sessions: z.array(WechatSessionSchema).optional(),
    error: z.string().nullable(),
  }),
});

export const WechatUnsubscribeRequestSchema = z.object({
  type: z.literal("wechat/unsubscribe"),
  requestId: z.string(),
});

export const WechatUnsubscribeResponseSchema = z.object({
  type: z.literal("wechat/unsubscribe/response"),
  payload: z.object({
    requestId: z.string(),
    error: z.string().nullable(),
  }),
});

// ─── One-shot list (no subscription) ────────────────────────────────────

export const WechatListUnreadRequestSchema = z.object({
  type: z.literal("wechat/list_unread"),
  requestId: z.string(),
  filter: z.array(WechatChatTypeSchema).optional(),
  limit: z.number().int().positive().optional(),
});

export const WechatListUnreadResponseSchema = z.object({
  type: z.literal("wechat/list_unread/response"),
  payload: z.object({
    requestId: z.string(),
    sessions: z.array(WechatSessionSchema).optional(),
    error: z.string().nullable(),
  }),
});

// ─── Read history of one chat ───────────────────────────────────────────

export const WechatReadHistoryRequestSchema = z.object({
  type: z.literal("wechat/read_history"),
  requestId: z.string(),
  /** Display name OR wxid OR `<hash>@chatroom`. */
  chat: z.string(),
  limit: z.number().int().positive().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
});

export const WechatReadHistoryResponseSchema = z.object({
  type: z.literal("wechat/read_history/response"),
  payload: z.object({
    requestId: z.string(),
    messages: z.array(WechatMessageSchema).optional(),
    error: z.string().nullable(),
  }),
});

// ─── One-shot Claude completion (post-MVP-day-1 fix) ───────────────────

/**
 * Bypasses Hermes entirely — runs the prompt through the user's
 * already-authed Claude provider via `@anthropic-ai/claude-agent-sdk`.
 * Day-1 testing showed Hermes is often misconfigured for real users
 * even when Claude is "Available" in the Providers panel.
 */
export const WechatLlmCompleteRequestSchema = z.object({
  type: z.literal("wechat/llm_complete"),
  requestId: z.string(),
  prompt: z.string().min(1),
  modelId: z.string().nullable().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const WechatLlmCompleteResponseSchema = z.object({
  type: z.literal("wechat/llm_complete/response"),
  payload: z.object({
    requestId: z.string(),
    reply: z.string().optional(),
    /** Mirrors `WechatLlmError.code` so the client can render typed errors. */
    errorCode: z.string().nullable().optional(),
    error: z.string().nullable(),
  }),
});

// ─── Push event ─────────────────────────────────────────────────────────

/**
 * Server pushes the latest unread snapshot whenever the polled state
 * changes (every poll cycle that produces a different list). Sent only
 * to sessions that have called `wechat/subscribe`. The full list is
 * idempotent — clients should replace local state, not diff.
 */
export const WechatUnreadUpdateSchema = z.object({
  type: z.literal("wechat/unread_update"),
  payload: z.object({
    sessions: z.array(WechatSessionSchema).optional(),
    /** Server-side wall-clock at the moment the snapshot was captured. */
    capturedAt: z.string().optional(),
  }),
});
