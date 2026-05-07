#!/usr/bin/env tsx
/**
 * Phase 3 friend-chat scenario sweep.
 *
 * Companion to friend-chat-demo.ts. The demo only walks the happy path
 * (pair → approve → 2 messages → restart). This sweep covers the
 * branches and known-broken edges so a single run answers "does the
 * Phase 3 chain still hold up under more than the smoothest possible
 * input?":
 *
 *   1. reject       — Alice rejects Bob's pair request.
 *                     Both peers.json files stay empty.
 *   2. cancel       — Alice generates an offer, cancels it before Bob
 *                     redeems. Bob's redeem returns errorCode=no_offer.
 *   3. expired      — Offer with ttlMs=100, redeem after 250ms.
 *                     errorCode=offer_expired (checked locally before
 *                     a socket is even opened).
 *   4. multi-friend — Alice pairs with Bob AND Carol. Independent
 *                     friend-sync sessions, independent chat logs,
 *                     no cross-talk.
 *   5. burst        — Bob fires 30 messages back-to-back at Alice.
 *                     Alice receives all 30 with monotonic seq.
 *   6. offline-send — Currently a known limitation. Pair → stop Bob →
 *                     Alice's send returns ok=false with /offline/.
 *                     This pins the broken behaviour as a regression
 *                     guard until Phase 3.b/2 (KV inbox) flips it.
 *   7. restart      — Pair + chat → kill Bob mid-conversation → Alice
 *                     gets offline errors → Bob comes back → both
 *                     sides resume sending.
 *
 * Each scenario uses fresh $OTTIE_HOME directories and a fresh serverId.
 * The mock relay is shared across scenarios for speed (its routing is
 * keyed on serverId + connectionId, so cross-scenario contamination is
 * impossible in practice).
 *
 * Run:
 *   cd packages/server && npx tsx scripts/friend-chat-scenarios.ts
 *   DEMO_DEBUG=1 npx tsx scripts/friend-chat-scenarios.ts  # verbose
 *
 * Exits 0 only if every scenario passes.
 */

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import pino from "pino";

import { IdentityService } from "../src/server/identity/identity-service.js";
import { MockRelay } from "../src/server/identity/test-utils/mock-relay.js";
import { startRelayTransport } from "../src/server/relay-transport.js";
import type {
  RelayConnectionHandler,
  RelayTransportController,
} from "../src/server/relay-transport.js";

// ----- console pretty-printing -----------------------------------------

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  green: "\x1b[32m",
  red: "\x1b[31m",
};

function header(line: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n${COLORS.magenta}${COLORS.bold}━━━ ${line}${COLORS.reset}`);
}

function info(line: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.dim}    ${line}${COLORS.reset}`);
}

function passLine(name: string, detail: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.green}${COLORS.bold}    ✔ ${name}${COLORS.reset} — ${detail}`);
}

function failLine(name: string, error: string): void {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.red}${COLORS.bold}    ✘ ${name}${COLORS.reset} — ${error}`);
}

const SILENT_LOGGER = pino({ level: process.env.DEMO_DEBUG === "1" ? "debug" : "silent" });

// ----- harness helpers --------------------------------------------------

interface DaemonHarness {
  svc: IdentityService;
  transport: RelayTransportController;
  home: string;
  serverId: string;
  displayName: string;
}

interface StartArgs {
  home: string;
  serverId: string;
  deviceLabel: string;
  relayEndpoint: string;
  displayName: string;
}

