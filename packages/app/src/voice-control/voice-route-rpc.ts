import type { VoiceCommand } from "@/voice-control/voice-commands";
import type { VoiceIntentProvider } from "@/hooks/use-settings";
import { useSessionStore } from "@/stores/session-store";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

/**
 * Client-side RPC for AI-powered voice intent routing.
 *
 * Resolves the active host's daemon client, packages the transcript +
 * command catalog, and asks the daemon to pick a tool via its configured
 * LLM provider. Failures (no host connected, daemon doesn't support the
 * feature, model didn't match, network error, etc.) are NEVER thrown —
 * they're returned as `{ ok: false, reason }` so the controller can fall
 * back to the local heuristic matcher with no exception path.
 */

export interface VoiceRouteRequest {
  transcript: string;
  provider: Exclude<VoiceIntentProvider, "heuristic">;
  /** null = let daemon pick its default model for this provider. */
  modelId: string | null;
  /** Trimmed-down command catalog the daemon presents as tools. */
  commands: SerializedVoiceCommand[];
  /** Soft timeout for the routing call (ms). Daemon should also enforce. */
  timeoutMs: number;
}

export interface SerializedVoiceCommand {
  name: string;
  description: string;
  /** JSON-Schema-ish shape — daemon translates to provider tool format. */
  parameters: unknown;
  examples: string[];
}

export type VoiceRouteFailureReason =
  | "daemon-not-implemented"
  | "feature-unavailable"
  | "no-active-host"
  | "no-match"
  | "timeout"
  | "rejected"
  | "transport-error";

export type VoiceRouteResult =
  | {
      ok: true;
      commandName: string;
      params: Record<string, unknown>;
      /** 0..1 confidence the model assigned, when available. */
      confidence: number;
    }
  | {
      ok: false;
      reason: VoiceRouteFailureReason;
      message?: string;
    };

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Compact a {@link VoiceCommand} into the wire-friendly shape the daemon
 * would translate into a provider tool definition. We can't send the raw
 * Zod schema (it's not JSON-serializable), so we approximate via a
 * description-only catalog. Phase 4 may switch this to `zod-to-json-schema`
 * for tighter argument typing.
 */
export function serializeCommandsForRouting(
  commands: ReadonlyArray<VoiceCommand>,
): SerializedVoiceCommand[] {
  return commands.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    // Conservative default — the daemon-side translator should be permissive
    // about params shape until phase-4 schema sync lands.
    parameters: { type: "object", additionalProperties: true },
    examples: cmd.examples.slice(0, 4),
  }));
}

/**
 * Resolve the daemon client to use for routing. Picks the first connected
 * host — voice routing is a global feature, not workspace-bound, so any
 * online daemon is fine. Returns null when no host is online.
 */
function resolveActiveDaemon(): {
  client: ReturnType<ReturnType<typeof getHostRuntimeStore>["getClient"]>;
  serverId: string;
} | null {
  const sessions = useSessionStore.getState().sessions;
  const store = getHostRuntimeStore();
  for (const serverId of Object.keys(sessions)) {
    const session = sessions[serverId];
    if (!session?.serverInfo) continue;
    const client = store.getClient(serverId);
    if (!client) continue;
    return { client, serverId };
  }
  return null;
}

/**
 * Live RPC. Returns ok:false (with a specific reason) on every failure path
 * so the controller can branch cleanly without a try/catch.
 */
export async function routeVoiceIntent(request: VoiceRouteRequest): Promise<VoiceRouteResult> {
  const active = resolveActiveDaemon();
  if (!active || !active.client) {
    return {
      ok: false,
      reason: "no-active-host",
      message: "No connected daemon to route voice intent.",
    };
  }

  // Old daemons don't advertise the feature; treat that as "fallback".
  const features =
    useSessionStore.getState().sessions[active.serverId]?.serverInfo?.features ?? null;
  if (!features?.voiceIntentRouting) {
    return {
      ok: false,
      reason: "feature-unavailable",
      message: "Daemon doesn't support voice intent routing yet.",
    };
  }

  try {
    const result = await active.client.routeVoiceIntent({
      transcript: request.transcript,
      provider: request.provider,
      modelId: request.modelId,
      commands: request.commands,
      timeoutMs: request.timeoutMs,
    });
    if (!result.matched || !result.commandName) {
      return {
        ok: false,
        reason: "no-match",
        message: result.error ?? "Model didn't pick a command.",
      };
    }
    return {
      ok: true,
      commandName: result.commandName,
      params: result.params,
      confidence: result.confidence ?? 0,
    };
  } catch (err) {
    return {
      ok: false,
      reason: "transport-error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export { DEFAULT_TIMEOUT_MS as VOICE_ROUTE_DEFAULT_TIMEOUT_MS };
