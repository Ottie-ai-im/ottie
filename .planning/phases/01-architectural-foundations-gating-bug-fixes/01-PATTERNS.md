# Phase 1: Architectural Foundations & Gating Bug Fixes — Pattern Map

**Mapped:** 2026-04-30
**Files analyzed:** 22 (12 NEW, 10 MODIFIED, plus shared lint hosts)
**Analogs found:** 19 / 22 (3 have no close analog — flagged in §"No Analog Found")

---

## File Classification

| New/Modified File                                                 | Status   | Role                             | Data Flow                                   | Closest Analog                                                                                                                                                                   | Match Quality                      |
| ----------------------------------------------------------------- | -------- | -------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `packages/server/src/server/session/router.ts`                    | NEW      | router/dispatcher                | request-response                            | `packages/server/src/server/session.ts` lines 1685-1809 (`dispatchInboundMessage` cluster)                                                                                       | exact (carved out)                 |
| `packages/server/src/server/session/parse.ts`                     | NEW      | validation/boundary              | request-response                            | `packages/server/src/server/websocket-server.ts` lines 17-28 (`WSInboundMessageSchema` import + parse) + `packages/server/src/shared/messages.ts` Zod schemas                    | role + flow match                  |
| `packages/server/src/server/session/permission-handler.ts`        | NEW      | handler (per-connection state)   | request-response                            | `packages/server/src/server/session.ts` lines 4135-4180 (`handleAgentPermissionResponse`) + 1802-1804 (dispatch)                                                                 | exact (carved out)                 |
| `packages/server/src/server/auth/local-token.ts`                  | NEW      | service (file-backed)            | file-I/O + boundary check                   | `packages/server/src/server/ottie-home.ts` (file-mode helper); `packages/server/src/server/daemon-keypair.ts` (token-on-disk pattern)                                            | role match                         |
| `packages/app/src/styles/tokens/primitives.ts`                    | NEW      | tokens/config                    | constants                                   | `packages/app/src/styles/theme.ts` lines 1-99 (`baseColors`)                                                                                                                     | role match (lift)                  |
| `packages/app/src/styles/tokens/semantic.light.ts`                | NEW      | tokens/config                    | constants                                   | `packages/app/src/styles/theme.ts` lines 132-219 (`lightSemanticColors`)                                                                                                         | exact (lift)                       |
| `packages/app/src/styles/tokens/semantic.dark.ts`                 | NEW      | tokens/config                    | constants                                   | `packages/app/src/styles/theme.ts` (dark mirror of `lightSemanticColors`)                                                                                                        | exact (lift)                       |
| `packages/app/src/styles/tokens/component.ts`                     | NEW      | tokens/config                    | constants                                   | `packages/app/src/styles/theme.ts` borderRadius + iconSize fragments                                                                                                             | role match (extract)               |
| `packages/app/src/styles/tokens/motion.ts`                        | NEW      | tokens/config                    | constants                                   | `packages/app/src/components/math-curve-loader/curves.ts` lines 173-262 (`CURVE_PRESETS`, particle budgets)                                                                      | exact (lift)                       |
| `packages/app/src/styles/tokens/typography.ts`                    | NEW      | tokens/config                    | constants                                   | `packages/app/src/styles/theme.ts` `fontFamily` / `fontSize` fragments                                                                                                           | role match (extract)               |
| `packages/app/src/screens/settings/local-daemon-panel.tsx`        | NEW      | screen-section component         | request-response (read-only with mutations) | `packages/app/src/screens/settings/labs-section.tsx` (entire file — same `SettingsSection` + `settingsStyles.card` shape)                                                        | exact                              |
| `packages/server/src/shared/messages.frozen-v1.{8,9,10}.test.ts`  | NEW (×3) | test (schema parity)             | request-response (parse-only)               | `packages/server/src/shared/messages.attachments.test.ts` lines 1-50 (Zod parse asserting tolerated/dropped fields)                                                              | exact (extension)                  |
| Lint plugins under `tools/lint/`                                  | NEW      | lint rules                       | static analysis                             | None — no in-repo oxlint custom rule precedent                                                                                                                                   | NO ANALOG (see §"No Analog Found") |
| `packages/server/src/server/session.ts`                           | MODIFIED | wrapping/composition             | request-response                            | self (lines 1637-1698 `handleMessage` + dispatcher table is the carve seam)                                                                                                      | self                               |
| `packages/server/src/server/websocket-server.ts`                  | MODIFIED | upgrade gate                     | request-response                            | self (lines 568-624 `createWebSocketServer` + `verifyWsClient` — same place to add the bearer check)                                                                             | self                               |
| `packages/desktop/src-tauri/src/daemon.rs`                        | MODIFIED | spawn supervisor                 | side-effect (file write before subprocess)  | self (lines 32-63 `spawn` — env vars set before `.spawn()`; same ordering needed for token-file write)                                                                           | self                               |
| `packages/server/src/shared/messages.ts`                          | MODIFIED | schema + registry                | constants                                   | self (annotation in place; no analog needed beyond `.describe()` pattern from research §4.3)                                                                                     | self                               |
| `packages/app/src/styles/theme.ts`                                | MODIFIED | composition root                 | constants                                   | self (consumes new `tokens/` tree; structure is `lightTheme = { ...semantic, motion, typography }` per research §8.3)                                                            | self                               |
| `packages/app/src/components/ui/glass-surface.tsx`                | MODIFIED | UI primitive                     | request-response                            | self (lines 47-64 — `theme.colors.surfaceGlass*` references move from theme to `theme.surface.glass.*` tokens)                                                                   | self                               |
| `packages/app/src/components/daemon-connection-dot.tsx`           | MODIFIED | UI presenter                     | request-response                            | self (lines 42-50 + 79-93 — `theme.colors.palette.*` and `theme.colors.foregroundMuted` references repoint to semantic tokens)                                                   | self                               |
| `packages/app/src/components/math-curve-loader/curves.ts`         | MODIFIED | constants source                 | n/a                                         | self (file shrinks; values move to `tokens/motion.ts`)                                                                                                                           | self                               |
| `packages/app/src/components/message.tsx`                         | MODIFIED | UI/hover gate                    | event-driven                                | `packages/app/src/components/message.tsx` line 410 (`isCompact \|\| messageHovered \|\| copyButtonHovered`) — already uses the canonical pattern; chevron at line 2601+ does not | self (in-file analog)              |
| `packages/app/src/components/resize-handle.tsx`                   | MODIFIED | gesture/web-only                 | event-driven                                | `packages/app/src/components/toast-host.tsx` lines 257-258 (`onPointerEnter={isWeb ? pauseDismiss : undefined}`)                                                                 | role + flow match                  |
| `packages/server/src/server/agent/providers/opencode-agent.ts`    | MODIFIED | provider impl (persistence read) | file-I/O                                    | `packages/server/src/server/agent/providers/claude-agent.ts` lines 1190-1206 (`listPersistedAgents` real impl)                                                                   | exact                              |
| Flag store under `packages/app/src/stores/` (chromeEnabled split) | MODIFIED | Zustand persist + migrate        | client-only state                           | `packages/app/src/stores/draft-store.ts` lines 14, 38-83, 359-468 (`DRAFT_STORE_VERSION` + `migratePersistedState` pattern)                                                      | role match                         |
| `packages/app/src/i18n/locales/{en,zh}.json`                      | MODIFIED | i18n strings                     | constants                                   | self + `packages/app/src/screens/settings/labs-section.tsx` `t("settings.labsVoice...")` callsites for naming convention                                                         | self                               |
| `SECURITY.md`                                                     | MODIFIED | docs                             | n/a                                         | self                                                                                                                                                                             | self                               |

