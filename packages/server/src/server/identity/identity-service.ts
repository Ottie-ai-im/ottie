import type pino from "pino";

import {
  createRootIdentity,
  loadRootIdentity,
  type RootIdentityBundle,
} from "./root-identity-store.js";

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
}

/**
 * Daemon-side wrapper around the on-disk root identity. Constructed once
 * at bootstrap; consumed by WS RPC handlers (Phase 1.g), CLI (Phase 1.d),
 * and the device-list / signing flows in later phases.
 */
export class IdentityService {
  private readonly ottieHome: string;
  private readonly logger: pino.Logger;
  private state: IdentityState;

  constructor(options: IdentityServiceOptions) {
    this.ottieHome = options.ottieHome;
    this.logger = options.logger;
    this.state = this.loadInitialState();
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
   */
  initialize(displayName: string): RootIdentityBundle {
    if (this.state.kind !== "uninitialized") {
      throw new Error(`Cannot initialize root identity: current state is "${this.state.kind}"`);
    }
    const bundle = createRootIdentity(this.ottieHome, displayName, this.logger);
    this.state = { kind: "loaded", bundle };
    return bundle;
  }
}
