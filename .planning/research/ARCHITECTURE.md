# Architecture Research — Milestone v1.11 (User Flow Polish)

**Domain:** Local-first daemon + cross-platform client (Expo RN + Tauri) for AI coding-agent control
**Researched:** 2026-04-29
**Confidence:** HIGH for carve strategy and schema evolution (well-established industry patterns); MEDIUM for cross-modal action surface and theme system (Ottie-specific synthesis); HIGH for local-daemon auth (Docker / Tailscale prior art is direct).

---

## 0. Executive summary

This is a **subsequent-milestone architectural plan**, not a greenfield design. Ottie's runtime architecture (daemon + binary-multiplexed WebSocket + Expo client + relay) is shipped and working. The v1.11 architectural moves are surgical:

1. **Carve `session.ts`** (ARCH-01) using a **router-first Strangler Fig** — extract a thin `MessageRouter` that delegates to **domain handlers** (one per concern: agents, terminals, voice, chat, file-explorer, permissions). Big-bang rewrites are forbidden by the milestone's own constraints (active in-flight work in 64 files).
2. **Formalize schema evolution** (ARCH-02) by adopting **Stripe's "never break, always version-gate" rule** plus **Protobuf's "reserved field" discipline**, with a documented `@deprecated since=vX.Y, removeAfter=vX+6.0` annotation in `packages/server/src/shared/`.
3. **Build a cross-modal Action Registry** (NAT-01, AGT-01, NAV-A4) — a single `Action` table that voice / command-center / long-press / keyboard all consume. Modeled on VS Code's `CommandRegistry` + `keybindings.json` separation.
4. **Optimistic agent creation with client-supplied nonce** (AGT-04), using Discord's MESSAGE_CREATE-nonce-reconciliation pattern: client mints a `pendingAgentId`, daemon echoes it on confirmation, UI swaps to canonical id on `agent_update`. Failure → mark optimistic agent as `error` with re-prompt.
5. **Daemon-computed recents, client-cached** (SES-05) — same source as workspace-registry, broadcast over the existing `workspace_update` channel. Cross-device continuity falls out of the daemon being shared.
6. **Tiered theme tokens** (THM-01) — primitive → semantic → component, on top of `react-native-unistyles`. Tokens live in `packages/app/src/styles/tokens/` as TypeScript (the W3C DTCG JSON spec is a target for export, not a build dependency).
7. **Local-daemon auth uplift** (ARCH-03) — keep loopback-trust as default (Docker-style), add an opt-in `OTTIE_LOCAL_TOKEN` for non-loopback bind, and an OS-keychain-backed token file (`$OTTIE_HOME/local-token`, mode 0600) auto-generated for desktop-bundled daemon. CLI and desktop app pick it up automatically; nothing breaks for existing same-machine flow.

**Phase-ordering implication:** ARCH-01 (carve) must precede heavy schema additions and the optimistic-UI work, because both require touching `session.ts`. The carve creates the seams we need; without it, every parallel phase pays the merge-conflict tax.

---

## 1. System overview — what changes in v1.11

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                      │
│  ┌────────────┐ ┌──────────┐ ┌─────────────┐ ┌──────────────────────┐    │
│  │ Mobile App │ │   CLI    │ │ Web browser │ │ Tauri Desktop shell  │    │
│  │   (Expo)   │ │(Commander)│ │  (Expo Web) │ │ (bundled daemon)     │    │
│  └─────┬──────┘ └─────┬────┘ └─────┬───────┘ └────────┬─────────────┘    │
│        │  + Action Registry (NEW: shared between command-center,         │
│        │    long-press, voice, keybindings)                              │
└────────┼──────────────┼──────────────┼──────────────────┼────────────────┘
         │ WS or Relay  │ WS direct    │ WS local         │ Subprocess + WS
         └──────────────┴──────────────┴──────────────────┘
                                │
              ┌─────────────────▼──────────────────────┐
              │  DAEMON (packages/server)               │
              │  ┌──────────────────────────────────┐   │
              │  │ Connection / Handshake / Auth    │   │  NEW v1.11:
              │  │ (websocket-server.ts)            │   │  - Optional local token
              │  └──────────────┬───────────────────┘   │  - Host-header check (already)
              │                 │                        │
              │  ┌──────────────▼───────────────────┐   │  NEW v1.11:
              │  │ MessageRouter (extracted from    │   │  - Schema-version gate
              │  │  session.ts) — Zod-validated     │   │  - Backward-compat shim layer
              │  │  dispatch by msg.kind            │   │
              │  └──┬──────┬──────┬──────┬─────┬────┘   │
              │     │      │      │      │     │         │  Domain handlers (NEW carve targets):
              │  ┌──▼──┐┌──▼──┐┌──▼──┐┌──▼──┐┌─▼───┐    │  - AgentSessionHandler
              │  │Agnt ││Term ││Voic ││Chat ││File │    │  - TerminalSessionHandler
              │  │Hndlr││Hndlr││Hndlr││Hndlr││Hndlr│    │  - VoiceSessionHandler
              │  └──┬──┘└──┬──┘└──┬──┘└──┬──┘└─┬───┘    │  - ChatSessionHandler
              │     │      │      │      │     │         │  - FileExplorerHandler
              │  ┌──▼──────▼──────▼──────▼─────▼───┐    │  - PermissionHandler
              │  │ Existing services (unchanged):   │   │  - ProjectsHandler
              │  │  AgentManager, TerminalManager,  │   │  - SettingsHandler
              │  │  VoiceManager, ChatService,      │   │
              │  │  FileExplorer, MCP, etc.         │   │
              │  └──────────────┬───────────────────┘   │
              └─────────────────┼──────────────────────┘
                                ▼
              External agent providers (Claude SDK, Codex, OpenCode, ACP)
