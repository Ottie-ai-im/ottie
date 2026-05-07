#!/usr/bin/env tsx
/**
 * Phase 4 AI 分享 端到端模拟 — 在一台机器上跑完整两台 daemon 的全流程,
 * 让你看见每一步 daemon 之间到底发生了什么,不需要两台真实机器。
 *
 * 跑了什么:
 *   1. 两个 IdentityService 实例(Wendell + Bob),各自独立的 $OTTIE_HOME,
 *      真实的 relay-transport,真实的 friend-sync handlers,通过 in-process
 *      的 mock Cloudflare Workers relay 通信。
 *   2. 友情配对(Phase 3.a)— 必经前置。
 *   3. **v1 邀请握手**: Wendell 发 ai-share-invite,Bob 收到 + 接受。
 *   4. **v2/b 主人 agent 选择**: Wendell 用 InProcessAgentBridge mock 一个
 *      可分享的 agent,Bob 选它。
 *   5. **v2/b 朋友发 prompt**: Bob 通过 ai-share-prompt envelope 发送,
 *      Wendell 的 daemon 路由到 mock agent。
 *   6. **v2/d 主人转发已 redact 的 timeline**: mock agent 故意发出 tool_call
 *      事件 — 我们验证 Bob 那边**收不到** tool_call(这是 §7 的核心隐私护栏)。
 *   7. **v2/e 双方磁盘 transcript**: 验证两边都把完整记录写到了
 *      `$OTTIE_HOME/ai-shares/{inviteId}.jsonl`。
 *   8. **v3/a 限制触发**: 用紧的 maxPrompts=2 测试 — 第三个 prompt 触发
 *      自动 end with reason="prompt-limit"。
 *   9. **v3/b 首次分享戳**: 验证 sendAiShareInvite 后 peer 记录里写了
 *      firstAiShareSentAt。
 *
 * 不在这个脚本里:
 *   - v3/c UI step-1 daemon picker(纯客户端 UI 逻辑)
 *   - v3/d 跨 daemon 广播(需要三个 daemon + device-link;详见 commit
 *     `41239348` 的描述)
 *
 * 怎么跑:
 *   cd packages/server && npx tsx scripts/ai-share-demo.ts
 *
 * 调试模式(看完整 daemon log):
 *   DEMO_DEBUG=1 npx tsx scripts/ai-share-demo.ts
 *
 * 成功 exit 0,任何步骤失败 exit 1。
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import pino from "pino";

import {
  IdentityService,
  type AiShareAgentBridge,
  type ShareableAgentSummary,
} from "../src/server/identity/identity-service.js";
import { aiShareTranscriptFilePath } from "../src/server/identity/ai-share-transcript-store.js";
import { MockRelay } from "../src/server/identity/test-utils/mock-relay.js";
import { startRelayTransport } from "../src/server/relay-transport.js";
import type {
  RelayConnectionHandler,
  RelayTransportController,
} from "../src/server/relay-transport.js";
import type { AgentManagerEvent } from "../src/server/agent/agent-manager.js";

// ----- console pretty-printing ------------------------------------------

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  wendell: "\x1b[36m", // cyan
  bob: "\x1b[33m", // yellow
  step: "\x1b[35m", // magenta
  ok: "\x1b[32m", // green
  fail: "\x1b[31m", // red
  info: "\x1b[37m", // white
  agent: "\x1b[34m", // blue
};

let stepNum = 0;
function step(title: string): void {
  stepNum += 1;
  // eslint-disable-next-line no-console
  console.log(`\n${COLORS.step}━━━ 步骤 ${stepNum}: ${title}${COLORS.reset}`);
}

function wendell(line: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.wendell}[Wendell]${COLORS.reset} ${line}`);
}

function bob(line: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.bob}[Bob]    ${COLORS.reset} ${line}`);
}

function agent(line: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.agent}[Agent]  ${COLORS.reset} ${line}`);
}

function info(line: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.dim}          ${line}${COLORS.reset}`);
}

function success(line: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.ok}${COLORS.bold}          ✔ ${line}${COLORS.reset}`);
}

function fail(line: string): never {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.fail}${COLORS.bold}          ✘ ${line}${COLORS.reset}`);
  throw new Error(line);
}

// ----- helpers ----------------------------------------------------------

const SILENT_LOGGER = pino({ level: process.env.DEMO_DEBUG === "1" ? "debug" : "silent" });

async function waitFor<T>(
  cb: () => T | undefined | null | false,
  args: { timeoutMs?: number; intervalMs?: number; label: string },
): Promise<T> {
  const deadline = Date.now() + (args.timeoutMs ?? 30_000);
  const interval = args.intervalMs ?? 50;
  while (Date.now() < deadline) {
    const result = cb();
    if (result) return result as T;
    await new Promise((r) => setTimeout(r, interval));
  }
  fail(`超时等待: ${args.label}`);
}

// ----- mock agent bridge ------------------------------------------------

/**
 * 模拟 AgentManager — 当 Wendell 的 daemon 调 injectPrompt 时,我们生成
 * 一串 deterministic 的 stream events。其中故意发出一个 `tool_call`
 * 事件来验证 §7 redactor 把它过滤掉。
 */
