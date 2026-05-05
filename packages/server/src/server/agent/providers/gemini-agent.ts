import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Logger } from "pino";
import {
  ModelRegistry,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionServices,
  type AgentSession as PiAgentSession,
  type AgentSessionServices,
  type BashToolInput,
  type EditToolInput,
  type FindToolInput,
  type GrepToolInput,
  type LsToolInput,
  type ReadToolInput,
  type WriteToolInput,
} from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";

import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentLaunchContext,
  AgentMetadata,
  AgentMode,
  AgentModelDefinition,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentSlashCommand,
  AgentStreamEvent,
  AgentTimelineItem,
  ListModesOptions,
  ListModelsOptions,
} from "../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../provider-launch-config.js";
import { findExecutable, isCommandAvailable } from "../../../utils/executable.js";
import {
  formatDiagnosticStatus,
  formatProviderDiagnostic,
  formatProviderDiagnosticError,
  resolveBinaryVersion,
  toDiagnosticErrorMessage,
} from "./diagnostic-utils.js";
import { 
  PiDirectAgentSession, 
  transformPiModels, 
} from "./pi-direct-agent.js";

const GEMINI_PROVIDER = "gemini";
const DEFAULT_GEMINI_THINKING_LEVEL: ThinkingLevel = "medium";
const PI_BINARY_COMMAND = process.env.PI_COMMAND ?? process.env.PI_ACP_PI_COMMAND ?? "pi";

const GEMINI_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: false,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
};

const GEMINI_THINKING_OPTIONS: ReadonlyArray<{
  id: ThinkingLevel;
  label: string;
  description: string;
  isDefault?: boolean;
}> = [
  { id: "off", label: "Off", description: "No extra reasoning" },
  { id: "minimal", label: "Minimal", description: "Light reasoning" },
  { id: "low", label: "Low", description: "Faster reasoning" },
  { id: "medium", label: "Medium", description: "Balanced reasoning", isDefault: true },
  { id: "high", label: "High", description: "Deeper reasoning" },
  { id: "xhigh", label: "XHigh", description: "Maximum reasoning" },
] as const;

function mapThinkingOption(option: (typeof GEMINI_THINKING_OPTIONS)[number]) {
  const mappedOption = {
    id: option.id,
    label: option.label,
    description: option.description,
  };
  if (option.isDefault) {
    return {
      ...mappedOption,
      isDefault: true,
    };
  }
  return mappedOption;
}

