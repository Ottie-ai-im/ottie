import type { SessionInboundMessage } from "../../shared/messages.js";

/**
 * Handler signature for a single inbound message kind. Handlers may be sync or
 * async; the router awaits returned promises in `dispatch`.
 *
 * Generic over the message-type discriminator `K` so call sites of
 * `register("schedule/create", ...)` get the narrowed
 * `Extract<SessionInboundMessage, { type: "schedule/create" }>` instead
 * of having to `as any` cast the message inside the handler. The default
 * `K = SessionInboundMessage["type"]` keeps the wide type for callers
 * that genuinely want to dispatch on the full union.
 */
export type RouterHandler<K extends SessionInboundMessage["type"] = SessionInboundMessage["type"]> =
  (msg: Extract<SessionInboundMessage, { type: K }>) => Promise<void> | void;

/**
 * Thrown by `MessageRouter.dispatch` when no handler is registered for `msg.type`.
 *
 * Phase 1 callers catch this (or check `has()` first) and fall through to the
 * legacy `dispatchLegacyInboundMessage` chain in `session.ts` — that's the
 * Strangler-Fig pattern: legacy + new paths coexist behind a flag until every
 * kind has been migrated (Phases 3 / 5).
 */
export class RouterMissError extends Error {
  constructor(public readonly kind: string) {
    super(`No handler registered for kind=${kind}`);
    this.name = "RouterMissError";
  }
}

/**
 * Carve C-1 — `MessageRouter` is the new dispatch surface that replaces the
 * chained `dispatchVoiceAndControlMessage(msg) ?? dispatchAgentLifecycleMessage(msg)
 * ?? ...` cluster at `session.ts:1685-1809`.
 *
 * The router is a thin Map-backed class with explicit registration. In Phase 1
 * it is wired into `session.ts` behind the `OTTIE_USE_NEW_ROUTER` env flag and
 * starts EMPTY (no kinds registered until Task 3 of plan 01-04 lifts the
 * `agent_permission_response` kind via `PermissionHandler`). 100% of inbound
 * traffic continues to flow through the legacy chain until each kind is
 * explicitly migrated.
 *
 * See `.planning/research/ARCHITECTURE.md` §3.3 step C-1 and
 * `.planning/phases/01-architectural-foundations-gating-bug-fixes/01-PATTERNS.md`
 * for the carve rationale.
 */
export class MessageRouter {
  private readonly handlers = new Map<string, RouterHandler>();

  /**
   * Register a handler for a single discriminator kind. Throws on duplicate
   * registration so misconfiguration surfaces at boot, not at dispatch time.
   *
   * The generic on `kind` narrows the handler's `msg` parameter to the
   * matching variant of `SessionInboundMessage` — no `as any` cast
   * needed at the call site.
   */
  register<K extends SessionInboundMessage["type"]>(kind: K, handler: RouterHandler<K>): void {
    if (this.handlers.has(kind)) {
      throw new Error(`Duplicate handler registration for kind=${kind}`);
    }
    // Internally store as the wide-typed version: dispatch only ever
    // delivers a message whose `.type === kind`, so the narrowing is
    // safe regardless of the cast at this boundary. Two-step cast
    // (handler → unknown → wide) because the parameter-bivariance
    // rules make the narrow → wide direction "may be a mistake" to
    // tsc otherwise.
    this.handlers.set(kind, handler as unknown as RouterHandler);
  }

  /**
   * Dispatch an inbound message to the registered handler. Throws
   * `RouterMissError` if no handler is registered — Phase 1 callers should
   * `has()` first and fall through to the legacy chain on miss.
   */
  async dispatch(msg: SessionInboundMessage): Promise<void> {
    const handler = this.handlers.get(msg.type);
    if (!handler) {
      throw new RouterMissError(msg.type);
    }
    await handler(msg);
  }

  /** Predicate: does the router have a handler registered for this kind? */
  has(kind: string): boolean {
    return this.handlers.has(kind);
  }
}
