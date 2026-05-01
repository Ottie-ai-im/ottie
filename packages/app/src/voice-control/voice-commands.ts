import { z } from "zod";
import { router } from "expo-router";
import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore } from "@/stores/session-store";
import { getNavigationActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  buildHostAgentDetailRoute,
  buildHostWorkspaceRoute,
  buildSettingsRoute,
} from "@/utils/host-routes";
import { getVoiceCommandBridge } from "@/voice-control/voice-command-bridge";
import { actionRegistry } from "@/actions/registry";
// Side-effect import: registers the 6 NAT-01 reference actions on module
// load so any voice command that wants to delegate to ActionRegistry can
// find the canonical handler. Plan 02a Task 2 — the registry is the single
// source of truth across voice / keyboard / cmdk / menu surfaces.
import { registerBuiltInActions } from "@/actions/built-in-actions";
// Plan 02c — register the 8 chat-row context-menu + 4 add-menu ActionIds on
// module load. Same idempotent pattern as `built-in-actions`. Voice + cmdk
// + long-press menus all dispatch through actionRegistry.
import { registerChatRowActions } from "@/actions/chat-row-actions";
// Plan 02d — register the 6 settings deep-link ActionIds (5 D-09 buckets +
// the Labs sub-page) so cmd-K palette can satisfy SET-03 (≤2 taps to any
// settings surface).
import { registerSettingsActions } from "@/actions/settings-actions";

// Eager-register on module load; idempotent if already called.
registerBuiltInActions();
registerChatRowActions();
registerSettingsActions();

/**
 * Voice command registry.
 *
 * Each command is a narrow, app-owned action callable by the voice runtime.
 * Design contract:
 *   - Schema-validated input (Zod) — rejects bad calls before execution
 *   - Pure data side-effects: handlers only call existing stores / router.
 *     Never bypass safety checks (permissions, schema), never invent flows
 *     not already reachable from the manual UI.
 *   - Examples: short utterances the intent router will train on. Keep them
 *     phrased like real users speak, not like API descriptions.
 *
 * The voice runtime (next phase) reads this registry to:
 *   1. Build a system prompt for the intent classifier
 *   2. Validate model output against the schema
 *   3. Dispatch to the matched handler with parsed arguments
 *
 * Adding a new command? Define schema + handler + 3+ examples, then export it
 * from {@link VOICE_COMMANDS} below.
 */

export interface CommandResult {
  ok: boolean;
  /** Operator-facing message rendered in the PTT pill / floating orb log. */
  message?: string;
  /** Optional payload for chained commands (e.g. find_workspace returns a workspaceId). */
  data?: unknown;
}

// TParams stays invariant (it appears both in `schema` output and `handler`
// input, so neither `in` nor `out` is sound). The registry array erases the
// per-command shape via `as unknown as VoiceCommand[]` below — consumers
// must run `cmd.schema.parse(rawInput)` before invoking the handler.
export interface VoiceCommand<TParams = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<TParams>;
  examples: string[];
  handler: (params: TParams) => Promise<CommandResult> | CommandResult;
}

