---
phase: 01-architectural-foundations-gating-bug-fixes
plan: 05
subsystem: auth
tags: [arch-03, local-token, websocket, tauri, settings, i18n, security]

# Dependency graph
requires:
  - phase: 01
    provides:
      [
        "Plan 01-01 schema-evolution discipline (RESERVED_FIELDS, frozen-fixture v1.8/v1.9/v1.10)",
        "Plan 01-04 MessageRouter / session/router.ts strangler-fig carve",
      ]
provides:
  - "Three-mode local-daemon auth: Mode A loopback-trust (default, npm run dev preserved), Mode B Tauri token-file ($OTTIE_HOME/local-token mode 0o600 + write-before-spawn), Mode C OTTIE_LOCAL_TOKEN env"
  - "WS bearer-token gate in verifyWsClient with HTTP 401 + WWW-Authenticate: Bearer realm=\"ottie-local\" + authRejected runtime counter"
  - "Pino redaction (T-05-03 mitigation): headers.authorization / *.authorization / *.token / *.OTTIE_LOCAL_TOKEN censored to [REDACTED]"
  - "LocalTokenService class + registerLocalTokenHandlers helper — self-contained server-side wiring; session.ts surface delta is +12 lines (4 for the registration + 8 for SessionOptions.localTokenMode field)"
  - "Four NEW v1.11 WS schemas: LocalTokenStatus{Request,Response} + LocalTokenRegenerate{Request,Response}; all .optional() fields; payload-nested response shape matching the codebase's correlated-response convention"
  - "messages.frozen-v1.11.test.ts pinning the v1.11 wire shape; messages.frozen-v1.10.test.ts gains an additive-confirmation assertion"
  - "DaemonClient.getLocalTokenStatus() + regenerateLocalToken() RPC methods"
  - "Settings → Local daemon panel (D-13) — three rows (status / locate / regenerate); bilingual en+zh; semantic theme tokens only"
  - "SECURITY.md three-mode threat-model documentation (D-16)"
affects:
  [
    "phase-04 settings-IA-reorg",
    "phase-05 lint-promotions",
    "phase-05 schema-evolution-doc",
    "phase-05 windows-acl-hardening",
    "phase-05 mode-a-non-loopback-fail-loud",
  ]

# Tech tracking
tech-stack:
  added:
    [
      "rand=0.8 (Tauri Cargo.toml)",
      "base64=0.22 (Tauri Cargo.toml)",
      "dirs=5 (Tauri Cargo.toml)",
    ]
  patterns:
    [
      "Three-mode auth resolution at daemon bootstrap with constant-time bearer compare via crypto.timingSafeEqual",
      "Token-on-disk pattern (mode 0o600) mirroring daemon-keypair.ts:63",
      "Self-contained registerXyzHandlers helpers for new RPC kinds — minimizes session.ts surface area (Plan 01-04 router as registration target)",
      "Frozen-fixture parity at every version crossing (v1.8 → v1.9 → v1.10 → v1.11) — D-02 invariant",
      "Pino redact paths config for sensitive fields",
    ]

key-files:
  created:
    [
      "packages/server/src/server/auth/local-token.ts",
      "packages/server/src/server/auth/local-token.test.ts",
      "packages/server/src/server/auth/local-token-service.ts",
      "packages/server/src/server/auth/local-token-service.test.ts",
      "packages/server/src/shared/messages.frozen-v1.11.test.ts",
      "packages/app/src/screens/settings/local-daemon-panel.tsx",
    ]
  modified:
    [
      "packages/server/src/server/websocket-server.ts",
      "packages/server/src/server/bootstrap.ts",
      "packages/server/src/server/logger.ts",
      "packages/server/src/server/session.ts",
      "packages/server/src/shared/messages.ts",
      "packages/server/src/shared/messages.frozen-v1.10.test.ts",
      "packages/server/src/client/daemon-client.ts",
      "packages/desktop/src-tauri/src/daemon.rs",
      "packages/desktop/src-tauri/Cargo.toml",
      "packages/desktop/src-tauri/Cargo.lock",
      "packages/app/src/screens/settings-screen.tsx",
      "packages/app/src/utils/host-routes.ts",
      "packages/app/src/i18n/locales/en.json",
      "packages/app/src/i18n/locales/zh.json",
      "SECURITY.md",
      ".planning/phases/01-architectural-foundations-gating-bug-fixes/session-ts-baseline.txt",
      ".planning/phases/01-architectural-foundations-gating-bug-fixes/deferred-items.md",
    ]