---

## Pattern Assignments

### `packages/server/src/server/session/router.ts` (router, request-response) — Carve C-1

**Analog:** `packages/server/src/server/session.ts` lines 1685-1809

**Existing dispatch table to extract verbatim** (lines 1685-1698):

```typescript
private async dispatchInboundMessage(msg: SessionInboundMessage): Promise<void> {
  const promise =
    this.dispatchVoiceAndControlMessage(msg) ??
    this.dispatchAgentLifecycleMessage(msg) ??
    this.dispatchAgentConfigMessage(msg) ??
    this.dispatchCheckoutMessage(msg) ??
    this.dispatchWorkspaceAndProjectMessage(msg) ??
    this.dispatchProviderMessage(msg) ??
    this.dispatchTerminalMessage(msg) ??
    this.dispatchChatSyncMessage(msg) ??
    this.dispatchChatScheduleLoopMessage(msg) ??
    this.dispatchMiscMessage(msg);
  if (promise) await promise;
}
```

**Outer error-handling wrapper to preserve** (lines 1637-1683):

```typescript
public async handleMessage(msg: SessionInboundMessage): Promise<void> {
  this.inflightRequests++;
  if (this.inflightRequests > this.peakInflightRequests) {
    this.peakInflightRequests = this.inflightRequests;
  }
  try {
    this.sessionLogger.trace(
      { messageType: msg.type, payloadBytes: JSON.stringify(msg).length },
      "inbound message",
    );
    try {
      await this.dispatchInboundMessage(msg);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sessionLogger.error({ err }, "Error handling message");
      const requestId = (msg as { requestId?: unknown }).requestId;
      if (typeof requestId === "string") {
        try {
          this.emit({
            type: "rpc_error",
            payload: { requestId, requestType: msg.type, error: `Request failed: ${err.message}`, code: "handler_error" },
          });
        } catch (emitError) {
          this.sessionLogger.error({ err: emitError }, "Failed to emit rpc_error");
        }
      }
      // ... activity_log emit ...
    }
  } finally {
    this.inflightRequests--;
  }
}
```

**Pattern-to-copy:**

1. Build `MessageRouter` as a class with `register(kind, handler)` + `dispatch(msg)`. Initial registry is bound function refs back into `Session` methods (zero behavior change — research §3.3 step C-1).
2. Keep `handleMessage` outer wrapper in `Session`; it calls `router.dispatch(msg)`.
3. Add a router-level unit test that asserts every `kind` in `SessionInboundMessage` discriminator has a registered handler (per research §3.3 step C-1 verification).

**Strangler-Fig flag** (per D-01 + research §13): wrap call site with `process.env.OTTIE_USE_NEW_ROUTER !== "0"` so both paths are exercised in CI matrix (D-04).

---

### `packages/server/src/server/session/parse.ts` (validation, request-response) — Carve C-2

**Analog:** `packages/server/src/server/websocket-server.ts` lines 17-28 (Zod imports) + `packages/server/src/shared/messages.ts` `WSInboundMessageSchema`

**Existing pattern at WS boundary** (websocket-server.ts:23):

```typescript
import {
  type WSInboundMessage,
  WSInboundMessageSchema,
  // ...
} from "./messages.js";
```

The schema is already discriminated-union over `kind`. C-2 lifts the parse call into a single function.

**Pattern-to-copy:**

```typescript
// session/parse.ts
import { WSInboundMessageSchema, type WSInboundMessage } from "../messages.js";
import type { z } from "zod";

export interface ParseInboundResult {
  ok: true;
  message: WSInboundMessage;
} | {
  ok: false;
  error: z.ZodError;
}

export function parseInboundMessage(raw: unknown): ParseInboundResult {
  const result = WSInboundMessageSchema.safeParse(raw);
  if (result.success) return { ok: true, message: result.data };
  return { ok: false, error: result.error };
}
```

**Why a discriminated-union return** (per CONVENTIONS "Discriminated unions over bags of booleans/optionals", lines 53-69 of `.planning/codebase/CONVENTIONS.md`).

**No throw on parse failure** — caller (router) decides whether to emit `rpc_error` or close the socket. Matches existing handler-error path from session.ts:1655-1664.

---

### `packages/server/src/server/session/permission-handler.ts` (handler, request-response) — Carve C-3

**Analog:** `packages/server/src/server/session.ts` lines 4135-4170 + 1802-1804

**Imports pattern** (session.ts:124-126):

```typescript
import type {
  AgentPermissionResponse,
  AgentProvider,
  // ...
} from "./agent/agent-sdk-types.js";
```

**Core pattern** (session.ts:4135-4170 — the entire method):

```typescript
private async handleAgentPermissionResponse(
  agentId: string,
  requestId: string,
  response: AgentPermissionResponse,
): Promise<void> {
  try {
    const result = await this.agentManager.respondToPermission(agentId, requestId, response);
    this.sessionLogger.debug({ agentId }, `Permission response forwarded to agent ${agentId}`);
    if (result?.requiresFollowUpTurn) {
      this.sessionLogger.info(
        { agentId, requestId },
        "Permission response requires follow-up turn, starting agent stream",
      );
      // ... start follow-up turn ...
    }
  } catch (error) {
    // typed error → activity_log emit
  }
}
```

**Pattern-to-copy:**

1. New class `PermissionHandler` constructor takes `{ agentManager, emit, logger }` — per-connection state (in-flight permission ids) is its own field instead of being on `this` shared with everything.
2. Method `handleResponse(agentId, requestId, response)` lifts the body verbatim. Replace `this.sessionLogger` with injected `logger`, `this.emit` with injected `emit` (preserves the `rpc_error` and `activity_log` boundary contract).
3. Wire dispatch: in router, register `kind === "agent_permission_response"` to `permissionHandler.handleResponse(msg.agentId, msg.requestId, msg.response)` (replacing session.ts:1803).
4. Per research §3.3 C-3: this is the **smallest surface** (≈5 message kinds: response + voice-permission policy fragment); ship behind `OTTIE_USE_PERMISSION_HANDLER` flag.

**Verifies** — existing permission flow E2E (D-02) must stay green.

---

### `packages/server/src/server/auth/local-token.ts` (service, file-I/O + boundary check) — ARCH-03

**Analogs:**

- File-mode + path utilities: `packages/server/src/server/ottie-home.ts` (lines 1-20 — `resolveOttieHome`, `mkdirSync`, `~/.ottie` resolution)
- Token-on-disk precedent: `packages/server/src/server/daemon-keypair.ts` (similar persistent-secret-in-`$OTTIE_HOME` pattern)

**Imports pattern** (ottie-home.ts:1-3):

```typescript
import os from "node:os";
import path from "node:path";
import { mkdirSync } from "node:fs";
```

**Pattern-to-copy** — implement three modes per research §9.4:

