import type { KeyObject } from "node:crypto";
import type pino from "pino";

import type { RelayConnectionHandler } from "../relay-transport.js";

import { buildAuthorizedDevice, loadDeviceList, saveDeviceList } from "./device-list-store.js";
import { applyDeviceListEvent, signDeviceAddedEvent } from "./device-list-event.js";
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
  private readonly events: DeviceListEventStore;
  private readonly peerSessions: PeerSessionRegistry;
  private peerDialer: PeerSyncDialer | null = null;
  private state: IdentityState;
  private selfDevice: SelfDeviceBundle | null = null;
  private deviceList: StoredDeviceList | null = null;

  constructor(options: IdentityServiceOptions) {
    this.ottieHome = options.ottieHome;
    this.logger = options.logger;
    this.selfDeviceContext = options.selfDeviceContext ?? null;
    this.relayEndpoint = options.relayEndpoint ?? null;
    this.pendingDeviceLinks = new DeviceLinkPendingStore(options.logger);
    this.pendingCandidates = new DeviceLinkPendingCandidateStore(options.logger);
    this.events = DeviceListEventStore.loadOrCreate(options.ottieHome, options.logger);
    this.peerSessions = new PeerSessionRegistry(options.logger);
    this.state = this.loadInitialState();
    if (this.state.kind === "loaded" && this.selfDeviceContext) {
      // Existing daemons that pre-date Phase 2.a have a root identity but no
      // self-device file. Migrate them in-place by generating + signing the
      // self-device on first boot under the new build.
      this.ensureSelfDevice(this.state.bundle);
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
    writeImportedSelfDevice(
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
    // needing a daemon restart.
    this.state = { kind: "loaded", bundle: rootBundle };
    this.deviceList = list;
    // We don't re-load self-device into memory — currently it's only
    // consumed during cross-device sync flows that re-read the file
    // when needed. ensureSelfDevice() does that for fresh installs.
    // Future Phase 2.f will revisit if hot-loading is needed here.

    this.logger.info(
      {
        displayName: input.rootIdentity.displayName,
        deviceId: input.signedDevice.deviceId,
        peerCount: input.peerDevices.length,
      },
      "Adopted identity from device-link approval",
    );
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

  // tryEmitDeviceRemovedEvent (counterpart to tryEmitDeviceAddedEvent)
  // lands in Phase 2.g when the "Remove device" UI/RPC arrives. Inbound
  // device-removed events from peers already work via
  // applyInboundDeviceListEvent.

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
