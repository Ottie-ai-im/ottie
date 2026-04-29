// Behavioral tests for ChatSubscriptionManager. These pin the contract that
// PR #3 (client local-store) depends on: subscribe gap-fills correctly,
// dispatched messages stream live to subscribers, authors don't see echoes
// of their own posts, status acks broadcast to other subscribers, and
// reset/epoch detection works when a client carries stale local state.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";

import { ChatCursorStore } from "./chat-cursor-store.js";
import { FileBackedChatService } from "./chat-service.js";
import {
  ChatSubscriptionManager,
  type ChatBroadcastEvent,
  type ChatSubscriber,
} from "./chat-subscription-manager.js";

interface Recorder {
  subscriber: ChatSubscriber;
  events: ChatBroadcastEvent[];
}

function makeRecorder(sessionId: string, clientId: string): Recorder {
  const events: ChatBroadcastEvent[] = [];
  return {
    subscriber: {
      sessionId,
      clientId,
      send: (event) => {
        events.push(event);
      },
    },
    events,
  };
}

describe("ChatSubscriptionManager", () => {
  let ottieHome: string;
  let chatService: FileBackedChatService;
  let cursorStore: ChatCursorStore;
  let manager: ChatSubscriptionManager;
  const logger = pino({ level: "silent" });

  beforeEach(async () => {
    ottieHome = await mkdtemp(path.join(tmpdir(), "ottie-chat-sub-"));
    chatService = new FileBackedChatService({ ottieHome, logger });
    await chatService.initialize();
    cursorStore = new ChatCursorStore({
      rootDir: path.join(ottieHome, "chat", "cursors"),
      logger,
    });
    manager = new ChatSubscriptionManager({ chatService, cursorStore, logger });
    manager.start();
  });

  afterEach(async () => {
    manager.stop();
    await rm(ottieHome, { recursive: true, force: true });
  });

  test("subscribe with sinceSeq=0 returns full history as gap-fill", async () => {
    const room = await chatService.createRoom({ name: "alpha" });
    await chatService.dispatchMessage({ room: room.id, authorAgentId: "x", body: "m1" });
    await chatService.dispatchMessage({ room: room.id, authorAgentId: "x", body: "m2" });

    const recorder = makeRecorder("session-A", "client-A");
    const result = await manager.subscribe(recorder.subscriber, {
      roomId: room.id,
      sinceSeq: 0,
      epoch: room.epoch,
    });

    expect(result.gapFill.map((m) => m.body)).toEqual(["m1", "m2"]);
    expect(result.latestSeq).toBe(2);
    expect(result.reset).toBe(false);
    expect(result.epoch).toBe(room.epoch);
  });

  test("subscribe with sinceSeq=N returns only messages with seq > N", async () => {
    const room = await chatService.createRoom({ name: "since-test" });
    for (let i = 0; i < 5; i++) {
      await chatService.dispatchMessage({
        room: room.id,
        authorAgentId: "x",
        body: `m${i + 1}`,
      });
    }
    const recorder = makeRecorder("session-A", "client-A");
    const result = await manager.subscribe(recorder.subscriber, {
      roomId: room.id,
      sinceSeq: 3,
    });
    expect(result.gapFill.map((m) => m.seq)).toEqual([4, 5]);
  });

  test("subscribe with mismatched epoch sets reset=true and returns full history", async () => {
    const room = await chatService.createRoom({ name: "epoch-test" });
    await chatService.dispatchMessage({ room: room.id, authorAgentId: "x", body: "m1" });
    await chatService.dispatchMessage({ room: room.id, authorAgentId: "x", body: "m2" });

    const recorder = makeRecorder("session-A", "client-A");
    const result = await manager.subscribe(recorder.subscriber, {
      roomId: room.id,
      sinceSeq: 999, // client thinks it has up to seq 999, but...
      epoch: "stale-epoch-from-old-room",
    });

    expect(result.reset).toBe(true);
    expect(result.gapFill).toHaveLength(2); // full history despite sinceSeq=999
    expect(result.epoch).toBe(room.epoch);
  });

  test("subsequently dispatched messages stream live to subscribers", async () => {
    const room = await chatService.createRoom({ name: "live-stream" });
    const recorder = makeRecorder("session-A", "client-A");
    await manager.subscribe(recorder.subscriber, { roomId: room.id, sinceSeq: 0 });

    await chatService.dispatchMessage({ room: room.id, authorAgentId: "agent-bot", body: "live" });

    expect(recorder.events).toHaveLength(1);
    const event = recorder.events[0]!;
    expect(event.type).toBe("chat/message");
    if (event.type !== "chat/message") throw new Error("type narrowing");
    expect(event.payload.roomId).toBe(room.id);
    expect(event.payload.message.body).toBe("live");
    expect(event.payload.message.seq).toBe(1);
  });

  test("authors don't get echoed their own dispatched message", async () => {
    const room = await chatService.createRoom({ name: "no-echo" });
    const author = makeRecorder("session-A", "client-A");
    const observer = makeRecorder("session-B", "client-B");
    await manager.subscribe(author.subscriber, { roomId: room.id, sinceSeq: 0 });
    await manager.subscribe(observer.subscriber, { roomId: room.id, sinceSeq: 0 });

    // Author tells the manager which session is authoring this message.
    const cmid = "cmid-1";
    manager.registerAuthor(cmid, "session-A");
    await chatService.dispatchMessage({
      room: room.id,
      authorAgentId: "x",
      body: "from author",
      clientMessageId: cmid,
    });

    expect(author.events).toEqual([]); // suppressed
    expect(observer.events).toHaveLength(1);
  });

  test("unsubscribe stops further events for that room/session", async () => {
    const room = await chatService.createRoom({ name: "unsub" });
    const recorder = makeRecorder("session-A", "client-A");
    await manager.subscribe(recorder.subscriber, { roomId: room.id, sinceSeq: 0 });

    await chatService.dispatchMessage({ room: room.id, authorAgentId: "x", body: "m1" });
    expect(recorder.events).toHaveLength(1);

    manager.unsubscribe("session-A", room.id);
    await chatService.dispatchMessage({ room: room.id, authorAgentId: "x", body: "m2" });
    expect(recorder.events).toHaveLength(1); // still 1
  });

  test("unsubscribeAll drops every subscription for a session", async () => {
    const a = await chatService.createRoom({ name: "room-a" });
    const b = await chatService.createRoom({ name: "room-b" });
    const recorder = makeRecorder("session-A", "client-A");
    await manager.subscribe(recorder.subscriber, { roomId: a.id, sinceSeq: 0 });
    await manager.subscribe(recorder.subscriber, { roomId: b.id, sinceSeq: 0 });

    manager.unsubscribeAll("session-A");

    await chatService.dispatchMessage({ room: a.id, authorAgentId: "x", body: "m1" });
    await chatService.dispatchMessage({ room: b.id, authorAgentId: "x", body: "m2" });
    expect(recorder.events).toHaveLength(0);
  });

  test("ack(delivered) advances the cursor and broadcasts chat/status to other subscribers", async () => {
    const room = await chatService.createRoom({ name: "ack-broadcast" });
    const author = makeRecorder("session-A", "client-A"); // message author
    const recipient = makeRecorder("session-B", "client-B"); // ackr
    const observer = makeRecorder("session-C", "client-C");

    await manager.subscribe(author.subscriber, { roomId: room.id, sinceSeq: 0 });
    await manager.subscribe(recipient.subscriber, { roomId: room.id, sinceSeq: 0 });
    await manager.subscribe(observer.subscriber, { roomId: room.id, sinceSeq: 0 });

    // A message gets dispatched (author A). Subscribers B and C see it (A is suppressed via authorship).
    manager.registerAuthor("cmid-1", "session-A");
    await chatService.dispatchMessage({
      room: room.id,
      authorAgentId: "agent-author",
      body: "hi",
      clientMessageId: "cmid-1",
    });

    // B acks delivered.
    const result = await manager.ack({
      sessionId: "session-B",
      clientId: "client-B",
      roomId: room.id,
      seq: 1,
      kind: "delivered",
    });
    expect(result.advanced).toBe(true);

    // A and C should each receive a chat/status event. B (the acker) should not.
    const aStatus = author.events.find((e) => e.type === "chat/status");
    const cStatus = observer.events.find((e) => e.type === "chat/status");
    const bStatus = recipient.events.find((e) => e.type === "chat/status");
    expect(aStatus).toBeDefined();
    expect(cStatus).toBeDefined();
    expect(bStatus).toBeUndefined();
    if (aStatus?.type !== "chat/status") throw new Error("type narrowing");
    expect(aStatus.payload.fromClientId).toBe("client-B");
    expect(aStatus.payload.kind).toBe("delivered");
    expect(aStatus.payload.seq).toBe(1);
  });

  test("stale ack does not broadcast", async () => {
    const room = await chatService.createRoom({ name: "stale-ack" });
    const author = makeRecorder("session-A", "client-A");
    const recipient = makeRecorder("session-B", "client-B");
    await manager.subscribe(author.subscriber, { roomId: room.id, sinceSeq: 0 });
    await manager.subscribe(recipient.subscriber, { roomId: room.id, sinceSeq: 0 });

    await chatService.dispatchMessage({ room: room.id, authorAgentId: "x", body: "1" });
    await chatService.dispatchMessage({ room: room.id, authorAgentId: "x", body: "2" });

    // B acks read=2.
    await manager.ack({
      sessionId: "session-B",
      clientId: "client-B",
      roomId: room.id,
      seq: 2,
      kind: "read",
    });
    const eventCountAfterFirstAck = author.events.filter((e) => e.type === "chat/status").length;
    expect(eventCountAfterFirstAck).toBeGreaterThan(0);

    // B re-acks delivered=1 (stale — cursor is already at 2 in both).
    const stale = await manager.ack({
      sessionId: "session-B",
      clientId: "client-B",
      roomId: room.id,
      seq: 1,
      kind: "delivered",
    });
    expect(stale.advanced).toBe(false);
    // Author saw no additional status event.
    const eventCountAfterStale = author.events.filter((e) => e.type === "chat/status").length;
    expect(eventCountAfterStale).toBe(eventCountAfterFirstAck);
  });

  test("re-subscribing the same session replaces the old subscriber record", async () => {
    const room = await chatService.createRoom({ name: "resub" });
    const r1 = makeRecorder("session-A", "client-A");
    await manager.subscribe(r1.subscriber, { roomId: room.id, sinceSeq: 0 });

    // Re-subscribe with a different `send` function (simulating a client
    // reconnect that handed us a fresh recorder).
    const r2 = makeRecorder("session-A", "client-A");
    await manager.subscribe(r2.subscriber, { roomId: room.id, sinceSeq: 0 });

    await chatService.dispatchMessage({
      room: room.id,
      authorAgentId: "x",
      body: "after-reconnect",
    });

    expect(r1.events).toHaveLength(0); // old subscriber dropped
    expect(r2.events).toHaveLength(1);
  });
});
