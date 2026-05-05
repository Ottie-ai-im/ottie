import { describe, expect, test, vi } from "vitest";
import pino from "pino";
import type { Api, Model } from "@mariozechner/pi-ai";
import { GeminiAgentClient } from "./gemini-agent.js";

function createPiModel(provider: string, id: string): Model<Api> {
  return {
    provider,
    id,
    name: id,
    reasoning: true,
  } as Model<Api>;
}

describe("GeminiAgentClient", () => {
  test("lists only Google/Gemini models", async () => {
    const client = new GeminiAgentClient({
      logger: pino({ level: "silent" }),
    });
    const registry = {
      find: vi.fn(),
      getAll: vi.fn(() => []),
      getAvailable: vi.fn(() => [
        createPiModel("google", "gemini-1.5-pro"),
        createPiModel("google", "gemini-flash"),
        createPiModel("anthropic", "claude-3-5-sonnet"),
        createPiModel("openai", "gpt-4o"),
      ]),
    };

    // Inject mock registry
    (client as any).modelRegistry = registry;

    // We also need to mock getSessionServices to return this registry
    vi.spyOn(client as any, "getSessionServices").mockResolvedValue({
      modelRegistry: registry,
    });

    const models = await client.listModels({ cwd: "/tmp/ottie-gemini-test", force: false });

    expect(models.length).toBe(2);
    expect(models.every((m) => m.id.startsWith("google/gemini"))).toBe(true);
    expect(models[0].provider).toBe("gemini");
  });

  test("isAvailable checks for GEMINI_API_KEY", async () => {
    const client = new GeminiAgentClient({
      logger: pino({ level: "silent" }),
    });

    const originalEnv = process.env.GEMINI_API_KEY;
    try {
      process.env.GEMINI_API_KEY = "test-key";
      expect(await client.isAvailable()).toBe(true);

      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      expect(await client.isAvailable()).toBe(false);
    } finally {
      process.env.GEMINI_API_KEY = originalEnv;
    }
  });
});
