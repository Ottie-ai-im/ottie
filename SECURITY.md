# Security

Ottie follows a client-server architecture, similar to Docker. The daemon runs on your machine and manages your coding agents. Clients (the mobile app, CLI, or web interface) connect to the daemon to monitor and control those agents.

Your code never leaves your machine. Ottie is a local-first tool that connects directly to your development environment.

## Architecture

The Ottie daemon can run anywhere you want to execute agents: your laptop, a Mac Mini, a VPS, or a Docker container. The daemon listens for connections and manages agent lifecycles.

Clients connect to the daemon over WebSocket. There are two ways to establish this connection:

- **Relay connection** — The daemon connects outbound to our relay server, and clients meet it there. No open ports required.
- **Direct connection** — The daemon listens on a network address and clients connect directly.

## Relay threat model

The relay is designed to be untrusted. All traffic between your phone and daemon is end-to-end encrypted. The relay server cannot read your messages, see your code, or modify traffic without detection. Even if the relay is compromised, your data remains protected.

### How it works

1. The daemon generates a persistent ECDH keypair and stores it locally
2. When you scan the QR code or click the pairing link, your phone receives the daemon's public key
3. Your phone sends a handshake message with its own public key. The daemon will not accept any commands until this handshake completes.
4. Both sides perform an ECDH key exchange to derive a shared secret. All subsequent messages are encrypted with XSalsa20-Poly1305 (NaCl box).

The relay sees only: IP addresses, timing, message sizes, and session IDs. It cannot read message contents, forge messages, or derive encryption keys from observing the handshake.

### Why the relay can't attack you

The daemon requires a valid cryptographic handshake before processing any commands. A compromised relay cannot:

- **Send commands** — Without your phone's private key, it cannot complete the handshake
- **Read your traffic** — All messages are encrypted with XSalsa20-Poly1305 (NaCl box) after the handshake
- **Forge messages** — NaCl box provides authenticated encryption; tampered messages are rejected
- **Replay old messages across sessions** — Each session derives fresh encryption keys, so ciphertext from one session cannot be replayed into another session. Within a live session, replay protection is not yet implemented; the protocol uses random nonces and does not track nonce reuse or message counters.

### Trust model

The QR code or pairing link is the trust anchor. It contains the daemon's public key, which is required to establish the encrypted connection. Treat it like a password — don't share it publicly.

## Local daemon trust boundary

By default, the daemon binds to `127.0.0.1`. The local control plane is trusted by network reachability, not by an additional authentication token.

Anything that can reach the daemon socket can control the daemon. This is the same security model Docker documents for its daemon: the security boundary is access to the socket or listening address.

If you expose the daemon beyond loopback, such as by binding to `0.0.0.0`, forwarding it through a tunnel or reverse proxy, or publishing it from a Docker container, you are responsible for restricting and securing that access.

For remote access, use the relay connection. It is the supported path for reaching the daemon off-machine, and it adds end-to-end encryption plus a pairing handshake before commands are accepted.

Host header validation and CORS origin checks are defense-in-depth controls for localhost exposure. They help block DNS rebinding and browser-based attacks, but they do not replace network isolation.

## Local daemon authentication

Starting in v1.11 (ARCH-03), the daemon supports three local-token modes that
gate the WebSocket upgrade with a constant-time bearer-token compare. The
modes coexist with — and are independent of — the relay path described above:
the relay handshake is unchanged, and the local-token check is a SECOND line
of defense at the local-bind boundary.

### Mode A — Loopback-trust (default)

Applies when no token is configured (no `OTTIE_LOCAL_TOKEN` env var set, no
`$OTTIE_HOME/local-token` file present). This is today's behavior — `npm run dev`
and unbundled-daemon flows continue to work without authentication. The
WebSocket upgrade gate is a no-op in Mode A; the daemon accepts any same-origin
connection that passes the existing host/origin checks.

Residual risk on shared multi-user machines: any local user (or process running
as a different OS user) who can reach the loopback port can connect. Acceptable
for single-user developer machines.

### Mode B — Token-file (Tauri-bundled, automatic)