/** Helper: build a typed command without losing inference. */
function defineCommand<TSchema extends z.ZodType>(
  name: string,
  config: {
    description: string;
    schema: TSchema;
    examples: string[];
    handler: (params: z.infer<TSchema>) => Promise<CommandResult> | CommandResult;
  },
): VoiceCommand<z.infer<TSchema>> {
  return { name, ...config };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const openFileExplorer = defineCommand("open_file_explorer", {
  description: "Open the file explorer drawer for the current workspace.",
  schema: z.object({}).strict(),
  examples: [
    "open the file explorer",
    "show me the files",
    "open files",
    "open file",
    "open the file panel",
    "open the files panel",
    "show file panel",
    "show files",
    "show file",
    "files",
    "打开文件",
    "显示文件",
    "打开文件浏览器",
  ],
  handler: () => {
    const selection = getNavigationActiveWorkspaceSelection();
    if (!selection) {
      return { ok: false, message: "No active workspace" };
    }
    const session = useSessionStore.getState().sessions[selection.serverId];
    const workspace = session?.workspaces.get(selection.workspaceId);
    if (!workspace) {
      return { ok: false, message: "Active workspace not loaded" };
    }
    usePanelStore.getState().openFileExplorerForCheckout({
      isCompact: false,
      checkout: {
        serverId: selection.serverId,
        cwd: workspace.workspaceDirectory,
        isGit: workspace.projectKind === "git",
      },
    });
    return { ok: true, message: "File explorer opened" };
  },
});

const closeFileExplorer = defineCommand("close_file_explorer", {
  description: "Close the file explorer drawer.",
  schema: z.object({}).strict(),
  examples: [
    "close files",
    "close file",
    "close file panel",
    "hide files",
    "hide file panel",
    "close the explorer",
    "shut the files",
    "关闭文件",
    "隐藏文件",
    "关掉文件",
  ],
  handler: () => {
    usePanelStore.getState().closeDesktopFileExplorer();
    return { ok: true, message: "File explorer closed" };
  },
});

const toggleFocusMode = defineCommand("toggle_focus_mode", {
  description: "Toggle distraction-free focus mode (hides chrome).",
  schema: z.object({}).strict(),
  examples: ["focus mode", "enter focus mode", "hide chrome", "distraction free"],
  handler: () => {
    usePanelStore.getState().toggleFocusMode();
    return { ok: true, message: "Focus mode toggled" };
  },
});

const findWorkspace = defineCommand("find_workspace", {
  description:
    "Search loaded workspaces for a fuzzy match of the user's query. Returns the first match.",
  schema: z
    .object({
      query: z.string().min(1, "query is required"),
    })
    .strict(),
  examples: [
    "find the auth refactor project",
    "search for the marketing site repo",
    "where is my notes project",
  ],
  handler: ({ query }) => {
    const needle = query.toLowerCase();
    const sessions = useSessionStore.getState().sessions;
    for (const serverId of Object.keys(sessions)) {
      const ws = sessions[serverId]?.workspaces;
      if (!ws) continue;
      for (const workspace of ws.values()) {
        const candidates = [
          workspace.workspaceDirectory,
          workspace.name,
          workspace.projectDisplayName,
          workspace.id,
        ]
          .filter((c): c is string => typeof c === "string")
          .map((c) => c.toLowerCase());
        if (candidates.some((c) => c.includes(needle))) {
          return {
            ok: true,
            message: `Matched ${workspace.projectDisplayName ?? workspace.workspaceDirectory}`,
            data: {
              serverId,
              workspaceId: workspace.id,
              cwd: workspace.workspaceDirectory,
            },
          };
        }
      }
    }
    return { ok: false, message: `No workspace matched "${query}"` };
  },
});

const switchToWorkspace = defineCommand("switch_to_workspace", {
  description:
    "Navigate to a workspace's session list. Pair with find_workspace to resolve a query first.",
  schema: z
    .object({
      serverId: z.string().min(1),
      workspaceId: z.string().min(1),
    })
    .strict(),
  examples: ["go to that project", "open the matched workspace", "switch over"],
  handler: async ({ serverId, workspaceId }) => {
    // Route through ActionRegistry so voice / keyboard / cmdk / menu all
    // share a single workspace-switch implementation. Falls back to direct
    // navigation if registry dispatch fails (older daemons / missing
    // registration).
    const dispatched = await actionRegistry.dispatch("workspace.switch", {
      serverId,
      workspaceId,
    });
    if (!dispatched) {
      router.push(buildHostWorkspaceRoute(serverId, workspaceId));
    }
    return { ok: true, message: "Switched workspace" };
  },
});

const switchToAgent = defineCommand("switch_to_agent", {
  description: "Navigate to a specific agent's chat by id.",
  schema: z
    .object({
      serverId: z.string().min(1),
      agentId: z.string().min(1),
    })
    .strict(),
  examples: ["switch to that agent", "open the claude session", "go to agent"],
  handler: ({ serverId, agentId }) => {
    router.push(buildHostAgentDetailRoute(serverId, agentId));
    return { ok: true, message: "Switched agent" };
  },
});

const sendToActiveAgent = defineCommand("send_to_active_agent", {
  description: "Send a text message to the currently active agent's composer.",
  schema: z
    .object({
      text: z.string().min(1),
    })
    .strict(),
  examples: [
    "send hello doing a test",
    "tell it to list the files",
    "say good morning",
    "ask about the latest commit",
  ],
  // Bridge handler — daemon client + active-agent resolution lives in the
  // React tree (see VoiceCommandBridgeProvider). The bridge wraps both with
  // a stable async API so this command stays simple.
  handler: ({ text }) => getVoiceCommandBridge().sendToActiveAgent(text),
});

const interruptActiveAgent = defineCommand("interrupt_active_agent", {
  description: "Interrupt the currently running agent (equivalent to clicking stop).",
  schema: z.object({}).strict(),
  examples: ["stop", "cancel that", "interrupt", "stop the agent"],
  handler: () => getVoiceCommandBridge().interruptActiveAgent(),
});

const listAgents = defineCommand("list_agents", {
  description: "List currently visible agents across all servers.",
  schema: z.object({}).strict(),
  examples: ["which agents are running", "list my agents", "what's open", "show all sessions"],
  handler: () => {
    const sessions = useSessionStore.getState().sessions;
    const agents: Array<{ serverId: string; agentId: string; title: string; status: string }> = [];
    for (const serverId of Object.keys(sessions)) {
      const session = sessions[serverId];
      if (!session) continue;
      for (const agent of session.agents.values()) {
        agents.push({
          serverId,
          agentId: agent.id,
          title: agent.title ?? "Untitled",
          status: agent.status ?? "unknown",
        });
      }
    }
    return {
      ok: true,
      message: agents.length === 0 ? "No agents running" : `${agents.length} agents`,
      data: agents,
    };
  },
});

const openSettings = defineCommand("open_settings", {
  description: "Navigate to the settings screen.",
  schema: z.object({}).strict(),
  examples: ["open settings", "show preferences", "go to settings"],
  handler: async () => {
    // Route through ActionRegistry so the same intent fires from voice,
    // cmdk palette, and the desktop kbd shortcut.
    const dispatched = await actionRegistry.dispatch("settings.open", {});
    if (!dispatched) {
      router.push(buildSettingsRoute());
    }
    return { ok: true, message: "Opened settings" };
  },
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Public registry. Order matters only for picker / palette display — the
 * voice runtime selects by name, not position.
 *
 * Cast erases the per-command param shape into a uniform `VoiceCommand` so
 * consumers iterate without per-element generics. Callers MUST validate input
 * via `cmd.schema.parse(...)` before invoking `cmd.handler(...)`. Zod's parse
 * narrows `unknown` → typed at runtime, restoring safety.
 */
export const VOICE_COMMANDS: VoiceCommand[] = [
  openFileExplorer,
  closeFileExplorer,
  toggleFocusMode,
  findWorkspace,
  switchToWorkspace,
  switchToAgent,
  sendToActiveAgent,
  interruptActiveAgent,
  listAgents,
  openSettings,
] as unknown as VoiceCommand[];

export function getCommandByName(name: string): VoiceCommand | undefined {
  return VOICE_COMMANDS.find((cmd) => cmd.name === name);
}

/** Lightweight client-side filter for a manual command palette UI. */
export function searchCommands(query: string): VoiceCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return VOICE_COMMANDS;
  return VOICE_COMMANDS.filter((cmd) => {
    if (cmd.name.includes(needle)) return true;
    if (cmd.description.toLowerCase().includes(needle)) return true;
    return cmd.examples.some((ex) => ex.toLowerCase().includes(needle));
  });
}
