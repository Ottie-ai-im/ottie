import { describe, expect, it } from "vitest";
import pino from "pino";
import { routeVoiceIntent } from "./voice-intent-routing.js";

const silentLogger = pino({ enabled: false });

/**
 * Failure-path coverage that does not require a network or auth.
 *
 * The Claude success path goes through `claude-agent-sdk`'s `query()`, which
 * spawns a Claude Code subprocess and uses the user's actual auth pipeline.
 * Exercising that end-to-end belongs in `test:integration:real` (gated on
 * the developer having `claude` logged in or `ANTHROPIC_API_KEY` set), not
 * in the unit suite — this file covers the deterministic paths where the
 * function rejects before touching the SDK.
 */
describe("routeVoiceIntent — deterministic failure paths", () => {
  it("rejects an empty transcript", async () => {
    const result = await routeVoiceIntent({
      request: {
        transcript: "   ",
        provider: "claude",
        modelId: null,
        commands: [{ name: "noop", description: "do nothing", examples: [] }],
        timeoutMs: undefined,
      },
      logger: silentLogger,
    });
    expect(result.matched).toBe(false);
    expect(result.commandName).toBeNull();
    expect(result.error).toContain("Empty transcript");
  });

  it("returns 'not implemented' for codex / opencode providers", async () => {
    for (const provider of ["codex", "opencode"] as const) {
      const result = await routeVoiceIntent({
        request: {
          transcript: "open files",
          provider,
          modelId: null,
          commands: [
            {
              name: "open_file_explorer",
              description: "open the file explorer",
              examples: [],
            },
          ],
          timeoutMs: undefined,
        },
        logger: silentLogger,
      });
      expect(result.matched).toBe(false);
      expect(result.commandName).toBeNull();
      expect(result.error).toContain("not implemented");
    }
  });
});