```typescript
// auth/local-token.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { resolveOttieHome } from "../ottie-home.js";

const TOKEN_FILENAME = "local-token";
const TOKEN_BYTES = 32;
const FILE_MODE = 0o600;

export type LocalTokenMode =
  | { kind: "loopback-trust" } // Mode A: today's behavior
  | { kind: "token-file"; token: string } // Mode B: $OTTIE_HOME/local-token
  | { kind: "explicit"; token: string }; // Mode C: OTTIE_LOCAL_TOKEN env

export async function resolveLocalTokenMode(
  env: NodeJS.ProcessEnv = process.env,
): Promise<LocalTokenMode> {
  if (typeof env.OTTIE_LOCAL_TOKEN === "string" && env.OTTIE_LOCAL_TOKEN.length > 0) {
    return { kind: "explicit", token: env.OTTIE_LOCAL_TOKEN };
  }
  const tokenPath = path.join(resolveOttieHome(env), TOKEN_FILENAME);
  try {
    const raw = await fs.readFile(tokenPath, "utf8");
    const trimmed = raw.trim();
    if (trimmed.length > 0) return { kind: "token-file", token: trimmed };
  } catch (err) {
    // ENOENT → fall through to loopback-trust
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return { kind: "loopback-trust" };
}

export async function generateAndWriteLocalToken(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenPath = path.join(resolveOttieHome(env), TOKEN_FILENAME);
  await fs.writeFile(tokenPath, token, { mode: FILE_MODE });
  return token;
}

export function verifyBearerToken(provided: string | undefined, mode: LocalTokenMode): boolean {
  if (mode.kind === "loopback-trust") return true;
  if (!provided) return false;
  // Use timingSafeEqual on equal-length buffers; pad/truncate carefully or compare hashes
  // (planner: see crypto.timingSafeEqual usage in packages/relay/src/crypto.ts for precedent)
  return provided === mode.token;
}
```

**Error handling pattern** — fail closed. If reading the file errors with anything other than ENOENT, throw and let bootstrap fail loudly (per CONVENTIONS "Fail explicitly").

**Tauri ordering** (per D-15 + research §13 mitigation row): `generateAndWriteLocalToken` is invoked from `daemon.rs` BEFORE `.spawn()`, so the daemon reads the file on boot with no race. See `packages/desktop/src-tauri/src/daemon.rs` modification below.

---

### `packages/server/src/server/websocket-server.ts` (MODIFIED) — bearer-token gate

**Existing analog (in-file):** `verifyWsClient` lines 594-624

**Existing pattern** (websocket-server.ts:594-624):

```typescript
private verifyWsClient(
  req: IncomingMessage,
  allowedOrigins: Set<string>,
  hostnames: HostnamesConfig | undefined,
  callback: (res: boolean, code?: number, message?: string) => void,
): void {
  const requestMetadata = extractSocketRequestMetadata(req);
  const origin = requestMetadata.origin;
  const requestHost = requestMetadata.host ?? null;
  if (requestHost && !isHostnameAllowed(requestHost, hostnames)) {
    this.incrementRuntimeCounter("hostRejected");
    this.logger.warn({ ...requestMetadata, host: requestHost }, "Rejected connection from disallowed host");
    callback(false, 403, "Host not allowed");
    return;
  }
  // ... origin check ...
  callback(true);
}
```

**Pattern-to-add** — insert bearer gate before origin check:

```typescript
// New: skipped in Mode A
const tokenMode = this.localTokenMode; // injected at construction
if (tokenMode.kind !== "loopback-trust") {
  const auth = req.headers["authorization"];
  const provided =
    typeof auth === "string" && auth.startsWith("Bearer ")
      ? auth.slice("Bearer ".length).trim()
      : undefined;
  if (!verifyBearerToken(provided, tokenMode)) {
    this.incrementRuntimeCounter("authRejected"); // NEW counter (additive, allowed)
    this.logger.warn({ ...requestMetadata }, "Rejected connection — missing/invalid local token");
    // 401 + WWW-Authenticate per D-14
    callback(false, 401, 'Bearer realm="ottie-local"');
    return;
  }
}
```

**Critical:** `localTokenMode` is resolved once at daemon bootstrap (not per-request) and passed into the `VoiceAssistantWebSocketServer` constructor. Mode A path (`loopback-trust`) means **no behavior change** — preserves `npm run dev` flow per D-14 + research §9.4 Mode A row.

**Add new counter** to `WebSocketRuntimeCounters` interface (lines 255-271): `authRejected: number;` — additive change to local interface (not WS schema), no compat concern.

---

### `packages/desktop/src-tauri/src/daemon.rs` (MODIFIED) — write token file before subprocess spawn

**Existing analog (in-file):** `spawn` function lines 32-63

**Existing pattern** (daemon.rs:32-46):

```rust
pub fn spawn<R: Runtime>(app: &AppHandle<R>) -> Result<DaemonHandle, String> {
    let cors_origins = "http://localhost:8081,tauri://localhost,http://tauri.localhost";
    let sidecar = app
        .shell()
        .sidecar("ottie-daemon")
        .map_err(|e| format!("failed to resolve ottie-daemon sidecar: {e}"))?
        .env("OTTIE_DESKTOP_MANAGED", "1")
        .env("OTTIE_CORS_ORIGINS", cors_origins);
    // ...
    let (mut rx, child) = sidecar.spawn().map_err(...)?;
}
```

**Pattern-to-add** — write token file before `.spawn()`:

```rust
// New helper above spawn:
fn ensure_local_token() -> Result<(), String> {
    use rand::RngCore;
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    let home = std::env::var("OTTIE_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            let mut p = dirs::home_dir().unwrap_or_default();
            p.push(".ottie");
            p
        });
    std::fs::create_dir_all(&home).map_err(|e| format!("create OTTIE_HOME: {e}"))?;
    let token_path = home.join("local-token");
    if token_path.exists() {
        return Ok(()); // do not regenerate — would invalidate paired clients
    }
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    let token = URL_SAFE_NO_PAD.encode(buf);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .create(true).write(true).truncate(true).mode(0o600)
            .open(&token_path).map_err(|e| format!("open token: {e}"))?;
        f.write_all(token.as_bytes()).map_err(|e| format!("write token: {e}"))?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(&token_path, &token).map_err(|e| format!("write token: {e}"))?;
        // Windows ACLs: planner may add a follow-up to restrict to current user.
    }
    Ok(())
}

// In spawn(), BEFORE the .spawn() call:
ensure_local_token()?;  // writes token before daemon reads it on boot
```

**Why `if exists() return Ok` and not regenerate** — per D-15: regeneration only on explicit user action ("Regenerate token" in Settings panel), otherwise paired clients break.

**Crate additions** — `rand`, `base64`, `dirs` (already available transitively in tauri ecosystem; planner verifies). Rust import discipline matches existing file: `use std::time::Duration;` at top.

---

### `packages/server/src/shared/messages.ts` (MODIFIED) — `RESERVED_FIELDS` + `@deprecated` annotations

**No close in-repo analog** — Ottie has not previously used a removal calendar. Pattern comes from research §4.3 verbatim.

**Pattern-to-add** at top of file (after the existing schema imports, before the first schema export):

