# Agent handoff — read this first

You are Claude Opus 4.7 picking up a long-running collaboration. The
previous you ran out of context. This file is the single source of
truth — everything you need to continue is either here or pointed to
from here.

## TL;DR (read this if nothing else)

- **Project**: ottie — local AI-agent control app (TypeScript + Expo
  RN + Tauri + Node daemon). Working repo: `packages/server`,
  `packages/app`, `packages/relay`, etc. GitHub: `Ottie-ai-im/ottie`.
- **Side-quest in flight**: extend ottie into multi-user collab.
  Design doc: [`docs/MULTI-USER-COLLABORATION-DESIGN.md`](./MULTI-USER-COLLABORATION-DESIGN.md).
- **Current state**: **Phases 1 + 2 + 3.a + 3.b functional MVP all
  shipped end-to-end**. The product loop works today: pair a friend
  via QR/link, both sides approve, both daemons auto-establish a
  long-lived encrypted chat session, "Open chat" from
  /settings/identity → real-time text messaging persists on both
  sides and survives restart. 431 tests across 45 files green
  (5 consecutive stability runs); whole-workspace typecheck clean;
  oxlint clean on the 13 critical Phase 3 files. Two real-WebSocket
  two-daemon e2e tests prove pairing AND chat delivery end-to-end.
- **What you can run RIGHT NOW** (no code changes needed):
  Two daemons + their UIs → tap `+` → Add friend → Pair with friend
  → both Approve → tap "Open chat" → type → see each other's
  messages within ~2s.
- **Next work** (all are Phase 3 enhancements, the loop already
  closes without them — pick by user-value):
  1. Real-machine validation by Wendell. Worth doing FIRST before
     more code. Confirm UX, find papercuts.
  2. Push subscriptions to replace 2s polling on the chat screen
     (zero-delay receive). New WS RPC + chat subscription manager
     hookup. Mid-size.
  3. Chats-list integration so friends appear next to agents in
     the main chats list, not buried under Settings → Friends.
     Mid-size; touches the existing chat-room-index-store.
  4. Read receipts (✓ / ✓✓ / seen-at). Send a "read up to seq N"
     envelope through the same friend-sync session on viewer side.
     Small.
  5. Phase 3.b/2 — Cloudflare KV offline inbox. Currently
     `sendFriendChatMessage` returns "offline" error when the
     friend's daemon is down. KV inbox lets the sender enqueue,
     the recipient drains on next online. Requires changes to
     `packages/relay/` Worker + a per-pair encryption scheme
     (since session keys are ephemeral). Larger scope.
  6. Phase 4 — AI sharing. Build on top of friend-sync session.
     See design doc §11 Phase 4 + §7.5.
- **User**: Wendell. Native Mandarin speaker, talks to you in 中文.
  Wants direct answers + small commits + tests for everything. He
  pushed back hard once when I designed without reading existing
  code first — always read before planning.

## 1. How to read what's already done

```
git log --oneline -50
```

Look for `feat(identity):` and `feat(app):` commits. Each Phase 2
sub-commit has a long body explaining what it added + what's left.

The design doc's §17 ("Implementation Status") is the canonical
checklist of "done vs. not done" — keep updating it when you finish
work. §16 ("Concept Clarifications") pins three confusions to avoid
(multi-device ≠ "千军万马", etc.) — don't let those drift back in.

## 2. User preferences — non-negotiable

These are saved in your auto-memory at
`/Users/a123456/.claude/projects/-Users-a123456-Downloads-ottie-workspace/memory/`.
Highlights:

- **No purple in UI** — never use as accent or decorative color.
- **Research isolation** — never clone or copy 3rd-party project code
  into the working directory. Specifically, HuLa was researched for
  inspiration but its code MUST stay out of this repo. Public
  protocol references (Signal X3DH, SIGMA-I, Matrix federation) are
  fine to cite by name in comments.
- **Read existing code before writing plans** — when working in
  this project, always read README/CLAUDE.md/relevant code first.
  Don't design from external research alone.