```

The carve does **not** introduce new managers — it splits the `session.ts` god-class so each existing manager has a narrow handler that owns the per-connection state (subscriptions, debouncers, in-flight requests) for that domain.

---

## 2. Component responsibilities (new + changed in v1.11)

| Component                                                           | Owns                                                                                                                       | Talks to                                   | New in v1.11?                          |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| `MessageRouter` (`packages/server/src/server/session/router.ts`)    | Receive WS frame → Zod parse → look up handler by `msg.kind` → dispatch                                                    | All domain handlers; logging; metrics      | **NEW (carved from `session.ts`)**     |
| `AgentSessionHandler`                                               | Per-connection agent subscriptions, fetch/list/create/stop, optimistic-create reconciliation, run-state broadcast filter   | `AgentManager`, `MessageRouter`            | **NEW (carved)**                       |
| `TerminalSessionHandler`                                            | Per-connection terminal subscriptions, binary-mux channel allocation, PTY input/output framing                             | `TerminalManager`, binary-mux layer        | **NEW (carved)**                       |
| `VoiceSessionHandler`                                               | Voice-control routing, dictation framing, audio bridge per-agent registration                                              | `VoiceManager`, `STTManager`, `TTSManager` | **NEW (carved)**                       |
| `ChatSessionHandler`                                                | Chat room subscription lifecycle, attachment upload protocol                                                               | `ChatService`, `FileDownloadService`       | **NEW (carved)**                       |
| `FileExplorerHandler`                                               | File listing, diff subscriptions, checkout streaming                                                                       | `FileExplorerService`, `WorktreeService`   | **NEW (carved)**                       |
| `PermissionHandler`                                                 | MCP permission requests, tool-call context bundling, decision routing                                                      | `MCPServer`, `AgentManager`                | **NEW (carved)**                       |
| `ProjectsHandler`                                                   | Workspace + project registry sync, recent-sessions calculation                                                             | `WorkspaceRegistry`, `ProjectStore`        | **NEW (carved + recents logic)**       |
| `SchemaVersionGate`                                                 | Per-message capability gating (e.g. "client too old for X — send fallback")                                                | `MessageRouter`, all handlers              | **NEW**                                |
| `LocalTokenAuth` (`packages/server/src/server/auth/local-token.ts`) | Generate / read / verify the local-daemon token                                                                            | `websocket-server.ts`, `bootstrap.ts`      | **NEW**                                |
| `ActionRegistry` (`packages/app/src/actions/registry.ts`)           | Single source of truth for user-invokable actions; consumed by command-center, voice router, long-press menus, keybindings | All UI surfaces                            | **NEW**                                |
| `ThemeTokens` (`packages/app/src/styles/tokens/`)                   | Primitive → semantic → component token tree                                                                                | `theme.ts`, every styled component         | **Formalizes existing in-flight work** |
| `OptimisticAgentStore` (Zustand)                                    | Pending agent records keyed by client nonce; reconciliation on `agent_update`                                              | Agent list UI, message-input               | **NEW**                                |

---

## 3. Question 1 — The `session.ts` carve

### 3.1 Reality check

`session.ts` is currently **9,592 lines** with at least 81 domain-prefixed handler methods (`handleAgent…`, `handleTerminal…`, `handleVoice…`, `handleChat…`, `handleDictation…`, `handleSubscribeCheckout…` etc.) plus broadcast logic, MCP plumbing, and version-gating utilities. The methods are loosely organized by concern but share `this` state heavily, which is what makes a naive "extract by region" refactor dangerous: shared state becomes the implicit contract.

### 3.2 Pattern survey

| Pattern                                   | Real-world examples                                                                                                        | Verdict for Ottie                                                                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Router-first / handler dispatch table** | LSP implementations (`vscode-languageserver-node`, terraform-ls's `Assigner`), Discord opcode dispatcher, JSON-RPC `jrpc2` | **YES — primary pattern.** Every WS message already has a `kind` discriminator (Zod). Carving along `kind` is mechanical and reversible.                                |
| **Domain-first extraction**               | LSP plugin systems (vue-language-tools), TypeScript service plugins                                                        | **YES — consume after router.** Once the router exists, each `handleXxx` group lifts cleanly into a `XxxSessionHandler` class that owns its slice of `this`.            |
| **Event bus / pub-sub**                   | Discord4J `EventDispatcher`; some Electron apps                                                                            | **NO.** Adding pub-sub creates a second routing layer for state already routed by message kind. Two routers > one router.                                               |
| **Actor model**                           | Erlang/OTP, Akka, Orleans                                                                                                  | **NO.** Actors solve concurrent-state-isolation; Node single-threaded model already gives that. Overkill.                                                               |
| **Microservices split**                   | None for client-state code                                                                                                 | **NO.** Per-connection state cannot be split across processes without a coherence layer that costs more than the carve saves.                                           |
| **Strangler Fig wrapping**                | Shopify legacy refactors, Azure modernization guidance                                                                     | **YES — meta-pattern.** Each carve step ships behind a runtime boolean (e.g. `process.env.OTTIE_USE_NEW_ROUTER`) so we can flip back instantly if a regression appears. |

**Why router-first beats domain-first as step 1:** the router is the only piece that touches _every_ method. Building it once, with its dispatch table empty, then redirecting one `kind` family at a time, gives us a continuous green CI line throughout the carve. Domain-first first would require either two `session.ts`-like classes (the old one and a smaller one) or all-at-once extraction (big bang).

### 3.3 Concrete step ordering

Each step is independently mergeable; each leaves the system green.

> Numbering uses the pattern `C-N` for "Carve step N" — referenced in PITFALLS.md and ROADMAP.md.

| Step    | Action                                                                                                                                                                                                                                                    | Risk                                                                                        | Verifies                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **C-1** | Extract `MessageRouter` interface and a `RouterTable` registry. `Session` class instantiates and delegates `onMessage` to router. Initially the router calls back into `session.ts` methods via bound function refs — zero behavior change.               | LOW — pure indirection, no logic moved                                                      | All existing tests pass. Add a router-level unit test that asserts every `kind` is registered. |
| **C-2** | Extract Zod-validation layer into `validateInbound(msg)` that returns a parsed-discriminated-union. Router uses parsed value, handlers receive typed `msg`.                                                                                               | LOW — Zod is already used in `shared/messages.ts`; this just moves the call site.           | Type narrowing in handlers verified by `tsc`.                                                  |
| **C-3** | Carve `PermissionHandler` first. It has the smallest surface (~5 message kinds), is critical-path (AGT-05), and is a clean test of the pattern. The handler holds its own per-connection state (in-flight permission ids) instead of using shared `this`. | LOW                                                                                         | Permission flow E2E test (existing).                                                           |
| **C-4** | Carve `TerminalSessionHandler`. Owns binary-mux channels per-connection. Touches binary frames so includes a small unit test for channel allocation.                                                                                                      | MEDIUM — binary mux is finicky; isolate behind `OTTIE_USE_NEW_ROUTER` flag for one release. | Existing terminal E2E + new channel-alloc unit test.                                           |
| **C-5** | Carve `FileExplorerHandler` + `ChatSessionHandler` (independent, can ship together).                                                                                                                                                                      | LOW                                                                                         | Existing tests.                                                                                |
| **C-6** | Carve `VoiceSessionHandler`. The biggest because dictation + voice-control + audio bridge all live here.                                                                                                                                                  | MEDIUM                                                                                      | Existing voice tests + manual dictation pass.                                                  |
| **C-7** | Carve `AgentSessionHandler`. Largest by line count; do last so all helpers it depends on are already isolated. **This is the one that unblocks AGT-04 optimistic UI** because it owns `CreateAgentRequestMessage` handling.                               | MEDIUM-HIGH                                                                                 | Full agent-creation E2E + all subscription tests.                                              |
| **C-8** | Carve `ProjectsHandler` (workspace + recents logic). Adds **new** `recent_sessions` computation — see Q5.                                                                                                                                                 | LOW for carve, MEDIUM for recents                                                           | Workspace sync test + new recents test.                                                        |
| **C-9** | Delete `session.ts` shell. What remains is `Session` as a thin per-connection container that holds the handler instances, lifecycle hooks (`open` / `close`), and the router. Target file size: ≤500 lines.                                               | LOW (final cleanup)                                                                         | Smoke test all of the above.                                                                   |

### 3.4 What **stays** in `Session`

- Handshake (`WSHelloMessage` → `WSWelcomeMessage` reply)
- Lifecycle hooks (`onOpen`, `onClose`)
- Router instance
- Handler instance graph (composition root for this connection)
- Cross-handler state nobody else owns (ex: `appVersion`, `clientId`, `daemonVersion`)
- Heartbeat

### 3.5 Industry parallel — VS Code Language Server

LSP servers built on `vscode-languageserver-node` and `jrpc2` resolve a near-identical god-handler problem with the same router-first approach: a small dispatcher (`Assigner` / `connection.onRequest`) keeps the protocol surface; handler functions live in domain modules; tracing and error wrapping are shared at the dispatcher layer. ([Microsoft LSP spec 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/), [terraform-ls implementation overview](https://deepwiki.com/hashicorp/terraform-ls/4-language-server-protocol-implementation))

---

## 4. Question 2 — Schema-evolution patterns (ARCH-02)

### 4.1 What CLAUDE.md already says, and what's missing

CLAUDE.md is unambiguous: **never narrow, never remove, always optional with default.** What's missing per CONCERNS H7 is a **removal schedule** and a **deprecation discipline**. Right now shims accumulate forever.

### 4.2 Industry-standard pattern — Stripe + Protobuf hybrid

**From Stripe ([API versioning](https://docs.stripe.com/api/versioning), [API upgrades](https://docs.stripe.com/upgrades), [release blog](https://stripe.com/blog/api-versioning)):**

- Backward-compat is the default contract. New optional fields, never remove.
- When deprecating, the field is **gated by version internally** (older clients see old behavior; newer clients see new). The field is not removed.
- Removal happens at major versions, on a documented multi-year cadence.

**From Protobuf ([best practices](https://protobuf.dev/best-practices/dos-donts/), [editions guide](https://protobuf.dev/programming-guides/editions/)):**

- Mark `[deprecated = true]` first.
- After "sufficient time" (Protobuf docs suggest **≥3 months**) remove the field's wire usage but **reserve** the field number/name forever — it can never be reused.

### 4.3 Recommendation for Ottie

Adopt the following discipline in `packages/server/src/shared/messages.ts`:

```ts
// ❶ Deprecation is explicit and machine-readable.
const LegacyAgentLabelsField = z
  .array(z.string())
  .optional()
  .describe("@deprecated since=v1.10 use=`labels` removeAfter=v1.16");