```typescript
// ---------------------------------------------------------------------------
// Schema evolution discipline (ARCH-02 — see docs/SCHEMA_EVOLUTION.md ship Phase 5)
// Every deprecation MUST specify since= and removeAfter=. removeAfter is at
// least 6 minor releases from since. Once removed, the field name is added
// to RESERVED_FIELDS below and never reused.
// ---------------------------------------------------------------------------

/**
 * Field names removed from the schema and reserved forever (per ARCH-02 +
 * Protobuf-style "reserved" discipline). Adding a name here means: the wire
 * key is dead, but no future field may reuse the name with different meaning.
 */
export const RESERVED_FIELDS = {
  // Example shape — populated as fields complete their sunset window.
  // CreateAgentRequestMessage: ["legacyHostId"],
} as const satisfies Record<string, readonly string[]>;
```

**Annotation pattern for new deprecations** (apply to `chromeEnabled` per D-08):

```typescript
// In the relevant settings/flag schema fragment:
chromeEnabled: z
  .boolean()
  .optional()
  .describe("@deprecated since=v1.11 use=`chromeLayoutEnabled`+`keyboardShortcutsEnabled` removeAfter=v1.16"),
```

**Existing tolerated/dropped-fields precedent** — see `messages.attachments.test.ts` lines 30-50 (this file already passes future-shape attachments through `.parse()` and asserts they are dropped; same Zod machinery covers the deprecation path).

**Schema rule reminder** (from CLAUDE.md `WebSocket / Message Schema Rules`): new fields ALWAYS `.optional()` with sensible default or `.transform()` fallback. Never narrow optional → required.

---

### `packages/server/src/shared/messages.frozen-v1.{8,9,10}.test.ts` (NEW ×3) — frozen-fixture parse tests

**Analog:** `packages/server/src/shared/messages.attachments.test.ts` lines 1-50

**Imports pattern** (messages.attachments.test.ts:1-7):

```typescript
import { describe, expect, it } from "vitest";

import {
  CreateAgentRequestMessageSchema,
  CreateOttieWorktreeRequestSchema,
  SendAgentMessageRequestSchema,
} from "./messages.js";
```

**Core pattern** (messages.attachments.test.ts:9-50 — Zod parse asserting the schema tolerates a known-shape and drops unknown):

```typescript
describe("shared messages attachments", () => {
  it("keeps known attachments and drops unknown create-agent attachments", () => {
    const parsed = CreateAgentRequestMessageSchema.parse({
      type: "create_agent_request",
      requestId: "req-1",
      config: { provider: "codex", cwd: "/tmp/repo" },
      initialPrompt: "Review this PR",
      attachments: [
        { type: "github_pr" /* known fields */ },
        { type: "future_attachment", mimeType: "application/future", foo: "bar" },
      ],
    });
    expect(parsed.attachments).toEqual([
      { type: "github_pr" /* known fields */ },
      // future_attachment dropped
    ]);
  });
});
```

**Pattern-to-copy** — for each historical client schema (v1.8/v1.9/v1.10), the test fixture is a **frozen JSON payload** captured from that release. The test asserts:

1. Today's daemon-emitted shape (e.g. `agent_update`) parses cleanly under the v1.X schema (forward-compat: old client parses new daemon output).
2. A v1.X-shaped client request parses cleanly under today's schema (back-compat: new daemon accepts old client request).
3. Key derivations a v1.X client makes (e.g. `agent.title || "Untitled"`) still produce the same value class — per PITFALLS pitfall 3 "behavioral compatibility, not just type signature."

**File layout per fixture file:**

```typescript
// messages.frozen-v1.10.test.ts
import { describe, expect, it } from "vitest";
import {
  // current schemas
  AgentUpdateMessageSchema,
  CreateAgentRequestMessageSchema,
} from "./messages.js";

// FROZEN — do not edit. Snapshot of v1.10-shipped wire shapes.
const V1_10_AGENT_UPDATE_FIXTURE = {
  /* ... */
} as const;
const V1_10_CREATE_AGENT_FIXTURE = {
  /* ... */
} as const;

describe("v1.10 wire compatibility", () => {
  it("v1.10 daemon -> client agent_update parses with current schema", () => {
    const parsed = AgentUpdateMessageSchema.parse(V1_10_AGENT_UPDATE_FIXTURE);
    expect(parsed.type).toBe("agent_update");
  });
  it("v1.10 client -> daemon create_agent_request parses with current schema", () => {
    const parsed = CreateAgentRequestMessageSchema.parse(V1_10_CREATE_AGENT_FIXTURE);
    expect(parsed.type).toBe("create_agent_request");
  });
});
```

**CI-blocking** per D-02 — these tests are the primary defense for the carve.

---

### `packages/app/src/styles/tokens/primitives.ts` (NEW) — color/spacing/radius primitives

**Analog:** `packages/app/src/styles/theme.ts` lines 1-99 (`baseColors` block — already exactly the right shape)

**Existing pattern** (theme.ts:1-22):

```typescript
export const baseColors = {
  white: "#ffffff",
  black: "#000000",
  zinc: { 50: "#fafafa", 100: "#f4f4f5", /* ... */ 950: "#121214" },
  // ...
} as const;
```

**Pattern-to-copy** — lift the entire `baseColors` block into `tokens/primitives.ts`, rename to `palette`, and add spacing + radius scales (which currently live as inline `theme.spacing[N]` references — see theme.ts and consumers like `daemon-connection-dot.tsx` line 83):

```typescript
// tokens/primitives.ts
export const palette = {
  white: "#ffffff",
  black: "#000000",
  zinc: { 50: "#fafafa", /* ... */ 950: "#121214" },
  // ... all existing baseColors ...
} as const;

export const spacing = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16 /* ... */ } as const;
export const radius = { none: 0, sm: 4, md: 8, lg: 12, full: 9999 } as const;
```

**No primitives consumed by components directly** (per research §8.3 + PITFALLS pitfall 5 Polaris-v11 lesson). Components only consume `semantic.*`. Lint catches violations (warn-only this phase per D-10).

---

### `packages/app/src/styles/tokens/semantic.light.ts` + `semantic.dark.ts` (NEW) — semantic tokens

**Analog:** `packages/app/src/styles/theme.ts` lines 132-219 (`lightSemanticColors` block)

**Existing pattern** (theme.ts:132-150):

```typescript
const lightSemanticColors = {
  surface0: "#ffffff",
  surface1: "#fafafa",
  surface2: "#f4f4f5",
  // ...
  surfaceGlass: "rgba(255, 255, 255, 0.55)",
  surfaceGlassStrong: "rgba(255, 255, 255, 0.72)",
  borderGlass: "rgba(0, 0, 0, 0.06)",
  // ...
} as const;
```

**Pattern-to-copy** — lift verbatim, but **rewrite values to reference `palette.*`** (research §8.3 + PITFALLS pitfall 5: alias tokens reference primitives, never inline raw hex):

