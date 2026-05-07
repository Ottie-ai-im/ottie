#!/usr/bin/env tsx
/**
 * Phase 3 friend-chat demo — runs the entire flow end-to-end on one
 * machine so you can SEE what happens between Alice's daemon and Bob's
 * daemon without needing two real machines.
 *
 * What this exercises:
 *   1. Two IdentityService instances ("Alice" + "Bob"), each with its own
 *      $OTTIE_HOME, real relay-transport, real friend-sync handlers,
 *      against an in-process mock Cloudflare Workers relay.
 *   2. Friend-pair flow (Phase 3.a):
 *        Alice generates an `ottie://friend-pair#…` deep link → Bob
 *        redeems → Alice approves → both `peers.json` files written.
 *   3. Friend-sync session establishment (Phase 3.b/1c):
 *        both daemons' dialers open long-lived encrypted chat sessions
 *        with each other (SIGMA-I, root-key signed) automatically right
 *        after pairing, no daemon restart.
 *   4. Live chat (Phase 3.b/1d):
 *        Bob sends "你好 Alice" → Alice's daemon receives + verifies
 *        the signature + persists. Alice replies → Bob persists.
 *   5. Restart durability:
 *        a fresh IdentityService on Alice's $OTTIE_HOME loads peers
 *        from disk and sees the full chat history.
 *
 * Run:
 *   cd packages/server && npx tsx scripts/friend-chat-demo.ts
 *
 * Exits 0 on success, non-zero on any failure (suitable for CI).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import pino from "pino";

import { IdentityService } from "../src/server/identity/identity-service.js";
import { peerListFilePath } from "../src/server/identity/peer-store.js";
import { friendChatFilePath } from "../src/server/identity/friend-chat-store.js";
import { MockRelay } from "../src/server/identity/test-utils/mock-relay.js";
import { startRelayTransport } from "../src/server/relay-transport.js";
import type {
  RelayConnectionHandler,
  RelayTransportController,
} from "../src/server/relay-transport.js";

// ----- console pretty-printing ------------------------------------------

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  alice: "\x1b[36m", // cyan
  bob: "\x1b[33m", // yellow
  step: "\x1b[35m", // magenta
  ok: "\x1b[32m", // green
  fail: "\x1b[31m", // red
  info: "\x1b[37m", // white
};

function step(num: number, title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n${COLORS.step}━━━ Step ${num}: ${title}${COLORS.reset}`);
}

function alice(line: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.alice}[Alice]${COLORS.reset} ${line}`);
}

function bob(line: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.bob}[Bob]  ${COLORS.reset} ${line}`);
}

function info(line: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.dim}        ${line}${COLORS.reset}`);
}

function success(line: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.ok}${COLORS.bold}        ✔ ${line}${COLORS.reset}`);
}

function fail(line: string): never {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.fail}${COLORS.bold}        ✘ ${line}${COLORS.reset}`);
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
  fail(`Timed out waiting for: ${args.label}`);
}

interface DaemonHarness {
  svc: IdentityService;
  transport: RelayTransportController;
  home: string;
  serverId: string;
  displayName: string;
}

function startDaemon(args: {
  home: string;
  serverId: string;
  deviceLabel: string;
  relayEndpoint: string;
  displayName: string;
}): DaemonHarness {
  const svc = new IdentityService({
    ottieHome: args.home,
    logger: SILENT_LOGGER,
    selfDeviceContext: { serverId: args.serverId, deviceLabel: args.deviceLabel },
    relayEndpoint: args.relayEndpoint,
  });
  // Initialize only on first boot — on restart the identity is already
  // on disk, IdentityService loads it in its constructor.
  if (svc.getState().kind === "uninitialized") {
    svc.initialize(args.displayName);
  }
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
  return {
    svc,
    transport,
    home: args.home,
    serverId: args.serverId,
    displayName: args.displayName,
  };
}

async function stopDaemon(d: DaemonHarness): Promise<void> {
  await d.svc.stopFriendSync();
  await d.svc.stopPeerSync();
  await d.transport.stop();
}

// ----- demo script ------------------------------------------------------

async function main(): Promise<void> {
  const aliceHome = mkdtempSync(path.join(os.tmpdir(), "ottie-demo-alice-"));
  const bobHome = mkdtempSync(path.join(os.tmpdir(), "ottie-demo-bob-"));
  const mockRelay = new MockRelay();
  await mockRelay.start();
  const relayEndpoint = mockRelay.endpoint();

  // eslint-disable-next-line no-console
  console.log(`${COLORS.bold}Phase 3 friend-chat demo${COLORS.reset}`);
  info(`Mock relay: ${relayEndpoint}`);
  info(`Alice $OTTIE_HOME: ${aliceHome}`);
  info(`Bob   $OTTIE_HOME: ${bobHome}`);

  let aliceD: DaemonHarness | null = null;
  let bobD: DaemonHarness | null = null;

  try {
    // -------- Step 1: boot two daemons + initialize identities -----
    step(1, "Boot two daemons + initialize identities");
    aliceD = startDaemon({
      home: aliceHome,
      serverId: "srv_alice_demo",
      deviceLabel: "Alice's Mac",
      relayEndpoint,
      displayName: "Alice",
    });
    bobD = startDaemon({
      home: bobHome,
      serverId: "srv_bob_demo",
      deviceLabel: "Bob's Laptop",
      relayEndpoint,
      displayName: "Bob",
    });
    alice(
      `identity loaded — root pubkey ${aliceD.svc.requireBundle().stored.signPublicKeyB64.slice(0, 12)}…`,
    );
    bob(
      `identity loaded — root pubkey ${bobD.svc.requireBundle().stored.signPublicKeyB64.slice(0, 12)}…`,
    );

    // -------- Step 2: Alice generates a friend-pair offer ----------
    step(2, "Alice generates a friend-pair offer (the QR Bob would scan)");
    const offer = aliceD.svc.generateFriendPairOffer();
    if (!offer) fail("offer generation returned null");
    alice(`offer ready, expires at ${offer.pending.offer.exp}`);
    info(`deep link (Bob would scan this as a QR):`);
    info(`  ${offer.deepLink}`);

    // -------- Step 3: Bob redeems through the relay ----------------
    step(3, "Bob redeems the link through the relay");
    bob("opening friend-pair socket and sending signed candidate…");
    const redeemPromise = bobD.svc.redeemFriendPairOffer({
      deepLinkOrOffer: offer.deepLink,
      timeoutMs: 10_000,
    });

    const candidate = await waitFor(() => aliceD!.svc.listPendingFriendPairCandidates()[0], {
      label: "Alice receives Bob's pending candidate",
    });
    alice(
      `pending request: "${candidate.peerDisplayName} (${candidate.peerRootSignPublicKeyB64.slice(0, 8)})"`,
    );

    // -------- Step 4: Alice approves --------------------------------
    step(4, "Alice approves the pending request");
    const approveResult = aliceD.svc.approveFriendPair(candidate.nonceB64);
    if (!approveResult.approved) fail(`approve failed: ${approveResult.error}`);
    alice("signed approval reply, sent over the relay");

    const outcome = await redeemPromise;
    if (outcome.status !== "paired") fail(`redeem status: ${outcome.status}`);
    bob(`paired with "${outcome.peer.peerDisplayName}"`);
    success("both peers.json files written");

    // -------- Step 5: friend-sync sessions come up ------------------
    step(5, "Wait for both sides' friend-sync sessions to establish");
    await waitFor(() => aliceD!.svc.getFriendSessions().length === 1, {
      label: "Alice has a friend-sync session with Bob",
    });
    await waitFor(() => bobD!.svc.getFriendSessions().length === 1, {
      label: "Bob has a friend-sync session with Alice",
    });
    alice(`session up: 1 active friend session`);
    bob(`session up: 1 active friend session`);

    // -------- Step 6: chat back and forth ---------------------------
    step(6, "Send chat messages both directions");
    const aliceRoot = aliceD.svc.requireBundle().stored.signPublicKeyB64;
    const bobRoot = bobD.svc.requireBundle().stored.signPublicKeyB64;

    bob('sending "你好 Alice"…');
    const r1 = bobD.svc.sendFriendChatMessage({ peerRootPubKey: aliceRoot, body: "你好 Alice" });
    if (!r1.ok) fail(`Bob's send failed: ${r1.error}`);

    const aliceMsgs = await waitFor(
      () => {
        const list = aliceD!.svc.listFriendChatMessages(bobRoot);
        return list.length === 1 ? list : null;
      },
      { label: "Alice receives Bob's message" },
    );
    alice(`received: "${aliceMsgs[0]?.message.body}"`);
    info(
      `        signature verified, author=${aliceMsgs[0]?.message.authorRootPubKey?.slice(0, 8)}… via device ${aliceMsgs[0]?.message.authorDeviceId}`,
    );

    alice('replying "你好 Bob, 收到!"…');
    const r2 = aliceD.svc.sendFriendChatMessage({
      peerRootPubKey: bobRoot,
      body: "你好 Bob, 收到!",
    });
    if (!r2.ok) fail(`Alice's send failed: ${r2.error}`);

    const bobMsgs = await waitFor(
      () => {
        const list = bobD!.svc.listFriendChatMessages(aliceRoot);
        return list.length === 2 ? list : null;
      },
      { label: "Bob receives Alice's reply" },
    );
    bob(`received: "${bobMsgs[1]?.message.body}"`);
    success(`bob's history: [${bobMsgs.map((m) => `"${m.message.body}"`).join(", ")}]`);

    // -------- Step 7: inspect persisted files -----------------------
    step(7, "Inspect on-disk state");
    const alicePeers = JSON.parse(readFileSync(peerListFilePath(aliceHome), "utf8"));
    const bobPeers = JSON.parse(readFileSync(peerListFilePath(bobHome), "utf8"));
    alice(
      `peers.json has ${alicePeers.peers.length} entry: "${alicePeers.peers[0].peerDisplayName}" via ${alicePeers.peers[0].peerServerId}`,
    );
    bob(
      `peers.json has ${bobPeers.peers.length} entry: "${bobPeers.peers[0].peerDisplayName}" via ${bobPeers.peers[0].peerServerId}`,
    );
    const aliceChatPath = friendChatFilePath(aliceHome, bobRoot);
    const bobChatPath = friendChatFilePath(bobHome, aliceRoot);
    info(`Alice's chat log: ${aliceChatPath}`);
    info(`Bob's chat log:   ${bobChatPath}`);
    info("first message line on Alice's side:");
    info(`  ${readFileSync(aliceChatPath, "utf8").split("\n")[0]?.slice(0, 200)}…`);

    // -------- Step 8: simulate a daemon restart on Alice's side -----
    step(8, "Restart Alice's daemon — confirm history survives");
    await stopDaemon(aliceD);
    info("alice's daemon stopped");
    const aliceReboot = startDaemon({
      home: aliceHome,
      serverId: "srv_alice_demo",
      deviceLabel: "Alice's Mac",
      relayEndpoint,
      displayName: "Alice",
    });
    aliceD = aliceReboot;
    const peersAfter = aliceReboot.svc.getPeerList();
    if (peersAfter.length !== 1) fail(`expected 1 peer after reboot, got ${peersAfter.length}`);
    alice(`peers.json reloaded: 1 friend ("${peersAfter[0]?.peerDisplayName}")`);
    const historyAfter = aliceReboot.svc.listFriendChatMessages(bobRoot);
    if (historyAfter.length !== 2) {
      fail(`expected 2 messages after reboot, got ${historyAfter.length}`);
    }
    alice(`chat history reloaded: [${historyAfter.map((m) => `"${m.message.body}"`).join(", ")}]`);
    success("history survived restart");

    // -------- Done ---------------------------------------------------
    step(9, "Demo complete");
    // eslint-disable-next-line no-console
    console.log(`${COLORS.ok}${COLORS.bold}\n  All steps passed. ✓${COLORS.reset}\n`);
  } finally {
    if (aliceD) await stopDaemon(aliceD);
    if (bobD) await stopDaemon(bobD);
    await mockRelay.stop();
    rmSync(aliceHome, { recursive: true, force: true });
    rmSync(bobHome, { recursive: true, force: true });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`${COLORS.fail}${COLORS.bold}\nDemo failed:${COLORS.reset}`, err);
  process.exitCode = 1;
});
