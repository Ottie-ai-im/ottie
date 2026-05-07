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
- **Current state**: **Phases 1 + 2 + 3.a + 3.b including 3.b/2
  (offline inbox) all shipped + production-validated end-to-end**.
  The product loop works today: pair a friend via QR/link, both
  approve, both daemons auto-establish a long-lived encrypted chat
  session, "Open chat" → real-time text. **AND** when the recipient
  is offline the sender's daemon NaCl-boxes the envelope to the
  recipient's identity X25519 pubkey and POSTs it to the relay's KV
  inbox; the recipient's daemon drains + decrypts on next connect.
  Outgoing bubbles tag `delivered` vs `queued (offline)`.
  380 identity tests / 40 files + 42 relay tests / 5 files green;
  whole-workspace typecheck clean. Two real-WebSocket e2e tests
  cover live pairing + chat. Phase 3.b/2 was validated in a real
  Wendell ↔ Bob ↔ relay.claws.company round-trip on 2026-05-07.
- **What you can run RIGHT NOW** (no code changes needed):
  Two daemons + their UIs → tap `+` → Add friend → both Approve
  → tap "Open chat" → type → see each other's messages within ~2s.
  Then `kill <bob daemon>` → Wendell sends → bubble shows
  "queued (offline)". Restart bob → his daemon's `startInboxReceiver`
  drains the inbox on boot → message lands in his chat history
  within seconds.
- **Next work** (no longer in Phase 3 scope — those items pick
  the next direction; user picks by value):
  1. ~~Multi-device X25519 sync~~ — ✅ done. Already worked
     end-to-end as a side-effect of 3.b/2a's design; today's
     commit added the explicit e2e assertion proving it. See
     §6.1 below.
  2. ~~Phase 4 — AI sharing — design + v1~~ — ✅ design done
     (§11.5 of the design doc) and v1 (invitation handshake)
     shipped. v2 (live agent timeline + prompt injection +
     active-share banner) and v3 (real agent picker + §7.5
     multi-daemon flow) are the remaining Phase 4 work.
  3. ~~Bell button → notification center~~ — ✅ v1 done. Bell
     polls friend-pair candidates from the active host and opens
     a panel on tap; rows deep-link to `/settings/identity`. See
     §6.3 below for v2 ideas (multi-host roll-up, Phase 4 share
     invitations, mobile parity).
  4. **lint-error cleanup** — partially done. v1 cleared all 29
     `no-explicit-any` + a few catch-blocks → 115 errors
     remaining (was 137). Mostly `react-perf` (63 — mechanical
     useMemo extractions) + `complexity / max-depth / nesting`
     (~30 — real refactor judgment). See §6.4 below for the
     plan to clear the rest.
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
                                            (Phase 3.b/2c: deliveryStatus optional field added)
  friend-inbox-types.ts                   — Phase 3.b/2c InboxBlob v1 schema (NaCl-box wrapper)
  friend-inbox-crypto.ts                  — encrypt/decrypt InboxBlob (asymmetric NaCl box)
  friend-inbox-client.ts                  — Phase 3.b/2c+2d HTTP client for relay inbox
                                            (postInbox / getInbox / deleteInbox + auth payload mirrors)
  friend-inbox-cursor-store.ts            — Phase 3.b/2d $OTTIE_HOME/identity/inbox-cursor.json
  friend-inbox-receiver.ts                — Phase 3.b/2d processInboxOnce orchestrator
  identity-service.ts                     — top-level wrapper used by bootstrap + WS RPCs
                                            (includes generateFriendPairOffer, redeemFriendPairOffer,
                                             approveFriendPair, rejectFriendPair, sendFriendChatMessage,
                                             listFriendChatMessages, startFriendSync,
                                             startInboxReceiver, kickInboxOnce, …)
  identity-rpc-schemas.ts                 — wire shapes for /identity, /device, /device/link,
                                            /device/remove, /friend/pair/{generate,cancel,redeem,
                                            candidates,approve,reject}, /friend/list, /chat/p2p/{send,list}
  test-utils/mock-relay.ts                — in-process Cloudflare-relay clone for tests
  *.test.ts                               — collocated tests
  friend-pair-mock-relay.e2e.test.ts      — full real-WebSocket two-daemon pair flow
  friend-chat-mock-relay.e2e.test.ts      — full real-WebSocket two-daemon chat flow

