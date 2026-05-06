# Multi-User Collaboration: Design Doc

**Status:** Approved v1.0 — ready for implementation
**Last updated:** 2026-05-05
**Owner:** Wendell
**Tracking issue:** TBD

This document follows the workflow in `docs/DESIGN.md`: user stories → existing code map → acceptance criteria → data shape → ordered implementation steps. Open questions live in §13 — they are explicit so review can happen against them.

---

## 1. Summary

Extend ottie from a single-developer tool ("monitor and control my agents from anywhere") into a peer-to-peer collaboration platform where:

- Users can add each other as **friends** without registration or central servers.
- A user identity spans **multiple devices** (laptop, second laptop, phone) — friends see one user, not three.
- Friends can **chat** in 1-to-1 conversations.
- A user can **share their AI agent** with a friend; the friend talks to it as if using ChatGPT, while the owner sees the full session and can revoke at any time.

Phase 1–4 (this design) lands the foundation and 1-to-1 use cases. Group chat, folders, multi-user shared rooms, and richer agent-sharing semantics are explicitly deferred.

This brings ottie's CLAUDE.md tagline ("monitoring and controlling YOUR agents") and README's stage-3 vision ("multi-lateral collaboration network") into the same product. PRODUCT.md will be updated alongside (§11).

---

## 2. Goals & Non-Goals

### Goals

1. **Friend-pair without login.** Two ottie users add each other via QR code or shareable link; no email, phone, password, or central account database.
2. **One user, many devices.** Users explicitly link new devices to their identity; remote friends see the _user_, not the _device_. Device list is visible and revocable.
3. **1-to-1 chat between friends.** Text messages relay through ottie's existing zero-knowledge relay; offline messages are stored encrypted on the relay with a TTL.
4. **AI agent sharing.** A user opens a session that lets a specific friend send prompts to a specific local agent. The owner sees the entire interaction and can end it instantly.
5. **Backward compatibility.** Old mobile clients keep working against new daemons. No required field is added; no schema is narrowed (per CLAUDE.md WS rule).
6. **Open-source friendly.** No proprietary services or paid identity providers in the critical path. The relay is the only shared infra and stays zero-knowledge.

### Non-goals (this milestone)

- **Group chat (3+ humans).** Deferred to a later milestone. The "+" menu shows it but starts disabled.
- **Folders / chat organization.** Client-local pin/archive already exists (`chat-row-state-store.ts`); folders are out of scope.
- **Federated user discovery.** No directory, no "find me by handle." You add friends only via QR/link they share.
- **End-to-end encryption guarantees for shared agents.** Owner trivially observes everything by design; this is a **stated** privacy trade-off (§7).
- **Mobile-as-daemon.** Mobile remains a client; daemons run on desktops/servers. Multi-device means _multiple daemons + clients_ under one identity.
- **Backend monetization, billing, quotas, abuse mitigation at scale.** Phase-1 trust model assumes friend-only graphs.

---

## 3. User Stories

> Each story is verifiable; §10 maps each to an acceptance test.

**S1 — First-run identity.** I install ottie. On first launch I'm asked to pick a display name. A root identity keypair is generated locally and stored in `$OTTIE_HOME/identity/`. I never enter an email or password.

**S2 — Link my second computer.** I install ottie on my second laptop. I open my first laptop's "+" menu → "扫一扫", choose "Add this device", and a QR appears. My second laptop scans it. After both sides confirm, the second laptop is now a device under my user identity.

**S3 — See my devices.** In Settings → "我的设备", I see all devices linked to my identity, with name, last-seen time, and a "remove" button. Removing a device revokes its keys.

**S4 — Add a friend by QR.** Bob sits next to Alice. Alice taps "+" → "添加好友", her phone shows a QR. Bob scans it via "+" → "扫一扫". Both sides see "Confirm friend request from <name>?" and tap accept. They are now friends.

**S5 — Add a friend remotely.** Alice taps "+" → "添加好友" → "Copy link". She sends the link to Bob in WeChat. Bob taps the link; ottie opens to a confirmation page. Bob taps accept. Alice gets a notification and confirms back. They are friends.

**S6 — Send a message.** Alice opens the chat with Bob and sends "hi". Bob receives it within seconds (if online) or when he next opens ottie (if offline). Read receipts work.

**S7 — Offline messaging.** Bob's laptop is closed. Alice sends 5 messages. Bob's laptop wakes. Within seconds Bob sees all 5 messages. None lost.

**S8 — Share my AI with Bob.** In the chat with Bob, Alice taps "Share AI" → picks `claude-code` from her allowed-models list → "Send invite". Bob sees a card "Alice wants to share Claude Code with you. Accept?" Bob accepts. A status banner appears at the top of both chats: "Bob is using your Claude Code · End session".

**S9 — Talk to Bob's AI.** With Alice's AI shared, Bob types "explain quicksort in Python" in the chat. Bob sees a streaming response from the AI. Alice sees Bob's prompt, the streaming response, and any agent-internal tool calls (Read, Edit, etc.) in her timeline view, but Bob does _not_ see Alice's tool call details.

**S10 — End the session.** Alice taps "End session" on the banner. The banner disappears for both. Bob sees a system message "Alice ended the AI sharing session." Sending another prompt is rejected until Alice re-shares.

**S11 — Cross-device read.** I send a message to Bob from my phone. I open ottie on my laptop. The message is there in the conversation, marked sent.

---

## 4. Existing Code Map

> What exists today that we extend, and what is genuinely new. File paths are real and verified.

### Things we extend

| File                                                  | Current responsibility                                             | Change                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `packages/server/src/server/chat/chat-types.ts`       | Defines `ChatRoom`, `ChatMessage`, `StoredChatMessage` Zod schemas | Add **optional** fields: `ownerRootPubKey?`, `members?`, `authorRootPubKey?` (§5)          |
| `packages/server/src/server/chat/chat-rpc-schemas.ts` | WS RPC for chat (create/post/list/...)                             | Add new event types `peer/*`, `device/*`, `ai-share/*` — all additive                      |
| `packages/server/src/server/chat/chat-service.ts`     | `FileBackedChatService`, `parseMentionAgentIds`                    | Route new message kinds; gate post by membership                                           |
| `packages/server/src/server/chat/chat-mentions.ts`    | `notifyChatMentions`, `sendAgentMessage`                           | Reuse for AI-share prompt routing                                                          |
| `packages/server/src/shared/messages.ts`              | Re-exports + Zod-validates inbound WS messages                     | Add new types to discriminated union (additive)                                            |
| `packages/relay/src/*`                                | ECDH + AES-GCM channel for client↔daemon                           | Add user↔user message lane and offline-store (§8)                                          |
| `packages/app/src/components/top-right-add-menu.tsx`  | "+" menu with 4 items                                              | Replace with new 4-item layout (§9.1)                                                      |
| `packages/app/src/actions/chat-row-actions.ts`        | `chat.add.*` action handlers                                       | Update for new menu items                                                                  |
| `packages/app/src/i18n/locales/{en,zh}.json`          | i18n strings                                                       | Add new keys (§9.5)                                                                        |
| `packages/app/src/screens/sessions-screen.tsx`        | Chat list, top-right menu host                                     | No change to layout; chat list becomes friend-conversations list when friend feature ships |
| `docs/PRODUCT.md`                                     | Product definition                                                 | Add one paragraph on multi-user (§11)                                                      |
| `docs/DATA_MODEL.md`                                  | Data model reference                                               | Append section: "Identity, Devices, Peers"                                                 |
| `docs/ARCHITECTURE.md`                                | System architecture                                                | Append section: "Peer Collaboration Layer"                                                 |
| `docs/SECURITY.md`                                    | Threat model                                                       | Add: "AI sharing privacy trade-off"                                                        |

