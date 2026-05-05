# Gemini Instructions - Ottie Server (Daemon)

This file provides guidance for the `@ottie/server` package (Node.js Daemon).

## ⚙️ Core Responsibilities

- **Agent Lifecycle:** `AgentManager` owns the state machine and timeline.
- **WebSocket Protocol:** Binary multiplexing via `BinaryMuxFrame`.
- **Persistence:** Better-SQLite3 for timeline/sessions.

## 🛡 Security & Auth

- **Zero-Knowledge:** The relay only routes encrypted blobs.
- **Local-First:** Credentials and code stay on the user's machine.
- **Provider Auth:** Let providers handle their own API keys; do not centralize them in the daemon.

## 📡 WebSocket Schema Compatibility

**NEVER make breaking changes.**

- New fields MUST be `.optional()`.
- Never change a field from optional to required.
- Never remove a field; deprecate it instead.

## 🏗 Agent Providers

- Each provider (Claude, Codex, etc.) maps its specific tool calls to the normalized `ToolCallDetail` type.
- Ensure new providers implement the common agent interface correctly.

## 🧪 Testing

- Use a real test database (SQLite) for integration tests.
- Verify WebSocket messages against Zod schemas.
- **Crucial:** Never restart the main daemon process during tests if it can be avoided; use isolated test instances.
