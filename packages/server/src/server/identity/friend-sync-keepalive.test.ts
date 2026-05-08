import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import pino from "pino";

import { createFriendSyncKeepaliveController } from "./friend-sync-keepalive.js";

const silentLogger = pino({ level: "silent" });

describe("FriendSyncKeepaliveController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("emits a ping every interval after start", () => {
    const sent: string[] = [];
    let now = 1_000_000;
    const ctrl = createFriendSyncKeepaliveController({
      send: (frame) => sent.push(frame),
      onDead: () => {},
      logger: silentLogger,
      pingIntervalMs: 30_000,
      livenessTimeoutMs: 75_000,
      now: () => now,
    });
    ctrl.start();

    // 0s: timer not fired yet, no ping sent
    expect(sent).toHaveLength(0);

    // 30s: first ping
    now += 30_000;
    vi.advanceTimersByTime(30_000);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toMatchObject({ kind: "friend-sync-keepalive", type: "ping" });

    // peer pongs → keep liveness fresh
    ctrl.tryHandleParsed({ v: 1, kind: "friend-sync-keepalive", type: "pong" });

    // 60s: second ping
    now += 30_000;
    vi.advanceTimersByTime(30_000);
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent[1]!)).toMatchObject({ kind: "friend-sync-keepalive", type: "ping" });

    ctrl.stop();
  });

  test("answers an incoming ping with a pong", () => {
    const sent: string[] = [];
    const ctrl = createFriendSyncKeepaliveController({
      send: (frame) => sent.push(frame),
      onDead: () => {},
      logger: silentLogger,
    });
    ctrl.start();

    const handled = ctrl.tryHandleParsed({ v: 1, kind: "friend-sync-keepalive", type: "ping" });
    expect(handled).toBe(true);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toMatchObject({ kind: "friend-sync-keepalive", type: "pong" });
    ctrl.stop();
  });

  test("returns false for non-keepalive frames so caller can dispatch them", () => {
    const ctrl = createFriendSyncKeepaliveController({
      send: () => {},
      onDead: () => {},
      logger: silentLogger,
    });
    ctrl.start();
    expect(ctrl.tryHandleParsed({ v: 1, kind: "friend-sync-frame", ciphertextB64: "abc" })).toBe(
      false,
    );
    expect(ctrl.tryHandleParsed({ random: "garbage" })).toBe(false);
    ctrl.stop();
  });

  test("calls onDead when no pong arrives within livenessTimeoutMs", () => {
    const sent: string[] = [];
    const onDead = vi.fn();
    let now = 1_000_000;
    const ctrl = createFriendSyncKeepaliveController({
      send: (frame) => sent.push(frame),
      onDead,
      logger: silentLogger,
      pingIntervalMs: 30_000,
      livenessTimeoutMs: 75_000,
      now: () => now,
    });
    ctrl.start();

    // 30s: ping #1, no pong back
    now += 30_000;
    vi.advanceTimersByTime(30_000);
    expect(sent).toHaveLength(1);
    expect(onDead).not.toHaveBeenCalled();

    // 60s: ping #2, still no pong
    now += 30_000;
    vi.advanceTimersByTime(30_000);
    expect(sent).toHaveLength(2);
    expect(onDead).not.toHaveBeenCalled();

    // 90s: tick fires, 90s since last pong > 75s → onDead
    now += 30_000;
    vi.advanceTimersByTime(30_000);
    expect(onDead).toHaveBeenCalledTimes(1);

    ctrl.stop();
  });

  test("incoming pong resets the liveness clock", () => {
    const onDead = vi.fn();
    let now = 1_000_000;
    const ctrl = createFriendSyncKeepaliveController({
      send: () => {},
      onDead,
      logger: silentLogger,
      pingIntervalMs: 30_000,
      livenessTimeoutMs: 75_000,
      now: () => now,
    });
    ctrl.start();

    // 60s: two ticks pass without pong → still alive (60s ≤ 75s)
    now += 60_000;
    vi.advanceTimersByTime(60_000);
    expect(onDead).not.toHaveBeenCalled();

    // pong arrives → resets lastPongAt to current `now` (=60s)
    ctrl.tryHandleParsed({ v: 1, kind: "friend-sync-keepalive", type: "pong" });

    // 90s: tick at 90s, lastPongAt=60s, diff=30s ≤ 75s → alive
    now += 30_000;
    vi.advanceTimersByTime(30_000);
    expect(onDead).not.toHaveBeenCalled();

    // 120s: tick at 120s, lastPongAt=60s, diff=60s ≤ 75s → alive
    now += 30_000;
    vi.advanceTimersByTime(30_000);
    expect(onDead).not.toHaveBeenCalled();

    // 150s: tick at 150s, lastPongAt=60s, diff=90s > 75s → onDead
    now += 30_000;
    vi.advanceTimersByTime(30_000);
    expect(onDead).toHaveBeenCalledTimes(1);

    ctrl.stop();
  });

  test("stop() halts the ping interval", () => {
    const sent: string[] = [];
    const ctrl = createFriendSyncKeepaliveController({
      send: (frame) => sent.push(frame),
      onDead: () => {},
      logger: silentLogger,
      pingIntervalMs: 30_000,
    });
    ctrl.start();
    vi.advanceTimersByTime(30_000);
    expect(sent).toHaveLength(1);
    ctrl.stop();
    vi.advanceTimersByTime(30_000 * 5);
    expect(sent).toHaveLength(1);
  });
});