- **Bilingual i18n** — every user-visible string change updates both
  `packages/app/src/i18n/locales/en.json` and `zh.json`.
- **Email**: `wwwwendell638@gmail.com`.

## 3. Critical commands

```bash
# Always run after changes:
cd /Users/a123456/Downloads/ottie-workspace/ottie
npm run typecheck                                   # whole workspace
npm run format:files -- <changed files>             # not full format
npm run lint -- <changed files>                     # not full lint

# Targeted vitest (preferred — full suite is heavy):
cd packages/server && npx vitest run src/server/identity/  # all identity tests
cd packages/server && npx vitest run src/server/identity/foo.test.ts  # one file
cd packages/server && npx vitest run --reporter=verbose -t "test name"

# Stability check (vitest has occasional parallel flakes):
for i in 1 2 3 4 5; do
  npx vitest run src/server/identity/ src/server/relay-transport.test.ts \
    2>&1 | grep "Tests.*passed\|failed"
done

# Commits use --no-verify because lefthook fires full-repo lint
# (141 pre-existing errors). User has authorized this for the
# multi-user-collab branch:
git commit --no-verify -m "feat(...): subject"
git push                                            # push every step
```

**Daemon rules** (from CLAUDE.md):

- NEVER restart the user's main daemon on port 6868 — it manages
  running agents. Tests use `OTTIE_HOME=/tmp/...` + a different
  `OTTIE_LISTEN` port.
- NEVER run the full test suite (`npm run test`) — too heavy. Run
  targeted vitest files only.

## 4. Tech-stack invariants — do not re-litigate

|                           | What it is                                                 | Why we don't change it                                                                                                               |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Relay                     | Cloudflare Workers at `relay.claws.company:443`            | Free tier covers personal-scale. User vetted SimpleX as alternative; ruled out (China network, AI-share friction, 50% rewrite cost). |
| App-layer encryption      | NaCl box (Curve25519 + XSalsa20-Poly1305)                  | Standard, audited, exposed via `@ottie/relay/e2ee`.                                                                                  |
| Signatures                | Ed25519 throughout (root, self-device, events, peer-hello) | Same.                                                                                                                                |
| Key serialization on disk | JWK base64url (43-char raw)                                | Matches existing daemon-keypair pattern.                                                                                             |
| Peer-sync handshake       | SIGMA-I (sign ephPubKey under long-term key)               | Mutual auth + forward secrecy + MitM-resistant.                                                                                      |
| License                   | AGPL-3.0                                                   | User explicitly OK with traction; project is open source.                                                                            |

If you find yourself wanting to change one of these, **stop and ask
the user first** — they cost design rounds in earlier conversations.

## 5. Architecture cheat sheet

```
$OTTIE_HOME/
  identity/
    root.json           — root identity (Ed25519 keypair + displayName)
    self-device.json    — this daemon's signing keypair
    devices.json        — every device this user owns (root-signed each)
    events.json         — append-only log of device-list events
                          (Ed25519-signed by emitter's self-device key)

Relay routing (Cloudflare Workers, V2 protocol):
  role=server (no connectionId)        — daemon control socket per serverId
  role=server&connectionId=X           — daemon per-connection data socket
  role=client&connectionId=X           — client side of connectionId X
  Custom prefixes (relay-transport.ts connectionHandlers extension):
    "device-link:<nonce>"  — Phase 2.d redemption (one-shot)
    "peer-sync:<nonce>"    — Phase 2.f long-lived peer session
    "friend-pair:<nonce>"  — Phase 3.a redemption (one-shot)
    "friend-sync:<nonce>"  — Phase 3.b long-lived chat session
```

Key code locations:

