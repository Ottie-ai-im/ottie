# CLAUDE.md

Ottie is a mobile app for monitoring and controlling your local AI coding agents from anywhere. Your dev environment, in your pocket. Connects directly to your actual development environment — your code stays on your machine.

**Supported agents:** Claude Code, Codex, and OpenCode.

## Repository map

This is an npm workspace monorepo:

- `packages/server` — Daemon: agent lifecycle, WebSocket API, MCP server
- `packages/app` — Mobile + web client (Expo)
- `packages/cli` — Docker-style CLI (`ottie run/ls/logs/wait`)
- `packages/relay` — E2E encrypted relay for remote access
- `packages/desktop` — Tauri v2 desktop shell
- `packages/website` — Marketing site (ottie.app)

## Documentation

| Doc                                                  | What's in it                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)         | System design, package layering, WebSocket protocol, agent lifecycle, data flow   |
| [docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md) | Type hygiene, error handling, state design, React patterns, file organization     |
| [docs/TESTING.md](docs/TESTING.md)                   | TDD workflow, determinism, real dependencies over mocks, test organization        |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)           | Dev server, build sync gotchas, CLI reference, agent state, Playwright MCP        |
| [docs/RELEASE.md](docs/RELEASE.md)                   | Release playbook, draft releases, completion checklist                            |
| [docs/CUSTOM-PROVIDERS.md](docs/CUSTOM-PROVIDERS.md) | Custom provider config: Z.AI, Alibaba/Qwen, ACP agents, profiles, custom binaries |
| [docs/ANDROID.md](docs/ANDROID.md)                   | App variants, local/cloud builds, EAS workflows                                   |
| [docs/DESIGN.md](docs/DESIGN.md)                     | How to design features before implementation                                      |
| [SECURITY.md](SECURITY.md)                           | Relay threat model, E2E encryption, DNS rebinding, agent auth                     |

## Quick start