```typescript
// tokens/semantic.light.ts
import { palette } from "./primitives.js";

export const semanticLight = {
  surface: {
    background: palette.white,
    card: palette.zinc[50],
    elevated: palette.zinc[100],
    sidebar: palette.zinc[100],
    glass: {
      tint: "rgba(255, 255, 255, 0.55)",
      tintStrong: "rgba(255, 255, 255, 0.72)",
      border: "rgba(0, 0, 0, 0.06)",
    },
  },
  text: {
    primary: "#1a1a1e", // existing foreground
    muted: palette.zinc[500],
  },
  status: {
    success: "#15803d",
    danger: "#b91c1c",
    warning: "#d97706",
  },
  // ... (one entry per existing key in lightSemanticColors) ...
} as const;
```

**Critical:** the **shape** changes (nested namespaces) but **every existing key gets a 1:1 mapping**. Migrated files (glass-surface, daemon-connection-dot) reference `theme.surface.glass.tint` instead of `theme.colors.surfaceGlass`. Preserve every existing color value — Phase 1 is structural, NOT a visual redesign (PITFALLS pitfall 1).

**`semantic.dark.ts`** mirrors the same shape with the `darkSemanticColors` values from theme.ts.

---

### `packages/app/src/styles/tokens/component.ts` (NEW)

**Analog:** `packages/app/src/styles/theme.ts` (`borderRadius`, `iconSize`, `fontFamily` fragments — currently flat keys on theme)

**Pattern-to-copy:**

```typescript
// tokens/component.ts
import { radius } from "./primitives.js";

export const componentTokens = {
  glassCard: { radius: radius.lg, borderWidth: 1 },
  glassSheet: { radius: 16, borderWidth: 1 },
  glassPill: { radius: radius.full, borderWidth: 1 },
  button: { radius: radius.md, borderWidth: 0 },
  // pulled from theme.ts borderRadius keys: glassCard, glassSheet, glassPill, button
} as const;
```

Consumed by `glass-surface.tsx` line 39-45 instead of `theme.borderRadius.glassPill` etc.

---

### `packages/app/src/styles/tokens/motion.ts` (NEW) — lift from math-curve-loader/curves.ts

**Analog:** `packages/app/src/components/math-curve-loader/curves.ts` lines 173-262 (`CURVE_PRESETS`, `NATIVE_PARTICLE_BUDGET`, `NATIVE_PATH_STEPS`)

**Existing pattern** (curves.ts:173-184):

```typescript
export const CURVE_PRESETS: Record<CurveName, CurvePreset> = {
  "lemniscate-bloom": {
    name: "lemniscate-bloom",
    rotate: false,
    particleCount: 70,
    trailSpan: 0.4,
    durationMs: 5600,
    rotationDurationMs: 34000,
    pulseDurationMs: 5000,
    strokeWidth: 4.8,
    point: lemniscatePoint,
  },
  // ... 6 more presets ...
};
```

**Pattern-to-copy** — lift the **timing primitives** (`durationMs`, `rotationDurationMs`, `pulseDurationMs`) into `tokens/motion.ts` plus add the standard cubic-bezier curve set per research §8.6:

```typescript
// tokens/motion.ts
export const motion = {
  curves: {
    standard: "cubic-bezier(0.4, 0, 0.2, 1)",
    enter: "cubic-bezier(0.0, 0, 0.2, 1)",
    exit: "cubic-bezier(0.4, 0, 1, 1)",
  },
  durations: { fast: 120, normal: 200, slow: 320 },
  // Brand-distinctive math curves stay parametric — only their timing escapes.
  mathCurves: {
    lemniscateBloom: { durationMs: 5600, rotationDurationMs: 34000, pulseDurationMs: 5000 },
    spiralSearch: { durationMs: 7800, rotationDurationMs: 44000, pulseDurationMs: 6800 },
    roseThree: { durationMs: 5300, rotationDurationMs: 28000, pulseDurationMs: 4400 },
    // ... mirror for thinking-nine, cardioid-heart, butterfly-phase, lissajous-drift ...
  },
} as const;
```

**`curves.ts` keeps the parametric `point` functions** (lemniscatePoint, spiralSearchPoint, etc.) — those are math, not tokens. It re-exports `CURVE_PRESETS` but reads timing from `tokens/motion.ts`. File shrinks from 263 lines to ~150.

---

### `packages/app/src/styles/tokens/typography.ts` (NEW)

**Analog:** `packages/app/src/styles/theme.ts` `fontFamily`/`fontSize`/`lineHeight` fragments (consumed at e.g. daemon-connection-dot.tsx:89-90: `theme.fontFamily.system`, `theme.fontSize.xs`).

**Pattern-to-copy:**

```typescript
// tokens/typography.ts
export const typography = {
  fontFamily: {
    system: "...", // copy current value from theme.ts
    mono: "...",
  },
  fontSize: { xs: 11, sm: 13, base: 15, md: 17, lg: 20, xl: 24 },
  lineHeight: { tight: 1.2, normal: 1.4, relaxed: 1.6 },
  weight: { regular: "400", medium: "500", semibold: "600", bold: "700" },
} as const;
```

Lift verbatim from existing theme.ts.

---

### `packages/app/src/styles/theme.ts` (MODIFIED) — composition root

**Analog:** self (lines 1-716) + `packages/app/src/styles/unistyles.ts`

**Pattern-to-copy** (research §8.3 verbatim):

```typescript
// styles/theme.ts (after Phase 1)
import { palette, spacing, radius } from "./tokens/primitives.js";
import { semanticLight } from "./tokens/semantic.light.js";
import { semanticDark } from "./tokens/semantic.dark.js";
import { componentTokens } from "./tokens/component.js";
import { motion } from "./tokens/motion.js";
import { typography } from "./tokens/typography.js";

const sharedTokens = { palette, spacing, radius, components: componentTokens, motion, typography };

export const lightTheme = { ...sharedTokens, ...semanticLight, colorScheme: "light" as const };
export const darkTheme = { ...sharedTokens, ...semanticDark, colorScheme: "dark" as const };

// Existing dark variants (darkZinc, darkMidnight, darkClaude, darkGhostty) stay
// — they spread semanticDark and override a small set of keys. Same composition,
// new ingredients.
```

**`unistyles.ts` does not change** — it already does:

```typescript
StyleSheet.configure({ themes: { light: lightTheme, dark: darkTheme /* ... */ } });
```

The shape of `lightTheme` changes; the wiring does not (per D-11).

---

### `packages/app/src/components/ui/glass-surface.tsx` (MODIFIED) — semantic-token migration

**Analog:** self lines 47-64

**Existing pattern** (glass-surface.tsx:47-64):

```typescript
const baseStyle = useMemo<ViewStyle>(
  () => ({
    backgroundColor: strong ? theme.colors.surfaceGlassStrong : theme.colors.surfaceGlass,
    borderRadius: radiusValue,
    borderCurve: "continuous",
    borderWidth: bordered ? 1 : 0,
    borderColor: bordered ? theme.colors.borderGlass : "transparent",
    overflow: "hidden",
  }),
  [
    strong,
    theme.colors.surfaceGlass,
    theme.colors.surfaceGlassStrong,
    theme.colors.borderGlass,
    bordered,
    radiusValue,
  ],
);
```

**Pattern-to-rewrite:**

```typescript
const baseStyle = useMemo<ViewStyle>(
  () => ({
    backgroundColor: strong ? theme.surface.glass.tintStrong : theme.surface.glass.tint,
    borderRadius: radiusValue,
    borderCurve: "continuous",
    borderWidth: bordered ? 1 : 0,
    borderColor: bordered ? theme.surface.glass.border : "transparent",
    overflow: "hidden",
  }),
  [strong, theme.surface.glass, bordered, radiusValue],
);
```