key-decisions:
  - "Mode A is the default (preserves npm run dev behavior); the WS server constructor takes localTokenMode with a default of {kind:\"loopback-trust\"} so existing tests / non-bootstrap call sites keep working unchanged."
  - "Token VALUE never crosses the WS — only status. The View Token row in the panel surfaces a guidance Alert pointing at $OTTIE_HOME/local-token (with a Copy button for the path), not a Tauri-bridge file-read implementation. Tauri-bridge token-read is deferred — users locate the file directly."
  - "v1.11 RPC response schemas use the payload-nested {payload: {requestId, ...}} convention matching the rest of the daemon's correlated-response messages. This integrates with sendCorrelatedSessionRequest / DaemonClient unchanged."
  - "Pino redaction lives in the central createRootLogger in packages/server/src/server/logger.ts:287 — modifying this single export covers every child logger in the daemon (Phase 5 documentation should cite this file as the canonical logger)."
  - "Cargo.toml pinned versions: rand=0.8, base64=0.22, dirs=5 (chosen against the existing toolchain; cargo check passes with these). Phase 5 should audit Cargo.lock for transitive churn."
  - "session-ts-baseline.txt bumped 9585 → 9597 (net +12) with documented justification: 4 lines for the ONE-line registration scaffolding + 8 lines for the JSDoc-annotated optional `localTokenMode` field on SessionOptions and the destructuring extraction. Documented exception per Plan 01-05 task 2b instructions; future Phase 3/5 carves resume the shrinkage discipline from this new baseline."
  - "Settings panel is surfaced as a new SETTINGS_SECTION_SLUG `localDaemon` placed between `labs` and `diagnostics`. Phase 4 (SET-01) will fold this into the planned Account/Agents/Voice/Appearance/Advanced IA reorganization."

patterns-established:
  - "Three-mode auth: a bootstrap-resolved discriminated-union mode (loopback-trust | token-file | explicit) injected into the WS server constructor; gate at WS upgrade with constant-time compare; Mode A short-circuits."
  - "registerXyzHandlers self-contained helpers: new RPC kinds wire onto MessageRouter via a single helper invocation in session.ts (one import + one call). Independently testable in isolation against a fresh router."
  - "Frozen-fixture pinning at v1.11 ship time: `// FROZEN — do not edit.` markers on every fixture, multiple fixtures per kind covering optional-field-omitted forward-compat."

requirements-completed: [ARCH-03]

# Metrics
duration: 1h 20m
completed: 2026-05-01
---

# Phase 1 Plan 5: Three-Mode Local-Daemon Auth (ARCH-03) Summary

**Three-mode local-daemon-auth (Mode A loopback-trust default / Mode B Tauri token-file / Mode C OTTIE_LOCAL_TOKEN env) with WS bearer gate, pino redaction, four new v1.11 RPC schemas, Settings panel (bilingual en+zh), and SECURITY.md threat-model documentation. Checkpoint reached for the manual three-mode boot test.**

## Performance

- **Duration:** ~1h 20m (Tasks 1, 2a, 2b, 2c, 3 implementation + verification)
- **Started:** 2026-05-01T01:00:00Z (approx — cargo check + worktree setup)
- **Reached checkpoint:** 2026-05-01T02:21:00Z
- **Tasks (auto):** 5 (Task 1, Task 2a, Task 2b, Task 2c, Task 3) — committed atomically; checkpoint Task 5 awaits user verification
- **Files created:** 6 (3 server source + 1 server test + 1 frozen-fixture test + 1 app component)
- **Files modified:** 17 (across server, desktop, app, docs, planning)