```bash
npm run dev                          # Start daemon + Expo in Tmux
npm run cli -- ls -a -g              # List all agents
npm run cli -- daemon status         # Check daemon status
npm run typecheck                    # Always run after changes
npm run lint                         # Always run after changes
npm run format                       # Auto-format with Biome
npm run format:check                 # Check formatting without writing
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for full setup, build sync requirements, and debugging.

## Critical rules

- **NEVER restart the main Ottie daemon on port 6868 without permission** — it manages all running agents. If you're an agent, restarting it kills your own process.
- **NEVER assume a timeout means the service needs restarting** — timeouts can be transient.
- **NEVER add auth checks to tests** — agent providers handle their own auth.
- **NEVER run the full test suite locally.** The test suites are heavy and will freeze the machine, especially if multiple agents run them in parallel. Rules:
  - Run only the specific test file you changed: `npx vitest run <file> --bail=1`
  - Never run `npm run test` for an entire workspace unless explicitly asked.
  - If you must run a broad suite, pipe output to a file and read it afterward: `npx vitest run <file> --bail=1 > /tmp/test-output.txt 2>&1` then read the file.
  - Never re-run a test suite that another agent already ran and reported green — trust the result.
  - For full suite verification, push to CI and check GitHub Actions instead.
- **Always run typecheck and lint after every change.**
- **Run `npm run format` before committing.** This repo uses Biome for formatting. Do not manually fix formatting — let the formatter handle it.
- **Always use npm scripts for linting and formatting.** Do not run tools directly with `npx eslint`, `npx oxfmt`, `npx oxlint`, or package-local binaries. For targeted checks, pass file paths through the npm script:
  - `npm run lint -- packages/app/src/components/message.tsx`
  - `npm run format:files -- CLAUDE.md packages/app/src/components/message.tsx`
- **NEVER make breaking changes to WebSocket or message schemas.** The primary compatibility path is old mobile app clients talking to newly updated daemons. Users update desktop and daemon first, then keep running the old app for a while. Every schema change MUST be backward-compatible for old clients against new daemons:
  - New fields: always `.optional()` with a sensible default or `.transform()` fallback.
  - Never change a field from optional to required.
  - Never remove a field — deprecate it (keep accepting it, stop sending it).
  - Never narrow a field's type (e.g. `string` → `enum`, `nullable` → non-null).
  - Test with: "does a 6-month-old client still parse this?" and "does a 6-month-old daemon still send something this client accepts?"

## Platform gating

The app runs on iOS, Android, web (browser), and web (Tauri desktop). Code is cross-platform by default. Gate only when you must. Import gates from `@/constants/platform`.

### The four gates

| Gate                       | Type      | When to use                                                                                                                 |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `isWeb`                    | constant  | DOM APIs — `document`, `window`, `<div>`, `addEventListener`, `ResizeObserver`. This is the **exception**, not the default. |
| `isNative`                 | constant  | Native-only APIs — Haptics, `StatusBar.currentHeight`, push tokens, camera/scanner, `expo-av`.                              |
| `getIsElectron()`          | cached fn | Desktop wrapper features — file dialogs, titlebar drag region, daemon management, app updates, dock badges.                 |
| `useIsCompactFormFactor()` | hook      | Layout decisions — sidebar overlay vs pinned, modal vs full screen, single-panel vs split. From `@/constants/layout`.       |

### Decision matrix

| I need to...                                                   | Use                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Access DOM (`document`, `window`, `<div>`, `addEventListener`) | `if (isWeb)`                                                              |
| Use a native-only API (Haptics, push tokens, camera)           | `if (isNative)`                                                           |
| Use an Electron bridge (file dialog, titlebar, updates)        | `if (getIsElectron())`                                                    |
| Switch layout between phone and tablet/desktop                 | `useIsCompactFormFactor()`                                                |
| Show something on hover, always-visible on native              | `isHovered \|\| isNative \|\| isCompact` (hover only works on web)        |
| Gate to iOS or Android specifically                            | `Platform.OS === "ios"` / `Platform.OS === "android"` (rare, keep inline) |

### Rules

- **Default is cross-platform.** Don't gate unless you have a specific reason.
- **Prefer Metro file extensions over `if` statements.** When a module has fundamentally different implementations per platform, use `.web.ts` / `.native.ts` file extensions instead of runtime `if (isWeb)` branches. Metro resolves the correct file at build time — the unused platform code is never bundled. Reserve `if (isWeb)` for small, inline checks (a single line or a few props). If you find yourself writing a large `if (isWeb) { ... } else { ... }` block, split into separate files instead.
  ```
  hooks/
    use-audio-recorder.web.ts    ← uses Web Audio API
    use-audio-recorder.native.ts ← uses expo-audio
  ```
  Import as `@/hooks/use-audio-recorder` — Metro picks the right file automatically.
- **NEVER use raw DOM APIs without `isWeb` guard.** DOM APIs crash native. Casting a RN ref to `HTMLElement` is a red flag — ensure the block is web-only.
- **NEVER use `onPointerEnter`/`onPointerLeave`.** They don't fire on native iOS.
- **Hover only works on web.** React Native's `onHoverIn`/`onHoverOut` on `Pressable` does NOT fire on native iOS/iPad — the underlying W3C pointer events are behind disabled experimental flags. For hover-to-show UI (kebab menus, action buttons), use `isHovered || isNative || isCompact` so the controls are always visible on native and hover-to-show on web.
- **Don't use Platform.OS as a proxy for layout capabilities.** Use breakpoints for layout decisions, not platform checks.
- **Import `isWeb`/`isNative` from `@/constants/platform`.** Never write `const isWeb = Platform.OS === "web"` locally.

## Debugging

Find the complete daemon logs and traces in the $OTTIE_HOME/daemon.log

## Project

**Ottie**

Ottie is a local-first system for monitoring and controlling AI coding agents from anywhere — your dev environment, in your pocket. A daemon runs on the developer's machine, owns the lifecycle of every agent (Claude Code, Codex, OpenCode, ACP), and exposes a single binary-multiplexed WebSocket API consumed by mobile, web, desktop (Tauri), and CLI clients. Remote access goes through an E2E-encrypted, zero-knowledge relay on Cloudflare Workers; agent code and credentials never leave the developer's machine.

The product is for working developers who want to keep agents running while away from the keyboard — review tool calls, approve permissions, send follow-up prompts, hand off work to another agent — without ever uploading their codebase to a third party.

**Core Value:** **Controlling your local AI agents from your phone feels as immediate, trustworthy, and native as using the editor on your desktop — and stays out of the way the moment you don't need it.**

If everything else fails, this single property must hold: the developer trusts that the agent is doing what they think it's doing, and acting on it takes one or two taps, not five.

### Constraints

- **Tech stack** — TypeScript / Expo (React Native + Web) / Tauri v2 / Node.js daemon — _fixed for the milestone; no platform changes_
- **Compatibility** — old mobile clients must keep working against new daemons; every WS / config schema change must be backward-compatible per CLAUDE.md
- **Performance** — timeline must stay interactive past 1,000 events; touch responses ≤100ms; agent-creation feedback ≤200ms perceived latency
- **Privacy** — local-first invariant: agent code, credentials, and chat content never leave the developer's machine in plaintext. Relay stays zero-knowledge.
- **Security baseline** — local daemon auth (CORE-01) must not regress; ARCH-03 raises the floor without breaking same-machine flow
- **Build / test discipline** (per CLAUDE.md) — never restart the main daemon on :6868 without permission; never run the full test suite locally; always `npm run typecheck && npm run lint && npm run format` after every change
- **Cross-platform default** — code is cross-platform unless gated; gates come from `@/constants/platform`, never written locally
- **Bilingual** — every user-visible string change must update both `en.json` and `zh.json`

## Technology Stack

## Summary

## Languages & Runtime Versions

- **TypeScript** `^5.9.3` — all packages
- **Node.js** `≥20` — daemon, CLI, relay (esbuild targets `node20`)
- **tsgo** (`@typescript/native-preview 7.0.0-dev`) — used for app typecheck (`tsgo --noEmit`) for speed

## Package Manager

- **pnpm** `9.12.0` with workspace protocol
- Workspace packages: `@ottie/app`, `@ottie/server`, `@ottie/cli`, `@ottie/relay`, `@ottie/desktop`, `@ottie/highlight`, `@ottie/expo-two-way-audio`
- pnpm overrides: `lightningcss@1.30.1`, `react@19.1.4`, `react-dom@19.1.4`

## App (packages/app)

- **Expo** `^54.0.18` with Expo Router `~6.0.13` (file-based routing)
- **React** `19.1.4` / **React Native** (pinned via pnpm override)
- **TanStack Query** `^5.90.11` — server state / data fetching
- **TanStack Virtual** `^3.13.21` — virtualised lists
- **Zustand** — local UI state (confirmed by store files in codebase)
- **xterm.js** `^6.0.0` (`@xterm/xterm`) with addons: webgl, fit, search, image, clipboard, ligatures, web-links, unicode11
- **@gorhom/bottom-sheet** `^5.2.6` — adaptive modal sheets
- **@floating-ui/react-native** `^0.10.7` — tooltips / popovers
- **dnd-kit** — drag-and-drop (agent list reordering)
- **expo-sqlite** `^16.0.10` — local persistence
- **i18n-js** — internationalisation (en + zh locales)
- Web deploy: Cloudflare Pages via `wrangler`

## Daemon (packages/server)

- **better-sqlite3** `^11.10.0` — timeline / session storage
- **express** `^4.18.2` — HTTP API
- **ws** `^8.14.2` — WebSocket server
- **zod** `^3.23.8` + `zod-to-json-schema` — schema validation
- **pino** `^10.2.0` — structured logging
- **node-pty** `1.2.0-beta.11` — terminal PTY for agent process I/O
- **@xterm/headless** `^6.0.0` — terminal state tracking
- **Vercel AI SDK** (`ai`) `5.0.78` — LLM streaming abstraction
- **onnxruntime-node** `^1.23.0` — ONNX inference runtime
- **sherpa-onnx** / **sherpa-onnx-node** `1.12.28` — local STT/TTS (Silero VAD bundled)
- **@sctg/sentencepiece-js** — tokenization
- **uuid**, **p-limit**, **p-memoize**, **fast-deep-equal** — utilities
- **dotenv** — env config

## Relay (packages/relay)

- TypeScript library with Cloudflare Workers adapter
- **ws** WebSocket bridge
- E2E encryption primitives (Web Crypto API compatible)

## Desktop (packages/desktop)

- **Tauri v2** (`@tauri-apps/cli ^2`) — native shell wrapping the Expo web build
- Rust-based; communicates with daemon via IPC bridge

## CLI (packages/cli)

- Node.js CLI (`tsx` for dev, compiled to JS for distribution)
- Docker-style commands: `run`, `ls`, `logs`, `wait`, `daemon`

## Build Toolchain

| Tool          | Purpose                                             |
| ------------- | --------------------------------------------------- |
| `tsc`         | Library/daemon compilation (`tsconfig.server.json`) |
| `esbuild`     | Daemon bundle (single ESM file for distribution)    |
| `expo export` | Web app export                                      |
| `tauri build` | Desktop binary                                      |
| `tsx`         | Dev-time TS execution for scripts/CLI               |

## Linting & Formatting

- **oxlint** `1.61.0` — fast Rust linter (replaces ESLint)
- **oxfmt** `0.46.0` — formatter (wraps Biome)
- **lefthook** `^2.1.6` — git hooks runner
- **knip** `^5.82.1` — dead code detection

## Testing

- **Vitest** — unit + integration tests (server, app)
- **Playwright** `^1.56.1` — E2E browser tests (app)

## Conventions

## Summary

## TypeScript Type Hygiene

## State Design

- **Zustand** for global client-side stores (`packages/app/src/stores/`)
- **React contexts** for session/stream lifecycle and sidebar state (`packages/app/src/contexts/`)
- **TanStack React Query** for server data fetching (inlined via Vitest server deps)
- Never mirror a source of truth into local state — always derive from it.

## Error Handling

## React Patterns

## Platform Gating

| Gate                       | Type      | When to use                                                                                    |
| -------------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `isWeb`                    | constant  | DOM APIs — `document`, `window`, `<div>`, `addEventListener`, `ResizeObserver`                 |
| `isNative`                 | constant  | Native-only APIs — Haptics, `StatusBar.currentHeight`, push tokens, camera, `expo-av`          |
| `getIsElectron()`          | cached fn | Desktop wrapper features — file dialogs, titlebar drag, daemon management, app updates         |
| `useIsCompactFormFactor()` | hook      | Layout decisions — sidebar overlay vs pinned, modal vs full screen (from `@/constants/layout`) |

## File Organization

- Organize by domain first (`providers/claude/`), not by technical type (`tool-parsers/`)
- Name files after the main export: `create-tool-call.ts` (kebab-case)
- No `index.ts` barrel files that only re-export — they create unnecessary indirection
- Use `index.ts` as a real entry point only
- Collocate tests with implementation: `thing.ts` + `thing.test.ts`
- Platform-variant files: `timeline-cache-store.ts` / `timeline-cache-store.web.ts` / `timeline-cache-store.native.ts`

## Import Path Conventions

- App package: `@/` alias maps to `packages/app/src/`
- Server package: `@server/` alias maps to `packages/server/src/`
- Relay package: `@ottie/relay` and `@ottie/relay/e2ee` are workspace package imports
- Never use `../../../` relative paths when an alias is available

## Naming Conventions

- **Files:** `kebab-case.ts` named after the main export
- **Types/Interfaces:** PascalCase (`EnqueueJobInput`, `FetchState`)
- **Functions:** camelCase, `function` declarations preferred
- **Stores:** `use-X-store.ts`, exported as `useXStore`
- **Hooks:** `use-X.ts`, exported as `useX`
- **Constants:** camelCase for runtime values, SCREAMING_SNAKE for compile-time constants (rare)
- **Test files:** `thing.test.ts` or `thing.spec.ts` (Playwright e2e only)

## Formatting and Linting

- `indentStyle: "space"`, `indentWidth: 2`
- `lineWidth: 100`
- `quoteStyle: "double"`
- `trailingCommas: "all"`
- `semicolons: "always"`

## WebSocket / Message Schema Rules

- New fields: always `.optional()` with a sensible default or `.transform()` fallback
- Never change a field from optional to required
- Never remove a field — deprecate it (keep accepting it, stop sending it)
- Never narrow a field's type (e.g. `string` → `enum`, `nullable` → non-null)

## Logic Density

## Centralize Policy

## Architecture

## Summary

## System Overview

```

