import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, test } from "vitest";

import { p2pRoomId, type ChatMessage } from "../chat/chat-types.js";

import {
  buildFriendChatMessageEnvelope,
  verifyFriendChatMessageEnvelope,
} from "./friend-chat-crypto.js";

interface RootKeys {
  signPublicKeyB64: string;
  signPrivateKey: KeyObject;
}

function mintRootKeys(): RootKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwkPub = publicKey.export({ format: "jwk" }) as { x: string };
  return { signPublicKeyB64: jwkPub.x, signPrivateKey: privateKey };
}

function makeMessage(
  alice: RootKeys,
  bob: RootKeys,
  overrides: Partial<ChatMessage> = {},
): { message: ChatMessage; roomId: string } {
  const roomId = p2pRoomId({
    aRootPubKey: alice.signPublicKeyB64,
    bRootPubKey: bob.signPublicKeyB64,
  });
  const message: ChatMessage = {
    id: "msg_1",
    roomId,
    authorAgentId: "human:alice",
    body: "hello bob",
    replyToMessageId: null,
    mentionAgentIds: [],
    createdAt: "2026-05-06T12:00:00.000Z",
    clientMessageId: "cmid_1",
    authorRootPubKey: alice.signPublicKeyB64,
    authorDeviceId: "srv_alice_phone",
    kind: "text",
    ...overrides,
  };
  return { message, roomId };
}