## Accomplishments

- **Mode A preserved (default).** `npm run dev` flow continues to work without any auth — the WS upgrade gate short-circuits accept when `localTokenMode.kind === "loopback-trust"`. WS server constructor's new `localTokenMode` parameter has a `{kind:"loopback-trust"}` default, so all existing test instantiations + non-bootstrap call sites keep working without changes.
- **Mode B (Tauri-bundled).** `ensure_local_token()` writes `$OTTIE_HOME/local-token` (POSIX mode 0o600, base64url 32 bytes) **before** `.spawn()` returns — D-15's race-free-by-construction property holds. Idempotent: an existing file is never overwritten (which would invalidate paired clients silently). Cargo deps `rand=0.8`, `base64=0.22`, `dirs=5` added; `cargo check` clean.
- **Mode C (env-var explicit).** `OTTIE_LOCAL_TOKEN` env at daemon start activates the bearer-token gate. Resolution precedence at bootstrap: env > file > loopback-trust.
- **WS bearer gate.** `verifyWsClient` consults `this.localTokenMode` BEFORE the existing host/origin checks. Mode B/C: missing/invalid bearer → HTTP 401 + `WWW-Authenticate: Bearer realm="ottie-local"` + `authRejected` counter increment. Constant-time compare via `crypto.timingSafeEqual` with equal-length-buffer guard (T-05-07 mitigated).
- **Pino redaction (T-05-03 mitigation).** `createRootLogger` in `packages/server/src/server/logger.ts:287` gains `redact: { paths: ["headers.authorization", "*.authorization", "*.token", "*.OTTIE_LOCAL_TOKEN"], censor: "[REDACTED]" }` — covers every child logger (one canonical config).
- **Server-side wiring (LocalTokenService + registerLocalTokenHandlers).** `LocalTokenService.getStatus()` returns `{mode, tokenPresent}` (token VALUE never crosses WS — T-05-08). `regenerate()` writes via `generateAndWriteLocalToken` and re-resolves the mode. `registerLocalTokenHandlers(router, service, emit)` wires the two inbound kinds onto the router via Plan 01-04's MessageRouter. session.ts gains exactly 4 surgical lines (1 import + 1 typed import + 1 field declaration + 1 destructure entry + 2 constructor lines after the existing `OTTIE_USE_PERMISSION_HANDLER` registration), plus 8 lines for the optional `localTokenMode` field on `SessionOptions` (with JSDoc).
- **Schema additions (D-02 invariant + CLAUDE.md hard rule).** Four new v1.11 schemas in `messages.ts`: `LocalTokenStatusRequestSchema`, `LocalTokenStatusResponseSchema`, `LocalTokenRegenerateRequestSchema`, `LocalTokenRegenerateResponseSchema`. All NEW fields beyond `requestId` are `.optional()`. Response schemas use `payload: { requestId, ... }` to match the codebase's correlated-response convention.
- **Frozen-fixture parity.** `messages.frozen-v1.11.test.ts` (NEW) pins eight v1.11 wire-shape fixtures including the optional-field-omitted forward-compat case. `messages.frozen-v1.10.test.ts` gets an additive-confirmation assertion that the v1.11 additions don't break v1.10 fixture parses.
- **DaemonClient methods.** `getLocalTokenStatus()` and `regenerateLocalToken()` added to `packages/server/src/client/daemon-client.ts` — both use the existing `sendCorrelatedSessionRequest` correlation infrastructure unchanged. Cast at `sendCorrelatedRequest:1269` widened to `as unknown as TResult` because TS now sees the broader `CorrelatedResponseMessage` union (Rule 3 auto-fix; semantically equivalent).
- **Settings → Local daemon panel (D-13).** Mirrors `labs-section.tsx` structure exactly. Three rows: status / locate token / regenerate. Bilingual en+zh strings (parity-verified). Semantic theme tokens only (zero hardcoded colors). `useMemo` for stable composite-style references (satisfies `eslint-plugin-react-perf jsx-no-new-array-as-prop`). Panel routed via the new `localDaemon` slug between `labs` and `diagnostics`.
- **SECURITY.md (D-16).** New `## Local daemon authentication` section with subsections for Modes A/B/C, the auth-fail handler (HTTP 401 + WWW-Authenticate + D-14 user-facing copy + pino redaction note), and a threat-model delta enumerating exactly what each mode protects against vs. does not. Cross-reference footer points at the implementation files. The pre-existing `## Relay threat model` section is untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1 — local-token utility + WS bearer-token gate + log redaction** — `ff33bee7` (feat)
2. **Task 2a — Tauri ensure_local_token write-before-spawn** — `40e97939` (feat)
3. **Task 2b — LocalTokenService + v1.11 schemas + frozen-fixture parity** — `700b4ed6` (feat)
4. **Task 2b refinement — payload-nested v1.11 responses + DaemonClient methods** — `4912c81e` (fix)
5. **Task 2c — Settings → Local daemon panel + bilingual en+zh strings** — `0f823e6a` (feat)
6. **Task 3 — SECURITY.md three-mode local-daemon auth** — `baf63cde` (docs)

