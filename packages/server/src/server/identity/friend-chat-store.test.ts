import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { p2pRoomId, type ChatMessage } from "../chat/chat-types.js";

import {
  appendFriendChatMessage,
  friendChatFilePath,
  listFriendChatMessages,
  listFriendChatPeers,
} from "./friend-chat-store.js";

const ALICE_ROOT = "x".repeat(43);
const BOB_ROOT = "y".repeat(43);
const CAROL_ROOT = "z".repeat(43);

function makeMessage(
  authorRootPubKey: string,
  recipientRootPubKey: string,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  const roomId = p2pRoomId({ aRootPubKey: authorRootPubKey, bRootPubKey: recipientRootPubKey });
  return {
    id: "msg_1",
    roomId,
    authorAgentId: "human:author",
    body: "hello",
    replyToMessageId: null,
    mentionAgentIds: [],
    createdAt: "2026-05-06T12:00:00.000Z",
    clientMessageId: "cmid_1",
    authorRootPubKey,
    authorDeviceId: "srv_author",
    kind: "text",
    ...overrides,
  };
}

describe("appendFriendChatMessage / listFriendChatMessages", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), "ottie-friend-chat-store-"));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  test("returns empty when no history exists yet", () => {
    expect(listFriendChatMessages(tempHome, BOB_ROOT)).toEqual([]);
  });

  test("appends a single line and lists it back", () => {
    const message = makeMessage(ALICE_ROOT, BOB_ROOT);
    const stored = appendFriendChatMessage(tempHome, BOB_ROOT, {
      message,
      authorSignatureB64: "sig_a",
      persistedAt: "2026-05-06T12:00:01.000Z",
    });
    expect(stored.storedSeq).toBe(1);

    const list = listFriendChatMessages(tempHome, BOB_ROOT);
    expect(list).toHaveLength(1);
    expect(list[0]?.message.body).toBe("hello");
    expect(list[0]?.authorSignatureB64).toBe("sig_a");
    expect(list[0]?.storedSeq).toBe(1);
  });

  test("storedSeq monotonically increments across appends", () => {
    for (let i = 1; i <= 4; i++) {
      const m = makeMessage(ALICE_ROOT, BOB_ROOT, {
        id: `msg_${i}`,
        body: `line ${i}`,
        clientMessageId: `cmid_${i}`,
      });
      appendFriendChatMessage(tempHome, BOB_ROOT, {
        message: m,
        authorSignatureB64: "sig",
        persistedAt: new Date(1_700_000_000_000 + i).toISOString(),
      });
    }
    const list = listFriendChatMessages(tempHome, BOB_ROOT);
    expect(list.map((l) => l.storedSeq)).toEqual([1, 2, 3, 4]);
    expect(list.map((l) => l.message.body)).toEqual(["line 1", "line 2", "line 3", "line 4"]);
  });

  test("separate peers go into separate files", () => {
    const m1 = makeMessage(ALICE_ROOT, BOB_ROOT);
    const m2 = makeMessage(ALICE_ROOT, CAROL_ROOT, { id: "msg_carol", body: "hi carol" });
    appendFriendChatMessage(tempHome, BOB_ROOT, {
      message: m1,
      authorSignatureB64: "sig",
      persistedAt: "2026-05-06T12:00:01.000Z",
    });
    appendFriendChatMessage(tempHome, CAROL_ROOT, {
      message: m2,
      authorSignatureB64: "sig",
      persistedAt: "2026-05-06T12:00:02.000Z",
    });

    expect(listFriendChatMessages(tempHome, BOB_ROOT)).toHaveLength(1);
    expect(listFriendChatMessages(tempHome, CAROL_ROOT)).toHaveLength(1);
    expect(listFriendChatMessages(tempHome, BOB_ROOT)[0]?.message.body).toBe("hello");
    expect(listFriendChatMessages(tempHome, CAROL_ROOT)[0]?.message.body).toBe("hi carol");
  });

  test("file is written with restrictive mode (0o600)", () => {
    appendFriendChatMessage(tempHome, BOB_ROOT, {
      message: makeMessage(ALICE_ROOT, BOB_ROOT),
      authorSignatureB64: "sig",
      persistedAt: "2026-05-06T12:00:01.000Z",
    });
    const filePath = friendChatFilePath(tempHome, BOB_ROOT);
    const stat = require("node:fs").statSync(filePath);
    // File mode includes the type bits; mask to permission bits.
    expect(stat.mode & 0o777).toBe(0o600);
  });

  test("peer rootPubKey is not exposed in the file path", () => {
    const filePath = friendChatFilePath(tempHome, BOB_ROOT);
    // Path contains a sha256 prefix, NOT the raw pubkey.
    expect(filePath.includes(BOB_ROOT)).toBe(false);
    expect(filePath).toMatch(/[0-9a-f]{32}\.jsonl$/);
  });

  test("survives a corrupt line by skipping it (logs but doesn't throw)", () => {
    const filePath = friendChatFilePath(tempHome, BOB_ROOT);
    require("node:fs").mkdirSync(path.dirname(filePath), { recursive: true });
    // Mix of valid + corrupt lines.
    const goodMessage = makeMessage(ALICE_ROOT, BOB_ROOT, { id: "msg_good", body: "ok" });
    const goodLine = JSON.stringify({
      message: goodMessage,
      authorSignatureB64: "sig",
      persistedAt: "2026-05-06T12:00:01.000Z",
      storedSeq: 1,
    });
    writeFileSync(filePath, `not json {{{\n${goodLine}\n{"missing": "fields"}\n`);
    const list = listFriendChatMessages(tempHome, BOB_ROOT);
    expect(list).toHaveLength(1);
    expect(list[0]?.message.body).toBe("ok");
  });
});

describe("listFriendChatPeers", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), "ottie-friend-chat-store-"));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  test("returns empty when chat dir is missing", () => {
    expect(listFriendChatPeers(tempHome)).toEqual([]);
  });

  test("returns one digest per peer with history", () => {
    appendFriendChatMessage(tempHome, BOB_ROOT, {
      message: makeMessage(ALICE_ROOT, BOB_ROOT),
      authorSignatureB64: "sig",
      persistedAt: "2026-05-06T12:00:01.000Z",
    });
    appendFriendChatMessage(tempHome, CAROL_ROOT, {
      message: makeMessage(ALICE_ROOT, CAROL_ROOT),
      authorSignatureB64: "sig",
      persistedAt: "2026-05-06T12:00:02.000Z",
    });
    const digests = listFriendChatPeers(tempHome);
    expect(digests).toHaveLength(2);
    for (const d of digests) {
      expect(d).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});
