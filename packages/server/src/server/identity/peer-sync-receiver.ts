import type { KeyObject } from "node:crypto";

import type { RelayConnectionHandler } from "../relay-transport.js";

import { DeviceListEventSchema, type DeviceListEvent } from "./device-list-event-types.js";
import type { StoredDevice } from "./device-types.js";
import { PeerSessionRegistry } from "./peer-session-registry.js";
import {
  buildPeerHello,
  decryptPeerSyncFrame,
  deriveSessionSharedKey,
  PeerHelloSchema,
  PeerSyncFrameSchema,
  verifyPeerHello,
} from "./peer-sync-handshake.js";

/**
 * Phase 2.f/2b — receiver-side handler for peer-sync traffic. Plugs
 * into `relay-transport.ts` via `connectionHandlers` (the same
 * extension point Phase 2.d uses for device-link).
 *
 * Lifecycle of a peer-sync socket on the responder side:
 *
 *   1. Initiator (some peer daemon of the same user) opens a relay
 *      connection with `connectionId="peer-sync:<random nonce>"`.
 *      relay-transport's dispatcher routes it here.
 *   2. We expect ONE inbound peer-hello frame. Schema-validate, look
 *      up the source device in the local device list, verify the
 *      Ed25519 signature against that device's public key.
 *   3. We build our own peer-hello (signed under THIS daemon's self-
 *      device key), send it back, derive the X25519 shared key.
 *   4. Register the session with the PeerSessionRegistry.
 *   5. Subsequent inbound frames are decrypted as PeerSyncFrame, parsed
 *      as DeviceListEvent, and applied via the injected callback (which
 *      bridges to IdentityService.applyInboundDeviceListEvent).
 *   6. On socket close: drop from registry. Phase 2.f/2c will reconnect
 *      from the dialer side if appropriate.
 *
 * Outbound broadcast (e.g. emit a local device-added event to all
 * peers) is Phase 2.f/3 — that lives outside this module, working off
 * the registry directly.
 */

const CONNECTION_ID_PREFIX = "peer-sync:";
const MAX_FRAME_BYTES = 256 * 1024; // 256 KiB — handshake/event frames are tiny

export interface PeerSyncReceiverDeps {
  /** This daemon's deviceId (== serverId for daemon role). */
  selfDeviceId: string;
  /** This daemon's Ed25519 self-device PRIVATE key, for signing our peer-hello. */
  selfSignPrivateKey: KeyObject;
  /**
   * Snapshot of the current local device list. Called at the moment of
   * verification so a peer just added via device-link is immediately
   * trustable. Always returns the freshest in-memory copy from
   * IdentityService.
   */
  getLocalDeviceList: () => readonly StoredDevice[];
  /** Where to register the session for Phase 2.f/3 broadcast. */
  sessions: PeerSessionRegistry;
  /**
   * Called for each well-formed inbound event after decryption +
   * schema validation. Returns void; rejection is logged at the
   * IdentityService layer (the apply path returns rejected outcomes
   * but we don't propagate them back to the peer for Phase 2.f/2b —
   * Phase 2.f/3+ may add an ack/nack channel).
   */
  applyInboundEvent: (event: DeviceListEvent) => void;
  /**
   * Phase 2.f/3 hook: called once per session right after the SIGMA-I
   * handshake completes and the session is registered. Used by
   * IdentityService to replay the local events log to the peer for
   * catch-up. Failures here must NOT close the session — replay is
   * best-effort.
   */
  onSessionEstablished?: (peerDeviceId: string) => void;
  /** Override clock for tests. */
  now?: () => number;
}

