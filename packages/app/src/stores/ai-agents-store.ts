// Persisted store for user-created "conversation AI Agents".
//
// These are distinct from:
//   - Workspace agents (claude/codex/opencode running in a project cwd)
//   - Detected local services (OpenClaw / OpenWebUI / Hermes via
//     useLocalServices), which are auto-discovered and not stored here.
//
// Each entry is a lightweight assistant the user defines: a name, a
// description, a runtime (Claude Code / Codex / OpenCode CLI), a model,
// and an optional system prompt. The actual chat backend is deferred to
// a follow-up phase — this store only carries the configuration so the
// sidebar's AI Agent section can list them and a placeholder chat panel
// can render.
//
// Persistence pattern mirrors `onboarding-state-store.ts` (zustand
// `persist` + AsyncStorage). Keep schema additions backward-compatible
// per CLAUDE.md.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const AI_AGENTS_STORAGE_KEY = "@ottie:ai-agents";
const AI_AGENTS_STORE_VERSION = 1;

// Mirrors the daemon's `AGENT_PROVIDER_DEFINITIONS` ids
// (`packages/server/src/server/agent/provider-manifest.ts`).
// The set is intentionally a string union here — the daemon's schema is
// `z.string()` (open registry) but we narrow the UI to the providers we
// know how to label/render.
export type AiAgentRuntime = "claude" | "codex" | "copilot" | "opencode" | "gemini" | "pi";

export interface AiAgent {
  id: string;
  name: string;
  description: string;
  runtime: AiAgentRuntime;
  model: string;
  systemPrompt: string;
  createdAt: number;
}

export interface AiAgentDraft {
  name: string;
  description: string;
  runtime: AiAgentRuntime;
  model: string;
  systemPrompt: string;
}

export interface AiAgentsState {
  agents: AiAgent[];
}

export interface AiAgentsActions {
  create: (draft: AiAgentDraft) => AiAgent;
  update: (id: string, patch: Partial<AiAgentDraft>) => void;
  remove: (id: string) => void;
  reset: () => void;
}

const INITIAL_STATE: AiAgentsState = { agents: [] };

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `ai-agent_${crypto.randomUUID()}`;
  }
  return `ai-agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useAiAgentsStore = create<AiAgentsState & AiAgentsActions>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,
      create: (draft) => {
        const agent: AiAgent = {
          id: makeId(),
          name: draft.name.trim(),
          description: draft.description.trim(),
          runtime: draft.runtime,
          model: draft.model.trim(),
          systemPrompt: draft.systemPrompt.trim(),
          createdAt: Date.now(),
        };
        set((state) => ({ agents: [...state.agents, agent] }));
        return agent;
      },
      update: (id, patch) => {
        set((state) => ({
          agents: state.agents.map((agent) =>
            agent.id === id
              ? {
                  ...agent,
                  ...(patch.name !== undefined ? { name: patch.name.trim() } : null),
                  ...(patch.description !== undefined
                    ? { description: patch.description.trim() }
                    : null),
                  ...(patch.runtime !== undefined ? { runtime: patch.runtime } : null),
                  ...(patch.model !== undefined ? { model: patch.model.trim() } : null),
                  ...(patch.systemPrompt !== undefined
                    ? { systemPrompt: patch.systemPrompt.trim() }
                    : null),
                }
              : agent,
          ),
        }));
      },
      remove: (id) => {
        set((state) => ({ agents: state.agents.filter((agent) => agent.id !== id) }));
      },
      reset: () => {
        set(INITIAL_STATE);
        void get();
      },
    }),
    {
      name: AI_AGENTS_STORAGE_KEY,
      version: AI_AGENTS_STORE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ agents: state.agents }),
    },
  ),
);