// ❷ Removed-but-reserved is a top-level export so future devs see it.
export const RESERVED_FIELDS = {
  AgentRequest: ["legacyHostId", "legacyAgentLabelsField"],
} as const;

// ❸ The shim layer is centralized, not scattered.
// `applyAgentRequestShims` is the single point that maps deprecated → canonical.
// When `removeAfter` ships, delete from this file plus the schema in lockstep.
```

Plus a **removal calendar** in `docs/SCHEMA_EVOLUTION.md`:

| Field                        | Deprecated since | Remove after                                           | Replacement       |
| ---------------------------- | ---------------- | ------------------------------------------------------ | ----------------- |
| `agentLabels` (string array) | v1.10            | v1.16 (~6 minor releases ≈ 3 months at weekly cadence) | `labels` (object) |

**Concrete rules** (extends CLAUDE.md):

1. Every newly-added optional field **must** have a `.describe()` JSDoc tag for tooling.
2. Every deprecation **must** specify `since=` and `removeAfter=`.
3. `removeAfter` is **at least 6 minor releases** from `since` (≈3 months at v1.x weekly cadence) — matches Protobuf guidance and Stripe's "no breakage in monthly releases."
4. Once removed, the field name is added to `RESERVED_FIELDS` and never reused.
5. CI lints the schema file: any `@deprecated` without `removeAfter`, or any field whose `removeAfter` is past the current version, fails the build.

### 4.4 Why this satisfies CLAUDE.md

CLAUDE.md says "old mobile clients keep working" and "never remove." Stripe-style version-gating + Protobuf-style reservation honors both: old clients still get old fields populated; new clients use new fields; only after the **6-month-old-client horizon** (CLAUDE.md's mental test) does the field actually disappear, and even then the **name is reserved** so we cannot accidentally reintroduce a different meaning under the same key.

### 4.5 Phase ordering

- ARCH-02 lands **after** C-2 (Zod validation extracted), because the shim layer hooks into the parse step.
- Schema additions for SES-05 (recent sessions), AGT-04 (optimistic id), THM-01 (theme version) all use the new annotation discipline.

---

## 5. Question 3 — Cross-modal action surface (NAT-01, AGT-01, NAV-A4)

### 5.1 Goal

The same user intent — "create new agent in current workspace" — must be reachable from:

- Command-center (⌘K palette)
- Long-press on agent list / sidebar
- Voice trigger ("hey otter, new agent")
- Keyboard shortcut (e.g. ⌘N)

Today these are wired up in **four different places** with handler logic duplicated. NAT-01 sets a hard target of ≥80% parity; AGT-01 says "single canonical entry point."

### 5.2 Pattern — VS Code's `CommandRegistry` + `keybindings.json`

VS Code separates three concerns ([VS Code commands API](https://code.visualstudio.com/api/extension-guides/command), [keybindings registry source](https://github.com/Microsoft/vscode/blob/main/src/vs/platform/keybinding/common/keybindingsRegistry.ts)):

1. **CommandRegistry** — `commands.registerCommand(id, handler)` registers an action by id with its handler.
2. **Keybindings** — `keybindings.json` maps key chord → command id, conditioned on a `when` expression.
3. **Command Palette** — auto-discovers all commands flagged `commandPalette: true` in their manifest.

This decouples **what an action does** from **how it is invoked**. Adding a new invocation mode (touch, voice) is a new dispatcher reading the same registry.

### 5.3 Raycast confirms the pattern

Raycast ([extension architecture](https://www.raycast.com/blog/how-raycast-api-extensions-work), [command docs](https://developers.raycast.com/api-reference/command)) ships an extension as `package.json`-declared command metadata + an entry-point file per command. The shell discovers commands via the manifest; keybindings, palette entries, and quicklink invocation all bind to the same id.

### 5.4 Architecture for Ottie

```
packages/app/src/actions/
  registry.ts          ← single source of truth: Map<ActionId, ActionDef>
  types.ts             ← ActionDef interface (see below)
  catalog/
    agents.ts          ← createAgent, switchAgent, stopAgent, ...
    workspaces.ts      ← switchWorkspace, openProjectPicker, ...
    sessions.ts        ← resumeRecentSession, jumpToToolCall, ...
    permissions.ts     ← approvePermission, denyPermission, ...
    settings.ts        ← openSettings, toggleVoice, ...
  dispatchers/
    use-command-center.ts    ← reads registry, renders palette
    use-action-shortcuts.ts  ← reads registry's `keybinding`, binds globally
    use-long-press-menu.ts   ← reads registry's `surfaces.longPress`
    use-voice-router.ts      ← reads registry's `voice.intents`, matches against transcription