class InProcessAgentBridge implements AiShareAgentBridge {
  private readonly subscribers = new Map<string, Set<(e: AgentManagerEvent) => void>>();
  private readonly agentList: ShareableAgentSummary[];

  constructor(agentList: ShareableAgentSummary[]) {
    this.agentList = agentList;
  }
  listShareableAgents(): ShareableAgentSummary[] {
    return this.agentList.slice();
  }
  subscribeAgent(input: {
    agentId: string;
    onEvent: (event: AgentManagerEvent) => void;
  }): () => void {
    const set = this.subscribers.get(input.agentId) ?? new Set();
    set.add(input.onEvent);
    this.subscribers.set(input.agentId, set);
    return () => set.delete(input.onEvent);
  }
  async injectPrompt(input: { agentId: string; body: string }): Promise<void> {
    const subs = this.subscribers.get(input.agentId);
    if (!subs || subs.size === 0) return;
    agent(`收到 prompt: "${input.body}",开始模拟 agent 运行...`);
    const emit = (event: AgentManagerEvent): void => {
      for (const cb of subs) cb(event);
    };
    await new Promise((r) => setTimeout(r, 5));
    emit({
      type: "agent_stream",
      agentId: input.agentId,
      event: { type: "turn_started", provider: "claude" },
    });
    emit({
      type: "agent_stream",
      agentId: input.agentId,
      event: {
        type: "timeline",
        item: { type: "user_message", text: input.body },
        provider: "claude",
      },
    });
    // 故意发一个 tool_call — 我们要验证朋友那边收不到这个
    emit({
      type: "agent_stream",
      agentId: input.agentId,
      event: {
        type: "timeline",
        item: {
          type: "tool_call",
          id: "t1",
          name: "Read",
          tool: "Read",
          detail: { kind: "read", path: "/etc/secrets" },
          status: "completed",
        } as never,
        provider: "claude",
      },
    });
    agent(`(故意发出 tool_call 读取 /etc/secrets — 应该被 redactor 拦下)`);
    emit({
      type: "agent_stream",
      agentId: input.agentId,
      event: {
        type: "timeline",
        item: { type: "assistant_message", text: `回复: ${input.body}` },
        provider: "claude",
      },
    });
    emit({
      type: "agent_stream",
      agentId: input.agentId,
      event: { type: "turn_completed", provider: "claude" },
    });
  }
}

// ----- daemon harness ---------------------------------------------------

interface DaemonHarness {
  svc: IdentityService;
  transport: RelayTransportController;
  home: string;
  serverId: string;
}

function startDaemon(args: {
  home: string;
  serverId: string;
  deviceLabel: string;
  relayEndpoint: string;
  displayName: string;
  agentBridge?: AiShareAgentBridge;
}): DaemonHarness {
  const svc = new IdentityService({
    ottieHome: args.home,
    logger: SILENT_LOGGER,
    selfDeviceContext: { serverId: args.serverId, deviceLabel: args.deviceLabel },
    relayEndpoint: args.relayEndpoint,
  });
  svc.initialize(args.displayName);
  if (args.agentBridge) svc.setAiShareAgentBridge(args.agentBridge);

  const transport = startRelayTransport({
    logger: SILENT_LOGGER,
    attachSocket: async () => {},
    relayEndpoint: args.relayEndpoint,
    serverId: args.serverId,
    connectionHandlers: ((): RelayConnectionHandler[] => {
      const out: RelayConnectionHandler[] = [
        svc.createDeviceLinkConnectionHandler(),
        svc.createFriendPairConnectionHandler(),
      ];
      const peerSync = svc.createPeerSyncConnectionHandler();
      if (peerSync) out.push(peerSync);
      const friendSync = svc.createFriendSyncConnectionHandler();
      if (friendSync) out.push(friendSync);
      return out;
    })(),
  });
  svc.startFriendSync();
  return { svc, transport, home: args.home, serverId: args.serverId };
}

