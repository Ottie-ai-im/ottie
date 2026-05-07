import { randomUUID as randomUuid, sign as nodeSign, type KeyObject } from "node:crypto";
import type pino from "pino";

import type { RelayConnectionHandler } from "../relay-transport.js";

import { buildAuthorizedDevice, loadDeviceList, saveDeviceList } from "./device-list-store.js";
import {
  applyDeviceListEvent,
  signDeviceAddedEvent,
  signDeviceRemovedEvent,
} from "./device-list-event.js";
import { DeviceListEventStore } from "./device-list-event-store.js";
import type { DeviceListEvent } from "./device-list-event-types.js";
import { DeviceLinkPendingCandidateStore } from "./device-link-pending-candidate-store.js";
import { PeerSessionRegistry, type PeerSession } from "./peer-session-registry.js";
import { PeerSyncDialer } from "./peer-sync-dialer.js";
import { encryptPeerSyncFrame } from "./peer-sync-handshake.js";
import { createPeerSyncConnectionHandler } from "./peer-sync-receiver.js";
import {
  DeviceLinkPendingStore,
  type CreatePendingOfferResult,
} from "./device-link-pending-store.js";
import { approveDeviceLinkCandidate, rejectDeviceLinkCandidate } from "./device-link-approve.js";
import { createDeviceLinkConnectionHandler } from "./device-link-receiver.js";
import {
  redeemDeviceLinkOffer,
  type RedeemDeviceLinkOfferInput,
  type RedeemDeviceLinkOfferOutcome,
} from "./device-link-sender.js";
import { approveFriendPairCandidate, rejectFriendPairCandidate } from "./friend-pair-approve.js";
import { FriendPairPendingCandidateStore } from "./friend-pair-pending-candidate-store.js";
import {
  FriendPairPendingStore,
  type CreatePendingFriendPairOfferResult,
} from "./friend-pair-pending-store.js";
import { createFriendPairConnectionHandler } from "./friend-pair-receiver.js";
import {
  redeemFriendPairOffer,
  type RedeemFriendPairOfferInput,
  type RedeemFriendPairOfferOutcome,
} from "./friend-pair-sender.js";
import { p2pRoomId, type ChatMessage } from "../chat/chat-types.js";

import {
  buildFriendChatMessageEnvelope,
  verifyFriendChatMessageEnvelope,
} from "./friend-chat-crypto.js";
import {
  appendFriendChatMessage,
  listFriendChatMessages,
  type StoredFriendChatMessage,
} from "./friend-chat-store.js";
import {
  FriendChatMessageEnvelopeSchema,
  type FriendChatMessageEnvelope,
} from "./friend-chat-types.js";
import { FriendSessionRegistry } from "./friend-session-registry.js";
import { FriendSyncDialer } from "./friend-sync-dialer.js";
import { encryptFriendSyncFrame } from "./friend-sync-handshake.js";
import { createFriendSyncConnectionHandler } from "./friend-sync-receiver.js";
import { encryptInboxBlob } from "./friend-inbox-crypto.js";
import { postInbox, type InboxAuthSigner } from "./friend-inbox-client.js";
import { processInboxOnce } from "./friend-inbox-receiver.js";
import type { AgentManagerEvent } from "../agent/agent-manager.js";
import {
  buildAiShareAcceptEnvelope,
  buildAiShareDeclineEnvelope,
  buildAiShareEndEnvelope,
  buildAiShareInviteEnvelope,
  buildAiSharePromptEnvelope,
  buildAiShareTimelineEnvelope,
  tryParseAiShareEnvelope,
  verifyAiShareAcceptEnvelope,
  verifyAiShareDeclineEnvelope,
  verifyAiShareEndEnvelope,
  verifyAiShareInviteEnvelope,
  verifyAiSharePromptEnvelope,
  verifyAiShareTimelineEnvelope,
} from "./ai-share-crypto.js";
import { AiShareInviteRegistry } from "./ai-share-registry.js";
import { redactAgentEventForShare } from "./ai-share-timeline-redactor.js";
import { AiShareTimelineStore, type AiShareTimelineRecord } from "./ai-share-timeline-buffer.js";
import { AiShareTranscriptStore } from "./ai-share-transcript-store.js";
import {
  buildAiShareIntentBroadcastEvent,
  buildAiShareIntentResolutionEvent,
  verifyAiShareCoordinationEvent,
} from "./ai-share-coordination-crypto.js";
import type { AiShareCoordinationEvent } from "./ai-share-coordination-types.js";
import { DEFAULT_AI_SHARE_LIMITS } from "./ai-share-types.js";
import type {
  AiShareAcceptEnvelope,
  AiShareDeclineEnvelope,
  AiShareEndEnvelope,
  AiShareInviteEnvelope,
  AiShareLimits,
  AiSharePromptEnvelope,
  AiShareTimelineEnvelope,
} from "./ai-share-types.js";
import { loadPeerList, savePeerList, upsertPeer } from "./peer-store.js";
import type { StoredPeer, StoredPeerList } from "./peer-types.js";
import { type StoredDevice, type StoredDeviceList } from "./device-types.js";
import type { PendingDeviceLinkCandidateOnWire } from "./identity-rpc-schemas.js";
import {
  createRootIdentity,
  loadRootIdentity,
  writeImportedRootIdentity,
  type RootIdentityBundle,
} from "./root-identity-store.js";
import {
  createSelfDevice,
  loadSelfDevice,
  writeImportedSelfDevice,
  type SelfDeviceBundle,
} from "./self-device-store.js";

/**
 * Lifecycle state of the root identity at daemon startup.
 *
 * - "uninitialized": no identity file on disk yet — first run. The UI is
 *   expected to prompt the user for a display name and call `initialize()`
 *   (via the WS RPC wired in Phase 1.g).
 *
 * - "loaded": identity file exists, parses cleanly, and is ready to use.
 *
 * - "load-failed": identity file exists but failed to parse (corruption,
 *   schema mismatch, …). The daemon keeps running so the user can be told
 *   something is wrong, but no identity-dependent operations should
 *   proceed. We deliberately do NOT auto-regenerate — losing the root key
 *   would change the user's externally visible identity and silently break
 *   all existing friend pairings.
 */
export type IdentityState =
  | { readonly kind: "uninitialized" }
  | { readonly kind: "loaded"; readonly bundle: RootIdentityBundle }
  | { readonly kind: "load-failed"; readonly error: Error };

export interface IdentityServiceOptions {
  ottieHome: string;
  logger: pino.Logger;
  /**
   * Phase 2.a: required for self-device management. If omitted, the
   * service still handles root identity, but `getSelfDevice()` returns
   * `null` and `getDeviceList()` returns `[]`. Tests that only exercise
   * root-identity behavior can leave it out.
   */
  selfDeviceContext?: SelfDeviceContext;
  /**
   * Phase 2.c: relay host:port that gets embedded into device-link offers
   * so the new device knows where to send its candidate Device record.
   * Optional because tests and CLI-only paths don't need to generate
   * offers; when omitted, `generateDeviceLinkOffer()` returns null.
   */
  relayEndpoint?: string;
}

export interface SelfDeviceContext {
  /** Stable daemon identifier; reused as the deviceId for role="daemon". */
  serverId: string;
  /** Human-readable label for this device. Default: hostname. */
  deviceLabel: string;
}

/**
 * Phase 4 v2/b — picker-friendly view of a local agent. Just enough
 * for the owner's invite modal to render a row + send a real
 * `agentId` / `agentLabel` / `agentProvider` in the invite envelope.
 */
export interface ShareableAgentSummary {
  agentId: string;
  /** Provider key — `claude` / `codex` / `opencode` etc. */
  agentProvider: string;
  /** Display label. Falls back to provider+shortId when no title is set. */
  agentLabel: string;
  /** Live state — picker can grey out non-idle/running rows if it wants. */
  lifecycle: "initializing" | "idle" | "running" | "error" | "closed";
  /** Current working directory (helps disambiguate same-provider agents). */
  cwd: string;
}

/**
 * Phase 4 v2/b — narrow interface that lets the identity service talk
 * to AgentManager without depending on the full module. Bootstrap wires
 * the real implementation; tests that don't need prompt routing leave
 * it null and `sendAiSharePrompt`/inbound prompt arrival become no-ops
 * (with a logged warning, not a throw).
 *
 * Phase 4 v2/d extends this with `subscribeAgent` so the broadcaster
 * can stream redacted timeline events back to the friend.
 */
export interface AiShareAgentBridge {
  listShareableAgents(): ShareableAgentSummary[];
  /**
   * Inject a prompt into the named agent. Owner side calls this on
   * receipt of a verified `ai-share-prompt`. Returns the response
   * promise but the dispatcher discards it — v2/d streams the timeline
   * back via `subscribeAgent`, v2/b only logged success/failure.
   */
  injectPrompt(input: { agentId: string; body: string }): Promise<void>;
  /**
   * Phase 4 v2/d — subscribe to agent-stream events for the given
   * agent. Returns an unsubscribe handle. The broadcaster opens one
   * subscription per active outbound share and tears it down when the
   * share ends (registry's `applyOutboundEnd` calls the handle).
   */
  subscribeAgent(input: {
    agentId: string;
    onEvent: (event: AgentManagerEvent) => void;
  }): () => void;
}

/**
 * Daemon-side wrapper around the on-disk root identity and device list.
 * Constructed once at bootstrap; consumed by WS RPC handlers (Phase 1.g),
 * CLI (Phase 1.d), and the cross-device flows in later phases.
 */
export class IdentityService {
  private readonly ottieHome: string;
  private readonly logger: pino.Logger;
  private readonly selfDeviceContext: SelfDeviceContext | null;
  private readonly relayEndpoint: string | null;
  private readonly pendingDeviceLinks: DeviceLinkPendingStore;
  private readonly pendingCandidates: DeviceLinkPendingCandidateStore;
  private readonly pendingFriendPairs: FriendPairPendingStore;
  private readonly pendingFriendPairCandidates: FriendPairPendingCandidateStore;
  private readonly events: DeviceListEventStore;
  private readonly peerSessions: PeerSessionRegistry;
  private peerDialer: PeerSyncDialer | null = null;
  private readonly friendSessions: FriendSessionRegistry;
  private friendDialer: FriendSyncDialer | null = null;
  /** Phase 4 v1: in-memory ai-share invitation registry (both directions). */
  private readonly aiShareInvites = new AiShareInviteRegistry({
    logger: undefined,
  });
  /**
   * Phase 4 v2/b — late-bound bridge to AgentManager so this service
   * can list shareable agents (for the friend's invite picker, owner
   * side) and inject inbound prompts (`ai-share-prompt` envelope ->
   * `runAgent`). Wired from `bootstrap.ts` after AgentManager is
   * constructed; null in tests that don't exercise the prompt path.
   */
  private aiShareAgentBridge: AiShareAgentBridge | null = null;
  /**
   * Phase 4 v2/d — friend-side ring buffer for inbound shared-agent
   * timeline frames. One sub-buffer per inviteId. v2/e adds the
   * auditable transcript on disk; this one's role is just to back the
   * friend's UI between polls.
   */
  private readonly aiShareTimelineStore = new AiShareTimelineStore();
  /**
   * Phase 4 v2/e — append-only on-disk transcript per inviteId per
   * side, at `$OTTIE_HOME/ai-shares/{inviteId}.jsonl`. Constructor
   * initializes lazily so test paths that don't pass an OTTIE_HOME
   * still work (the store handles missing dirs by warn-and-no-op).
   */
  private readonly aiShareTranscripts: AiShareTranscriptStore;
  /**
   * Phase 4 v3/c §7.5.1 — pending ai-share intents this daemon
   * has heard about (either originated locally or received from a
   * sibling owner-daemon over peer-sync). UI polls
   * `listPendingAiShareIntents` to render the picker on every online
   * owner-device. Entries auto-evict on `expiresAt` so a forgotten
   * intent doesn't stick around forever.
   */
  private readonly aiShareIntents = new Map<
    string,
    {
      intentId: string;
      peerRootPubKeyB64: string;
      sourceDeviceId: string;
      generatedAt: string;
      expiresAt: string;
      claimedByDeviceId: string | null;
    }
  >();
  /**
   * Phase 4 v3/c §7.5.1 — monotonic counter for coordination events
   * this daemon emits. Separate from the device-list event seq so
   * the two domains don't interfere.
   */
  private aiShareCoordinationSeq = 0;
  /** Phase 3.b/2d: handle for the periodic inbox poller (clearable). */
  private inboxPollHandle: ReturnType<typeof setInterval> | null = null;
  /** Phase 3.b/2d: tracks an in-flight inbox round so kicks dedupe. */
  private inboxInFlight: Promise<void> | null = null;
  private state: IdentityState;
  private selfDevice: SelfDeviceBundle | null = null;
  private deviceList: StoredDeviceList | null = null;
  private peerList: StoredPeerList | null = null;

  constructor(options: IdentityServiceOptions) {
    this.ottieHome = options.ottieHome;
    this.logger = options.logger;
    this.selfDeviceContext = options.selfDeviceContext ?? null;
    this.relayEndpoint = options.relayEndpoint ?? null;
    this.pendingDeviceLinks = new DeviceLinkPendingStore(options.logger);
    this.pendingCandidates = new DeviceLinkPendingCandidateStore(options.logger);
    this.pendingFriendPairs = new FriendPairPendingStore(options.logger);
    this.pendingFriendPairCandidates = new FriendPairPendingCandidateStore(options.logger);
    this.events = DeviceListEventStore.loadOrCreate(options.ottieHome, options.logger);
    this.peerSessions = new PeerSessionRegistry(options.logger);
    this.friendSessions = new FriendSessionRegistry(options.logger);
    this.aiShareTranscripts = new AiShareTranscriptStore({
      ottieHome: options.ottieHome,
      logger: options.logger,
    });
    this.state = this.loadInitialState();
    if (this.state.kind === "loaded" && this.selfDeviceContext) {
      // Existing daemons that pre-date Phase 2.a have a root identity but no
      // self-device file. Migrate them in-place by generating + signing the
      // self-device on first boot under the new build.
      this.ensureSelfDevice(this.state.bundle);
    }
    // Phase 3.a/3: peers.json is optional. Missing means "no friends yet".
    // Corrupt means we refuse to boot the friend list — surface to logs but
    // don't block daemon startup; non-friend code paths still work.
    if (this.state.kind === "loaded") {
      try {
        this.peerList = loadPeerList(this.ottieHome, this.logger) ?? { v: 1, peers: [] };
      } catch (err) {
        this.logger.error(
          { err, ottieHome: this.ottieHome },
          "peers.json failed to load — friend list disabled until manually inspected",
        );
        this.peerList = null;
      }
    }
  }

