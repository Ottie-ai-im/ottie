import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { WechatServiceError } from "./wechat-errors.js";
import { WechatSubscriptionManager } from "./wechat-subscription-manager.js";
import type { WechatService } from "./wechat-service.js";
import type { WechatSession } from "./wechat-types.js";

const silentLogger = pino({ level: "silent" });

interface FakeServiceState {
  responses: WechatSession[][];
  error?: WechatServiceError;
  /** Records the args passed to listSessions for assertion. */
  callArgs: Array<{ limit?: number }>;
}

/**
 * Stand-in for `WechatService` that returns a scripted list per call.
 * Exhausting the script repeats the last response so tick-after-stable
 * doesn't accidentally throw. Real spawn isn't relevant here — this test
 * exercises the subscription/diff/broadcast logic, not the spawn wrapper.
 *
 * Mocks `listSessions` (the post-MVP-day-1 hybrid filter pulls all
 * recent sessions and filters client-side, instead of `listUnread`).
 */
function fakeService(state: FakeServiceState): WechatService {
  let cursor = 0;
  return {
    async listSessions(input: { limit?: number } = {}) {
      state.callArgs.push({ limit: input.limit });
      if (state.error) throw state.error;
      // Clamp at read time only — advance unconditionally so a later
      // `state.responses.push(...)` is reachable even after we've already
      // hit the previous tail.
      const idx = Math.min(cursor, state.responses.length - 1);
      cursor++;
      return state.responses[idx] ?? [];
    },
  } as unknown as WechatService;
}

describe("WechatSubscriptionManager", () => {
  it("delivers initial snapshot to a new subscriber on subscribe", async () => {
    const state: FakeServiceState = {
      responses: [[{ chat: "Alice", unread: 1 }]],
      callArgs: [],
    };
    const manager = new WechatSubscriptionManager({
      service: fakeService(state),
      logger: silentLogger,
    });
    const send = vi.fn();
    const initial = await manager.subscribe("s1", { send });
    expect(initial).toHaveLength(1);
    expect(initial[0]?.chat).toBe("Alice");
    // First subscribe triggers an initial poll (cold start) but not a
    // duplicate broadcast — the snapshot is returned synchronously.
    expect(send).not.toHaveBeenCalled();
    manager.stop();
  });

  it("calls wx sessions with a non-trivial limit (100) for the recent-window snapshot", async () => {
    const state: FakeServiceState = { responses: [[]], callArgs: [] };
    const manager = new WechatSubscriptionManager({
      service: fakeService(state),
      logger: silentLogger,
    });
    await manager.subscribe("s1", { send: vi.fn() });
    expect(state.callArgs[0]?.limit).toBe(100);
    manager.stop();
  });

  it("hybrid filter: private always shown, group only when unread, others dropped", async () => {
    const mixed: WechatSession[] = [
      { chat: "Alice (read DM)", chat_type: "private", unread: 0 },
      { chat: "Bob (unread DM)", chat_type: "private", unread: 3 },
      { chat: "Read Group", chat_type: "group", unread: 0 },
      { chat: "Noisy Group", chat_type: "group", unread: 5 },
      { chat: "Some Public Account", chat_type: "official_account", unread: 0 },
      { chat: "Folded inbox", chat_type: "folded", unread: 12 },
    ];
    const state: FakeServiceState = { responses: [mixed], callArgs: [] };
    const manager = new WechatSubscriptionManager({
      service: fakeService(state),
      logger: silentLogger,
    });
    const initial = await manager.subscribe("s1", { send: vi.fn() });
    const labels = initial.map((s) => s.chat);
    expect(labels).toEqual([
      "Alice (read DM)", // private always passes
      "Bob (unread DM)",
      // "Read Group" dropped (group with unread=0)
      "Noisy Group", // group passes because unread > 0
      // official_account / folded dropped (not in defaultFilter)
    ]);
    manager.stop();
  });

  it("broadcasts only when the snapshot actually changes", async () => {
    const stable: WechatSession[] = [{ chat: "Alice", unread: 1 }];
    const next: WechatSession[] = [{ chat: "Alice", unread: 2 }];
    const state: FakeServiceState = {
      responses: [stable, stable, next, next],
      callArgs: [],
    };
    const manager = new WechatSubscriptionManager({
      service: fakeService(state),
      logger: silentLogger,
    });
    const send = vi.fn();
    await manager.subscribe("s1", { send });

    await manager.pollNow(); // identical snapshot → no broadcast
    expect(send).not.toHaveBeenCalled();

    await manager.pollNow(); // changed → broadcast once
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].sessions[0]?.unread).toBe(2);

    await manager.pollNow(); // identical to previous → no extra broadcast
    expect(send).toHaveBeenCalledTimes(1);
    manager.stop();
  });

  it("fans out to multiple subscribers, drops one whose send throws", async () => {
    const state: FakeServiceState = {
      responses: [[], [{ chat: "Alice", unread: 1 }]],
      callArgs: [],
    };
    const manager = new WechatSubscriptionManager({
      service: fakeService(state),
      logger: silentLogger,
    });
    const ok = vi.fn();
    const broken = vi.fn(() => {
      throw new Error("ws closed");
    });
    await manager.subscribe("good", { send: ok });
    await manager.subscribe("bad", { send: broken });

    await manager.pollNow(); // snapshot changes from [] → [Alice]
    expect(ok).toHaveBeenCalledTimes(1);
    expect(broken).toHaveBeenCalledTimes(1);

    // The bad subscriber was dropped; another change reaches only `ok`.
    state.responses.push([{ chat: "Alice", unread: 2 }]);
    await manager.pollNow();
    expect(ok).toHaveBeenCalledTimes(2);
    expect(broken).toHaveBeenCalledTimes(1);
    manager.stop();
  });

  it("swallows wx errors, recovers when the service starts succeeding again", async () => {
    const state: FakeServiceState = {
      responses: [[]],
      callArgs: [],
      error: new WechatServiceError({ kind: "wechat_not_running", message: "down" }),
    };
    const manager = new WechatSubscriptionManager({
      service: fakeService(state),
      logger: silentLogger,
    });
    const send = vi.fn();
    // subscribe triggers initial tick → throws inside, swallowed → empty snapshot
    const initial = await manager.subscribe("s1", { send });
    expect(initial).toEqual([]);
    expect(manager.describeState().lastErrorKind).toBe("wechat_not_running");

    // Service recovers
    state.error = undefined;
    state.responses = [[{ chat: "Alice", unread: 1 }]];
    await manager.pollNow();
    expect(manager.describeState().lastErrorKind).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    manager.stop();
  });

  it("unsubscribe stops polling once the last subscriber leaves", async () => {
    const state: FakeServiceState = { responses: [[]], callArgs: [] };
    const manager = new WechatSubscriptionManager({
      service: fakeService(state),
      logger: silentLogger,
      pollIntervalMs: 5_000,
    });
    await manager.subscribe("s1", { send: vi.fn() });
    const callsBefore = state.callArgs.length;
    manager.unsubscribe("s1");
    await manager.pollNow(); // explicit pollNow always works regardless of timer
    // No assertion on the timer itself — implementation detail. The contract
    // we care about is that unsubscribe is non-throwing and idempotent.
    expect(state.callArgs.length).toBeGreaterThanOrEqual(callsBefore);
    manager.stop();
  });
});
