#!/usr/bin/env tsx
/**
 * Idle-survival test for friend-sync keepalive.
 *
 * Flow:
 *   1. Connect alice + bob daemons.
 *   2. Send invite #1 from alice — confirm bob sees it within ~5s.
 *   3. Idle for IDLE_SECONDS (default 360s — past Cloudflare's 5-min
 *      window, well past the relay's free-tier 100s window too).
 *   4. Send invite #2 — confirm bob sees it within ~10s.
 *
 * Without keepalive, step 4 silently fails: socket.send returns ok on
 * alice but bob's friend-sync receiver never gets the bytes.
 *
 *   cd packages/server && npx tsx scripts/ai-share-idle-survival.ts
 *   IDLE_SECONDS=420 npx tsx scripts/ai-share-idle-survival.ts
 */
import { WebSocket } from "ws";
import { DaemonClient } from "../src/client/daemon-client.js";

const IDLE_SECONDS = Number(process.env.IDLE_SECONDS ?? "360");

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
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
function info(s: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.dim}${s}${COLORS.reset}`);
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
    clientId: `idle-${label}-${Date.now()}`,
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

async function sendInviteAndWait(
  aliceClient: DaemonClient,
  bobClient: DaemonClient,
  label: string,
  waitSeconds: number,
): Promise<string> {
  const agents = await aliceClient.chatP2pAiShareListShareableAgents();
  if (!agents.agents || agents.agents.length === 0) {
    failStep(`alice 没可分享 agent (${label})`);
  }
  const friends = await aliceClient.friendList();
  if (!friends.peers || friends.peers.length === 0) failStep("alice 没好友");
  const bobPeer =
    friends.peers.find((p) => p.peerDisplayName?.toLowerCase() === "bob") ?? friends.peers[0]!;
  const targetAgent = agents.agents[0]!;
  const inviteResult = await aliceClient.chatP2pAiShareInvite({
    peerRootPubKey: bobPeer.peerRootSignPublicKeyB64,
    agentId: targetAgent.agentId,
    agentLabel: targetAgent.agentLabel,
    agentProvider: targetAgent.agentProvider,
  });
  if (inviteResult.error || !inviteResult.invite) {
    failStep(`invite 失败: ${inviteResult.error}`);
  }
  const inviteId = inviteResult.invite.inviteId;
  info(`        alice → invite ${inviteId.slice(0, 12)}…`);

  const tries = Math.ceil((waitSeconds * 1000) / 500);
  for (let i = 0; i < tries; i++) {
    const inbound = await bobClient.chatP2pAiShareListInbound();
    if (inbound.invites?.some((inv) => inv.inviteId === inviteId)) {
      ok(`bob 收到 ${label} (${((i + 1) * 0.5).toFixed(1)}s 后)`);
      return inviteId;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  failStep(`bob ${waitSeconds}s 内没收到 ${label}`);
}

async function endSession(aliceClient: DaemonClient, inviteId: string): Promise<void> {
  await aliceClient.chatP2pAiShareEnd({ inviteId }).catch(() => undefined);
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    `${COLORS.bold}===== friend-sync 空闲存活测试 (idle = ${IDLE_SECONDS}s) =====${COLORS.reset}`,
  );

  step(1, "连两个 daemon");
  const aliceClient = await connectClient(6868, "alice");
  const bobClient = await connectClient(6869, "bob");
  ok("已连");

  step(2, "send invite #1 (验证 baseline)");
  const inviteId1 = await sendInviteAndWait(aliceClient, bobClient, "invite #1", 9);

  step(3, `idle ${IDLE_SECONDS}s 跨过 Cloudflare 空闲超时窗`);
  // We end session #1 before idling so it doesn't TTL-out and confuse
  // the listInbound numbers. Idle is purely about friend-sync transport.
  await endSession(aliceClient, inviteId1);
  const startMs = Date.now();
  while ((Date.now() - startMs) / 1000 < IDLE_SECONDS) {
    const remaining = IDLE_SECONDS - Math.floor((Date.now() - startMs) / 1000);
    info(`        idle… ${remaining}s 剩余`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
  ok(`idle ${IDLE_SECONDS}s 完成`);

  step(4, "send invite #2 (验证 keepalive 起作用)");
  await sendInviteAndWait(aliceClient, bobClient, "invite #2", 15);

  await aliceClient.close();
  await bobClient.close();
  // eslint-disable-next-line no-console
  console.log(
    `\n${COLORS.ok}${COLORS.bold}===== ✔ idle ${IDLE_SECONDS}s 后 friend-sync 仍然正常 =====${COLORS.reset}\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`${COLORS.fail}${COLORS.bold}\n失败:${COLORS.reset}`, err);
    process.exit(1);
  });
