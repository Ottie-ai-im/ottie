import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type pino from "pino";

import { DeviceListEventSchema, type DeviceListEvent } from "./device-list-event-types.js";

/**
 * Phase 2.f/1 — append-only on-disk log of device-list events. Stored
 * at `$OTTIE_HOME/identity/events.json` alongside root.json /
 * self-device.json / devices.json.
 *
 * What this store gives the daemon:
 *   - Persistence: events emitted locally survive a restart (Phase 2.f/2
 *     will replay un-broadcast ones to peers on reconnect).
 *   - `nextSelfSeq()`: next monotonic seq number for events this daemon
 *     emits. Derived from the highest seq in the log whose
 *     sourceDeviceId == this device.
 *   - `lastSeenSeqBySource()`: the per-source high-water mark used by
 *     `applyDeviceListEvent` to drop stale replays.
 *
 * What this store deliberately does NOT do:
 *   - Cap, GC, or compact the log. Until peer-sync ships and confirms
 *     replay-from-disk works, we keep every event for debuggability.
 *     A single user with sane usage emits a handful of events per year;
 *     the file will stay tiny.
 *   - Track which events have been broadcast vs not — that's Phase
 *     2.f/2's transport layer responsibility.
 *
 * Concurrency: single-writer (only this daemon's IdentityService).
 * Format on disk: pretty-printed JSON, mode 0o600, identity dir 0o700.
 */

const IDENTITY_DIRNAME = "identity";
const EVENTS_FILENAME = "events.json";

const EventsFileSchema = z.object({
  v: z.literal(1),
  events: z.array(DeviceListEventSchema),
});

export type EventsFile = z.infer<typeof EventsFileSchema>;

export function eventsFilePath(ottieHome: string): string {
  return path.join(ottieHome, IDENTITY_DIRNAME, EVENTS_FILENAME);
}

/**
 * Returns the on-disk log if it exists and parses cleanly. Returns null
 * for a fresh install (no log yet). Throws on corrupt file — callers
 * should not silently regenerate (we'd lose the seq-monotonic invariant
 * and could re-emit duplicate events with old seq numbers).
 */
export function loadEventsFile(ottieHome: string, logger?: pino.Logger): EventsFile | null {
  const log = logger?.child({ module: "device-list-events" });
  const filePath = eventsFilePath(ottieHome);
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf8");
  const parsed = EventsFileSchema.parse(JSON.parse(raw));
  log?.info({ filePath, count: parsed.events.length }, "Loaded device-list events");
  return parsed;
}

export function saveEventsFile(ottieHome: string, file: EventsFile, logger?: pino.Logger): void {
  const log = logger?.child({ module: "device-list-events" });
  const filePath = eventsFilePath(ottieHome);
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  log?.debug({ filePath, count: file.events.length }, "Saved device-list events");
}

/**
 * In-memory wrapper around the on-disk events log. Holds the events
 * array and the derived high-water marks. All mutations write through
 * to disk synchronously.
 */
export class DeviceListEventStore {
  private events: DeviceListEvent[];
  private readonly ottieHome: string;
  private readonly logger: pino.Logger | undefined;

  private constructor(ottieHome: string, events: DeviceListEvent[], logger?: pino.Logger) {
    this.ottieHome = ottieHome;
    this.events = events;
    this.logger = logger?.child({ module: "device-list-events" });
  }

  static loadOrCreate(ottieHome: string, logger?: pino.Logger): DeviceListEventStore {
    const existing = loadEventsFile(ottieHome, logger);
    return new DeviceListEventStore(ottieHome, existing?.events ?? [], logger);
  }

  /** Snapshot of the current event log — read-only for callers. */
  list(): readonly DeviceListEvent[] {
    return this.events;
  }

  /**
   * Highest seq this daemon has ever used for events it emitted itself.
   * `nextSelfSeq()` returns `+ 1` of this. Returns 0 if this daemon has
   * never emitted an event under `selfDeviceId`.
   */
  highestSeqForSource(deviceId: string): number {
    let max = 0;
    for (const event of this.events) {
      if (event.sourceDeviceId === deviceId && event.seq > max) max = event.seq;
    }
    return max;
  }

  nextSelfSeq(selfDeviceId: string): number {
    return this.highestSeqForSource(selfDeviceId) + 1;
  }

  /**
   * Map of every source we've seen → max seq from that source. Used as
   * `lastSeenSeqBySource` input to `applyDeviceListEvent` so replayed
   * events get dropped as no-ops. Returned as a fresh object so callers
   * can pass it directly without mutating internal state.
   */
  lastSeenSeqBySource(): Record<string, number> {
    const map: Record<string, number> = {};
    for (const event of this.events) {
      const cur = map[event.sourceDeviceId] ?? 0;
      if (event.seq > cur) map[event.sourceDeviceId] = event.seq;
    }
    return map;
  }

  /**
   * Append an event to the log and flush to disk. No validation here —
   * callers already verified the signature (for inbound) or just signed
   * it themselves (for outbound). Returns the new log size for logging.
   */
  append(event: DeviceListEvent): number {
    this.events = [...this.events, event];
    saveEventsFile(this.ottieHome, { v: 1, events: this.events }, this.logger);
    this.logger?.info(
      {
        kind: event.kind,
        seq: event.seq,
        sourceDeviceIdPrefix: event.sourceDeviceId.slice(0, 8),
      },
      "Appended device-list event",
    );
    return this.events.length;
  }
}
