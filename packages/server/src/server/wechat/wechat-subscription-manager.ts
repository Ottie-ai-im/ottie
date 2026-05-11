import type { Logger } from "pino";

import { WechatServiceError, type WechatErrorKind } from "./wechat-errors.js";
import type { WechatService } from "./wechat-service.js";
import type { WechatChatType, WechatSession } from "./wechat-types.js";

/**
 * Push payload broadcast to subscribed sessions whenever the polled unread
 * snapshot changes. Mirrors `WechatUnreadUpdateSchema` in
 * `wechat-rpc-schemas.ts` (the manager doesn't import the schema directly
 * to keep the module bundle-clean for tests; the session handler wraps the
 * payload before it goes on the wire).
 */
export interface WechatUnreadUpdatePayload {
  sessions: WechatSession[];
  capturedAt: string;
}

export interface WechatSubscriber {
  send: (payload: WechatUnreadUpdatePayload) => void;
}

export interface WechatSubscriptionManagerOptions {
  service: WechatService;
  logger: Logger;
  /** Default poll interval in ms. 30 000 keeps in sync with the MVP scope brief. */
  pollIntervalMs?: number;
  /**
   * Default `wx unread --filter` list. `["private","group"]` strips public
   * accounts and the folded inbox so the sidebar stays focused on real
   * human chats.
   */
  defaultFilter?: WechatChatType[];
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_FILTER: ReadonlyArray<WechatChatType> = ["private", "group"];

/**
 * Owns the wx-cli unread polling loop and the set of WS sessions opted in
 * to live updates. Polling is gated on subscriber count > 0 so an
 * unsubscribed daemon never spawns wx subprocesses (and never trips the
 * `binary_not_found` / `not_initialized` paths) until a client cares.
 *
 * The polled list is hashed via JSON.stringify and only broadcast when the
 * hash changes — clients see one update per actual delta, not one per tick.
 *
 * Errors from `wx unread` are logged and swallowed; the snapshot is left
 * untouched so transient failures (daemon restart, codesign re-required)
 * don't blank out the sidebar. The Setup Wizard surfaces the persistent
 * failure mode separately via `wechat/state`.
 */
export class WechatSubscriptionManager {
  private readonly service: WechatService;
  private readonly logger: Logger;
  private readonly pollIntervalMs: number;
  private readonly defaultFilter: ReadonlyArray<WechatChatType>;

  private readonly subscribers = new Map<string, WechatSubscriber>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot: WechatSession[] = [];
  private lastSnapshotHash = "";
  private lastCapturedAt: string | null = null;
  private lastErrorKind: WechatErrorKind | null = null;