function startDaemon(args: StartArgs): DaemonHarness {
  const svc = new IdentityService({
    ottieHome: args.home,
    logger: SILENT_LOGGER,
    selfDeviceContext: { serverId: args.serverId, deviceLabel: args.deviceLabel },
    relayEndpoint: args.relayEndpoint,
  });
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

async function waitFor<T>(
  cb: () => T | undefined | null | false,
  args: { timeoutMs?: number; intervalMs?: number; label: string },
): Promise<T> {
  const deadline = Date.now() + (args.timeoutMs ?? 10_000);
  const interval = args.intervalMs ?? 25;
  while (Date.now() < deadline) {
    const result = cb();
    if (result) return result as T;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for: ${args.label}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeHome(label: string): string {
  return mkdtempSync(path.join(os.tmpdir(), `ottie-scenario-${label}-`));
}

/**
 * Pair two daemons end-to-end (offer + redeem + approve), wait for
 * both friend-sync sessions to come up, return a teardown handle.
 * Used by every scenario that needs a working friend channel.
 */
async function pair(
  origin: DaemonHarness,
  responder: DaemonHarness,
): Promise<{ originRoot: string; responderRoot: string }> {
  const offer = origin.svc.generateFriendPairOffer();
  if (!offer) throw new Error("offer generation returned null");

  const redeemPromise = responder.svc.redeemFriendPairOffer({
    deepLinkOrOffer: offer.deepLink,
    timeoutMs: 5_000,
  });

  const candidate = await waitFor(() => origin.svc.listPendingFriendPairCandidates()[0], {
    label: `${origin.displayName} sees ${responder.displayName}'s candidate`,
  });
  const approve = origin.svc.approveFriendPair(candidate.nonceB64);
  if (!approve.approved) throw new Error(`approve failed: ${approve.error}`);

  const outcome = await redeemPromise;
  if (outcome.status !== "paired") {
    throw new Error(`redeem outcome was ${outcome.status} (${outcome.errorMessage ?? "no msg"})`);
  }

  await waitFor(() => origin.svc.getFriendSessions().length === 1, {
    label: `${origin.displayName} friend-sync session`,
  });
  await waitFor(() => responder.svc.getFriendSessions().length === 1, {
    label: `${responder.displayName} friend-sync session`,
  });

  return {
    originRoot: origin.svc.requireBundle().stored.signPublicKeyB64,
    responderRoot: responder.svc.requireBundle().stored.signPublicKeyB64,
  };
}

// ----- scenario harness -------------------------------------------------

interface ScenarioResult {
  name: string;
  ok: boolean;
  detail: string;
  durationMs: number;
}

const results: ScenarioResult[] = [];

async function scenario(name: string, fn: () => Promise<string>): Promise<void> {
  header(name);
  const t0 = Date.now();
  try {
    const detail = await fn();
    const durationMs = Date.now() - t0;
    passLine(name, `${detail} (${durationMs}ms)`);
    results.push({ name, ok: true, detail, durationMs });
  } catch (err) {
    const durationMs = Date.now() - t0;
    const message = err instanceof Error ? err.message : String(err);
    failLine(name, message);
    results.push({ name, ok: false, detail: message, durationMs });
  }
}

// ----- scenarios --------------------------------------------------------

async function scenarioReject(relayEndpoint: string): Promise<string> {
  const aliceHome = makeHome("alice-reject");
  const bobHome = makeHome("bob-reject");
  let alice: DaemonHarness | null = null;
  let bob: DaemonHarness | null = null;
  try {
    alice = startDaemon({
      home: aliceHome,
      serverId: "srv_alice_reject",
      deviceLabel: "Alice's Mac",
      relayEndpoint,
      displayName: "Alice",
    });
    bob = startDaemon({
      home: bobHome,
      serverId: "srv_bob_reject",
      deviceLabel: "Bob's Laptop",
      relayEndpoint,
      displayName: "Bob",
    });

    const offer = alice.svc.generateFriendPairOffer();
    if (!offer) throw new Error("offer generation returned null");
    info(`Alice generated offer; Bob redeeming…`);

    const redeemPromise = bob.svc.redeemFriendPairOffer({
      deepLinkOrOffer: offer.deepLink,
      timeoutMs: 5_000,
    });

    const candidate = await waitFor(() => alice!.svc.listPendingFriendPairCandidates()[0], {
      label: "Alice sees Bob's candidate",
    });
    info(`Alice sees pending request from "${candidate.peerDisplayName}"; rejecting…`);

    const reject = alice.svc.rejectFriendPair(candidate.nonceB64, "test scenario reject");
    if (!reject.rejected) throw new Error(`rejectFriendPair returned error: ${reject.error}`);

    const outcome = await redeemPromise;
    if (outcome.status !== "rejected") {
      throw new Error(`expected status=rejected, got ${outcome.status}`);
    }
    if (outcome.errorCode !== "user_rejected") {
      throw new Error(`expected errorCode=user_rejected, got ${outcome.errorCode}`);
    }
    if (alice.svc.getPeerList().length !== 0) {
      throw new Error("Alice's peer list grew despite rejection");
    }
    if (bob.svc.getPeerList().length !== 0) {
      throw new Error("Bob's peer list grew despite rejection");
    }
    return `errorCode=${outcome.errorCode}, both peer lists empty`;
  } finally {
    if (alice) await stopDaemon(alice);
    if (bob) await stopDaemon(bob);
    rmSync(aliceHome, { recursive: true, force: true });
    rmSync(bobHome, { recursive: true, force: true });
  }
}

async function scenarioCancel(relayEndpoint: string): Promise<string> {
  const aliceHome = makeHome("alice-cancel");
  const bobHome = makeHome("bob-cancel");
  let alice: DaemonHarness | null = null;
  let bob: DaemonHarness | null = null;
  try {
    alice = startDaemon({
      home: aliceHome,
      serverId: "srv_alice_cancel",
      deviceLabel: "Alice's Mac",
      relayEndpoint,
      displayName: "Alice",
    });
    bob = startDaemon({
      home: bobHome,
      serverId: "srv_bob_cancel",
      deviceLabel: "Bob's Laptop",
      relayEndpoint,
      displayName: "Bob",
    });

    const offer = alice.svc.generateFriendPairOffer();
    if (!offer) throw new Error("offer generation returned null");
    info(`Alice generated offer; cancelling immediately…`);

    const cancelled = alice.svc.cancelFriendPairOffer(offer.pending.offer.nonceB64);
    if (!cancelled) throw new Error("cancelFriendPairOffer returned false");

    info(`Bob attempts redeem against the now-stale link…`);
    const outcome = await bob.svc.redeemFriendPairOffer({
      deepLinkOrOffer: offer.deepLink,
      timeoutMs: 3_000,
    });

    if (outcome.status !== "rejected") {
      throw new Error(`expected status=rejected, got ${outcome.status}`);
    }
    if (outcome.errorCode !== "no_offer") {
      throw new Error(`expected errorCode=no_offer, got ${outcome.errorCode}`);
    }
    return `errorCode=${outcome.errorCode}`;
  } finally {
    if (alice) await stopDaemon(alice);
    if (bob) await stopDaemon(bob);
    rmSync(aliceHome, { recursive: true, force: true });
    rmSync(bobHome, { recursive: true, force: true });
  }
}

async function scenarioExpired(relayEndpoint: string): Promise<string> {
  const aliceHome = makeHome("alice-exp");
  const bobHome = makeHome("bob-exp");
  let alice: DaemonHarness | null = null;
  let bob: DaemonHarness | null = null;
  try {
    alice = startDaemon({
      home: aliceHome,
      serverId: "srv_alice_exp",
      deviceLabel: "Alice's Mac",
      relayEndpoint,
      displayName: "Alice",
    });
    bob = startDaemon({
      home: bobHome,
      serverId: "srv_bob_exp",
      deviceLabel: "Bob's Laptop",
      relayEndpoint,
      displayName: "Bob",
    });

    const offer = alice.svc.generateFriendPairOffer({ ttlMs: 100 });
    if (!offer) throw new Error("offer generation returned null");
    info(`Offer minted with ttlMs=100; sleeping 250ms before redeem…`);
    await sleep(250);

    const outcome = await bob.svc.redeemFriendPairOffer({
      deepLinkOrOffer: offer.deepLink,
      timeoutMs: 3_000,
    });

    if (outcome.status !== "rejected") {
      throw new Error(`expected status=rejected, got ${outcome.status}`);
    }
    if (outcome.errorCode !== "offer_expired") {
      throw new Error(`expected errorCode=offer_expired, got ${outcome.errorCode}`);
    }
    return `errorCode=${outcome.errorCode}`;
  } finally {
    if (alice) await stopDaemon(alice);
    if (bob) await stopDaemon(bob);
    rmSync(aliceHome, { recursive: true, force: true });
    rmSync(bobHome, { recursive: true, force: true });
  }
}

async function scenarioMultiFriend(relayEndpoint: string): Promise<string> {
  const aliceHome = makeHome("alice-multi");
  const bobHome = makeHome("bob-multi");
  const carolHome = makeHome("carol-multi");
  let alice: DaemonHarness | null = null;
  let bob: DaemonHarness | null = null;
  let carol: DaemonHarness | null = null;
  try {
    alice = startDaemon({
      home: aliceHome,
      serverId: "srv_alice_multi",
      deviceLabel: "Alice's Mac",
      relayEndpoint,
      displayName: "Alice",
    });
    bob = startDaemon({
      home: bobHome,
      serverId: "srv_bob_multi",
      deviceLabel: "Bob's Laptop",
      relayEndpoint,
      displayName: "Bob",
    });
    carol = startDaemon({
      home: carolHome,
      serverId: "srv_carol_multi",
      deviceLabel: "Carol's Phone",
      relayEndpoint,
      displayName: "Carol",
    });

    info(`Pairing Alice↔Bob…`);
    const { responderRoot: bobRoot } = await pair(alice, bob);
    info(`Pairing Alice↔Carol…`);
    const { responderRoot: carolRoot } = await pair(alice, carol);

    if (alice.svc.getPeerList().length !== 2) {
      throw new Error(`Alice should have 2 peers, has ${alice.svc.getPeerList().length}`);
    }
    await waitFor(() => alice!.svc.getFriendSessions().length === 2, {
      label: "Alice has 2 friend-sync sessions",
    });

    const aliceRoot = alice.svc.requireBundle().stored.signPublicKeyB64;

    info(`Alice sends to Bob and Carol; checking logs don't bleed…`);
    const sendBob = alice.svc.sendFriendChatMessage({ peerRootPubKey: bobRoot, body: "hi Bob" });
    if (!sendBob.ok) throw new Error(`Alice→Bob send failed: ${sendBob.error}`);
    const sendCarol = alice.svc.sendFriendChatMessage({
      peerRootPubKey: carolRoot,
      body: "hi Carol",
    });
    if (!sendCarol.ok) throw new Error(`Alice→Carol send failed: ${sendCarol.error}`);

    await waitFor(() => bob!.svc.listFriendChatMessages(aliceRoot).length === 1, {
      label: "Bob receives 'hi Bob'",
    });
    await waitFor(() => carol!.svc.listFriendChatMessages(aliceRoot).length === 1, {
      label: "Carol receives 'hi Carol'",
    });

    const bobMsg = bob.svc.listFriendChatMessages(aliceRoot)[0]?.message.body;
    const carolMsg = carol.svc.listFriendChatMessages(aliceRoot)[0]?.message.body;
    if (bobMsg !== "hi Bob") throw new Error(`Bob got "${bobMsg}", expected "hi Bob"`);
    if (carolMsg !== "hi Carol") throw new Error(`Carol got "${carolMsg}", expected "hi Carol"`);

    // Crucial cross-talk check: Bob's log of Alice messages must contain
    // exactly 1 entry, NOT 2. Same for Carol. If routing is wrong both
    // would see both messages.
    if (bob.svc.listFriendChatMessages(aliceRoot).length !== 1) {
      throw new Error("Bob's log got the Carol-bound message too — routing crossed");
    }
    if (carol.svc.listFriendChatMessages(aliceRoot).length !== 1) {
      throw new Error("Carol's log got the Bob-bound message too — routing crossed");
    }
    return `2 friends, 2 sessions, no cross-talk`;
  } finally {
    if (alice) await stopDaemon(alice);
    if (bob) await stopDaemon(bob);
    if (carol) await stopDaemon(carol);
    rmSync(aliceHome, { recursive: true, force: true });
    rmSync(bobHome, { recursive: true, force: true });
    rmSync(carolHome, { recursive: true, force: true });
  }
}

async function scenarioBurst(relayEndpoint: string): Promise<string> {
  const aliceHome = makeHome("alice-burst");
  const bobHome = makeHome("bob-burst");
  let alice: DaemonHarness | null = null;
  let bob: DaemonHarness | null = null;
  try {
    alice = startDaemon({
      home: aliceHome,
      serverId: "srv_alice_burst",
      deviceLabel: "Alice's Mac",
      relayEndpoint,
      displayName: "Alice",
    });
    bob = startDaemon({
      home: bobHome,
      serverId: "srv_bob_burst",
      deviceLabel: "Bob's Laptop",
      relayEndpoint,
      displayName: "Bob",
    });

    const { originRoot: aliceRoot, responderRoot: bobRoot } = await pair(alice, bob);

    const N = 30;
    info(`Bob fires ${N} messages back-to-back; Alice must receive all in order…`);
    for (let i = 0; i < N; i++) {
      const r = bob.svc.sendFriendChatMessage({ peerRootPubKey: aliceRoot, body: `msg-${i}` });
      if (!r.ok) throw new Error(`Bob send ${i} failed: ${r.error}`);
    }

    await waitFor(() => alice!.svc.listFriendChatMessages(bobRoot).length === N, {
      label: `Alice receives all ${N}`,
      timeoutMs: 15_000,
    });

    const received = alice.svc.listFriendChatMessages(bobRoot);
    for (let i = 0; i < N; i++) {
      const got = received[i]?.message.body;
      const want = `msg-${i}`;
      if (got !== want) {
        throw new Error(`out-of-order at index ${i}: got "${got}", want "${want}"`);
      }
    }
    return `${N}/${N} delivered in order`;
  } finally {
    if (alice) await stopDaemon(alice);
    if (bob) await stopDaemon(bob);
    rmSync(aliceHome, { recursive: true, force: true });
    rmSync(bobHome, { recursive: true, force: true });
  }
}

async function scenarioOfflineSend(relayEndpoint: string): Promise<string> {
  const aliceHome = makeHome("alice-offline");
  const bobHome = makeHome("bob-offline");
  let alice: DaemonHarness | null = null;
  let bob: DaemonHarness | null = null;
  try {
    alice = startDaemon({
      home: aliceHome,
      serverId: "srv_alice_offline",
      deviceLabel: "Alice's Mac",
      relayEndpoint,
      displayName: "Alice",
    });
    bob = startDaemon({
      home: bobHome,
      serverId: "srv_bob_offline",
      deviceLabel: "Bob's Laptop",
      relayEndpoint,
      displayName: "Bob",
    });

    const { responderRoot: bobRoot } = await pair(alice, bob);
    info(`Pair complete; stopping Bob's daemon…`);

    await stopDaemon(bob);
    bob = null;

    await waitFor(() => alice!.svc.getFriendSessions().length === 0, {
      label: "Alice's session to Bob drops after Bob shuts down",
      timeoutMs: 10_000,
    });

    const result = alice.svc.sendFriendChatMessage({
      peerRootPubKey: bobRoot,
      body: "are you there?",
    });
    if (result.ok) {
      throw new Error(`expected ok=false; send unexpectedly succeeded`);
    }
    if (!/offline/i.test(result.error)) {
      throw new Error(`expected error matching /offline/, got "${result.error}"`);
    }
    return `error: "${result.error.slice(0, 60)}…" (KNOWN limitation, fix in Phase 3.b/2)`;
  } finally {
    if (alice) await stopDaemon(alice);
    if (bob) await stopDaemon(bob);
    rmSync(aliceHome, { recursive: true, force: true });
    rmSync(bobHome, { recursive: true, force: true });
  }
}

async function scenarioRestartMidChat(relayEndpoint: string): Promise<string> {
  const aliceHome = makeHome("alice-restart");
  const bobHome = makeHome("bob-restart");
  let alice: DaemonHarness | null = null;
  let bob: DaemonHarness | null = null;
  try {
    alice = startDaemon({
      home: aliceHome,
      serverId: "srv_alice_restart",
      deviceLabel: "Alice's Mac",
      relayEndpoint,
      displayName: "Alice",
    });
    bob = startDaemon({
      home: bobHome,
      serverId: "srv_bob_restart",
      deviceLabel: "Bob's Laptop",
      relayEndpoint,
      displayName: "Bob",
    });

    const { originRoot: aliceRoot, responderRoot: bobRoot } = await pair(alice, bob);

    info(`Pre-restart: Alice → Bob "ping"…`);
    const pre = alice.svc.sendFriendChatMessage({ peerRootPubKey: bobRoot, body: "ping" });
    if (!pre.ok) throw new Error(`pre-restart send failed: ${pre.error}`);
    await waitFor(() => bob!.svc.listFriendChatMessages(aliceRoot).length === 1, {
      label: "Bob receives 'ping'",
    });

    info(`Killing Bob's daemon mid-chat…`);
    await stopDaemon(bob);
    bob = null;

    await waitFor(() => alice!.svc.getFriendSessions().length === 0, {
      label: "Alice's session drops",
      timeoutMs: 10_000,
    });

    info(`Alice tries 3 sends while Bob is down — all should report offline…`);
    for (let i = 0; i < 3; i++) {
      const r = alice.svc.sendFriendChatMessage({
        peerRootPubKey: bobRoot,
        body: `dropped-${i}`,
      });
      if (r.ok) throw new Error(`offline send ${i} should have failed but ok=true`);
      if (!/offline/i.test(r.error)) {
        throw new Error(`offline send ${i} returned non-offline error: ${r.error}`);
      }
    }

    info(`Restarting Bob (same $OTTIE_HOME, same serverId)…`);
    bob = startDaemon({
      home: bobHome,
      serverId: "srv_bob_restart",
      deviceLabel: "Bob's Laptop",
      relayEndpoint,
      displayName: "Bob",
    });

    await waitFor(() => alice!.svc.getFriendSessions().length === 1, {
      label: "Alice's session to Bob comes back",
      timeoutMs: 15_000,
    });
    await waitFor(() => bob!.svc.getFriendSessions().length === 1, {
      label: "Bob's session to Alice comes back",
      timeoutMs: 15_000,
    });

    info(`Resumed: Alice → Bob "back?" and Bob → Alice "yep"…`);
    const r1 = alice.svc.sendFriendChatMessage({ peerRootPubKey: bobRoot, body: "back?" });
    if (!r1.ok) throw new Error(`post-restart Alice send failed: ${r1.error}`);
    await waitFor(() => bob!.svc.listFriendChatMessages(aliceRoot).length === 2, {
      label: "Bob receives 'back?'",
    });
    const r2 = bob.svc.sendFriendChatMessage({ peerRootPubKey: aliceRoot, body: "yep" });
    if (!r2.ok) throw new Error(`post-restart Bob send failed: ${r2.error}`);
    await waitFor(() => alice!.svc.listFriendChatMessages(bobRoot).length === 2, {
      label: "Alice receives 'yep'",
    });

    // Note: the "dropped-N" messages are NOT in either log — that's the
    // documented offline-send limitation. We've already asserted those
    // sends returned offline errors. Phase 3.b/2 will turn them into
    // queued-then-delivered.
    return `dropped 3 while down, resumed cleanly with 'back?' / 'yep'`;
  } finally {
    if (alice) await stopDaemon(alice);
    if (bob) await stopDaemon(bob);
    rmSync(aliceHome, { recursive: true, force: true });
    rmSync(bobHome, { recursive: true, force: true });
  }
}

// ----- main -------------------------------------------------------------

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`${COLORS.bold}Phase 3 friend-chat scenario sweep${COLORS.reset}`);

  const mockRelay = new MockRelay();
  await mockRelay.start();
  const relayEndpoint = mockRelay.endpoint();
  info(`Mock relay: ${relayEndpoint}`);

  try {
    await scenario("1. reject", () => scenarioReject(relayEndpoint));
    await scenario("2. cancel offer", () => scenarioCancel(relayEndpoint));
    await scenario("3. expired offer", () => scenarioExpired(relayEndpoint));
    await scenario("4. multi-friend (Alice ↔ Bob + Alice ↔ Carol)", () =>
      scenarioMultiFriend(relayEndpoint),
    );
    await scenario("5. burst messages (30 in order)", () => scenarioBurst(relayEndpoint));
    await scenario("6. offline send (known limitation)", () => scenarioOfflineSend(relayEndpoint));
    await scenario("7. restart mid-chat", () => scenarioRestartMidChat(relayEndpoint));
  } finally {
    await mockRelay.stop();
  }

  // ----- summary --------------------------------------------------------
  // eslint-disable-next-line no-console
  console.log(`\n${COLORS.bold}━━━ Summary${COLORS.reset}`);
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  for (const r of results) {
    const tag = r.ok
      ? `${COLORS.green}PASS${COLORS.reset}`
      : `${COLORS.red}${COLORS.bold}FAIL${COLORS.reset}`;
    // eslint-disable-next-line no-console
    console.log(`  ${tag}  ${r.name.padEnd(48)} ${COLORS.dim}${r.durationMs}ms${COLORS.reset}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    `\n  ${passed}/${results.length} scenarios passed${
      failed > 0 ? `, ${COLORS.red}${COLORS.bold}${failed} failed${COLORS.reset}` : ""
    }\n`,
  );

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`${COLORS.red}${COLORS.bold}\nScenario sweep crashed:${COLORS.reset}`, err);
  process.exitCode = 1;
});