```

```ts
interface ActionDef {
  id: ActionId; // "agent.create", "workspace.switch", ...
  title: { en: string; zh: string }; // bilingual per CLAUDE.md
  icon?: ComponentType;
  keybinding?: { mac: string; win: string }; // e.g. "cmd+n" / "ctrl+n"
  surfaces: {
    commandCenter?: { weight: number; section: "agents" | "navigation" | ... };
    longPress?: { contexts: ("agent" | "workspace" | "session")[] };
    voice?: { intents: string[]; phrases: string[] };
  };
  when?: (ctx: AppContext) => boolean; // VS Code-style guard
  run: (args: ActionArgs) => Promise<void> | void;
}
```

The voice router parses transcription, matches against `surfaces.voice.intents` + `phrases`, and invokes `action.run()` — same path as a ⌘K selection. Parity is mechanical: any new action that registers with `voice.intents` is voice-callable for free.

### 5.5 Cross-platform considerations

- **Web/Desktop:** keybindings via `useEffect` with `keydown`. Already partially wired; refactor to read from registry.
- **iOS/Android:** keybindings degrade to no-op; long-press surfaces become primary. Hardware-keyboard (iPad with Magic Keyboard) — bind via `<View onKeyPress>` only when supported.
- **Voice:** runs on `packages/server/src/server/voice/` (transcription) and `packages/app/src/voice-control/` (UI). The router on the **client** is the matcher; the daemon stays voice-agnostic for routing.

### 5.6 Phase ordering

- ActionRegistry depends on **NAV-A4** (command-center is the consumer) — ship registry before refactoring command-center.
- Voice router refactor (NAT-01) **must come after** registry, otherwise voice and command-center will diverge again.
- Long-press refactor can happen in parallel because each surface only reads from the registry.

---

## 6. Question 4 — Optimistic agent creation (AGT-04)

### 6.1 The reconciliation problem

Today: user taps "create agent" → daemon round-trip → agent appears in list → user can prompt. With round-trip latency (especially on relay) this is 200–600ms of "did it work?" silence. AGT-04 demands ≤200ms perceived feedback.

### 6.2 Pattern — Discord MESSAGE_CREATE nonce

Discord ([discord-api-docs nonce discussion](https://github.com/discord/discord-api-docs/discussions/3396), [discord.js Message](https://discord.js.org/docs/packages/discord.js/main/Message:Class)) solves this for chat:

1. Client generates `nonce` (≤25 chars).
2. Client renders message with status `pending`, keyed by nonce.
3. Client `POST /messages` with the nonce.
4. Gateway emits `MESSAGE_CREATE` containing the same nonce.
5. Client matches by nonce, replaces optimistic record with canonical id, marks `sent`.

If the POST 4xx's, the client marks `failed`. If the gateway never echoes, the client times out. The nonce **also dedupes retries** — two POSTs with the same nonce produce one message.

### 6.3 Architecture for Ottie

```
User taps "Create agent"                                   Daemon (AgentSessionHandler)
       │                                                          │
       │ 1. Mint clientNonce = "agt_" + uuid                       │
       │ 2. OptimisticAgentStore.add({                             │
       │      nonce, status: "pending", title, prompt,             │
       │      cwd, provider, mode, createdAt, ... })               │
       │ 3. Render in agent list with shimmer + spinner            │
       │ 4. Send CreateAgentRequestMessage{ clientNonce, ... } ────►
       │                                                          │
       │                                                          │ AgentManager.create()
       │                                                          │   → produces agentId
       │                                                          │   → emits agent_update{
       │                                                          │       id: agentId,
       │                                                          │       clientNonce,  ← echoed
       │                                                          │       state: "initializing"
       │                                                          │     }
       │                                                          │
       │ ◄──────────────────── agent_update + clientNonce ─────────│
       │                                                          │
       │ 5. OptimisticAgentStore.reconcile(clientNonce, agentId): │
       │    - canonical id replaces nonce                         │
       │    - status: "live"                                      │
       │    - subscriptions migrate to canonical id                │
       │ 6. If user already started typing prompt during           │
       │    pending, send CreateAgentInputMessage{ agentId }       │
       │    queued by nonce, flushed on reconcile.                 │
       │                                                          │
       │ ──── timeout (5s) without echo ───────────────────────────│
       │ 7. Mark status: "error", surface "create failed" toast   │
       │    with retry. Optimistic record stays in list as        │
       │    "failed" until user retries or dismisses.              │
       │                                                          │
       │ ──── daemon emits AgentCreateRejected{ clientNonce, ... } │
       │ 8. Mark status: "rejected", show reason inline.          │
```

### 6.4 Schema additions (must be backward-compat per ARCH-02)

```ts
// shared/messages.ts
const CreateAgentRequestMessageSchema = z.object({
  kind: z.literal("CreateAgentRequest"),
  // ... existing fields ...
  clientNonce: z.string().max(64).optional(), // NEW — old clients omit
});

const AgentUpdateSchema = z.object({
  kind: z.literal("agent_update"),
  id: z.string(),
  // ... existing fields ...
  clientNonce: z.string().optional(), // NEW — daemon echoes when present
});