### Things that are genuinely new

| Path                                              | Purpose                                                      |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `packages/server/src/server/identity/`            | Root identity key generation, device list, persistence       |
| `packages/server/src/server/peer/`                | Friend store, pair flow, peer-to-peer message routing        |
| `packages/server/src/server/ai-share/`            | Sharing session state machine, prompt routing to local agent |
| `packages/app/src/screens/friend-add-screen.tsx`  | "添加好友" view (QR display + link copy + paste-link input)  |
| `packages/app/src/screens/devices-screen.tsx`     | "我的设备" view (list, last-seen, remove)                    |
| `packages/app/src/components/scan-screen.tsx`     | Universal scan camera view (handles all QR kinds)            |
| `packages/app/src/components/ai-share-banner.tsx` | Top-of-chat banner during active AI sharing                  |
| `packages/app/src/components/ai-share-card.tsx`   | Card-style invitation message in chat                        |
| `packages/app/src/stores/peer-store.ts`           | Zustand store for friends                                    |
| `packages/app/src/stores/identity-store.ts`       | Zustand store for own root identity + devices                |
| `packages/app/src/stores/ai-share-store.ts`       | Zustand store for active sharing sessions (per-conversation) |

### Things explicitly **not** changed

- The agent lifecycle (`packages/server/src/server/agent/agent-manager.ts`) — sharing wraps it, doesn't modify it.
- Agent providers (Claude/Codex/OpenCode/ACP) — sharing uses `sendAgentMessage` to deliver shared prompts.
- Existing daemon pairing flow — kept as-is for users linking their own clients to their own daemon. New "device link" flow is parallel, not a replacement.

---

## 5. Identity & Device Model

### 5.1 Concepts

```
RootIdentity
  ├─ rootPubKey          (Ed25519 signing key, public)
  ├─ rootPrivKey         (Ed25519, sealed at rest)
  ├─ displayName         (user-chosen string, mutable)
  └─ devices: Device[]   (signed by rootPrivKey)

Device
  ├─ deviceId            (UUID)
  ├─ devicePubKey        (X25519 for messaging, Ed25519 for signing)
  ├─ deviceLabel         (user-editable, e.g. "Wendell-MacBook")
  ├─ role                ("daemon" | "client")
  ├─ authorizedAt        (ISO-8601)
  ├─ lastSeenAt          (ISO-8601)
  └─ authorizationSig    (sig from rootPrivKey over the above)

Peer (a friend)
  ├─ peerRootPubKey      (their root public key — the user's ID)
  ├─ peerDisplayName     (cached; resyncs)
  ├─ addedAt             (ISO-8601)
  ├─ status              ("active" | "blocked" | "removed")
  └─ peerDevices         (list, optionally synced from peer for routing)
```

### 5.2 First-run flow

1. App launches with no `$OTTIE_HOME/identity/root.json`.
2. App prompts for display name.
3. Daemon generates Ed25519 + X25519 keypairs, writes to `$OTTIE_HOME/identity/root.json` (sealed: encrypted with OS keychain-stored key, falling back to plaintext in dev mode with a warning).
4. The current daemon is registered as the first device (role: "daemon") with auto-detected hostname as label.
5. Identity is now ready; pairing flows can proceed.

### 5.3 Linking a new device (S2)

```
[Existing device A]                         [New device B]
       │                                            │
       │ User taps "+" → "扫一扫" → "Add device"     │
       │                                            │
       │ Generate ephemeral X25519 keypair          │
       │ Show QR with: { kind: "device-link",       │
       │                 ephPubKey, rootPubKey,     │
       │                 nonce, exp, relayHint }    │
       │                                            │
       │                                            │ User installs ottie, no identity yet
       │                                            │ Taps "+" → "扫一扫"
       │                                            │ Camera reads QR
       │                                            │ App: "Link this device to <displayName>?"
       │                                            │ User taps Confirm
       │                                            │
       │                                            │ Generate device keypair locally
       │                                            │ Compute shared secret with ephPubKey
       │                                            │ Send via relay: { devicePubKey, deviceLabel }
       │                                            │
       │ Relay delivers (encrypted)                 │
       │ App: "Add 'iPhone-15' as your device?"     │
       │ User confirms                              │
       │                                            │
       │ Sign Device record with rootPrivKey        │
       │ Send back: signed Device + bootstrap       │
       │   bundle (peer list, current convos)       │
       │                                            │
       │                                            │ Device B saves bootstrap
       │                                            │ Now functional under user's identity
       │                                            │
       │ Broadcast updated DeviceList to             │
       │   all other A-side devices                 │
```

Key properties:

- The QR/link is **single-use, time-bound** (≤ 24 h, default 10 min).
- The new device gets a **bootstrap bundle** (current peer list, recent conversations) so it isn't blank.
- Other devices learn of the new device via a relay-delivered `device/added` event.

### 5.4 Adding a friend (S4 / S5)

Same shape as device-link, but cross-identity:

- QR payload: `{ kind: "friend-pair", rootPubKey, ephPubKey, displayName, nonce, exp, relayHint }`
- Both sides must accept (no silent-add).
- After pairing, each side stores the other in their `Peer` list.
- `peerDevices` is initially empty; gets populated when the peer publishes their device list (see §6).

### 5.5 Multi-device data sync

A user's devices need to keep in sync:

- Peer list (added a friend on phone, laptop sees it)
- Conversations + messages (sent from phone, laptop sees it)
- Device list (new device added, all see it)