  constructor(options: WechatSubscriptionManagerOptions) {
    this.service = options.service;
    this.logger = options.logger.child({ component: "wechat-subscription-manager" });
    this.pollIntervalMs = Math.max(5_000, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    this.defaultFilter = options.defaultFilter ?? DEFAULT_FILTER;
  }

  /** No-op start hook — kept symmetric with ChatSubscriptionManager.start(). */
  start(): void {
    // Nothing to wire eagerly; polling begins when the first session subscribes.
  }

  /** Stop polling, drop all subscribers. Call from daemon shutdown. */
  stop(): void {
    this.stopPolling();
    this.subscribers.clear();
  }

  /**
   * Snapshot of the most recent successful poll, plus a coarse "is there a
   * persistent failure" signal. Sessions handling `wechat/state` use the
   * latter to render the Setup Wizard banner.
   */
  describeState(): { lastErrorKind: WechatErrorKind | null; lastCapturedAt: string | null } {
    return {
      lastErrorKind: this.lastErrorKind,
      lastCapturedAt: this.lastCapturedAt,
    };
  }

  /**
   * Register a subscriber and return the current snapshot synchronously.
   * Cold start runs one snapshot load but does NOT broadcast — the caller
   * already gets the snapshot via the return value, and a duplicate push
   * event would force every client to dedupe.
   */
  async subscribe(sessionId: string, subscriber: WechatSubscriber): Promise<WechatSession[]> {
    this.subscribers.set(sessionId, subscriber);
    this.startPolling();
    if (this.lastCapturedAt === null) {
      await this.refreshSnapshot();
    }
    return [...this.lastSnapshot];
  }

  unsubscribe(sessionId: string): void {
    this.subscribers.delete(sessionId);
    if (this.subscribers.size === 0) {
      this.stopPolling();
    }
  }

  /** Drop everything this session held. Call on session close. */
  unsubscribeAll(sessionId: string): void {
    this.unsubscribe(sessionId);
  }

  /** Force a poll cycle. Exposed for the unit tests; production code uses the timer. */
  async pollNow(): Promise<void> {
    await this.tick();
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private startPolling(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    // setInterval keeps the event loop alive; unref so the daemon can exit
    // cleanly during tests / shutdown without an explicit clear.
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  private stopPolling(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Load the snapshot, update internal state, return whether the hash
   * changed. Does not broadcast — the caller decides. Errors are logged
   * once per transition and swallowed so transient failures don't blank
   * out the sidebar; the snapshot is left untouched.
   *
   * Hybrid filter (matches the user's actual mental model surfaced after
   * MVP day-1 testing):
   *
   *   - **private chats**: always included — friends with recent activity
   *     stay persistently visible so the user can pick one and draft a
   *     reply even when nothing's unread. The original "auto-clear on
   *     reply" design left private contacts vanishing the moment they
   *     were handled, which made the sidebar useless for "I want to
   *     write to Alice" — Alice wasn't there.
   *   - **group chats**: only included when `unread > 0`. Groups are
   *     noisy; once read, they should fall out of the sidebar. This
   *     preserves the original auto-clear behavior where it actually
   *     served the user.
   *
   * `wx sessions` doesn't take `--filter`, so we pull all recent
   * sessions and filter client-side.
   */
  private async refreshSnapshot(): Promise<{ changed: boolean }> {
    let next: WechatSession[];
    try {
      const allowed = new Set<string>(this.defaultFilter);
      const all = await this.service.listSessions({ limit: 100 });
      next = all.filter((session) => {
        const kind = session.chat_type ?? "private";
        if (!allowed.has(kind)) return false;
        if (kind === "group") return (session.unread ?? 0) > 0;
        return true;
      });
    } catch (err) {
      const kind = err instanceof WechatServiceError ? err.kind : "unknown";
      if (kind !== this.lastErrorKind) {
        this.logger.warn({ kind }, "wechat unread poll failed");
        this.lastErrorKind = kind;
      }
      // Even on error mark a captureAt so subscribe doesn't loop forever
      // trying to refresh a permanently broken integration.
      this.lastCapturedAt = new Date().toISOString();
      return { changed: false };
    }

    if (this.lastErrorKind !== null) {
      this.logger.info({ recoveredFrom: this.lastErrorKind }, "wechat unread poll recovered");
      this.lastErrorKind = null;
    }

    const hash = JSON.stringify(next);
    this.lastSnapshot = next;
    this.lastCapturedAt = new Date().toISOString();
    if (hash === this.lastSnapshotHash) {
      return { changed: false };
    }
    this.lastSnapshotHash = hash;
    return { changed: true };
  }

  private async tick(): Promise<void> {
    const result = await this.refreshSnapshot();
    if (!result.changed) return;

    const payload: WechatUnreadUpdatePayload = {
      sessions: this.lastSnapshot,
      capturedAt: this.lastCapturedAt ?? new Date().toISOString(),
    };
    for (const [sessionId, subscriber] of this.subscribers) {
      try {
        subscriber.send(payload);
      } catch (err) {
        this.logger.warn(
          { err, sessionId },
          "wechat subscriber send threw — dropping subscription",
        );
        this.subscribers.delete(sessionId);
      }
    }
    if (this.subscribers.size === 0) {
      this.stopPolling();
    }
  }
}
