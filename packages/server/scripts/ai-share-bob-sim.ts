#!/usr/bin/env tsx
/**
 * 临时调试脚本 — 用 daemon API 直接模拟 bob 浏览器的所有动作。
 * 绕过 bob UI,验证 daemon 整条链路是否正常。
 *
 * 用法:
 *   cd packages/server && npx tsx scripts/ai-share-bob-sim.ts
 */
import { WebSocket } from "ws";
import { DaemonClient } from "../src/client/daemon-client.js";

async function connectBob(): Promise<DaemonClient> {
  const client = new DaemonClient({
    url: "ws://localhost:6869/ws",
    clientId: "bob-sim-cli",
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
function ok(s: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.ok}${COLORS.bold}        ✔ ${s}${COLORS.reset}`);
}
function failStep(s: string): never {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.fail}${COLORS.bold}        ✘ ${s}${COLORS.reset}`);
  throw new Error(s);
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.bold}===== 用 daemon API 直接模拟 bob =====${COLORS.reset}`);

  step(1, "连 bob daemon (port 6869)");
  const bobClient = await connectBob();
  bob("WebSocket 已连");

  step(2, "查 bob 当前 pending inbound invites");
  const inboundList = await bobClient.chatP2pAiShareListInbound();
  bob(`list-inbound: error=${inboundList.error ?? "null"}, invites=${inboundList.invites?.length ?? 0}`);
  if (inboundList.error) failStep(`list-inbound 失败: ${inboundList.error}`);
  if (!inboundList.invites || inboundList.invites.length === 0) {
    failStep("bob daemon 内存里没有 pending invite");
  }
  const invite = inboundList.invites[0]!;
  ok(`收到 invite: ${invite.inviteId}`);
  ok(`  agentLabel: ${invite.agentLabel}`);
  ok(`  agentProvider: ${invite.agentProvider}`);
  ok(`  expiresAt: ${invite.expiresAt}`);
  ok(`  limits: ${JSON.stringify(invite.limits)}`);

  step(3, "bob accept invite");
  const acceptResult = await bobClient.chatP2pAiShareAccept({ inviteId: invite.inviteId });
  bob(`accept: error=${acceptResult.error ?? "null"}`);
  if (acceptResult.error) failStep(`accept 失败: ${acceptResult.error}`);
  ok("已接受");

  step(4, "等 active session 在 bob 端出现");
  let activeFound = false;
  for (let i = 0; i < 20; i++) {
    const active = await bobClient.chatP2pAiShareListActive();
    if (active.sessions && active.sessions.some((s) => s.inviteId === invite.inviteId)) {
      ok(`bob 看到 active share (${(i + 1) * 0.3}s 后)`);
      activeFound = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!activeFound) failStep("active 没出现 — accept 没触发 daemon 状态变化");

  step(5, "bob 发 prompt: 'say hi briefly in 5 words'");
  const promptResult = await bobClient.chatP2pAiShareSendPrompt({
    inviteId: invite.inviteId,
    body: "say hi briefly in 5 words",
  });
  if (promptResult.error) failStep(`send-prompt 失败: ${promptResult.error}`);
  bob(`prompt sent, promptId=${promptResult.promptId}`);
  ok("prompt envelope 已通过 friend-sync 飞向 alice");

  step(6, "等 alice 的 Claude agent 跑完 + 结果流回 bob");
  let assistantSeen = false;
  let lastKinds = "";
  for (let i = 0; i < 60; i++) {
    const tl = await bobClient.chatP2pAiShareListTimeline({ inviteId: invite.inviteId });
    if (tl.entries && tl.entries.length > 0) {
      const kinds = tl.entries.map((e) => e.entry.kind).join(", ");
      if (kinds !== lastKinds) {
        bob(`  ${(i + 1) * 0.5}s: timeline = [${kinds}]`);
        lastKinds = kinds;
      }
      const assistantMsg = tl.entries.find((e) => e.entry.kind === "assistant_message");
      if (assistantMsg && assistantMsg.entry.kind === "assistant_message") {
        ok(`assistant 回复: "${assistantMsg.entry.text.slice(0, 100)}..."`);
        assistantSeen = true;
        const done = tl.entries.some((e) => e.entry.kind === "turn_completed");
        if (done) {
          ok("turn_completed 收到 — agent 跑完");
          break;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!assistantSeen) failStep("30 秒内没看到 assistant_message");

  step(7, "tool_call 是否被 §7 redactor 拦下了?");
  const finalTl = await bobClient.chatP2pAiShareListTimeline({ inviteId: invite.inviteId });
  const allKinds = (finalTl.entries ?? []).map((e) => e.entry.kind);
  if (allKinds.includes("tool_call" as never)) {
    failStep("§7 隐私护栏失败! bob 看到 tool_call");
  }
  ok(`bob 收到 ${allKinds.length} 条 timeline,kinds: [${[...new Set(allKinds)].join(", ")}]`);
  ok("tool_call 没出现 — §7 redactor 工作正常");

  step(8, "结束 share");
  const endResult = await bobClient.chatP2pAiShareEnd({ inviteId: invite.inviteId });
  if (endResult.error) failStep(`end 失败: ${endResult.error}`);
  ok("share 已结束");

  await bobClient.close();
  // eslint-disable-next-line no-console
  console.log(
    `\n${COLORS.ok}${COLORS.bold}===== ✔ 完整流程通过 — daemon 端没问题 =====${COLORS.reset}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `${COLORS.dim}既然 daemon 全程 OK,bob 浏览器看不到铃铛红点是 UI 问题(WebSocket 连接 / React Query / 路由)。${COLORS.reset}\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`${COLORS.fail}${COLORS.bold}\n模拟失败:${COLORS.reset}`, err);
    process.exit(1);
  });