```

```

```

## Package Layering

| Package                       | Depends On                                                                                             | Exposes                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `packages/server`             | `packages/relay`, `packages/highlight`                                                                 | Daemon process, daemon client library                           |
| `packages/app`                | `packages/server` (client only), `packages/relay`, `packages/highlight`, `packages/expo-two-way-audio` | Expo RN app                                                     |
| `packages/cli`                | `packages/server` (client only)                                                                        | `ottie` CLI binary                                              |
| `packages/desktop`            | `packages/app` (as web bundle), `packages/server` (bundled daemon)                                     | Tauri desktop shell                                             |
| `packages/relay`              | none                                                                                                   | `createClientChannel`, `createDaemonChannel`, crypto primitives |
| `packages/highlight`          | none                                                                                                   | Code syntax highlighter                                         |
| `packages/expo-two-way-audio` | none                                                                                                   | Native two-way audio Expo module                                |

## WebSocket Protocol

### Handshake

```

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

- 1-byte channel ID + 1-byte flags + variable payload
- Channel 0: control messages (JSON)
- Channel 1: terminal data (raw PTY bytes)

### Schema Compatibility Rule

- New fields must be `.optional()` with a sensible default or `.transform()` fallback
- Never change optional → required, never remove fields, never narrow types

## Agent Lifecycle

