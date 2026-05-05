import type { Logger } from "pino";
import { homedir } from "node:os";

import type { AgentCapabilityFlags, AgentMode } from "../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../provider-launch-config.js";
import { findExecutable } from "../../../utils/executable.js";
import { ACPAgentClient } from "./acp-agent.js";
import {
  formatDiagnosticStatus,
  formatProviderDiagnostic,
  formatProviderDiagnosticError,
  resolveBinaryVersion,
  toDiagnosticErrorMessage,
} from "./diagnostic-utils.js";

const GEMINI_CLI_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
};

const GEMINI_CLI_MODES: AgentMode[] = [
  {
    id: "https://agentclientprotocol.com/protocol/session-modes#agent",
    label: "Agent",
    description: "Default agent mode for conversational interactions",
  },
  {
    id: "https://agentclientprotocol.com/protocol/session-modes#plan",
    label: "Plan",
    description: "Plan mode for creating and executing multi-step plans",
  },
];

interface GeminiCliACPAgentClientOptions {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
}

/**
 * Wraps the user's `gemini` CLI in ACP mode (`gemini --experimental-acp`).
 * Reuses the OAuth credentials cached at `~/.gemini/oauth_creds.json` from a
 * prior `gemini` login in the user's terminal — no API key required.
 *
 * Distinct from the `gemini` provider (which wraps `pi-coding-agent`). This
 * one is selectable as a separate "Gemini CLI" entry so users who already
 * use `gemini` from their terminal can pick it directly.
 */
export class GeminiCliACPAgentClient extends ACPAgentClient {
  constructor(options: GeminiCliACPAgentClientOptions) {
    super({
      provider: "gemini-cli",
      logger: options.logger,
      runtimeSettings: options.runtimeSettings,
      defaultCommand: ["gemini", "--experimental-acp"],
      defaultModes: GEMINI_CLI_MODES,
      capabilities: GEMINI_CLI_CAPABILITIES,
    });
  }

  override async isAvailable(): Promise<boolean> {
    return super.isAvailable();
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    try {
      const available = await this.isAvailable();
      const resolvedBinary = await findExecutable("gemini");
      let modelsValue = "Not checked";
      let status = formatDiagnosticStatus(available);

      if (available) {
        try {
          const models = await this.listModels({ cwd: homedir(), force: false });
          modelsValue = String(models.length);
        } catch (error) {
          modelsValue = `Error - ${toDiagnosticErrorMessage(error)}`;
          status = formatDiagnosticStatus(available, {
            source: "model fetch",
            cause: error,
          });
        }

        if (!modelsValue.startsWith("Error -")) {
          try {
            await this.listModes({ cwd: homedir(), force: false });
          } catch (error) {
            status = formatDiagnosticStatus(available, {
              source: "mode fetch",
              cause: error,
            });
          }
        }
      }

      return {
        diagnostic: formatProviderDiagnostic("Gemini CLI", [
          {
            label: "Binary",
            value: resolvedBinary ?? "not found",
          },
          {
            label: "Version",
            value: resolvedBinary ? await resolveBinaryVersion(resolvedBinary) : "unknown",
          },
          { label: "Models", value: modelsValue },
          { label: "Status", value: status },
        ]),
      };
    } catch (error) {
      return {
        diagnostic: formatProviderDiagnosticError("Gemini CLI", error),
      };
    }
  }
}