Same visual output. Token paths point to the new semantic tree.

---

### `packages/app/src/components/daemon-connection-dot.tsx` (MODIFIED)

**Analog:** self lines 42-50 + 79-93

**Existing pattern** (daemon-connection-dot.tsx:42-50):

```typescript
if (status === "online") dotColor = theme.colors.palette.green[400];
else if (status === "connecting") dotColor = theme.colors.palette.amber[500];
else dotColor = theme.colors.palette.red[500];
```

**Pattern-to-rewrite:**

```typescript
if (status === "online")
  dotColor = theme.status.online; // green-400 from semantic
else if (status === "connecting")
  dotColor = theme.status.connecting; // amber-500
else dotColor = theme.status.offline; // red-500
```

Add `online`/`connecting`/`offline` keys under `semantic.{light,dark}.ts` `status:` namespace, referencing `palette.green[400]` / `palette.amber[500]` / `palette.red[500]`. Keeps the visual identical; removes the component's primitive-palette reach-through (per PITFALLS pitfall 5).

Same change at line 91 for `theme.colors.foregroundMuted` → `theme.text.muted`.

---

### `packages/app/src/components/message.tsx` (MODIFIED) — H13 chevron fix

**In-file analog** (message.tsx:404, 410):

```typescript
const isCompact = useIsCompactFormFactor();
const [messageHovered, setMessageHovered] = useState(false);
const [copyButtonHovered, setCopyButtonHovered] = useState(false);
const showCopyButton = hasText && (isCompact || messageHovered || copyButtonHovered);
```