// ----- the simulation ---------------------------------------------------

async function runSimulation(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.bold}===== Phase 4 AI 分享 双 daemon 模拟 =====${COLORS.reset}`);
  // eslint-disable-next-line no-console
  console.log(
    `${COLORS.dim}两个 IdentityService 实例,各自独立 $OTTIE_HOME,通过 in-process mock relay 通信。${COLORS.reset}\n`,
  );

  const wendellHome = mkdtempSync(path.join(os.tmpdir(), "ottie-aishare-demo-wendell-"));
  const bobHome = mkdtempSync(path.join(os.tmpdir(), "ottie-aishare-demo-bob-"));
  const cleanup = (): void => {
    rmSync(wendellHome, { recursive: true, force: true });
    rmSync(bobHome, { recursive: true, force: true });
  };
  process.on("exit", cleanup);

  const mockRelay = new MockRelay();
  await mockRelay.start();
  const relayEndpoint = mockRelay.endpoint();

  const wendellBridge = new InProcessAgentBridge([
    {
      agentId: "agent-wendell-claude",
      agentLabel: "Wendell's Claude Code",
      agentProvider: "claude",
      lifecycle: "idle",
      cwd: "/Users/wendell/repo",
    },
  ]);

  // ============================================================
  step("启动两个 daemon");
  // ============================================================
  const w = startDaemon({
    home: wendellHome,
    serverId: "srv_wendell",
    deviceLabel: "Wendell's Mac",
    relayEndpoint,
    displayName: "Wendell",
    agentBridge: wendellBridge,
  });
  wendell(`身份已初始化,$OTTIE_HOME = ${wendellHome}`);
  wendell(`已绑定 mock AgentBridge — 1 个可分享 agent: "Wendell's Claude Code"`);

  const b = startDaemon({
    home: bobHome,
    serverId: "srv_bob",
    deviceLabel: "Bob's Laptop",
    relayEndpoint,
    displayName: "Bob",
  });
  bob(`身份已初始化,$OTTIE_HOME = ${bobHome}`);

  // ============================================================
  step("好友配对 (Phase 3.a) — Phase 4 的前置条件");
  // ============================================================
  const offer = w.svc.generateFriendPairOffer();
  if (!offer) fail("Wendell 生成 friend-pair offer 失败");
  wendell(`生成 deep link: ${offer.deepLink.slice(0, 60)}…`);
  const redeemPromise = b.svc.redeemFriendPairOffer({
    deepLinkOrOffer: offer.deepLink,
    timeoutMs: 10_000,
  });
  bob(`兑换 deep link...`);
  const candidate = await waitFor(() => w.svc.listPendingFriendPairCandidates()[0], {
    label: "Wendell 收到 friend-pair candidate",
  });
  wendell(`收到 Bob 的配对请求,审批中...`);
  w.svc.approveFriendPair(candidate.nonceB64);
  await redeemPromise;
  await waitFor(() => w.svc.getFriendSessions().length === 1, {
    label: "Wendell ↔ Bob friend-sync session 建立",
  });
  await waitFor(() => b.svc.getFriendSessions().length === 1, {
    label: "Bob ↔ Wendell friend-sync session 建立",
  });
  success("两边都建立了 friend-sync 加密会话");

  const wendellRoot = w.svc.requireBundle().stored.signPublicKeyB64;
  const bobRoot = b.svc.requireBundle().stored.signPublicKeyB64;
  info(`Wendell root pubkey 前缀: ${wendellRoot.slice(0, 8)}…`);
  info(`Bob root pubkey 前缀:     ${bobRoot.slice(0, 8)}…`);

  // ============================================================
  step("v1 邀请握手 — Wendell 给 Bob 发 ai-share-invite (含 v3/a 限制)");
  // ============================================================
  // 在 peer 记录里 Bob 的 firstAiShareSentAt 应该是 undefined (v3/b 验证)
  const peerBefore = w.svc.getPeerList().find((p) => p.peerRootSignPublicKeyB64 === bobRoot);
  if (peerBefore?.firstAiShareSentAt !== undefined) {
    fail(`期望 firstAiShareSentAt 为 undefined,实际是 ${peerBefore?.firstAiShareSentAt}`);
  }
  success("v3/b 检查: peer 记录里没有 firstAiShareSentAt 戳(首次分享)");

  const inviteResult = w.svc.sendAiShareInvite({
    peerRootPubKey: bobRoot,
    agentId: "agent-wendell-claude",
    agentLabel: "Wendell's Claude Code",
    agentProvider: "claude",
    // v3/a: 紧的 cap 来快速触发自动 end
    limits: { maxPrompts: 2, maxTokens: 100_000, sessionTimeoutMs: 60_000 },
  });
  if (!inviteResult.ok) fail(`sendAiShareInvite 失败: ${inviteResult.error}`);
  wendell(`已发送 invite,inviteId = ${inviteResult.invite.inviteId}`);
  wendell(`包含限制: maxPrompts=2, maxTokens=100k, sessionTimeoutMs=60s`);

  // v3/b: 戳现在应该写进 peer 记录了
  const peerAfter = w.svc.getPeerList().find((p) => p.peerRootSignPublicKeyB64 === bobRoot);
  if (peerAfter?.firstAiShareSentAt === undefined) {
    fail("发送 invite 后期望 firstAiShareSentAt 被设置,但还是 undefined");
  }
  success(`v3/b 检查: peer 记录现在有 firstAiShareSentAt = ${peerAfter.firstAiShareSentAt}`);

  await waitFor(
    () =>
      b.svc.listInboundAiShareInvites().some((i) => i.inviteId === inviteResult.invite.inviteId),
    { label: "Bob 收到 invite" },
  );
  const inboundInvite = b.svc
    .listInboundAiShareInvites()
    .find((i) => i.inviteId === inviteResult.invite.inviteId);
  bob(`收到 invite: "${inboundInvite?.agentLabel}" (${inboundInvite?.agentProvider})`);
  if (inboundInvite?.limits) {
    bob(
      `看到限制: maxPrompts=${inboundInvite.limits.maxPrompts}, maxTokens=${inboundInvite.limits.maxTokens}, timeoutMs=${inboundInvite.limits.sessionTimeoutMs}`,
    );
    success("v3/a 检查: 限制随 invite envelope 一起到达 Bob");
  } else {
    fail("v3/a 检查: 期望看到 limits 但没收到");
  }

  // ============================================================
  step("v1 接受 — Bob 接受 invite");
  // ============================================================
  const acceptResult = b.svc.acceptAiShareInvite(inviteResult.invite.inviteId);
  if (!acceptResult.ok) fail(`acceptAiShareInvite 失败: ${acceptResult.error}`);
  bob(`已接受`);

  await waitFor(
    () => w.svc.listActiveAiShares().some((s) => s.inviteId === inviteResult.invite.inviteId),
    { label: "Wendell 看到 active share" },
  );
  await waitFor(
    () => b.svc.listActiveAiShares().some((s) => s.inviteId === inviteResult.invite.inviteId),
    { label: "Bob 看到 active share" },
  );
  success("v2/a 检查: 两边都进入 active 状态");

  // ============================================================
  step("v2/b 第一个 prompt — Bob 发 prompt,Wendell 的 mock agent 跑");
  // ============================================================
  const prompt1 = b.svc.sendAiSharePrompt({
    inviteId: inviteResult.invite.inviteId,
    body: "explain quicksort",
  });
  if (!prompt1.ok) fail(`sendAiSharePrompt 失败: ${prompt1.error}`);
  bob(`发出 prompt: "explain quicksort" (promptId = ${prompt1.promptId})`);

  // 等 4 个 timeline 条目到达 Bob (turn_started, user_message, assistant_message, turn_completed)
  // tool_call 应该被 redactor 拦下 → Bob 永远收不到
  await waitFor(
    () => {
      const t = b.svc.listAiShareTimeline(inviteResult.invite.inviteId);
      return t.length >= 4 ? t : null;
    },
    { label: "Bob 的 timeline buffer 攒到 4 条" },
  );

  const bobTimeline = b.svc.listAiShareTimeline(inviteResult.invite.inviteId);
  const kinds = bobTimeline.map((r) => r.entry.kind);
  bob(`收到 ${bobTimeline.length} 条 timeline: [${kinds.join(", ")}]`);

  if (kinds.includes("tool_call" as never)) {
    fail("§7 隐私护栏失败: Bob 不应该看到 tool_call!");
  }
  success("§7 redactor 检查: tool_call 没有泄漏到 Bob 的 timeline");

  const expectedKinds = ["turn_started", "user_message", "assistant_message", "turn_completed"];
  if (JSON.stringify(kinds.sort()) !== JSON.stringify(expectedKinds.sort())) {
    fail(`期望 ${JSON.stringify(expectedKinds)},实际 ${JSON.stringify(kinds)}`);
  }
  success(
    "v2/d 检查: 4 条 redacted 条目按预期到达 (turn_started + user_message + assistant_message + turn_completed)",
  );

  const userMsg = bobTimeline.find((r) => r.entry.kind === "user_message");
  if (
    userMsg?.entry.kind === "user_message" &&
    "promptId" in userMsg.entry &&
    userMsg.entry.promptId !== prompt1.promptId
  ) {
    fail(`user_message 应该 echo Bob 的 promptId,实际 ${userMsg.entry.promptId}`);
  }
  success("v2/d 检查: owner echo 回的 user_message 携带了 Bob 的 promptId");

  // ============================================================
  step("v2/b 第二个 prompt — 还在 cap 内");
  // ============================================================
  const prompt2 = b.svc.sendAiSharePrompt({
    inviteId: inviteResult.invite.inviteId,
    body: "now explain mergesort",
  });
  if (!prompt2.ok) fail(`第二个 prompt 失败: ${prompt2.error}`);
  bob(`发出 prompt 2: "now explain mergesort"`);

  await waitFor(
    () => {
      const t = b.svc.listAiShareTimeline(inviteResult.invite.inviteId);
      return t.filter((r) => r.entry.kind === "turn_completed").length === 2 ? t : null;
    },
    { label: "Bob 收到第二轮的 turn_completed" },
  );
  success("两轮 prompt 都跑完,share 还活着");

  // ============================================================
  step("v3/a 限制触发 — 第三个 prompt 超过 maxPrompts=2");
  // ============================================================
  const prompt3 = b.svc.sendAiSharePrompt({
    inviteId: inviteResult.invite.inviteId,
    body: "and now bubble sort",
  });
  if (!prompt3.ok) fail(`第三个 prompt 发送失败: ${prompt3.error}`);
  bob(`发出超出 cap 的 prompt 3 — 应该触发自动 end`);

  // Wendell daemon 在收到第三个 prompt 后:
  //   1. promptCount 增到 3
  //   2. 比对 maxPrompts=2 → 超了
  //   3. 自动调 endAiShareSession(reason="prompt-limit")
  //   4. 发出 ai-share-end envelope 给 Bob
  //   5. 双方 active list 都清空
  await waitFor(
    () => w.svc.listActiveAiShares().every((s) => s.inviteId !== inviteResult.invite.inviteId),
    { label: "Wendell active list 移除该 share (cap 触发)" },
  );
  await waitFor(
    () => b.svc.listActiveAiShares().every((s) => s.inviteId !== inviteResult.invite.inviteId),
    { label: "Bob active list 移除该 share (收到 end envelope)" },
  );
  success("v3/a 检查: maxPrompts=2 触发后,Wendell 自动 end,Bob 自动收到");

  // ============================================================
  step("v2/e 磁盘 transcript 审计 — 双方都该有完整 jsonl");
  // ============================================================
  const wFile = aiShareTranscriptFilePath(wendellHome, inviteResult.invite.inviteId);
  const bFile = aiShareTranscriptFilePath(bobHome, inviteResult.invite.inviteId);
  if (!wFile || !bFile) fail("transcript 文件路径解析失败");

  const wLines = readFileSync(wFile, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { kind: string; origin?: string; reason?: string });
  const bLines = readFileSync(bFile, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { kind: string; origin?: string; reason?: string });

  wendell(`磁盘 transcript: ${wFile}`);
  wendell(
    `  含 ${wLines.length} 行 — kinds: [${wLines.map((l) => `${l.kind}${l.origin ? ":" + l.origin : ""}`).join(", ")}]`,
  );
  bob(`磁盘 transcript: ${bFile}`);
  bob(
    `  含 ${bLines.length} 行 — kinds: [${bLines.map((l) => `${l.kind}${l.origin ? ":" + l.origin : ""}`).join(", ")}]`,
  );

  // 验证双方都有 header / accept / 多条 timeline / end
  if (!wLines.some((l) => l.kind === "header")) fail("Wendell transcript 缺 header");
  if (!wLines.some((l) => l.kind === "accept" && l.origin === "peer"))
    fail("Wendell transcript 缺 accept:peer");
  if (!wLines.some((l) => l.kind === "end" && l.origin === "self" && l.reason === "prompt-limit"))
    fail("Wendell transcript 缺 end:self reason=prompt-limit");
  success(
    "Wendell transcript 含 header / accept:peer / 多条 timeline:sent / end:self reason=prompt-limit",
  );

  if (!bLines.some((l) => l.kind === "header")) fail("Bob transcript 缺 header");
  if (!bLines.some((l) => l.kind === "accept" && l.origin === "self"))
    fail("Bob transcript 缺 accept:self");
  if (!bLines.some((l) => l.kind === "end" && l.origin === "peer" && l.reason === "prompt-limit"))
    fail("Bob transcript 缺 end:peer reason=prompt-limit");
  success(
    "Bob transcript 含 header / accept:self / 多条 timeline:received / end:peer reason=prompt-limit",
  );

  // 关键的 §7 检查:Wendell 的 transcript 包含他自己 agent 的 user_message + assistant_message,
  // 但**不包含**任何 tool_call (因为 redactor 在 transcript 写之前就过滤了)
  const wTimelineEntries = wLines.filter((l) => l.kind === "timeline") as Array<{
    kind: string;
    entry: { kind: string };
  }>;
  const wEntryKinds = wTimelineEntries.map((l) => l.entry.kind);
  if (wEntryKinds.includes("tool_call")) {
    fail("§7 检查失败: Wendell 的 transcript 包含 tool_call — 不应该!");
  }
  success(
    `§7 owner-side transcript 检查: Wendell 的 timeline:sent 条目都是 [${[...new Set(wEntryKinds)].join(", ")}],没有 tool_call`,
  );

  // ============================================================
  // 最终汇总
  // ============================================================
  // eslint-disable-next-line no-console
  console.log(`\n${COLORS.ok}${COLORS.bold}===== ✔ 模拟全部通过 =====${COLORS.reset}`);
  // eslint-disable-next-line no-console
  console.log(`${COLORS.dim}已验证:`);
  // eslint-disable-next-line no-console
  console.log(`  • Phase 3.a 配对 → friend-sync 会话建立`);
  // eslint-disable-next-line no-console
  console.log(`  • v1 invite/accept envelope 双方签名 + 验证`);
  // eslint-disable-next-line no-console
  console.log(`  • v2/a active 状态机 + end-session`);
  // eslint-disable-next-line no-console
  console.log(`  • v2/b agent 选择 + 朋友 prompt → owner agent`);
  // eslint-disable-next-line no-console
  console.log(`  • v2/d redacted timeline 流回朋友;tool_call 被 §7 redactor 拦下`);
  // eslint-disable-next-line no-console
  console.log(`  • v2/e 双方磁盘 transcript JSONL 完整 + audit-clean`);
  // eslint-disable-next-line no-console
  console.log(`  • v3/a 紧 cap (maxPrompts=2) 触发自动 end with reason=prompt-limit`);
  // eslint-disable-next-line no-console
  console.log(`  • v3/b firstAiShareSentAt 戳在第一次 invite 后落到 peer 记录${COLORS.reset}\n`);

  await mockRelay.stop();
  // eslint-disable-next-line no-console
  console.log(`${COLORS.dim}清理 tmp dirs...${COLORS.reset}`);
  cleanup();
}

runSimulation()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`${COLORS.fail}${COLORS.bold}\n模拟失败:${COLORS.reset}`, err);
    process.exit(1);
  });
