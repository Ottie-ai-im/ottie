import { requireOptionalNativeModule } from "expo-modules-core";

// JS surface for the agent-running Live Activity. Mirrors the Swift
// `AgentRunActivityAttributes` shape — keep both files in lock-step.
//
// Every entry point is a no-op on non-iOS and on iOS < 16.1 (the native
// module rejects with `unavailable_ios_version`; we swallow that here so
// callers don't need to platform-gate every call site). When ActivityKit
// is unavailable, the returned activityId is `null` and subsequent
// update/end calls are silent no-ops.

export type AgentRunStatus = "running" | "completed" | "error";

export interface AgentRunStartInput {
  agentLabel: string;
  providerLabel: string;
  /** ISO-8601 timestamp; SwiftUI's Text(_:style:.timer) drives the ticker. */
  startedAt: string;
  status: AgentRunStatus;
  /** Most-recent tool-call name. Optional. */
  toolCall?: string | null;
}

export interface AgentRunUpdateInput {
  activityId: string;
  startedAt: string;
  status: AgentRunStatus;
  toolCall?: string | null;
}

export interface AgentRunEndInput {
  activityId: string;
  /** Final visible state. Falls back to current state when omitted. */
  finalState?: {
    startedAt: string;
    status: AgentRunStatus;
    toolCall?: string | null;
  };
  /**
   * How long iOS keeps the ended activity visible (ms). 0 / undefined =
   * immediate; iOS caps at ~4s in practice — that's the default sweet
   * spot for "agent finished, show the result for a beat then dismiss".
   */
  dismissAfterMs?: number;
}

interface NativeModule {
  isLiveActivitySupported: () => Promise<boolean>;
  startAgentRunActivity: (input: AgentRunStartInput) => Promise<string>;
  updateAgentRunActivity: (input: AgentRunUpdateInput) => Promise<void>;
  endAgentRunActivity: (input: AgentRunEndInput) => Promise<void>;
  endAllAgentRunActivities: () => Promise<void>;
}

const native = requireOptionalNativeModule<NativeModule>("OttieLiveActivity");

export async function isLiveActivitySupported(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.isLiveActivitySupported();
  } catch {
    return false;
  }
}

export async function startAgentRunActivity(input: AgentRunStartInput): Promise<string | null> {
  if (!native) return null;
  try {
    return await native.startAgentRunActivity(input);
  } catch {
    // Most common cause: user disabled Live Activities in Settings, or
    // we're on iOS < 16.1. Either way the JS caller can fall back to
    // the existing in-app banner without a console error.
    return null;
  }
}

export async function updateAgentRunActivity(input: AgentRunUpdateInput): Promise<void> {
  if (!native) return;
  try {
    await native.updateAgentRunActivity(input);
  } catch {
    // Activity was already ended elsewhere, or process restarted and
    // lost the in-memory handle. Drop the update silently.
  }
}

export async function endAgentRunActivity(input: AgentRunEndInput): Promise<void> {
  if (!native) return;
  try {
    await native.endAgentRunActivity(input);
  } catch {
    // Same rationale as updateAgentRunActivity.
  }
}

export async function endAllAgentRunActivities(): Promise<void> {
  if (!native) return;
  try {
    await native.endAllAgentRunActivities();
  } catch {
    // Best-effort cleanup; never throw.
  }
}