This is the **canonical pattern** already in this file (PITFALLS "Looks Done But Isn't" verifies: this pattern works for copy button; chevron fails because it's missing the `isCompact` and `isNative` branches).

**Pattern-to-find-and-fix** — chevron visibility around line 2601+:

```typescript
const isActive = isHovered || isExpanded; // CURRENT — bug
```

**Pattern-to-rewrite:**

```typescript
import { isNative } from "@/constants/platform";
// ...
const isCompact = useIsCompactFormFactor();
const isActive = isHovered || isExpanded || isNative || isCompact;
```

**Canonical expression** (per CLAUDE.md "Hover only works on web"): `isHovered || isNative || isCompact`. The lint rule introduced this phase warns on any `isHovered`-alone visibility gate (per D-10, warn-only Phase 1 → error Phase 5).

---

### `packages/app/src/components/resize-handle.tsx` (MODIFIED) — C12 pointer events fix

**Analog:** `packages/app/src/components/toast-host.tsx` lines 257-258

**Existing safe pattern** (toast-host.tsx:257-258):

```typescript
onPointerEnter={isWeb ? pauseDismiss : undefined}
onPointerLeave={isWeb ? resumeDismiss : undefined}
```

**Existing buggy pattern** (resize-handle.tsx:138-148):

```typescript
return (
  <View style={handleStyle}>
    {highlighted && <View pointerEvents="none" style={highlightStyle} />}
    <View
      role="separator"
      aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
      style={hitAreaStyle}
      onPointerDown={handlePointerDown}
      onPointerEnter={handlePointerEnter}   // ← crashes on native iOS
      onPointerLeave={handlePointerLeave}   // ← crashes on native iOS
    />
  </View>
);
```

**Pattern-to-rewrite** (per CLAUDE.md "Prefer Metro file extensions over `if` statements" — this is a clean platform split):

Split into:

- `resize-handle.tsx` (shared logic, no pointer handlers)
- `resize-handle.web.tsx` (adds `onPointerEnter`/`onPointerLeave`)
- `resize-handle.native.tsx` (no-op or alternate gesture)

OR (lighter touch since the rest of the component is cross-platform):

```typescript
import { isWeb } from "@/constants/platform";
// ...
<View
  role="separator"
  // ...
  onPointerDown={handlePointerDown}
  onPointerEnter={isWeb ? handlePointerEnter : undefined}
  onPointerLeave={isWeb ? handlePointerLeave : undefined}
/>
```

The lint rule introduced this phase warns on `onPointerEnter`/`onPointerLeave` outside `.web.ts` files OR without an `isWeb ? : undefined` guard (per D-10). Same audit applies to `sidebar-workspace-list.tsx:1365-1488`, `terminal-emulator.tsx:740-741`, `web-desktop-scrollbar.tsx:416-417`, `tooltip.tsx:383-408`, `workspace-hover-card.tsx:183-184` — planner picks which are in scope for the C12 bug-fix bundle (CONTEXT.md `<deferred>` says "atomic-per-bug for clean blame"; the resize-handle is the cited regression — the others are warn-level coverage, not in-scope fixes).

---

### `packages/server/src/server/agent/providers/opencode-agent.ts` (MODIFIED) — H4 fix

**Analog:** `packages/server/src/server/agent/providers/claude-agent.ts` lines 1190-1206

**Existing buggy stub** (opencode-agent.ts:1171-1176):

```typescript
async listPersistedAgents(
  _options?: ListPersistedAgentsOptions,
): Promise<PersistedAgentDescriptor[]> {
  // TODO: Implement by listing sessions from OpenCode
  return [];
}
```

**Reference implementation** (claude-agent.ts:1190-1206 — the exact shape to copy):

```typescript
async listPersistedAgents(
  options?: ListPersistedAgentsOptions,
): Promise<PersistedAgentDescriptor[]> {
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  const projectsRoot = path.join(configDir, "projects");
  if (!(await pathExists(projectsRoot))) {
    return [];
  }
  const limit = options?.limit ?? 20;
  const candidates = await collectRecentClaudeSessions(projectsRoot, limit * 3);
  const parsed = await Promise.all(
    candidates.map((candidate) => parseClaudeSessionDescriptor(candidate.path, candidate.mtime)),
  );
  return parsed
    .filter((descriptor): descriptor is PersistedAgentDescriptor => descriptor !== null)
    .slice(0, limit);
}
```

**Pattern-to-copy:**

1. Resolve OpenCode session storage root. Per ARCHITECTURE.md table: OpenCode is "Provider-managed" — investigate `~/.opencode/sessions/` or whatever the OpenCode CLI persists to. **Planner action:** `grep` for OpenCode session-write code in `opencode-agent.ts` (around `OpenCodeServerManager`) and identify the directory.
2. Mirror Claude's `pathExists → collect → parse → filter → slice(limit)` pipeline.
3. Add file-local helpers `collectRecentOpenCodeSessions` + `parseOpenCodeSessionDescriptor` analogous to `collectRecentClaudeSessions` (claude-agent.ts:4355) and `parseClaudeSessionDescriptor` (claude-agent.ts:4446). Co-locate at the bottom of `opencode-agent.ts`, matching the Claude file's organization.
4. Keep `pathExists` — claude-agent.ts:4346 has the exact helper to mirror.

**Per PITFALLS Integration Gotchas row** ("OpenCode session resume → fail loudly if storage is missing"): if a `.jsonl` is malformed, log + skip that file; do not throw out of `listPersistedAgents` (matches Claude's `.filter(d => d !== null)` discipline).

**Test pattern:** `packages/server/src/server/agent/providers/codex-app-server-agent.spawn-error.test.ts:33-48` shows the existing `listPersistedAgents` failure-mode test shape; mirror for OpenCode.

---

### Flag store under `packages/app/src/stores/` — `chromeEnabled` split + first-launch migration

**Analog:** `packages/app/src/stores/draft-store.ts` lines 14, 38-83, 359-468 (Zustand `persist` middleware + version-numbered migration)

**Existing version + migration pattern** (draft-store.ts:14, 462-468):

```typescript
const DRAFT_STORE_VERSION = 4;
// ...
async function migratePersistedState(state: unknown): Promise<DraftStoreState> {
  // Reads previous version; transforms to current shape.
}
```

**Pattern-to-copy** for the chromeEnabled split (per D-05/06/07/08):

1. Find the existing flag store (planner: grep for `chromeEnabled` under `packages/app/src/stores/`; likely co-located with settings/labs hooks, possibly in `packages/app/src/hooks/use-settings.ts` or a dedicated store).
2. Add new flags `chromeLayoutEnabled` and `keyboardShortcutsEnabled` to the persisted shape.
3. Bump store version (`STORE_VERSION = N+1`).
4. Migration function reads the previous shape, copies `chromeEnabled` value into both new flags **on first read** (per D-06: zero behavior change for existing users):

```typescript
function migrate(persisted: PreviousShape): NewShape {
  const inherited = persisted.chromeEnabled ?? true; // current default
  return {
    ...persisted,
    chromeLayoutEnabled: persisted.chromeLayoutEnabled ?? inherited,
    keyboardShortcutsEnabled: persisted.keyboardShortcutsEnabled ?? inherited,
    // Leave chromeEnabled in storage; daemon stops sending it (D-08).
  };
}
```

5. Mark `chromeEnabled` as `@deprecated since=v1.11 removeAfter=v1.16` in any Zod schema that touches it (per D-08 — see "Shared Patterns / Schema Evolution" below).
6. New flags use the existing toggle UI patterns from `labs-section.tsx:154-159` (`SegmentedControl` with on/off).

---

### `packages/app/src/screens/settings/local-daemon-panel.tsx` (NEW)

**Analog:** `packages/app/src/screens/settings/labs-section.tsx` (entire file — same structure: `SettingsSection` + cards + `t(...)` i18n + `SegmentedControl`)

**Imports pattern** (labs-section.tsx:1-27):

```typescript
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { SegmentedControl } from "@/components/ui/segmented-control";
```

**Section shell pattern** (labs-section.tsx:118-141):

```typescript
return (
  <SettingsSection title={t("settings.localDaemon", { defaultValue: "Local daemon" })}>
    <View style={settingsStyles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderIcon}>
          <KeyRound size={theme.iconSize.md} color={theme.colors.foreground} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle}>
            {t("settings.localDaemon.title", { defaultValue: "Local token" })}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {t("settings.localDaemon.description", {
              defaultValue:
                "Required when other clients connect to this daemon. Auto-managed by the desktop app.",
            })}
          </Text>
        </View>
      </View>
      {/* rows: status, view-token, regenerate (D-13) */}
    </View>
  </SettingsSection>
);
```

**Row pattern** (labs-section.tsx:143-160 — hint + control row):

```typescript
<View style={settingsStyles.row}>
  <View style={settingsStyles.rowContent}>
    <Text style={settingsStyles.rowTitle}>{t(...)}</Text>
    <Text style={settingsStyles.rowHint}>{t(...)}</Text>
  </View>
  <Pressable onPress={...}>{/* "View" / "Regenerate" buttons */}</Pressable>
</View>
```

**Three rows required** (per D-13):

1. **Status row** — show one of: "Auto-generated", "Present", "Absent". Read from new daemon RPC (planner: add `get_local_token_status_request` to messages.ts following Schema Evolution discipline below) OR inspect `$OTTIE_HOME/local-token` via Tauri bridge if web-side. **Both paths require Phase 1 messaging additions per ARCH-02.**
2. **"View token" row** — Pressable that reveals the token on tap with a confirmation step. Uses the same `Pressable` + `useState` reveal pattern.
3. **"Regenerate token" row** — Pressable that triggers regeneration with a destructive-warning toast/alert ("Other clients will need re-pairing").

**Bilingual strings** (per CLAUDE.md hard rule): every `t()` call key MUST exist in BOTH `en.json` and `zh.json`. Plan against both files together.

**Hidden behind Advanced** (per D-13): planner integrates this section under the existing settings IA (do NOT shuffle the IA — that's Phase 4). The settings index decides which section is gated by an "Advanced" reveal toggle.

---

### `packages/app/src/i18n/locales/{en,zh}.json` (MODIFIED)

**Analog:** existing `settings.labs*` keys (en.json:129, plus the deeper `settings.labsVoice.*` namespace consumed by labs-section.tsx)

**Existing key shape** (en.json:105-140):

```json
"settings": {
  "title": "Settings",
  "labs": "Labs",
  // ...
}
```

**Pattern-to-add** — every visible string from the new local-daemon panel + auth-fail message + chromeEnabled split copy. Keys MUST exist in both files; CI parity check (already convention per PITFALLS UX row "Bilingual parity slips") catches missing zh.

Suggested namespace: `settings.localDaemon.*`. Auth-fail copy from D-14 lives under e.g. `errors.localTokenRequired` — body matches verbatim per D-14:

> "This daemon requires a local token. If you're on the same machine, find it at `$OTTIE_HOME/local-token`. See `$OTTIE_HOME/daemon.log` for details."

(zh translation by planner — bilingual rule allows planner discretion on phrasing per CONTEXT.md `<decisions> / Claude's Discretion`.)

---

### `SECURITY.md` (MODIFIED)

**No code analog.** Documentation-only change per D-16.

Per research §9.4 + ROADMAP Phase 1 success criterion #3, document:

1. **Mode A** (loopback-trust default) — current behavior, when it applies, residual risk on shared machines.
2. **Mode B** (token-file Tauri auto) — file path (`$OTTIE_HOME/local-token`), mode 0600, base64url 32 bytes, regeneration semantics (only on explicit user action; deleting the file forces regen on next daemon start).
3. **Mode C** (env-var explicit `OTTIE_LOCAL_TOKEN`) — for users binding 0.0.0.0 / non-loopback, container deployments.
4. **Threat-model delta** — what each mode protects against, what it does not (relay path is unchanged; this is purely the local-bind story).

---

## Shared Patterns

### Authentication / authorization

**Source:** new `packages/server/src/server/auth/local-token.ts`
**Apply to:** `packages/server/src/server/websocket-server.ts` only (single integration point — daemon has no other public endpoints)
**Mode A is the default** — no change for `npm run dev` / unbundled-daemon flows (preserves the "no UX regression" rule per research §9.4).

### Schema evolution discipline (ARCH-02)

**Source:** `packages/server/src/shared/messages.ts` — `RESERVED_FIELDS` export + `@deprecated since= use= removeAfter=` annotations on field `.describe()`.
**Apply to:** EVERY schema field touched in this phase. Specifically:

- `chromeEnabled` (per D-08) gets `@deprecated since=v1.11 removeAfter=v1.16`.
- Any new field added for the local-token-status RPC must be `.optional()` per CLAUDE.md.

**Behavioral compat test discipline** (per PITFALLS pitfall 3): EVERY schema PR in this phase must include a frozen-fixture test addition. Three fixture files (`messages.frozen-v1.{8,9,10}.test.ts`) land first; subsequent schema changes extend them.

### Error handling

**Source:** `packages/server/src/server/session.ts` lines 1647-1678 (the dispatchInboundMessage outer wrapper — emit `rpc_error` for requestId-bearing requests, always emit `activity_log`).
**Apply to:** new handler classes (PermissionHandler etc.) MUST receive an injected `emit` callback that they can use for the same `rpc_error` / `activity_log` envelope. Do not re-invent the error envelope per handler.

**Local-token errors:** fail closed and loudly per CONVENTIONS "Fail explicitly". File-system errors (other than ENOENT during initial probe) must throw, not silently degrade to Mode A.

### Platform gating (cross-cutting)

**Source:** `packages/app/src/constants/platform.ts` (lines 1-54 — the canonical `isWeb`/`isNative`/`getIsElectron`/`getIsElectronMac` exports). Never write `Platform.OS === "web"` locally.
**Apply to:** all bug-fix files (resize-handle.tsx, message.tsx, glass-surface.tsx). Hover-fallback canonical expression: `isHovered || isNative || isCompact` (per CLAUDE.md + docs/CODING_STANDARDS.md).

### Bilingual i18n

**Source:** `packages/app/src/i18n/locales/{en,zh}.json` — every `t("...")` key in new code must exist in BOTH files.
**Apply to:** local-daemon-panel.tsx, auth-fail handler copy, any new flag-toggle labels for chromeEnabled split.
**CI verification:** the existing zh-parity convention (per PITFALLS UX row) catches missing entries; planner ensures both files are added in the same commit (PITFALLS warning sign: "Strings being added to en.json / zh.json for new screens that weren't in the requirements").

### Token / file-mode discipline

**Source:** `packages/server/src/server/ottie-home.ts` (resolves `$OTTIE_HOME`, creates dir with `mkdirSync`).
**Apply to:** local-token.ts read/write, Tauri daemon.rs token-file generation. Mode `0o600` on POSIX; Windows path follows separately (no exact analog — research §9.4 references mode 0600; Windows ACL strategy planner-discretion per CONTEXT.md `<decisions>`).

### File organization (CONVENTIONS.md)

- `kebab-case.ts` for all new files (CONVENTIONS lines 122-128).
- No barrel `index.ts` re-exports — new `tokens/` directory has no `index.ts`; consumers import `@/styles/tokens/primitives`, `@/styles/tokens/semantic.light`, etc. directly.
- Co-locate tests with implementation: `local-token.ts` + `local-token.test.ts`. Frozen fixture tests live alongside `messages.ts` per existing pattern (`messages.attachments.test.ts`, `messages.workspaces.test.ts`).
- Platform-variant files use Metro `.web.tsx` / `.native.tsx` extensions (CONVENTIONS line 154; CLAUDE.md "Prefer Metro file extensions over `if` statements").

### Strangler-Fig flagging

**Source:** research §3.3 + §13 mitigation rows + CONTEXT D-01/D-04.
**Apply to:** every carve step (C-1, C-2, C-3) AND ARCH-03 non-loopback path (Mode B/C are off in Mode A).
**Naming:** `OTTIE_USE_NEW_ROUTER`, `OTTIE_USE_PERMISSION_HANDLER`, etc. — preserve research-§13 spelling for grep continuity per CONTEXT `<specifics>`. CI matrix runs flag-ON + flag-OFF (D-04).
**All flags removed in Phase 5 cleanup** — do not let them ossify.

---

## No Analog Found

Files with no close match in the codebase. Planner uses RESEARCH.md / CLAUDE.md / convention docs as the primary source.

| File                                         | Role             | Data Flow       | Reason                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ---------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/lint/hardcoded-color.ts` (or similar) | lint rule plugin | static analysis | No precedent in repo for custom oxlint/Biome rules. Research §8 + PITFALLS pitfall 5 specify behavior (warn on `#xxx`, `rgb()`, `rgba()` outside `tokens/` and `palette` files). Planner picks oxlint vs Biome plugin path. CI counter-test (per D-10 + research) needs a separate scaffold. |
| `tools/lint/is-hovered-alone.ts`             | lint rule plugin | static analysis | Same — no in-repo precedent. Pattern: detect any visibility gate using `isHovered` without `\|\| isNative` or `\|\| isCompact`. Warn-level Phase 1 (D-10), error Phase 5.                                                                                                                    |
| `tools/lint/pointer-events-web-only.ts`      | lint rule plugin | static analysis | Same — no in-repo precedent. Pattern: detect `onPointerEnter` / `onPointerLeave` JSX props OUTSIDE `*.web.ts(x)` files AND not gated by `isWeb ? : undefined`. Warn-level Phase 1. The `toast-host.tsx:257-258` pattern is the canonical safe shape the rule should accept.                  |
| `tools/lint/deprecated-annotation.ts`        | lint rule plugin | static analysis | Same — pattern from research §4.3 step 5: any `@deprecated` in `messages.ts` `.describe()` without both `since=` and `removeAfter=` warns. Warn-level Phase 1.                                                                                                                               |

For all four lint rules: warn-only this phase per D-10 / D-11; **counter-test** ensures the warn count never increases (CI fails if introducing new violations on touched files). Planner decides oxlint plugin vs custom AST script.

---

## Metadata

**Analog search scope:**

- `packages/server/src/server/` — session.ts, websocket-server.ts, ottie-home.ts, agent/providers/{claude,opencode,codex,acp,mock-load-test}-agent.ts
- `packages/server/src/shared/` — messages.ts + all `messages.*.test.ts` fixtures
- `packages/app/src/styles/` — theme.ts, unistyles.ts, settings.ts
- `packages/app/src/components/` — ui/glass-surface.tsx, daemon-connection-dot.tsx, message.tsx, resize-handle.tsx, toast-host.tsx (positive analog), math-curve-loader/curves.ts
- `packages/app/src/screens/settings/` — labs-section.tsx, settings-section.tsx
- `packages/app/src/stores/` — draft-store.ts, keyboard-shortcuts-store.ts
- `packages/app/src/constants/` — platform.ts
- `packages/app/src/i18n/locales/` — en.json, zh.json
- `packages/desktop/src-tauri/src/` — daemon.rs, bridge.rs, main.rs

**Files scanned:** ~30 source files, 3 planning docs, 4 codebase docs.

**Pattern extraction date:** 2026-04-30

**Cross-references for planner:**

- Decisions D-01..D-16 in `01-CONTEXT.md` are the source of truth for choice points.
- Research §3 (carve), §4 (schema), §8 (theme), §9 (auth), §13 (risks) hold the design rationale.
- PITFALLS pitfalls 2 (carve), 3 (schema), 5 (theme retrofit), 8 (cross-platform regression), 9 (carve coupling) apply directly — planner cites them as guardrails.
- CONCERNS H2 (auth), H3 (session.ts), H4 (OpenCode), H7 (shims), H13 (chevron), C11 (chromeEnabled), C12 (pointer events) are the in-scope concerns being closed.