```

```

- `AgentManager` (`packages/server/src/server/agent/agent-manager.ts`) owns the state machine and timeline
- Timeline is append-only; each new run starts a new **epoch**; up to 200 items tracked in memory
- Agent state persists to `$OTTIE_HOME/agents/{cwd-with-dashes}/{agent-id}.json` via `agent-storage.ts`
- Tool calls are normalized to `ToolCallDetail` types (shell, read, edit, write, search, etc.)

### Creating and Running an Agent

## Agent Providers

| Provider   | Implementation File                         | Wraps               | Session Storage                                    |
| ---------- | ------------------------------------------- | ------------------- | -------------------------------------------------- |
| Claude     | `providers/claude/claude-agent.ts`          | Anthropic Agent SDK | `~/.claude/projects/{cwd}/{session-id}.jsonl`      |
| Codex      | `providers/codex/codex-app-server-agent.ts` | CodexAppServer      | `~/.codex/sessions/{date}/rollout-{ts}-{id}.jsonl` |
| OpenCode   | `providers/opencode/opencode-agent.ts`      | OpenCode CLI        | Provider-managed                                   |
| ACP agents | `providers/generic-acp-agent.ts`            | ACP protocol        | Varies                                             |

- Handle their own auth (Ottie does not manage API keys)
- Support session resume via persistence handles
- Expose provider-specific modes (plan, default, full-access)
- Map tool calls to the normalized `ToolCallDetail` type