export function createPeerSyncConnectionHandler(
  deps: PeerSyncReceiverDeps,
): RelayConnectionHandler {
  const now = deps.now ?? (() => Date.now());

  return {
    name: "peer-sync",
    matches: (connectionId) => connectionId.startsWith(CONNECTION_ID_PREFIX),
    handle: async ({ socket, connectionId, logger }) => {
      let phase: "awaiting-hello" | "established" | "closed" = "awaiting-hello";
      let peerDeviceId: string | null = null;
      let sharedKeyHandle: import("@ottie/relay/e2ee").SharedKey | null = null;
      let registered = false;

      const close = (code: number, reason: string): void => {
        if (phase === "closed") return;
        phase = "closed";
        try {
          socket.close(code, reason);
        } catch {
          // ignore
        }
      };

      socket.on("message", (raw, isBinary) => {
        if (phase === "closed") return;
        const text = decodeFrame(raw, isBinary);
        if (text === null) {
          logger.warn("peer_sync_handler_unparseable_frame");
          close(1003, "unparseable_frame");
          return;
        }
        if (text.length > MAX_FRAME_BYTES) {
          logger.warn(
            { sizeBytes: text.length, capBytes: MAX_FRAME_BYTES },
            "peer_sync_handler_oversized_frame",
          );
          close(1009, "oversized_frame");
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          logger.warn({ err }, "peer_sync_handler_json_parse_failed");
          close(1003, "bad_json");
          return;
        }

        if (phase === "awaiting-hello") {
          handleIncomingHello(parsed);
          return;
        }
        if (phase === "established") {
          handleIncomingFrame(parsed);
        }
      });

      const handleIncomingHello = (parsed: unknown): void => {
        const validated = PeerHelloSchema.safeParse(parsed);
        if (!validated.success) {
          logger.warn(
            { issues: validated.error.issues },
            "peer_sync_handler_hello_schema_rejected",
          );
          close(1008, "bad_hello_schema");
          return;
        }
        const incoming = validated.data;

        const localDevices = deps.getLocalDeviceList();
        const sourceDevice = localDevices.find((d) => d.deviceId === incoming.fromDeviceId);
        if (!sourceDevice) {
          logger.warn(
            { fromDeviceIdPrefix: incoming.fromDeviceId.slice(0, 12) },
            "peer_sync_handler_unknown_peer",
          );
          close(1008, "unknown_peer");
          return;
        }

        const verifyOutcome = verifyPeerHello({
          hello: incoming,
          expectedSourceDevice: sourceDevice,
        });
        if (!verifyOutcome.ok) {
          logger.warn({ reason: verifyOutcome.reason }, "peer_sync_handler_hello_verify_failed");
          close(1008, "hello_verify_failed");
          return;
        }

        // Build + send our hello (responder side). We reuse the
        // SIGMA-I signature so peer can verify us with their copy of
        // OUR self-device public key from their devices.json.
        const ourHello = buildPeerHello({
          selfDeviceId: deps.selfDeviceId,
          selfSignPrivateKey: deps.selfSignPrivateKey,
        });
        try {
          socket.send(JSON.stringify(ourHello.hello));
        } catch (err) {
          logger.warn({ err }, "peer_sync_handler_hello_send_failed");
          close(1011, "hello_send_failed");
          return;
        }

        sharedKeyHandle = deriveSessionSharedKey({
          ourEphPrivKeyB64: ourHello.ephPrivateKeyB64,
          peerEphPubKeyB64: incoming.ephPubKeyB64,
        });
        peerDeviceId = incoming.fromDeviceId;
        deps.sessions.add({
          peerDeviceId,
          sharedKey: sharedKeyHandle,
          socket,
          establishedAtMs: now(),
        });
        registered = true;
        phase = "established";

        logger.info(
          { peerDeviceIdPrefix: peerDeviceId.slice(0, 12), connectionId },
          "peer_sync_session_established",
        );
        // Phase 2.f/3 catch-up: notify IdentityService to replay the
        // local events log so the freshly-connected peer catches up.
        try {
          deps.onSessionEstablished?.(peerDeviceId);
        } catch (err) {
          logger.warn({ err }, "peer_sync_handler_on_established_threw");
        }
      };

      const handleIncomingFrame = (parsed: unknown): void => {
        if (!sharedKeyHandle) {
          // Defensive: phase==="established" should imply a key is set.
          logger.warn("peer_sync_handler_frame_without_shared_key");
          close(1011, "internal_no_key");
          return;
        }
        const frameValidated = PeerSyncFrameSchema.safeParse(parsed);
        if (!frameValidated.success) {
          logger.warn(
            { issues: frameValidated.error.issues },
            "peer_sync_handler_frame_schema_rejected",
          );
          // A protocol error mid-session: tear down so the peer reconnects
          // and we can re-handshake with fresh state.
          close(1008, "bad_frame_schema");
          return;
        }

        let plaintext: string;
        try {
          plaintext = decryptPeerSyncFrame({
            sharedKey: sharedKeyHandle,
            frame: frameValidated.data,
          });
        } catch (err) {
          logger.warn({ err }, "peer_sync_handler_decrypt_failed");
          close(1008, "decrypt_failed");
          return;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(plaintext);
        } catch (err) {
          logger.warn({ err }, "peer_sync_handler_payload_parse_failed");
          // A bad payload after decryption is unusual — treat as
          // protocol error and close.
          close(1008, "bad_payload_json");
          return;
        }

        const eventValidated = DeviceListEventSchema.safeParse(payload);
        if (!eventValidated.success) {
          logger.warn(
            { issues: eventValidated.error.issues },
            "peer_sync_handler_event_schema_rejected",
          );
          // Unknown payload type — Phase 2.f/3+ may add other kinds, but
          // for now reject unknowns. Don't close the socket because the
          // session is still valid.
          return;
        }

        try {
          deps.applyInboundEvent(eventValidated.data);
        } catch (err) {
          logger.warn({ err }, "peer_sync_handler_apply_threw");
          // Application-level apply errors are non-fatal — the peer
          // doesn't need to know, and other events on this session
          // may still apply cleanly.
        }
      };

      socket.on("close", (code, reason) => {
        const wasRegistered = registered;
        if (registered && peerDeviceId) {
          deps.sessions.remove(peerDeviceId);
          registered = false;
        }
        phase = "closed";
        logger.info(
          {
            code,
            reason: reason.toString(),
            peerDeviceIdPrefix: peerDeviceId?.slice(0, 12),
            wasRegistered,
          },
          "peer_sync_handler_socket_closed",
        );
      });

      socket.on("error", (err) => {
        logger.warn({ err }, "peer_sync_handler_socket_error");
      });
    },
  };
}

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