**Plan metadata commit:** TBD (added by orchestrator after checkpoint resumes — final commit will include this SUMMARY.md + STATE.md + ROADMAP.md updates).

## Files Created/Modified

### Server (packages/server)

- `src/server/auth/local-token.ts` (NEW) — `LocalTokenMode` type + `resolveLocalTokenMode` + `generateAndWriteLocalToken` + `verifyBearerToken` (constant-time compare).
- `src/server/auth/local-token.test.ts` (NEW) — 18 tests covering all three modes, mode 0o600 POSIX assertion, fail-closed on non-ENOENT fs errors.
- `src/server/auth/local-token-service.ts` (NEW) — `LocalTokenService` class (getStatus / regenerate) + `registerLocalTokenHandlers` helper.
- `src/server/auth/local-token-service.test.ts` (NEW) — 11 tests covering getStatus all modes, regenerate happy + error paths, registerLocalTokenHandlers wiring.
- `src/server/websocket-server.ts` — bearer gate at top of `verifyWsClient`; `authRejected` counter; `localTokenMode` field + constructor parameter (default Mode A); passes mode through to `Session`.
- `src/server/bootstrap.ts` — resolves `localTokenMode` ONCE at daemon bootstrap (before WS server construction); logs the resolved mode; passes it to the WS server.
- `src/server/logger.ts` — pino `redact` config in `createRootLogger`.
- `src/server/session.ts` — adds `import { LocalTokenService, registerLocalTokenHandlers }`; `import type { LocalTokenMode }`; `private readonly localTokenService: LocalTokenService` field; `localTokenMode?` on `SessionOptions`; destructures + wires in constructor (2 lines after the existing `OTTIE_USE_PERMISSION_HANDLER` block).
- `src/shared/messages.ts` — four new v1.11 schemas + discriminator additions.
- `src/shared/messages.frozen-v1.10.test.ts` — additive-confirmation assertion (per checker B6).
- `src/shared/messages.frozen-v1.11.test.ts` (NEW) — 8 tests pinning v1.11 wire shapes.
- `src/client/daemon-client.ts` — `getLocalTokenStatus()` + `regenerateLocalToken()` methods; cast widened at `sendCorrelatedRequest:1269` to `as unknown as TResult`.

### Desktop (packages/desktop)

- `src-tauri/src/daemon.rs` — `ensure_local_token()` helper; invoked as the FIRST line of `spawn()` body.
- `src-tauri/Cargo.toml` — adds `rand=0.8`, `base64=0.22`, `dirs=5` under `[dependencies]`.
- `src-tauri/Cargo.lock` — auto-updated with the new dep tree.

### App (packages/app)

