import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { AgentManagerEvent } from "../agent/agent-manager.js";
import { startRelayTransport, type RelayTransportController } from "../relay-transport.js";

import {
  IdentityService,
  type AiShareAgentBridge,
  type ShareableAgentSummary,
} from "./identity-service.js";
import { aiShareTranscriptFilePath } from "./ai-share-transcript-store.js";
import { MockRelay } from "./test-utils/mock-relay.js";

/**
 * Phase 4 v2/e mock-relay e2e: Wendell (owner) and Bob (friend) run
 * real `IdentityService` instances + real friend-sync sessions over
 * an in-process mock Cloudflare relay. They exercise the full
 * Phase-4 lifecycle — invite → accept → prompt → redacted timeline
 * back → end — and verify both sides have an auditable transcript on
 * disk plus matching in-memory state.
 *
 * The owner-side AgentManager is mocked (`InProcessAgentBridge`)
 * because spinning up a real agent provider would dominate the test
 * runtime. The mock implements `subscribeAgent` + `injectPrompt`
 * faithfully enough that the broadcaster's redactor + sign + ship
 * path runs end-to-end.
 */

const SILENT_LOGGER = pino({ level: process.env.E2E_DEBUG === "1" ? "debug" : "silent" });
const E2E_TIMEOUT_MS = 60_000;

let aliceHome: string;
let bobHome: string;
let mockRelay: MockRelay;
const transports: RelayTransportController[] = [];
const services: IdentityService[] = [];

beforeEach(async () => {
  aliceHome = mkdtempSync(path.join(os.tmpdir(), "ottie-aishare-e2e-alice-"));
  bobHome = mkdtempSync(path.join(os.tmpdir(), "ottie-aishare-e2e-bob-"));
  mockRelay = new MockRelay();
  await mockRelay.start();
});

afterEach(async () => {
  for (const t of transports.splice(0)) {
    await t.stop();
  }
  for (const s of services.splice(0)) {
    s.stopInboxReceiver();
    await s.stopFriendSync();
    await s.stopPeerSync();
  }
  await mockRelay.stop();
  rmSync(aliceHome, { recursive: true, force: true });
  rmSync(bobHome, { recursive: true, force: true });
});