```
packages/server/src/server/identity/
  identity-types.ts                       — RootIdentity schema
  root-identity-store.ts                  — load/create root.json
  self-device-store.ts                    — load/create/import self-device.json
  device-types.ts                         — Device + DeviceList schemas
  device-list-store.ts                    — load/save devices.json + buildAuthorizedDevice (root-sign)
  device-list-event-types.ts              — event schemas
  device-list-event.ts                    — sign/verify/applyDeviceListEvent (pure)
  device-list-event-store.ts              — events.json append-only log
  device-link-{types,redeem,redeem-types}.ts
                                          — Phase 2.d crypto core (NaCl box redemption)
  device-link-pending-store.ts            — outstanding offers (memory)
  device-link-pending-candidate-store.ts  — received candidates awaiting approval (memory)
  device-link-receiver.ts                 — RelayConnectionHandler for "device-link:" prefix
  device-link-sender.ts                   — outbound redemption + WS RPC
  device-link-approve{-types,}.ts         — Phase 2.e approval reply (sign + encrypt)
  peer-sync-{types,handshake}.ts          — SIGMA-I crypto (peer-hello + ECDH frame)
  peer-session-registry.ts                — active peer sessions (memory)
  peer-sync-receiver.ts                   — RelayConnectionHandler for "peer-sync:"
  peer-sync-dialer.ts                     — outbound peer-daemon connections + reconnect
  peer-types.ts                           — Phase 3.a Peer schema (cross-identity friend list)
  peer-store.ts                           — load/save/upsert/remove peers.json
  friend-pair-{types,redeem-types,redeem}.ts
                                          — Phase 3.a/0 cross-identity SIGMA-I crypto
  friend-pair-pending-store.ts            — Phase 3.a/1 outstanding friend offers (memory)
  friend-pair-pending-candidate-store.ts  — Phase 3.a/2 received candidates (memory)
  friend-pair-receiver.ts                 — RelayConnectionHandler for "friend-pair:"
  friend-pair-sender.ts                   — Phase 3.a/2 outbound redemption + 3.a/3 approval reply
  friend-pair-approve{-types,}.ts         — Phase 3.a/3 approval reply (sign + encrypt)
  friend-sync-{types,handshake}.ts        — Phase 3.b/1b SIGMA-I (root-key signed) cross-identity
  friend-session-registry.ts              — Phase 3.b/1c active friend sessions (memory)
  friend-sync-receiver.ts                 — RelayConnectionHandler for "friend-sync:"
  friend-sync-dialer.ts                   — outbound friend-daemon connections + reconnect
                                            (NOTE: tie-breaks on root pubkey — only smaller side dials)
  friend-chat-types.ts                    — Phase 3.b/1d chat envelope schema + canonical signed payload
  friend-chat-crypto.ts                   — sign/verify chat-message envelopes
  friend-chat-store.ts                    — append-only $OTTIE_HOME/chat/friends/<digest>.jsonl
  identity-service.ts                     — top-level wrapper used by bootstrap + WS RPCs
                                            (includes generateFriendPairOffer, redeemFriendPairOffer,
                                             approveFriendPair, rejectFriendPair, sendFriendChatMessage,
                                             listFriendChatMessages, startFriendSync, …)
  identity-rpc-schemas.ts                 — wire shapes for /identity, /device, /device/link,
                                            /device/remove, /friend/pair/{generate,cancel,redeem,
                                            candidates,approve,reject}, /friend/list, /chat/p2p/{send,list}
  test-utils/mock-relay.ts                — in-process Cloudflare-relay clone for tests
  *.test.ts                               — collocated tests
  friend-pair-mock-relay.e2e.test.ts      — full real-WebSocket two-daemon pair flow
  friend-chat-mock-relay.e2e.test.ts      — full real-WebSocket two-daemon chat flow

packages/server/src/server/
  relay-transport.ts                      — daemon ↔ relay glue + connectionHandlers extension
  bootstrap.ts                            — wires it all together at daemon startup
  session.ts                              — WS RPC handlers; identity dispatch is dispatchIdentityMessage()
                                            (look for handleDevice* methods)

packages/server/src/client/daemon-client.ts
                                          — DaemonClient class with all WS RPC client methods
                                            (deviceLinkGenerate / Redeem / Approve / Reject /
                                            Candidates / Cancel / deviceRemove / identityGet / …)

packages/server/src/shared/messages.ts   — Zod-validated WS message union; new RPCs add here

packages/app/src/app/
  onboarding/add-device.tsx               — Phase 2.c QR generator (this user, new device)
  onboarding/link-existing-device.tsx     — Phase 2.d paste-link redeem
  onboarding/add-friend.tsx               — Phase 3.a QR generator for friend pairing
  onboarding/redeem-friend-link.tsx       — Phase 3.a paste-link redeem for friend pairing
  settings/identity.tsx                   — main "identity & devices" page
                                            (includes DeviceRow + PendingCandidatesSection +
                                             FriendListSection with "Open chat" button +
                                             PendingFriendRequestsSection)
  h/[serverId]/friend/[peerRootPubKey].tsx
                                          — Phase 3.b/3 friend chat screen
                                            (poll-based, 2s interval; standalone, NOT integrated
                                             into the workspace tab system yet)

packages/app/src/actions/
  ids.ts                                  — ActionId union (chat.add.{addFriend, redeemFriendLink} added)
  chat-row-actions.ts                     — registers the action handlers

packages/app/src/components/top-right-add-menu.tsx
                                          — 8-item dropdown for "+" button
                                            (newChat / scanToPair / joinHost / createWorkspace /
                                             addDevice / linkToExisting / addFriend / redeemFriendLink)

packages/app/src/i18n/locales/{en,zh}.json — all UI strings (bilingual, MUST update both)
```

