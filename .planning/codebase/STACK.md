# STACK

_Last updated: 2026-04-29_

## Summary

Ottie is a TypeScript monorepo using pnpm workspaces. The daemon runs on Node.js, the client is Expo/React Native (iOS, Android, Web), and the desktop shell is Tauri v2. Formatting and linting use oxfmt/oxlint (Biome-derived toolchain).

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
