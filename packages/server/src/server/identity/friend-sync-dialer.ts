import { randomBytes, type KeyObject } from "node:crypto";
import { WebSocket } from "ws";
import type pino from "pino";

import { buildRelayWebSocketUrl } from "../../shared/daemon-endpoints.js";

import type { FriendSessionRegistry, FriendSessionSocket } from "./friend-session-registry.js";
import {
  buildFriendHello,
  decryptFriendSyncFrame,
  deriveFriendSessionSharedKey,
  FriendHelloSchema,
  FriendSyncFrameSchema,
  verifyFriendHello,
} from "./friend-sync-handshake.js";
import type { StoredPeer } from "./peer-types.js";

/**
 * Phase 3.b/1c — outbound dialer for friend-sync sessions. Companion to
 * the inbound `friend-sync-receiver.ts` handler. Cross-identity analog
 * of `peer-sync-dialer.ts`.
 *
 * Behavior:
 *   - On `start()` (called by IdentityService once root identity +
 *     peers.json are loaded), iterate peers.json and dial every friend
 *     whose entry has `peerServerId` populated (3.b/1a captured this
 *     during pairing). Pre-3.b/1a peers without routing info are
 *     skipped — the user will need to re-pair to reach them.
 *   - For each peer: open a relay client WebSocket with
 *     `connectionId="friend-sync:<random nonce>"` targeting the peer's
 *     `peerServerId` on `peerRelayEndpoint`.
 *   - Run the SIGMA-I initiator side: send our hello first (signed by
 *     OUR root key), await theirs, verify against the peer record from
 *     peers.json, derive shared key, register the session.
 *   - On socket close: remove from registry; reconnect with exponential
 *     backoff (capped at 30s, jittered ±25%) up to a small attempt cap
 *     before pausing.
 *
 * Tie-break for simultaneous connect: not implemented — same rationale
 * as peer-sync-dialer (FriendSessionRegistry's most-recent-wins
 * replacement collapses any racing pair into one).
 */

const DIAL_HANDSHAKE_TIMEOUT_MS = 15_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 8;
const MAX_FRAME_BYTES = 256 * 1024;

export interface FriendSyncDialerOptions {
  /** Our root sign public key — Bob can verify our hello against his peers.json. */
  selfRootPubKey: string;
  /** Our root sign PRIVATE key. Signs our outbound hello; never sent. */
  selfRootSignPrivateKey: KeyObject;
  /** Our daemon serverId — included in our hello for audit + multi-device routing. */
  selfDeviceId: string;
  /**
   * Snapshot of the local peer list. Called every time the dialer
   * needs to discover dial targets — always returns the freshest copy
   * from IdentityService.
   */
  getLocalPeerList: () => readonly StoredPeer[];
  /** Where session lifetime is tracked (shared with the receiver handler). */
  sessions: FriendSessionRegistry;
  /** Bridges decrypted inbound payloads (Phase 3.b/1d schema-validates them). */
  applyInboundPayload: (input: { peerRootPubKey: string; payload: unknown }) => void;
  /** Optional: invoked after handshake completes; Phase 3.b/2 will drain the inbox here. */
  onSessionEstablished?: (peerRootPubKey: string) => void;
  logger: pino.Logger;
  /** Override `ws.WebSocket` factory (for tests with mock-relay). */
  createSocket?: (url: string) => FriendDialerSocket;
  /** Override clock for tests. */
  now?: () => number;
}

