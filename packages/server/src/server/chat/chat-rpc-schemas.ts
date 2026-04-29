import { z } from "zod";
import { ChatCursorKindSchema, ChatRoomCursorSchema } from "./chat-cursor-store.js";
import { ChatMessageSchema, ChatRoomDetailSchema } from "./chat-types.js";

export const ChatCreateRequestSchema = z.object({
  type: z.literal("chat/create"),
  requestId: z.string(),
  name: z.string(),
  purpose: z.string().optional(),
});

export const ChatListRequestSchema = z.object({
  type: z.literal("chat/list"),
  requestId: z.string(),
});

export const ChatInspectRequestSchema = z.object({
  type: z.literal("chat/inspect"),
  requestId: z.string(),
  room: z.string(),
});

export const ChatDeleteRequestSchema = z.object({
  type: z.literal("chat/delete"),
  requestId: z.string(),
  room: z.string(),
});

export const ChatPostRequestSchema = z.object({
  type: z.literal("chat/post"),
  requestId: z.string(),
  room: z.string(),
  body: z.string(),
  authorAgentId: z.string().optional(),
  replyToMessageId: z.string().optional(),
  /**
   * Client-supplied UUID for the new message. Required for retry idempotency
   * (a duplicate post with the same id is a no-op) and for the subscription
   * manager to suppress echoing the message back to the author. Optional on
   * the wire so old clients keep working — old clients simply forfeit the
   * idempotency guarantee.
   */
  clientMessageId: z.string().optional(),
});

export const ChatReadRequestSchema = z.object({
  type: z.literal("chat/read"),
  requestId: z.string(),
  room: z.string(),
  limit: z.number().int().nonnegative().optional(),
  since: z.string().optional(),
  authorAgentId: z.string().optional(),
});

export const ChatWaitRequestSchema = z.object({
  type: z.literal("chat/wait"),
  requestId: z.string(),
  room: z.string(),
  afterMessageId: z.string().optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
});

export const ChatCreateResponseSchema = z.object({
  type: z.literal("chat/create/response"),
  payload: z.object({
    requestId: z.string(),
    room: ChatRoomDetailSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const ChatListResponseSchema = z.object({
  type: z.literal("chat/list/response"),
  payload: z.object({
    requestId: z.string(),
    rooms: z.array(ChatRoomDetailSchema),
    error: z.string().nullable(),
  }),
});

export const ChatInspectResponseSchema = z.object({
  type: z.literal("chat/inspect/response"),
  payload: z.object({
    requestId: z.string(),
    room: ChatRoomDetailSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const ChatDeleteResponseSchema = z.object({
  type: z.literal("chat/delete/response"),
  payload: z.object({
    requestId: z.string(),
    room: ChatRoomDetailSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const ChatPostResponseSchema = z.object({
  type: z.literal("chat/post/response"),
  payload: z.object({
    requestId: z.string(),
    message: ChatMessageSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const ChatReadResponseSchema = z.object({
  type: z.literal("chat/read/response"),
  payload: z.object({
    requestId: z.string(),
    messages: z.array(ChatMessageSchema),
    error: z.string().nullable(),
  }),
});

export const ChatWaitResponseSchema = z.object({
  type: z.literal("chat/wait/response"),
  payload: z.object({
    requestId: z.string(),
    messages: z.array(ChatMessageSchema),
    timedOut: z.boolean(),
    error: z.string().nullable(),
  }),
});

// ─── PR #2 additions: incremental sync + delivery/read receipts ────────────

/**
 * Subscribe a session to live updates for one or more rooms. The server
 * returns gap-fill messages (everything with seq > sinceSeq) synchronously,
 * then streams subsequent messages as `chat/message` events until the
 * session unsubscribes or disconnects.
 *
 * `epoch` is the epoch the client believes this room has. If it doesn't
 * match the server's current epoch, the response carries `reset: true` and
 * the gapFill is the full history — the client must discard whatever it had
 * cached locally for this room.
 */
export const ChatSubscribeRequestSchema = z.object({
  type: z.literal("chat/subscribe"),
  requestId: z.string(),
  rooms: z.array(
    z.object({
      roomId: z.string(),
      sinceSeq: z.number().int().nonnegative(),
      epoch: z.string().optional(),
    }),
  ),
});

export const ChatSubscribeRoomResultSchema = z.object({
  roomId: z.string(),
  reset: z.boolean(),
  epoch: z.string(),
  latestSeq: z.number().int().nonnegative(),
  gapFill: z.array(ChatMessageSchema),
  /** If non-null, this room couldn't be resolved (e.g. deleted concurrently). */
  error: z.string().nullable(),
});

export const ChatSubscribeResponseSchema = z.object({
  type: z.literal("chat/subscribe/response"),
  payload: z.object({
    requestId: z.string(),
    rooms: z.array(ChatSubscribeRoomResultSchema),
    error: z.string().nullable(),
  }),
});

export const ChatUnsubscribeRequestSchema = z.object({
  type: z.literal("chat/unsubscribe"),
  requestId: z.string(),
  rooms: z.array(z.string()),
});

export const ChatUnsubscribeResponseSchema = z.object({
  type: z.literal("chat/unsubscribe/response"),
  payload: z.object({
    requestId: z.string(),
    error: z.string().nullable(),
  }),
});

/**
 * Acknowledge delivery or read of a message. `seq` is the highest seq the
 * client has seen/read for this room. The server enforces "cursors only
 * advance" — stale acks are silently dropped — so clients can replay acks
 * after a reconnect without harm.
 */
export const ChatAckRequestSchema = z.object({
  type: z.literal("chat/ack"),
  requestId: z.string(),
  roomId: z.string(),
  seq: z.number().int().nonnegative(),
  kind: ChatCursorKindSchema,
});

export const ChatAckResponseSchema = z.object({
  type: z.literal("chat/ack/response"),
  payload: z.object({
    requestId: z.string(),
    advanced: z.boolean(),
    cursor: ChatRoomCursorSchema.nullable(),
    error: z.string().nullable(),
  }),
});

/**
 * Server-pushed live message event. Sent only to subscribed sessions
 * (excluding the authoring session — authors get the message via
 * chat/post/response).
 */
export const ChatMessageEventSchema = z.object({
  type: z.literal("chat/message"),
  payload: z.object({
    roomId: z.string(),
    message: ChatMessageSchema,
  }),
});

/**
 * Server-pushed status event. Tells the recipient "client X has
 * delivered/read up to seq N in room Y" so the recipient can update its
 * own send-status indicators (✓ → ✓✓).
 */
export const ChatStatusEventSchema = z.object({
  type: z.literal("chat/status"),
  payload: z.object({
    roomId: z.string(),
    seq: z.number().int().nonnegative(),
    kind: ChatCursorKindSchema,
    fromClientId: z.string(),
  }),
});