packages/server/src/server/
  relay-transport.ts                      — daemon ↔ relay glue + connectionHandlers extension
                                            (3.b/2 follow-up: connectionHandlers now accepts a getter
                                             so newly-loaded identity adds inbound peer/friend-sync
                                             handlers without daemon restart)
  bootstrap.ts                            — wires it all together at daemon startup
                                            (3.b/2d: calls startInboxReceiver alongside startFriendSync)
  session.ts                              — WS RPC handlers; identity dispatch is dispatchIdentityMessage()
                                            (look for handleDevice* methods. chat/p2p/send is now async)

packages/relay/src/
  cloudflare-adapter.ts                   — Worker entry; routes /inbox/* to handleInboxRequest before /ws
  inbox-types.ts                          — Phase 3.b/2b shared constants + canonical payloads
                                            (inboxFetchAuthPayload / inboxDeleteAuthPayload pinned)
  inbox-handler.ts                        — Phase 3.b/2b HTTP handler (POST/GET/DELETE)
                                            + Ed25519 verify via Web Crypto crypto.subtle
  wrangler.toml                           — KV namespace binding OTTIE_INBOX (see §11 for IDs)

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

Phase 3 (friend pairing + chat + offline inbox) is **functionally
complete and production-validated**. Don't try to "implement Phase
3" again — read what's there.

**Before writing more code, ASK Wendell what to do next.** The four
remaining tracks (in his preferred order, last-confirmed
2026-05-07):

### 6.1. Multi-device X25519 sync (✅ DONE — see commit a few hashes above)

**Already working — 3.b/2a's design pre-built the pass-through.**
`RootIdentitySchema` has the X25519 fields as `.optional()`;
`DeviceLinkApprovalReplySchema` embeds the full schema; the
approval reply passes `input.rootIdentity.stored` (which post-
migration contains the X25519 keys); and `writeImportedRootIdentity`
already has the conditional: "if X25519 fields present, persist;
else synthesize fresh".

What today's commit added: an explicit assertion in
`device-link-end-to-end.test.ts` that proves the round-trip —
after Alice approves Bob's link, Bob's `root.json` carries
identical `encryptionPublicKeyB64` and `encryptionPrivateKeyB64`
to Alice's, and Bob's in-memory `RootIdentityBundle` exposes the
same. Without this assertion the round-trip behavior was
implicit — easy to break with a future schema or sender change.

**Cursor + dedup across same-identity devices** is the related
follow-up that's still open. If Bob has two devices, both can
NOW decrypt his inbox (this commit), but if both pull
concurrently, KV's eventual consistency briefly lets both see
the same entry → both `appendFriendChatMessage` → duplicate
JSONL lines. UI dedup by `clientMessageId` is one fix; cursor
sync via peer-sync is another. Defer to 3.b/3-multidevice
alongside chat-history fan-out.

### 6.2. Phase 4 — AI sharing (v1 done; v2 + v3 to ship)

**v1 shipped this session.** Invitation handshake works end-to-
end on the daemon + UI: owner taps "Share AI" in the friend
chat header → confirm modal → invite envelope encrypts through
the existing friend-sync session → friend's bell shows the
invite → friend's inline Accept / Decline → both sides know
the state. Crypto + schemas + WS RPCs all in place; 9 tests
covering signature roundtrip + tampering. See:

- `packages/server/src/server/identity/ai-share-types.ts` —
  invite / accept / decline schemas + canonical signed payload.
- `packages/server/src/server/identity/ai-share-crypto.ts` —
  Ed25519 sign/verify helpers + `tryParseAiShareEnvelope`
  dispatcher used by `handleInboundFriendSyncPayload`.
- `packages/server/src/server/identity/ai-share-registry.ts` —
  in-memory pending-invite store (5 min TTL).
- `IdentityService.{sendAiShareInvite, acceptAiShareInvite,
declineAiShareInvite, listInbound/OutboundAiShareInvites}`.
- 5 WS RPCs under `chat/p2p/ai-share/*` + matching client
  wrappers in `daemon-client.ts`.
- UI: `ShareAiButton` in friend chat header; `NotificationItem`
  union extended with `"ai-share-invite"`; inline accept /
  decline buttons on the invite row in
  `notification-center-panel.tsx`.

Design spec lives at `docs/MULTI-USER-COLLABORATION-DESIGN.md`
§11.5 — explains the v1 / v2 / v3 split + every wire-shape
decision.

**v2 — live channel (broken into 5 sub-commits a–e):**

The active-share state currently has nothing in it (banner text
reads "live timeline + prompt-injection ship in v2"). v2 ships
in five sub-commits, each independently mergeable + testable:

- **v2/a — active state + end-session.** ✅ shipped
  (commit `f7181251`). Adds `ai-share-end` envelope (either
  side can emit), tracks an "active" state on each registry
  entry post-accept, replaces the v1 stub banner with a real
  one ("AI share active with {peer} — End session"), wires
  the End button. Tests cover end-envelope round-trip + the
  `pending → active → ended` lifecycle.
- **v2/b — owner side: agent picker + prompt receive.** ✅
  shipped. Replaces v1's hardcoded `Claude Code` placeholder
  with `useShareableAgents` (new RPC `chat/p2p/ai-share/
list-shareable-agents` → `agentManager.listAgents()`). Adds
  `ai-share-prompt` envelope (friend → owner). On receive,
  owner's daemon verifies signature + matches active outbound
  invite + injects body into `AgentManager.runAgent(agentId,
  body)` via a late-bound bridge. Friend-side `sendAiShare
Prompt` API is in place + a new RPC `chat/p2p/ai-share/
send-prompt` ships it. No friend-side UI yet — verified via
  daemon logs (`ai_share_prompt_routing_to_agent` then the
  agent's normal output flowing through the owner's existing
  timeline).
- **v2/c — friend side: shared agent view + send prompt.** ✅
  shipped. New Expo Router route at `/h/[serverId]/friend/
[peerRootPubKey]/share/[inviteId]` (the friend folder was
  restructured to host nested routes). The screen is a
  stripped chat surface: header with agent label + peer +
  End button, locally-buffered list of prompts the friend
  sent (with sending / sent / failed status), and a compose
  box that fires `chatP2pAiShareSendPrompt`. The active-share
  banner on the friend chat now has an Open button (only on
  the inbound side — the owner doesn't get the friend-facing
  surface) that navigates here. Empty state explains what
  v2/d will fill in. "Share ended" detection via
  `useActiveAiShares` falling out of the active list.
- **v2/d — owner→friend timeline streaming.** ✅ shipped.
  Adds `ai-share-timeline` envelope (sixth kind) carrying a
  redacted projection of `AgentTimelineItem`. The owner-side
  redactor (`ai-share-timeline-redactor.ts`) enforces §7's
  "Bob does not see" list: tool calls, tool inputs/outputs,
  permission requests, todo items, and usage updates never
  reach the wire. Forwarded entries: `assistant_message`,
  `reasoning`, `user_message` (with friend's promptId echoed
  back), `error`, `turn_started`, `turn_completed`. The
  broadcaster opens an `AgentManager.subscribe` per active
  outbound share on accept, tears it down on end (registry
  holds the unsubscribe handle). Friend side dispatches into
  an `AiShareTimelineStore` (per-inviteId ring buffer, capped
  at 500), polled by `useAiShareTimeline` at 2s. The friend's
  share screen now interleaves local "you sent" rows with
  inbound assistant messages / reasoning / status pills,
  deduping by `promptId` once the owner's daemon echoes the
  user_message back.
- **v2/e — auditable transcript + disconnect handling +
  e2e tests.** ✅ shipped. Adds the on-disk transcript store
  at `$OTTIE_HOME/ai-shares/{inviteId}.jsonl` — append-only
  JSONL, one file per share per side. Each lifecycle
  transition appends a typed line: `header` (with the verified
  invite envelope), `accept`/`decline`/`end` (origin = self
  | peer), `prompt` (origin = sent | received), `timeline`
  (origin = sent | received with the redacted entry +
  signature). Friend's transcript only carries entries that
  passed the v2/d redactor on the owner's side, so §7's "Bob
  does not see" still holds at the audit-trail layer.
  Disconnect detection: `listActiveAiShares` consults
  `friendSessions` and stamps a `peerOnline` flag on each
  row; banner + share-screen subtitle flip to "(peer offline)"
  when the friend-sync session drops. Mock-relay e2e covers
  the full Wendell ↔ Bob lifecycle (220ms): pair → invite →
  accept → send-prompt → mock-agent stream → redactor strips
  tool_call → friend's buffer fills with 4 entries (no tool
  call) → end → both transcripts on disk audit-clean.

**v3 — multi-daemon picker (§7.5) (limits ✅, friction ✅ shipped):**

Three of the four bullets are now shipped (real agent list
landed in v2/b; limits in v3/a; first-share friction in v3/b).
The only remaining piece is:

- §7.5's two-step picker when the owner has multiple online
  daemons. Requires peer-sync to broadcast "which device picked
  up" so the other devices' modals dismiss.

**Done:**

- ~~Real local agent list — owner picks which agent from the
  modal (replaces the placeholder).~~ ✅ shipped in v2/b.
- **v3/a — limits enforcement.** ✅ shipped. Adds an optional
  `limits` field to the invite envelope (`maxPrompts`,
  `maxTokens`, `sessionTimeoutMs`) — defaults applied at
  `sendAiShareInvite` (50 prompts, 100k tokens, 1 h timeout
  per §7). The canonical signed payload includes a trailing
  `limits=…` line so a relay-side adversary can't tamper
  caps. Owner-side enforcer:
  · increments `promptCount` on inbound prompt; ends with
  `reason="prompt-limit"` when the cap is exhausted (the
  cap-tripping prompt itself is rejected, not run).
  · tallies `usage_updated.{inputTokens,outputTokens}` from
  the broadcaster's subscription; ends with
  `reason="token-limit"` when the cap is hit.
  · `setTimeout(sessionTimeoutMs)` scheduled on accept;
  fires `endAiShareSession(reason="session-timeout")`.
  Cleared in `applyOutboundEnd`.
  Friend's UI surfaces the caps as a third row on the accept
  notification ("max 50 prompts · 100k tokens · 60 min", en
  - zh). Mock-relay e2e covers the prompt-cap path: tight
    cap=2 invite, two prompts complete, third trips the cap,
    Bob's transcript records `end:peer reason="prompt-limit"`.
    Back-compat: invites without `limits` still verify, and
    v3+ owner daemons treat absent limits as the defaults at
    enforcement time.
- **v3/b — first-share friction (Q2).** ✅ shipped. Adds
  `firstAiShareSentAt` (optional, ISO timestamp) to the
  on-disk peer record. Stamped after a successful
  `sendAiShareInvite` (regardless of whether the friend
  accepts or declines — friction prevents misroutes, not bad
  outcomes). UI: friend-chat ShareAi modal opens on a
  "type the friend's name" confirm step when the peer has
  no stamp yet, requires case-insensitive trim-equal match
  against `peerDisplayName`, then proceeds to the picker.
  Subsequent shares to the same peer skip straight to the
  picker. Mock-relay e2e covers the stamp lifecycle (no
  stamp pre-share → stamp set after first send → preserved
  across a second send to the same peer). Bilingual i18n
  (`p2pChat.shareAi.firstShareTitle/Body/Confirm`).

**Out-of-scope for the whole Phase 4 chain (defer to Phase 5+):**

- Cross-friend sharing (A shares to B who shares to C).
- Mobile-as-leaf without a daemon.
- Mid-session daemon switching (locked closed in §7.5.3).

### 6.3. Bell button → notification center (✅ v1 done)

The bell in `desktop-nav-rail.tsx` no longer no-ops:

- New `useNotifications(serverId)` hook
  (`packages/app/src/hooks/use-notifications.ts`) polls the
  active host's `friendPairCandidates` RPC every 5s and shapes
  each into a discriminated `NotificationItem` (one kind today:
  `"friend-pair-candidate"`).
- New `NotificationCenterPanel` component
  (`packages/app/src/components/notification-center-panel.tsx`)
  renders the items inside an `AdaptiveModalSheet`, with an
  empty-state, per-row icon (`UserPlus`), and tap-to-deep-link
  behavior. Friend-request rows route to `/settings/identity`
  where the existing Approve/Reject UI lives — the panel
  intentionally doesn't duplicate the action buttons.
- Bell now shows a red dot when `count > 0` (driven by the
  hook's `count`); tap opens the panel.
- Bilingual i18n under `notifications.*` (en + zh).

**v2 ideas, deferred:**

- **Multi-host roll-up** — today shows only the active host's
  notifications. The hook is already keyed by `serverId`, so
  upgrading is "for each host in `useHosts()`, run a query,
  flatten + sort". Add a per-row badge for the originating
  host so the user knows which identity is involved.
- **Phase 4 AI-share invitations** — slot in by adding a
  `"ai-share-invite"` kind to `NotificationItem`. The panel
  already has an exhaustiveness check (`_exhaustive: never`)
  so missing renderers fail typecheck.
- **Inbox-arrival hints** — when an offline-inbox round
  persists a message and the chat screen isn't focused, post
  a transient notification. Needs a daemon → client push
  channel; defer to Phase 3.b/3 push subscriptions work.
- **Mobile parity** — the bell is desktop-only today
  (`mobile-tab-bar.tsx` doesn't render one). Add a notifications
  surface there once the mobile UX is decided.

### 6.4. lint-error cleanup (v1 done; ~115 remaining)

Started this session at 137 errors, now at **115**. v1 cleared:

- **All 29 `typescript-eslint(no-explicit-any)`** ✓
  - 9 in `daemon-client.ts` — `sendRequest<any>` → drop the
    generic; the `select` callback infers the type. Fixed by
    making `sendRequest`'s return type `Promise<NonNullable<T>>`
    so the wait-loop's "T | null → T" guarantee shows up
    statically.
  - 12 in `session.ts` — `router.register(... m as any)` →
    drop the cast. Fixed by making `MessageRouter.register`
    generic over the kind so the handler's `msg` is narrowed
    via `Extract<SessionInboundMessage, { type: K }>`.
  - 8 misc — proper types for theme args (use unistyles),
    proper Provider types in array filters, eslint-disable
    comments for dnd-kit ref-as-any (genuine library mismatch).
- **3 of 8 `eslint(no-unused-vars)`** — bare `catch` instead
  of `catch (error)` where the param is unused.
- **1 of 7 `eslint-plugin-import(no-named-as-default-member)`**
  — eslint-disable for `Animated.createAnimatedComponent` because
  reanimated 4.x doesn't actually expose it as a named export
  (lint hint was misleading). The other 6 likely follow the
  same pattern.

**Remaining 115 errors by category:**

- 63 `eslint-plugin-react-perf(*)` — array/function/object
  literals as JSX props. Mechanical but tedious: 31 + 16 + 12 +
  4 useMemo/useCallback extractions across ~8 files. The big
  three offenders: `assistants-screen.tsx` (8),
  `message-input.tsx` (8), `openclaw-chat-panel.tsx` (7).
  Worth a focused session of its own.
- 11 `eslint(complexity)` + 8 `max-nested-callbacks` + 4
  `no-nested-ternary` + 3 `max-depth` + 3 `jsx-max-depth` —
  these need real refactoring judgment (extract helpers,
  flatten conditionals). Don't bundle with feature work.
- 6 `no-named-as-default-member` (5 more reanimated
  `Animated.X`, plus `i18next` named-vs-default issues at
  `i18n/index.ts` + `i18n/init.ts`) — likely each needs an
  eslint-disable + rationale comment, like button.tsx.
- 5 `no-unused-vars` (need dead-code judgment per case:
  unused functions, unused state vars, etc.)
- 4 `always-return` in promise chains
- ~10 misc (exhaustive-deps, no-multiple-resolved, etc.)

Until 0 errors, the lefthook pre-commit lint check still fails,
so commits on this branch continue to use `--no-verify` (user-
authorized for the multi-user-collab branch). Strategy for next
round: knock out the 63 react-perf in a single dedicated commit,
then the remaining ~50 in a final commit. Both can be mostly
mechanical — `react-perf` errors all want extraction into
`useMemo` / `useCallback` with stable references.

---

**Read first when you do start coding** any of these:

1. Design doc §17 — current implementation status. Update on every
   sub-commit.
2. The Phase 3.b/2 inbox code (`friend-inbox-*` files in
   `packages/server/src/server/identity/`,
   `packages/relay/src/inbox-*.ts`) — there's a LOT here, mirror
   the patterns, don't reinvent.
3. The mock-relay e2e tests — they're the canonical reference
   for how the full flow behaves end-to-end.

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

- **Same-identity device cursor + dedup**. The X25519 priv key
  itself NOW fans out across same-identity devices via
  device-link (§6.1 above). But there's no cursor sync between
  Bob's two devices, and `appendFriendChatMessage` doesn't dedup
  by `clientMessageId`. If both devices pull the inbox
  concurrently, KV's eventual consistency briefly lets both
  see the same entry → both append → duplicate JSONL lines.
  Track for 3.b/3-multidevice (alongside chat-history fan-out
  via peer-sync).
- **Polling delay (live)**. The chat screen polls every 2s for
  live messages from the friend-sync session; inbound messages
  show up with up to 2s of UI lag even though the daemon receives
  them immediately. Fix: push subscriptions, deferred.
- **Inbox poll cadence**. The inbox receiver polls every 5
  minutes by default. So if Bob comes online and Wendell sent a
  message 30 seconds before, Bob waits up to ~5 min for his
  daemon to drain it. Could trigger faster on relay-control
  reconnect — deferred follow-up. (Daemon ALWAYS does one poll
  immediately on startup, so a fresh boot always drains right
  away.)
- **No multi-device fan-out for friend chat history**. Same
  pattern as the X25519 fan-out: if Wendell's laptop persists a
  message and his phone is also online, the phone won't see the
  message until Phase 2.f peer-sync is extended to ferry chat
  history (currently only syncs device-list events). Phase
  3.b/3-multidevice is the fix.
- **Friend chat history isn't in the agent chats list**. Reachable
  only via Settings → Friends → Open chat. Wendell is aware. §6.3
  (notification center) partially overlaps — both touch surfacing
  cross-identity content into the main UI.

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

## 8.5. Quickest sanity check — run the Phase 3 end-to-end demo

There's a runnable script that walks through the entire pair → chat
→ restart flow on one machine in ~2 seconds. Use it to confirm the
identity / friend-sync / chat code paths still work after any
change you make.

```bash
cd packages/server && npx tsx scripts/friend-chat-demo.ts
# DEMO_DEBUG=1 to see daemon-side pino logs
```

Expected output (last verified on `org/main` HEAD as of this
handoff). 9 numbered steps; exits 0 on success, non-zero on any
failure. Suitable for CI smoke-test.

```
Phase 3 friend-chat demo
        Mock relay: 127.0.0.1:54023
        Alice $OTTIE_HOME: /tmp/ottie-demo-alice-XXXXXX
        Bob   $OTTIE_HOME: /tmp/ottie-demo-bob-XXXXXX

━━━ Step 1: Boot two daemons + initialize identities
[Alice] identity loaded — root pubkey 3hUFJWXt5a7f…
[Bob]   identity loaded — root pubkey L4hfwLs9WjxC…

━━━ Step 2: Alice generates a friend-pair offer (the QR Bob would scan)
[Alice] offer ready, expires at 2026-05-07T01:13:17.395Z
        deep link: ottie://friend-pair#payload=eyJ2IjoxLCJraW5k…

━━━ Step 3: Bob redeems the link through the relay
[Bob]   opening friend-pair socket and sending signed candidate…
[Alice] pending request: "Bob (L4hfwLs9)"

━━━ Step 4: Alice approves the pending request
[Alice] signed approval reply, sent over the relay
[Bob]   paired with "Alice"
        ✔ both peers.json files written

━━━ Step 5: Wait for both sides' friend-sync sessions to establish
[Alice] session up: 1 active friend session
[Bob]   session up: 1 active friend session

━━━ Step 6: Send chat messages both directions
[Bob]   sending "你好 Alice"…
[Alice] received: "你好 Alice"
                signature verified, author=L4hfwLs9… via device srv_bob_demo
[Alice] replying "你好 Bob, 收到!"…
[Bob]   received: "你好 Bob, 收到!"
        ✔ bob's history: ["你好 Alice", "你好 Bob, 收到!"]

━━━ Step 7: Inspect on-disk state
[Alice] peers.json has 1 entry: "Bob" via srv_bob_demo
[Bob]   peers.json has 1 entry: "Alice" via srv_alice_demo
        Alice's chat log: /tmp/.../chat/friends/<sha256>.jsonl
        first message line on Alice's side:
          {"message":{"id":"fcm_…","roomId":"p2p:3hUFJWXt…|L4hfwLs9…",…

━━━ Step 8: Restart Alice's daemon — confirm history survives
        alice's daemon stopped
[Alice] peers.json reloaded: 1 friend ("Bob")
[Alice] chat history reloaded: ["你好 Alice", "你好 Bob, 收到!"]
        ✔ history survived restart

━━━ Step 9: Demo complete

  All steps passed. ✓
```

If this script ever fails on a clean tree, something's broken in
the Phase 3 chain — investigate before adding more code.

## 9. If you're confused about state, run this

```bash
cd /Users/a123456/Downloads/ottie-workspace/ottie
git log --oneline -30
git diff HEAD~5
cat docs/MULTI-USER-COLLABORATION-DESIGN.md | head -100
ls packages/server/src/server/identity/
cd packages/server && npx vitest run src/server/identity/ src/server/relay-transport.test.ts src/server/chat/ 2>&1 | tail -8
cd packages/relay && npx vitest run 2>&1 | tail -8
```

The combination of recent commits + design doc + identity dir + test
output tells you everything. Don't ask the user questions you can
answer from these.

Expected test counts as of the last commit on `org/main`:

- `packages/server` identity dir: **380 tests across 40 files**
- `packages/relay`: **42 tests across 5 files** (+ 4 skipped that
  hit the live Cloudflare relay; opt-in only)

If yours differ, check git log to see whether work landed since
this handoff was written.

## 10. Phase 3 commit chain (chronological reference)

If you need to dig into how Phase 3 was built (newest at top):

```
321f0002  3.b/2e        — UI delivery-status badge (queued / delivered)
8ff44d8d  3.b/2d        — daemon inbound drains the offline inbox
76cc871c  3.b/2c        — daemon outbound queues to relay inbox
decc2d02  3.b/2b        — Cloudflare KV inbox HTTP endpoints
4c1a3413  3.b/2a        — per-identity X25519 encryption keypair
28f6e803  fix(app)      — add-friend UX (kill auto-cancel + tap to copy)
f39333f7  fix(identity) — start peer-sync + friend-sync after UI onboarding
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

## 11. Production deployment context (Phase 3.b/2)

Wendell's relay (`relay.claws.company`) was live-deployed with
the 3.b/2b inbox routes on **2026-05-07** (worker version
`198a2819-e0da-46ea-9f15-de4af04e0062`). The deploy is
pure-additive — only adds `/inbox/*` HTTP routes; `/ws` traffic
unchanged.

**KV namespace bindings** (in `packages/relay/wrangler.toml`):

```
[[kv_namespaces]]
binding = "OTTIE_INBOX"
id = "3b4463e4aa3046269131078ab9868955"             # production
preview_id = "43ea9c0612f6440b866e37446aed25f8"     # wrangler dev
```

If you need to redeploy:

```bash
cd packages/relay
# Wrangler binary lives in pnpm's hoisted node_modules:
../../node_modules/.pnpm/node_modules/.bin/wrangler deploy
```

User has wrangler auth set up (cache at
`packages/relay/node_modules/.cache/wrangler/wrangler-account.json`).

**Quick smoke check the inbox is alive:**

```bash
# /health stays the same:
curl -s -o /dev/null -w "%{http_code}\n" https://relay.claws.company/health
# expect 200

# /inbox/<short> rejects:
curl -s https://relay.claws.company/inbox/short
# expect {"error":"invalid_recipient"}

# POST a tiny opaque blob:
curl -s -X POST https://relay.claws.company/inbox/AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555FFF \
  -H "Content-Type: application/octet-stream" --data "test"
# expect {"seq":"...","deliveredAt":"..."}
```

**End-to-end production validation log** (2026-05-07, kept for
provenance — these exact commits passed a real Wendell ↔ Bob ↔
relay.claws.company round-trip):

```
00:14:10  alice  friend_chat_inbox_post_succeeded
                 inboxSeq:  0001778138050251-ea2e640c01a1c823
00:14:10  alice  friend_chat_message_sent  deliveryStatus: queued
00:14:59  bob    inbox_entry_persisted
                 seq:       0001778138050251-ea2e640c01a1c823 ← matches
                 messageId: fcm_66af8a4f-a7fa-4c31-ad8c-ed70755df06a
00:14:59  bob    inbox_round_complete  persisted=1, dropped=0
```

If a future change breaks production wire compat, this trace
shape (matching seq + matching messageId) is the canonical
"is the round-trip working" check.