- `src/screens/settings/local-daemon-panel.tsx` (NEW) — three-row Settings panel.
- `src/screens/settings-screen.tsx` — registers the new `localDaemon` sidebar item + render case; adds `Lock` icon import.
- `src/utils/host-routes.ts` — adds `"localDaemon"` to `SETTINGS_SECTION_SLUGS`.
- `src/i18n/locales/en.json` — `settings.localDaemon.*` namespace + `errors.localTokenRequired` (D-14 copy verbatim).
- `src/i18n/locales/zh.json` — parallel zh translations (parity-verified).

### Docs

- `SECURITY.md` — new `## Local daemon authentication` section.
- `.planning/phases/01-architectural-foundations-gating-bug-fixes/session-ts-baseline.txt` — bumped 9585 → 9597 with the documented justification.
- `.planning/phases/01-architectural-foundations-gating-bug-fixes/deferred-items.md` — logged the pre-existing `eslint(complexity)` warning on `session.ts:2018`.
- `.planning/phases/01-architectural-foundations-gating-bug-fixes/01-05-SUMMARY.md` (THIS file).

## Decisions Made

See `key-decisions` in the frontmatter above. Key call-outs:

- **Token-on-disk vs. token-on-WS for the View row:** went with the on-disk guidance (Alert + Copy button for the path string) rather than implementing a Tauri-bridge file-read. Rationale: keeps the v1.11 surface minimal and avoids introducing another bridge command before SET-01 (Phase 4) reorganizes Settings. Users who want to inspect the token open `$OTTIE_HOME/local-token` directly, which works on every platform without any Tauri-bridge plumbing. The Tauri bridge can be added in a future polish without changing the schema.
- **payload-nested v1.11 response shape:** chose to nest `requestId` etc. under `payload` (matching the existing `Extract<SessionOutboundMessage, { payload: { requestId: string } }>` shape) rather than introducing a flat-shape compatibility branch in `CorrelatedResponseMessage`. This integrates with `sendCorrelatedSessionRequest` and `DaemonClient` unchanged.
- **Pino redaction location:** modified the single canonical `createRootLogger` in `packages/server/src/server/logger.ts:287`. All child loggers inherit. Phase 5's documentation should cite this file as the central logger config.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] payload-nested v1.11 response schemas + cast widening at `sendCorrelatedRequest:1269`**

- **Found during:** Task 2c (Settings panel integration with `DaemonClient.getLocalTokenStatus`).
- **Issue:** Plan's `<interfaces>` defined the v1.11 response schemas with `requestId` at the top level (flat shape). Integrating with the existing `sendCorrelatedSessionRequest` infrastructure required matching the codebase's `payload: { requestId, ... }` convention used by every other correlated response in `CorrelatedResponseMessage`. Without this, the existing `correlated.payload as unknown as CorrelatedResponsePayload<TResponseType>` cast would not extract anything from the new responses.
  Additionally: adding the new types to the discriminated union widened `CorrelatedResponseMessage`, which made the existing `return payload as TResult` cast at line 1269 fail TypeScript's structural-overlap check (TS error TS2352).
- **Fix:** Restructured the four response schemas to use `payload: z.object({ requestId, ... })`. Updated `local-token-service.ts` to emit messages with the nested shape. Updated `local-token-service.test.ts` and `messages.frozen-v1.{10,11}.test.ts` fixtures + assertions to match. Widened the line-1269 cast to `as unknown as TResult` (semantically equivalent; TS now satisfied). Verified pre-existing typecheck passes with my changes stashed (the cast was working with the older union shape).
- **Files modified:** `packages/server/src/shared/messages.ts`, `packages/server/src/server/auth/local-token-service.ts`, `packages/server/src/server/auth/local-token-service.test.ts`, `packages/server/src/shared/messages.frozen-v1.11.test.ts`, `packages/server/src/shared/messages.frozen-v1.10.test.ts`, `packages/server/src/client/daemon-client.ts`.
- **Verification:** `pnpm --filter @ottie/server typecheck` clean; `npx vitest run` (auth/local-token + auth/local-token-service + frozen-v1.10/11) → 42/42 green.
- **Committed in:** `4912c81e` (separate fix commit between Task 2b and Task 2c).

**2. [Rule 3 - Blocking] Stub Tauri sidecar binary for `cargo check`**

