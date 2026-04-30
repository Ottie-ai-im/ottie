# Architecture

_Last updated: 2026-04-29_

## Summary

Ottie is a local-first client-server system for monitoring and controlling AI coding agents from mobile, desktop, and CLI clients. A Node.js daemon runs on the developer's machine, owns all agent lifecycle, and exposes a binary-multiplexed WebSocket API. Clients never touch agent processes directly — all interaction goes through the daemon. Remote access is available via an optional E2E-encrypted relay that routes opaque bytes without reading them.

---

## System Overview

```
┌────────────────┐   ┌─────────────┐   ┌──────────────────┐
│  Mobile App    │   │     CLI     │   │  Desktop App     │
│  (Expo RN)     │   │ (Commander) │   │  (Tauri v2)      │
│  iOS/Android/  │   │             │   │  macOS/Win/Linux  │
│  web browser   │   │             │   │                  │
└───────┬────────┘   └──────┬──────┘   └────────┬─────────┘
        │  WebSocket         │  WebSocket         │  Managed subprocess
        │  (direct or        │  (direct)          │  + WebSocket
        │   via relay)       │                    │
        └────────────┬───────┴────────────────────┘
                     │
              ┌──────▼──────┐
              │   Daemon    │  Node.js — packages/server
              │  :6767      │  (HTTP + WebSocket + MCP)
              └──────┬──────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
  ┌─────▼─────┐ ┌───▼────┐ ┌────▼──────┐
  │  Claude   │ │ Codex  │ │ OpenCode  │
  │ Agent SDK │ │ Server │ │   CLI     │
  └───────────┘ └────────┘ └───────────┘
```

When the daemon is behind a firewall, the relay bridges clients and daemon through E2E-encrypted channels:

```
Client ──► relay.ottie.app ──► Daemon
         (encrypted bytes only — relay is zero-knowledge)
```

---

## Package Layering

Dependency direction: `app`/`cli`/`desktop` → `server/client` → `relay` → (external)

| Package                       | Depends On                                                                                             | Exposes                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `packages/server`             | `packages/relay`, `packages/highlight`                                                                 | Daemon process, daemon client library                           |
| `packages/app`                | `packages/server` (client only), `packages/relay`, `packages/highlight`, `packages/expo-two-way-audio` | Expo RN app                                                     |
| `packages/cli`                | `packages/server` (client only)                                                                        | `ottie` CLI binary                                              |
| `packages/desktop`            | `packages/app` (as web bundle), `packages/server` (bundled daemon)                                     | Tauri desktop shell                                             |
| `packages/relay`              | none                                                                                                   | `createClientChannel`, `createDaemonChannel`, crypto primitives |
| `packages/highlight`          | none                                                                                                   | Code syntax highlighter                                         |
| `packages/expo-two-way-audio` | none                                                                                                   | Native two-way audio Expo module                                |

The daemon client library lives at `packages/server/src/client/daemon-client.ts` and is imported by both `packages/app` and `packages/cli`.

---

## WebSocket Protocol

All clients speak the same binary-multiplexed WebSocket protocol. Schemas are defined in `packages/server/src/shared/messages.ts` (Zod) and consumed by both server and clients.

### Handshake

```
Client → Server:  WSHelloMessage   { id, clientId, version, timestamp }
Server → Client:  WSWelcomeMessage { clientId, daemonVersion, sessionId, capabilities }
```

### Message Categories

| Category                   | Direction       | Purpose                                      |
| -------------------------- | --------------- | -------------------------------------------- |
| `agent_update`             | server → client | Agent state changed (status, title, labels)  |
| `agent_stream`             | server → client | New timeline event from a running agent      |
| `workspace_update`         | server → client | Workspace state changed                      |
| `agent_permission_request` | server → client | Agent awaiting user approval for a tool call |
| Command/response pairs     | bidirectional   | Fetch, list, create, stop, send, etc.        |

### Binary Multiplexing (`BinaryMuxFrame`)

Terminal I/O and control messages share one WebSocket connection:

- 1-byte channel ID + 1-byte flags + variable payload
- Channel 0: control messages (JSON)
- Channel 1: terminal data (raw PTY bytes)

