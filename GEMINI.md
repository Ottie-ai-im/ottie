# Gemini Instructions - Ottie

Welcome! This file provides Gemini-specific guidance for working on the Ottie codebase. Ottie is a local-first IM client where AI agents are first-class members.

## 🎯 Primary Goal

Deliver high-quality, type-safe, and well-tested features for the Ottie ecosystem (Daemon, App, CLI, Desktop).

## 📚 Essential References

These documents are the source of truth for project rules and standards. **Read them before starting any task.**

- [CLAUDE.md](./CLAUDE.md) - **CRITICAL RULES**. Repository map, quick start, and architectural constraints.
- [docs/CODING_STANDARDS.md](./docs/CODING_STANDARDS.md) - Type hygiene, React patterns, and file organization.
- [docs/TESTING.md](./docs/TESTING.md) - TDD workflow, determinism, and real dependencies.
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - System design and package layering.

## 🛑 Critical Constraints (From CLAUDE.md)

- **NEVER restart the main Ottie daemon on port 6868 without permission.** It manages all running agents.
- **NEVER run the full test suite locally.** Run specific test files: `npx vitest run <file> --bail=1`.
- **Backward Compatibility is Mandatory.** WebSocket and message schemas must support old clients.
- **Always run `npm run typecheck && npm run lint`** after changes.
- **Run `npm run format`** before committing (uses Biome).

## 🛠 Project Skills

This repo contains custom Gemini skills for specialized tasks. Activate them as needed:

- `ottie` - Reference for `ottie` CLI commands (ls, run, loop, chat, terminal).

## 🤖 Supported Agents

- **Claude**: Supported natively via Claude Agent SDK.
- **Codex**: Supported natively via Codex App Server.
- **Gemini**: Supported natively via Pi Coding Agent engine. Supports `GEMINI_API_KEY`, Google Application Default Credentials (ADC), or Gemini CLI authentication.
- **OpenCode**: Supported via OpenCode CLI.
- **ACP Agents**: Support for any agent following the Agent Client Protocol.

## 📦 Package-Specific Guidance

For detailed instructions within specific packages, see:

- [packages/app/GEMINI.md](./packages/app/GEMINI.md) - Mobile + Web client (Expo).
- [packages/server/GEMINI.md](./packages/server/GEMINI.md) - Node.js Daemon.

## 🧪 Testing Strategy

- **Reproduce First:** Always create a reproduction test case before fixing a bug.
- **Real Deps:** Favor real databases/APIs over mocks unless isolation is strictly required.
- **Deterministic:** Ensure tests do not rely on timing or randomness.

## 🔄 Common Workflows

- **New Feature:** Research -> Strategy (Plan Mode) -> Execution -> Validation (Vitest/Playwright).
- **Bug Fix:** Reproduce (Test) -> Fix -> Validate -> Lint/Typecheck.
- **Schema Change:** Ensure all new fields are `.optional()` in Zod schemas.
