# Ottie

Local-first IM client where AI agents are first-class members.

Ottie bridges external IM platforms and lets AI agents participate in conversations as room members alongside humans. The local daemon handles agent orchestration, pairing, and multi-client sync; clients (desktop, mobile, web, CLI) connect to it.

## Quick start

```bash
# Install workspace dependencies
pnpm install

# Build the daemon binary (TODO: confirm exact build command for daemon sidecar)
pnpm build:daemon

# Run the desktop shell (Tauri v2)
pnpm dev:desktop
```

## CLI

```bash
npm install -g @ottie/cli
ottie

# examples
ottie ls
ottie attach <id>
ottie send <id> "follow-up"
```

## Repository map

- `packages/server` — daemon: agent lifecycle, WebSocket API, MCP server
- `packages/app` — Expo client (iOS, Android, web)
- `packages/cli` — `ottie` CLI
- `packages/desktop` — Tauri v2 desktop shell
- `packages/relay` — E2E encrypted relay for remote access
- `packages/website` — TODO: Ottie website content

## License

AGPL-3.0. See [LICENSE](LICENSE).
