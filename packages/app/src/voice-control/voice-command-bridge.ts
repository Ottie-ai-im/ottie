import type { CommandResult } from "@/voice-control/voice-commands";

/**
 * The voice controller is a module-level singleton (lives outside React).
 * Several commands need React-only context — daemon client, currently
 * focused agent — that the controller can't read directly.
 *
 * The bridge is the small stable adapter realtime-voice-component recommends
 * ("create an app-owned wrapper"): a {@link VoiceCommandBridgeProvider}
 * mounted in the React tree calls {@link setVoiceCommandBridge} with closures
 * over the live state, and command handlers call {@link getVoiceCommandBridge}
 * to invoke them. When no provider is mounted (or the gate is off), a noop
 * bridge returns "ok: false, message: 'Bridge not mounted'" so commands fail
 * cleanly instead of throwing.
 *
 * Bridge methods MUST:
 *   - never throw — return CommandResult-shaped errors
 *   - never bypass React-side safety checks (permissions, schema validation)
 *   - re-route through the same daemon-client APIs the manual UI uses, so
 *     side effects (toasts, optimistic stream updates) match the regular
 *     flow exactly
 */
export interface VoiceCommandBridge {
  /** Send `text` to the currently active agent, the same way Composer would. */
  sendToActiveAgent(text: string): Promise<CommandResult>;
  /** Interrupt the currently running agent (equivalent to clicking stop). */
  interruptActiveAgent(): Promise<CommandResult>;
  /** Snapshot of who's currently active; used for diagnostic messages. */
  describeActiveTarget(): string | null;
}

const NOOP_MESSAGE = "Voice command bridge isn't mounted yet";

const noopBridge: VoiceCommandBridge = {
  async sendToActiveAgent() {
    return { ok: false, message: NOOP_MESSAGE };
  },
  async interruptActiveAgent() {
    return { ok: false, message: NOOP_MESSAGE };
  },
  describeActiveTarget() {
    return null;
  },
};

let activeBridge: VoiceCommandBridge = noopBridge;

/**
 * Called from {@link VoiceCommandBridgeProvider} on mount/update with a
 * bridge whose closures capture the current daemon client + active agent.
 * Pass null on unmount to revert to the noop implementation.
 */
export function setVoiceCommandBridge(bridge: VoiceCommandBridge | null): void {
  activeBridge = bridge ?? noopBridge;
}

export function getVoiceCommandBridge(): VoiceCommandBridge {
  return activeBridge;
}
