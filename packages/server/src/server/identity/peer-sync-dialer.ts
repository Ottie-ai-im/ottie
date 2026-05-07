import { randomBytes, type KeyObject } from "node:crypto";
import { WebSocket } from "ws";
import type pino from "pino";

import { buildRelayWebSocketUrl } from "../../shared/daemon-endpoints.js";

import {
  AiShareCoordinationEventSchema,
  type AiShareCoordinationEvent,
} from "./ai-share-coordination-types.js";
import { DeviceListEventSchema, type DeviceListEvent } from "./device-list-event-types.js";
import type { StoredDevice } from "./device-types.js";
import type { PeerSessionRegistry, PeerSessionSocket } from "./peer-session-registry.js";
import {
  buildPeerHello,
  decryptPeerSyncFrame,
  deriveSessionSharedKey,
  PeerHelloSchema,
  PeerSyncFrameSchema,
  verifyPeerHello,
} from "./peer-sync-handshake.js";

/**
 * Phase 2.f/2c — outbound dialer for peer-sync sessions. Companion to
 * the inbound `peer-sync-receiver.ts` handler.
 *
 * Behavior:
 *   - On `start()` (called by IdentityService once self-device + device
 *     list are loaded), iterate the device list and dial every other
 *     daemon entry (`role==="daemon"`, `deviceId !== self`).
 *   - For each peer: open a relay client WebSocket with
 *     `connectionId="peer-sync:<random nonce>"` targeting the peer's
 *     `serverId` (which by convention equals their `deviceId`).
 *   - Run the SIGMA-I initiator side: send our hello first, await
 *     theirs, verify, derive shared key, register the session.
 *   - On socket close: remove from registry; reconnect with exponential
 *     backoff (capped at 30s, jittered ±25%) up to a small attempt cap
 *     before pausing. The next time the device list changes (Phase
 *     2.f/3+ event delivery) the dialer revisits and may retry.
 *
 * Tie-break for simultaneous connect: not implemented. Both sides may
 * dial each other and end up with two sockets briefly; PeerSession
 * Registry's most-recent-wins replacement collapses them into one. The
 * extra round of socket setup is cheap and avoids the complexity of
 * picking a "primary" by device-id ordering.
 */

const DIAL_HANDSHAKE_TIMEOUT_MS = 15_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 8; // ~2 minutes of attempts at jittered backoff
const MAX_FRAME_BYTES = 256 * 1024;

export interface PeerSyncDialerOptions {
  selfDeviceId: string;
  selfSignPrivateKey: KeyObject;
  relayEndpoint: string;
  /**
   * Snapshot of the local device list. Called every time the dialer
   * needs to discover dial targets — always returns the freshest copy
   * from IdentityService.
   */
  getLocalDeviceList: () => readonly StoredDevice[];
  /** Where session lifetime is tracked (shared with the receiver handler). */
  sessions: PeerSessionRegistry;
  /** Bridges decrypted inbound events into IdentityService.applyInboundDeviceListEvent. */
  applyInboundEvent: (event: DeviceListEvent) => void;
  /**
   * Phase 4 v3/c §7.5.1 — secondary dispatch for ai-share coordination
   * events on the same peer-sync session. Optional so older callers
   * keep working.
   */
  applyInboundCoordinationEvent?: (event: AiShareCoordinationEvent) => void;
  /**
   * Phase 2.f/3 hook: called once per session right after the SIGMA-I
   * handshake completes and the session is registered. Used by
   * IdentityService to replay the local events log to the peer for
   * catch-up. Failures here must NOT close the session — replay is
   * best-effort.
   */
  onSessionEstablished?: (peerDeviceId: string) => void;
  logger: pino.Logger;
  /** Override `ws.WebSocket` factory (for tests with mock-relay). */
  createSocket?: (url: string) => DialerSocket;
  /** Override clock for tests. */
  now?: () => number;
}