// NEW message type — daemon → client only on rejection
const AgentCreateRejectedSchema = z.object({
  kind: z.literal("AgentCreateRejected"),
  clientNonce: z.string(),
  reason: z.enum(["invalid_provider", "quota", "auth", "internal"]),
  message: z.string(),
});
```

Old clients ignore `clientNonce` (they don't read it) and never receive `AgentCreateRejected` (they don't subscribe to it; it's a new kind they ignore via Zod's safeParse-discriminated-union catch). New daemon talking to old client still works because the request flow doesn't require nonce.

### 6.5 What can go wrong (PITFALLS-tagged)

- **Duplicate-nonce attack on retry:** if user double-taps, two requests with same nonce → daemon must `idempotent: return existing agent if nonce already created an agent recently` (5-min window, like Discord). `AgentManager.create()` grows a `nonceIndex: Map<string, agentId>` cleared on agent close.
- **Optimistic UI shows tools the agent doesn't actually have:** until reconcile, render only the **prompt** the user typed and a "starting..." state. Don't show a fake timeline or fake provider badge — they'd flash on reconcile.
- **Reconnection loses the in-flight pending agent:** OptimisticAgentStore persists pending records to local storage with a TTL. On reconnect, the daemon's actual agent list arrives via `fetchAgents`; we match by nonce against any pendings, drop unmatched older than 60s.
- **Cross-device race:** if user starts on phone, switches to desktop while creation is in flight, only one device sees the optimistic record. Acceptable — the canonical agent_update broadcasts to all connections and both devices converge.

### 6.6 Industry parallel

- **Linear:** ([sync engine architecture](https://www.fujimon.com/blog/linear-sync-engine), [object sync engine](https://stack.convex.dev/object-sync-engine)) maintains an in-memory MobX store with optimistic mutations queued; rejects are reconciled by re-applying server state.
- **Notion:** uses operation-id reconciliation similar to Discord nonce.
- **Things 3 / Linear / Notion** all show that **never animate the rejection silently** — always surface the failure inline so the user knows the optimism failed.

---

## 7. Question 5 — Recent-sessions surfacing (SES-01, SES-05)

### 7.1 Where to compute

| Option                                      | Pros                                                                                                   | Cons                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **Daemon only, broadcast**                  | Single source of truth; cross-device falls out automatically; uses existing `workspace_update` channel | Daemon must persist `lastInteractedAt` per agent; slightly more disk I/O                 |
| **Client only, derive from timeline cache** | No daemon change                                                                                       | Doesn't sync across devices (the whole point of SES-05); each device sorts independently |
| **Both**                                    | —                                                                                                      | Two sources, drift, debugging hell                                                       |

**Recommendation: daemon-computed, client-cached.** The daemon already owns workspace registry, agent state, and timeline. Adding a `lastUserInteractionAt` timestamp and a derived "top N recents" is one DB column + one selector. Cross-device continuity (SES-05) is an automatic side-effect of having one computational source.

### 7.2 Industry pattern

- **Slack** ([sort by recent activity option](https://www.quora.com/How-do-I-sort-channels-in-Slack-according-to-the-latest-message-received)) computes server-side, cached client-side. The client receives a sorted list and respects ordering.
- **ChatGPT** sidebar fetches recent conversations via API; same pattern.
- **Linear inbox** uses a sync engine where the server is canonical and clients merge incremental updates.

### 7.3 Implementation

```ts
// packages/server/src/server/agent/agent-storage.ts
interface AgentMetadata {
  // ... existing ...
  lastUserInteractionAt?: number; // updated when user sends a message,
  // approves a permission, opens timeline, etc.
}

// packages/server/src/server/services/recent-sessions.ts (NEW)
function computeRecentSessions(workspaceId: string, limit = 10): SessionSummary[] {
  // ORDER BY lastUserInteractionAt DESC LIMIT N
  // (uses existing SQLite store)
}

// shared/messages.ts (NEW broadcast)
const RecentSessionsUpdateSchema = z.object({
  kind: z.literal("recent_sessions_update"),
  workspaceId: z.string(),
  sessions: z.array(SessionSummarySchema),
  computedAt: z.number(),
});
```

Push model: daemon broadcasts `recent_sessions_update` whenever `lastUserInteractionAt` changes (debounced to 500ms per workspace). Client caches in Zustand. Old clients ignore the new message kind.

### 7.4 Edge cases

- **Definition of "interaction":** sending a prompt, approving a permission, opening the agent's timeline view (via subscription start), starting a terminal in the agent. _Not_ counted: scrolling the agent list (too noisy).
- **Privacy:** the timestamp does not leave the daemon for non-paired clients; relay clients receive it because they're already cryptographically the user.
- **Schema-evolution compliance:** the new field is optional; the new message kind is silently ignored by old clients. ARCH-02 compliant.

---

## 8. Question 6 — Theme system architecture (THM-01)

### 8.1 Constraints

- Already on `react-native-unistyles` (per CLAUDE.md and in-flight commits).
- Must work on RN-iOS, RN-Android, RN-Web (via Expo Web), and Tauri-bundled web.
- Glass surfaces, math-curve loaders, daemon-connection-dot are already in flight.
- One source of truth across colors / surfaces / motion / typography.

### 8.2 Pattern — three-tier tokens

Industry consensus (Radix Themes, Tailwind, Vanilla Extract, design-system blog post([Contentful](https://www.contentful.com/blog/design-token-system/)), [W3C DTCG](https://designlang.vercel.app/) export targets):

| Tier          | Purpose                            | Example                                                     | Consumed by         |
| ------------- | ---------------------------------- | ----------------------------------------------------------- | ------------------- |
| **Primitive** | Raw values, no meaning             | `gray.100 = #F4F4F5`                                        | Only semantic tier  |
| **Semantic**  | Intent-named, references primitive | `surface.background = gray.100` (light) / `gray.900` (dark) | Components          |
| **Component** | Per-component overrides            | `button.primary.background = surface.brand`                 | That component only |

### 8.3 Architecture on top of Unistyles

