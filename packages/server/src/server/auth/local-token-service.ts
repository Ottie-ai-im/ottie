// LocalTokenService — server-side wrapper around the local-token primitives
// used by the Settings → Advanced → Local daemon panel (D-13).
//
// `getStatus()` returns `{mode, tokenPresent}` — the token VALUE never crosses
// the WS boundary (T-05-08). `regenerate()` rewrites the on-disk file via the
// `generateAndWriteLocalToken` primitive and re-resolves the active mode so a
// subsequent `getStatus()` reflects the new state.
//
// `registerLocalTokenHandlers(router, service, emit)` wires the four RPC
// handlers onto the MessageRouter from Plan 01-04. Keeps session.ts surface
// area minimal: one import + one call (per checker B2).

import type { SessionOutboundMessage } from "../../shared/messages.js";
import type { MessageRouter } from "../session/router.js";

import {
  generateAndWriteLocalToken,
  resolveLocalTokenMode,
  type LocalTokenMode,
} from "./local-token.js";

export interface LocalTokenStatus {
  mode: "loopback-trust" | "token-file" | "explicit";
  tokenPresent: boolean;
}

export class LocalTokenService {
  // The current resolved mode is captured at construction (matches the
  // WS-server lifetime). `regenerate()` re-resolves so subsequent `getStatus`
  // calls reflect the post-write state.
  constructor(private currentMode: LocalTokenMode) {}

  async getStatus(): Promise<LocalTokenStatus> {
    return {
      mode: this.currentMode.kind,
      tokenPresent: this.currentMode.kind !== "loopback-trust",
    };
  }

  async regenerate(): Promise<{ success: true } | { success: false; error: string }> {
    try {
      await generateAndWriteLocalToken();
      // Re-resolve so the next getStatus() returns the new mode (typically
      // transitions loopback-trust → token-file).
      this.currentMode = await resolveLocalTokenMode();
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
}

/**
 * Self-contained handler registration. session.ts calls this helper once during
 * construction to wire the two inbound local-token RPC kinds onto the router.
 *
 * The `emit` callback is `(msg) => session.emit(msg)` — keeps session.ts
 * surface area minimal (one helper invocation, no inline handler bodies).
 */
export function registerLocalTokenHandlers(
  router: MessageRouter,
  service: LocalTokenService,
  emit: (msg: SessionOutboundMessage) => void,
): void {
  router.register("local_token_status_request", async (msg) => {
    if (msg.type !== "local_token_status_request") {
      return;
    }
    const status = await service.getStatus();
    emit({
      type: "local_token_status_response",
      payload: {
        requestId: msg.requestId,
        mode: status.mode,
        tokenPresent: status.tokenPresent,
      },
    });
  });

  router.register("local_token_regenerate_request", async (msg) => {
    if (msg.type !== "local_token_regenerate_request") {
      return;
    }
    const result = await service.regenerate();
    emit({
      type: "local_token_regenerate_response",
      payload: {
        requestId: msg.requestId,
        success: result.success,
        error: "error" in result ? result.error : undefined,
      },
    });
  });
}