## 6. What to do next

Phase 3 (friend pairing + chat) is **functionally complete** —
end-to-end. The user can pair a friend, both Approve, then chat
in real time. Don't try to "implement Phase 3" again — read what's
there.

**Before writing more code, ASK Wendell what to do next.** Likely
candidates:

1. **Real-machine validation** — he hasn't yet run the full flow on
   two physical machines. Several things might surface only there
   (relay endpoint config, mobile QR scanning, daemon lifecycle).
2. **Push subscriptions** to replace the chat screen's 2s polling
   with a server-pushed event stream. Look at
   `chat-subscription-manager.ts` for the existing pattern; add a
   parallel `friend-chat-subscription-manager` that fires when
   `IdentityService.handleInboundFriendSyncPayload` persists.
3. **Chats-list integration** so friends appear next to agents in
   the main chats tab. Currently friends are only reachable via
   `/settings/identity` → Friends → Open chat. Touches the existing
   chat-room-index-store and the chats list page.
4. **Read receipts** (✓ / ✓✓ / seen-at). Recipient sends a
   `read-cursor` envelope through the same friend-sync session
   when the user views a message. Sender persists the cursor in a
   sidecar file and renders the badge.
5. **Phase 3.b/2 — Cloudflare KV offline inbox**. Larger scope,
   needs `packages/relay/` Worker changes + a per-pair encryption
   scheme (the friend-sync session shared key is ephemeral and
   doesn't survive offline). Defer until requested.
6. **Phase 4 — AI sharing**. See design doc §11 + §7.5.

**Read first when you do start coding:**

1. Design doc §17 — current implementation status. Update on every
   sub-commit.
2. The Phase 3.a + 3.b code (`friend-pair-*`, `friend-sync-*`,
   `friend-chat-*`) — there's a LOT here, mirror the patterns,
   don't reinvent.
3. The mock-relay e2e tests
   (`friend-pair-mock-relay.e2e.test.ts`,
   `friend-chat-mock-relay.e2e.test.ts`) — they're the canonical
   reference for how the full flow behaves end-to-end.

**Don't**:

- Jump to UI before the daemon-level path works + has tests.
- Change tech-stack invariants (§4 of this doc).
- Copy HuLa code into the working tree.
- Auto-route AI shares in Phase 4 (§7.5 — owner picks every time).
- Forget the friend-sync dialer's tie-break: only the side with
  the _smaller_ root pubkey opens an outbound dial. Tests that
  exercise the dialer end-to-end need to mint keypairs in a way
  that satisfies this ordering (see `mintOrderedRootKeyPair` in
  `friend-sync-dialer.test.ts`).
- Forget that `peers.json` may be in load-failed state (corrupt) —
  IdentityService's identity flow tolerates this; new code paths
  must too.

## 6.5. Open known limitations to call out before claiming "done"

- **Offline send** returns an error. Phase 3.b/2's KV inbox is the
  fix. Until then, both daemons must be online for a message to be
  delivered.
- **Polling delay**. The chat screen polls every 2s; inbound messages
  show up with up to 2s of UI lag even though the daemon receives
  them immediately. Fix: push subscriptions.
- **No multi-device fan-out for friend chat**. If Wendell's laptop
  receives a message while his phone is also online and looking at
  the chat screen, the phone polls but won't see the new message
  until its NEXT poll AFTER the laptop has fanned the message out
  via Phase 2.f peer-sync. Phase 2.f currently only syncs device-list
  events, not chat history. Phase 3.b/3-multidevice is the fix.
- **Friend chat history isn't in the agent chats list**. Reachable
  only via Settings → Friends → Open chat. Wendell is aware.

## 7. Phase 4 + 5 quick reminders (so you don't drift)

- Phase 4 (AI sharing) — every share triggers a 2-step modal on
  every online owner-device (§7.5.1–7.5.3). NO auto-route, NO
  per-friend defaults, NO mid-session switching.
- Phase 4 routing detail decided: a friend's request lands on
  exactly ONE owner-daemon (the one the owner picks). Other owner-
  daemons don't pool compute or share AI quotas.
- Phase 5: block / unblock, display name updates (rate-limited 24h
  per §13 Q9), limits exhaustion UI, transparency mode toggle (§13
  Q10).

## 8. Common confusions that were already cleared up (don't re-explain)

- "千军万马" — multi-device is NOT a way to scale AI capacity to
  friends. See §16.1.
- Adding friends is identity-to-identity, not device-to-device.
  Setting up multi-device first is NOT a prerequisite for adding
  friends. See §16.2.
- Daemons sync state but don't pool compute. See §16.3.
- Cloudflare Workers usage means USERS don't sign up for Cloudflare
  accounts. They never see Cloudflare. The user's own Cloudflare
  account is the dev-side dependency only.

## 9. If you're confused about state, run this

```bash
cd /Users/a123456/Downloads/ottie-workspace/ottie
git log --oneline -30
git diff HEAD~5
cat docs/MULTI-USER-COLLABORATION-DESIGN.md | head -100
ls packages/server/src/server/identity/
cd packages/server && npx vitest run src/server/identity/ src/server/relay-transport.test.ts src/server/chat/ 2>&1 | tail -8
```

The combination of recent commits + design doc + identity dir + test
output tells you everything. Don't ask the user questions you can
answer from these.

Expected test count as of the last commit on `org/main`: **431
across 45 files**. If yours differs, check git log to see whether
work landed since this handoff was written.

## 10. Phase 3 commit chain (chronological reference)

If you need to dig into how Phase 3 was built:

```
9bfbf24a  3.b/3 UI v1   — chat screen + Open chat
a2a89e1d  3.b/1d        — live messaging (envelope + persist + WS RPC + e2e)
eb2d30c9  docs           — Phase 3.b status update
8dddcca0  3.b/1c        — friend-sync receiver + dialer + session registry
fb045901  3.b/1b        — friend-sync handshake (cross-identity SIGMA-I)
225cf504  3.b/1a        — peer routing info capture (peerServerId on Peer)
f90dfdf6  3.b/0         — p2p chat schema additions
f25d09cc  3.a UI        — friend-pair QR + paste-link + Friends section
0f2798b6  3.a/3b        — bilateral confirm + Peer persistence
c9b58a08  3.a/3a        — Peer schema + peers.json + approve crypto core
c8012385  3.a/2         — friend-pair receiver + sender + WS RPC
f6928020  3.a/1         — friend-pair offer generation + WS RPCs
7b129509  3.a/0         — friend-pair offer schema + ECDH crypto core
```

Each commit body explains its scope + the bug fixes it surfaced.
Read those before duplicating work.