- **Found during:** Task 2a (`cargo check --manifest-path src-tauri/Cargo.toml`).
- **Issue:** The Tauri build script verifies the sidecar binary exists at `binaries/ottie-daemon-aarch64-apple-darwin` before any Rust code is compiled. The binary isn't shipped in the worktree (build artifact), so `cargo check` fails before reaching my `ensure_local_token` code.
- **Fix:** Created an empty stub at `binaries/ottie-daemon-aarch64-apple-darwin` and an empty `binaries/resources/` directory to satisfy the build script. Both paths are in `packages/desktop/.gitignore`, so they are NOT committed (verified via `git check-ignore`).
- **Files modified:** None tracked. Workaround only — pure tooling artifact.
- **Verification:** `cargo check` then exits 0 with "Finished `dev` profile (unoptimized + debuginfo) target(s) in 1.11s" — confirming my Rust code compiles cleanly.
- **Committed in:** N/A (untracked stub files).

**3. [Out-of-scope discovery] Pre-existing `eslint(complexity)` warning on session.ts:2018**

- **Found during:** Task 2b lint pass on session.ts.
- **Issue:** `dispatchChatScheduleLoopMessage` has cyclomatic complexity 23, exceeding the `eslint(complexity)` rule's default of 20. NOT introduced by my changes — verified by stashing my work and re-running `npm run lint -- packages/server/src/server/session.ts` (same single error remains). Pre-existed at the worktree base.
- **Fix:** None. Logged to `.planning/phases/01-architectural-foundations-gating-bug-fixes/deferred-items.md` for future Phase 3/5 carve continuation. Out of scope per executor scope boundary ("only auto-fix issues DIRECTLY caused by the current task's changes").
- **Files modified:** `.planning/phases/01-architectural-foundations-gating-bug-fixes/deferred-items.md` (logged the discovery only).
- **Committed in:** `700b4ed6` (Task 2b commit, alongside the deferred-items.md update).

**4. [Rule 1 - Bug] eslint-plugin-react-perf inline-array warning on the panel's error-text style**

- **Found during:** Task 2c lint pass on the new Settings panel.
- **Issue:** `<Text style={[settingsStyles.rowHint, styles.errorText]}>` allocates a fresh array on every render, triggering `eslint-plugin-react-perf(jsx-no-new-array-as-prop)`.
- **Fix:** Wrapped the composite style in `useMemo(() => [settingsStyles.rowHint, styles.errorText], [])` inside the component, mirroring the existing labs-section.tsx pattern (its `lineStyle` memoization on lines 393-398). Added `useMemo` to the React imports.
- **Files modified:** `packages/app/src/screens/settings/local-daemon-panel.tsx`.
- **Verification:** `npm run lint -- packages/app/src/screens/settings/local-daemon-panel.tsx` → 0 warnings, 0 errors.
- **Committed in:** `0f823e6a` (Task 2c commit).

---

**Total deviations:** 4 — all addressed in-task. Two Rule 1 (bug — payload nesting + lint), one Rule 3 (blocking — sidecar stub for cargo check), one out-of-scope discovery logged to deferred-items.

**Impact on plan:** None of these are scope creep. The payload-nesting deviation is a correctness fix that integrates the new schemas with the codebase's existing correlation infrastructure (Plan 01-05 explicitly anticipated this with the `CorrelatedResponseMessage` analog discussion in `<interfaces>`). The `cargo check` stub is a tooling workaround, not a code change. The lint fix follows the existing labs-section.tsx pattern verbatim. The session.ts complexity warning is pre-existing and out of scope.

## Issues Encountered

- **Worktree had no `node_modules`.** Symlinked the parent checkout's `node_modules` (root + per-package) so `pnpm --filter ... typecheck`, `npm run lint`, and vitest could run inside the worktree. Symlinks are not committed (gitignored). Same workaround Plan 01-03 documented for the worktree-vitest constraint.
- **Manual three-mode boot test deferred to checkpoint.** Per the plan's `<task type="checkpoint:human-verify">`, the actual three-mode runtime verification (Mode A `npm run dev` preservation; Mode C `OTTIE_LOCAL_TOKEN` 401 round-trip; Mode B Tauri token-file mode 0o600 stat; auth-fail copy bilingual; pino-redaction grep-clean) requires the user to manually exercise the daemon in three configurations. The executor cannot start the daemon on `:6868` without permission per CLAUDE.md, so the boot test falls to the user. See `<checkpoint_state>` below for the structured pause.

