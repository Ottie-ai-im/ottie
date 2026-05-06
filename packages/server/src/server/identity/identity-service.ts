import type pino from "pino";

import type { RelayConnectionHandler } from "../relay-transport.js";

import { buildAuthorizedDevice, loadDeviceList, saveDeviceList } from "./device-list-store.js";
import { DeviceLinkPendingCandidateStore } from "./device-link-pending-candidate-store.js";
import {
  DeviceLinkPendingStore,
  type CreatePendingOfferResult,
} from "./device-link-pending-store.js";
import { createDeviceLinkConnectionHandler } from "./device-link-receiver.js";
import {
  redeemDeviceLinkOffer,
  type RedeemDeviceLinkOfferInput,
  type RedeemDeviceLinkOfferOutcome,
} from "./device-link-sender.js";
import { type StoredDevice, type StoredDeviceList } from "./device-types.js";
import {
  createRootIdentity,
  loadRootIdentity,
  type RootIdentityBundle,
} from "./root-identity-store.js";
import { createSelfDevice, loadSelfDevice, type SelfDeviceBundle } from "./self-device-store.js";

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
  redeemDeviceLinkOffer(
    input: Omit<RedeemDeviceLinkOfferInput, "logger">,
  ): Promise<RedeemDeviceLinkOfferOutcome> {
    return redeemDeviceLinkOffer({ ...input, logger: this.logger });
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