**Approach:** No central DB. Each daemon broadcasts state-change events to its sibling devices through the relay. Each device keeps its own local store and applies received events idempotently (events have monotonic per-source `seq` numbers, like ottie's existing chat).

**Limitation:** Pure-client devices (phone, web) cannot run a daemon. They connect to one of the user's daemons as a client and inherit that daemon's view. If the user has _no_ daemon online, pure-client devices can read cached state but cannot send new messages until a daemon comes online. (Identical limitation to today's ottie.)

> **Open question Q1 (§13):** Do we need a "daemon-less mode" where the phone itself can act as a leaf node speaking directly to the relay? This would mean implementing a tiny subset of daemon logic in the app. **Provisional answer: no for Phase 1–4.** Phone requires user to have at least one daemon online to send messages.

---

## 6. Data Model Changes

### 6.1 Identity (new file: `chat/identity-types.ts`)

```typescript
export const RootIdentitySchema = z.object({
  version: z.literal(1),
  rootPubKey: z.string(), // base64
  rootPrivKey: z.string(), // base64, sealed at rest
  displayName: z.string().min(1).max(64),
  createdAt: z.string(),
});

export const DeviceSchema = z.object({
  deviceId: z.string(), // UUID
  devicePubKey: z.string(), // base64 (X25519 for ECDH)
  deviceSignPubKey: z.string(), // base64 (Ed25519 for signing)
  deviceLabel: z.string(),
  role: z.enum(["daemon", "client"]),
  authorizedAt: z.string(),
  lastSeenAt: z.string().optional(),
  authorizationSig: z.string(), // base64
});

export const PeerSchema = z.object({
  peerRootPubKey: z.string(),
  peerDisplayName: z.string(),
  addedAt: z.string(),
  status: z.enum(["active", "blocked", "removed"]),
  peerDevices: z.array(DeviceSchema).optional(),
});
```

### 6.2 Chat (changes to `chat/chat-types.ts`)

```typescript
// EXISTING — unchanged
export const ChatRoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  epoch: z.string().optional(),
  // NEW — all optional
  ownerRootPubKey: z.string().optional(),
  members: z
    .array(
      z.object({
        rootPubKey: z.string(),
        role: z.enum(["owner", "member"]),
        addedAt: z.string(),
      }),
    )
    .optional(),
  kind: z.enum(["agent-only", "p2p", "group"]).optional(),
});

// EXISTING — unchanged
export const ChatMessageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  authorAgentId: z.string(),
  body: z.string(),
  replyToMessageId: z.string().nullable(),
  mentionAgentIds: z.array(z.string()),
  createdAt: z.string(),
  seq: z.number().int().nonnegative().optional(),
  clientMessageId: z.string().optional(),
  // NEW — all optional
  authorRootPubKey: z.string().optional(), // who sent it (human)
  authorDeviceId: z.string().optional(), // which of their devices
  kind: z
    .enum([
      "text",
      "ai-share/offer",
      "ai-share/accept",
      "ai-share/reject",
      "ai-share/end",
      "ai-share/prompt",
      "ai-share/chunk",
      "ai-share/error",
      "system",
    ])
    .optional(),
  payload: z.unknown().optional(), // kind-specific structured data
});
```

**Backward-compat notes:**

- All new fields are `.optional()`. Old daemons stripping these fields still produce schema-valid messages.
- Old clients ignore unknown fields (Zod default behavior with `.passthrough()` or `.strip()`; we use `.strip()` to be safe).
- `kind` defaults to `"text"` semantically.
- For old clients receiving an `"ai-share/*"` message: the `body` field still contains a human-readable fallback string ("Alice shared an AI session — open in latest app to view"). This keeps old clients functional, just with degraded UI.

### 6.3 AI Sharing Session (new persisted entity)

```typescript
export const AIShareSessionSchema = z.object({
  sessionId: z.string(), // UUID
  roomId: z.string(), // chat room it belongs to
  ownerRootPubKey: z.string(), // Alice
  consumerRootPubKey: z.string(), // Bob
  agentId: z.string(), // local agent ID on owner's daemon
  modelLabel: z.string(), // user-facing model name
  state: z.enum(["pending", "active", "ended"]),
  createdAt: z.string(),
  acceptedAt: z.string().optional(),
  endedAt: z.string().optional(),
  endedBy: z.enum(["owner", "consumer", "timeout"]).optional(),
  // Limits (owner-set)
  maxPrompts: z.number().optional(),
  maxTokens: z.number().optional(),
  consumedPrompts: z.number().default(0),
  consumedTokens: z.number().default(0),
});
```

Stored at `$OTTIE_HOME/chat/ai-shares/{sessionId}.json` (one file per session, owner-side); consumer-side mirrors only the public state (no usage counters).

### 6.4 Persistence layout

```
$OTTIE_HOME/
├── identity/
│   ├── root.json                            # RootIdentity (sealed)
│   ├── devices.json                         # Device[] (signed)
│   └── peers.json                           # Peer[]
├── chat/
│   ├── rooms-index.json                     # existing
│   ├── rooms/{roomId}.jsonl                 # existing
│   ├── cursors/{clientId}.json              # existing
│   └── ai-shares/{sessionId}.json           # NEW
└── peer-outbox/                             # NEW
    └── {peerRootPubKey}/{seq}.json          # outbound messages awaiting relay ack
```

---

## 7. Privacy Trade-offs (explicit)

ottie's flagship promise is "**your code never leaves your machine**" (SECURITY.md). AI sharing intentionally relaxes this for the shared session. We document this clearly here and in SECURITY.md, and surface it in UI.

### What stays the same

- Bob's prompts and the AI's responses pass through the relay encrypted; the relay sees only ciphertext.
- Bob's prompts and the AI's responses are stored encrypted in offline-store with TTL; relay cannot decrypt.
- Alice's source code is never bulk-uploaded to the relay or to Bob.

### What changes during an active AI-share session

- **Bob can ask the AI questions whose answers leak information about Alice's code.** Example: Bob asks "explain the function `processPayment`"; the AI reads Alice's `processPayment` and writes a clear-text explanation; Bob receives it.
- **Bob can request changes that the AI executes against Alice's filesystem.** Mitigation: Alice's existing per-tool-call permission UI (`agent_permission_request`) applies. Alice approves/denies each side-effect.
- **The AI's interpretation of Alice's code is in plaintext within the encrypted channel.** Relay still doesn't see it. Bob does.

### What Bob does _not_ see (Phase 1–4)

- Tool call inputs/outputs (file paths, raw file contents, shell command outputs) — these stream into Alice's timeline only, not into the chat-room channel.
- Other agents on Alice's machine.
- Alice's other conversations or other peers.

### UI mitigations

- **AIShareBanner** at the top of the conversation when active. Visible to both. Cannot be dismissed without ending the session.
- **Initial confirmation modal** spells out what Bob will see and can do.
- **Owner sees a marked timeline-style view** alongside the chat: prompt → tool calls → response, full detail.
- **Limits visible** in the share-config dialog: max prompts (default 50), max tokens (default 100k), session timeout (default 1 h).
- **Auditable transcript** persists in `ai-shares/{sessionId}.json` after the session ends.

### Threat model carve-out

The relay's zero-knowledge property is preserved. The "sharing breaks code privacy" trade-off is **between Alice and Bob**, mediated by user consent, not by the relay's trust assumptions. SECURITY.md will be updated to call this out as a feature-specific deviation, not a regression of the platform-wide guarantees.

> **Open question Q2 (§13):** Should the _first_ AI share with each new friend require a more elaborate confirmation (e.g., type the friend's name)? Errs on side of friction. **Provisional: yes for Phase 1.**

### 7.5 Multi-daemon share routing (decided: explicit two-step)

When the owner has multiple daemons online (e.g. laptop + home server),
each potentially configured with one or more AI providers, every share
request from a friend triggers a **two-step modal** on the owner's UI
(any of the owner's devices that's online — they're synced via §5.5).
There is no auto-route, no per-friend default, no "main daemon" rule —
every share is an explicit, present-tense decision.

**Step 1 — pick the daemon:**
```
Bob wants to use one of your AIs.
Where do you want to share from?
  ○ Laptop A     (online, has: Claude, Codex)
  ○ Home Server  (online, has: Codex)
  ○ iPad daemon  (offline)
```

**Step 2 — pick (and confirm) the AI:**
```
[picked Home Server, which only has Codex]
Will share Codex from Home Server. Confirm?
  [Cancel] [Confirm]

[picked Laptop A, which has both Claude and Codex]
Which AI on Laptop A?
  ○ Claude
  ○ Codex
  [Cancel] [Confirm]
```

**Always two modals**, even when step 2 has a single option — the
second modal is a deliberate confirmation gate so the owner never
shares by accident. Mirrors the friction of "Q2: first-share extra
confirmation" but applied to every share, not just the first.

Why no shortcuts:
- Sharing an AI agent is high-stakes (the friend can issue tool calls
  the owner pays for). The few seconds of friction is the right
  trade-off vs the risk of misroute.
- Per-friend / per-AI defaults would create a settings surface to
  audit + a persistence concern across multi-device sync. Easier to
  re-decide each time than to trust stale config.
- If usage feedback proves friction is too high, Phase 5+ can add an
  opt-in "remember last route for this friend (24h)" toggle.

Phase 4 implements this UI; Phase 4's daemon-side routing only needs
to: (a) deliver the share request to ALL of the owner's daemons that
have any AI configured (so any of them can render the modal) and (b)
once the owner picks, lock the session to that specific daemon for
its whole lifetime.

#### 7.5.1 Where the modal renders (Q1: decided)

**Every online owner-device that has any AI configured shows the
modal simultaneously.** Whichever device the owner picks up first
handles the decision; the other devices' modals dismiss automatically
once the choice is broadcast over the multi-device sync layer (§5.5).

Rationale: optimizes for "owner picks up nearest screen and
responds". Avoids guessing "which device is the user holding right
now". Scales naturally — a 3-device user gets 3 chances to notice;
a 1-device user gets 1.

#### 7.5.2 Cancel UX (Q2: decided)

If the owner taps Cancel on either modal:
- Friend sees: **"Wendell declined the request"** (explicit, present
  tense)
- NOT: "Wendell isn't available right now" (intentionally rejecting
  ambiguity — better to be honest than passive-aggressive)
- NOT: silent timeout (leaving the friend hanging with a spinner is
  worse than a clear no)

Same rendering applies if the owner ignores both modals past a 60-
second timeout — friend sees "no answer", which is functionally a
decline.

#### 7.5.3 Switching mid-session (Q3: decided)

Once a share session is locked to a daemon (after step 2 confirm),
**the owner cannot reroute it to a different daemon mid-session**.
To change which daemon handles the share, the owner must:
1. Tap "End session" on the active banner
2. Wait for the friend to send a fresh share request
3. Pick a different daemon in the new step-1 modal

Rationale: a mid-session switch would force the friend's UI to
re-render the active conversation under a different "AI identity",
which is confusing and erodes the simple mental model of "I'm
talking to Wendell's Codex right now". Phase 5+ can revisit if real
demand surfaces.

---

## 8. Relay Changes

### 8.1 Today

Relay is a Cloudflare Worker that ferries WebSocket frames between exactly one client and exactly one daemon, after they've completed an ECDH handshake. It is stateless and does not store anything.

### 8.2 Required changes

**8.2.1 User-to-user message lane**

Add a new endpoint that ferries between two daemons (or between a peer's client and another peer's daemon). Routing is by recipient root public key. The relay must:

- Authenticate the sender (proof of possession of _some_ device under their root identity, via a signed challenge during handshake).
- NOT know the relationship between the two parties — it only has opaque pubkeys.
- Forward encrypted blobs.

**8.2.2 Offline message store**

Add Cloudflare Workers KV usage:

- Key: `inbox/{recipientRootPubKey}/{seq}` (or hashed for opacity)
- Value: encrypted blob, ≤ 64KB
- TTL: 7 days
- Recipient pulls on connect: `GET /inbox?since={lastSeq}` returns all entries newer than `lastSeq`, then deletes them.
- Sender sees `delivered` ack when their message is durably stored, separate from `read` ack from recipient.

**8.2.3 Limits**

- Max message size: 64KB encrypted (≈ 60KB plaintext).
- Larger media (images, videos): out-of-band via direct daemon-to-daemon WebRTC or chunked file transfer (deferred — Phase 5+).
- Per-user inbox cap: 10MB total or 1000 messages, whichever first. Exceeded ⇒ oldest dropped.

**8.2.4 Cost projection**

Cloudflare Workers KV free tier: 100k reads/day, 1k writes/day, 1GB storage. For a few hundred users in single-digit conversations per day, this fits inside free tier. Beyond that, KV is $0.50/million reads — economical.

> **Open question Q3 (§13):** Should we use Cloudflare Durable Objects instead of KV? More complex, but better for ordered delivery and coalescing. **Provisional: KV first; switch later if needed.**

---

## 9. UI Changes

### 9.1 "+" Menu

Replace the 4 items in `packages/app/src/components/top-right-add-menu.tsx`:

```typescript
const ITEMS: ReadonlyArray<AddMenuItem> = [
  { id: "chat.add.addFriend", labelKey: "chat.add.addFriend" }, // NEW
  {
    id: "chat.add.newGroup",
    labelKey: "chat.add.newGroup",
    disabled: true,
    disabledReasonKey: "chat.add.newGroupComingSoon",
  }, // NEW (Phase 5)
  { id: "chat.add.scan", labelKey: "chat.add.scan" }, // RENAMED from scanToPair, role expanded
  { id: "chat.add.addProject", labelKey: "chat.add.addProject" }, // RENAMED from createWorkspace
];
```

Removed: `chat.add.newChat` (was redundant with createWorkspace), `chat.add.joinHost` (moves to Settings → Hosts as advanced action). i18n keys for removed items kept in JSON for old-client compat per backward-compat policy (deprecated-but-accepted).

### 9.2 Action handlers

`packages/app/src/actions/chat-row-actions.ts`:

```typescript
defineAction("chat.add.addFriend", {
  description: "Add a friend by QR or link",
  modalities: ["menu", "cmdk"],
  schema: NoArgs,
  handler: async () => {
    const { router } = await import("expo-router");
    router.push("/friend-add");
  },
});

defineAction("chat.add.scan", {
  description: "Scan a QR code (friend, device link, etc.)",
  modalities: ["menu", "cmdk"],
  schema: NoArgs,
  handler: async () => {
    const { router } = await import("expo-router");
    router.push("/scan");
  },
});

defineAction("chat.add.addProject", {
  description: "Add a project (existing workspace creation flow)",
  modalities: ["menu", "cmdk", "voice"],
  schema: OptionalServerPayload,
  handler: async () => {
    const { useKeyboardShortcutsStore } = await import("@/stores/keyboard-shortcuts-store");
    useKeyboardShortcutsStore.getState().setProjectPickerOpen(true);
  },
});
```

### 9.3 New screens

| Screen                 | Path                          | Description                                                                                  |
| ---------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| **添加好友**           | `app/friend-add.tsx`          | Tabbed: "Show my QR" / "Paste link" / "Copy link to share"                                   |
| **扫一扫** (universal) | `app/scan.tsx`                | Camera view; reads QR; routes to friend-confirm or device-link-confirm based on `kind` field |
| **我的设备**           | `app/settings/devices.tsx`    | Lists devices with last-seen and remove                                                      |
| **好友确认**           | `app/friend-confirm.tsx`      | "Confirm friend request from <name>?" modal route                                            |
| **设备链接确认**       | `app/device-link-confirm.tsx` | "Link this device to <displayName>?" modal route                                             |
| **AI 共享配置**        | (modal in chat)               | Pick agent + model + limits, then send invite                                                |

### 9.4 New components

| Component              | Path                                    | Purpose                                                                                 |
| ---------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| `AIShareBanner`        | `components/ai-share-banner.tsx`        | Top-of-chat banner during active session; "End session" button                          |
| `AIShareCard`          | `components/ai-share-card.tsx`          | Renders the `ai-share/offer` message as a card with Accept/Reject buttons               |
| `OwnerTimelineSidebar` | `components/owner-timeline-sidebar.tsx` | When Alice (owner) views a chat with active AI share, side panel shows tool-call detail |

### 9.5 i18n strings (en + zh required)

```json
{
  "chat": {
    "add": {
      "addFriend": "Add friend",
      "newGroup": "New group",
      "newGroupComingSoon": "Coming soon",
      "scan": "Scan",
      "addProject": "Add project"
    },
    "friendAdd": {
      "title": "Add friend",
      "showMyQr": "My QR code",
      "pasteLink": "Paste link",
      "copyLink": "Copy invite link",
      "linkCopied": "Link copied",
      "confirmAddFriend": "Add {{name}} as friend?",
      "yes": "Yes",
      "cancel": "Cancel"
    },
    "scan": {
      "title": "Scan",
      "permissionNeeded": "Camera permission needed",
      "invalidCode": "Code is not a valid ottie code"
    },
    "device": {
      "list": "My devices",
      "addDevice": "Add this device",
      "remove": "Remove",
      "lastSeenJustNow": "just now",
      "lastSeenMinutes": "{{n}} min ago",
      "confirmLink": "Link this device to {{name}}?"
    },
    "aiShare": {
      "shareAi": "Share my AI",
      "requestAi": "Request AI from {{name}}",
      "selectAgent": "Choose an agent",
      "selectModel": "Choose a model",
      "limits": "Limits",
      "maxPrompts": "Max prompts",
      "maxTokens": "Max tokens",
      "sessionTimeout": "Session timeout",
      "send": "Send invite",
      "bannerActiveOwner": "{{name}} is using your {{model}} · End session",
      "bannerActiveConsumer": "Using {{name}}'s {{model}} · End session",
      "offerAccept": "Accept",
      "offerReject": "Reject",
      "endedByOwner": "{{name}} ended the AI sharing session",
      "endedByConsumer": "{{name}} stopped using your AI"
    }
  }
}
```

zh.json mirrors all keys with Chinese strings.

### 9.6 Stores

- `peer-store.ts`: friend list, add/remove/block, fetch peer device list.
- `identity-store.ts`: own root identity, devices, edit display name, link/unlink devices.
- `ai-share-store.ts`: per-conversation active-session state, models available to share, limits.

---

## 10. AI Sharing State Machine

```
                       ai-share/offer
            ┌────────────────────────────────┐
            │                                │
       PENDING (consumer)                    │
            │                                │
   ┌────────┼────────┐                       │
   │        │        │                       │
   ▼        ▼        ▼                       │
 reject   accept   timeout/cancel            │
            │                                │
            ▼                                │
         ACTIVE                              │
            │                                │
   ┌────────┼────────┬─────────┐             │
   │        │        │         │             │
prompt   prompt    timeout    end (either)   │
            │                  │             │
            └──── chunks*──────┘             │
                              │              │
                              ▼              │
                            ENDED ───────────┘ (no further action)
```

### Owner-side checks on each `ai-share/prompt`

1. Session exists, state = `active`.
2. Sender root pubkey matches `consumerRootPubKey`.
3. `consumedPrompts < maxPrompts` (if limit set).
4. `consumedTokens + estimatedTokens(prompt) < maxTokens` (if limit set).
5. Session not timed out.

If all pass: route to `agentManager` via `sendAgentMessage(agentId, body)`. Stream response chunks back as `ai-share/chunk` messages. Update counters.

### State transitions are messages

All transitions are `ChatMessage`s with appropriate `kind`. They appear in the chat history with system styling. This means:

- A consumer's offline catch-up replays them naturally.
- The chat history is a complete audit log of what happened.
- No separate event log needed.

---

## 11. PRODUCT.md Update (proposed addition)

Add to PRODUCT.md after the existing "Current target" section:

> ## Multi-User Collaboration (added 2026-MM)
>
> ottie is also a peer-to-peer collaboration layer. Developers can:
>
> - Add each other as friends — no account, no central server, QR or link.
> - One identity across multiple devices: laptop + second laptop + phone all show as one user to friends.
> - 1-to-1 chat with offline delivery via the existing zero-knowledge relay.
> - Share an AI agent with a friend for a bounded session, with the owner observing and able to revoke at any time.
>
> This extends the single-developer-tool current state toward the multi-lateral collaboration vision in the README. Group chat and folders are tracked as future work.

CLAUDE.md gets a parallel one-paragraph addition under "Project" pointing to this design doc.

---

## 12. Phased Implementation

> Each phase has a definition-of-done. Phases stack linearly. **No phase ships unless the phase before it works end-to-end on a real two-machine setup.**

### Phase 1 — Identity foundation (5 working days)

- `identity-types.ts`, root keypair generation, sealed storage.
- First-run flow: prompt for display name, generate identity.
- Devices: current daemon registers as device #0.
- "我的设备" view (read-only initially).
- **Done when:** `ottie cli identity show` prints my root pubkey and lists 1 device. Reinstalling preserves identity (sealed file roundtrip).

### Phase 2 — Device linking (5 working days)

- Universal `/scan` route + camera view.
- "Add device" QR generation flow.
- Cross-device handshake via relay (extends ECDH for ephemeral pairing).
- Device list synced across devices.
- "我的设备" remove action.
- **Done when:** Two laptops linked under one identity. Removing a device on laptop A shows the change on laptop B within 5 seconds.

### Phase 3 — Friend pairing + 1-to-1 chat (10 working days)

- `peer-store`, friend QR/link, accept-confirm both sides.
- Relay extension: user-to-user lane + offline KV inbox.
- ChatRoom kind=`p2p` with two members.
- Sending text messages, with offline delivery.
- Read receipts.
- **Done when:** Alice sends 10 messages while Bob is offline. Bob comes online, sees all 10, sends a reply, Alice receives it. Read receipts update both sides.

### Phase 4 — AI sharing (10 working days)

- `ai-share-store`, share-config modal.
- Owner-side prompt routing, limits enforcement.
- Streaming chunks back via `ai-share/chunk` messages.
- AIShareBanner, AIShareCard, OwnerTimelineSidebar.
- Auditable transcript file.
- **Done when:** Alice shares Claude Code with Bob. Bob asks "explain quicksort"; receives streaming response. Alice sees full prompt, response, and any tool calls Alice's agent made. Alice ends session; Bob's banner disappears within 2 seconds.

### Phase 5 — Polish + edge cases (5 working days)

- Block / unblock / remove friend.
- Display name update propagation.
- Limits exhaustion UI (Bob sees "Alice's limit reached").
- Session timeout enforcement (server-driven).
- Telemetry: counters for sessions started/ended/timed-out (local only, opt-in upload).
- **Done when:** all S1–S11 acceptance tests pass on real two-machine setup with one of the machines being a phone.

### Deferred (post-Phase-5, separate design doc)

- Group chat (3+ humans, multiple shared agents per room).
- Custom folders for conversation organization.
- Cross-friend AI sharing (A shares to B who shares to C).
- Mobile-as-leaf-without-daemon mode.
- Federation between peer graphs.

**Total (Phases 1–5): ~35 working days = 7 calendar weeks at one engineer.**

---

## 13. Open Questions

> Each one needs a decision before implementation hits it. Tracked separately for clarity.

**Q1 — Daemon-less mode for mobile?** Without a daemon online, can the phone act as a leaf node speaking directly to the relay? Implementing requires duplicating part of daemon logic in the app. **Confirmed: no for Phase 1–4.** Phone requires user to have at least one daemon online to send messages.

**Q2 — First-share friction?** Should the first AI share with a new friend require an extra confirmation (e.g., type their name)? **Confirmed: yes for Phase 1.**

**Q3 — KV vs Durable Objects for the offline inbox?** **Confirmed: KV first.** Re-evaluate if ordered-delivery edge cases bite.

**Q4 — Display name uniqueness?** Two friends both named "Wendell" — disambiguate by short pubkey suffix in UI? **Confirmed: yes.** Format: `名字 (a3f9)` where `a3f9` is the first 4 hex chars of the root pubkey.

**Q5 — Block UX?** Hard block vs soft block? **Confirmed: soft block** — peer can send, owner doesn't receive. Matches WhatsApp.

**Q6 — Identity backup / recovery?** If user loses all their devices, they lose their identity. **Confirmed: accepted for Phase 1.** No recovery flow; user has to start fresh and re-add friends. Phase 6+ adds seed-phrase recovery.

**Q7 — Multi-daemon-per-user?** **Confirmed: supported.** A user can run multiple daemons (laptop + home server). Per-share routing decided explicitly per-request via the two-step modal (§7.5); see §7.5.1–7.5.3 for the modal-rendering / cancel / mid-session-switch decisions.

**Q8 — Naming convention?** **Confirmed:** 中文 → "账号" (account); English → "identity".

**Q9 — Display name update rate-limit?** **Confirmed: once per 24h.** Old name shown briefly as `名字 (was: 旧名字)` for 7 days.

**Q10 — Surface "Alice ran a tool to write to /xxx" in Bob's view?** **Confirmed: not in Phase 4.** Bob sees prompt + response only. Phase 5 may add an opt-in "transparent mode" toggle on Alice's side.

---

## 14. Acceptance Criteria

Per `docs/DESIGN.md`:

- **S1** verifiable by `ottie cli identity show` after fresh install.
- **S2** verifiable by both laptops appearing in each other's `/settings/devices` after the link flow.
- **S3** verifiable by removing a device on laptop A and observing it disappear from laptop B's list within 5s.
- **S4–S5** verifiable by both sides showing the friend in their friend list after the pair flow.
- **S6** verifiable by sending a message and observing receipt in <2s on both sides while online.
- **S7** verifiable by the offline scenario: 5 messages → recipient closed → recipient opens → all 5 visible in order.
- **S8–S10** verifiable by the AI share scenario: invite → accept → 3 prompts → owner-end → ended state visible to both.
- **S11** verifiable by sending a message from phone and seeing it on laptop within 2s.

For all storyless verifications:

- `npm run typecheck` passes after each phase.
- `npm run lint` passes.
- `npm run format:check` passes.
- New code has Vitest unit tests; integration tests use real-relay fixture (no mocks).

---

## 15. Review Checklist

Approval gate (filled in upon move from Draft to Approved):

- [x] Owner identified — Wendell.
- [ ] Tracking issue created.
- [x] §13 open questions all have non-provisional answers.
- [ ] Cost projection in §8.2.4 reviewed against current relay billing.
- [ ] PRODUCT.md and SECURITY.md proposed updates landed.
- [ ] DATA_MODEL.md proposed appendix landed.
- [x] Backward-compatibility matrix for old mobile clients vs new daemons audited (CLAUDE.md WS rule) — all new fields `.optional()`, no required additions, no narrowed types.
- [ ] Phase 1 ready to start.

---

## 16. Concept Clarifications (avoid these confusions)

These are mental models that have come up during planning that
are NOT what the design says. Pinned here so future me / future
maintainers don't drift.

### 16.1 Multi-device ≠ "千军万马"(army of devices)

**Wrong mental model:** "I have 3 daemons → I can offer 3× the AI
capacity to friends" or "more devices = more reach for sharing".

**Correct mental model:** Multi-device is **one person, multiple
screens** — same as logging into WeChat on phone + laptop + iPad. A
friend adds **you** (the identity), not your specific device. They
see one Wendell. Your devices are interchangeable interfaces onto
the same identity.

For AI sharing:
- A friend's request lands on **one specific daemon** (the one you
  pick in the §7.5 modal). The other daemons don't help carry the
  load — they just sync state.
- "More devices" gives you redundancy ("if my laptop is closed, my
  home server is still online to handle Bob's request") + UI
  ubiquity ("I can hit Approve from whichever screen I'm at"), NOT
  parallelism.
- The AI itself runs on whichever single daemon has it configured
  with API keys, and that daemon's CPU/quota is what Bob actually
  uses.

### 16.2 Adding friends has nothing to do with how many devices you have

A 1-device user and a 100-device user can add the same number of
friends with the same UX. Friend-pair is **identity-to-identity**:
the QR carries the root pubkey, not any device-specific data. Once
paired, your full device list (Phase 2.f sync) makes the friend
visible on all your devices automatically.

### 16.3 Daemons sync, but they don't pool

Phase 2.f is "every daemon under one identity sees the same device
list, friend list, and chat history" — so you can switch screens
freely. It is NOT "every daemon shares its compute / API quota /
configured AIs into a common pool". An AI is bound to the daemon it
was configured on, full stop.

---

## 17. Implementation Status (current as of last commit)

Snapshot so a fresh planning session can pick up without re-reading
git log. Update on every phase boundary.

### Phase 1 — identity foundation
- ✅ COMPLETE
- root identity (Ed25519) created on first run, persisted to
  `$OTTIE_HOME/identity/root.json`
- self-device record + devices.json seeded on first boot
- WS RPCs: `identity/get`, `identity/initialize`, `device/list`
- CLI: `ottie identity show`
- App: first-run onboarding screen, `/settings/identity` read-only
  view, ProfileButton entry

### Phase 2.a–c — device-link offer generation + UI plumbing
- ✅ COMPLETE
- `device-link-pending-store.ts`: in-memory pending offers, X25519
  ephemeral keypairs, 8-offer cap, 10-min TTL
- WS RPCs: `device/link/generate`, `device/link/cancel`
- App: `/onboarding/add-device` QR + copy-link screen, wired into
  the chats `+` menu

### Phase 2.d — device-link redemption (new device → old device)
- ✅ COMPLETE (4 sub-commits)
- 2.d/0: candidate schema + ECDH + NaCl box crypto core (pure fns)
- 2.d/1: `connectionHandlers` extension point on relay-transport
- 2.d/2: receiver-side handler + `pending-candidate-store.ts`
- 2.d/3: sender-side `redeemDeviceLinkOffer` + WS RPC
  `device/link/redeem` + DaemonClient method

### Phase 2.e — approval + signing + persistence (old device → new)
- ✅ COMPLETE (3 sub-commits)
- 2.e/0: approve crypto core (signs candidate with root,
  encrypts reply via same ECDH key from Phase 2.d)
- 2.e/1: approve/reject through the same Phase 2.d socket; sender
  outcome shape grows `status: "linked"` carrying root identity +
  signed device + peer-list snapshot
- 2.e/2: `adoptIdentityFromLink` writes root.json +
  self-device.json + devices.json on the new device, in-memory
  state syncs to "loaded" without restart

### Phase 2.d/e UI
- ✅ COMPLETE
- `/onboarding/link-existing-device` paste-link form
- `/settings/identity` "Pending device requests" section, polls
  every 3s, Approve/Reject buttons

### Phase 2.f — multi-daemon device-list sync
- ✅ COMPLETE (6 sub-commits)
- 2.f/0: event sign/verify/apply pure functions (DeviceListEvent
  schema with kind=added/removed, Ed25519 sig by source self-device,
  per-source seq, idempotent merge with replay protection)
- 2.f/1: events log persisted to events.json,
  `IdentityService.tryEmitDeviceAddedEvent` after approve, inbound
  apply path
- 2.f/2a: SIGMA-I peer-sync handshake crypto (sign ephPubKey
  under long-term key, mutual auth, ECDH session key)
- 2.f/2b: receiver-side `connectionHandler` for `peer-sync:`
  prefix + `PeerSessionRegistry`, wired through bootstrap
- 2.f/2c: dialer — scans devices.json on boot, dials each peer
  daemon over relay, exponential-backoff reconnect
- 2.f/3: outbound broadcast + reconnect catch-up — when local emit
  fires, fan out encrypted event to every active peer session;
  when a fresh session is established, replay the local events log

### Phase 2.g — remove device + revocation
- ✅ COMPLETE
- `IdentityService.removeDevice(deviceId)` refuses self, persists
  devices.json, emits + broadcasts `device-removed`, closes peer
  session.
- WS RPC `device/remove` + DaemonClient.deviceRemove.
- UI: Trash2 button on each non-self device row in
  `/settings/identity`, with Alert.alert confirmation.
- Bilingual i18n.

### Phase 2 — DONE end-to-end ✅
Two laptops + a phone (one daemon each) under one identity now:
1. Add a new device via QR/link with explicit owner approval
2. Auto-sync the device list across all daemons within seconds via
   peer-sync sessions
3. Survive daemon restarts (reload from disk)
4. Survive network blips (dialer reconnects, catch-up replay)
5. Remove a device from any daemon, propagation happens through
   the same broadcast pipeline

### Phase 3 — friend pairing + 1-to-1 chat
- ⏳ IN PROGRESS — 3.a/0 done; 3.a/1 next
- ~50% reuse of Phase 2 crypto + transport (same Cloudflare relay,
  same NaCl box, same Ed25519, same SIGMA-I-style handshake but
  cross-identity instead of intra-identity)
- Sub-task status:
  - ✅ 3.a/0 — friend-pair offer schema + ECDH crypto core
    (`friend-pair-types.ts` + `friend-pair-redeem-types.ts` +
    `friend-pair-redeem.ts` + tests). Pure functions, no I/O. The
    candidate carries a SIGMA-I-style Ed25519 signature over
    `(offer.nonce, offer.ephPub, candidate.ephPub)` made with the
    responder's root sign key, defeating relay-side substitution.
  - ✅ 3.a/1 — friend-pair offer generation
    (`friend-pair-pending-store.ts` + tests). WS RPCs `friend/pair/
    generate` and `friend/pair/cancel`. `IdentityService.generate
    FriendPairOffer` / `cancelFriendPairOffer`. DaemonClient methods.
    Cross-identity analog of Phase 2.c.
  - ✅ 3.a/2 — receiver-side handler + sender-side redeem.
    `friend-pair-pending-candidate-store.ts` (parked candidates,
    8-cap, 10-min TTL). `friend-pair-receiver.ts` (relay handler
    for `friend-pair:<nonce>` prefix; SIGMA-I sig check + self-
    pairing rejection). `friend-pair-sender.ts` (WS to originator,
    sends signed redemption, awaits ack). WS RPC `friend/pair/
    redeem` + DaemonClient method. Bootstrap registers the new
    handler alongside device-link + peer-sync. Cross-identity
    analog of Phase 2.d/2 + 2.d/3.
  - ✅ 3.a/3a — Peer schema + peers.json store + approve crypto
    core. `peer-types.ts` (StoredPeer + peerAuthorizationPayload),
    `peer-store.ts` (load/save/upsert/remove with mode 0o600),
    `friend-pair-approve-types.ts` (FriendPairApprovalReply +
    Envelope schemas), `friend-pair-approve.ts` (approve / reject
    / decrypt / verify). Reuses Phase 3.a/2's shared key — no
    fresh ECDH on the reply.
  - ✅ 3.a/3b — bilateral confirm wired through the daemon. The
    sender now waits for the approval envelope (no longer settles
    on the candidate-received ack). IdentityService gains
    `getPeerList`, `listPendingFriendPairCandidates`,
    `approveFriendPair`, `rejectFriendPair`, `adoptPeerFromApproval`.
    `redeemFriendPairOffer` persists the resolved Peer on
    "paired". WS RPCs added: `friend/pair/candidates`,
    `friend/pair/approve`, `friend/pair/reject`, `friend/list`.
    The redeem outcome on the wire became `{status: "paired", peer}`
    or `{status: "rejected", errorCode, errorMessage}`. Mock-relay
    e2e (`friend-pair-mock-relay.e2e.test.ts`) verifies the full
    two-daemon happy path + rejection through real WebSockets.
  - ✅ 3.a UI — full app surface for friend pairing. New screens
    `/onboarding/add-friend` (QR + copy-link, mirrors add-device)
    and `/onboarding/redeem-friend-link` (paste-link + submit,
    mirrors link-existing-device). `/settings/identity` gains
    a "Friends" section (list of paired peers with displayName +
    pubkey-prefix + status), an "Add friend" button, and a
    "Pending friend requests" section that polls every 3s with
    Approve / Reject. Two new actions registered:
    `chat.add.addFriend` + `chat.add.redeemFriendLink`, surfaced
    in the top-right `+` menu (now 8 items). Bilingual i18n
    strings landed in en.json and zh.json.
  - ✅ 3.b/0 — chat-room kind=p2p schema. `ChatRoomSchema` gains
    optional `kind` (`"agent-only" | "p2p" | "group"`),
    `ownerRootPubKey`, and `members` (array of `{rootPubKey, role,
    addedAt}`). `ChatMessageSchema` gains optional
    `authorRootPubKey`, `authorDeviceId`, `kind` (incl. all
    `ai-share/*` variants for Phase 4 forward-compat), `payload`.
    All new fields are `.optional()` so the back-compat matrix
    stays satisfied (old daemon strips → new client ignores → old
    client receiving new payload still parses + renders the
    `body` fallback). New helpers: `p2pRoomId({a, b})` derives
    a deterministic order-insensitive `p2p:<a>|<b>` id;
    `isP2pRoom(room)` type-guard.
  - ⏳ 3.b/1 — message send/receive over relay (live)
  - ⏳ 3.b/2 — Cloudflare KV inbox for offline delivery; recipient
    pulls on connect with cursor
  - ⏳ 3.b/3 — read receipts + UI integration (chats list shows
    friends + agents side-by-side)

### Phase 4 — AI sharing
- ⏳ NOT STARTED
- §7.5 modal flow decided. Per-share two-step gate (no auto, no
  per-friend defaults). All online owner-devices render the modal,
  whoever the owner picks up first wins. Cancel surfaces explicit
  "declined" to friend. No mid-session daemon switching.

### Phase 5 — polish
- ⏳ NOT STARTED
- Block, display name update propagation, limits-exhaustion UI,
  session timeout enforcement.

### Test infrastructure status
- 300 tests across 29 files in the identity + relay-transport
  suite, all green (192 from Phase 2 + 20 from 3.a/0 + 23 from
  3.a/1 + 27 from 3.a/2 + 21 from 3.a/3a + 17 from 3.a/3b
  including a real-WebSocket e2e). Stability check: 5 consecutive
  runs all 300/300 passed.
- `mock-relay.ts` — in-process Cloudflare adapter clone for
  spawning real WebSocket bridges in tests without wrangler-dev.
- Real two-daemon e2e: `device-link-mock-relay.e2e.test.ts` covers
  the Phase 2.d/2.e happy path through real `ws` sockets.
- Documented gotcha (relay-transport.ts comment + mock-relay.ts):
  any new ws→ws bridge MUST propagate `isBinary` — Node's `ws`
  delivers `data` as Buffer regardless of frame kind.

### Tech-stack invariants (do not change without re-deciding)
- Cloudflare Workers relay (free tier suffices for personal-scale)
  at `relay.claws.company:443`
- NaCl box (Curve25519 + XSalsa20-Poly1305) for application-layer
  encryption everywhere; SIGMA-I for peer-sync handshake
- Ed25519 for all signatures (root, self-device, events, peer-hello)
- JWK base64url for raw 32-byte key serialization on disk
- One identity = N daemons, N can include zero (pure-client phone)
  but at least one daemon must be online to send messages
- Open-source under AGPL-3.0; user explicitly OK with license
  traction
- DO NOT switch to SimpleX, do not copy HuLa code (research
  isolation memory: feedback_research_isolation.md)
