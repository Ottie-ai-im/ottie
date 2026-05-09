import { describe, expect, test } from "vitest";

import {
  buildFriendChatNotificationPayload,
  buildFriendPairNotificationPayload,
} from "./friend-attention-notification.js";

describe("buildFriendPairNotificationPayload", () => {
  test("standard request", () => {
    expect(
      buildFriendPairNotificationPayload({
        serverId: "srv-1",
        peerDisplayName: "Alice",
        peerRootPubKeyB64: "AAA",
        pairNonceB64: "NNN",
      }),
    ).toEqual({
      title: "Friend request",
      body: "Alice wants to add you as a friend.",
      data: {
        serverId: "srv-1",
        reason: "friend_pair_request",
        peerRootPubKeyB64: "AAA",
        pairNonceB64: "NNN",
      },
    });
  });

  test("falls back to a generic name when displayName is empty", () => {
    expect(
      buildFriendPairNotificationPayload({
        serverId: "srv-1",
        peerDisplayName: "   ",
        peerRootPubKeyB64: "AAA",
        pairNonceB64: "NNN",
      }).body,
    ).toBe("Friend wants to add you as a friend.");
  });

  test("clamps absurdly long display names", () => {
    const long = "Q".repeat(120);
    const payload = buildFriendPairNotificationPayload({
      serverId: "srv-1",
      peerDisplayName: long,
      peerRootPubKeyB64: "AAA",
      pairNonceB64: "NNN",
    });
    expect(payload.title).toBe("Friend request");
    // The name portion of the body is clamped to 64 chars including "..."
    // so the whole body fits within (64 name chars + suffix).
    expect(payload.body.length).toBeLessThan(long.length);
    expect(payload.body.startsWith("Q".repeat(61) + "...")).toBe(true);
    expect(payload.body.endsWith(" wants to add you as a friend.")).toBe(true);
  });
});

describe("buildFriendChatNotificationPayload", () => {
  test("title is the peer's display name; body is the message body", () => {
    expect(
      buildFriendChatNotificationPayload({
        serverId: "srv-1",
        peerDisplayName: "Alice",
        peerRootPubKeyB64: "AAA",
        messageBody: "Hello",
        messageId: "m-1",
      }),
    ).toEqual({
      title: "Alice",
      body: "Hello",
      data: {
        serverId: "srv-1",
        reason: "friend_chat_message",
        peerRootPubKeyB64: "AAA",
        messageId: "m-1",
      },
    });
  });

  test("preview collapses whitespace", () => {
    expect(
      buildFriendChatNotificationPayload({
        serverId: "srv-1",
        peerDisplayName: "A",
        peerRootPubKeyB64: "AAA",
        messageBody: "  hi   there \n\n  friend ",
        messageId: "m-1",
      }).body,
    ).toBe("hi there friend");
  });

  test("preview truncates long bodies", () => {
    const long = "x".repeat(500);
    const payload = buildFriendChatNotificationPayload({
      serverId: "srv-1",
      peerDisplayName: "A",
      peerRootPubKeyB64: "AAA",
      messageBody: long,
      messageId: "m-1",
    });
    expect(payload.body.length).toBeLessThan(long.length);
    expect(payload.body.endsWith("...")).toBe(true);
  });

  test("empty body still produces a non-empty preview", () => {
    expect(
      buildFriendChatNotificationPayload({
        serverId: "srv-1",
        peerDisplayName: "A",
        peerRootPubKeyB64: "AAA",
        messageBody: "   ",
        messageId: "m-1",
      }).body,
    ).toBe("(empty message)");
  });
});
