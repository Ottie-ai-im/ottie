// The shape passed to a plugin's `activate(api)` export. Plugins run in a
// dedicated Worker thread (see plugin-worker-runtime.ts); this is the only
// surface area we promise to keep stable across daemon versions.

import type { EventEmitter } from "node:events";

export interface OttiePluginLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  child: (fields: Record<string, unknown>) => OttiePluginLogger;
}

export interface OttiePluginAPI {
  /** Structured logger; messages bubble up to the daemon log under `plugin/<id>`. */
  logger: OttiePluginLogger;
  /**
   * Receives every outbound WS message the daemon emits.
   * Listen with `events.on("message", cb)` for the firehose, or with the
   * specific `type` (e.g. `events.on("agent_stream", cb)`) to get just the
   * payload of one message kind.
   */
  events: EventEmitter;
}
