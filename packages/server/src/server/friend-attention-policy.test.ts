import { describe, expect, test } from "vitest";

import { computeFriendNotificationPlan } from "./friend-attention-policy.js";
import { PRESENCE_THRESHOLD_MS } from "./agent-attention-policy.js";

const NOW = 1_700_000_000_000;
const FRESH = NOW - 1_000;
const STALE = NOW - PRESENCE_THRESHOLD_MS - 1_000;

describe("computeFriendNotificationPlan", () => {
  test("pushes when there are no clients at all", () => {
    expect(computeFriendNotificationPlan({ allStates: [], nowMs: NOW })).toEqual({
      inAppRecipientIndex: null,
      shouldPush: true,
    });
  });

  test("pushes when every client is stale", () => {
    expect(
      computeFriendNotificationPlan({
        allStates: [
          { appVisible: false, lastActivityAtMs: STALE, focusedAgentId: null },
          { appVisible: false, lastActivityAtMs: null, focusedAgentId: null },
        ],
        nowMs: NOW,
      }),
    ).toEqual({ inAppRecipientIndex: null, shouldPush: true });
  });

  test("skips push and routes in-app to the freshest present client", () => {
    expect(
      computeFriendNotificationPlan({
        allStates: [
          { appVisible: false, lastActivityAtMs: FRESH - 5_000, focusedAgentId: null },
          { appVisible: true, lastActivityAtMs: FRESH, focusedAgentId: null },
          { appVisible: false, lastActivityAtMs: STALE, focusedAgentId: null },
        ],
        nowMs: NOW,
      }),
    ).toEqual({ inAppRecipientIndex: 1, shouldPush: false });
  });

  test("does not consult focusedAgentId — friend events have no agent context", () => {
    // Even though the visible client is focused on an agent, friend events
    // should still route in-app there (not push). This is the key behavior
    // that distinguishes friend-attention-policy from agent-attention-policy.
    expect(
      computeFriendNotificationPlan({
        allStates: [{ appVisible: true, lastActivityAtMs: FRESH, focusedAgentId: "agent-1" }],
        nowMs: NOW,
      }),
    ).toEqual({ inAppRecipientIndex: 0, shouldPush: false });
  });

  test("clamps lastActivityAtMs to nowMs (defends against clock skew)", () => {
    expect(
      computeFriendNotificationPlan({
        allStates: [{ appVisible: true, lastActivityAtMs: NOW + 60_000, focusedAgentId: null }],
        nowMs: NOW,
      }),
    ).toEqual({ inAppRecipientIndex: 0, shouldPush: false });
  });
});