export interface FriendDialerSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "open", listener: () => void): void;
  on(event: "message", listener: (data: unknown, isBinary: boolean) => void): void;
  on(event: "close", listener: (code: number, reason: Buffer) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

interface FriendDialState {
  socket: FriendDialerSocket | null;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

export class FriendSyncDialer {
  private readonly options: FriendSyncDialerOptions;
  private readonly log: pino.Logger;
  private readonly perPeer = new Map<string, FriendDialState>();
  private stopped = false;

  constructor(options: FriendSyncDialerOptions) {
    this.options = options;
    this.log = options.logger.child({ module: "friend-sync-dialer" });
  }

  start(): void {
    if (this.stopped) {
      throw new Error("FriendSyncDialer was stopped — create a new one");
    }
    this.refreshTargets();
  }

  refreshTargets(): void {
    if (this.stopped) return;
    const peers = this.discoverPeers();
    for (const peer of peers) {
      if (this.perPeer.has(peer.peerRootSignPublicKeyB64)) continue;
      this.perPeer.set(peer.peerRootSignPublicKeyB64, {
        socket: null,
        reconnectAttempts: 0,
        reconnectTimer: null,
      });
      this.dialPeer(peer);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const [, state] of this.perPeer) {
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
      if (state.socket) {
        try {
          state.socket.close(1001, "dialer_stopping");
        } catch {
          // ignore
        }
      }
    }
    this.perPeer.clear();
  }

  private discoverPeers(): readonly StoredPeer[] {
    return this.options.getLocalPeerList().filter((p) => {
      if (p.status !== "active") return false;
      // Skip peers without routing info (pre-3.b/1a pairings or future
      // failure modes where we lost the serverId).
      if (!p.peerServerId || !p.peerRelayEndpoint) return false;
      return true;
    });
  }

  private dialPeer(peer: StoredPeer): void {
    if (this.stopped) return;
    const state = this.perPeer.get(peer.peerRootSignPublicKeyB64);
    if (!state) return;
    if (!peer.peerServerId || !peer.peerRelayEndpoint) return;

    const connectionId = `friend-sync:${randomBytes(16).toString("base64url").replace(/=+$/, "")}`;
    const url = buildRelayWebSocketUrl({
      endpoint: peer.peerRelayEndpoint,
      serverId: peer.peerServerId,
      role: "client",
      connectionId,
      version: 2,
    });

    const factory =
      this.options.createSocket ??
      ((u: string): FriendDialerSocket => {
        const ws = new WebSocket(u, { handshakeTimeout: 10_000, perMessageDeflate: false });
        return wrapWsAsFriendDialerSocket(ws);
      });
    const socket = factory(url);
    state.socket = socket;

    let phase: "awaiting-open" | "awaiting-hello" | "established" | "closed" = "awaiting-open";
    let ourEphPrivKeyB64: string | null = null;
    let sharedKeyHandle: import("@ottie/relay/e2ee").SharedKey | null = null;
    let registered = false;

    const handshakeDeadline = setTimeout(() => {
      if (phase === "established" || phase === "closed") return;
      this.log.warn(
        { peerRootPubKeyPrefix: peer.peerRootSignPublicKeyB64.slice(0, 8), phase },
        "friend_sync_dialer_handshake_timeout",
      );
      try {
        socket.close(1011, "handshake_timeout");
      } catch {
        // ignore
      }
    }, DIAL_HANDSHAKE_TIMEOUT_MS);
    (handshakeDeadline as unknown as { unref?: () => void }).unref?.();

    socket.on("open", () => {
      if (phase !== "awaiting-open") return;
      const built = buildFriendHello({
        selfRootPubKey: this.options.selfRootPubKey,
        selfDeviceId: this.options.selfDeviceId,
        selfRootSignPrivateKey: this.options.selfRootSignPrivateKey,
      });
      ourEphPrivKeyB64 = built.ephPrivateKeyB64;
      // Flip phase BEFORE sending: in some transports (notably fake
      // in-memory sockets in tests) `socket.send` is synchronous and
      // will land the responder's reply on our message handler before
      // this function returns. We need phase to already say
      // "awaiting-hello" so the message handler routes the reply to
      // handlePeerHello rather than dropping it as out-of-phase.
      phase = "awaiting-hello";
      try {
        socket.send(JSON.stringify(built.hello));
      } catch (err) {
        phase = "closed";
        this.log.warn(
          { err, peerRootPubKeyPrefix: peer.peerRootSignPublicKeyB64.slice(0, 8) },
          "friend_sync_dialer_hello_send_failed",
        );
        try {
          socket.close(1011, "hello_send_failed");
        } catch {
          // ignore
        }
      }
    });

    socket.on("message", (raw, isBinary) => {
      if (phase === "closed") return;
      const text = decodeFrame(raw, isBinary);
      if (text === null) {
        try {
          socket.close(1003, "unparseable_frame");
        } catch {
          // ignore
        }
        return;
      }
      if (text.length > MAX_FRAME_BYTES) {
        try {
          socket.close(1009, "oversized_frame");
        } catch {
          // ignore
        }
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        try {
          socket.close(1003, "bad_json");
        } catch {
          // ignore
        }
        return;
      }

      if (phase === "awaiting-hello") {
        this.handlePeerHello({
          parsed,
          peer,
          ourEphPrivKeyB64,
          socket,
          onEstablished: (key) => {
            sharedKeyHandle = key;
            registered = true;
            phase = "established";
            clearTimeout(handshakeDeadline);
            const st = this.perPeer.get(peer.peerRootSignPublicKeyB64);
            if (st) st.reconnectAttempts = 0;
          },
        });
        return;
      }

      if (phase === "established" && sharedKeyHandle) {
        this.handlePostHandshakeFrame({
          parsed,
          peerRootPubKey: peer.peerRootSignPublicKeyB64,
          sharedKey: sharedKeyHandle,
          socket,
        });
      }
    });

    socket.on("close", (code, reason) => {
      clearTimeout(handshakeDeadline);
      const wasEstablished = phase === "established";
      phase = "closed";
      if (registered) {
        this.options.sessions.remove(peer.peerRootSignPublicKeyB64);
      }
      const stateAfter = this.perPeer.get(peer.peerRootSignPublicKeyB64);
      if (stateAfter) stateAfter.socket = null;
      this.log.info(
        {
          code,
          reason: reason?.toString?.() ?? "",
          peerRootPubKeyPrefix: peer.peerRootSignPublicKeyB64.slice(0, 8),
          wasEstablished,
        },
        "friend_sync_dialer_socket_closed",
      );
      this.scheduleReconnect(peer);
    });

    socket.on("error", (err) => {
      this.log.warn(
        { err, peerRootPubKeyPrefix: peer.peerRootSignPublicKeyB64.slice(0, 8) },
        "friend_sync_dialer_socket_error",
      );
    });
  }

  private handlePeerHello(args: {
    parsed: unknown;
    peer: StoredPeer;
    ourEphPrivKeyB64: string | null;
    socket: FriendDialerSocket;
    onEstablished: (key: import("@ottie/relay/e2ee").SharedKey) => void;
  }): void {
    if (!args.ourEphPrivKeyB64) {
      try {
        args.socket.close(1011, "internal_no_eph");
      } catch {
        // ignore
      }
      return;
    }
    const validated = FriendHelloSchema.safeParse(args.parsed);
    if (!validated.success) {
      this.log.warn(
        {
          issues: validated.error.issues,
          peerRootPubKeyPrefix: args.peer.peerRootSignPublicKeyB64.slice(0, 8),
        },
        "friend_sync_dialer_hello_schema_rejected",
      );
      try {
        args.socket.close(1008, "bad_hello_schema");
      } catch {
        // ignore
      }
      return;
    }
    const incoming = validated.data;

    if (incoming.fromRootPubKey !== args.peer.peerRootSignPublicKeyB64) {
      this.log.warn(
        {
          dialedPrefix: args.peer.peerRootSignPublicKeyB64.slice(0, 8),
          claimedPrefix: incoming.fromRootPubKey.slice(0, 8),
        },
        "friend_sync_dialer_peer_identity_mismatch",
      );
      try {
        args.socket.close(1008, "peer_identity_mismatch");
      } catch {
        // ignore
      }
      return;
    }

    const verifyOutcome = verifyFriendHello({
      hello: incoming,
      expectedPeer: args.peer,
    });
    if (!verifyOutcome.ok) {
      this.log.warn(
        {
          reason: verifyOutcome.reason,
          peerRootPubKeyPrefix: args.peer.peerRootSignPublicKeyB64.slice(0, 8),
        },
        "friend_sync_dialer_hello_verify_failed",
      );
      try {
        args.socket.close(1008, "hello_verify_failed");
      } catch {
        // ignore
      }
      return;
    }

    const sharedKey = deriveFriendSessionSharedKey({
      ourEphPrivKeyB64: args.ourEphPrivKeyB64,
      peerEphPubKeyB64: incoming.ephPubKeyB64,
    });
    this.options.sessions.add({
      peerRootPubKey: args.peer.peerRootSignPublicKeyB64,
      peerDeviceId: incoming.fromDeviceId,
      sharedKey,
      socket: args.socket as FriendSessionSocket,
      establishedAtMs: (this.options.now ?? Date.now)(),
    });
    this.log.info(
      { peerRootPubKeyPrefix: args.peer.peerRootSignPublicKeyB64.slice(0, 8) },
      "friend_sync_dialer_session_established",
    );
    args.onEstablished(sharedKey);
    try {
      this.options.onSessionEstablished?.(args.peer.peerRootSignPublicKeyB64);
    } catch (err) {
      this.log.warn(
        { err, peerRootPubKeyPrefix: args.peer.peerRootSignPublicKeyB64.slice(0, 8) },
        "friend_sync_dialer_on_established_threw",
      );
    }
  }

  private handlePostHandshakeFrame(args: {
    parsed: unknown;
    peerRootPubKey: string;
    sharedKey: import("@ottie/relay/e2ee").SharedKey;
    socket: FriendDialerSocket;
  }): void {
    const frameValidated = FriendSyncFrameSchema.safeParse(args.parsed);
    if (!frameValidated.success) {
      try {
        args.socket.close(1008, "bad_frame_schema");
      } catch {
        // ignore
      }
      return;
    }
    let plaintext: string;
    try {
      plaintext = decryptFriendSyncFrame({
        sharedKey: args.sharedKey,
        frame: frameValidated.data,
      });
    } catch {
      try {
        args.socket.close(1008, "decrypt_failed");
      } catch {
        // ignore
      }
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(plaintext);
    } catch {
      try {
        args.socket.close(1008, "bad_payload_json");
      } catch {
        // ignore
      }
      return;
    }
    try {
      this.options.applyInboundPayload({
        peerRootPubKey: args.peerRootPubKey,
        payload,
      });
    } catch (err) {
      this.log.warn(
        { err, peerRootPubKeyPrefix: args.peerRootPubKey.slice(0, 8) },
        "friend_sync_dialer_apply_threw",
      );
    }
  }

  private scheduleReconnect(peer: StoredPeer): void {
    if (this.stopped) return;
    const state = this.perPeer.get(peer.peerRootSignPublicKeyB64);
    if (!state) return;
    if (state.reconnectTimer) return;

    state.reconnectAttempts += 1;
    if (state.reconnectAttempts > RECONNECT_MAX_ATTEMPTS) {
      this.log.warn(
        {
          peerRootPubKeyPrefix: peer.peerRootSignPublicKeyB64.slice(0, 8),
          attempts: state.reconnectAttempts,
        },
        "friend_sync_dialer_giving_up_for_now",
      );
      state.reconnectAttempts = 0;
      return;
    }

    const target = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * state.reconnectAttempts);
    const delayMs = Math.round(target * (0.75 + Math.random() * 0.5));
    state.reconnectTimer = setTimeout(() => {
      if (this.stopped) return;
      const fresh = this.perPeer.get(peer.peerRootSignPublicKeyB64);
      if (fresh) fresh.reconnectTimer = null;
      // Re-fetch the peer in case status changed (block / remove).
      const refreshedPeer = this.options
        .getLocalPeerList()
        .find((p) => p.peerRootSignPublicKeyB64 === peer.peerRootSignPublicKeyB64);
      if (!refreshedPeer || refreshedPeer.status !== "active") {
        this.perPeer.delete(peer.peerRootSignPublicKeyB64);
        return;
      }
      this.dialPeer(refreshedPeer);
    }, delayMs);
    (state.reconnectTimer as unknown as { unref?: () => void }).unref?.();
  }
}

// ----- internal helpers --------------------------------------------------

function decodeFrame(raw: unknown, isBinary: boolean): string | null {
  if (isBinary) return null;
  if (typeof raw === "string") return raw;
  if (raw instanceof Buffer) return raw.toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  if (Array.isArray(raw)) {
    try {
      return Buffer.concat(raw.filter((b) => Buffer.isBuffer(b))).toString("utf8");
    } catch {
      return null;
    }
  }
  return null;
}

function wrapWsAsFriendDialerSocket(ws: WebSocket): FriendDialerSocket {
  return {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    on: (event, listener) => {
      ws.on(event, listener as never);
    },
  };
}