## Data Flow: Running an Agent

```

```

## Relay Architecture

- ECDH key exchange + AES-256-GCM encryption (`src/crypto.ts`)
- `createClientChannel()` — client side of encrypted tunnel
- `createDaemonChannel()` — daemon side of encrypted tunnel
- Cloudflare Workers host the relay server (`src/cloudflare-adapter.ts`)
- Pairing via QR code transfers the daemon public key to the client
- Relay server sees only opaque encrypted bytes

## Session Layer (App)

- `DaemonRegistryContext` — list of saved daemon connections
- `SessionContext` — active daemon connection state and subscriptions
- `Stream` model (`packages/app/src/types/stream.ts`) — client-side timeline with compaction, gap detection, sequence-based deduplication
- Timeline cache: `packages/app/src/stores/timeline-cache-store.ts` (platform-split: `.web.ts` / `.native.ts`)
- React Query is used for server state; Zustand stores for UI state

## Desktop Shell

- `daemon.rs` — spawns and manages the daemon subprocess
- `bridge.rs` — IPC bridge between web frontend and Rust backend
- Serves the Expo web build as its frontend
- Desktop-specific features (file dialogs, titlebar drag) accessed via `getIsElectron()` in `packages/app/src/constants/platform.ts`
- Desktop-specific app code under `packages/app/src/desktop/`

## MCP Server

- `packages/server/src/server/agent/mcp-server.ts`
- Allows agents to create sub-agents, check permissions, set timeouts
- Injected into agents when `mcp.injectIntoAgents` config is enabled

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

## Storage Layout

```

```

## Error Handling

- Zod schemas validate all WebSocket messages at ingress (`packages/server/src/shared/messages.ts`)
- Providers emit structured error events into the timeline rather than crashing the daemon
- Agent errors transition state machine to `error` then `closed`
- `pid-lock.ts` prevents multiple daemon instances on the same port

## Key Design Decisions

- **Local-first**: Agent processes run on the developer's machine; no code is sent to Ottie's servers
- **Single WebSocket connection per client**: Binary multiplexing avoids per-feature connections
- **Append-only timeline with epochs**: Safe concurrent reads, no locking needed
- **Providers handle their own auth**: Ottie is auth-agnostic; keys stay in provider config files
- **Schema backward-compatibility**: Old clients must always parse new daemon messages
- **Relay is zero-knowledge**: The relay routes encrypted blobs and cannot read content