  private loadInitialState(): IdentityState {
    try {
      const bundle = loadRootIdentity(this.ottieHome, this.logger);
      if (bundle) {
        this.logger.info(
          {
            displayName: bundle.stored.displayName,
            rootSignPublicKeyB64Prefix: bundle.stored.signPublicKeyB64.slice(0, 8),
          },
          "Root identity loaded",
        );
        return { kind: "loaded", bundle };
      }
      this.logger.info("Root identity not yet initialized — waiting for onboarding");
      return { kind: "uninitialized" };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        { err: error, ottieHome: this.ottieHome },
        "Root identity exists but failed to load — refusing to auto-regenerate",
      );
      return { kind: "load-failed", error };
    }
  }

  getState(): IdentityState {
    return this.state;
  }

  /**
   * Returns the loaded bundle, or throws. For code paths that have already
   * verified `getState().kind === "loaded"` and want a type-narrow accessor.
   */
  requireBundle(): RootIdentityBundle {
    if (this.state.kind !== "loaded") {
      throw new Error(
        `Root identity is not loaded (state: ${this.state.kind}) — handle the state explicitly`,
      );
    }
    return this.state.bundle;
  }

  /**
   * Generate the root identity for the first time. Throws unless the
   * current state is "uninitialized" — callers should check `getState()`
   * before calling. We never overwrite a loaded identity, and we never
   * auto-recover from "load-failed" without explicit user direction.
   *
   * If `selfDeviceContext` was provided at construction time, this also
   * creates the self-device record atomically (fresh-install path).
   */
  initialize(displayName: string): RootIdentityBundle {
    if (this.state.kind !== "uninitialized") {
      throw new Error(`Cannot initialize root identity: current state is "${this.state.kind}"`);
    }
    const bundle = createRootIdentity(this.ottieHome, displayName, this.logger);
    this.state = { kind: "loaded", bundle };
    if (this.selfDeviceContext) {
      this.ensureSelfDevice(bundle);
    }
    // Phase 3.a/3: seed an empty peer list so approveFriendPair etc.
    // don't trip on `peerList === null` immediately after initialize.
    if (!this.peerList) {
      this.peerList = { v: 1, peers: [] };
    }
    // Bootstrap calls startPeerSync/startFriendSync once at daemon start;
    // when the daemon was started without an identity (first boot before
    // onboarding) those calls were no-ops. Now that identity is loaded,
    // kick the dialers ourselves — both methods are idempotent. Inbound
    // handlers are wired through bootstrap's getter-form connectionHandlers
    // so they auto-light up too.
    this.startPeerSync();
    this.startFriendSync();
    // Phase 3.b/2d: start draining the offline inbox now that we know
    // the recipient X25519 priv key (just generated/migrated above).
    this.startInboxReceiver();
    return bundle;
  }

  /**
   * Returns this device's record (role="daemon"), or null if either
   * (a) no root identity, or (b) no `selfDeviceContext` was provided.
   */
  getSelfDevice(): StoredDevice | null {
    if (!this.selfDevice || !this.deviceList) return null;
    const found = this.deviceList.devices.find(
      (d) => d.deviceId === this.selfDevice?.stored.deviceId,
    );
    return found ?? null;
  }

  /**
   * Returns the full device list (this device plus any peer devices linked
   * under the same root identity). Empty array when no identity is loaded
   * or `selfDeviceContext` wasn't provided.
   */
  getDeviceList(): readonly StoredDevice[] {
    return this.deviceList?.devices ?? [];
  }

  /**
   * Phase 3.a/3: returns the friend list (peers under different root
   * identities). Empty array when no identity is loaded or peers.json
   * failed to load.
   */
  getPeerList(): readonly StoredPeer[] {
    return this.peerList?.peers ?? [];
  }

  /**
   * Phase 2.c: generate a one-time device-link offer for adding a new
   * device under this identity. The caller (UI / CLI) renders the
   * `deepLink` as a QR code plus copy-link affordance for the new device
   * to scan. Returns null when prerequisites aren't met (no identity
   * loaded, no selfDeviceContext, or no relayEndpoint configured).
   */
  generateDeviceLinkOffer(
    options: { ttlMs?: number; nowMs?: number } = {},
  ): CreatePendingOfferResult | null {
    if (!this.selfDeviceContext) return null;
    if (!this.relayEndpoint) return null;
    if (this.state.kind !== "loaded") return null;
    return this.pendingDeviceLinks.create({
      serverId: this.selfDeviceContext.serverId,
      rootSignPublicKeyB64: this.state.bundle.stored.signPublicKeyB64,
      displayName: this.state.bundle.stored.displayName,
      relayEndpoint: this.relayEndpoint,
      ttlMs: options.ttlMs,
      nowMs: options.nowMs,
    });
  }

  /**
   * Cancel an outstanding device-link offer (user backs out of the
   * "Add device" flow). Returns true if there was something to cancel.
   */
  cancelDeviceLinkOffer(nonceB64: string): boolean {
    return this.pendingDeviceLinks.cancel(nonceB64);
  }

  /**
   * Phase 3.a/1: generate a one-time friend-pair offer for adding an
   * external peer (a different identity / different user) as a friend.
   * Cross-identity analog of `generateDeviceLinkOffer`. The deep-link
   * is rendered as a QR + "copy link" affordance for the friend to
   * scan in person. Returns null when prerequisites aren't met (no
   * identity loaded, no selfDeviceContext, no relayEndpoint configured).
   *
   * The pending offer's ephemeral private key stays in
   * `pendingFriendPairs` until the friend's daemon redeems it through
   * the relay-routed handler (Phase 3.a/2).
   */
  generateFriendPairOffer(
    options: { ttlMs?: number; nowMs?: number } = {},
  ): CreatePendingFriendPairOfferResult | null {
    if (!this.selfDeviceContext) return null;
    if (!this.relayEndpoint) return null;
    if (this.state.kind !== "loaded") return null;
    return this.pendingFriendPairs.create({
      serverId: this.selfDeviceContext.serverId,
      rootSignPublicKeyB64: this.state.bundle.stored.signPublicKeyB64,
      displayName: this.state.bundle.stored.displayName,
      relayEndpoint: this.relayEndpoint,
      ttlMs: options.ttlMs,
      nowMs: options.nowMs,
    });
  }

  /**
   * Cancel an outstanding friend-pair offer (user backs out of the
   * "Add friend" flow). Returns true if there was something to cancel.
   */
  cancelFriendPairOffer(nonceB64: string): boolean {
    return this.pendingFriendPairs.cancel(nonceB64);
  }

  /**
   * Test/diagnostic helper. Phase 3.a/2 will not consume this — redemption
   * goes through a different path involving the relay-routed handshake.
   */
  getPendingFriendPairStore(): FriendPairPendingStore {
    return this.pendingFriendPairs;
  }

  /**
   * Phase 3.a/2: relay-side handler that decrypts + signature-checks
   * incoming friend-candidate records and parks them in the friend-
   * pair candidate store for Phase 3.a/3 to surface as a "pair with
   * this person?" prompt. Bootstrap registers this handler with
   * relay-transport's `connectionHandlers` array.
   */
  createFriendPairConnectionHandler(): RelayConnectionHandler {
    return createFriendPairConnectionHandler({
      pendingOffers: this.pendingFriendPairs,
      pendingCandidates: this.pendingFriendPairCandidates,
    });
  }

  /**
   * Test/diagnostic helper for the Phase 3.a/2 receiver wiring. Phase
   * 3.a/3 will consume entries from this store via the approval flow.
   */
  getPendingFriendPairCandidateStore(): FriendPairPendingCandidateStore {
    return this.pendingFriendPairCandidates;
  }

  /**
   * Phase 3.a/2 + 3.a/3 (sender side): the responder's daemon redeems
   * a friend-pair deep-link scanned/pasted by the user. Builds a
   * candidate signed with this daemon's root key, opens a one-shot
   * relay WebSocket to the originating daemon, sends the redemption
   * envelope, awaits the originator's approval reply, and on
   * "paired" persists a Peer record for the originator into peers.json.
   *
   * Requires the daemon's root identity to be loaded — friends are
   * keyed by root pubkey, so a daemon without an identity has nothing
   * to introduce itself with.
   */
  async redeemFriendPairOffer(
    input: Omit<
      RedeemFriendPairOfferInput,
      "logger" | "selfRootSignPublicKeyB64" | "selfRootSignPrivateKey" | "selfDisplayName"
    >,
  ): Promise<RedeemFriendPairOfferOutcome> {
    if (this.state.kind !== "loaded") {
      return {
        status: "rejected",
        errorCode: "identity_uninitialized",
        errorMessage: "Cannot redeem friend-pair offer — root identity not loaded",
      };
    }
    const outcome = await redeemFriendPairOffer({
      ...input,
      selfRootSignPublicKeyB64: this.state.bundle.stored.signPublicKeyB64,
      selfRootSignPrivateKey: this.state.bundle.signPrivateKey,
      selfDisplayName: this.state.bundle.stored.displayName,
      // Phase 3.b/1a: route Bob's serverId + relayEndpoint into the
      // candidate so Alice's peers.json captures them. Skipped on tests
      // / CLI paths that don't construct with a self-device context.
      ...(this.selfDeviceContext ? { selfServerId: this.selfDeviceContext.serverId } : {}),
      ...(this.relayEndpoint ? { selfRelayEndpoint: this.relayEndpoint } : {}),
      // Phase 3.b/2a: ship Bob's X25519 pubkey so Alice can later
      // NaCl-box offline-inbox messages back to Bob's identity.
      ...(this.state.bundle.encryptionPublicKeyB64
        ? { selfEncryptionPublicKeyB64: this.state.bundle.encryptionPublicKeyB64 }
        : {}),
      logger: this.logger,
    });
    if (outcome.status !== "paired") return outcome;

    // Persist the new peer record on disk + sync in-memory state.
    try {
      this.adoptPeerFromApproval(outcome.peer);
      return outcome;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err }, "Friend-pair adopt-peer failed");
      return {
        status: "rejected",
        errorCode: "adopt_peer_failed",
        errorMessage: `Paired with the other side, but failed to persist locally: ${message}`,
      };
    }
  }

  /**
   * Phase 3.a/3: write a freshly-paired Peer record on Bob's side
   * after the redeem flow returned status="paired". Idempotent — re-
   * pairing an existing friend updates the displayName / sig but
   * doesn't duplicate the entry.
   *
   * Throws if peers.json is in a "load-failed" state (corrupt) — the
   * caller should surface that so the user can decide to wipe the
   * file.
   */
  adoptPeerFromApproval(peer: StoredPeer): void {
    if (!this.peerList) {
      throw new Error(
        "Cannot persist peer — peer list is in load-failed state. Inspect peers.json manually.",
      );
    }
    const updated = upsertPeer(this.peerList, peer);
    savePeerList(this.ottieHome, updated, this.logger);
    this.peerList = updated;
    // Phase 3.b/1c: nudge the dialer so it immediately tries to open a
    // friend-sync session with the freshly-paired friend (if peerServerId
    // was captured during 3.a pairing).
    this.refreshFriendDialerTargets();
    this.logger.info(
      {
        peerDisplayName: peer.peerDisplayName,
        peerRootPubKeyPrefix: peer.peerRootSignPublicKeyB64.slice(0, 8),
        totalPeers: updated.peers.length,
      },
      "Adopted peer from friend-pair approval",
    );
  }

  /**
   * Phase 3.a/3: list pending friend-pair candidates the user's UI
   * should surface in "Pending friend requests". Cross-identity analog
   * of `listPendingDeviceLinkCandidates`. Each entry has just enough
   * metadata for the UI; secrets stay daemon-side.
   */
  listPendingFriendPairCandidates(): readonly {
    nonceB64: string;
    peerDisplayName: string;
    peerRootSignPublicKeyB64: string;
    generatedAt: string;
    receivedAt: string;
    expiresAtMs: number;
  }[] {
    return this.pendingFriendPairCandidates.list().map((record) => ({
      nonceB64: record.nonceB64,
      peerDisplayName: record.candidate.displayName,
      peerRootSignPublicKeyB64: record.candidate.rootSignPublicKeyB64,
      generatedAt: record.candidate.generatedAt,
      receivedAt: new Date(record.receivedAtMs).toISOString(),
      expiresAtMs: record.expiresAtMs,
    }));
  }

  /**
   * Phase 3.a/3: approve a parked friend-pair candidate. Signs the
   * authorization payload with the root identity, encrypts an approval
   * reply, sends it over the still-open Phase 3.a/2 socket, persists a
   * `Peer` entry on this side, then closes the socket.
   *
   * Result.approved is `true` on the happy path. `false` (with `error`)
   * means: candidate not found / expired / responder went offline
   * before the reply could be delivered / disk write failed.
   */
  approveFriendPair(nonceB64: string): {
    approved: boolean;
    peers: readonly StoredPeer[] | null;
    error: string | null;
  } {
    if (this.state.kind !== "loaded") {
      return {
        approved: false,
        peers: null,
        error: "Cannot approve friend-pair — root identity not loaded",
      };
    }
    if (!this.peerList) {
      return {
        approved: false,
        peers: null,
        error: "Cannot approve friend-pair — peer list is in load-failed state",
      };
    }

    const record = this.pendingFriendPairCandidates.consume(nonceB64);
    if (!record) {
      return {
        approved: false,
        peers: null,
        error: "Friend-pair candidate not found, already consumed, or expired",
      };
    }

    let result;
    try {
      result = approveFriendPairCandidate({
        candidate: record.candidate,
        offer: record.offer,
        ephPrivateKeyB64: record.ephPrivateKeyB64,
        candidateEphPublicKeyB64: record.candidateEphPublicKeyB64,
        rootIdentity: this.state.bundle,
      });
    } catch (err) {
      return {
        approved: false,
        peers: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Persist the new Peer BEFORE talking to the responder. If disk
    // fails we bail without telling the responder "approved" — they'll
    // see the socket close and surface the error.
    const updated = upsertPeer(this.peerList, result.selfPeer);
    try {
      savePeerList(this.ottieHome, updated, this.logger);
    } catch (err) {
      this.closeReplySocket(record.replySocket, 1011, "save_failed");
      return {
        approved: false,
        peers: null,
        error: `Failed to persist peer list: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    this.peerList = updated;

    // Phase 3.b/1c: nudge the dialer so Alice's daemon also opens a
    // chat session with the freshly-approved friend (using the routing
    // info captured in 3.b/1a).
    this.refreshFriendDialerTargets();

    // Send the encrypted approval reply, then close the socket cleanly.
    const sent = this.sendThenClose(record.replySocket, JSON.stringify(result.envelope));
    if (!sent) {
      this.logger.warn(
        { noncePrefix: nonceB64.slice(0, 8) },
        "friend_pair_approve_reply_send_failed_socket_dead",
      );
      // The Peer IS persisted on this side — the responder just won't
      // have heard about it. They'll see the socket close and surface
      // an error to their UI; user can re-pair if needed.
      return {
        approved: true,
        peers: updated.peers,
        error:
          "Approved and saved locally, but the other side was already offline — " +
          "tell them to re-scan",
      };
    }

    this.logger.info(
      {
        peerDisplayName: result.selfPeer.peerDisplayName,
        peerRootPubKeyPrefix: result.selfPeer.peerRootSignPublicKeyB64.slice(0, 8),
      },
      "Friend-pair candidate approved and reply sent",
    );

    return { approved: true, peers: updated.peers, error: null };
  }

  /**
   * Phase 3.a/3: reject a parked friend-pair candidate. Sends an
   * encrypted "rejected" envelope back to the responder so they know
   * the user said no, then closes the socket. Does NOT touch
   * peers.json.
   */
  rejectFriendPair(nonceB64: string, reason?: string): { rejected: boolean; error: string | null } {
    const record = this.pendingFriendPairCandidates.consume(nonceB64);
    if (!record) {
      return {
        rejected: false,
        error: "Friend-pair candidate not found, already consumed, or expired",
      };
    }
    const { envelope } = rejectFriendPairCandidate({
      ephPrivateKeyB64: record.ephPrivateKeyB64,
      candidateEphPublicKeyB64: record.candidateEphPublicKeyB64,
      ...(reason ? { rejectionReason: reason } : {}),
    });
    const sent = this.sendThenClose(record.replySocket, JSON.stringify(envelope));
    if (!sent) {
      return {
        rejected: true,
        error: "Rejection recorded locally, but the other side was already offline",
      };
    }
    this.logger.info(
      { noncePrefix: nonceB64.slice(0, 8), reason },
      "Friend-pair candidate rejected",
    );
    return { rejected: true, error: null };
  }

  /**
   * Test/diagnostic helper. Phase 2.d will not consume this — redemption
   * goes through a different path involving the relay-routed handshake.
   */
  getPendingDeviceLinkStore(): DeviceLinkPendingStore {
    return this.pendingDeviceLinks;
  }

  /**
   * Phase 2.d: relay-side handler that decrypts incoming candidate Device
   * records and parks them in the pending-candidate store for Phase 2.e
   * to surface as an "approve this device?" prompt. Bootstrap registers
   * this handler with the relay transport's `connectionHandlers` array.
   */
  createDeviceLinkConnectionHandler(): RelayConnectionHandler {
    return createDeviceLinkConnectionHandler({
      pendingOffers: this.pendingDeviceLinks,
      pendingCandidates: this.pendingCandidates,
    });
  }

  /**
   * Phase 2.f/2b: relay-side handler that runs the SIGMA-I responder
   * side of peer-sync. Returns null if prerequisites aren't met
   * (uninitialized identity, no self-device, etc.) — bootstrap should
   * skip registering it in that case to avoid attaching stale state.
   *
   * The handler's lifetime is tied to relay-transport; sessions inside
   * the registry are cleared when their sockets close.
   */
  createPeerSyncConnectionHandler(): RelayConnectionHandler | null {
    if (!this.selfDevice || !this.selfDeviceContext) return null;
    return createPeerSyncConnectionHandler({
      selfDeviceId: this.selfDeviceContext.serverId,
      selfSignPrivateKey: this.selfDevice.signPrivateKey,
      getLocalDeviceList: () => this.deviceList?.devices ?? [],
      sessions: this.peerSessions,
      applyInboundEvent: (event) => {
        // Re-use the same idempotent + signature-checking apply path
        // that everything else funnels through.
        this.applyInboundDeviceListEvent(event);
      },
      applyInboundCoordinationEvent: (event) => {
        this.applyInboundAiShareCoordinationEvent(event);
      },
      onSessionEstablished: (peerDeviceId) => {
        this.replayEventsToPeer(peerDeviceId);
      },
    });
  }

  /** Phase 2.f/2b+: snapshot of active peer sessions for diagnostics + Phase 2.f/3 broadcast. */
  getPeerSessions(): readonly import("./peer-session-registry.js").PeerSession[] {
    return this.peerSessions.list();
  }

  /**
   * Phase 2.f/2c: kick off the outbound peer-sync dialer. Bootstrap
   * calls this once after relay-transport is up. Idempotent —
   * subsequent calls reuse the existing dialer.
   *
   * Requires identity loaded + self-device + a relay endpoint. No-op
   * silently when prerequisites aren't met (e.g. uninitialized
   * daemon — there's no peer to dial yet).
   */
  startPeerSync(): void {
    if (this.peerDialer) return;
    if (!this.selfDevice || !this.selfDeviceContext || !this.relayEndpoint) return;
    if (this.state.kind !== "loaded") return;

    this.peerDialer = new PeerSyncDialer({
      selfDeviceId: this.selfDeviceContext.serverId,
      selfSignPrivateKey: this.selfDevice.signPrivateKey,
      relayEndpoint: this.relayEndpoint,
      getLocalDeviceList: () => this.deviceList?.devices ?? [],
      sessions: this.peerSessions,
      applyInboundEvent: (event) => this.applyInboundDeviceListEvent(event),
      applyInboundCoordinationEvent: (event) => this.applyInboundAiShareCoordinationEvent(event),
      onSessionEstablished: (peerDeviceId) => {
        this.replayEventsToPeer(peerDeviceId);
      },
      logger: this.logger,
    });
    this.peerDialer.start();
    this.logger.info(
      { peerCount: this.deviceList?.devices.length ?? 0 },
      "Peer-sync dialer started",
    );
  }

  /** Daemon shutdown / test cleanup. Closes all dialer sockets + sessions. */
  async stopPeerSync(): Promise<void> {
    if (this.peerDialer) {
      await this.peerDialer.stop();
      this.peerDialer = null;
    }
    this.peerSessions.closeAll("daemon_shutdown");
  }

  /**
   * Phase 3.b/1c: relay-side handler for cross-identity friend-sync
   * sessions. Bootstrap registers this alongside device-link, friend-
   * pair, and peer-sync handlers. Returns null if root identity
   * isn't loaded — without it we have nothing to sign helloes with.
   */
  createFriendSyncConnectionHandler(): RelayConnectionHandler | null {
    if (this.state.kind !== "loaded") return null;
    if (!this.selfDeviceContext) return null;
    return createFriendSyncConnectionHandler({
      selfRootPubKey: this.state.bundle.stored.signPublicKeyB64,
      selfRootSignPrivateKey: this.state.bundle.signPrivateKey,
      selfDeviceId: this.selfDeviceContext.serverId,
      getLocalPeerList: () => this.peerList?.peers ?? [],
      sessions: this.friendSessions,
      applyInboundPayload: (input) => this.handleInboundFriendSyncPayload(input),
    });
  }

  /**
   * Phase 3.b/1c: kick off the outbound friend-sync dialer. Bootstrap
   * calls this once after relay-transport is up. Idempotent —
   * subsequent calls reuse the existing dialer.
   */
  startFriendSync(): void {
    if (this.friendDialer) return;
    if (this.state.kind !== "loaded") return;
    if (!this.selfDeviceContext) return;
    if (!this.relayEndpoint) return;

    this.friendDialer = new FriendSyncDialer({
      selfRootPubKey: this.state.bundle.stored.signPublicKeyB64,
      selfRootSignPrivateKey: this.state.bundle.signPrivateKey,
      selfDeviceId: this.selfDeviceContext.serverId,
      getLocalPeerList: () => this.peerList?.peers ?? [],
      sessions: this.friendSessions,
      applyInboundPayload: (input) => this.handleInboundFriendSyncPayload(input),
      logger: this.logger,
    });
    this.friendDialer.start();
    this.logger.info({ peerCount: this.peerList?.peers.length ?? 0 }, "Friend-sync dialer started");
  }

  async stopFriendSync(): Promise<void> {
    if (this.friendDialer) {
      await this.friendDialer.stop();
      this.friendDialer = null;
    }
    this.friendSessions.closeAll("daemon_shutdown");
  }

  /** Diagnostic snapshot of active friend-sync sessions. */
  getFriendSessions(): readonly import("./friend-session-registry.js").FriendSession[] {
    return this.friendSessions.list();
  }

  /**
   * Phase 3.b/2d: drive the offline-inbox poller. Fires one round
   * immediately, then re-fires every `pollEveryMs` (default 5 minutes).
   * Skips quietly if prerequisites (loaded identity, relay endpoint,
   * encryption privkey) aren't ready — bootstrap calls this once at
   * daemon-up regardless, so a fresh-onboarding daemon picks it up
   * automatically once `initialize()` populates the rest.
   *
   * Idempotent: a second start while already running is a no-op.
   */
  startInboxReceiver(options?: { pollEveryMs?: number }): void {
    if (this.inboxPollHandle) return;
    const pollEveryMs = options?.pollEveryMs ?? 5 * 60 * 1000;

    // Fire once now (don't wait the first interval tick).
    void this.kickInboxOnce();
    this.inboxPollHandle = setInterval(() => {
      void this.kickInboxOnce();
    }, pollEveryMs);
    this.logger.info({ pollEveryMs }, "Inbox receiver started");
  }

  /** Cancel the periodic poller. Idempotent. */
  stopInboxReceiver(): void {
    if (this.inboxPollHandle) {
      clearInterval(this.inboxPollHandle);
      this.inboxPollHandle = null;
    }
  }

  /**
   * Trigger a single inbox round on demand. Coalesces overlapping
   * calls — if a round is in-flight, return its promise rather than
   * firing a parallel one.
   */
  kickInboxOnce(): Promise<void> {
    if (this.inboxInFlight) return this.inboxInFlight;
    this.inboxInFlight = this.runInboxRound().finally(() => {
      this.inboxInFlight = null;
    });
    return this.inboxInFlight;
  }

  private async runInboxRound(): Promise<void> {
    if (this.state.kind !== "loaded") return;
    if (!this.relayEndpoint) return;
    const encPriv = this.state.bundle.encryptionPrivateKeyB64;
    if (!encPriv) return;

    const rootSignPriv = this.state.bundle.signPrivateKey;
    const authSigner: InboxAuthSigner = {
      sign: (payload: string) => {
        const sig = nodeSign(null, Buffer.from(payload, "utf8"), rootSignPriv);
        return sig.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
      },
    };

    try {
      const result = await processInboxOnce({
        ottieHome: this.ottieHome,
        selfRootSignPublicKeyB64: this.state.bundle.stored.signPublicKeyB64,
        selfEncryptionPrivateKeyB64: encPriv,
        authSigner,
        relayEndpoint: this.relayEndpoint,
        findPeer: (peerRootSignPublicKeyB64) =>
          this.peerList?.peers.find(
            (p) => p.peerRootSignPublicKeyB64 === peerRootSignPublicKeyB64,
          ) ?? null,
        logger: this.logger,
      });
      if (result.persisted > 0 || result.dropped > 0 || result.hitMaxPagesCap) {
        this.logger.info(
          {
            persisted: result.persisted,
            dropped: result.dropped,
            hitMaxPagesCap: result.hitMaxPagesCap,
          },
          "inbox_round_complete",
        );
      }
    } catch (err) {
      this.logger.warn({ err }, "inbox_round_failed");
    }
  }

  /**
   * Phase 3.b/1c: refresh the friend-sync dialer's view of peers.json.
   * Called after a peer is added (Phase 3.a/3 approve) so the dialer
   * picks them up without waiting for a daemon restart.
   */
  refreshFriendDialerTargets(): void {
    if (!this.friendDialer) return;
    this.friendDialer.refreshTargets();
  }

  /**
   * Phase 3.b/1d: handler invoked by friend-sync receiver/dialer for
   * every successfully-decrypted inbound payload. Schema-validates as
   * a chat-message envelope, verifies the author's root signature,
   * persists into the per-peer JSONL store. Schema/sig failures are
   * logged but don't tear down the session — Phase 4+ may add other
   * envelope kinds (ai-share/*) on the same channel.
   */
  private handleInboundFriendSyncPayload(input: {
    peerRootPubKey: string;
    payload: unknown;
  }): void {
    if (this.state.kind !== "loaded") {
      this.logger.warn("friend_sync_inbound_envelope_dropped_no_identity");
      return;
    }

    // Phase 4 v1: dispatch on the envelope `kind` discriminator. Chat
    // envelopes (kind="friend-chat-message") and ai-share envelopes
    // ("ai-share-invite" / "ai-share-accept" / "ai-share-decline")
    // share the same friend-sync transport; we route by kind here so
    // each handler stays focused on its own schema + verification.
    const aiShare = tryParseAiShareEnvelope(input.payload);
    if (aiShare) {
      this.handleInboundAiShareEnvelope({
        peerRootPubKey: input.peerRootPubKey,
        parsed: aiShare,
      });
      return;
    }
    this.handleInboundFriendChatEnvelope(input);
  }

  private handleInboundFriendChatEnvelope(input: {
    peerRootPubKey: string;
    payload: unknown;
  }): void {
    if (this.state.kind !== "loaded") return;
    const validated = FriendChatMessageEnvelopeSchema.safeParse(input.payload);
    if (!validated.success) {
      this.logger.warn(
        {
          issues: validated.error.issues,
          peerRootPubKeyPrefix: input.peerRootPubKey.slice(0, 8),
        },
        "friend_chat_envelope_schema_rejected",
      );
      return;
    }
    const expectedRoomId = p2pRoomId({
      aRootPubKey: this.state.bundle.stored.signPublicKeyB64,
      bRootPubKey: input.peerRootPubKey,
    });
    const verifyOutcome = verifyFriendChatMessageEnvelope({
      envelope: validated.data,
      expectedPeerRootPubKey: input.peerRootPubKey,
      expectedRoomId,
    });
    if (!verifyOutcome.ok) {
      this.logger.warn(
        {
          reason: verifyOutcome.reason,
          peerRootPubKeyPrefix: input.peerRootPubKey.slice(0, 8),
        },
        "friend_chat_envelope_sig_invalid",
      );
      return;
    }

    try {
      appendFriendChatMessage(
        this.ottieHome,
        input.peerRootPubKey,
        {
          message: validated.data.message,
          authorSignatureB64: validated.data.authorSignatureB64,
          persistedAt: new Date().toISOString(),
        },
        this.logger,
      );
      this.logger.info(
        {
          peerRootPubKeyPrefix: input.peerRootPubKey.slice(0, 8),
          messageId: validated.data.message.id,
        },
        "friend_chat_message_received",
      );
    } catch (err) {
      this.logger.error(
        { err, peerRootPubKeyPrefix: input.peerRootPubKey.slice(0, 8) },
        "friend_chat_persist_failed",
      );
    }
  }

  /**
   * Phase 4 v1: route an inbound ai-share envelope to the matching
   * registry path. Verifies the sender's signature against the
   * expected peer pubkey before mutating state.
   */
  private handleInboundAiShareEnvelope(input: {
    peerRootPubKey: string;
    parsed: NonNullable<ReturnType<typeof tryParseAiShareEnvelope>>;
  }): void {
    const peerPrefix = input.peerRootPubKey.slice(0, 8);
    if (input.parsed.kind === "invite") {
      const verifyOutcome = verifyAiShareInviteEnvelope({
        envelope: input.parsed.envelope,
        expectedOwnerRootSignPublicKeyB64: input.peerRootPubKey,
      });
      if (!verifyOutcome.ok) {
        this.logger.warn(
          { reason: verifyOutcome.reason, peerPrefix },
          "ai_share_invite_sig_invalid",
        );
        return;
      }
      this.aiShareInvites.recordInbound({ invite: input.parsed.envelope });
      // Phase 4 v2/e: open the friend-side transcript so the friend's
      // daemon also keeps an auditable log.
      this.aiShareTranscripts.open({
        inviteId: input.parsed.envelope.inviteId,
        side: "inbound",
        invite: input.parsed.envelope,
      });
      return;
    }
    if (input.parsed.kind === "accept") {
      const verifyOutcome = verifyAiShareAcceptEnvelope({
        envelope: input.parsed.envelope,
        expectedResponderRootSignPublicKeyB64: input.peerRootPubKey,
      });
      if (!verifyOutcome.ok) {
        this.logger.warn(
          { reason: verifyOutcome.reason, peerPrefix },
          "ai_share_accept_sig_invalid",
        );
        return;
      }
      this.aiShareInvites.applyOutboundAccept(input.parsed.envelope);
      // Phase 4 v2/e: log peer's accept on the owner-side transcript.
      this.aiShareTranscripts.append({
        inviteId: input.parsed.envelope.inviteId,
        line: {
          v: 1,
          kind: "accept",
          origin: "peer",
          acceptedAt: input.parsed.envelope.acceptedAt,
          signatureB64: input.parsed.envelope.signatureB64,
        },
      });
      // Phase 4 v2/d: friend just accepted — start broadcasting redacted
      // agent timeline events back to them. Idempotent (safe to call on
      // re-delivery; attachOutboundBroadcaster tears down any prior
      // handle before storing the new one).
      this.startAiShareBroadcaster(input.parsed.envelope.inviteId);
      return;
    }
    if (input.parsed.kind === "decline") {
      const verifyOutcome = verifyAiShareDeclineEnvelope({
        envelope: input.parsed.envelope,
        expectedResponderRootSignPublicKeyB64: input.peerRootPubKey,
      });
      if (!verifyOutcome.ok) {
        this.logger.warn(
          { reason: verifyOutcome.reason, peerPrefix },
          "ai_share_decline_sig_invalid",
        );
        return;
      }
      this.aiShareInvites.applyOutboundDecline(input.parsed.envelope);
      // Phase 4 v2/e: log peer's decline on the owner-side transcript.
      this.aiShareTranscripts.append({
        inviteId: input.parsed.envelope.inviteId,
        line: {
          v: 1,
          kind: "decline",
          origin: "peer",
          declinedAt: input.parsed.envelope.declinedAt,
          ...(input.parsed.envelope.reason !== undefined
            ? { reason: input.parsed.envelope.reason }
            : {}),
          signatureB64: input.parsed.envelope.signatureB64,
        },
      });
      return;
    }
    if (input.parsed.kind === "end") {
      // Phase 4 v2/a: either side can end an active share. Verify
      // sender against the same peer pubkey we'd use for any other
      // friend-sync envelope from this connection.
      const verifyOutcome = verifyAiShareEndEnvelope({
        envelope: input.parsed.envelope,
        expectedSenderRootSignPublicKeyB64: input.peerRootPubKey,
      });
      if (!verifyOutcome.ok) {
        this.logger.warn({ reason: verifyOutcome.reason, peerPrefix }, "ai_share_end_sig_invalid");
        return;
      }
      this.applyInboundAiShareEnd(input.parsed.envelope, input.peerRootPubKey);
      return;
    }
    if (input.parsed.kind === "prompt") {
      // Phase 4 v2/b: friend's prompt arrived on the owner side. Verify
      // signature against the friend's pubkey, then route to AgentManager
      // via the bridge. Drop silently (with a logged reason) if no
      // matching active share — could be a duplicate after end.
      const verifyOutcome = verifyAiSharePromptEnvelope({
        envelope: input.parsed.envelope,
        expectedSenderRootSignPublicKeyB64: input.peerRootPubKey,
      });
      if (!verifyOutcome.ok) {
        this.logger.warn(
          { reason: verifyOutcome.reason, peerPrefix },
          "ai_share_prompt_sig_invalid",
        );
        return;
      }
      this.applyInboundAiSharePrompt(input.parsed.envelope, input.peerRootPubKey);
      return;
    }
    if (input.parsed.kind === "timeline") {
      // Phase 4 v2/d: owner's redacted timeline frame arrived on the
      // friend side. Verify signature against the owner's pubkey
      // (peerRootPubKey here, since friend-sync delivered it), then
      // stash in the per-share buffer for the friend's UI.
      const verifyOutcome = verifyAiShareTimelineEnvelope({
        envelope: input.parsed.envelope,
        expectedSenderRootSignPublicKeyB64: input.peerRootPubKey,
      });
      if (!verifyOutcome.ok) {
        this.logger.warn(
          { reason: verifyOutcome.reason, peerPrefix },
          "ai_share_timeline_sig_invalid",
        );
        return;
      }
      this.applyInboundAiShareTimeline(input.parsed.envelope, input.peerRootPubKey);
      return;
    }
  }

  /**
   * Phase 4 v2/a — apply an inbound `ai-share-end` envelope to either
   * side's registry record. Inbound entries (we accepted; peer ended)
   * and outbound entries (we sent; peer declined-after-accept by
   * ending) both transition to `state = ended, endedBy = "peer"`.
   */
  private applyInboundAiShareEnd(envelope: AiShareEndEnvelope, peerRootPubKey: string): void {
    const args = {
      inviteId: envelope.inviteId,
      endedBy: "peer" as const,
      endedAt: envelope.endedAt,
      signatureB64: envelope.signatureB64,
      ...(envelope.reason !== undefined ? { reason: envelope.reason } : {}),
    };
    this.aiShareInvites.applyOutboundEnd(args);
    this.aiShareInvites.applyInboundEnd(args);
    // Phase 4 v2/e: log peer's end on the local transcript. Same line
    // shape applies whether this daemon was the owner or the friend —
    // origin="peer" tells you who initiated, side (header) tells you
    // whose transcript this is.
    this.aiShareTranscripts.append({
      inviteId: envelope.inviteId,
      line: {
        v: 1,
        kind: "end",
        origin: "peer",
        endedAt: envelope.endedAt,
        ...(envelope.reason !== undefined ? { reason: envelope.reason } : {}),
        signatureB64: envelope.signatureB64,
      },
    });
    this.logger.info(
      { inviteId: envelope.inviteId, peerPrefix: peerRootPubKey.slice(0, 8) },
      "ai_share_invite_ended_by_peer",
    );
  }

  /**
   * Phase 4 v2/b — apply an inbound `ai-share-prompt` envelope on the
   * owner side. Looks up the active outbound entry for `inviteId`,
   * confirms the sender pubkey matches the peer recorded on the
   * invite, and routes the body into AgentManager via the late-bound
   * bridge. v2/b only fires the `runAgent` call and logs success;
   * the timeline streaming back to the friend lands in v2/d.
   */
  private applyInboundAiSharePrompt(envelope: AiSharePromptEnvelope, peerRootPubKey: string): void {
    const peerPrefix = peerRootPubKey.slice(0, 8);
    const active = this.aiShareInvites.getActive(envelope.inviteId);
    if (!active) {
      this.logger.warn(
        { inviteId: envelope.inviteId, peerPrefix, promptId: envelope.promptId },
        "ai_share_prompt_no_active_invite",
      );
      return;
    }
    if (active.side !== "outbound") {
      // Friend sent us a prompt for an invite we accepted, not one we
      // sent — that's the wrong direction in v2/b. (v2/c will allow
      // the friend's daemon to receive owner→friend prompts, but the
      // shared-agent UI surface is one-way: friend types prompts,
      // owner's agent runs them.)
      this.logger.warn(
        { inviteId: envelope.inviteId, peerPrefix, side: active.side },
        "ai_share_prompt_wrong_side",
      );
      return;
    }
    if (active.peerRootPubKeyB64 !== peerRootPubKey) {
      this.logger.warn(
        {
          inviteId: envelope.inviteId,
          expectedPrefix: active.peerRootPubKeyB64.slice(0, 8),
          gotPrefix: peerPrefix,
        },
        "ai_share_prompt_peer_mismatch",
      );
      return;
    }
    const bridge = this.aiShareAgentBridge;
    if (!bridge) {
      this.logger.warn(
        { inviteId: envelope.inviteId, promptId: envelope.promptId },
        "ai_share_prompt_dropped_no_agent_bridge",
      );
      return;
    }
    const agentId = active.invite.agentId;
    // Phase 4 v3/a — atomically increment the prompt counter and
    // bail before runAgent if the cap is exhausted.
    const limits = active.invite.limits ?? DEFAULT_AI_SHARE_LIMITS;
    const newPromptCount = this.aiShareInvites.incrementPromptCount(envelope.inviteId);
    if (newPromptCount > limits.maxPrompts) {
      this.logger.info(
        {
          inviteId: envelope.inviteId,
          newPromptCount,
          maxPrompts: limits.maxPrompts,
        },
        "ai_share_prompt_limit_exhausted",
      );
      this.endAiShareSession(envelope.inviteId, "prompt-limit");
      return;
    }
    // Phase 4 v2/d: stash the wire promptId so the broadcaster's next
    // `user_message` timeline forward (which AgentManager emits as
    // soon as runAgent records it) carries the promptId back.
    this.aiShareInvites.setLastInboundPromptId(envelope.inviteId, envelope.promptId);
    // Phase 4 v2/e: log peer's prompt on the owner-side transcript.
    this.aiShareTranscripts.append({
      inviteId: envelope.inviteId,
      line: {
        v: 1,
        kind: "prompt",
        origin: "received",
        promptId: envelope.promptId,
        sentAt: envelope.sentAt,
        body: envelope.body,
        signatureB64: envelope.signatureB64,
      },
    });
    this.logger.info(
      { inviteId: envelope.inviteId, agentId, promptId: envelope.promptId, peerPrefix },
      "ai_share_prompt_routing_to_agent",
    );
    void bridge
      .injectPrompt({ agentId, body: envelope.body })
      .then(() => {
        this.logger.info(
          { inviteId: envelope.inviteId, agentId, promptId: envelope.promptId },
          "ai_share_prompt_routed",
        );
      })
      .catch((err: unknown) => {
        this.logger.error(
          {
            err: err instanceof Error ? err.message : String(err),
            inviteId: envelope.inviteId,
            agentId,
            promptId: envelope.promptId,
          },
          "ai_share_prompt_route_failed",
        );
      });
  }

  /**
   * Phase 4 v2/b — bootstrap calls this once after AgentManager is
   * constructed. After binding, the dispatcher's `prompt` branch can
   * route inbound prompts and `listShareableAgents` returns real
   * agent rows.
   */
  setAiShareAgentBridge(bridge: AiShareAgentBridge): void {
    this.aiShareAgentBridge = bridge;
  }

  /**
   * Phase 4 v2/b — picker data for the owner's invite modal. Returns
   * an empty list when no bridge is wired (tests, headless-CLI paths).
   */
  listShareableAgents(): ShareableAgentSummary[] {
    return this.aiShareAgentBridge?.listShareableAgents() ?? [];
  }

  /**
   * Phase 4 v2/d — friend side: list timeline records for a share.
   * The friend's UI polls this to render the assistant's responses
   * back to the owner's prompts.
   */
  listAiShareTimeline(inviteId: string): readonly AiShareTimelineRecord[] {
    return this.aiShareTimelineStore.list(inviteId);
  }

  // -------------------------------------------------------------------
  // Phase 4 v3/c §7.5.1 — cross-daemon ai-share intent coordination.
  //
  // The v2/b "Share AI" flow has the owner pick an agent locally and
  // immediately fire `sendAiShareInvite` from that daemon. v3/c
  // doesn't replace that flow; it adds a parallel flow for owners
  // running multiple daemons:
  //
  //   1. The user taps "Share AI" on Device A (any of their daemons).
  //   2. Device A calls `broadcastAiShareIntent({peerRootPubKey})`
  //      which mints an intentId + emits a signed
  //      `ai-share-intent-broadcast` to every peer-sync session it
  //      has open. Every other owner-daemon picks up the intent and
  //      surfaces it in their UI alongside Device A.
  //   3. The user picks whichever device they want (could be A, B,
  //      C, …). That device calls `claimAiShareIntent(intentId)`
  //      which broadcasts an `ai-share-intent-resolution` so the
  //      others dismiss their pending UI.
  //   4. The picked device hands off to the existing v2/b flow:
  //      open the agent picker, fire `sendAiShareInvite` directly.
  //
  // The intent broadcast carries only the friend's pubkey + an
  // intentId. No agent details — those are picked AFTER claim, on
  // the chosen device. This matches §7.5's two-step modal: step 1
  // is "which daemon", step 2 is "which agent on that daemon".
  // -------------------------------------------------------------------

  /**
   * Phase 4 v3/c §7.5.1 — owner taps "Share AI" on any device. Mint
   * an intent, register locally as `claimedBy = self`, broadcast to
   * sibling daemons. The originating device can immediately proceed
   * to the v2/b agent picker without waiting for resolution; the
   * broadcast is just so other devices know about it.
   */
  broadcastAiShareIntent(input: {
    peerRootPubKey: string;
    /** Override TTL ms (tests). Default 5 minutes. */
    ttlMs?: number;
  }): { ok: true; intentId: string; expiresAt: string } | { ok: false; error: string } {
    if (this.state.kind !== "loaded") {
      return { ok: false, error: "Cannot broadcast — root identity not loaded" };
    }
    if (!this.selfDevice || !this.selfDeviceContext) {
      return { ok: false, error: "Cannot broadcast — self-device not configured" };
    }
    const peer = this.peerList?.peers.find(
      (p) => p.peerRootSignPublicKeyB64 === input.peerRootPubKey,
    );
    if (!peer) return { ok: false, error: "Peer is not in your friend list" };
    const now = new Date();
    const ttlMs = input.ttlMs ?? 5 * 60 * 1000;
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const intentId = `ais_intent_${randomUuid().slice(0, 12)}`;
    const sourceDeviceId = this.selfDeviceContext.serverId;
    const event = buildAiShareIntentBroadcastEvent({
      intentId,
      peerRootPubKeyB64: input.peerRootPubKey,
      expiresAt,
      sourceDeviceId,
      signPrivateKey: this.selfDevice.signPrivateKey,
      emittedAt: now.toISOString(),
      seq: this.aiShareCoordinationSeq++,
    });
    // Register locally first — claimedBy = self because the
    // originator is implicitly already going to claim it (UI
    // continues to the picker on this device).
    this.aiShareIntents.set(intentId, {
      intentId,
      peerRootPubKeyB64: input.peerRootPubKey,
      sourceDeviceId,
      generatedAt: now.toISOString(),
      expiresAt,
      claimedByDeviceId: sourceDeviceId,
    });
    this.broadcastCoordinationEvent(event);
    this.logger.info(
      { intentId, peerPrefix: input.peerRootPubKey.slice(0, 8) },
      "ai_share_intent_broadcast_sent",
    );
    return { ok: true, intentId, expiresAt };
  }

  /**
   * Phase 4 v3/c §7.5.1 — sibling owner-daemon claims the intent.
   * Marks the local entry, broadcasts a resolution so the other
   * daemons dismiss their pending UI, and returns the metadata the
   * caller needs to proceed with the v2/b agent picker.
   */
  claimAiShareIntent(
    intentId: string,
  ): { ok: true; peerRootPubKey: string } | { ok: false; error: string } {
    if (this.state.kind !== "loaded") {
      return { ok: false, error: "Cannot claim — root identity not loaded" };
    }
    if (!this.selfDevice || !this.selfDeviceContext) {
      return { ok: false, error: "Cannot claim — self-device not configured" };
    }
    this.evictExpiredAiShareIntents();
    const entry = this.aiShareIntents.get(intentId);
    if (!entry) return { ok: false, error: "Intent not found or already expired" };
    if (entry.claimedByDeviceId !== null) {
      return { ok: false, error: "Intent already claimed" };
    }
    const sourceDeviceId = this.selfDeviceContext.serverId;
    entry.claimedByDeviceId = sourceDeviceId;
    const now = new Date();
    const event = buildAiShareIntentResolutionEvent({
      intentId,
      claimedByDeviceId: sourceDeviceId,
      resolvedAt: now.toISOString(),
      sourceDeviceId,
      signPrivateKey: this.selfDevice.signPrivateKey,
      emittedAt: now.toISOString(),
      seq: this.aiShareCoordinationSeq++,
    });
    this.broadcastCoordinationEvent(event);
    this.logger.info({ intentId }, "ai_share_intent_resolution_sent");
    return { ok: true, peerRootPubKey: entry.peerRootPubKeyB64 };
  }

  /**
   * Phase 4 v3/c §7.5.1 — read-only snapshot for the UI poller.
   * Filters out claimed/expired entries so the bell only surfaces
   * actionable intents.
   */
  listPendingAiShareIntents(): ReadonlyArray<{
    intentId: string;
    peerRootPubKeyB64: string;
    sourceDeviceId: string;
    generatedAt: string;
    expiresAt: string;
  }> {
    this.evictExpiredAiShareIntents();
    const out: Array<{
      intentId: string;
      peerRootPubKeyB64: string;
      sourceDeviceId: string;
      generatedAt: string;
      expiresAt: string;
    }> = [];
    for (const entry of this.aiShareIntents.values()) {
      if (entry.claimedByDeviceId !== null) continue;
      out.push({
        intentId: entry.intentId,
        peerRootPubKeyB64: entry.peerRootPubKeyB64,
        sourceDeviceId: entry.sourceDeviceId,
        generatedAt: entry.generatedAt,
        expiresAt: entry.expiresAt,
      });
    }
    return out;
  }

  /**
   * Phase 4 v3/c §7.5.1 — peer-sync receiver dispatches verified
   * coordination events here. Verifies the signature against the
   * source device's pubkey from the local device list (events from
   * unknown devices are dropped — same anti-replay guarantee as
   * device-list events).
   */
  private applyInboundAiShareCoordinationEvent(event: AiShareCoordinationEvent): void {
    const sourceDevice = this.deviceList?.devices.find((d) => d.deviceId === event.sourceDeviceId);
    if (!sourceDevice) {
      this.logger.warn(
        { sourceDeviceIdPrefix: event.sourceDeviceId.slice(0, 12) },
        "ai_share_coordination_unknown_source_device",
      );
      return;
    }
    const verifyOutcome = verifyAiShareCoordinationEvent({
      event,
      expectedSignPublicKeyB64: sourceDevice.signPublicKeyB64,
    });
    if (!verifyOutcome.ok) {
      this.logger.warn(
        { reason: verifyOutcome.reason, kind: event.kind },
        "ai_share_coordination_sig_invalid",
      );
      return;
    }
    if (event.kind === "ai-share-intent-broadcast") {
      this.aiShareIntents.set(event.intentId, {
        intentId: event.intentId,
        peerRootPubKeyB64: event.peerRootPubKeyB64,
        sourceDeviceId: event.sourceDeviceId,
        generatedAt: event.emittedAt,
        expiresAt: event.expiresAt,
        claimedByDeviceId: null,
      });
      this.logger.info(
        {
          intentId: event.intentId,
          sourceDeviceIdPrefix: event.sourceDeviceId.slice(0, 12),
        },
        "ai_share_intent_broadcast_received",
      );
      return;
    }
    if (event.kind === "ai-share-intent-resolution") {
      const entry = this.aiShareIntents.get(event.intentId);
      if (!entry) return;
      entry.claimedByDeviceId = event.claimedByDeviceId;
      this.logger.info(
        {
          intentId: event.intentId,
          claimedByPrefix: event.claimedByDeviceId.slice(0, 12),
        },
        "ai_share_intent_resolution_received",
      );
    }
  }

  private broadcastCoordinationEvent(event: AiShareCoordinationEvent): void {
    const sessions = this.peerSessions.list();
    if (sessions.length === 0) return;
    const payload = JSON.stringify(event);
    for (const session of sessions) {
      try {
        const frame = encryptPeerSyncFrame({
          sharedKey: session.sharedKey,
          plaintext: payload,
        });
        session.socket.send(JSON.stringify(frame));
      } catch (err) {
        this.logger.warn(
          {
            err,
            peerDeviceIdPrefix: session.peerDeviceId.slice(0, 12),
            kind: event.kind,
          },
          "ai_share_coordination_send_failed",
        );
      }
    }
  }

  private evictExpiredAiShareIntents(): void {
    const now = Date.now();
    for (const [id, entry] of this.aiShareIntents.entries()) {
      const expires = Date.parse(entry.expiresAt);
      if (Number.isFinite(expires) && expires <= now) {
        this.aiShareIntents.delete(id);
      }
    }
  }

  /**
   * Phase 4 v2/d — broadcaster: subscribe to AgentManager events for
   * a share's agent, run them through the redactor, build + sign +
   * ship the resulting `ai-share-timeline` envelopes through friend-
   * sync. Idempotent: replaces any prior subscription on the same
   * outbound entry.
   */
  private startAiShareBroadcaster(inviteId: string): void {
    if (this.state.kind !== "loaded") return;
    const active = this.aiShareInvites.getActive(inviteId);
    if (!active || active.side !== "outbound") return;
    const bridge = this.aiShareAgentBridge;
    if (!bridge) {
      this.logger.warn({ inviteId }, "ai_share_broadcaster_no_bridge");
      return;
    }
    const agentId = active.invite.agentId;
    const peerRootPubKey = active.peerRootPubKeyB64;
    const ownerSignPriv = this.state.bundle.signPrivateKey;
    const ownerPubB64 = this.state.bundle.stored.signPublicKeyB64;

    // Phase 4 v3/a — schedule the session-timeout end-of-share. We
    // use the invite's `limits` if present, falling back to defaults
    // for back-compat invites with no limits field.
    const limits = active.invite.limits ?? DEFAULT_AI_SHARE_LIMITS;
    const timeoutHandle = setTimeout(() => {
      this.logger.info(
        { inviteId, timeoutMs: limits.sessionTimeoutMs },
        "ai_share_session_timeout_firing",
      );
      this.endAiShareSession(inviteId, "session-timeout");
    }, limits.sessionTimeoutMs);
    this.aiShareInvites.attachSessionTimeoutHandle(inviteId, timeoutHandle);

    const unsubscribe = bridge.subscribeAgent({
      agentId,
      onEvent: (event) => {
        // Phase 4 v3/a — accumulate token usage for the cap. usage_updated
        // events carry inputTokens + outputTokens reported by the
        // provider. Tokens are kept owner-side (the redactor drops
        // usage_updated for §7's "Bob does not see"), but we still need
        // them for the limit check.
        if (event.type === "agent_stream" && event.event.type === "usage_updated") {
          const usage = event.event.usage as
            | { inputTokens?: number; outputTokens?: number }
            | undefined;
          const inputTokens = typeof usage?.inputTokens === "number" ? usage.inputTokens : 0;
          const outputTokens = typeof usage?.outputTokens === "number" ? usage.outputTokens : 0;
          const total = inputTokens + outputTokens;
          if (total > 0) {
            const newTotal = this.aiShareInvites.addTokens(inviteId, total);
            if (newTotal >= limits.maxTokens) {
              this.logger.info(
                { inviteId, newTotal, maxTokens: limits.maxTokens },
                "ai_share_token_limit_exhausted",
              );
              this.endAiShareSession(inviteId, "token-limit");
            }
          }
        }
        // Bind the most recent inbound promptId only when forwarding
        // a `user_message` (so it correlates with the friend's "you
        // sent" row). Other event types should not carry promptId.
        const isUserMessage =
          event.type === "agent_stream" &&
          event.event.type === "timeline" &&
          event.event.item.type === "user_message";
        const lastPromptIdForUserMessage = isUserMessage
          ? this.aiShareInvites.consumeLastInboundPromptId(inviteId)
          : undefined;
        const entry = redactAgentEventForShare(event, {
          agentId,
          ...(lastPromptIdForUserMessage !== null && lastPromptIdForUserMessage !== undefined
            ? { lastPromptIdForUserMessage }
            : {}),
        });
        if (!entry) {
          // If we consumed the promptId for a user_message that the
          // redactor then rejected, restash it so the next
          // user_message picks it up. (In practice user_message is
          // always forwarded, so this branch is defensive.)
          if (isUserMessage && lastPromptIdForUserMessage) {
            this.aiShareInvites.setLastInboundPromptId(inviteId, lastPromptIdForUserMessage);
          }
          return;
        }
        const seq = this.aiShareInvites.takeNextTimelineSeq(inviteId);
        const eventId = `aie_${inviteId.slice(-6)}_${seq.toString(36)}`;
        const envelope = buildAiShareTimelineEnvelope({
          inviteId,
          eventId,
          senderRootSignPrivateKey: ownerSignPriv,
          senderRootPubKeyB64: ownerPubB64,
          sentAt: new Date().toISOString(),
          entry,
        });
        const session = this.friendSessions.get(peerRootPubKey);
        if (!session) {
          // Peer's friend-sync session dropped — no-op; v2/e adds the
          // disk transcript so timeline events queued during a brief
          // disconnect can be re-sent on reconnect.
          this.logger.debug(
            { inviteId, eventId, kind: entry.kind },
            "ai_share_timeline_no_session_dropping",
          );
          return;
        }
        try {
          const frame = encryptFriendSyncFrame({
            sharedKey: session.sharedKey,
            plaintext: JSON.stringify(envelope),
          });
          session.socket.send(JSON.stringify(frame));
        } catch (err) {
          this.logger.warn(
            {
              err: err instanceof Error ? err.message : String(err),
              inviteId,
              eventId,
            },
            "ai_share_timeline_send_failed",
          );
        }
        // Phase 4 v2/e: log forwarded timeline frame on the owner-side
        // transcript regardless of whether the wire send succeeded —
        // the local record is the source of truth for an offline
        // post-mortem.
        this.aiShareTranscripts.append({
          inviteId,
          line: {
            v: 1,
            kind: "timeline",
            origin: "sent",
            eventId,
            sentAt: envelope.sentAt,
            entry,
            signatureB64: envelope.signatureB64,
          },
        });
      },
    });
    this.aiShareInvites.attachOutboundBroadcaster(inviteId, unsubscribe);
    this.logger.info({ inviteId, agentId }, "ai_share_broadcaster_started");
  }

  /**
   * Phase 4 v2/d — friend-side dispatcher: ingest a verified timeline
   * envelope into the per-share buffer. Cross-checks the active
   * inbound entry and that the sender pubkey matches the recorded
   * owner pubkey on the invite (defense in depth — verify already
   * matched it against the friend-sync peer).
   */
  private applyInboundAiShareTimeline(
    envelope: AiShareTimelineEnvelope,
    peerRootPubKey: string,
  ): void {
    const peerPrefix = peerRootPubKey.slice(0, 8);
    const active = this.aiShareInvites.getActive(envelope.inviteId);
    if (!active) {
      this.logger.warn(
        { inviteId: envelope.inviteId, peerPrefix, eventId: envelope.eventId },
        "ai_share_timeline_no_active_invite",
      );
      return;
    }
    if (active.side !== "inbound") {
      this.logger.warn(
        { inviteId: envelope.inviteId, peerPrefix, side: active.side },
        "ai_share_timeline_wrong_side",
      );
      return;
    }
    if (active.peerRootPubKeyB64 !== peerRootPubKey) {
      this.logger.warn(
        {
          inviteId: envelope.inviteId,
          expectedPrefix: active.peerRootPubKeyB64.slice(0, 8),
          gotPrefix: peerPrefix,
        },
        "ai_share_timeline_peer_mismatch",
      );
      return;
    }
    this.aiShareTimelineStore.append({
      inviteId: envelope.inviteId,
      eventId: envelope.eventId,
      sentAt: envelope.sentAt,
      entry: envelope.entry,
    });
    // Phase 4 v2/e: log received timeline frame on the friend-side
    // transcript so the friend has an auditable copy independent of
    // the in-memory ring buffer.
    this.aiShareTranscripts.append({
      inviteId: envelope.inviteId,
      line: {
        v: 1,
        kind: "timeline",
        origin: "received",
        eventId: envelope.eventId,
        sentAt: envelope.sentAt,
        entry: envelope.entry,
        signatureB64: envelope.signatureB64,
      },
    });
    this.logger.debug(
      {
        inviteId: envelope.inviteId,
        eventId: envelope.eventId,
        kind: envelope.entry.kind,
        peerPrefix,
      },
      "ai_share_timeline_applied",
    );
  }

  /**
   * Phase 3.b/1d: send a chat message to a paired friend over the
   * friend-sync session. Returns the persisted record on success or
   * an error string on failure (no active session, no peer record,
   * disk write failure, etc.).
   *
   * The caller (UI / WS RPC `chat/p2p/send`) supplies just the body
   * + optional clientMessageId; the daemon mints id/createdAt and
   * stamps in author root + device.
   */
  async sendFriendChatMessage(input: {
    peerRootPubKey: string;
    body: string;
    clientMessageId?: string;
    replyToMessageId?: string;
  }): Promise<{ ok: true; stored: StoredFriendChatMessage } | { ok: false; error: string }> {
    if (this.state.kind !== "loaded") {
      return { ok: false, error: "Cannot send chat — root identity not loaded" };
    }
    if (!this.selfDeviceContext) {
      return { ok: false, error: "Cannot send chat — selfDeviceContext not configured" };
    }
    const body = input.body.trim();
    if (body.length === 0) {
      return { ok: false, error: "Message body must not be empty" };
    }

    const peer = this.peerList?.peers.find(
      (p) => p.peerRootSignPublicKeyB64 === input.peerRootPubKey,
    );
    if (!peer) {
      return { ok: false, error: "Peer is not in your friend list" };
    }
    if (peer.status !== "active") {
      return { ok: false, error: `Peer is ${peer.status}, refusing to send` };
    }

    const roomId = p2pRoomId({
      aRootPubKey: this.state.bundle.stored.signPublicKeyB64,
      bRootPubKey: input.peerRootPubKey,
    });
    const now = new Date();
    const messageId = `fcm_${randomUuid()}`;
    const clientMessageId = input.clientMessageId ?? messageId;
    const message: ChatMessage = {
      id: messageId,
      roomId,
      authorAgentId: `human:${this.state.bundle.stored.signPublicKeyB64.slice(0, 12)}`,
      body,
      replyToMessageId: input.replyToMessageId ?? null,
      mentionAgentIds: [],
      createdAt: now.toISOString(),
      clientMessageId,
      authorRootPubKey: this.state.bundle.stored.signPublicKeyB64,
      authorDeviceId: this.selfDeviceContext.serverId,
      kind: "text",
    };

    let envelope: FriendChatMessageEnvelope;
    try {
      envelope = buildFriendChatMessageEnvelope({
        roomId,
        message,
        authorRootSignPrivateKey: this.state.bundle.signPrivateKey,
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    // Phase 3.b/2c: pick live (friend-sync session) or queued (offline
    // inbox at relay). Both paths build the same envelope; only the
    // transport differs. If neither is available, surface an explicit
    // error so the UI can prompt the user to re-pair.
    const session = this.friendSessions.get(input.peerRootPubKey);
    let deliveryStatus: "delivered" | "queued";

    if (session) {
      let frame;
      try {
        frame = encryptFriendSyncFrame({
          sharedKey: session.sharedKey,
          plaintext: JSON.stringify(envelope),
        });
      } catch (err) {
        return {
          ok: false,
          error: `Failed to encrypt message: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      try {
        session.socket.send(JSON.stringify(frame));
      } catch (err) {
        return {
          ok: false,
          error: `Failed to send through session: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
      deliveryStatus = "delivered";
    } else if (peer.peerEncryptionPublicKeyB64 && this.relayEndpoint) {
      // Friend is offline; encrypt to their long-lived X25519 pubkey
      // (captured at friend-pair time in 3.b/2a) and POST to the relay
      // KV inbox (3.b/2b). Recipient picks up + decrypts on their next
      // connect (3.b/2d).
      let serializedBlob: string;
      try {
        serializedBlob = encryptInboxBlob({
          envelope,
          recipientEncryptionPublicKeyB64: peer.peerEncryptionPublicKeyB64,
        }).serializedBlob;
      } catch (err) {
        return {
          ok: false,
          error: `Failed to encrypt for inbox: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      const postOutcome = await postInbox({
        relayEndpoint: this.relayEndpoint,
        recipientRootPubKeyB64Url: input.peerRootPubKey,
        body: serializedBlob,
      });
      if (!postOutcome.ok) {
        this.logger.warn(
          {
            peerRootPubKeyPrefix: input.peerRootPubKey.slice(0, 8),
            status: postOutcome.status,
            error: postOutcome.error,
          },
          "friend_chat_inbox_post_failed",
        );
        return {
          ok: false,
          error: `Friend is offline and inbox POST failed (${postOutcome.status}): ${postOutcome.error}`,
        };
      }
      this.logger.info(
        {
          peerRootPubKeyPrefix: input.peerRootPubKey.slice(0, 8),
          inboxSeq: postOutcome.seq,
        },
        "friend_chat_inbox_post_succeeded",
      );
      deliveryStatus = "queued";
    } else {
      // Either the peer was paired before 3.b/2a (no encryption pubkey)
      // or this daemon has no relay endpoint configured. Surface a
      // specific message so the UI can suggest the right fix.
      const reason = !peer.peerEncryptionPublicKeyB64
        ? "Friend was paired before offline inbox shipped — re-pair to enable queued delivery"
        : "Friend is offline and this daemon is not connected to a relay";
      return { ok: false, error: reason };
    }

    // Persist locally so the sender's UI can render it immediately,
    // tagged with the path it took. UI surfaces "queued" with a
    // distinct visual treatment in 3.b/2e.
    let stored: StoredFriendChatMessage;
    try {
      stored = appendFriendChatMessage(
        this.ottieHome,
        input.peerRootPubKey,
        {
          message,
          authorSignatureB64: envelope.authorSignatureB64,
          persistedAt: now.toISOString(),
          deliveryStatus,
        },
        this.logger,
      );
    } catch (err) {
      return {
        ok: false,
        error: `Sent over the wire but failed to persist locally: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }

    this.logger.info(
      {
        peerRootPubKeyPrefix: input.peerRootPubKey.slice(0, 8),
        messageId,
        storedSeq: stored.storedSeq,
        deliveryStatus,
      },
      "friend_chat_message_sent",
    );
    return { ok: true, stored };
  }

  /**
   * Phase 3.b/1d: snapshot of all stored chat messages with a peer.
   * Returns [] if no history yet. Phase 3.b/3 will add a cursor /
   * subscription path so the UI can stream updates.
   */
  listFriendChatMessages(peerRootPubKey: string): readonly StoredFriendChatMessage[] {
    return listFriendChatMessages(this.ottieHome, peerRootPubKey, this.logger);
  }

  // ----- Phase 4 v1: AI share invitations -------------------------------

  /**
   * Phase 4 v1: send an ai-share invitation to a paired friend through
   * the existing friend-sync session. Returns the minted invite (UI
   * uses `inviteId` for state tracking) on success, or an error string
   * on failure (no session, peer absent, sign/encrypt error, etc.).
   *
   * The actual agent timeline streaming is NOT shipped in v1 — see
   * §11.5 for the v1/v2/v3 split. Acceptance just records the state
   * change; v2 will hook the active-share state into AgentManager.
   */
  sendAiShareInvite(input: {
    peerRootPubKey: string;
    agentId: string;
    agentLabel: string;
    agentProvider: string;
    /** Override TTL ms (tests). Default 5 minutes. */
    ttlMs?: number;
    /**
     * Phase 4 v3/a — caps the owner-side daemon will enforce. Defaults
     * to `DEFAULT_AI_SHARE_LIMITS` when omitted (50 prompts, 100k
     * tokens, 1 h timeout — see §7's "UI mitigations" list).
     */
    limits?: AiShareLimits;
  }): { ok: true; invite: AiShareInviteEnvelope } | { ok: false; error: string } {
    if (this.state.kind !== "loaded") {
      return { ok: false, error: "Cannot send ai-share invite — root identity not loaded" };
    }
    if (!this.selfDeviceContext) {
      return { ok: false, error: "Cannot send ai-share invite — selfDeviceContext not configured" };
    }
    const peer = this.peerList?.peers.find(
      (p) => p.peerRootSignPublicKeyB64 === input.peerRootPubKey,
    );
    if (!peer) return { ok: false, error: "Peer is not in your friend list" };
    if (peer.status !== "active") return { ok: false, error: `Peer is ${peer.status}` };

    const session = this.friendSessions.get(input.peerRootPubKey);
    if (!session) {
      // v1 doesn't queue ai-share invites through the offline inbox.
      // Friend-sync session must be live; re-prompt user to retry
      // once the friend is reachable.
      return {
        ok: false,
        error: "Friend is offline — try again once the friend-sync session is open",
      };
    }

    const now = new Date();
    const ttlMs = input.ttlMs ?? 5 * 60 * 1000;
    const limits = input.limits ?? DEFAULT_AI_SHARE_LIMITS;
    const invite = buildAiShareInviteEnvelope({
      inviteId: `ais_${randomUuid()}`,
      ownerRootSignPrivateKey: this.state.bundle.signPrivateKey,
      ownerRootPubKeyB64: this.state.bundle.stored.signPublicKeyB64,
      ownerDeviceId: this.selfDeviceContext.serverId,
      agentId: input.agentId,
      agentLabel: input.agentLabel,
      agentProvider: input.agentProvider,
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      limits,
    });

    let frame;
    try {
      frame = encryptFriendSyncFrame({
        sharedKey: session.sharedKey,
        plaintext: JSON.stringify(invite),
      });
    } catch (err) {
      return {
        ok: false,
        error: `Failed to encrypt ai-share invite: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    try {
      session.socket.send(JSON.stringify(frame));
    } catch (err) {
      return {
        ok: false,
        error: `Failed to send ai-share invite: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    this.aiShareInvites.recordOutbound({
      invite,
      peerRootPubKeyB64: input.peerRootPubKey,
    });
    // Phase 4 v2/e: open the auditable on-disk transcript on the
    // owner side. The header carries the invite envelope so a forensic
    // tool can replay the share end-to-end.
    this.aiShareTranscripts.open({
      inviteId: invite.inviteId,
      side: "outbound",
      invite,
    });
    // Phase 4 v3/b: stamp the peer record so the friend's UI can
    // skip the first-share friction gate next time. Idempotent —
    // only writes the first time, so the timestamp records when this
    // peer was first shared with.
    if (this.peerList && peer.firstAiShareSentAt === undefined) {
      const updatedPeer: StoredPeer = {
        ...peer,
        firstAiShareSentAt: now.toISOString(),
      };
      const updated = upsertPeer(this.peerList, updatedPeer);
      try {
        savePeerList(this.ottieHome, updated, this.logger);
        this.peerList = updated;
      } catch (err) {
        this.logger.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            peerPrefix: input.peerRootPubKey.slice(0, 8),
          },
          "ai_share_first_share_stamp_failed",
        );
      }
    }
    this.logger.info(
      {
        inviteId: invite.inviteId,
        peerRootPubKeyPrefix: input.peerRootPubKey.slice(0, 8),
        agentLabel: input.agentLabel,
      },
      "ai_share_invite_sent",
    );
    return { ok: true, invite };
  }

  /**
   * Phase 4 v1: friend taps Accept on a pending ai-share invite.
   * Builds + sends a signed accept envelope, marks the local inbound
   * record accepted, returns the accept envelope for caller logging.
   */
  acceptAiShareInvite(inviteId: string):
    | {
        ok: true;
        accept: AiShareAcceptEnvelope;
      }
    | { ok: false; error: string } {
    if (this.state.kind !== "loaded") {
      return { ok: false, error: "Cannot accept — root identity not loaded" };
    }
    const entry = this.aiShareInvites.getInboundPending(inviteId);
    if (!entry) {
      return { ok: false, error: "Invite not found, already acted on, or expired" };
    }
    const session = this.friendSessions.get(entry.ownerRootPubKeyB64);
    if (!session) {
      return {
        ok: false,
        error: "Owner is offline — accept once the friend-sync session is open",
      };
    }

    const accept = buildAiShareAcceptEnvelope({
      inviteId,
      responderRootSignPrivateKey: this.state.bundle.signPrivateKey,
      responderRootPubKeyB64: this.state.bundle.stored.signPublicKeyB64,
      acceptedAt: new Date().toISOString(),
    });
    const frame = encryptFriendSyncFrame({
      sharedKey: session.sharedKey,
      plaintext: JSON.stringify(accept),
    });
    try {
      session.socket.send(JSON.stringify(frame));
    } catch (err) {
      return {
        ok: false,
        error: `Failed to send ai-share accept: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    this.aiShareInvites.applyInboundAccept(inviteId, {
      acceptedAt: accept.acceptedAt,
      signatureB64: accept.signatureB64,
    });
    // Phase 4 v2/e: log self-emitted accept on the friend-side transcript.
    this.aiShareTranscripts.append({
      inviteId,
      line: {
        v: 1,
        kind: "accept",
        origin: "self",
        acceptedAt: accept.acceptedAt,
        signatureB64: accept.signatureB64,
      },
    });
    this.logger.info({ inviteId }, "ai_share_invite_accepted");
    return { ok: true, accept };
  }

  /** Phase 4 v1: friend taps Decline (or auto-decline on expiry). */
  declineAiShareInvite(
    inviteId: string,
    reason?: string,
  ): { ok: true; decline: AiShareDeclineEnvelope } | { ok: false; error: string } {
    if (this.state.kind !== "loaded") {
      return { ok: false, error: "Cannot decline — root identity not loaded" };
    }
    const entry = this.aiShareInvites.getInboundPending(inviteId);
    if (!entry) {
      return { ok: false, error: "Invite not found, already acted on, or expired" };
    }
    const decline = buildAiShareDeclineEnvelope({
      inviteId,
      responderRootSignPrivateKey: this.state.bundle.signPrivateKey,
      responderRootPubKeyB64: this.state.bundle.stored.signPublicKeyB64,
      declinedAt: new Date().toISOString(),
      ...(reason !== undefined ? { reason } : {}),
    });
    // Best-effort: try the live session, but mark locally regardless.
    const session = this.friendSessions.get(entry.ownerRootPubKeyB64);
    if (session) {
      try {
        const frame = encryptFriendSyncFrame({
          sharedKey: session.sharedKey,
          plaintext: JSON.stringify(decline),
        });
        session.socket.send(JSON.stringify(frame));
      } catch (err) {
        this.logger.warn({ err, inviteId }, "ai_share_decline_send_failed_marking_locally");
      }
    }
    this.aiShareInvites.applyInboundDecline(inviteId, {
      declinedAt: decline.declinedAt,
      signatureB64: decline.signatureB64,
      ...(reason !== undefined ? { reason } : {}),
    });
    // Phase 4 v2/e: log self-emitted decline on the friend-side transcript.
    this.aiShareTranscripts.append({
      inviteId,
      line: {
        v: 1,
        kind: "decline",
        origin: "self",
        declinedAt: decline.declinedAt,
        ...(reason !== undefined ? { reason } : {}),
        signatureB64: decline.signatureB64,
      },
    });
    this.logger.info({ inviteId, reason }, "ai_share_invite_declined");
    return { ok: true, decline };
  }

  /** Phase 4 v1: list invitations this daemon has received that are still pending. */
  listInboundAiShareInvites(): ReadonlyArray<{
    inviteId: string;
    ownerRootPubKeyB64: string;
    agentLabel: string;
    agentProvider: string;
    receivedAt: string;
    expiresAt: string;
    limits?: AiShareLimits;
  }> {
    return this.aiShareInvites.listInboundPending().map((entry) => ({
      inviteId: entry.invite.inviteId,
      ownerRootPubKeyB64: entry.invite.ownerRootPubKeyB64,
      agentLabel: entry.invite.agentLabel,
      agentProvider: entry.invite.agentProvider,
      receivedAt: new Date(entry.receivedAtMs).toISOString(),
      expiresAt: entry.invite.expiresAt,
      ...(entry.invite.limits ? { limits: entry.invite.limits } : {}),
    }));
  }

  /** Phase 4 v1: list invites this daemon has sent (any state). */
  listOutboundAiShareInvites(): ReadonlyArray<{
    inviteId: string;
    peerRootPubKeyB64: string;
    agentLabel: string;
    state: "pending" | "active" | "declined" | "ended" | "expired";
  }> {
    return this.aiShareInvites.listOutbound().map((entry) => ({
      inviteId: entry.invite.inviteId,
      peerRootPubKeyB64: entry.peerRootPubKeyB64,
      agentLabel: entry.invite.agentLabel,
      state: entry.state.kind,
    }));
  }

  /**
   * Phase 4 v2/a — list active ai-share sessions on this daemon
   * (either side). Drives the active-share banner UI: each entry
   * gets a banner row + an End button.
   *
   * Phase 4 v2/e — each row carries a `peerOnline` bit derived from
   * whether `friendSessions` currently has a live session keyed by
   * the peer pubkey. Friend's UI flips to "owner offline" when this
   * goes false.
   */
  listActiveAiShares(): ReadonlyArray<{
    inviteId: string;
    side: "outbound" | "inbound";
    peerRootPubKeyB64: string;
    agentLabel: string;
    agentProvider: string;
    acceptedAt: string;
    peerOnline: boolean;
  }> {
    return this.aiShareInvites.listActive().map((entry) => ({
      ...entry,
      peerOnline: this.friendSessions.get(entry.peerRootPubKeyB64) !== undefined,
    }));
  }

  /**
   * Phase 4 v2/a — terminate an active ai-share session. Either side
   * can call this. Builds + sends an `ai-share-end` envelope through
   * the friend-sync session, then transitions the local registry
   * entry. Best-effort send; if the peer's session is already gone
   * we still mark the local side ended (UI dismisses the banner).
   */
  endAiShareSession(
    inviteId: string,
    reason?: string,
  ): { ok: true; envelope: AiShareEndEnvelope } | { ok: false; error: string } {
    if (this.state.kind !== "loaded") {
      return { ok: false, error: "Cannot end share — root identity not loaded" };
    }
    const active = this.aiShareInvites.getActive(inviteId);
    if (!active) {
      return { ok: false, error: "No active share with this id" };
    }
    const envelope = buildAiShareEndEnvelope({
      inviteId,
      senderRootSignPrivateKey: this.state.bundle.signPrivateKey,
      senderRootPubKeyB64: this.state.bundle.stored.signPublicKeyB64,
      endedAt: new Date().toISOString(),
      ...(reason !== undefined ? { reason } : {}),
    });
    // Best-effort emit to the peer; mark locally regardless.
    const session = this.friendSessions.get(active.peerRootPubKeyB64);
    if (session) {
      try {
        const frame = encryptFriendSyncFrame({
          sharedKey: session.sharedKey,
          plaintext: JSON.stringify(envelope),
        });
        session.socket.send(JSON.stringify(frame));
      } catch (err) {
        this.logger.warn({ err, inviteId }, "ai_share_end_send_failed_marking_locally");
      }
    }
    const args = {
      inviteId,
      endedBy: "self" as const,
      endedAt: envelope.endedAt,
      signatureB64: envelope.signatureB64,
      ...(reason !== undefined ? { reason } : {}),
    };
    this.aiShareInvites.applyOutboundEnd(args);
    this.aiShareInvites.applyInboundEnd(args);
    // Phase 4 v2/e: log self-emitted end on the local transcript.
    this.aiShareTranscripts.append({
      inviteId,
      line: {
        v: 1,
        kind: "end",
        origin: "self",
        endedAt: envelope.endedAt,
        ...(reason !== undefined ? { reason } : {}),
        signatureB64: envelope.signatureB64,
      },
    });
    this.logger.info({ inviteId, reason }, "ai_share_session_ended");
    return { ok: true, envelope };
  }

  /**
   * Phase 4 v2/b — friend side ships a prompt to the owner over the
   * active share. Builds + signs an `ai-share-prompt` envelope and
   * sends through the friend-sync session. Returns `{ ok: true,
   * promptId }` so the caller (UI) can correlate later. We don't add
   * the prompt to the friend's local chat history here — the shared-
   * agent surface in v2/c keeps a separate transcript.
   */
  sendAiSharePrompt(input: {
    inviteId: string;
    body: string;
  }):
    | { ok: true; promptId: string; envelope: AiSharePromptEnvelope }
    | { ok: false; error: string } {
    if (this.state.kind !== "loaded") {
      return { ok: false, error: "Cannot send prompt — root identity not loaded" };
    }
    const trimmed = input.body.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: "Prompt body must not be empty" };
    }
    if (trimmed.length > 16384) {
      return { ok: false, error: "Prompt body exceeds 16 KiB limit" };
    }
    const active = this.aiShareInvites.getActive(input.inviteId);
    if (!active) {
      return { ok: false, error: "No active share with this id" };
    }
    if (active.side !== "inbound") {
      // Sender direction is friend → owner; only the friend's daemon
      // (which has the `inbound` entry, because it received the invite)
      // is allowed to send prompts in v2/b.
      return { ok: false, error: "Only the share's responder can send prompts" };
    }
    const session = this.friendSessions.get(active.peerRootPubKeyB64);
    if (!session) {
      return { ok: false, error: "No active friend-sync session with the share owner" };
    }
    const promptId = `aip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const envelope = buildAiSharePromptEnvelope({
      inviteId: input.inviteId,
      promptId,
      senderRootSignPrivateKey: this.state.bundle.signPrivateKey,
      senderRootPubKeyB64: this.state.bundle.stored.signPublicKeyB64,
      sentAt: new Date().toISOString(),
      body: trimmed,
    });
    try {
      const frame = encryptFriendSyncFrame({
        sharedKey: session.sharedKey,
        plaintext: JSON.stringify(envelope),
      });
      session.socket.send(JSON.stringify(frame));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { err: message, inviteId: input.inviteId, promptId },
        "ai_share_prompt_send_failed",
      );
      return { ok: false, error: message };
    }
    // Phase 4 v2/e: log self-sent prompt on the friend-side transcript.
    this.aiShareTranscripts.append({
      inviteId: input.inviteId,
      line: {
        v: 1,
        kind: "prompt",
        origin: "sent",
        promptId,
        sentAt: envelope.sentAt,
        body: trimmed,
        signatureB64: envelope.signatureB64,
      },
    });
    this.logger.info(
      {
        inviteId: input.inviteId,
        promptId,
        peerPrefix: active.peerRootPubKeyB64.slice(0, 8),
        bodyChars: trimmed.length,
      },
      "ai_share_prompt_sent",
    );
    return { ok: true, promptId, envelope };
  }

  /**
   * Refresh the dialer's view of the device list — call after a device
   * is added (locally or via inbound event) so the dialer immediately
   * tries to connect to the new peer.
   */
  refreshPeerDialerTargets(): void {
    if (!this.peerDialer) return;
    this.peerDialer.refreshTargets();
  }

  /**
   * Snapshot of currently-pending candidates awaiting user approval.
   * Phase 2.e renders these in the "Approve new device?" dialog.
   */
  getPendingDeviceLinkCandidates() {
    return this.pendingCandidates.list();
  }

  /** Test/diagnostic helper for Phase 2.e wiring. */
  getPendingCandidateStore(): DeviceLinkPendingCandidateStore {
    return this.pendingCandidates;
  }

  /**
   * Phase 2.d (sender side): the NEW device's daemon redeems a deep-link
   * scanned/pasted by the user. Builds a candidate, opens a one-shot
   * relay WebSocket to the OLD device, sends the redemption envelope,
   * awaits an ack. The returned outcome is what the WS RPC layer turns
   * into a `device/link/redeem/response`.
   *
   * Doesn't require the new device's identity to be initialized — the
   * whole point is to bootstrap one. Phase 2.e will pick up the local
   * secrets the sender produced and persist them once the OLD device
   * approves.
   */
  async redeemDeviceLinkOffer(
    input: Omit<RedeemDeviceLinkOfferInput, "logger">,
  ): Promise<RedeemDeviceLinkOfferOutcome> {
    const outcome = await redeemDeviceLinkOffer({ ...input, logger: this.logger });
    if (outcome.status !== "linked") return outcome;

    // Persist the inbound identity to disk + sync in-memory state. If
    // the disk write fails we surface that to the caller so the UI can
    // tell the user "linked OK on the other side, but couldn't save —
    // please try again". The other side's devices.json already has us,
    // so a re-link won't double-add.
    try {
      this.adoptIdentityFromLink({
        rootIdentity: outcome.rootIdentity,
        signedDevice: outcome.signedDevice,
        peerDevices: outcome.peerDevices,
        signPrivateKeyB64: extractEd25519PrivateB64(outcome.localSecrets.signPrivateKey),
      });
      return outcome;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err }, "Device-link adopt-from-link failed");
      return {
        status: "rejected",
        errorCode: "adopt_failed",
        errorMessage: `Linked successfully but failed to persist locally: ${message}`,
      };
    }
  }

  /**
   * Phase 2.e/2: persist a root identity + self-device + device list
   * that arrived via the device-link approval reply. This is the one
   * code path that bootstraps a fresh `$OTTIE_HOME` from external
   * material instead of generating its own keys.
   *
   * Throws if the daemon is already initialized — adoption must only
   * run on a truly fresh install.
   */
  adoptIdentityFromLink(input: {
    rootIdentity: import("./identity-types.js").StoredRootIdentity;
    signedDevice: StoredDevice;
    peerDevices: readonly StoredDevice[];
    signPrivateKeyB64: string;
  }): void {
    if (this.state.kind !== "uninitialized") {
      throw new Error(
        `Cannot adopt identity from link: current state is "${this.state.kind}". ` +
          "Adoption only runs on a fresh daemon with no existing root identity.",
      );
    }

    // Sanity-check that the imported records are internally consistent
    // before touching disk. Mismatches usually mean either a corrupted
    // approval envelope or a bug in the OLD device's signing path.
    if (input.signedDevice.deviceId.length === 0) {
      throw new Error("Imported signedDevice has empty deviceId");
    }

    // 1. Root identity file (with the OLD device's root keypair copy).
    const rootBundle = writeImportedRootIdentity(this.ottieHome, input.rootIdentity, this.logger);

    // 2. Self-device file (this device's own signing keypair, generated
    // locally during Phase 2.d sender, signed by the OLD device's root).
    const selfBundle = writeImportedSelfDevice(
      this.ottieHome,
      {
        v: 1,
        deviceId: input.signedDevice.deviceId,
        signPublicKeyB64: input.signedDevice.signPublicKeyB64,
        signPrivateKeyB64: input.signPrivateKeyB64,
      },
      this.logger,
    );

    // 3. Device list — the snapshot the OLD device sent at approval
    // time, which already includes our newly-signed entry.
    const list: StoredDeviceList = { v: 1, devices: [...input.peerDevices] };
    saveDeviceList(this.ottieHome, list, this.logger);

    // 4. Sync in-memory state so subsequent RPCs see "loaded" without
    // needing a daemon restart. Phase 2.f/2.g need self-device in
    // memory for outbound event signing, so cache the bundle here
    // (not just the file write — the bundle carries the live KeyObject).
    this.state = { kind: "loaded", bundle: rootBundle };
    this.deviceList = list;
    this.selfDevice = selfBundle;
    // Phase 3.a/3: seed an empty peer list so friend-pair flows work
    // without a daemon restart after device-link adoption.
    if (!this.peerList) {
      this.peerList = { v: 1, peers: [] };
    }

    this.logger.info(
      {
        displayName: input.rootIdentity.displayName,
        deviceId: input.signedDevice.deviceId,
        peerCount: input.peerDevices.length,
      },
      "Adopted identity from device-link approval",
    );

    // Same reason as `initialize()`: bootstrap's startPeerSync/startFriendSync
    // already ran (and did nothing — no identity yet). Kick them now that
    // identity is loaded; both calls are idempotent.
    this.startPeerSync();
    this.startFriendSync();
    this.startInboxReceiver();
  }

  /**
   * Phase 2.e: list candidates the OLD device's UI should surface in the
   * "Approve a new device?" prompt. Each entry has just enough metadata
   * for the UI; secrets stay daemon-side.
   */
  listPendingDeviceLinkCandidates(): readonly PendingDeviceLinkCandidateOnWire[] {
    return this.pendingCandidates.list().map((record) => ({
      nonceB64: record.nonceB64,
      deviceLabel: record.candidate.deviceLabel,
      role: record.candidate.role,
      generatedAt: record.candidate.generatedAt,
      receivedAt: new Date(record.receivedAtMs).toISOString(),
      expiresAtMs: record.expiresAtMs,
    }));
  }

  /**
   * Phase 2.e: approve a parked candidate. Signs the new device's
   * pubkey with the root identity, appends to devices.json, encrypts
   * an approval reply (including the root key bundle + peer-list
   * snapshot), sends it over the still-open Phase 2.d socket, then
   * closes the socket.
   *
   * Result.approved is `true` on the happy path. `false` (with an
   * `error`) means: candidate not found / expired / new device went
   * offline before we could deliver the reply / disk write failed.
   */
  approveDeviceLink(nonceB64: string): {
    approved: boolean;
    devices: readonly StoredDevice[] | null;
    error: string | null;
  } {
    if (this.state.kind !== "loaded") {
      return {
        approved: false,
        devices: null,
        error: "Cannot approve device-link — root identity not loaded",
      };
    }
    if (!this.deviceList) {
      return {
        approved: false,
        devices: null,
        error: "Cannot approve device-link — device list not initialized",
      };
    }

    const record = this.pendingCandidates.consume(nonceB64);
    if (!record) {
      return {
        approved: false,
        devices: null,
        error: "Candidate not found, already consumed, or expired",
      };
    }

    let result;
    try {
      result = approveDeviceLinkCandidate({
        candidate: record.candidate,
        ephPrivateKeyB64: record.ephPrivateKeyB64,
        newDeviceEphPublicKeyB64: record.newDeviceEphPublicKeyB64,
        rootIdentity: this.state.bundle,
        existingDevices: this.deviceList.devices,
      });
    } catch (err) {
      return {
        approved: false,
        devices: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Persist BEFORE talking to the new device. If disk write fails we
    // bail without telling the new device "approved" — it'll see the
    // socket close and surface that as an error to its caller.
    const updated: StoredDeviceList = {
      v: 1,
      devices: [...this.deviceList.devices, result.signedDevice],
    };
    try {
      saveDeviceList(this.ottieHome, updated, this.logger);
    } catch (err) {
      this.closeReplySocket(record.replySocket, 1011, "save_failed");
      return {
        approved: false,
        devices: null,
        error: `Failed to persist device list: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    this.deviceList = updated;

    // Phase 2.f/1: log a device-added event signed by this device.
    // Phase 2.f/2 will broadcast un-broadcast events to peers; for now
    // the event is only persisted locally. Failure to write the event
    // log is non-fatal — the device is already in devices.json — but
    // we surface a warning so an operator can investigate.
    this.tryEmitDeviceAddedEvent(result.signedDevice);

    // Phase 2.f/2c: nudge the dialer so it immediately tries to
    // connect to the freshly-added daemon peer (if it's a daemon).
    if (result.signedDevice.role === "daemon") {
      this.refreshPeerDialerTargets();
    }

    // Send the encrypted reply, then close the socket cleanly.
    const sent = this.sendThenClose(record.replySocket, JSON.stringify(result.envelope));
    if (!sent) {
      this.logger.warn(
        { noncePrefix: nonceB64.slice(0, 8) },
        "device_link_approve_reply_send_failed_socket_dead",
      );
      // The signed device IS persisted on this side — the new device
      // just won't have heard about it. Surface that so the user can
      // re-link if needed (they'd see two devices: this and a future
      // re-link). Phase 2.f peer-sync will eventually reconcile.
      return {
        approved: true,
        devices: updated.devices,
        error:
          "Approved and saved locally, but the new device was already offline — " +
          "tell them to scan again",
      };
    }

    this.logger.info(
      {
        deviceId: result.signedDevice.deviceId,
        deviceLabel: result.signedDevice.deviceLabel,
      },
      "Device-link candidate approved and reply sent",
    );

    return { approved: true, devices: updated.devices, error: null };
  }

  /**
   * Phase 2.e: reject a parked candidate. Sends an encrypted "rejected"
   * envelope back to the new device (so it knows the user said no), then
   * closes the socket. Does NOT touch devices.json.
   */
  rejectDeviceLink(nonceB64: string, reason?: string): { rejected: boolean; error: string | null } {
    const record = this.pendingCandidates.consume(nonceB64);
    if (!record) {
      return { rejected: false, error: "Candidate not found, already consumed, or expired" };
    }
    const { envelope } = rejectDeviceLinkCandidate({
      ephPrivateKeyB64: record.ephPrivateKeyB64,
      newDeviceEphPublicKeyB64: record.newDeviceEphPublicKeyB64,
      ...(reason ? { rejectionReason: reason } : {}),
    });
    const sent = this.sendThenClose(record.replySocket, JSON.stringify(envelope));
    if (!sent) {
      return {
        rejected: true,
        error: "Rejection recorded locally, but the new device was already offline",
      };
    }
    this.logger.info(
      { noncePrefix: nonceB64.slice(0, 8), reason },
      "Device-link candidate rejected",
    );
    return { rejected: true, error: null };
  }

  /**
   * Phase 2.g: remove a device from the user's device list.
   *
   * Behavior:
   *   - Refuses to remove THIS daemon's own self-device (would trip the
   *     self-device safety re-add on next boot, and is the user's
   *     responsibility — to revoke "this" device they should sign out
   *     locally + uninstall, then have another device remove it).
   *   - Removes from in-memory + on-disk devices.json.
   *   - Emits a signed `device-removed` event into the local log.
   *   - Broadcasts the event to all active peer-sync sessions so
   *     the other daemons under this identity see the removal within
   *     a heartbeat (Phase 2.f/3 broadcast pipeline).
   *   - Closes the dropped peer's session (if any) so the relay
   *     stops carrying their traffic to/from us.
   *
   * Returns { removed, devices, error }: `devices` is the new
   * snapshot, or null on error.
   */
  removeDevice(deviceId: string): {
    removed: boolean;
    devices: readonly StoredDevice[] | null;
    error: string | null;
  } {
    if (this.state.kind !== "loaded") {
      return {
        removed: false,
        devices: null,
        error: "Cannot remove device — root identity not loaded",
      };
    }
    if (!this.deviceList) {
      return {
        removed: false,
        devices: null,
        error: "Cannot remove device — device list not initialized",
      };
    }
    if (this.selfDeviceContext && deviceId === this.selfDeviceContext.serverId) {
      return {
        removed: false,
        devices: null,
        error:
          "Refusing to remove this device's own record from itself. " +
          "Use another device under the same identity to remove this one.",
      };
    }

    const target = this.deviceList.devices.find((d) => d.deviceId === deviceId);
    if (!target) {
      return { removed: false, devices: null, error: "Device not in the device list" };
    }

    const updated: StoredDeviceList = {
      v: 1,
      devices: this.deviceList.devices.filter((d) => d.deviceId !== deviceId),
    };
    try {
      saveDeviceList(this.ottieHome, updated, this.logger);
    } catch (err) {
      return {
        removed: false,
        devices: null,
        error: `Failed to persist device list: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    this.deviceList = updated;

    // Emit + broadcast the device-removed event. Peers apply
    // idempotently and will drop the device from their own lists.
    this.tryEmitDeviceRemovedEvent(deviceId);

    // Close any active peer-sync session with the removed device —
    // we no longer trust them, so stop talking. The dialer's per-peer
    // state stays around, but next dial attempt will be against a
    // peer that's no longer in the device list, so refreshTargets
    // won't redial.
    this.peerSessions.remove(deviceId);

    this.logger.info(
      {
        deviceId,
        deviceLabel: target.deviceLabel,
        role: target.role,
      },
      "Device removed",
    );

    return { removed: true, devices: updated.devices, error: null };
  }

  // ----- Phase 2.f: device-list event log --------------------------------

  /**
   * Snapshot of the local events log. Phase 2.f/2 will use this to
   * replay un-broadcast events to peers on reconnect.
   */
  getDeviceListEvents(): readonly DeviceListEvent[] {
    return this.events.list();
  }

  /**
   * Apply an event that arrived from a peer daemon. Verifies the
   * signature against the receiver's local device list, merges into
   * devices.json + the in-memory list, and appends to the local event
   * log so a future peer reconnect can replay it forward.
   *
   * Returns the apply outcome from `applyDeviceListEvent` plus a flag
   * for whether persistence succeeded.
   */
  applyInboundDeviceListEvent(event: DeviceListEvent): {
    status: "applied" | "rejected";
    mutated: boolean;
    reason?: string;
    error?: string;
  } {
    if (!this.deviceList) {
      return {
        status: "rejected",
        mutated: false,
        reason: "Device list not initialized",
      };
    }
    const outcome = applyDeviceListEvent({
      event,
      current: this.deviceList,
      lastSeenSeqBySource: this.events.lastSeenSeqBySource(),
    });
    if (outcome.status === "rejected") {
      this.logger.warn(
        { kind: event.kind, sourceDeviceIdPrefix: event.sourceDeviceId.slice(0, 8) },
        `Inbound device-list event rejected: ${outcome.reason}`,
      );
      return { status: "rejected", mutated: false, reason: outcome.reason };
    }

    if (outcome.mutated) {
      try {
        saveDeviceList(this.ottieHome, outcome.devices, this.logger);
      } catch (err) {
        return {
          status: "rejected",
          mutated: false,
          error: `Failed to persist device list after applying event: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
      this.deviceList = outcome.devices;
      // Phase 2.f/2c: a peer-emitted add lands here — nudge the dialer
      // so we immediately try to connect to any new daemon peer.
      if (event.kind === "device-added" && event.device.role === "daemon") {
        this.refreshPeerDialerTargets();
      }
    }
    // Always append to the log even if mutated=false (replay-detected),
    // so the per-source seq high-water mark advances. The store handles
    // duplicates via lastSeenSeqBySource so re-broadcasting is safe.
    this.events.append(event);
    return { status: "applied", mutated: outcome.mutated };
  }

  /**
   * Phase 2.f/3: encrypt + send a single event to all currently-
   * active peer sessions. Used both for live broadcasts (right after
   * tryEmitDeviceAddedEvent) and reconnect catch-up (replayEventsToPeer).
   *
   * Failures on individual sessions log and skip — applyDeviceList
   * Event on the peer side is idempotent + replay-safe via lastSeen
   * SeqBySource, so a partial-fanout is recoverable on the next
   * reconnect.
   */
  private broadcastEvent(event: DeviceListEvent): void {
    const sessions = this.peerSessions.list();
    if (sessions.length === 0) return;
    const payload = JSON.stringify(event);
    for (const session of sessions) {
      this.sendEventToSession(session, event, payload);
    }
  }

  /**
   * Phase 2.f/3 catch-up: when a fresh peer session is established,
   * replay every event in the local log to that peer. Their replay-
   * protection map (lastSeenSeqBySource) drops events they've already
   * applied, so the cost is just bytes-on-the-wire (small for now,
   * Phase 2.f+ may switch to delta-resync if it grows).
   */
  private replayEventsToPeer(peerDeviceId: string): void {
    const session = this.peerSessions.get(peerDeviceId);
    if (!session) return;
    const events = this.events.list();
    if (events.length === 0) return;
    let sent = 0;
    for (const event of events) {
      const payload = JSON.stringify(event);
      if (this.sendEventToSession(session, event, payload)) sent += 1;
    }
    this.logger.info(
      {
        peerDeviceIdPrefix: peerDeviceId.slice(0, 12),
        replayedCount: sent,
        totalLog: events.length,
      },
      "peer_sync_catchup_replay",
    );
  }

  private sendEventToSession(
    session: PeerSession,
    event: DeviceListEvent,
    payloadJson: string,
  ): boolean {
    try {
      const frame = encryptPeerSyncFrame({
        sharedKey: session.sharedKey,
        plaintext: payloadJson,
      });
      session.socket.send(JSON.stringify(frame));
      return true;
    } catch (err) {
      this.logger.warn(
        {
          err,
          peerDeviceIdPrefix: session.peerDeviceId.slice(0, 12),
          eventKind: event.kind,
          eventSeq: event.seq,
        },
        "peer_sync_broadcast_send_failed",
      );
      // Surface socket failure by closing — dialer will reconnect.
      try {
        session.socket.close(1011, "broadcast_send_failed");
      } catch {
        // ignore
      }
      this.peerSessions.remove(session.peerDeviceId);
      return false;
    }
  }

  private tryEmitDeviceAddedEvent(addedDevice: StoredDevice): void {
    if (!this.selfDevice || !this.selfDeviceContext) {
      this.logger.warn(
        { addedDeviceId: addedDevice.deviceId },
        "Cannot emit device-added event — self-device not loaded",
      );
      return;
    }
    try {
      const event = signDeviceAddedEvent({
        device: addedDevice,
        sourceDeviceId: this.selfDeviceContext.serverId,
        signPrivateKey: this.selfDevice.signPrivateKey,
        seq: this.events.nextSelfSeq(this.selfDeviceContext.serverId),
      });
      this.events.append(event);
      // Phase 2.f/3: fan out to every active peer session right after
      // appending. Newly-connected peers also pick this up via the
      // catch-up replay in replayEventsToPeer.
      this.broadcastEvent(event);
    } catch (err) {
      this.logger.warn(
        { err, addedDeviceId: addedDevice.deviceId },
        "Failed to emit device-added event (non-fatal — device-list write already succeeded)",
      );
    }
  }

  /**
   * Phase 2.g: counterpart to tryEmitDeviceAddedEvent. Signs a
   * device-removed event with this daemon's self-device key, appends
   * to the local log, and broadcasts to all peer sessions.
   *
   * Failure here is non-fatal — devices.json is already updated, the
   * removal "took" locally, just won't propagate this round. Phase
   * 2.f/3's catch-up replay will resync on next reconnect.
   */
  private tryEmitDeviceRemovedEvent(removedDeviceId: string): void {
    if (!this.selfDevice || !this.selfDeviceContext) {
      this.logger.warn(
        { removedDeviceId },
        "Cannot emit device-removed event — self-device not loaded",
      );
      return;
    }
    try {
      const event = signDeviceRemovedEvent({
        removedDeviceId,
        sourceDeviceId: this.selfDeviceContext.serverId,
        signPrivateKey: this.selfDevice.signPrivateKey,
        seq: this.events.nextSelfSeq(this.selfDeviceContext.serverId),
      });
      this.events.append(event);
      this.broadcastEvent(event);
    } catch (err) {
      this.logger.warn(
        { err, removedDeviceId },
        "Failed to emit device-removed event (non-fatal — device-list write already succeeded)",
      );
    }
  }

  private sendThenClose(
    socket:
      | {
          send: (data: string) => void;
          close: (code?: number, reason?: string) => void;
        }
      | undefined,
    data: string,
  ): boolean {
    if (!socket) return false;
    try {
      socket.send(data);
    } catch (err) {
      this.logger.warn({ err }, "device_link_reply_send_failed");
      this.closeReplySocket(socket, 1011, "send_failed");
      return false;
    }
    this.closeReplySocket(socket, 1000, "approved_and_replied");
    return true;
  }

  private closeReplySocket(
    socket: { close: (code?: number, reason?: string) => void } | undefined,
    code: number,
    reason: string,
  ): void {
    if (!socket) return;
    try {
      socket.close(code, reason);
    } catch {
      // ignore
    }
  }

  // ----- private: self-device + device-list lifecycle ---------------------

  private ensureSelfDevice(rootIdentity: RootIdentityBundle): void {
    if (!this.selfDeviceContext) return;

    const existingSelf = this.tryLoad(
      () => loadSelfDevice(this.ottieHome, this.logger),
      "self-device",
    );
    const existingList = this.tryLoad(
      () => loadDeviceList(this.ottieHome, this.logger),
      "device-list",
    );

    if (existingSelf && existingList) {
      // Both files present — happy path on every reboot after the first.
      // Sanity-check that the list contains the self-device.
      const inList = existingList.devices.some((d) => d.deviceId === existingSelf.stored.deviceId);
      if (!inList) {
        this.logger.warn(
          { deviceId: existingSelf.stored.deviceId },
          "Self-device file exists but is missing from device list — re-adding",
        );
        const refreshed = this.appendSelfToDeviceList(existingSelf, existingList, rootIdentity);
        this.selfDevice = existingSelf;
        this.deviceList = refreshed;
        saveDeviceList(this.ottieHome, refreshed, this.logger);
        return;
      }
      this.selfDevice = existingSelf;
      this.deviceList = existingList;
      return;
    }

    if (existingSelf && !existingList) {
      // Self exists but list missing — corruption or partial write.
      // Recreate the list from the self entry, signing freshly.
      this.logger.warn(
        { deviceId: existingSelf.stored.deviceId },
        "Self-device exists but device list missing — rebuilding list",
      );
      const list = this.buildDeviceListFromSelf(existingSelf, rootIdentity);
      saveDeviceList(this.ottieHome, list, this.logger);
      this.selfDevice = existingSelf;
      this.deviceList = list;
      return;
    }

    if (!existingSelf && existingList) {
      // List exists but no self — also corruption. We can't safely
      // regenerate the self-device because doing so would reuse the existing
      // deviceId (server-id) with a different signing key, invalidating any
      // peer's cached copy of our public key. Surface this loudly.
      throw new Error(
        "Device list exists but self-device is missing. Refusing to regenerate the " +
          "self-device key — peers would silently lose trust. Manually inspect " +
          `${this.ottieHome}/identity/devices.json and self-device.json.`,
      );
    }

    // Neither exists — fresh install path. Generate self-device + list.
    const fresh = createSelfDevice(this.ottieHome, this.selfDeviceContext.serverId, this.logger);
    const list = this.buildDeviceListFromSelf(fresh, rootIdentity);
    saveDeviceList(this.ottieHome, list, this.logger);
    this.selfDevice = fresh;
    this.deviceList = list;
    this.logger.info(
      {
        deviceId: fresh.stored.deviceId,
        deviceLabel: this.selfDeviceContext.deviceLabel,
      },
      "Self-device record signed and persisted",
    );
  }

  private buildDeviceListFromSelf(
    self: SelfDeviceBundle,
    rootIdentity: RootIdentityBundle,
  ): StoredDeviceList {
    const ctx = this.selfDeviceContext;
    if (!ctx) {
      // Defensive: ensureSelfDevice already checks this, but keep the type-narrow.
      throw new Error("buildDeviceListFromSelf called without selfDeviceContext");
    }
    const device = buildAuthorizedDevice({
      deviceId: self.stored.deviceId,
      deviceLabel: ctx.deviceLabel,
      role: "daemon",
      signPublicKeyB64: self.stored.signPublicKeyB64,
      rootIdentity,
    });
    return { v: 1, devices: [device] };
  }

  private appendSelfToDeviceList(
    self: SelfDeviceBundle,
    existing: StoredDeviceList,
    rootIdentity: RootIdentityBundle,
  ): StoredDeviceList {
    const ctx = this.selfDeviceContext;
    if (!ctx) {
      throw new Error("appendSelfToDeviceList called without selfDeviceContext");
    }
    const selfDevice = buildAuthorizedDevice({
      deviceId: self.stored.deviceId,
      deviceLabel: ctx.deviceLabel,
      role: "daemon",
      signPublicKeyB64: self.stored.signPublicKeyB64,
      rootIdentity,
    });
    return {
      v: 1,
      devices: [...existing.devices, selfDevice],
    };
  }

  private tryLoad<T>(loader: () => T, label: string): T | null {
    try {
      return loader();
    } catch (err) {
      this.logger.error(
        { err, label },
        "Failed to load identity sub-resource — refusing to overwrite",
      );
      throw err;
    }
  }
}

/**
 * Pull the JWK 'd' field (base64url, no padding) out of a Node Ed25519
 * KeyObject. Mirrors the export helper in self-device-store.ts but lives
 * here so identity-service doesn't have to import a private function.
 */
function extractEd25519PrivateB64(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" }) as { d?: string };
  if (!jwk.d) {
    throw new Error("Ed25519 private key JWK is missing the 'd' field");
  }
  return jwk.d;
}
