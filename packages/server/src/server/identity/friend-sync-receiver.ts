import type { KeyObject } from "node:crypto";

import type { RelayConnectionHandler } from "../relay-transport.js";

import { FriendSessionRegistry } from "./friend-session-registry.js";
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
 * Phase 3.b/1c — receiver-side handler for friend-sync traffic. Plugs
 * into `relay-transport.ts` via `connectionHandlers` (the same extension
 * point Phase 2.d uses for device-link, Phase 2.f/2b for peer-sync,
 * Phase 3.a/2 for friend-pair).
 *
 * Cross-identity analog of `peer-sync-receiver.ts`. Differences from
 * peer-sync receiver:
 *   - The expected source is looked up in `peers.json` (Phase 3.a/3),
 *     keyed by root pubkey.
 *   - The hello is signed by the peer's ROOT key, verified against the
 *     `peerRootSignPublicKeyB64` from peers.json.
 *   - Our reply hello is signed by OUR root key (so the peer can verify
 *     against their copy of our root pubkey from their peers.json).
 *   - Inbound payload is opaque to this layer — Phase 3.b/1d injects a
 *     decoder + handler for chat-message envelopes.
 *
 * Lifecycle of a friend-sync socket on the responder side:
 *   1. Initiator (a friend's daemon, e.g. Bob) opens a relay connection
 *      with `connectionId="friend-sync:<random nonce>"`. relay-transport
 *      routes it to this handler.
 *   2. We expect ONE inbound friend-hello frame. Schema-validate, look
 *      up the source peer in local peers.json by rootPubKey, verify the
 *      Ed25519 signature against that peer's root public key. Refuse
 *      blocked / removed peers.
 *   3. We build our own friend-hello (signed under THIS daemon's ROOT
 *      key), send it back, derive the X25519 shared key.
 *   4. Register the session with the FriendSessionRegistry.
 *   5. Subsequent inbound frames are decrypted as FriendSyncFrame, the
 *      plaintext is JSON-parsed, and handed to the injected
 *      applyInboundPayload callback. Schema validation + persistence
 *      live one layer up (Phase 3.b/1d).
 *   6. On socket close: drop from registry. The dialer (this same file's
 *      sibling, friend-sync-dialer.ts) will reconnect for outbound.
 */

const CONNECTION_ID_PREFIX = "friend-sync:";
const MAX_FRAME_BYTES = 256 * 1024;

export interface FriendSyncReceiverDeps {
  /** This daemon's root sign public key (Ed25519 JWK 'x'). */
  selfRootPubKey: string;
  /** This daemon's root sign PRIVATE key. Used to sign our reply hello. */
  selfRootSignPrivateKey: KeyObject;
  /** This daemon's stable serverId — included in our hello for audit/routing. */
  selfDeviceId: string;
  /**
   * Snapshot of the current local peer list. Called at the moment of
   * verification so a friend just paired (Phase 3.a/3) is immediately
   * trustable. Always returns the freshest in-memory copy from
   * IdentityService.
   */
  getLocalPeerList: () => readonly StoredPeer[];
  /** Where to register the session. */
  sessions: FriendSessionRegistry;
  /**
   * Called for each well-formed inbound payload after decryption +
   * JSON parsing. Phase 3.b/1d will plug in a chat-message envelope
   * schema check + persistence path here. Returns void; schema
   * rejection is logged at the IdentityService layer.
   */
  applyInboundPayload: (input: { peerRootPubKey: string; payload: unknown }) => void;
  /**
   * Optional hook invoked once per session right after the SIGMA-I
   * handshake completes and the session is registered. Phase 3.b/2
   * will use this to drain the KV inbox for any messages received
   * while we were offline.
   */
  onSessionEstablished?: (peerRootPubKey: string) => void;
  /** Override clock for tests. */
  now?: () => number;
}

export function createFriendSyncConnectionHandler(
  deps: FriendSyncReceiverDeps,
): RelayConnectionHandler {
  const now = deps.now ?? (() => Date.now());

  return {
    name: "friend-sync",
    matches: (connectionId) => connectionId.startsWith(CONNECTION_ID_PREFIX),
    handle: async ({ socket, connectionId, logger }) => {
      let phase: "awaiting-hello" | "established" | "closed" = "awaiting-hello";
      let peerRootPubKey: string | null = null;
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
          logger.warn("friend_sync_handler_unparseable_frame");
          close(1003, "unparseable_frame");
          return;
        }
        if (text.length > MAX_FRAME_BYTES) {
          logger.warn(
            { sizeBytes: text.length, capBytes: MAX_FRAME_BYTES },
            "friend_sync_handler_oversized_frame",
          );
          close(1009, "oversized_frame");
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          logger.warn({ err }, "friend_sync_handler_json_parse_failed");
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
        const validated = FriendHelloSchema.safeParse(parsed);
        if (!validated.success) {
          logger.warn(
            { issues: validated.error.issues },
            "friend_sync_handler_hello_schema_rejected",
          );
          close(1008, "bad_hello_schema");
          return;
        }
        const incoming = validated.data;

        const localPeers = deps.getLocalPeerList();
        const sourcePeer = localPeers.find(
          (p) => p.peerRootSignPublicKeyB64 === incoming.fromRootPubKey,
        );
        if (!sourcePeer) {
          logger.warn(
            { fromRootPubKeyPrefix: incoming.fromRootPubKey.slice(0, 8) },
            "friend_sync_handler_unknown_peer",
          );
          close(1008, "unknown_peer");
          return;
        }

        const verifyOutcome = verifyFriendHello({
          hello: incoming,
          expectedPeer: sourcePeer,
        });
        if (!verifyOutcome.ok) {
          logger.warn({ reason: verifyOutcome.reason }, "friend_sync_handler_hello_verify_failed");
          close(1008, "hello_verify_failed");
          return;
        }

        // Build + send our reply hello (responder side). Bob can verify
        // us with his copy of OUR rootPubKey from his peers.json.
        const ourHello = buildFriendHello({
          selfRootPubKey: deps.selfRootPubKey,
          selfDeviceId: deps.selfDeviceId,
          selfRootSignPrivateKey: deps.selfRootSignPrivateKey,
        });
        try {
          socket.send(JSON.stringify(ourHello.hello));
        } catch (err) {
          logger.warn({ err }, "friend_sync_handler_hello_send_failed");
          close(1011, "hello_send_failed");
          return;
        }

        sharedKeyHandle = deriveFriendSessionSharedKey({
          ourEphPrivKeyB64: ourHello.ephPrivateKeyB64,
          peerEphPubKeyB64: incoming.ephPubKeyB64,
        });
        peerRootPubKey = incoming.fromRootPubKey;
        peerDeviceId = incoming.fromDeviceId;
        deps.sessions.add({
          peerRootPubKey,
          peerDeviceId,
          sharedKey: sharedKeyHandle,
          socket,
          establishedAtMs: now(),
        });
        registered = true;
        phase = "established";

        logger.info(
          {
            peerRootPubKeyPrefix: peerRootPubKey.slice(0, 8),
            peerDeviceIdPrefix: peerDeviceId.slice(0, 12),
            connectionId,
          },
          "friend_sync_session_established",
        );
        try {
          deps.onSessionEstablished?.(peerRootPubKey);
        } catch (err) {
          logger.warn({ err }, "friend_sync_handler_on_established_threw");
        }
      };

      const handleIncomingFrame = (parsed: unknown): void => {
        if (!sharedKeyHandle || !peerRootPubKey) {
          logger.warn("friend_sync_handler_frame_without_shared_key");
          close(1011, "internal_no_key");
          return;
        }
        const frameValidated = FriendSyncFrameSchema.safeParse(parsed);
        if (!frameValidated.success) {
          logger.warn(
            { issues: frameValidated.error.issues },
            "friend_sync_handler_frame_schema_rejected",
          );
          close(1008, "bad_frame_schema");
          return;
        }

        let plaintext: string;
        try {
          plaintext = decryptFriendSyncFrame({
            sharedKey: sharedKeyHandle,
            frame: frameValidated.data,
          });
        } catch (err) {
          logger.warn({ err }, "friend_sync_handler_decrypt_failed");
          close(1008, "decrypt_failed");
          return;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(plaintext);
        } catch (err) {
          logger.warn({ err }, "friend_sync_handler_payload_parse_failed");
          close(1008, "bad_payload_json");
          return;
        }

        try {
          deps.applyInboundPayload({ peerRootPubKey, payload });
        } catch (err) {
          logger.warn({ err }, "friend_sync_handler_apply_threw");
          // Application-level apply errors are non-fatal — the peer
          // doesn't need to know, and other frames on this session
          // may still apply cleanly.
        }
      };

      socket.on("close", (code, reason) => {
        const wasRegistered = registered;
        if (registered && peerRootPubKey) {
          deps.sessions.remove(peerRootPubKey);
          registered = false;
        }
        phase = "closed";
        logger.info(
          {
            code,
            reason: reason.toString(),
            peerRootPubKeyPrefix: peerRootPubKey?.slice(0, 8),
            wasRegistered,
          },
          "friend_sync_handler_socket_closed",
        );
      });

      socket.on("error", (err) => {
        logger.warn({ err }, "friend_sync_handler_socket_error");
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
