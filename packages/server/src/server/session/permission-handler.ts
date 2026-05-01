import { v4 as uuidv4 } from "uuid";
import type { Logger } from "pino";

import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentPermissionResponse, AgentPromptInput } from "../agent/agent-sdk-types.js";
import type { SessionOutboundMessage } from "../../shared/messages.js";

export interface PermissionHandlerDeps {
  agentManager: AgentManager;
  emit: (msg: SessionOutboundMessage) => void;
  logger: Logger;
  /**
   * Hook to start a follow-up agent turn when AgentManager.respondToPermission
   * returns a `followUpPrompt`. Lifted verbatim from the legacy
   * `Session.startAgentStream(agentId, prompt)` invocation in session.ts.
   */
  startFollowUpTurn: (agentId: string, prompt: AgentPromptInput) => void;
}

/**
 * Carve C-3 (plan 01-04) — owns the `agent_permission_response` code path that
 * lived inline at `session.ts:4135-4170`. The body is byte-identical to the
 * legacy method; only the `this.X` references were rebound to the injected
 * dependency object so the handler is independently testable.
 *
 * Behavior contract (MUST stay byte-identical to the legacy path):
 *   - Logs debug on entry and on success.
 *   - Calls `agentManager.respondToPermission(agentId, requestId, response)`.
 *   - If `result?.followUpPrompt` is set, invokes `startFollowUpTurn(agentId, prompt)`.
 *   - On error: logs error, emits `activity_log` envelope, **re-throws** so the
 *     outer Session.handleMessage error envelope can emit the canonical
 *     `rpc_error` (preserves the existing client-visible failure shape).
 *
 * Phase 1 dispatch is wired behind `OTTIE_USE_PERMISSION_HANDLER`; legacy
 * fallthrough preserved until Phase 5 cleanup.
 */
export class PermissionHandler {
  constructor(private readonly deps: PermissionHandlerDeps) {}

  async handleResponse(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<void> {
    const { agentManager, emit, logger, startFollowUpTurn } = this.deps;
    logger.debug(
      { agentId, requestId },
      `Handling permission response for agent ${agentId}, request ${requestId}`,
    );
    try {
      const result = await agentManager.respondToPermission(agentId, requestId, response);
      logger.debug({ agentId }, `Permission response forwarded to agent ${agentId}`);
      if (result?.followUpPrompt) {
        logger.debug(
          { agentId },
          "Permission response requires follow-up turn, starting agent stream",
        );
        startFollowUpTurn(agentId, result.followUpPrompt);
      }
    } catch (error) {
      logger.error({ err: error, agentId, requestId }, "Failed to respond to permission");
      emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to respond to permission: ${(error as Error).message}`,
        },
      });
      throw error;
    }
  }
}
