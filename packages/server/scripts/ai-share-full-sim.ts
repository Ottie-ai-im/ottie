#!/usr/bin/env tsx
/**
 * 完整端到端模拟 — alice (Wendell) 发 invite,bob 立刻接受 + 发 prompt,
 * 验证 daemon 链路 + 真实 Claude agent 跑完。
 *
 * 用法:
 *   cd packages/server && npx tsx scripts/ai-share-full-sim.ts
 */
import { WebSocket } from "ws";
import { DaemonClient } from "../src/client/daemon-client.js";

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  bob: "\x1b[33m",
  alice: "\x1b[36m",
  ok: "\x1b[32m",
  fail: "\x1b[31m",
  step: "\x1b[35m",
};

function step(n: number, s: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n${COLORS.step}━━━ 步骤 ${n}: ${s}${COLORS.reset}`);
}
function bob(s: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.bob}[bob]   ${COLORS.reset} ${s}`);
}
function alice(s: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.alice}[alice] ${COLORS.reset} ${s}`);
}
function ok(s: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.ok}${COLORS.bold}        ✔ ${s}${COLORS.reset}`);
}
function failStep(s: string): never {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.fail}${COLORS.bold}        ✘ ${s}${COLORS.reset}`);
  throw new Error(s);
}

async function connectClient(port: number, label: string): Promise<DaemonClient> {
  const client = new DaemonClient({
    url: `ws://localhost:${port}/ws`,
    clientId: `sim-${label}-${Date.now()}`,
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
  return client;
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.bold}===== Phase 4 完整端到端模拟(纯 daemon API)=====${COLORS.reset}`);

  step(1, "连两个 daemon");
  const aliceClient = await connectClient(6868, "alice");
  alice("已连 (port 6868)");
  const bobClient = await connectClient(6869, "bob");
  bob("已连 (port 6869)");

  step(2, "alice 看自己有没有可分享的 agent");
  const agents = await aliceClient.chatP2pAiShareListShareableAgents();
  if (agents.error || !agents.agents || agents.agents.length === 0) {
    failStep(`alice 没有可分享 agent: ${agents.error ?? "empty"}`);
  }
  const targetAgent = agents.agents[0]!;
  alice(
    `agent: ${targetAgent.agentLabel} (${targetAgent.agentProvider}, ${targetAgent.lifecycle})`,
  );
  ok("agent picker 数据正常");

  step(3, "alice 看 friend list 找 bob");
  const friends = await aliceClient.friendList();
  if (!friends.peers || friends.peers.length === 0) {
    failStep("alice 没有好友 — 配对断了?");
  }
  const bobPeer =
    friends.peers.find((p) => p.peerDisplayName?.toLowerCase() === "bob") ?? friends.peers[0]!;
  alice(
    `peer: ${bobPeer.peerDisplayName} (root pubkey: ${bobPeer.peerRootSignPublicKeyB64.slice(0, 12)}...)`,
  );

  step(4, "alice 发 invite 给 bob");
  const inviteResult = await aliceClient.chatP2pAiShareInvite({
    peerRootPubKey: bobPeer.peerRootSignPublicKeyB64,
    agentId: targetAgent.agentId,
    agentLabel: targetAgent.agentLabel,
    agentProvider: targetAgent.agentProvider,
  });
  if (inviteResult.error || !inviteResult.invite) {
    failStep(`alice 发 invite 失败: ${inviteResult.error}`);
  }
  const inviteId = inviteResult.invite.inviteId;
  alice(`已发出 invite: ${inviteId}`);

  step(5, "等 bob daemon 收到 invite (peer-sync 通过 friend-sync 通道)");
  let bobInvite:
    | NonNullable<
        Awaited<ReturnType<typeof bobClient.chatP2pAiShareListInbound>>["invites"]
      >[number]
    | null = null;
  for (let i = 0; i < 30; i++) {
    const inbound = await bobClient.chatP2pAiShareListInbound();
    const found = inbound.invites?.find((inv) => inv.inviteId === inviteId);
    if (found) {
      bobInvite = found;
      ok(`bob 收到 invite (${(i + 1) * 0.3}s 后)`);
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!bobInvite) failStep("9 秒内 bob 没收到 invite — friend-sync 通道有问题");
  bob(`agentLabel: ${bobInvite.agentLabel}`);
  bob(`limits: ${JSON.stringify(bobInvite.limits)}`);

  step(6, "bob accept invite");
  const acceptResult = await bobClient.chatP2pAiShareAccept({ inviteId });
  if (acceptResult.error) failStep(`accept 失败: ${acceptResult.error}`);
  ok("bob 已接受");

  step(7, "等两边都看到 active");
  let aliceActive = false,
    bobActive = false;
  for (let i = 0; i < 30; i++) {
    if (!aliceActive) {
      const a = await aliceClient.chatP2pAiShareListActive();
      if (a.sessions?.some((s) => s.inviteId === inviteId)) {
        aliceActive = true;
        alice(`active ✓ (${(i + 1) * 0.3}s)`);
      }
    }
    if (!bobActive) {
      const b = await bobClient.chatP2pAiShareListActive();
      if (b.sessions?.some((s) => s.inviteId === inviteId)) {
        bobActive = true;
        bob(`active ✓ (${(i + 1) * 0.3}s)`);
      }
    }
    if (aliceActive && bobActive) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!aliceActive || !bobActive) failStep("9 秒内两边没都进 active");

  step(8, "bob 发 prompt: '一句话回复 hello'");
  const promptResult = await bobClient.chatP2pAiShareSendPrompt({
    inviteId,
    body: "Reply with exactly: hi",
  });
  if (promptResult.error) failStep(`send-prompt 失败: ${promptResult.error}`);
  bob(`promptId: ${promptResult.promptId}`);

  step(9, "等 alice 的 Claude agent 跑完 + redacted timeline 流回 bob");
  let lastKindsStr = "";
  let assistantText: string | null = null;
  let turnCompleted = false;
  for (let i = 0; i < 120; i++) {
    const tl = await bobClient.chatP2pAiShareListTimeline({ inviteId });
    const entries = tl.entries ?? [];
    const kinds = entries.map((e) => e.entry.kind).join(", ");
    if (kinds !== lastKindsStr && kinds.length > 0) {
      bob(`  ${(i + 1) * 0.5}s: [${kinds}]`);
      lastKindsStr = kinds;
    }
    const am = entries.find((e) => e.entry.kind === "assistant_message");
    if (am && am.entry.kind === "assistant_message" && !assistantText) {
      assistantText = am.entry.text;
      ok(`收到 assistant_message: "${assistantText.slice(0, 80)}"`);
    }
    if (entries.some((e) => e.entry.kind === "turn_completed")) {
      turnCompleted = true;
      ok("turn_completed 收到");
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!assistantText) failStep("60 秒内 bob 没收到 assistant_message");
  if (!turnCompleted) bob("(没等到 turn_completed,但已有 assistant_message)");

  step(10, "§7 redactor: tool_call 应该不在 bob 的 timeline");
  const finalTl = await bobClient.chatP2pAiShareListTimeline({ inviteId });
  const allKinds = (finalTl.entries ?? []).map((e) => e.entry.kind);
  if (allKinds.includes("tool_call" as never)) failStep("§7 失败: bob 看到 tool_call!");
  ok(`bob 收到 ${allKinds.length} 条 timeline,kinds: [${[...new Set(allKinds)].join(", ")}]`);

  step(11, "alice 结束 share");
  const endResult = await aliceClient.chatP2pAiShareEnd({ inviteId });
  if (endResult.error) failStep(`end 失败: ${endResult.error}`);
  ok("session ended");

  await aliceClient.close();
  await bobClient.close();
  // eslint-disable-next-line no-console
  console.log(
    `\n${COLORS.ok}${COLORS.bold}===== ✔ 完整流程通过 — daemon 端没问题 =====${COLORS.reset}\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`${COLORS.fail}${COLORS.bold}\n失败:${COLORS.reset}`, err);
    process.exit(1);
  });