export interface DialerSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "open", listener: () => void): void;
  on(event: "message", listener: (data: unknown, isBinary: boolean) => void): void;
  on(event: "close", listener: (code: number, reason: Buffer) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

interface PeerDialState {
  /** Active socket (handshake-in-progress or established). */
  socket: DialerSocket | null;
  /** Reconnect attempt count for backoff. */
  reconnectAttempts: number;
  /** Pending reconnect timer handle. */
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

export class PeerSyncDialer {
  private readonly options: PeerSyncDialerOptions;
  private readonly log: pino.Logger;
  private readonly perPeer = new Map<string, PeerDialState>();
  private stopped = false;

  constructor(options: PeerSyncDialerOptions) {
    this.options = options;
    this.log = options.logger.child({ module: "peer-sync-dialer" });
  }

  /**
   * Discover dial targets from the current device list and start a
   * connection attempt for each. Idempotent: peers already in
   * `perPeer` are skipped.
   */
  start(): void {
    if (this.stopped) {
      throw new Error("PeerSyncDialer was stopped — create a new one");
    }
    this.refreshTargets();
  }

  /**
   * Re-check the device list for new daemon peers. Called externally
   * after a device-list change (e.g. after `applyInboundDeviceListEvent`
   * adds a new peer) so the dialer picks them up immediately.
   */
  refreshTargets(): void {
    if (this.stopped) return;
    const peers = this.discoverPeers();
    for (const peer of peers) {
      if (this.perPeer.has(peer.deviceId)) continue;
      this.perPeer.set(peer.deviceId, {
        socket: null,
        reconnectAttempts: 0,
        reconnectTimer: null,
      });
      this.dialPeer(peer.deviceId);
    }
    // We deliberately do NOT remove perPeer entries for peers no longer
    // in the device list — the device-removed event flow is Phase 2.g
    // and will close the session via PeerSessionRegistry.remove.
  }

  /** Stop all dial loops and close in-flight sockets. */
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

  private discoverPeers(): readonly StoredDevice[] {
    return this.options.getLocalDeviceList().filter((d) => {
      if (d.deviceId === this.options.selfDeviceId) return false;
      if (d.role !== "daemon") return false;
      return true;
    });
  }

  private dialPeer(peerDeviceId: string): void {
    if (this.stopped) return;
    const state = this.perPeer.get(peerDeviceId);
    if (!state) return;

    const connectionId = `peer-sync:${randomBytes(16).toString("base64url").replace(/=+$/, "")}`;
    const url = buildRelayWebSocketUrl({
      endpoint: this.options.relayEndpoint,
      serverId: peerDeviceId, // peer daemon's relay serverId == its deviceId
      role: "client",
      connectionId,
      version: 2,
    });

    const factory =
      this.options.createSocket ??
      ((u: string): DialerSocket => {
        const ws = new WebSocket(u, { handshakeTimeout: 10_000, perMessageDeflate: false });
        return wrapWsAsDialerSocket(ws);
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
        { peerDeviceIdPrefix: peerDeviceId.slice(0, 12), phase },
        "peer_sync_dialer_handshake_timeout",
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
      // Send our hello first (initiator side).
      const built = buildPeerHello({
        selfDeviceId: this.options.selfDeviceId,
        selfSignPrivateKey: this.options.selfSignPrivateKey,
      });
      ourEphPrivKeyB64 = built.ephPrivateKeyB64;
      try {
        socket.send(JSON.stringify(built.hello));
        phase = "awaiting-hello";
      } catch (err) {
        this.log.warn(
          { err, peerDeviceIdPrefix: peerDeviceId.slice(0, 12) },
          "peer_sync_dialer_hello_send_failed",
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
        this.log.warn(
          { peerDeviceIdPrefix: peerDeviceId.slice(0, 12) },
          "peer_sync_dialer_unparseable_frame",
        );
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
          peerDeviceId,
          ourEphPrivKeyB64,
          socket,
          onEstablished: (key) => {
            sharedKeyHandle = key;
            registered = true;
            phase = "established";
            clearTimeout(handshakeDeadline);
            // Reset reconnect counter — a successful handshake is the
            // signal to start counting fresh on the next disconnect.
            const st = this.perPeer.get(peerDeviceId);
            if (st) st.reconnectAttempts = 0;
          },
        });
        return;
      }

      if (phase === "established" && sharedKeyHandle) {
        this.handlePostHandshakeFrame({
          parsed,
          peerDeviceId,
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
        this.options.sessions.remove(peerDeviceId);
      }
      const stateAfter = this.perPeer.get(peerDeviceId);
      if (stateAfter) stateAfter.socket = null;
      this.log.info(
        {
          code,
          reason: reason?.toString?.() ?? "",
          peerDeviceIdPrefix: peerDeviceId.slice(0, 12),
          wasEstablished,
        },
        "peer_sync_dialer_socket_closed",
      );
      this.scheduleReconnect(peerDeviceId);
    });

    socket.on("error", (err) => {
      this.log.warn(
        { err, peerDeviceIdPrefix: peerDeviceId.slice(0, 12) },
        "peer_sync_dialer_socket_error",
      );
      // ws emits 'close' after 'error'; the close handler handles cleanup.
    });
  }

  private handlePeerHello(args: {
    parsed: unknown;
    peerDeviceId: string;
    ourEphPrivKeyB64: string | null;
    socket: DialerSocket;
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
    const validated = PeerHelloSchema.safeParse(args.parsed);
    if (!validated.success) {
      this.log.warn(
        { issues: validated.error.issues, peerDeviceIdPrefix: args.peerDeviceId.slice(0, 12) },
        "peer_sync_dialer_hello_schema_rejected",
      );
      try {
        args.socket.close(1008, "bad_hello_schema");
      } catch {
        // ignore
      }
      return;
    }
    const incoming = validated.data;

    if (incoming.fromDeviceId !== args.peerDeviceId) {
      // The peer told us they are someone else than the one we dialed.
      // Could be a relay-routing bug or an attacker. Tear down hard.
      this.log.warn(
        {
          dialedPrefix: args.peerDeviceId.slice(0, 12),
          claimedPrefix: incoming.fromDeviceId.slice(0, 12),
        },
        "peer_sync_dialer_peer_identity_mismatch",
      );
      try {
        args.socket.close(1008, "peer_identity_mismatch");
      } catch {
        // ignore
      }
      return;
    }

    const peerDevice = this.options
      .getLocalDeviceList()
      .find((d) => d.deviceId === incoming.fromDeviceId);
    if (!peerDevice) {
      // Dialed peer disappeared from device list mid-handshake.
      try {
        args.socket.close(1008, "peer_no_longer_known");
      } catch {
        // ignore
      }
      return;
    }
    const verifyOutcome = verifyPeerHello({
      hello: incoming,
      expectedSourceDevice: peerDevice,
    });
    if (!verifyOutcome.ok) {
      this.log.warn(
        { reason: verifyOutcome.reason, peerDeviceIdPrefix: args.peerDeviceId.slice(0, 12) },
        "peer_sync_dialer_hello_verify_failed",
      );
      try {
        args.socket.close(1008, "hello_verify_failed");
      } catch {
        // ignore
      }
      return;
    }

    const sharedKey = deriveSessionSharedKey({
      ourEphPrivKeyB64: args.ourEphPrivKeyB64,
      peerEphPubKeyB64: incoming.ephPubKeyB64,
    });
    this.options.sessions.add({
      peerDeviceId: args.peerDeviceId,
      sharedKey,
      socket: args.socket as PeerSessionSocket,
      establishedAtMs: (this.options.now ?? Date.now)(),
    });
    this.log.info(
      { peerDeviceIdPrefix: args.peerDeviceId.slice(0, 12) },
      "peer_sync_dialer_session_established",
    );
    args.onEstablished(sharedKey);
    // Phase 2.f/3 catch-up: now that we have a session, IdentityService
    // can replay any events the peer might not have seen yet.
    try {
      this.options.onSessionEstablished?.(args.peerDeviceId);
    } catch (err) {
      this.log.warn(
        { err, peerDeviceIdPrefix: args.peerDeviceId.slice(0, 12) },
        "peer_sync_dialer_on_established_threw",
      );
    }
  }

  private handlePostHandshakeFrame(args: {
    parsed: unknown;
    peerDeviceId: string;
    sharedKey: import("@ottie/relay/e2ee").SharedKey;
    socket: DialerSocket;
  }): void {
    const frameValidated = PeerSyncFrameSchema.safeParse(args.parsed);
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
      plaintext = decryptPeerSyncFrame({
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
    const eventValidated = DeviceListEventSchema.safeParse(payload);
    if (eventValidated.success) {
      try {
        this.options.applyInboundEvent(eventValidated.data);
      } catch (err) {
        this.log.warn(
          { err, peerDeviceIdPrefix: args.peerDeviceId.slice(0, 12) },
          "peer_sync_dialer_apply_threw",
        );
      }
      return;
    }
    // Phase 4 v3/c §7.5.1: try the ai-share coordination schema.
    const coordValidated = AiShareCoordinationEventSchema.safeParse(payload);
    if (coordValidated.success && this.options.applyInboundCoordinationEvent) {
      try {
        this.options.applyInboundCoordinationEvent(coordValidated.data);
      } catch (err) {
        this.log.warn(
          { err, peerDeviceIdPrefix: args.peerDeviceId.slice(0, 12) },
          "peer_sync_dialer_coordination_apply_threw",
        );
      }
      return;
    }
    // Unknown payload type — leave session up; this may be a future
    // message kind from a newer peer.
  }

  private scheduleReconnect(peerDeviceId: string): void {
    if (this.stopped) return;
    const state = this.perPeer.get(peerDeviceId);
    if (!state) return;
    if (state.reconnectTimer) return;

    state.reconnectAttempts += 1;
    if (state.reconnectAttempts > RECONNECT_MAX_ATTEMPTS) {
      this.log.warn(
        {
          peerDeviceIdPrefix: peerDeviceId.slice(0, 12),
          attempts: state.reconnectAttempts,
        },
        "peer_sync_dialer_giving_up_for_now",
      );
      // Reset so a future device-list refresh / event activity can
      // trigger a fresh round.
      state.reconnectAttempts = 0;
      return;
    }

    const target = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * state.reconnectAttempts);
    const delayMs = Math.round(target * (0.75 + Math.random() * 0.5));
    state.reconnectTimer = setTimeout(() => {
      if (this.stopped) return;
      const fresh = this.perPeer.get(peerDeviceId);
      if (fresh) fresh.reconnectTimer = null;
      this.dialPeer(peerDeviceId);
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

function wrapWsAsDialerSocket(ws: WebSocket): DialerSocket {
  return {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    on: (event, listener) => {
      // Each overload of `on` in DialerSocket has a stricter listener
      // signature than ws.WebSocket exposes; the union is preserved at
      // call sites so we forward through `as never`.
      ws.on(event, listener as never);
    },
  };
}