## Checkpoint State

The plan ends with `Task 5 (CHECKPOINT)` — `checkpoint:human-verify`, blocking. **Tasks 1–3 are complete and committed atomically; the manual three-mode boot test + auth-fail copy verification + pino-redaction grep-clean awaits user execution.**

Per the plan's `<how-to-verify>`:

1. **Mode A — `npm run dev` preservation.** Start the daemon with no `OTTIE_LOCAL_TOKEN` and no `$OTTIE_HOME/local-token`; confirm the app connects without auth prompts. Verify `daemon.log` shows `mode=loopback-trust` at the bootstrap-time log line.
2. **Mode C — `OTTIE_LOCAL_TOKEN` env path.** Start the daemon with `OTTIE_LOCAL_TOKEN=test-32bytes-replaceme-xxxxxxxxxxx`. Without the bearer header, attempt to upgrade — expect HTTP 401 + `WWW-Authenticate: Bearer realm="ottie-local"`. With the matching bearer, expect 101. Verify the daemon log shows `mode=explicit` and the rejection log carries `[REDACTED]` instead of the literal token.
3. **Mode B — Tauri-bundled (if a desktop build is feasible).** Build the desktop app and confirm `$OTTIE_HOME/local-token` exists with mode 0600 (`stat -f '%Lp'` returns `600` on POSIX). Open Settings → Local daemon panel; confirm Status row reads "Token present" (English) / "令牌存在" (Chinese after locale switch).
4. **Auth-fail bilingual copy.** Force a Mode C scenario with the wrong client token; confirm the surfaced error references `$OTTIE_HOME/local-token` and `$OTTIE_HOME/daemon.log` in BOTH en and zh locales (D-14 copy keys: `errors.localTokenRequired`).
5. **Pino-redaction verification.** `grep -F "<the-literal-token-value>" $OTTIE_HOME/daemon.log` → must return ZERO matches.

The orchestrator surfaces these to the user, gets approval ("approved") or failure descriptions, and spawns a continuation agent to either (a) close the plan with a final metadata commit + STATE/ROADMAP updates if approved, or (b) revise per the failure description.

## Pointers For Future Phases

### Phase 4 (SET-01) — Settings IA reorganization

