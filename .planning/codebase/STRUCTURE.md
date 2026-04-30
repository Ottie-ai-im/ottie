# STRUCTURE

_Last updated: 2026-04-29_

## Summary

Ottie is a pnpm workspace monorepo with 8 packages. The daemon (`packages/server`) is the largest and most complex package; the client (`packages/app`) is a cross-platform Expo application. Metro resolves platform-specific files via `.web.ts` / `.native.ts` extensions at build time.

## Monorepo Layout

```
ottie/
├── packages/
│   ├── app/           @ottie/app        — Expo mobile+web client
│   ├── server/        @ottie/server     — Daemon (agent lifecycle, WebSocket, MCP)
│   ├── cli/           @ottie/cli        — Docker-style CLI (run/ls/logs/wait)
│   ├── relay/         @ottie/relay      — E2E encrypted relay library
│   ├── desktop/       @ottie/desktop    — Tauri v2 desktop shell
│   ├── highlight/     @ottie/highlight  — Syntax highlighting (shared)
│   ├── expo-two-way-audio/              — Custom Expo audio module
│   └── website/       @ottie/website    — Marketing site (stub)
├── docs/              — Architecture, coding standards, release playbook
├── scripts/           — Build, release, version sync scripts
├── patches/           — patch-package patches for deps
├── CLAUDE.md          — Project instructions for AI agents
├── SECURITY.md        — Relay threat model, E2E encryption docs
└── package.json       — Workspace root (pnpm@9.12.0)
```

## packages/app — Expo Client

```
packages/app/src/
├── app/               — Expo Router pages (file-based routes)
├── components/        — Shared UI components
│   └── ui/            — Primitive UI components (dropdown, tooltip, etc.)
├── screens/           — Screen-level compositions
│   ├── workspace/     — Main workspace (agent list, chat)
│   └── settings/      — Settings screens
├── panels/            — Panel-level components (agent panel, etc.)
├── hooks/             — Custom React hooks
├── stores/            — Zustand stores (timeline-cache, etc.)
├── contexts/          — React contexts (session, etc.)
├── constants/         — Platform gates, layout constants
├── i18n/              — Internationalisation (en/zh JSON)
├── types/             — TypeScript type definitions
├── utils/             — Utility functions
├── query/             — TanStack Query wrappers
├── chat/              — Chat-specific logic
├── attachments/       — File attachment handling
├── terminal/          — Terminal UI integration
├── voice/             — Voice UI
├── voice-control/     — Voice control flow
├── dictation/         — Dictation feature
├── desktop/           — Desktop-specific overrides
├── keyboard/          — Keyboard shortcut handling
├── lib/               — Shared libs/adapters
├── polyfills/         — Platform polyfills
├── runtime/           — Runtime detection utilities
└── styles/            — Global styles / theme tokens
```

## packages/server — Daemon

```
packages/server/src/
├── server/            — Core daemon code
│   ├── agent/         — Agent lifecycle: providers, spawning, monitoring
│   │   └── providers/ — Per-agent adapters (claude-code, codex, opencode, acp)
│   ├── chat/          — Chat message handling
│   ├── client/        — Client connection management
│   ├── services/      — Domain services (bootstrap, config, workspace, worktree)
│   ├── speech/        — STT/TTS (sherpa-onnx, providers)
│   ├── daemon-e2e/    — E2E integration test fixtures
│   ├── session.ts     — God-file: session orchestration (~9500 lines)
│   ├── config.ts      — Daemon configuration
│   ├── bootstrap.ts   — Daemon startup
│   └── index.ts       — Entry point
├── shared/            — Types shared between server and client packages
├── tasks/             — Background task runners
├── terminal/          — PTY management (node-pty), shell integration scripts
├── utils/             — Utility functions
└── test-utils/        — Test helpers
```

## packages/relay — Relay Library

```
packages/relay/src/
├── index.ts           — Main relay client/server
├── e2ee.ts            — End-to-end encryption primitives (Web Crypto)
└── cloudflare-adapter.ts — Cloudflare Workers deployment adapter
```

## packages/cli — CLI

```
packages/cli/src/
└── index.js           — Entry point (tsx-compiled); commands: run/ls/logs/wait/daemon
```

## packages/desktop — Tauri Shell

```
packages/desktop/
├── src-tauri/         — Rust Tauri source (main.rs, tauri.conf.json)
└── package.json       — @tauri-apps/cli dev dep only
```

## Important Config Files

| File                                         | Purpose                                            |
| -------------------------------------------- | -------------------------------------------------- |
| `packages/app/app.config.js`                 | Expo app config (variants: development/production) |
| `packages/server/src/server/config.ts`       | Daemon config schema (Zod)                         |
| `packages/desktop/src-tauri/tauri.conf.json` | Tauri window/build config                          |
| `tsconfig.server.json`                       | Server TS compilation config                       |
| `knip.json`                                  | Dead code detection config                         |
| `lefthook.yml`                               | Git hooks config                                   |
| `ottie.json`                                 | Top-level project metadata                         |

## File Naming Conventions

- `kebab-case.ts` for all files
- `.test.ts` suffix for unit tests (co-located with source)
- `.e2e.test.ts` suffix for E2E/integration tests
- `.spec.ts` for Playwright tests
- No `index.ts` barrel files in most packages (direct imports preferred)

## Platform Resolution (Metro)

Metro resolves `import '@/hooks/use-audio-recorder'` to:

- `use-audio-recorder.web.ts` when bundling for web
- `use-audio-recorder.native.ts` when bundling for iOS/Android

This pattern is used for any hook/module with fundamentally different implementations per platform. Runtime `if (isWeb)` guards are reserved for small inline checks only.

## Where to Add New Code

| What                       | Where                                                                |
| -------------------------- | -------------------------------------------------------------------- |
| New UI component           | `packages/app/src/components/`                                       |
| New screen                 | `packages/app/src/screens/` or `packages/app/src/app/` (if routed)   |
| New Zustand store          | `packages/app/src/stores/`                                           |
| New hook                   | `packages/app/src/hooks/`                                            |
| New agent provider         | `packages/server/src/server/agent/providers/`                        |
| New daemon service         | `packages/server/src/services/`                                      |
| New WebSocket message type | `packages/server/src/shared/` (Zod schema, backward-compat required) |
| New CLI command            | `packages/cli/src/index.js`                                          |
| New relay feature          | `packages/relay/src/`                                                |
