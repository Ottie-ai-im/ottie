import type { SharedKey } from "@ottie/relay/e2ee";
import type pino from "pino";

/**
 * Phase 3.b/1c — registry of currently-active friend-sync sessions.
 * Cross-identity analog of `peer-session-registry.ts`.
 *
 * One session ≈ one open WebSocket from the local daemon to/from a
 * friend's daemon (DIFFERENT root identity), with the SIGMA-I handshake
 * (Phase 3.b/1b) completed and a shared key established. Phase 3.b/1d
 * routes outbound chat messages by looking up the session for the
 * recipient peer's rootPubKey and writing through its socket.
 *
 * Key by `peerRootPubKey` — at most one session per friend, per ottie's
 * identity model (a friend is one root, even if they run multiple
 * daemons; we route to whichever they paired from). Two daemons under
 * the same friend identity racing for the same friend pairing is rare;
 * if it happens, second-connect-wins with a 1008 "Replaced" close on
 * the first (mirrors the peer-sync registry).
 *
 * Sessions are NOT persisted: a daemon restart drops them and they get
 * re-established on next dial. Phase 3.b/2's KV inbox + Phase 3.b/3's
 * read receipts handle the "missed-while-offline" gap.
 */

/**
 * Minimal socket surface a session needs. Mirrors `PeerSessionSocket`
 * in `peer-session-registry.ts` — keeps this module a leaf, no
 * relay-transport types pulled in.
 */
export interface FriendSessionSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface FriendSession {
  /** The peer's root sign public key (Ed25519 JWK 'x' base64url). */
  readonly peerRootPubKey: string;
  /**
   * The peer's serverId at session-establishment time. Stored for
   * audit / reconnect; the dialer uses this when refreshing targets.
   */
  readonly peerDeviceId: string;
  /** ECDH shared key — both sides arrive at the same value. */
  readonly sharedKey: SharedKey;
  /** Open WebSocket. Closed when the session ends. */
  readonly socket: FriendSessionSocket;
  /** Wall-clock millis when the SIGMA-I handshake completed. */
  readonly establishedAtMs: number;
}

export class FriendSessionRegistry {
  private sessions: Map<string, FriendSession> = new Map();
  private readonly logger: pino.Logger | undefined;

  constructor(logger?: pino.Logger) {
    this.logger = logger?.child({ module: "friend-session-registry" });
  }

  /**
   * Add a new session. If a session for the same peer already exists,
   * close it and replace — most-recent-wins. Returns the displaced
   * session (or null) so callers can do their own cleanup if needed.
   */
  add(session: FriendSession): FriendSession | null {
    const existing = this.sessions.get(session.peerRootPubKey) ?? null;
    if (existing) {
      try {
        existing.socket.close(1008, "Replaced by new friend session");
      } catch {
        // ignore
      }
      this.logger?.info(
        { peerRootPubKey: session.peerRootPubKey.slice(0, 8) },
        "friend_session_replaced",
      );
    }
    this.sessions.set(session.peerRootPubKey, session);
    this.logger?.info(
      {
        peerRootPubKey: session.peerRootPubKey.slice(0, 8),
        peerDeviceId: session.peerDeviceId.slice(0, 12),
        size: this.sessions.size,
      },
      "friend_session_registered",
    );
    return existing;
  }

  get(peerRootPubKey: string): FriendSession | null {
    return this.sessions.get(peerRootPubKey) ?? null;
  }

  /** Snapshot for broadcast / lookup iteration. Order is insertion order. */
  list(): readonly FriendSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Remove a session by peerRootPubKey. Used by the receiver / dialer
   * handlers when the socket closes, or when the user un-friends a peer
   * (Phase 5).
   */
  remove(peerRootPubKey: string): boolean {
    const removed = this.sessions.delete(peerRootPubKey);
    if (removed) {
      this.logger?.info(
        { peerRootPubKey: peerRootPubKey.slice(0, 8), size: this.sessions.size },
        "friend_session_removed",
      );
    }
    return removed;
  }

  /**
   * Close + drop all sessions. Called on daemon shutdown so friends
   * see a clean WebSocket close instead of TCP RST.
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