### Schema Compatibility Rule

All schema changes must be backward-compatible. Old mobile clients will talk to new daemons:

- New fields must be `.optional()` with a sensible default or `.transform()` fallback
- Never change optional → required, never remove fields, never narrow types

---

## Agent Lifecycle

```
initializing → idle → running → idle
                 ↑        │
                 └────────┘  (completes turn, awaits next prompt)
                     │
                     ▼
                   error → closed
```

- `AgentManager` (`packages/server/src/server/agent/agent-manager.ts`) owns the state machine and timeline
- Timeline is append-only; each new run starts a new **epoch**; up to 200 items tracked in memory
- Agent state persists to `$OTTIE_HOME/agents/{cwd-with-dashes}/{agent-id}.json` via `agent-storage.ts`
- Tool calls are normalized to `ToolCallDetail` types (shell, read, edit, write, search, etc.)

### Creating and Running an Agent

1. Client sends `CreateAgentRequestMessage` (prompt, cwd, provider, model, mode)
2. `session.ts` routes to `AgentManager.create()`
3. `AgentManager` constructs a `ManagedAgent` and calls the appropriate provider adapter
4. Provider spawns its subprocess (Claude SDK / Codex server / OpenCode CLI)
5. Provider emits `AgentStreamEvent` items → appended to timeline → broadcast to all subscribed clients
6. Permission requests flow: agent → `mcp-server.ts` → websocket → client → user → websocket → agent

---

## Agent Providers

Each provider is an adapter under `packages/server/src/server/agent/providers/`:

| Provider   | Implementation File                         | Wraps               | Session Storage                                    |
| ---------- | ------------------------------------------- | ------------------- | -------------------------------------------------- |
| Claude     | `providers/claude/claude-agent.ts`          | Anthropic Agent SDK | `~/.claude/projects/{cwd}/{session-id}.jsonl`      |
| Codex      | `providers/codex/codex-app-server-agent.ts` | CodexAppServer      | `~/.codex/sessions/{date}/rollout-{ts}-{id}.jsonl` |
| OpenCode   | `providers/opencode/opencode-agent.ts`      | OpenCode CLI        | Provider-managed                                   |
| ACP agents | `providers/generic-acp-agent.ts`            | ACP protocol        | Varies                                             |

All providers:

- Handle their own auth (Ottie does not manage API keys)
- Support session resume via persistence handles
- Expose provider-specific modes (plan, default, full-access)
- Map tool calls to the normalized `ToolCallDetail` type

Provider registry: `packages/server/src/server/agent/provider-registry.ts`
Provider manifest (available providers list): `packages/server/src/server/agent/provider-manifest.ts`

---

## Data Flow: Running an Agent

```
Client                   Daemon (session.ts)       AgentManager        Provider
  │                             │                       │                   │
  │── CreateAgentRequest ──────►│                       │                   │
  │                             │── create() ──────────►│                   │
  │                             │                       │── spawn() ────────►│
  │                             │                       │                   │ (runs)
  │                             │                       │◄── AgentStreamEvent│
  │                             │                       │── appendTimeline() │
  │◄── agent_stream ────────────│◄── broadcast ─────────│                   │
  │                             │                       │                   │
  │   [tool call needs approval]│                       │                   │
  │◄── agent_permission_request │◄── mcp-server.ts ─────│◄── MCP request ───│
  │── PermitDecisionMessage ───►│── resume agent ──────────────────────────►│
```

Permission requests go through MCP: `packages/server/src/server/agent/mcp-server.ts`

---

## Relay Architecture

`packages/relay/` is a standalone package with no app-level dependencies:

- ECDH key exchange + AES-256-GCM encryption (`src/crypto.ts`)
- `createClientChannel()` — client side of encrypted tunnel
- `createDaemonChannel()` — daemon side of encrypted tunnel
- Cloudflare Workers host the relay server (`src/cloudflare-adapter.ts`)
- Pairing via QR code transfers the daemon public key to the client
- Relay server sees only opaque encrypted bytes

