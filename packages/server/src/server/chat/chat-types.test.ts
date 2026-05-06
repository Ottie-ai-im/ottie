import { describe, expect, test } from "vitest";

import {
  ChatMessageSchema,
  ChatRoomSchema,
  isP2pRoom,
  p2pRoomId,
  StoredChatMessageSchema,
  StoredChatRoomSchema,
} from "./chat-types.js";

describe("ChatRoomSchema (Phase 3.b/0 additions)", () => {
  const base = {
    id: "room_1",
    name: "test",
    purpose: null,
    createdAt: "2026-05-05T12:00:00.000Z",
    updatedAt: "2026-05-05T12:00:00.000Z",
  };

  test("accepts the legacy agent-only shape (no new fields)", () => {
    expect(ChatRoomSchema.safeParse(base).success).toBe(true);
  });

  test("accepts kind=p2p with members and ownerRootPubKey", () => {
    const room = {
      ...base,
      kind: "p2p" as const,
      ownerRootPubKey: "x".repeat(43),
      members: [
        {
          rootPubKey: "x".repeat(43),
          role: "owner" as const,
          addedAt: "2026-05-05T12:00:00.000Z",
        },
        {
          rootPubKey: "y".repeat(43),
          role: "member" as const,
          addedAt: "2026-05-05T12:00:01.000Z",
        },
      ],
    };
    const result = ChatRoomSchema.safeParse(room);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("p2p");
      expect(result.data.members).toHaveLength(2);
    }
  });

  test("rejects unknown kind values (forward-compat by enum)", () => {
    const result = ChatRoomSchema.safeParse({ ...base, kind: "broadcast" });
    expect(result.success).toBe(false);
  });

  test("StoredChatRoomSchema still requires epoch and accepts the new fields", () => {
    const stored = {
      ...base,
      epoch: "epoch-1",
      kind: "p2p" as const,
      ownerRootPubKey: "x".repeat(43),
    };
    expect(StoredChatRoomSchema.safeParse(stored).success).toBe(true);

    const noEpoch = { ...base, kind: "p2p" as const };
    expect(StoredChatRoomSchema.safeParse(noEpoch).success).toBe(false);
  });
});

describe("ChatMessageSchema (Phase 3.b/0 additions)", () => {
  const base = {
    id: "msg_1",
    roomId: "room_1",
    authorAgentId: "agent_1",
    body: "hello",
    replyToMessageId: null,
    mentionAgentIds: [],
    createdAt: "2026-05-05T12:00:00.000Z",
  };

  test("accepts the legacy shape unchanged", () => {
    expect(ChatMessageSchema.safeParse(base).success).toBe(true);
  });

  test("accepts new identity fields plus kind=text", () => {
    const msg = {
      ...base,
      authorRootPubKey: "x".repeat(43),
      authorDeviceId: "dev-1",
      kind: "text" as const,
    };
    const result = ChatMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("text");
      expect(result.data.authorRootPubKey).toBe("x".repeat(43));
    }
  });

  test("accepts ai-share/* kinds for Phase 4 forward-compat", () => {
    for (const kind of [
      "ai-share/offer",
      "ai-share/accept",
      "ai-share/reject",
      "ai-share/end",
      "ai-share/prompt",
      "ai-share/chunk",
      "ai-share/error",
      "system",
    ] as const) {
      const result = ChatMessageSchema.safeParse({ ...base, kind });
      expect(result.success, `kind ${kind} should pass`).toBe(true);
    }
  });

  test("rejects unknown kind values", () => {
    const result = ChatMessageSchema.safeParse({ ...base, kind: "voice" });
    expect(result.success).toBe(false);
  });

  test("payload is shape-loose (any kind-specific structured data)", () => {
    const msg = {
      ...base,
      kind: "system" as const,
      payload: { eventType: "member-joined", who: "x".repeat(43) },
    };
    expect(ChatMessageSchema.safeParse(msg).success).toBe(true);
  });

  test("StoredChatMessageSchema still enforces seq+clientMessageId", () => {
    const valid = {
      ...base,
      seq: 1,
      clientMessageId: "cmid-1",
      kind: "text" as const,
    };
    expect(StoredChatMessageSchema.safeParse(valid).success).toBe(true);

    const missingSeq = { ...base, clientMessageId: "cmid-1" };
    expect(StoredChatMessageSchema.safeParse(missingSeq).success).toBe(false);
  });
});

describe("p2pRoomId", () => {
  const ALICE = "x".repeat(43);
  const BOB = "y".repeat(43);

  test("is order-insensitive", () => {
    const a = p2pRoomId({ aRootPubKey: ALICE, bRootPubKey: BOB });
    const b = p2pRoomId({ aRootPubKey: BOB, bRootPubKey: ALICE });
    expect(a).toBe(b);
  });

  test("starts with the p2p: marker so it can't collide with agent-only UUIDs", () => {
    const id = p2pRoomId({ aRootPubKey: ALICE, bRootPubKey: BOB });
    expect(id.startsWith("p2p:")).toBe(true);
  });

  test("trims whitespace before computing the id", () => {
    const a = p2pRoomId({ aRootPubKey: ALICE, bRootPubKey: BOB });
    const b = p2pRoomId({ aRootPubKey: ` ${ALICE} `, bRootPubKey: `\t${BOB}\n` });
    expect(a).toBe(b);
  });

  test("rejects empty pubkeys", () => {
    expect(() => p2pRoomId({ aRootPubKey: "", bRootPubKey: BOB })).toThrow();
    expect(() => p2pRoomId({ aRootPubKey: ALICE, bRootPubKey: "  " })).toThrow();
  });

  test("different pubkeys produce different ids", () => {
    const carol = "z".repeat(43);
    const alice_bob = p2pRoomId({ aRootPubKey: ALICE, bRootPubKey: BOB });
    const alice_carol = p2pRoomId({ aRootPubKey: ALICE, bRootPubKey: carol });
    expect(alice_bob).not.toBe(alice_carol);
  });
});

describe("isP2pRoom", () => {
  test('returns true only for kind === "p2p"', () => {
    expect(isP2pRoom({ kind: "p2p" })).toBe(true);
    expect(isP2pRoom({ kind: "agent-only" })).toBe(false);
    expect(isP2pRoom({ kind: "group" })).toBe(false);
    expect(isP2pRoom({})).toBe(false);
  });

  test("treats unset kind as agent-only (legacy shape)", () => {
    expect(isP2pRoom({ kind: undefined })).toBe(false);
  });
});
