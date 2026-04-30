# INTEGRATIONS

_Last updated: 2026-04-29_

## Summary

Ottie integrates with multiple AI agent runtimes (Claude Code, Codex/pi-agent, OpenCode, ACP agents) via dedicated provider adapters in the daemon. Remote access uses an E2E encrypted relay hosted on Cloudflare Workers. Speech uses Sherpa-ONNX running entirely locally.

## AI Agent Providers

| Provider               | Package                                                                                        | Protocol              |
| ---------------------- | ---------------------------------------------------------------------------------------------- | --------------------- |
| Claude Code            | `@anthropic-ai/claude-agent-sdk ^0.2.11`                                                       | SDK-based lifecycle   |
| Codex / pi-agent       | `@mariozechner/pi-agent-core ^0.67.68`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent` | SDK-based             |
| OpenCode               | `@opencode-ai/sdk 1.2.6` (exact pin)                                                           | SDK-based             |
| ACP Agents             | `@agentclientprotocol/sdk ^0.17.1`                                                             | Agent Client Protocol |
| Custom / OpenAI-compat | `openai ^4.20.0`                                                                               | REST                  |

Each provider implements a common `AgentProvider` interface in `packages/server/src/server/agent/providers/`.

## LLM Abstraction

- **Vercel AI SDK** (`ai 5.0.78`, exact pin) — streaming LLM calls, model-agnostic
- Underlying models accessed via provider-specific credentials stored in daemon config

## MCP (Model Context Protocol)

- **`@modelcontextprotocol/sdk ^1.20.1`** — the daemon exposes an MCP server so external tools can interact with agents
- `scripts/mcp-stdio-socket-bridge-cli.mjs` — bridges MCP stdio ↔ daemon WebSocket

## E2E Encrypted Relay

- **`@ottie/relay`** (internal package) — relay library shared by daemon and Cloudflare adapter
- Deployed on **Cloudflare Workers** (`packages/relay/src/cloudflare-adapter.ts`)
- End-to-end encryption using Web Crypto API (AES-GCM); relay server never sees plaintext
- DNS rebinding protection documented in `SECURITY.md`
- Relay protocol is the primary path for remote (off-LAN) access

## Speech / Voice

- **sherpa-onnx** / **sherpa-onnx-node** `1.12.28` — local Automatic Speech Recognition (ASR) and Text-to-Speech (TTS)
- **Silero VAD** model bundled as `silero_vad.onnx` — Voice Activity Detection
- **onnxruntime-node** `^1.23.0` — ONNX inference runtime powering the above
- **`@ottie/expo-two-way-audio`** (internal Expo module) — two-way audio on iOS/Android
- **expo-audio** on mobile; **Web Audio API** on web (split via Metro file extensions)
- All speech processing runs on-device / on-daemon — no cloud STT/TTS required

## Push Notifications

- **expo-notifications** `^0.32.16` — push token registration on iOS/Android
- Notification delivery routed through the relay or daemon; no dedicated push service configured in code

## Mobile / Native

- **expo-camera** — QR code scanning for connection setup
- **expo-haptics** — haptic feedback
- **expo-clipboard**, **expo-sharing**, **expo-document-picker**, **expo-image-picker** — file handling
- **expo-location** — geolocation (used in some agent contexts)

## Web Deploy

- **Cloudflare Pages** — web app (`wrangler pages deploy`)
- App builds via `expo export --platform web` → `dist/`

## CI/CD

- **GitHub Actions** — inferred from release playbook and `.github/` workflows
- EAS (Expo Application Services) — cloud builds for Android/iOS (`eas-build-post-install` script)
- **lefthook** — pre-commit hooks (typecheck, lint)

## Schema Validation

- **zod** `^3.23.8` — runtime schema validation for WebSocket messages, config, agent events
- **zod-to-json-schema** — generates JSON Schema from Zod types (used for MCP tool definitions, config schema)
- **ajv** `^8.17.1` — additional JSON Schema validation

## Observability

- **pino** `^10.2.0` + **pino-pretty** — structured daemon logging to `$OTTIE_HOME/daemon.log`
- **rotating-file-stream** `^3.2.9` — log rotation
