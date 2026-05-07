import type { AiShareTimelineEntry } from "./ai-share-types.js";

/**
 * Phase 4 v2/d — friend-side ring buffer for inbound shared-agent
 * timeline entries. One per inviteId on the friend's daemon.
 *
 * In-memory; capped at `MAX_ENTRIES` so a runaway agent on the owner
 * side can't blow up the friend's heap. v2/e adds the auditable
 * transcript on disk; this buffer's role is just to back the friend's
 * UI between polls and across the share's lifetime.
 *
 * Dedupe: we key by `eventId`. If the owner re-sends a timeline frame
 * (flaky friend-sync session), the second arrival is a no-op rather
 * than a duplicate row in the friend's UI.
 */

const MAX_ENTRIES = 500;

export interface AiShareTimelineRecord {
  eventId: string;
  /** Owner's `sentAt` ISO timestamp. */
  sentAt: string;
  /** Friend's local arrival ms since epoch. */
  receivedAtMs: number;
  entry: AiShareTimelineEntry;
}

export class AiShareTimelineStore {
  private readonly buffers = new Map<string, AiShareTimelineRecord[]>();

  append(input: {
    inviteId: string;
    eventId: string;
    sentAt: string;
    entry: AiShareTimelineEntry;
  }): void {
    const buf = this.buffers.get(input.inviteId) ?? [];
    if (buf.some((r) => r.eventId === input.eventId)) return;
    buf.push({
      eventId: input.eventId,
      sentAt: input.sentAt,
      receivedAtMs: Date.now(),
      entry: input.entry,
    });
    while (buf.length > MAX_ENTRIES) buf.shift();
    this.buffers.set(input.inviteId, buf);
  }

  list(inviteId: string): readonly AiShareTimelineRecord[] {
    return this.buffers.get(inviteId) ?? [];
  }

  /** Remove the buffer for an ended share so the heap doesn't grow forever. */
  drop(inviteId: string): void {
    this.buffers.delete(inviteId);
  }
}
