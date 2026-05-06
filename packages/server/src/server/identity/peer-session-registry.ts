import type { SharedKey } from "@ottie/relay/e2ee";
import type pino from "pino";

/**
 * Phase 2.f/2 — registry of currently-active peer-sync sessions.
 *
 * One session ≈ one open WebSocket from the local daemon to/from a peer
 * daemon of the same user, with the SIGMA-I handshake completed and a
 * shared key established. Phase 2.f/3 broadcasts outbound events by
 * iterating `list()` and writing through each session's socket.
 *
 * Key by `peerDeviceId` — at most one session per peer for now. If the
 * same peer connects twice (two daemons of the same user briefly racing
 * on reconnect), the second connect replaces the first and we close the
 * stale socket. This is the same shape as the relay's "Replaced" close
 * code 1008 in cloudflare-adapter.ts.
 *
 * Sessions are NOT persisted: a daemon restart drops them and they get
 * re-established on the next dial. The event-store's
 * `lastSeenSeqBySource` map provides reconnect-replay safety.
 */

/**
 * Minimal socket surface a session needs. Mirrors the
 * `CandidateReplySocket` pattern in device-link-pending-candidate-store
 * — keeps this module a leaf, not depending on relay-transport types.
 */
export interface PeerSessionSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface PeerSession {
  /** The peer's deviceId (must be in local devices.json). */
  readonly peerDeviceId: string;
  /** ECDH shared key, both sides arrive at the same value. */
  readonly sharedKey: SharedKey;
  /** Open WebSocket. Closed when the session ends. */
  readonly socket: PeerSessionSocket;
  /** Wall-clock millis when the SIGMA-I handshake completed. */
  readonly establishedAtMs: number;
}

export class PeerSessionRegistry {
  private sessions: Map<string, PeerSession> = new Map();
  private readonly logger: pino.Logger | undefined;

  constructor(logger?: pino.Logger) {
    this.logger = logger?.child({ module: "peer-session-registry" });
  }

  /**
   * Add a new session. If a session for the same peer already exists,
   * close it and replace — most-recent-wins. Returns the displaced
   * session (or null) so callers can do their own cleanup if needed.
   */
  add(session: PeerSession): PeerSession | null {
    const existing = this.sessions.get(session.peerDeviceId) ?? null;
    if (existing) {
      try {
        existing.socket.close(1008, "Replaced by new peer session");
      } catch {
        // ignore
      }
      this.logger?.info(
        { peerDeviceId: session.peerDeviceId.slice(0, 12) },
        "peer_session_replaced",
      );
    }
    this.sessions.set(session.peerDeviceId, session);
    this.logger?.info(
      {
        peerDeviceId: session.peerDeviceId.slice(0, 12),
        size: this.sessions.size,
      },
      "peer_session_registered",
    );
    return existing;
  }

  get(peerDeviceId: string): PeerSession | null {
    return this.sessions.get(peerDeviceId) ?? null;
  }

  /** Snapshot for broadcast iteration. Order is insertion order. */
  list(): readonly PeerSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Remove a session by peerDeviceId. Used by the receiver handler when
   * the socket closes, or when a peer is removed from the device list
   * via Phase 2.g's revocation flow.
   */
  remove(peerDeviceId: string): boolean {
    const removed = this.sessions.delete(peerDeviceId);
    if (removed) {
      this.logger?.info(
        { peerDeviceId: peerDeviceId.slice(0, 12), size: this.sessions.size },
        "peer_session_removed",
      );
    }
    return removed;
  }

  /**
   * Close + drop all sessions. Called on daemon shutdown so peers see
   * a clean WebSocket close instead of TCP RST.
   */
  closeAll(reason = "daemon_shutdown"): void {
    for (const session of this.sessions.values()) {
      try {
        session.socket.close(1001, reason);
      } catch {
        // ignore
      }
    }
    this.sessions.clear();
  }
}