describe("buildFriendChatMessageEnvelope + verifyFriendChatMessageEnvelope", () => {
  test("roundtrips a signed envelope", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const { message, roomId } = makeMessage(alice, bob);

    const envelope = buildFriendChatMessageEnvelope({
      roomId,
      message,
      authorRootSignPrivateKey: alice.signPrivateKey,
    });

    expect(envelope.kind).toBe("friend-chat-message");
    expect(envelope.roomId).toBe(roomId);
    expect(envelope.authorSignatureB64).toMatch(/^[A-Za-z0-9_-]+$/);

    // Bob receives. Expected peer = Alice. Expected room = same id.
    const outcome = verifyFriendChatMessageEnvelope({
      envelope,
      expectedPeerRootPubKey: alice.signPublicKeyB64,
      expectedRoomId: roomId,
    });
    expect(outcome.ok).toBe(true);
  });

  test("rejects message with wrong peer pubkey (relay substitution defense)", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const eve = mintRootKeys();
    const { message, roomId } = makeMessage(alice, bob);

    const envelope = buildFriendChatMessageEnvelope({
      roomId,
      message,
      authorRootSignPrivateKey: alice.signPrivateKey,
    });

    // Bob receives the envelope on a session he established with EVE
    // (different peer). The envelope claims Alice sent it, but Bob's
    // verifier requires the claimed root to match the session peer.
    const outcome = verifyFriendChatMessageEnvelope({
      envelope,
      expectedPeerRootPubKey: eve.signPublicKeyB64,
      expectedRoomId: roomId,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/does not match peer/i);
  });

  test("rejects message with mismatched roomId", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const carol = mintRootKeys();
    const { message, roomId } = makeMessage(alice, bob);

    const envelope = buildFriendChatMessageEnvelope({
      roomId,
      message,
      authorRootSignPrivateKey: alice.signPrivateKey,
    });

    const wrongRoomId = p2pRoomId({
      aRootPubKey: alice.signPublicKeyB64,
      bRootPubKey: carol.signPublicKeyB64,
    });
    const outcome = verifyFriendChatMessageEnvelope({
      envelope,
      expectedPeerRootPubKey: alice.signPublicKeyB64,
      expectedRoomId: wrongRoomId,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/roomId/i);
  });

  test("rejects message with forged signature (signed by wrong root key)", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const eve = mintRootKeys();
    const { message, roomId } = makeMessage(alice, bob);

    // Eve signs but the message claims it's from Alice. Verifier
    // checks the signature against `message.authorRootPubKey`
    // (which is Alice) — sig won't validate.
    const envelope = buildFriendChatMessageEnvelope({
      roomId,
      message,
      authorRootSignPrivateKey: eve.signPrivateKey,
    });
    const outcome = verifyFriendChatMessageEnvelope({
      envelope,
      expectedPeerRootPubKey: alice.signPublicKeyB64,
      expectedRoomId: roomId,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/signature did not verify/i);
  });

  test("rejects message with tampered body", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const { message, roomId } = makeMessage(alice, bob);

    const envelope = buildFriendChatMessageEnvelope({
      roomId,
      message,
      authorRootSignPrivateKey: alice.signPrivateKey,
    });

    // Mutate the body after signing — sig should fail.
    const tampered = {
      ...envelope,
      message: { ...envelope.message, body: "TAMPERED" },
    };
    const outcome = verifyFriendChatMessageEnvelope({
      envelope: tampered,
      expectedPeerRootPubKey: alice.signPublicKeyB64,
      expectedRoomId: roomId,
    });
    expect(outcome.ok).toBe(false);
  });

  test("requires authorRootPubKey, authorDeviceId, clientMessageId at build time", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();

    const { message: base, roomId } = makeMessage(alice, bob);
    const cases: Array<Partial<ChatMessage>> = [
      { authorRootPubKey: undefined },
      { authorRootPubKey: "" },
      { authorDeviceId: undefined },
      { authorDeviceId: "" },
      { clientMessageId: undefined },
      { clientMessageId: "" },
    ];
    for (const overrides of cases) {
      expect(() =>
        buildFriendChatMessageEnvelope({
          roomId,
          message: { ...base, ...overrides } as ChatMessage,
          authorRootSignPrivateKey: alice.signPrivateKey,
        }),
      ).toThrow(/required/i);
    }
  });

  test("the canonical payload changes when any signed field changes (no collisions)", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const { message, roomId } = makeMessage(alice, bob);

    const original = buildFriendChatMessageEnvelope({
      roomId,
      message,
      authorRootSignPrivateKey: alice.signPrivateKey,
    });

    const variants: Array<{ label: string; mutation: (m: ChatMessage) => ChatMessage }> = [
      { label: "id", mutation: (m) => ({ ...m, id: "msg_other" }) },
      { label: "body", mutation: (m) => ({ ...m, body: "HI" }) },
      { label: "createdAt", mutation: (m) => ({ ...m, createdAt: "2030-01-01T00:00:00.000Z" }) },
      { label: "clientMessageId", mutation: (m) => ({ ...m, clientMessageId: "cmid_other" }) },
      {
        label: "replyToMessageId",
        mutation: (m) => ({ ...m, replyToMessageId: "msg_replied_to" }),
      },
      { label: "kind", mutation: (m) => ({ ...m, kind: "system" as const }) },
    ];

    for (const variant of variants) {
      const mutated = buildFriendChatMessageEnvelope({
        roomId,
        message: variant.mutation(message),
        authorRootSignPrivateKey: alice.signPrivateKey,
      });
      expect(
        mutated.authorSignatureB64,
        `mutating ${variant.label} should change the signature`,
      ).not.toBe(original.authorSignatureB64);
    }
  });

  test("supports unicode body bytes through utf-8 canonical payload", () => {
    const alice = mintRootKeys();
    const bob = mintRootKeys();
    const { message, roomId } = makeMessage(alice, bob, { body: "你好 Bob 👋" });

    const envelope = buildFriendChatMessageEnvelope({
      roomId,
      message,
      authorRootSignPrivateKey: alice.signPrivateKey,
    });
    const outcome = verifyFriendChatMessageEnvelope({
      envelope,
      expectedPeerRootPubKey: alice.signPublicKeyB64,
      expectedRoomId: roomId,
    });
    expect(outcome.ok).toBe(true);
  });
});