Applies when running the desktop app. The Tauri shell writes
`$OTTIE_HOME/local-token` (mode 0600 on POSIX, base64url 32 random bytes)
**before** spawning the daemon subprocess (D-15). Daemon reads the file on
boot. Same-machine clients (CLI, second desktop window) read the file
directly with the same OS permissions.

The token is **never** transmitted over the network in plaintext: clients
send it as `Authorization: Bearer <token>` over the local WebSocket, which
itself is loopback. The token VALUE is never returned by the
`local_token_status_request` RPC — only `{mode, tokenPresent}` — so the
Settings → Advanced → Local daemon panel never receives the value. Users
locate the token by opening `$OTTIE_HOME/local-token` directly.

Regeneration: only via Settings → Advanced → Local daemon (D-13). Deleting the
file forces regeneration on the next daemon start. The Tauri shell's
`ensure_local_token()` is idempotent — it never overwrites an existing file
(which would invalidate paired clients without warning).

On Windows, the file falls back to `std::fs::write` under default
user-profile permissions; ACL hardening is a follow-up.

### Mode C — Explicit env var (`OTTIE_LOCAL_TOKEN`)

For users binding to non-loopback addresses (containers, VPSes, remote
machines reached over a private network). Set `OTTIE_LOCAL_TOKEN` in the
daemon's environment; clients send the same value as `Authorization: Bearer`.

Token rotation is the user's responsibility (rotate the env var, restart the
daemon). Bind to `0.0.0.0` only when paired with this mode; binding to
`0.0.0.0` in Mode A is unsafe and out of scope of the v1.11 milestone (a
future release will fail-loud on this misconfiguration).

### Auth failure handler

When a Mode B/C connection arrives without a valid bearer token, the daemon
responds with HTTP `401 Unauthorized` and the header
`WWW-Authenticate: Bearer realm="ottie-local"`. The client UI surfaces the
documented user-facing copy (D-14):

> _"This daemon requires a local token. If you're on the same machine, find
> it at `$OTTIE_HOME/local-token`. See `$OTTIE_HOME/daemon.log` for details."_

The daemon logs the rejected attempt with the `authRejected` runtime counter
incremented. Pino redaction prevents the bearer token value from leaking into
log output: any field named `authorization`, `token`, or `OTTIE_LOCAL_TOKEN`
is censored to `[REDACTED]` at every log level (T-05-03).

### Threat-model delta

What each mode protects against vs. does not:

- **Mode A** protects against: nothing additional beyond the loopback bind +
  OS permissions. The localhost-only bind is the only barrier; any local user
  can connect.
- **Mode B** protects against: same-machine multi-user attacks (the
  mode-0600 token file is owner-only readable on POSIX) AND accidentally
  exposing a non-loopback bind without auth. Does NOT protect against: a
  process running as the **same** OS user as the daemon (it can read the
  token file directly).
- **Mode C** protects against: same as Mode B, plus the failure mode where
  Mode B's file is unreadable (e.g. on a remote server with no Tauri shell).
  Adds: the operational risk of env-var management — rotating the value
  requires a daemon restart.
- All three modes are **independent of the relay path**. The relay traffic is
  already E2E-encrypted (see "Relay threat model" above); the local-token
  check sits at the local-bind boundary and is orthogonal.

Implementation: `packages/server/src/server/auth/local-token.ts`,
`packages/server/src/server/auth/local-token-service.ts`,
`packages/desktop/src-tauri/src/daemon.rs`.

## DNS rebinding protection

CORS is not a complete security boundary. It controls which browser origins can make requests, but does not prevent a malicious website from resolving its domain to your local machine (DNS rebinding).

Ottie validates the `Host` header on incoming requests against configured hostnames. Requests with unrecognized hosts are rejected.

## Agent authentication

Ottie wraps agent CLIs (Claude Code, Codex, OpenCode) but does not manage their authentication. Each agent provider handles its own credentials. Ottie never stores or transmits provider API keys. Agents run in your user context with your existing credentials.

## Reporting vulnerabilities

If you discover a security vulnerability, please report it privately by emailing hello@.com. Do not open a public issue.
