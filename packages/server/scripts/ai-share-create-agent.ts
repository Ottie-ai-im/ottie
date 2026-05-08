#!/usr/bin/env tsx
/**
 * Helper: create a fresh Claude agent on alice's daemon (port 6868)
 * so `chatP2pAiShareListShareableAgents` returns at least one row.
 *
 * Used between daemon restarts when the previously shared agent has
 * `lifecycle: "closed"` on disk and gets filtered out by bootstrap's
 * shareable-agents predicate.
 *
 *   cd packages/server && npx tsx scripts/ai-share-create-agent.ts
 */
import { WebSocket } from "ws";
import { DaemonClient } from "../src/client/daemon-client.js";

async function main(): Promise<void> {
  const client = new DaemonClient({
    url: "ws://localhost:6868/ws",
    clientId: `sim-create-agent-${Date.now()}`,
    clientType: "cli",
    appVersion: "0.0.0-sim",
    connectTimeoutMs: 10_000,
    webSocketFactory: (url: string, config?: { headers?: Record<string, string> }) => {
      const ws = new WebSocket(url, { headers: config?.headers });
      return ws as unknown as ReturnType<
        NonNullable<ConstructorParameters<typeof DaemonClient>[0]["webSocketFactory"]>
      >;
    },
    reconnect: { enabled: false },
  } as unknown as ConstructorParameters<typeof DaemonClient>[0]);
  await client.connect();

  const snap = await client.createAgent({
    config: {
      provider: "claude",
      cwd: "/tmp/ottie-share-test",
      title: "share-test-agent",
      modeId: "bypassPermissions",
      model: "claude-opus-4-6",
    },
  });
  // eslint-disable-next-line no-console
  console.log(`created agent: id=${snap.id} lifecycle=${snap.lifecycle}`);
  await client.close();
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("create-agent failed:", err);
    process.exit(1);
  });