`react-native-unistyles` ([v3 theming](https://www.unistyl.es/v3/guides/theming/)) treats themes as plain JS objects with no enforced shape — it's a styling primitive, not a token system. Tokens are our concern. The Unistyles theme object becomes the **delivery vehicle** for fully-resolved semantic tokens for the active theme.

```
packages/app/src/styles/
  tokens/
    primitives.ts          ← color scales, spacing scale, radius scale, motion curves
    semantic.light.ts       ← maps primitives → semantic names for light mode
    semantic.dark.ts        ← same for dark
    component.ts            ← component-level overrides (button, card, sheet, ...)
    motion.ts               ← curve definitions (linear, ease-out, math-curve)
    typography.ts           ← font stacks, sizes, weights, line heights
  theme.ts                  ← assembles tokens into UnistylesTheme + light/dark variants
  glass-surface.tsx         ← consumes semantic.surface.glass.* tokens
```

```ts
// primitives.ts — values only
export const palette = {
  gray: { 50: "#FAFAFA", 100: "#F4F4F5", /* ... */ 900: "#18181B" },
  brand: { 500: "#FF8A00" /* otter orange */ },
} as const;

// semantic.light.ts — meaning, references primitives
export const semanticLight = {
  surface: {
    background: palette.gray[50],
    card: palette.gray[100],
    glass: { tint: "rgba(255,255,255,0.6)", blur: 20 },
  },
  text: {
    primary: palette.gray[900],
    secondary: palette.gray[600],
  },
  // ...
} as const;

// theme.ts — wired to Unistyles
const lightTheme = { ...semanticLight, motion, typography };
const darkTheme = { ...semanticDark, motion, typography };
UnistylesRegistry.addThemes({ light: lightTheme, dark: darkTheme });
```

### 8.4 Why this beats Tamagui or Vanilla Extract for Ottie's situation

- **Tamagui:** strong design-system, but switching means rewriting every styled component. The milestone says "no big-bang." Tamagui is a future option, not a v1.11 option.
- **Vanilla Extract:** web-only build-time CSS — incompatible with RN runtime themes. Disqualified.
- **Plain Unistyles + tokens layer:** zero migration cost (already on Unistyles), token discipline added by structure not framework, still exportable to W3C DTCG JSON if ever needed.

### 8.5 Tauri / web parity

Tauri runs the Expo Web bundle. Unistyles for web emits CSS variables; semantic tokens become CSS custom properties (`--surface-background`). Glass surfaces use `backdrop-filter: blur(...)` on web/Tauri and a native blur view on RN-native — a `.web.tsx` / `.native.tsx` split for `glass-surface.tsx` (already partially in place per in-flight commits).

### 8.6 Motion curves

The existing `math-curve-loader` represents a brand-distinctive motion vocabulary. Formalize as semantic motion tokens:

```ts
export const motion = {
  curves: {
    standard: "cubic-bezier(0.4, 0, 0.2, 1)",
    enter: "cubic-bezier(0.0, 0, 0.2, 1)",
    exit: "cubic-bezier(0.4, 0, 1, 1)",
    otterBounce: /* the math-curve we already use */,
  },
  durations: { fast: 120, normal: 200, slow: 320 },
};
```

### 8.7 Phase ordering

- THM-01 lands **before** THM-02/03/04 because surface treatments and empty states consume tokens.
- THM-01 has no dependency on session.ts carve — can run in parallel with C-1 through C-9.

---

## 9. Question 7 — Local-daemon auth (ARCH-03)

### 9.1 Current state

Per [SECURITY.md](../../SECURITY.md): daemon binds `127.0.0.1`; trust is "anything on this machine that can reach the socket." Same model Docker uses (and documents). Host-header validation prevents DNS rebinding. CONCERNS H2 calls this an undocumented LAN-trust risk for shared / multi-user machines.

### 9.2 Industry survey

| System                                                                                                              | Approach                                                                                                                                | Applicable?                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Docker Engine (Unix socket)**                                                                                     | Membership in `docker` group; socket file mode 0660. Effectively "OS-controlled access list."                                           | YES — relevant pattern: file-system-mediated trust                             |
| **Tailscale `tailscaled`** ([LocalAPI socket](https://tailscale.com/docs/features/containers/docker/docker-params)) | Unix socket at `/var/run/tailscale/tailscaled.sock`; `tailscale whois` confirms peer identity from the kernel-recorded peer credentials | YES — peer-credentials pattern (SO_PEERCRED on Linux, getpeereid on BSD/macOS) |
| **Docker Desktop**                                                                                                  | Token-file in user-home with restrictive permissions                                                                                    | YES — bearer-token-from-file pattern, simplest cross-platform                  |
| **Stork / Kubelet**                                                                                                 | Mutual TLS or bearer token                                                                                                              | Overkill for same-machine                                                      |
| **kubectl / kube config**                                                                                           | Token in user-home file                                                                                                                 | YES — proven pattern                                                           |

### 9.3 The Ottie shape — TCP loopback, not Unix socket

Ottie binds **TCP** loopback (port 6868), not Unix socket. SO_PEERCRED is unavailable for TCP. So peer-process verification is off the table without an architectural change to use Unix domain sockets — out of scope for v1.11.

### 9.4 Recommended path (additive, no break)

**Three-mode auth, defaulting to today's behavior:**

| Mode                                | Trigger                                      | Behavior                                                                                                                                                                |
| ----------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Loopback-trust** (default)     | bind == 127.0.0.1, no token configured       | Today's behavior. SECURITY.md still applies. Documented as "for shared machines, set OTTIE_LOCAL_TOKEN."                                                                |
| **B. Token-file** (auto on desktop) | `$OTTIE_HOME/local-token` exists (mode 0600) | Daemon requires `Authorization: Bearer <token>` header on WS upgrade. Token auto-generated by Tauri shell on first launch. Desktop app and CLI read from the same file. |
| **C. Explicit token**               | env `OTTIE_LOCAL_TOKEN=xxx`                  | Daemon requires that exact token. For users binding 0.0.0.0 or running in containers.                                                                                   |

**Backward-compat:**

- Mobile app via direct WS to local daemon: undocumented edge case (people use relay for off-machine). If a token is required and the client doesn't send one, daemon responds with HTTP 401 + `WWW-Authenticate: Bearer` so clients can prompt for token entry. Old clients without prompt UI fall back to the relay path (which is the intended path for non-loopback).
- CLI: bumps to read `$OTTIE_HOME/local-token` automatically; no user-visible change for desktop-bundled flow.
- Same-machine browser tab: token comes via the desktop shell injecting it into the bundle's runtime config. Nothing changes for users.

**File semantics:**

- Token = 32 random bytes, base64url-encoded.
- File mode `0600`, owner-only readable.
- Generated lazily on daemon first start in Tauri context; left absent for raw `npm run dev` (Mode A) so existing developer flow is untouched.
- Rotation: deleting the file forces regeneration; users are advised to re-pair if they share a machine.

### 9.5 Why this satisfies ARCH-03 without breaking same-machine

- **Default behavior is unchanged** for `npm run dev` and existing direct-connect setups → no UX regression.
- **Desktop-bundled** flows (the path most users take) silently gain auth via the auto-generated token. Multi-user-machine attack surface narrows substantially.
- **Power users** who bind 0.0.0.0 can opt into Mode C with one env var.

### 9.6 Phase ordering

- ARCH-03 is **independent** of the carve and theme work. Can run in any phase.
- Should land before any non-loopback-bind feature is documented in the UX, so we don't ship a regression.

---

## 10. Data flow — how v1.11 changes message paths

### 10.1 Inbound (client → daemon)

```
Client message (WS frame)
    ↓
[Connection / TLS / Token check]   ← NEW: ARCH-03 token gate (if Mode B/C)
    ↓
[Zod parse + schema-version gate]  ← NEW: ARCH-02 shim layer
    ↓
[MessageRouter dispatch by kind]   ← NEW: extracted from session.ts
    ↓
┌──────────────┬──────────────┬─────────────┬──────────────┬──────────┐
│ AgentHandler │ TermHandler  │ VoiceHandler│ ChatHandler  │ ...      │
└──────┬───────┴───────┬──────┴──────┬──────┴──────┬───────┴──────────┘
       ↓               ↓             ↓             ↓
   AgentMgr        TerminalMgr    VoiceMgr      ChatService
       ↓               ↓             ↓             ↓
   Provider        node-pty       STT/TTS       SQLite
```

### 10.2 Outbound (daemon → client)

```
Service emits domain event (AgentManager.emit, etc.)
    ↓
Handler subscribes and translates → wire message
    ↓
[Schema-version filter]   ← NEW: drop fields old client can't parse
    ↓
[Connection.send]
    ↓
WS frame
```

### 10.3 New broadcast lanes

| Message kind                              | Direction     | Triggered by                | New in v1.11?          |
| ----------------------------------------- | ------------- | --------------------------- | ---------------------- |
| `agent_update` (with `clientNonce`)       | server→client | optimistic-create reconcile | Field added (AGT-04)   |
| `AgentCreateRejected`                     | server→client | daemon-side rejection       | NEW (AGT-04)           |
| `recent_sessions_update`                  | server→client | user interaction with agent | NEW (SES-01, SES-05)   |
| `theme_version_capability` (in handshake) | server→client | handshake                   | NEW (THM-01, optional) |

### 10.4 Cross-device flow (SES-05 example)

```
Phone:  user opens workspace W.
        → SubscribeWorkspaceMessage(W) → daemon
        → daemon updates lastUserInteractionAt for W
        → broadcasts recent_sessions_update to all connections
Desktop: receives recent_sessions_update
        → updates Zustand recent-store
        → sidebar reorders without re-fetch
```

The cross-device behavior **falls out of broadcast** — no new sync engine, no conflict resolution.

---

## 11. Phase-order implications (for ROADMAP.md)

```
Phase A — Foundations (architectural unblockers; mostly daemon)
  ├─ C-1, C-2: MessageRouter + Zod boundary
  ├─ ARCH-02: Schema-evolution discipline + RESERVED_FIELDS + lint
  ├─ ARCH-03: Local-token auth (Mode B/C) — desktop opt-in
  └─ THM-01 (parallel): three-tier theme tokens
Phase B — Carve continues + first user-visible payoff
  ├─ C-3 PermissionHandler         → unblocks AGT-05 work (permission UX)
  ├─ C-8 ProjectsHandler + recents → unblocks SES-01, SES-05
  ├─ C-5 FileExplorer + Chat
  └─ Action Registry skeleton      → unblocks NAV-A4
Phase C — Optimistic UX
  ├─ C-7 AgentSessionHandler       (final big carve)
  ├─ AGT-04 optimistic create      (depends on C-7 + ARCH-02)
  ├─ NAT-01 voice/keyboard parity  (depends on Action Registry)
  └─ NAV-A1..A5 sidebar/cmd-center (depends on Action Registry, recents)
Phase D — Polish + cleanup
  ├─ C-4 Terminal carve
  ├─ C-6 Voice carve
  ├─ C-9 session.ts deletion
  ├─ THM-02..04 surface audits
  ├─ Bug-fix bundle (CONCERNS C11/C12/H4/H13)
  └─ Documentation (SCHEMA_EVOLUTION.md, SECURITY.md update)
```

**Hard ordering rules:**

1. **C-1, C-2 must be first.** Everything later depends on them.
2. **ARCH-02 must precede AGT-04 and SES-05** because both add fields.
3. **C-7 must precede AGT-04** because the optimistic-create logic needs the handler seam.
4. **Action Registry must precede NAT-01 voice refactor** otherwise voice parity drifts again.
5. **THM-01 has no carve dependency** — schedule it parallel to A or B for steady visible progress.

---

## 12. Anti-patterns — explicit don'ts for v1.11

### 12.1 "Big-bang rewrite of session.ts"

**What people do:** open a feature branch, rewrite `session.ts` into 8 files in one PR.
**Why it's wrong:** review impossible, merge conflicts with 64 in-flight files guaranteed, regression risk concentrated.
**Do this instead:** Strangler-Fig steps C-1..C-9, each independently mergeable, each green.

### 12.2 "Add a sync engine for recents"

**What people do:** see "cross-device continuity" and reach for CRDTs / a Linear-grade sync engine.
**Why it's wrong:** Ottie already has a single source of truth (the daemon). Recents is a derived projection, not a syncable graph.
**Do this instead:** broadcast over existing WS (SES-05 falls out for free).

### 12.3 "Make voice a separate top-level surface"

**What people do:** define a separate voice command vocabulary + voice handler.
**Why it's wrong:** drifts from command-center, parity drops, NAT-01 fails.
**Do this instead:** voice is a dispatcher reading the **same Action Registry** as ⌘K.

### 12.4 "Delete deprecated fields after one release"

**What people do:** remove a field as soon as the new replacement ships.
**Why it's wrong:** 6-month-old clients break (CLAUDE.md violation).
**Do this instead:** `removeAfter=` with ≥6-minor-release horizon, then `RESERVED_FIELDS`.

### 12.5 "Block UI on agent creation round-trip"

**What people do:** spinner on the create button until daemon confirms.
**Why it's wrong:** AGT-04 demands optimistic ≤200ms feedback; relay round-trips can be much longer.
**Do this instead:** nonce-based optimistic UI with reconcile-or-fail-visibly.

### 12.6 "Ship a token-required local daemon for everyone"

**What people do:** require `OTTIE_LOCAL_TOKEN` for all connections, even loopback.
**Why it's wrong:** breaks `npm run dev` and existing same-machine flows; violates "no UX regression" for ARCH-03.
**Do this instead:** three-mode auth (default loopback-trust unchanged), token only for the bundled-desktop path that auto-generates it.

### 12.7 "Compute recents on the client only"

**What people do:** sort agent list by `lastUpdatedAt` from local timeline cache.
**Why it's wrong:** desktop and phone see different orderings; SES-05 fails.
**Do this instead:** daemon computes, broadcasts, clients render.

### 12.8 "Theme tokens as flat keys"

**What people do:** `theme.primary`, `theme.background`, `theme.error` — flat, no semantic distinction.
**Why it's wrong:** primitive and semantic concerns conflate; renaming a brand color requires editing every component.
**Do this instead:** primitive → semantic → component three-tier.

---

## 13. Risk callouts per architectural move

| Move                      | Top risk                                                                           | Mitigation                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Carve C-1..C-9            | Subtle behavior drift in shared `this` state during extraction                     | Each step gated by `OTTIE_USE_NEW_ROUTER`-style flag for one release; existing E2E tests must stay green                                       |
| ARCH-02 schema discipline | Lint catches existing fields without metadata, blocking unrelated PRs              | Land lint with `--warn-only` for one release, then enforce                                                                                     |
| Action Registry           | UI surfaces ship before all actions are migrated → some shortcuts work, some don't | Migrate in dependency order: command-center → keyboard → long-press → voice; each surface defaults to legacy handlers if action not registered |
| Optimistic agent create   | Pending records leak when daemon never echoes                                      | 60s TTL on pending records; visible "failed" state; resync from daemon's `fetchAgents` on reconnect                                            |
| Daemon-computed recents   | High-frequency interaction events flood the broadcast                              | 500ms debounce per workspace; coalesce updates                                                                                                 |
| Theme tier refactor       | Color references in components break during semantic-name migration                | Codemod for known existing token names; leave aliases for one release                                                                          |
| Local-token auth          | Tauri-bundled daemon reads token before file is written → race                     | Auto-generate token in Tauri startup _before_ spawning daemon subprocess; daemon reads on boot                                                 |

---

## 14. Sources

### Carve patterns

- [Microsoft LSP Specification 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) — request/response routing model
- [vscode-languageserver-node](https://github.com/microsoft/vscode-languageserver-node) — handler registry decoupled from execution
- [terraform-ls LSP implementation](https://deepwiki.com/hashicorp/terraform-ls/4-language-server-protocol-implementation) — `Assigner` method-name → handler mapping
- [Discord Gateway opcode dispatcher](https://docs.discord.com/developers/events/gateway) — opcode-based routing
- [Shopify on Strangler Fig](https://shopify.engineering/refactoring-legacy-code-strangler-fig-pattern) — incremental god-class refactor
- [Azure Strangler Fig pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig) — phased modernization
- HIGH confidence (multiple sources align)

### Schema evolution

- [Stripe API versioning](https://docs.stripe.com/api/versioning) — backward-compatible change rules
- [Stripe API upgrade policy](https://docs.stripe.com/upgrades) — what's safe vs breaking
- [Stripe API versioning blog](https://stripe.com/blog/api-versioning) — internal version-gating mechanism
- [Protocol Buffers Best Practices](https://protobuf.dev/best-practices/dos-donts/) — `reserved`, `[deprecated]`, never reuse field numbers
- [Protocol Buffers Editions Guide](https://protobuf.dev/programming-guides/editions/) — modern proto evolution rules
- HIGH confidence

### Cross-modal action surface

- [VS Code Commands API](https://code.visualstudio.com/api/extension-guides/command) — CommandRegistry, registerCommand
- [VS Code keybindingsRegistry source](https://github.com/Microsoft/vscode/blob/main/src/vs/platform/keybinding/common/keybindingsRegistry.ts) — key→commandId mapping
- [VS Code Command Palette UX](https://code.visualstudio.com/api/ux-guidelines/command-palette) — palette as one of many invocation surfaces
- [Raycast extension architecture](https://www.raycast.com/blog/how-raycast-api-extensions-work) — manifest-driven command registration
- [Raycast Command API](https://developers.raycast.com/api-reference/command) — command metadata schema
- [Arc Command Bar](https://start.arc.net/command-bar-actions) — unified action surface example
- HIGH confidence

### Optimistic UI

- [Discord nonce optimistic-send pattern](https://github.com/discord/discord-api-docs/discussions/3396) — nonce-based reconciliation
- [Discord Message API nonce field](https://discord.js.org/docs/packages/discord.js/main/Message:Class) — implementation reference
- [Linear sync engine architecture](https://www.fujimon.com/blog/linear-sync-engine) — local store + reconciliation pattern
- [Convex object sync engine writeup](https://stack.convex.dev/object-sync-engine) — server-canonical pattern
- [React 19 useOptimistic deep-dive](https://dev.to/a1guy/react-19-useoptimistic-deep-dive-building-instant-resilient-and-user-friendly-uis-49fp) — current React idiom
- [Optimistic UI with rollback guide](https://www.codingeasypeasy.com/blog/optimistic-ui-updates-with-rollback-a-comprehensive-guide-with-code-examples) — rollback strategies
- HIGH confidence

### Recents / sidebar ordering

- [Slack sort-by-recent-activity](https://www.quora.com/How-do-I-sort-channels-in-Slack-according-to-the-latest-message-received) — server-side ordering option
- [Linear inbox sync engine](https://www.fujimon.com/blog/linear-sync-engine) — server-canonical ordering
- MEDIUM confidence (specific algorithms not public)

### Theme system

- [react-native-unistyles theming](https://www.unistyl.es/v3/guides/theming/) — no enforced token shape
- [react-native-unistyles 3.0 announcement](https://reactnativecrossroads.com/posts/unistyles-3-preview/) — single-source-of-truth provider
- [Contentful design tokens guide](https://www.contentful.com/blog/design-token-system/) — primitive/semantic/component three-tier
- [W3C DTCG-aligned tooling (designlang)](https://designlang.vercel.app/) — DTCG export shape
- [Radix Themes styling](https://www.radix-ui.com/themes/docs/overview/styling) — token + component composition
- [Tamagui design system](https://tamagui.dev/) — alternative considered and rejected for v1.11
- HIGH confidence on three-tier; MEDIUM on Unistyles 3.0 specifics (rapidly evolving lib)

### Local-daemon auth

- [SECURITY.md (this repo)](../../SECURITY.md) — current trust model documented
- [Tailscale Docker socket / LocalAPI](https://tailscale.com/docs/features/containers/docker/docker-params) — peer credentials via tailscaled socket
- [Docker socket security model](https://docs.docker.com/reference/cli/docker/login/) — file-mode-mediated trust (analogous)
- HIGH confidence

---

_Architecture research for: Ottie v1.11 — User Flow Polish_
_Researched: 2026-04-29_