async function waitFor<T>(
  cb: () => T | undefined | null | false,
  args: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const deadline = Date.now() + (args.timeoutMs ?? E2E_TIMEOUT_MS);
  const interval = args.intervalMs ?? 30;
  while (Date.now() < deadline) {
    const result = cb();
    if (result) return result as T;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for: ${args.label ?? "condition"}`);
}

/**
 * Stand-in for AgentManager. `injectPrompt` schedules a deterministic
 * stream of agent_stream events (turn_started, user_message echo,
 * assistant_message, turn_completed) on the next tick so the
 * broadcaster has something to forward to the friend.
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
    return () => {
      set.delete(input.onEvent);
    };
  }

  async injectPrompt(input: { agentId: string; body: string }): Promise<void> {
    const subscribers = this.subscribers.get(input.agentId);
    if (!subscribers || subscribers.size === 0) return;
    const emit = (event: AgentManagerEvent) => {
      for (const cb of subscribers) cb(event);
    };
    // Short setTimeout to mimic the async runAgent flow without
    // blocking the test on real provider IO.
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
    // Emit a tool_call to verify the redactor strips it (it would
    // otherwise hit the friend's transcript and leak Alice's tool I/O).
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
          detail: { kind: "read", path: "/etc/passwd" },
          status: "completed",
        } as never,
        provider: "claude",
      },
    });
    emit({
      type: "agent_stream",
      agentId: input.agentId,
      event: {
        type: "timeline",
        item: { type: "assistant_message", text: `echo: ${input.body}` },
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

function startService(args: {
  ottieHome: string;
  serverId: string;
  deviceLabel: string;
  relayEndpoint: string;
  displayName: string;
  agentBridge?: AiShareAgentBridge;
}): { svc: IdentityService; transport: RelayTransportController } {
  const svc = new IdentityService({
    ottieHome: args.ottieHome,
    logger: SILENT_LOGGER,
    selfDeviceContext: { serverId: args.serverId, deviceLabel: args.deviceLabel },
    relayEndpoint: args.relayEndpoint,
  });
  svc.initialize(args.displayName);
  if (args.agentBridge) svc.setAiShareAgentBridge(args.agentBridge);
  services.push(svc);

  const transport = startRelayTransport({
    logger: SILENT_LOGGER,
    attachSocket: async () => {},
    relayEndpoint: args.relayEndpoint,
    serverId: args.serverId,
    connectionHandlers: ((): import("../relay-transport.js").RelayConnectionHandler[] => {
      const out: import("../relay-transport.js").RelayConnectionHandler[] = [
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
  transports.push(transport);
  svc.startFriendSync();
  return { svc, transport };
}

describe("Phase 4 v2/e mock-relay e2e — full ai-share lifecycle", () => {
  test(
    "invite → accept → prompt → redacted timeline → end, both sides keep on-disk transcripts",
    async () => {
      const relayEndpoint = mockRelay.endpoint();
      const aliceBridge = new InProcessAgentBridge([
        {
          agentId: "agent-alice-1",
          agentLabel: "Alice's Claude",
          agentProvider: "claude",
          lifecycle: "idle",
          cwd: "/home/alice/repo",
        },
      ]);

      const { svc: alice } = startService({
        ottieHome: aliceHome,
        serverId: "srv_alice_aishare_e2e",
        deviceLabel: "Alice's Mac",
        relayEndpoint,
        displayName: "Alice",
        agentBridge: aliceBridge,
      });
      const { svc: bob } = startService({
        ottieHome: bobHome,
        serverId: "srv_bob_aishare_e2e",
        deviceLabel: "Bob's Laptop",
        relayEndpoint,
        displayName: "Bob",
      });

      // Pair Alice + Bob.
      const offer = alice.generateFriendPairOffer();
      if (!offer) throw new Error("offer expected");
      const redeemPromise = bob.redeemFriendPairOffer({
        deepLinkOrOffer: offer.deepLink,
        timeoutMs: 10_000,
      });
      const candidate = await waitFor(() => alice.listPendingFriendPairCandidates()[0], {
        label: "Alice receives friend-pair candidate",
      });
      const approveResult = alice.approveFriendPair(candidate.nonceB64);
      expect(approveResult.approved).toBe(true);
      const outcome = await redeemPromise;
      expect(outcome.status).toBe("paired");

      await waitFor(() => alice.getFriendSessions().length === 1, {
        label: "Alice has friend-sync session with Bob",
      });
      await waitFor(() => bob.getFriendSessions().length === 1, {
        label: "Bob has friend-sync session with Alice",
      });

      const bobRoot = bob.requireBundle().stored.signPublicKeyB64;
      const aliceRoot = alice.requireBundle().stored.signPublicKeyB64;

      // Alice sends an ai-share invite for her agent.
      const inviteResult = alice.sendAiShareInvite({
        peerRootPubKey: bobRoot,
        agentId: "agent-alice-1",
        agentLabel: "Alice's Claude",
        agentProvider: "claude",
      });
      expect(inviteResult.ok).toBe(true);
      if (!inviteResult.ok) return;
      const inviteId = inviteResult.invite.inviteId;

      // Bob's daemon receives the invite (recordInbound writes the
      // header on disk).
      await waitFor(() => bob.listInboundAiShareInvites().some((i) => i.inviteId === inviteId), {
        label: "Bob receives ai-share invite",
      });

      // Bob accepts. The accept envelope rides through friend-sync;
      // Alice's daemon transitions to "active" + opens the broadcaster.
      const acceptResult = bob.acceptAiShareInvite(inviteId);
      expect(acceptResult.ok).toBe(true);

      await waitFor(() => alice.listActiveAiShares().some((s) => s.inviteId === inviteId), {
        label: "Alice marks share active",
      });
      await waitFor(() => bob.listActiveAiShares().some((s) => s.inviteId === inviteId), {
        label: "Bob marks share active",
      });

      // peerOnline should be true for both sides while sessions are live.
      const aliceActive = alice.listActiveAiShares().find((s) => s.inviteId === inviteId);
      expect(aliceActive?.peerOnline).toBe(true);

      // Bob sends a prompt; Alice's bridge runs the synthetic agent
      // and emits stream events. The broadcaster forwards the
      // assistant_message; the tool_call gets redacted away.
      const promptResult = bob.sendAiSharePrompt({
        inviteId,
        body: "explain quicksort",
      });
      expect(promptResult.ok).toBe(true);

      // Bob's daemon should accumulate the timeline records that pass
      // the owner-side redactor: turn_started, user_message,
      // assistant_message, turn_completed (4 entries; the tool_call
      // is dropped on Alice's side before it ever reaches the wire).
      const bobTimeline = await waitFor(
        () => {
          const t = bob.listAiShareTimeline(inviteId);
          return t.length >= 4 ? t : null;
        },
        { label: "Bob's timeline buffer fills with 4 redacted records" },
      );
      const kinds = bobTimeline.map((r) => r.entry.kind);
      expect(kinds).toEqual([
        "turn_started",
        "user_message",
        "assistant_message",
        "turn_completed",
      ]);
      const userMsg = bobTimeline.find((r) => r.entry.kind === "user_message");
      expect(userMsg?.entry).toMatchObject({
        kind: "user_message",
        text: "explain quicksort",
        promptId: promptResult.ok ? promptResult.promptId : "?",
      });
      const assistantMsg = bobTimeline.find((r) => r.entry.kind === "assistant_message");
      expect(assistantMsg?.entry).toMatchObject({
        kind: "assistant_message",
        text: "echo: explain quicksort",
      });
      // Defense in depth: no tool_call ever reaches Bob's buffer.
      expect(kinds).not.toContain("tool_call");

      // Either side ends — Alice does it here.
      const endResult = alice.endAiShareSession(inviteId, "wrap");
      expect(endResult.ok).toBe(true);

      await waitFor(() => alice.listActiveAiShares().every((s) => s.inviteId !== inviteId), {
        label: "Alice's active list drops the share",
      });
      await waitFor(() => bob.listActiveAiShares().every((s) => s.inviteId !== inviteId), {
        label: "Bob's active list drops the share",
      });

      // === Audit transcripts on disk ===
      const aliceFile = aiShareTranscriptFilePath(aliceHome, inviteId);
      const bobFile = aiShareTranscriptFilePath(bobHome, inviteId);
      expect(aliceFile).not.toBeNull();
      expect(bobFile).not.toBeNull();
      const aliceLines = readFileSync(aliceFile as string, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      const bobLines = readFileSync(bobFile as string, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));

      // Alice's transcript: header (outbound), accept (peer), prompt
      // (received), 4 timeline (sent — same kinds as the wire), end (self).
      const aliceKinds = aliceLines.map((l) => `${l.kind}${l.origin ? `:${l.origin}` : ""}`);
      expect(aliceKinds).toContain("header");
      expect(aliceKinds).toContain("accept:peer");
      expect(aliceKinds).toContain("prompt:received");
      expect(aliceKinds.filter((k) => k === "timeline:sent").length).toBe(4);
      expect(aliceKinds).toContain("end:self");
      // Owner-side transcript still does not record tool_call (the
      // redactor short-circuits before the line is appended).
      const aliceTimelineEntries = aliceLines.filter((l) => l.kind === "timeline");
      expect(aliceTimelineEntries.map((l) => l.entry.kind).sort()).toEqual(
        ["assistant_message", "turn_completed", "turn_started", "user_message"].sort(),
      );

      // Bob's transcript: header (inbound), accept (self), prompt
      // (sent), 4 timeline (received), end (peer).
      const bobKinds = bobLines.map((l) => `${l.kind}${l.origin ? `:${l.origin}` : ""}`);
      expect(bobKinds).toContain("header");
      expect(bobKinds).toContain("accept:self");
      expect(bobKinds).toContain("prompt:sent");
      expect(bobKinds.filter((k) => k === "timeline:received").length).toBe(4);
      expect(bobKinds).toContain("end:peer");
      const bobHeader = bobLines.find((l) => l.kind === "header");
      expect(bobHeader.side).toBe("inbound");
      expect(bobHeader.invite.agentLabel).toBe("Alice's Claude");
    },
    E2E_TIMEOUT_MS,
  );

  test(
    "v3/a — owner ends the session when the prompt cap is hit",
    async () => {
      const relayEndpoint = mockRelay.endpoint();
      const aliceBridge = new InProcessAgentBridge([
        {
          agentId: "agent-alice-1",
          agentLabel: "Alice's Claude",
          agentProvider: "claude",
          lifecycle: "idle",
          cwd: "/home/alice/repo",
        },
      ]);

      const { svc: alice } = startService({
        ottieHome: aliceHome,
        serverId: "srv_alice_v3a",
        deviceLabel: "Alice's Mac",
        relayEndpoint,
        displayName: "Alice",
        agentBridge: aliceBridge,
      });
      const { svc: bob } = startService({
        ottieHome: bobHome,
        serverId: "srv_bob_v3a",
        deviceLabel: "Bob's Laptop",
        relayEndpoint,
        displayName: "Bob",
      });

      const offer = alice.generateFriendPairOffer();
      if (!offer) throw new Error("offer expected");
      const redeemPromise = bob.redeemFriendPairOffer({
        deepLinkOrOffer: offer.deepLink,
        timeoutMs: 10_000,
      });
      const candidate = await waitFor(() => alice.listPendingFriendPairCandidates()[0], {
        label: "Alice friend-pair candidate",
      });
      alice.approveFriendPair(candidate.nonceB64);
      await redeemPromise;
      await waitFor(() => alice.getFriendSessions().length === 1, {
        label: "Alice friend-sync up",
      });
      await waitFor(() => bob.getFriendSessions().length === 1, {
        label: "Bob friend-sync up",
      });

      // Tight cap so the test can exhaust it deterministically.
      const inviteResult = alice.sendAiShareInvite({
        peerRootPubKey: bob.requireBundle().stored.signPublicKeyB64,
        agentId: "agent-alice-1",
        agentLabel: "Alice's Claude",
        agentProvider: "claude",
        limits: {
          maxPrompts: 2,
          maxTokens: 100_000,
          // Use the schema's minimum so the timeout's well past test
          // duration without forcing us to mock setTimeout.
          sessionTimeoutMs: 60_000,
        },
      });
      expect(inviteResult.ok).toBe(true);
      if (!inviteResult.ok) return;
      const inviteId = inviteResult.invite.inviteId;
      // The friend's accept-row data should carry the limits through.
      await waitFor(
        () => bob.listInboundAiShareInvites().find((i) => i.inviteId === inviteId)?.limits,
        { label: "Bob sees limits on accept row" },
      );
      bob.acceptAiShareInvite(inviteId);
      await waitFor(() => alice.listActiveAiShares().some((s) => s.inviteId === inviteId), {
        label: "Alice marks share active",
      });

      // Two prompts allowed.
      bob.sendAiSharePrompt({ inviteId, body: "p1" });
      await waitFor(
        () => bob.listAiShareTimeline(inviteId).some((r) => r.entry.kind === "turn_completed"),
        { label: "first prompt completes" },
      );
      bob.sendAiSharePrompt({ inviteId, body: "p2" });
      await waitFor(
        () =>
          bob.listAiShareTimeline(inviteId).filter((r) => r.entry.kind === "turn_completed")
            .length === 2,
        { label: "second prompt completes" },
      );
      // Still active after the second.
      expect(alice.listActiveAiShares().some((s) => s.inviteId === inviteId)).toBe(true);

      // Third prompt trips the cap. Owner ends the share with reason
      // "prompt-limit"; Bob's daemon receives the end envelope and
      // drops the active row.
      bob.sendAiSharePrompt({ inviteId, body: "p3-over-cap" });

      await waitFor(() => alice.listActiveAiShares().every((s) => s.inviteId !== inviteId), {
        label: "Alice's active list drops the share after cap exhaustion",
      });
      await waitFor(() => bob.listActiveAiShares().every((s) => s.inviteId !== inviteId), {
        label: "Bob's active list drops the share via end envelope",
      });

      // Friend-side transcript records the peer-end with reason.
      const bobFile = aiShareTranscriptFilePath(bobHome, inviteId);
      expect(bobFile).not.toBeNull();
      const bobLines = readFileSync(bobFile as string, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      const endLine = bobLines.find((l) => l.kind === "end");
      expect(endLine).toBeDefined();
      expect(endLine.origin).toBe("peer");
      expect(endLine.reason).toBe("prompt-limit");
    },
    E2E_TIMEOUT_MS,
  );
});
