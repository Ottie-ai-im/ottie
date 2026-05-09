import type pino from "pino";

import { FriendSyncKeepaliveSchema } from "./friend-sync-types.js";

/**
 * Phase 4 / friend-sync keepalive — detects silently-dead sockets so the
 * dialer's reconnect logic actually fires.
 *
 * Why this exists:
 *   Cloudflare Workers (which host the relay) close idle WebSockets at
 *   ~100s on free tier and ~5 min on paid plans. The close is not always
 *   surfaced to the daemon — sometimes the socket lingers, `socket.send`
 *   keeps returning ok, but bytes never reach the peer. We hit this
 *   during Phase 4 e2e testing: the second invite of a session looked
 *   sent on the owner side and never arrived on the friend side.
 *
 * What it does:
 *   Every `pingIntervalMs` (default 30s) push a `friend-sync-keepalive`
 *   ping frame. The peer answers with `pong`; we track `lastPongAtMs`.
 *   If we have not received a pong for `livenessTimeoutMs` (default
 *   75s — two ping cycles plus slack), the socket is considered dead
 *   and `onDead()` is invoked. The caller is responsible for closing
 *   the socket; close → registry remove → dialer reconnect.
 *
 *   Frames are plaintext JSON. They carry no secret content; encrypting
 *   them would only let an attacker forge pongs to *mask* a dead
 *   socket, which is the pre-fix bug, so encryption costs net negative.
 */

const DEFAULT_PING_INTERVAL_MS = 30_000;
const DEFAULT_LIVENESS_TIMEOUT_MS = 75_000;

export interface FriendSyncKeepaliveControllerOptions {
  /** How often to emit a ping. Defaults to 30s. */
  pingIntervalMs?: number;
  /**
   * If no pong arrives within this window after the last ping was sent,
   * the socket is treated as dead. Defaults to 75s (covers two ping
   * cycles plus relay round-trip slack).
   */
  livenessTimeoutMs?: number;
  /** How to push a frame onto the wire. */
  send: (frame: string) => void;
  /** Called once when the controller decides the socket is dead. */
  onDead: () => void;
  logger: pino.Logger;
  /** Optional clock override for tests. */
  now?: () => number;
}

export interface FriendSyncKeepaliveController {
  /** Start the periodic ping. Idempotent. */
  start(): void;
  /** Stop the periodic ping + clear timers. Idempotent. */
  stop(): void;
  /**
   * Inspect a parsed JSON frame; if it is a keepalive, handle it
   * (record liveness, optionally emit pong) and return `true` so the
   * caller skips its own dispatch logic. Otherwise return `false`.
   */
  tryHandleParsed(parsed: unknown): boolean;
}

export function createFriendSyncKeepaliveController(
  options: FriendSyncKeepaliveControllerOptions,
): FriendSyncKeepaliveController {
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const livenessTimeoutMs = options.livenessTimeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());

  let started = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastPongAtMs = now();
  let dead = false;

  function tick(): void {
    if (!started || dead) return;
    if (now() - lastPongAtMs > livenessTimeoutMs) {
      dead = true;
      options.logger.warn(
        { sinceLastPongMs: now() - lastPongAtMs, livenessTimeoutMs },
        "friend_sync_keepalive_timeout",
      );
      options.onDead();
      return;
    }
    try {
      options.send(JSON.stringify({ v: 1, kind: "friend-sync-keepalive", type: "ping" }));
    } catch (err) {
      options.logger.warn({ err }, "friend_sync_keepalive_ping_send_failed");
    }
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      lastPongAtMs = now();
      timer = setInterval(tick, pingIntervalMs);
      (timer as unknown as { unref?: () => void }).unref?.();
    },
    stop(): void {
      started = false;
      if (timer) clearInterval(timer);
      timer = null;
    },
    tryHandleParsed(parsed: unknown): boolean {
      const validated = FriendSyncKeepaliveSchema.safeParse(parsed);
      if (!validated.success) return false;
      if (validated.data.type === "ping") {
        try {
          options.send(JSON.stringify({ v: 1, kind: "friend-sync-keepalive", type: "pong" }));
        } catch (err) {
          options.logger.warn({ err }, "friend_sync_keepalive_pong_send_failed");
        }
        return true;
      }
      // type === "pong"
      lastPongAtMs = now();
      return true;
    },
  };
}
