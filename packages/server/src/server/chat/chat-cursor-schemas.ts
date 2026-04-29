// Pure-zod schemas for chat cursors. Lives separate from
// chat-cursor-store.ts (which depends on node:crypto / node:fs) so the
// shared messages module — and the React Native client bundle that pulls
// it in — can import these without dragging Node builtins through Metro.

import { z } from "zod";

export const ChatCursorKindSchema = z.enum(["delivered", "read"]);
export type ChatCursorKind = z.infer<typeof ChatCursorKindSchema>;

export const ChatRoomCursorSchema = z.object({
  lastDeliveredSeq: z.number().int().nonnegative(),
  lastReadSeq: z.number().int().nonnegative(),
  updatedAt: z.string(),
});

export type ChatRoomCursor = z.infer<typeof ChatRoomCursorSchema>;