The new panel is currently registered as a top-level `localDaemon` section slug between `labs` and `diagnostics`. When Phase 4 reorganizes Settings into Account/Agents/Voice/Appearance/**Advanced**, the panel naturally folds into Advanced (per D-13 — "Settings → Advanced → Local daemon"). The component is self-contained (`<LocalDaemonPanel />`), so Phase 4 only needs to (a) drop the `localDaemon` slug, (b) re-render `<LocalDaemonPanel />` from the new Advanced container.

### Phase 5 (security baseline upgrades + lint promotions + schema-evolution doc)

- **Mode A non-loopback bind fail-loud (T-05-04).** Today, a daemon binding `0.0.0.0` in Mode A is a misconfiguration but only logs a warning. Phase 5 should promote this to a fail-loud configuration error at daemon startup if `boundListenTarget.host` is non-loopback and `localTokenMode.kind === "loopback-trust"`. The bootstrap logging hook is already in place at `bootstrap.ts:780+` (where `boundListenTarget` is resolved alongside `localTokenMode`).
- **Windows ACL hardening (T-05-01).** `daemon.rs:ensure_local_token` falls back to `std::fs::write` on non-Unix targets under default user-profile permissions. Phase 5 should add a Windows-specific ACL restriction (`SetSecurityInfo` with a DACL granting only the current SID) to bring Windows up to Mode B's same-OS-user threat model floor.
- **Mode C env-var rotation guidance (T-05-09 mitigation upgrade).** Today's user-facing copy doesn't tell admins how to rotate Mode C tokens — they must restart the daemon. Phase 5 should consider an in-process rotation path (re-resolve mode on SIGHUP, or expose a CLI command via `ottie daemon rotate-token`).
- **Lint promotions.** This plan respects the warn-level baselines (hardcoded-color 591, isHovered-alone 6, pointer-events 10). Phase 5 promotes these to error-level. The new files I introduced add ZERO new violations to any baseline.
- **Schema-evolution doc (`docs/SCHEMA_EVOLUTION.md`).** When written, it should cite this plan as the canonical example of "v1.11 additive schema landing without breaking v1.10": the v1.10 frozen fixtures continued to parse, the v1.11 `.optional()` discipline was followed, and the additive-confirmation assertion in v1.10's test file documents the cross-version sanity check.

### Phase 4-prep / Plan 5-future-frozen-fixture additions

When v1.12 ships, every NEW field added to any of the four v1.11 schemas must:

1. Be `.optional()` per CLAUDE.md.
2. Pin the v1.11-shipped shape in `messages.frozen-v1.11.test.ts` (don't edit existing fixtures; add new `it(...)` blocks if needed).
3. Add a new `messages.frozen-v1.12.test.ts` for the v1.12 wire shapes.
4. Add an additive-confirmation assertion to `messages.frozen-v1.11.test.ts` (mirroring the one this plan added to v1.10) so v1.12 changes don't break v1.11 client parses.

### v1.11 RPC schema fields (for downstream context)

Four message kinds shipped:

| Kind                                | Direction       | Top-level fields                                                                              |
| ----------------------------------- | --------------- | --------------------------------------------------------------------------------------------- |
| `local_token_status_request`        | client → daemon | `requestId: string`                                                                           |
| `local_token_status_response`       | daemon → client | `payload: { requestId: string, mode?: enum, tokenPresent?: boolean }`                         |
| `local_token_regenerate_request`    | client → daemon | `requestId: string`                                                                           |
| `local_token_regenerate_response`   | daemon → client | `payload: { requestId: string, success?: boolean, error?: string }`                           |

`mode` enum values: `"loopback-trust" | "token-file" | "explicit"`.

## Self-Check: PASSED

Verified before writing this Self-Check section:

- `test -f packages/server/src/server/auth/local-token.ts` → FOUND
- `test -f packages/server/src/server/auth/local-token.test.ts` → FOUND
- `test -f packages/server/src/server/auth/local-token-service.ts` → FOUND
- `test -f packages/server/src/server/auth/local-token-service.test.ts` → FOUND
- `test -f packages/server/src/shared/messages.frozen-v1.11.test.ts` → FOUND
- `test -f packages/app/src/screens/settings/local-daemon-panel.tsx` → FOUND
- `git log --oneline | grep ff33bee7` → FOUND (Task 1)
- `git log --oneline | grep 40e97939` → FOUND (Task 2a)
- `git log --oneline | grep 700b4ed6` → FOUND (Task 2b)
- `git log --oneline | grep 4912c81e` → FOUND (Task 2b refinement)
- `git log --oneline | grep 0f823e6a` → FOUND (Task 2c)
- `git log --oneline | grep baf63cde` → FOUND (Task 3)
- `pnpm --filter @ottie/server typecheck` → exit 0
- `pnpm --filter @ottie/app typecheck` → exit 0
- `npx vitest run (auth/local-token + auth/local-token-service + frozen-v1.{8,9,10,11} + session/router)` → 57/57 green
- `npm run lint:colors / lint:hover / lint:pointer-events` → all baselines hold
- `npm run lint:schema` → clean
- `cargo check --manifest-path packages/desktop/src-tauri/Cargo.toml` → exit 0 (with stub sidecar)
- en/zh i18n parity → both sets of flat keys are equal

---

_Phase: 01-architectural-foundations-gating-bug-fixes_
_Plan: 05_
_Reached checkpoint: 2026-05-01_