Daemon connects outbound to relay: `packages/server/src/server/relay-transport.ts`
App connects to relay via: `packages/server/src/client/daemon-client-relay-e2ee-transport.ts`

---

## Session Layer (App)

`packages/app/src/contexts/session-context.tsx` wraps the daemon client for the active connection:

- `DaemonRegistryContext` — list of saved daemon connections
- `SessionContext` — active daemon connection state and subscriptions
- `Stream` model (`packages/app/src/types/stream.ts`) — client-side timeline with compaction, gap detection, sequence-based deduplication
- Timeline cache: `packages/app/src/stores/timeline-cache-store.ts` (platform-split: `.web.ts` / `.native.ts`)
- React Query is used for server state; Zustand stores for UI state

---

## Desktop Shell

`packages/desktop/` is a Tauri v2 shell (Rust core: `src-tauri/src/`):

- `daemon.rs` — spawns and manages the daemon subprocess
- `bridge.rs` — IPC bridge between web frontend and Rust backend
- Serves the Expo web build as its frontend
- Desktop-specific features (file dialogs, titlebar drag) accessed via `getIsElectron()` in `packages/app/src/constants/platform.ts`
- Desktop-specific app code under `packages/app/src/desktop/`

---

## MCP Server

The daemon exposes an MCP server for agent-to-agent control:

- `packages/server/src/server/agent/mcp-server.ts`
- Allows agents to create sub-agents, check permissions, set timeouts
- Injected into agents when `mcp.injectIntoAgents` config is enabled

---

## Additional Server Services

| Service            | Location                                                                               | Purpose                                          |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Chat               | `packages/server/src/server/chat/`                                                     | Persistent chat rooms between clients and agents |
| Loop               | `packages/server/src/server/loop/`                                                     | Scheduled agent loop execution                   |
| Schedule           | `packages/server/src/server/schedule/`                                                 | Cron-based agent scheduling                      |
| Speech / STT / TTS | `packages/server/src/server/speech/`, `server/stt-manager.ts`, `server/tts-manager.ts` | Voice I/O pipeline                               |
| Dictation          | `packages/server/src/server/dictation/`                                                | Streaming speech-to-text for input               |
| Voice              | `packages/server/src/server/voice/`                                                    | Realtime voice agent routing                     |
| Push               | `packages/server/src/server/push/`                                                     | Mobile push notification tokens                  |
| File explorer      | `packages/server/src/server/file-explorer/`                                            | Browse workspace filesystem                      |
| File download      | `packages/server/src/server/file-download/`                                            | Serve files to clients                           |
| Workspace registry | `packages/server/src/server/workspace-registry.ts`                                     | Track open workspaces                            |
| Terminal           | `packages/server/src/terminal/`                                                        | PTY management for interactive terminals         |
| Tasks              | `packages/server/src/tasks/`                                                           | Background task execution and store              |

---

## Storage Layout

```
$OTTIE_HOME/
├── agents/{cwd-with-dashes}/{agent-id}.json   # Agent state + config
├── projects/projects.json                      # Project registry
├── projects/workspaces.json                    # Workspace registry
└── daemon.log                                  # Daemon trace logs
```

SQLite is used for durable agent timeline storage: `packages/server/src/server/agent/sqlite-agent-timeline-store.ts`

---

## Error Handling

- Zod schemas validate all WebSocket messages at ingress (`packages/server/src/shared/messages.ts`)
- Providers emit structured error events into the timeline rather than crashing the daemon
- Agent errors transition state machine to `error` then `closed`
- `pid-lock.ts` prevents multiple daemon instances on the same port

---

## Key Design Decisions

- **Local-first**: Agent processes run on the developer's machine; no code is sent to Ottie's servers
- **Single WebSocket connection per client**: Binary multiplexing avoids per-feature connections
- **Append-only timeline with epochs**: Safe concurrent reads, no locking needed
- **Providers handle their own auth**: Ottie is auth-agnostic; keys stay in provider config files
- **Schema backward-compatibility**: Old clients must always parse new daemon messages
- **Relay is zero-knowledge**: The relay routes encrypted blobs and cannot read content
