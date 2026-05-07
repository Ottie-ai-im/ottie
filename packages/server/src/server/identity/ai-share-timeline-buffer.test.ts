import { describe, expect, test } from "vitest";

import { AiShareTimelineStore } from "./ai-share-timeline-buffer.js";

describe("AiShareTimelineStore", () => {
  test("appends, lists, and segregates by inviteId", () => {
    const store = new AiShareTimelineStore();
    store.append({
      inviteId: "ais_a",
      eventId: "e1",
      sentAt: "2026-05-07T03:04:00.000Z",
      entry: { kind: "assistant_message", text: "hi" },
    });
    store.append({
      inviteId: "ais_b",
      eventId: "e1",
      sentAt: "2026-05-07T03:04:00.000Z",
      entry: { kind: "turn_started" },
    });
    expect(store.list("ais_a")).toHaveLength(1);
    expect(store.list("ais_b")).toHaveLength(1);
    expect(store.list("ais_unknown")).toHaveLength(0);
  });

  test("dedupes re-deliveries by eventId", () => {
    const store = new AiShareTimelineStore();
    const args = {
      inviteId: "ais_a",
      eventId: "e1",
      sentAt: "2026-05-07T03:04:00.000Z",
      entry: { kind: "assistant_message" as const, text: "hello" },
    };
    store.append(args);
    store.append(args);
    expect(store.list("ais_a")).toHaveLength(1);
  });

  test("drop clears a buffer", () => {
    const store = new AiShareTimelineStore();
    store.append({
      inviteId: "ais_a",
      eventId: "e1",
      sentAt: "2026-05-07T03:04:00.000Z",
      entry: { kind: "turn_started" },
    });
    store.drop("ais_a");
    expect(store.list("ais_a")).toHaveLength(0);
  });
});