function isPiThinkingLevel(value: string | null | undefined): value is ThinkingLevel {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

function normalizePiThinkingOption(value: string | null | undefined): ThinkingLevel | null {
  if (!value) {
    return null;
  }
  return isPiThinkingLevel(value) ? value : null;
}

interface GeminiAgentClientOptions {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
}

interface PiModelReference {
  provider?: string;
  id: string;
}

function parseModelReference(modelId: string | null): PiModelReference | null {
  if (!modelId) {
    return null;
  }
  if (modelId.includes("/")) {
    const [provider, ...rest] = modelId.split("/");
    const id = rest.join("/");
    if (provider && id) {
      return { provider, id };
    }
  }
  return { id: modelId };
}

function findModelInRegistry(
  registry: ModelRegistry,
  parsedReference: PiModelReference,
): Model<Api> | undefined {
  if (parsedReference.provider) {
    return registry.find(parsedReference.provider, parsedReference.id);
  }

  return registry.getAll().find((entry) => {
    if (entry.id === parsedReference.id) {
      return true;
    }
    return `${entry.provider}/${entry.id}` === parsedReference.id;
  });
}

function applySystemPrompt(session: PiAgentSession, systemPrompt: string | undefined): void {
  const trimmed = systemPrompt?.trim();
  if (!trimmed) {
    return;
  }

  const sessionObject = session as any;
  const baseSystemPrompt = Reflect.get(sessionObject, "_baseSystemPrompt");
  const currentBase =
    typeof baseSystemPrompt === "string" ? baseSystemPrompt : session.agent.state.systemPrompt;
  const combinedPrompt = currentBase ? `${currentBase}\n\n${trimmed}` : trimmed;
  Reflect.set(sessionObject, "_baseSystemPrompt", combinedPrompt);
  session.agent.state.systemPrompt = combinedPrompt;
}

export class GeminiAgentClient implements AgentClient {
  readonly provider = GEMINI_PROVIDER;
  readonly capabilities = GEMINI_CAPABILITIES;

  private readonly logger: Logger;
  private readonly runtimeSettings?: ProviderRuntimeSettings;
  private modelRegistry: ModelRegistry | null = null;

  constructor(options: GeminiAgentClientOptions) {
    this.logger = options.logger;
    this.runtimeSettings = options.runtimeSettings;
  }

  private async getSessionServices(cwd: string): Promise<AgentSessionServices> {
    return createAgentSessionServices({
      cwd,
      ...(this.modelRegistry ? { modelRegistry: this.modelRegistry } : {}),
    });
  }

  private resolveConfiguredModel(
    registry: ModelRegistry,
    modelId: string | null | undefined,
  ): Model<Api> | undefined {
    const parsedReference = parseModelReference(modelId ?? null);
    if (!parsedReference) {
      return undefined;
    }

    return findModelInRegistry(registry, parsedReference);
  }

  async createSession(
    config: AgentSessionConfig,
    _launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const thinkingLevel =
      normalizePiThinkingOption(config.thinkingOptionId) ?? DEFAULT_GEMINI_THINKING_LEVEL;
    const services = await this.getSessionServices(config.cwd);
    const model = this.resolveConfiguredModel(services.modelRegistry, config.model);

    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: SessionManager.create(config.cwd),
      thinkingLevel,
      ...(model ? { model } : {}),
    });
    await session.bindExtensions({});
    applySystemPrompt(session, config.systemPrompt);
    return new PiDirectAgentSession(session, services.modelRegistry, config);
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    _launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const sessionFile = handle.nativeHandle;
    if (!sessionFile) {
      throw new Error("Gemini resume requires a native session file handle");
    }

    const resumedManager = SessionManager.open(sessionFile);
    const cwd = overrides?.cwd ?? resumedManager.getCwd();
    const mergedConfig: AgentSessionConfig = {
      provider: GEMINI_PROVIDER,
      cwd,
      model: overrides?.model,
      thinkingOptionId: overrides?.thinkingOptionId,
      systemPrompt: overrides?.systemPrompt,
      title: overrides?.title,
    };

    const services = await this.getSessionServices(mergedConfig.cwd);
    const model = this.resolveConfiguredModel(services.modelRegistry, mergedConfig.model);
    const thinkingLevel = normalizePiThinkingOption(mergedConfig.thinkingOptionId);
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: resumedManager,
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    });
    await session.bindExtensions({});
    applySystemPrompt(session, mergedConfig.systemPrompt);
    return new PiDirectAgentSession(session, services.modelRegistry, mergedConfig);
  }

  async listModels(options: ListModelsOptions): Promise<AgentModelDefinition[]> {
    const services = await this.getSessionServices(options.cwd);
    const allModels = services.modelRegistry.getAvailable();
    
    // Filter for Google/Gemini models
    const googleModels = allModels.filter(m => 
      m.provider === "google" || 
      m.id.toLowerCase().includes("gemini")
    );

    const models = googleModels.map((model) => ({
      provider: GEMINI_PROVIDER,
      id: `${model.provider}/${model.id}`,
      label: `${model.provider}/${model.name}`,
      description: `${model.provider}/${model.id}`,
      metadata: {
        provider: model.provider,
        modelId: model.id,
      } satisfies AgentMetadata,
      thinkingOptions: model.reasoning ? GEMINI_THINKING_OPTIONS.map(mapThinkingOption) : undefined,
      defaultThinkingOptionId: model.reasoning ? DEFAULT_GEMINI_THINKING_LEVEL : undefined,
    }));

    return transformPiModels(models);
  }

  async listModes(_options: ListModesOptions): Promise<AgentMode[]> {
    return [];
  }

  async isAvailable(): Promise<boolean> {
    const hasApiKey = 
      Boolean(process.env.GEMINI_API_KEY) ||
      Boolean(process.env.GOOGLE_API_KEY) ||
      Boolean(process.env.OPENROUTER_API_KEY);
    
    if (hasApiKey) {
      return true;
    }

    // Check for Google Application Default Credentials (ADC)
    const adcPath = join(homedir(), ".config", "gcloud", "application_default_credentials.json");
    if (existsSync(adcPath)) {
      return true;
    }

    // Check for Pi's own auth file as a fallback
    if (existsSync(join(homedir(), ".pi", "agent", "auth.json"))) {
      return true;
    }

    // Check for google-gemini-cli config
    const geminiCliConfig = join(homedir(), ".config", "google-gemini-cli", "config.json");
    if (existsSync(geminiCliConfig)) {
      return true;
    }

    return false;
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    try {
      const available = await this.isAvailable();
      const binary = await findExecutable(PI_BINARY_COMMAND);
      const version = binary ? await resolveBinaryVersion(binary) : "unknown";
      
      const adcPath = join(homedir(), ".config", "gcloud", "application_default_credentials.json");
      const hasAdc = existsSync(adcPath);
      const authConfigPath = join(homedir(), ".pi", "agent", "auth.json");
      const hasPiAuth = existsSync(authConfigPath);
      const geminiCliConfig = join(homedir(), ".config", "google-gemini-cli", "config.json");
      const hasGeminiCliAuth = existsSync(geminiCliConfig);

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
      }

      return {
        diagnostic: formatProviderDiagnostic("Gemini", [
          { label: "Internal Engine", value: "pi-coding-agent" },
          { label: "Helper Binary", value: binary ?? "not found" },
          { label: "Version", value: version },
          {
            label: "GEMINI_API_KEY",
            value: process.env.GEMINI_API_KEY ? "set" : "not set",
          },
          {
            label: "GOOGLE_API_KEY",
            value: process.env.GOOGLE_API_KEY ? "set" : "not set",
          },
          {
            label: "Google ADC (~/.config/gcloud/adc.json)",
            value: hasAdc ? "found" : "not found",
          },
          {
            label: "Gemini CLI (~/.config/google-gemini-cli/config.json)",
            value: hasGeminiCliAuth ? "found" : "not found",
          },
          {
            label: "Pi Auth (~/.pi/agent/auth.json)",
            value: hasPiAuth ? "found" : "not found",
          },
          { label: "Models", value: modelsValue },
          { label: "Status", value: status },
        ]),
      };
    } catch (error) {
      return {
        diagnostic: formatProviderDiagnosticError("Gemini", error),
      };
    }
  }
}
