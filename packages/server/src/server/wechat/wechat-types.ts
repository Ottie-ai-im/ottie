import { z } from "zod";

/**
 * wx-cli `chat_type` enum, mirrored from src/daemon/query.rs (2026-05).
 * `.catch("private")` swallows future variants from wx-cli updates rather
 * than crashing daemon parsing — the WeChat sidebar treats unknowns as
 * private chats, which is the safest default for routing AI suggestions.
 */
export const WechatChatTypeSchema = z
  .enum(["private", "group", "official_account", "folded"])
  .catch("private");

export type WechatChatType = z.infer<typeof WechatChatTypeSchema>;

/**
 * One row from `wx sessions --json` and `wx unread --json`. Every field is
 * `.optional()` per the repo-wide backward-compat rule (CLAUDE.md) and to
 * absorb wx-cli schema drift without crashing. Top-level `passthrough`
 * preserves unknown fields so forward-compat consumers see them without a
 * schema bump first.
 */
export const WechatSessionSchema = z
  .object({
    chat: z.string().optional(),
    username: z.string().optional(),
    is_group: z.boolean().optional(),
    chat_type: WechatChatTypeSchema.optional(),
    unread: z.number().int().nonnegative().optional(),
    last_msg_type: z.string().optional(),
    last_sender: z.string().optional(),
    summary: z.string().optional(),
    timestamp: z.number().int().optional(),
    time: z.string().optional(),
  })
  .passthrough();

export type WechatSession = z.infer<typeof WechatSessionSchema>;

export const WechatSessionListSchema = z.array(WechatSessionSchema);

/**
 * One row from `wx history --json` and `wx new-messages --json`.
 *
 * `sender` is empty when the message came from the chat counterparty in a
 * private chat (wx-cli source: src/daemon/query.rs:621-644). In group chats
 * `sender` is always the display name of the author — including for
 * self-sent messages — so detecting "did I reply" inside a group needs a
 * separate signal that wx-cli doesn't expose. The MVP sidesteps this by
 * keying its sidebar off `wx unread`, which already drops sessions whose
 * unread count went to zero (read or replied).
 */
export const WechatMessageSchema = z
  .object({
    chat: z.string().optional(),
    username: z.string().optional(),
    is_group: z.boolean().optional(),
    chat_type: WechatChatTypeSchema.optional(),
    timestamp: z.number().int().optional(),
    time: z.string().optional(),
    sender: z.string().optional(),
    content: z.string().optional(),
    type: z.string().optional(),
    local_id: z.number().int().optional(),
  })
  .passthrough();

export type WechatMessage = z.infer<typeof WechatMessageSchema>;

export const WechatMessageListSchema = z.array(WechatMessageSchema);
