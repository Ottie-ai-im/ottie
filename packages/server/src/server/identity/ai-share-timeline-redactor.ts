import type { AgentManagerEvent } from "../agent/agent-manager.js";
import type { AiShareTimelineEntry } from "./ai-share-types.js";

/**
 * Phase 4 v2/d — owner-side redactor that decides which AgentManager
 * events get forwarded to the friend's shared-agent view, and which
 * are dropped.
 *
 * Per docs/MULTI-USER-COLLABORATION-DESIGN.md §7: "Bob sees prompt +
 * response only; Alice keeps tool-call details to herself." The doc
 * explicitly lists what the friend does NOT see in Phases 1–4:
 *
 *   - Tool call inputs/outputs (file paths, raw file contents,
 *     shell command outputs)
 *   - Other agents on the owner's machine
 *   - The owner's other conversations or other peers
 *
 * Returning `null` here means "do not forward". Returning an entry
 * means "forward this redacted projection". A relay-side adversary
 * cannot bypass the redactor — it runs on the owner's daemon BEFORE
 * the envelope is signed + ciphertext-wrapped + sent.
 *
 * `agentId` is passed in by the caller because `agent_stream` events
 * carry it but `agent_state` does not at the event-shape level — the
 * caller already knows which agent it subscribed to.
 */
export function redactAgentEventForShare(
  event: AgentManagerEvent,
  context: { agentId: string; lastPromptIdForUserMessage?: string },
): AiShareTimelineEntry | null {
  // `agent_state` is just "the projection of this agent changed" — too
  // chatty + leaks fields like cwd, runtimeInfo, labels we don't want
  // to forward. The friend's status pill comes from turn_started /
  // turn_completed below.
  if (event.type === "agent_state") return null;

  // Defensive: only forward stream events that belong to the agent the
  // caller is subscribed for. The bridge already filters this, but we
  // re-check here so a future bug elsewhere in the pipeline can't leak
  // events from a non-shared agent.
  if (event.type !== "agent_stream") return null;
  if (event.agentId !== context.agentId) return null;

  const inner = event.event;
  switch (inner.type) {
    case "turn_started":
      return { kind: "turn_started" };
    case "turn_completed":
      return { kind: "turn_completed" };
    case "turn_failed":
      return { kind: "error", message: inner.error };
    case "turn_canceled":
      // Surface as an error so the friend's UI gets unstuck.
      return { kind: "error", message: `canceled: ${inner.reason}` };
    case "timeline": {
      const item = inner.item;
      switch (item.type) {
        case "user_message":
          return {
            kind: "user_message",
            text: item.text,
            ...(context.lastPromptIdForUserMessage !== undefined
              ? { promptId: context.lastPromptIdForUserMessage }
              : {}),
          };
        case "assistant_message":
          return { kind: "assistant_message", text: item.text };
        case "reasoning":
          return { kind: "reasoning", text: item.text };
        case "error":
          return { kind: "error", message: item.message };
        // Phase 4 redaction: tool calls, todos, and compaction items
        // never leave the owner's daemon. They could leak file paths,
        // shell command outputs, or planning state the owner's
        // workspace doesn't want exposed.
        default:
          return null;
      }
    }
    // usage_updated: token-count / cost. v3 may add a redacted "usage"
    // entry once limits enforcement lands; for now, keep it owner-only.
    case "usage_updated":
      return null;
    // permission_requested / permission_resolved are owner-only — the
    // §7 design has Alice approving each tool call, friend does not
    // see the dialog. permission_resolved often carries the tool input
    // in `updatedInput`, which we explicitly want to keep on Alice's
    // side.
    case "permission_requested":
    case "permission_resolved":
      return null;
    case "thread_started":
      // Owner-internal session bootstrap; nothing useful for the
      // friend's surface.
      return null;
    case "attention_required":
      // The owner's UI uses this for the bell/notification dot; the
      // friend's surface doesn't have an equivalent. Drop.
      return null;
    default:
      return null;
  }
}
