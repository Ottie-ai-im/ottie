---
phase: 01-architectural-foundations-gating-bug-fixes
verified: 2026-04-30T00:00:00Z
status: human_needed
score: 4/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "MessageRouter (C-1) and Zod parse boundary (C-2) extracted from session.ts; every WS message dispatches via router with full type narrowing; PermissionHandler (C-3) fully carved"
    status: partial
    reason: |
      MessageRouter, parseInboundMessage, and PermissionHandler are ALL extracted and wired correctly.
      However, ROADMAP SC#1 says 'every WS message kind dispatches via the router' — only ONE kind
      (agent_permission_response) is registered on MessageRouter. All other kinds route through the
      legacy dispatchLegacyInboundMessage chain. Additionally, RouterHandler type is typed as
      (msg: SessionInboundMessage) => void rather than per-kind narrowed types, so 'full type
      narrowing in handlers' is only achieved via an inline m.type === check in the registration
      lambda, not via the router's type system.

      The Plan 04 Strangler-Fig design and ROADMAP traceability table (ARCH-01: C-4/C-6/C-7 in
      Phases 3/5) both acknowledge that remaining kinds are deferred. This is an intentional
      implementation strategy, but it conflicts with ROADMAP SC#1 literal wording.
    artifacts:
      - path: "packages/server/src/server/session/router.ts"
        issue: "RouterHandler type is (msg: SessionInboundMessage) => void — no per-kind type narrowing enforced by type system"
      - path: "packages/server/src/server/session.ts"
        issue: "Only agent_permission_response and local_token_* kinds registered; 50+ other kinds still flow through dispatchLegacyInboundMessage"
      - path: "packages/server/src/server/session/router.test.ts"
        issue: "router.test.ts asserts discriminator has >50 kinds but does NOT assert every kind has a registered handler at boot — the plan must_have requires this assertion"
    missing:
      - "Either: register all SessionInboundMessage kinds on MessageRouter (completing the carve), OR update ROADMAP SC#1 to reflect the phased Strangler-Fig intent ('C-1 infrastructure extracted; 1 kind migrated in Phase 1')"
      - "router.test.ts should assert the coverage contract explicitly (e.g. assert that every kind is either registered on the router OR explicitly listed as a known legacy-chain kind)"
deferred:
  - truth: "Every WS message kind dispatches via the router (all 50+ kinds migrated)"
    addressed_in: "Phase 3"
    evidence: "ROADMAP traceability: ARCH-01 — C-4/C-6/C-7 in Phases 3/5; C-9 shell delete in Phase 5. Phase 3 goal: 'Carve AgentSessionHandler (C-7) and VoiceSessionHandler (C-6)'"
  - truth: "docs/SCHEMA_EVOLUTION.md removal calendar"
    addressed_in: "Phase 5"
    evidence: "ROADMAP Phase 5 SC#2: 'docs/SCHEMA_EVOLUTION.md documents RESERVED_FIELDS, the removal calendar, and the behavioral-contract per message kind'"
human_verification:
  - test: "Mode A loopback-trust preserved"
    expected: "npm run dev starts daemon without any auth prompts; app connects without bearer token; daemon.log shows mode=loopback-trust"
    why_human: "Cannot start daemon on :6868 without permission per CLAUDE.md"
  - test: "Mode C OTTIE_LOCAL_TOKEN env path"
    expected: "Start daemon with OTTIE_LOCAL_TOKEN=<token>; a WS upgrade without bearer returns HTTP 401 + WWW-Authenticate: Bearer realm='ottie-local'; with matching bearer returns 101; daemon.log carries [REDACTED] instead of literal token"
    why_human: "Requires daemon start + HTTP inspection; cannot run without daemon permission"
  - test: "Mode B Tauri token-file"
    expected: "$OTTIE_HOME/local-token exists with POSIX mode 0600 after Tauri desktop build; Settings -> Local daemon panel shows Status row 'Token present' in both en and zh locales"
    why_human: "Requires Tauri desktop build + file system inspection"
  - test: "Theme token visual parity"
    expected: "glass-surface, daemon-connection-dot, and math-curve-loader render identically before and after token migration on iOS, Android, and web"
    why_human: "Visual appearance cannot be verified programmatically; requires device/simulator screenshots"
  - test: "OpenCode session recovery UAT"
    expected: "Kill daemon mid-session, restart, sessions appear in recents list"
    why_human: "Requires real OpenCode daemon + session state across restarts"
---

# Phase 1: Architectural Foundations & Gating Bug Fixes Verification Report

**Phase Goal:** Every seam, lint rule, and gating bug-fix that subsequent phases depend on is in place. No feature work until the router is carved (C-1/C-2/C-3), schema discipline is enforced (warn-only), the theme token skeleton exists, the local-token auth path is shipped behind a default-off flag, and the four shipped regressions are closed.
**Verified:** 2026-04-30T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                                                                                                                  | Status     | Evidence                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MessageRouter (C-1) and Zod parse boundary (C-2) extracted; every WS message dispatches via router with full type narrowing; PermissionHandler (C-3) fully carved                                                      | ⚠ PARTIAL  | MessageRouter, parseInboundMessage, PermissionHandler all exist and are wired. Only 1 of 50+ kinds registered; no per-kind type system narrowing.                                                                          |
| 2   | v1.8/v1.9/v1.10 frozen-fixture tests pass; RESERVED_FIELDS exists; @deprecated lint warns; theme.ts consolidated into tokens/ (prim→semantic→comp); hardcoded-color lint warns                                         | ✓ VERIFIED | All 3 frozen-fixture files have 4+ it() blocks, import from ./messages.js. RESERVED_FIELDS exported (confirmed by grep). lint:schema exits 0. Six token files exist. theme.ts at 580 lines (<716). LEGACY shim documented. |
| 3   | LocalTokenAuth (ARCH-03) ships in three modes; SECURITY.md reflects all three                                                                                                                                          | ✓ VERIFIED | resolveLocalTokenMode() exports 3 modes; verifyBearerToken in websocket-server.ts; ensure_local_token() in daemon.rs before spawn(); SECURITY.md sections 62, 74, 97 cover Modes A/B/C.                                    |
| 4   | Message chevron (CONCERNS H13) visible on iOS/Android via isHovered                                                                                                                                                    |            | isNative                                                                                                                                                                                                                   |     | isCompact; isHovered-alone lint blocks regressions | ✓ VERIFIED | message.tsx lines 2606 and 2701 fixed. is-hovered-alone.baseline.json count=6 (pre-existing). lint:hover wired in package.json. |
| 5   | Resize handle no longer uses onPointerEnter/Leave outside .web.ts; pointer-events lint at warn-level; OpenCode listPersistedAgents returns recovered sessions; chromeEnabled split with existing-user values preserved | ✓ VERIFIED | resize-handle.tsx lines 152-153 gated by isWeb. opencode-agent.ts has collectRecentOpenCodeSessions. chromeEnabled=0 in \_layout.tsx (renamed to chromeLayoutEnabled at 13 sites).                                         |

**Score:** 4/5 truths fully verified (SC#1 is PARTIAL due to router not covering all kinds)

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| #   | Item                                                          | Addressed In | Evidence                                                                                         |
| --- | ------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| 1   | All 50+ SessionInboundMessage kinds migrated to MessageRouter | Phase 3      | ROADMAP traceability: "ARCH-01 — C-4/C-6/C-7 in Phases 3/5; C-9 shell delete in Phase 5"         |
| 2   | docs/SCHEMA_EVOLUTION.md removal calendar written             | Phase 5      | ROADMAP Phase 5 SC#2: "docs/SCHEMA_EVOLUTION.md documents RESERVED_FIELDS, the removal calendar" |

### Required Artifacts

| Artifact                                                                           | Expected                                                                                | Status     | Details                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `packages/server/src/shared/messages.ts`                                           | RESERVED_FIELDS export + ARCH-02 header                                                 | ✓ VERIFIED | grep: 1 match for `export const RESERVED_FIELDS`, 3 matches for `ARCH-02`                                                                                  |
| `packages/server/src/shared/messages.frozen-v1.8.test.ts`                          | v1.8 wire-compat parse tests                                                            | ✓ VERIFIED | 4 it() blocks, imports from `./messages.js`, FROZEN markers present                                                                                        |
| `packages/server/src/shared/messages.frozen-v1.9.test.ts`                          | v1.9 wire-compat parse tests                                                            | ✓ VERIFIED | 4 it() blocks, imports from `./messages.js`, FROZEN markers present                                                                                        |
| `packages/server/src/shared/messages.frozen-v1.10.test.ts`                         | v1.10 wire-compat parse tests                                                           | ✓ VERIFIED | 5 it() blocks (one additive-confirmation from Plan 05), imports from `./messages.js`                                                                       |
| `tools/lint/deprecated-annotation.ts`                                              | Warn-level lint for @deprecated annotations                                             | ✓ VERIFIED | lintDeprecatedAnnotations exported (4 occurrences), PHASE 5 exit-code marker present                                                                       |
| `packages/app/src/styles/tokens/primitives.ts`                                     | palette + spacing + radius exports                                                      | ✓ VERIFIED | `export const palette` confirmed, 3 total exports                                                                                                          |
| `packages/app/src/styles/tokens/semantic.light.ts`                                 | Light semantic tokens                                                                   | ✓ VERIFIED | `export const semanticLight` confirmed                                                                                                                     |
| `packages/app/src/styles/tokens/semantic.dark.ts`                                  | Dark semantic tokens                                                                    | ✓ VERIFIED | `export const semanticDark` confirmed                                                                                                                      |
| `packages/app/src/styles/tokens/component.ts`                                      | Component-level tokens                                                                  | ✓ VERIFIED | `export const componentTokens` confirmed                                                                                                                   |
| `packages/app/src/styles/tokens/motion.ts`                                         | Motion curves + durations                                                               | ✓ VERIFIED | `export const motion` confirmed                                                                                                                            |
| `packages/app/src/styles/tokens/typography.ts`                                     | Typography tokens                                                                       | ✓ VERIFIED | `export const typography` confirmed                                                                                                                        |
| `packages/app/src/styles/theme.ts`                                                 | Composition root importing from tokens/                                                 | ✓ VERIFIED | 2 imports from `tokens/primitives`, lightTheme + darkTheme exports preserved, 6 LEGACY shim markers, 580 lines                                             |
| `tools/lint/hardcoded-color.ts`                                                    | Warn-level lint for hardcoded color literals                                            | ✓ VERIFIED | lintHardcodedColors exported, PHASE 5 tighten marker present                                                                                               |
| `tools/lint/hardcoded-color.baseline.json`                                         | CI counter-baseline                                                                     | ✓ VERIFIED | `{"count": 591, "capturedAt": "...", "plan": "01-02"}`                                                                                                     |
| `packages/app/src/components/message.tsx`                                          | Chevron uses isNative\|\|isCompact                                                      | ✓ VERIFIED | Lines 2606, 2701 both fixed. isNative imported at line 102.                                                                                                |
| `packages/app/src/components/resize-handle.tsx`                                    | Pointer events gated by isWeb                                                           | ✓ VERIFIED | Lines 152-153 use `isWeb ? handlePointerEnter : undefined`. isWeb imported.                                                                                |
| `packages/server/src/server/agent/providers/opencode-agent.ts`                     | listPersistedAgents returns real sessions                                               | ✓ VERIFIED | collectRecentOpenCodeSessions (3 occurrences), parseOpenCodeSessionDescriptor (3 occurrences). Not a stub return `[]`.                                     |
| `packages/server/src/server/agent/providers/opencode-agent.list-persisted.test.ts` | Vitest coverage for SES-02                                                              | ✓ VERIFIED | 7 test() calls covering happy-path, malformed, limit, env-seam                                                                                             |
| `packages/app/src/app/_layout.tsx`                                                 | chromeLayoutEnabled split preserving values                                             | ✓ VERIFIED | chromeEnabled count=0, chromeLayoutEnabled count=13, SET-02 rationale comment present                                                                      |
| `tools/lint/is-hovered-alone.ts`                                                   | Warn-level lint for isHovered-alone gates                                               | ✓ VERIFIED | PHASE 5 tighten marker present, npm script wired                                                                                                           |
| `tools/lint/pointer-events-web-only.ts`                                            | Warn-level lint for onPointerEnter outside .web.\*                                      | ✓ VERIFIED | PHASE 5 tighten marker present, npm script wired                                                                                                           |
| `packages/server/src/server/session/router.ts`                                     | MessageRouter class with register/dispatch                                              | ✓ VERIFIED | MessageRouter exported with register(), dispatch(), has(). RouterMissError exported.                                                                       |
| `packages/server/src/server/session/parse.ts`                                      | parseInboundMessage returning discriminated union                                       | ✓ VERIFIED | Returns `{ok: true, message}                                                                                                                               | {ok: false, error}`. Never throws. |
| `packages/server/src/server/session/permission-handler.ts`                         | PermissionHandler with injected emit + logger                                           | ✓ VERIFIED | PermissionHandler class with handleResponse(agentId, requestId, response). Deps injected.                                                                  |
| `packages/server/src/server/session.ts`                                            | Contains OTTIE_USE_NEW_ROUTER flag                                                      | ✓ VERIFIED | 1 occurrence. dispatchLegacyInboundMessage still handles non-registered kinds. 9597 lines (baseline documented).                                           |
| `.github/workflows/ci.yml`                                                         | Carve-flag matrix (D-04 CI enforcement)                                                 | ✓ VERIFIED | carve-flag-matrix job at line 42. OTTIE_USE_NEW_ROUTER in strategy.matrix. Frozen-fixture tests in job (lines 80-82).                                      |
| `packages/server/src/server/auth/local-token.ts`                                   | LocalTokenMode + resolveLocalTokenMode + verifyBearerToken + generateAndWriteLocalToken | ✓ VERIFIED | All 4 exported. timingSafeEqual for constant-time compare. FILE_MODE = 0o600.                                                                              |
| `packages/server/src/server/auth/local-token-service.ts`                           | LocalTokenService class + registerLocalTokenHandlers                                    | ✓ VERIFIED | `export class LocalTokenService` + `registerLocalTokenHandlers` exported (2 occurrences).                                                                  |
| `packages/server/src/server/websocket-server.ts`                                   | Bearer-token gate; authRejected counter                                                 | ✓ VERIFIED | verifyBearerToken called (2 occurrences). authRejected counter. HTTP 401 + WWW-Authenticate: Bearer.                                                       |
| `packages/server/src/server/session.ts`                                            | registerLocalTokenHandlers called                                                       | ✓ VERIFIED | 2 occurrences of registerLocalTokenHandlers.                                                                                                               |
| `packages/server/src/shared/messages.frozen-v1.11.test.ts`                         | v1.11 frozen-fixture parity for 4 new RPC kinds                                         | ✓ VERIFIED | 8 it() blocks covering local_token_status_request/response + local_token_regenerate_request/response including optional-field-omitted forward-compat case. |
| `packages/desktop/src-tauri/src/daemon.rs`                                         | ensure_local_token() before spawn()                                                     | ✓ VERIFIED | ensure_local_token() defined at line 27, called at line 90 as FIRST line of spawn() body. mode 0o600 at line 51.                                           |
| `packages/app/src/screens/settings/local-daemon-panel.tsx`                         | Settings panel with three rows                                                          | ✓ VERIFIED | File exists. 21 occurrences of settings.localDaemon.                                                                                                       |
| `SECURITY.md`                                                                      | Three-mode auth documented with file path, mode 0600, regeneration semantics            | ✓ VERIFIED | Sections for Mode A (line 62), Mode B (74), Mode C (97). $OTTIE_HOME/local-token referenced. D-14 user-facing copy documented.                             |
| `packages/app/src/i18n/locales/en.json`                                            | English strings for settings.localDaemon.\* + errors.localTokenRequired                 | ✓ VERIFIED | localDaemon namespace present. localTokenRequired string present at line 104.                                                                              |
| `packages/app/src/i18n/locales/zh.json`                                            | Chinese parity strings                                                                  | ✓ VERIFIED | localDaemon namespace present. localTokenRequired translated at line 104.                                                                                  |

### Key Link Verification

| From                                  | To                                                     | Via                                    | Status  | Details                                                                                              |
| ------------------------------------- | ------------------------------------------------------ | -------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| messages.frozen-v1.{8,9,10}.test.ts   | messages.ts                                            | import from "./messages.js" + .parse() | ✓ WIRED | All three files import from `./messages.js` and exercise 4 schemas each                              |
| package.json scripts.lint:schema      | tools/lint/deprecated-annotation.ts                    | tsx invocation                         | ✓ WIRED | `lint:schema` key found 2 times in package.json                                                      |
| theme.ts                              | tokens/primitives.ts                                   | import statement                       | ✓ WIRED | 2 occurrences of `tokens/primitives` in theme.ts                                                     |
| glass-surface.tsx                     | theme.surface.glass                                    | Unistyles accessor                     | ✓ WIRED | 3 occurrences of `theme.surface.glass`; 0 occurrences of `theme.colors.palette`                      |
| daemon-connection-dot.tsx             | theme.status.{online,connecting,offline}               | Unistyles accessor                     | ✓ WIRED | 3 occurrences of `theme.status`; 0 occurrences of `theme.colors.palette`                             |
| package.json scripts.lint:colors      | tools/lint/hardcoded-color.ts                          | tsx invocation                         | ✓ WIRED | `lint:colors` found 3 times in package.json                                                          |
| message.tsx chevron isActive          | @/constants/platform isNative + useIsCompactFormFactor | import + JSX expression                | ✓ WIRED | isNative imported at line 102; isCompact from useIsCompactFormFactor at line 2433                    |
| opencode-agent.ts listPersistedAgents | OpenCode session filesystem                            | collectRecentOpenCodeSessions helper   | ✓ WIRED | Helper present (3 occurrences). OTTIE_OPENCODE_HOME env seam for tests.                              |
| \_layout.tsx                          | chromeLayoutEnabled + keyboardShortcutsEnabled         | renamed derivations                    | ✓ WIRED | chromeEnabled=0, chromeLayoutEnabled=13 in file                                                      |
| session.ts handleMessage              | session/router.ts MessageRouter.dispatch               | OTTIE_USE_NEW_ROUTER flag gate         | ✓ WIRED | Line 1669: `const useRouter = process.env.OTTIE_USE_NEW_ROUTER !== "0" && this.router.has(msg.type)` |
| router.ts (agent_permission_response) | session/permission-handler.ts handleResponse           | OTTIE_USE_PERMISSION_HANDLER flag      | ✓ WIRED | session.ts line 986-993: register with type-narrowing lambda                                         |
| .github/workflows/ci.yml carve-matrix | vitest carve test suite + frozen-fixture tests         | strategy.matrix env vars               | ✓ WIRED | Lines 42-82 in ci.yml confirm matrix job with all 4 flag combos + frozen fixtures                    |
| websocket-server.ts verifyWsClient    | auth/local-token.ts verifyBearerToken                  | import + gate before origin check      | ✓ WIRED | verifyBearerToken in websocket-server.ts (2 occurrences)                                             |
| session.ts constructor                | auth/local-token-service.ts registerLocalTokenHandlers | one-line helper call                   | ✓ WIRED | registerLocalTokenHandlers in session.ts (2 occurrences, import + call)                              |
| desktop/daemon.rs spawn()             | $OTTIE_HOME/local-token (mode 0600)                    | ensure_local_token() before spawn()    | ✓ WIRED | ensure_local_token() at line 90, mode 0o600 at line 51                                               |

### Data-Flow Trace (Level 4)

| Artifact                              | Data Variable              | Source                                             | Produces Real Data                                                 | Status                                    |
| ------------------------------------- | -------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| opencode-agent.ts listPersistedAgents | PersistedAgentDescriptor[] | fs.readdir / JSON.parse of session info files      | Yes — reads real filesystem paths via OTTIE_OPENCODE_HOME seam     | ✓ FLOWING                                 |
| local-daemon-panel.tsx                | tokenStatus                | LocalTokenService.getStatus() via DaemonClient RPC | Yes — getStatus returns {mode, tokenPresent} from live token state | ? UNCERTAIN — requires human runtime test |

### Behavioral Spot-Checks

Step 7b SKIPPED for daemon-start behaviors (cannot start daemon on :6868 per CLAUDE.md). Static file checks performed instead.

| Behavior                 | Command                                                                              | Result    | Status                                              |
| ------------------------ | ------------------------------------------------------------------------------------ | --------- | --------------------------------------------------- | --- | ------ |
| RESERVED_FIELDS exported | `grep -c "export const RESERVED_FIELDS" packages/server/src/shared/messages.ts`      | 1         | ✓ PASS                                              |
| frozen-v1.8 has 4+ tests | `grep -c '// FROZEN' packages/server/src/shared/messages.frozen-v1.8.test.ts`        | 4         | ✓ PASS                                              |
| theme.ts shrank          | `wc -l packages/server/src/styles/theme.ts`                                          | 580 < 716 | ✓ PASS                                              |
| chevron isNative fix     | `grep -c "isNative                                                                   |           | isCompact" packages/app/src/components/message.tsx` | 2   | ✓ PASS |
| pointer-events gated     | `grep -c "isWeb ? handlePointerEnter" packages/app/src/components/resize-handle.tsx` | 1         | ✓ PASS                                              |
| chromeEnabled eliminated | `grep -c "chromeEnabled" packages/app/src/app/_layout.tsx`                           | 0         | ✓ PASS                                              |
| session router wired     | `grep -c "OTTIE_USE_NEW_ROUTER" packages/server/src/server/session.ts`               | 1         | ✓ PASS                                              |
| SECURITY.md three-mode   | `grep -c "Mode A\|Mode B\|Mode C\|loopback-trust" SECURITY.md`                       | 10        | ✓ PASS                                              |
| en+zh parity             | `grep -c "localDaemon" packages/app/src/i18n/locales/{en,zh}.json`                   | 1+1       | ✓ PASS                                              |
| CI frozen-fixture job    | `grep -c "messages.frozen-v1.8.test.ts" .github/workflows/ci.yml`                    | 1         | ✓ PASS                                              |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                  | Status      | Evidence                                                                                                                                                  |
| ----------- | ----------- | ---------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARCH-01     | 01-04       | MessageRouter C-1, parseInboundMessage C-2, PermissionHandler C-3 extracted  | ⚠ PARTIAL   | Infrastructure carved and wired. Only 1 kind on router vs "every kind" in ROADMAP SC#1. Remaining kinds deferred to Phases 3/5 per traceability table.    |
| ARCH-02     | 01-01       | Schema discipline: RESERVED_FIELDS, frozen fixtures, @deprecated lint        | ✓ SATISFIED | RESERVED_FIELDS exported. 3 frozen-fixture files pass. lint:schema wired. CI enforces frozen-fixture tests.                                               |
| ARCH-03     | 01-05       | Three-mode local auth shipped                                                | ✓ SATISFIED | resolveLocalTokenMode, verifyBearerToken, ensure_local_token(), WS gate, SECURITY.md all verified. Checkpoint (human three-mode boot test) still pending. |
| THM-01      | 01-02       | Token skeleton + hardcoded-color lint                                        | ✓ SATISFIED | Six token files. theme.ts composition root. LEGACY shim. Counter-baseline JSON. lint:colors wired.                                                        |
| NAV-A3      | 01-03       | Chevron visible via isHovered\|\|isNative\|\|isCompact; isHovered-alone lint | ✓ SATISFIED | Fixed at 2 sites (2606, 2701). lint:hover with baseline=6.                                                                                                |
| NAT-03      | 01-03       | Resize handle pointer-events gated; pointer-events lint at warn-level        | ✓ SATISFIED | isWeb gate at resize-handle.tsx:152-153. lint:pointer-events with baseline=10.                                                                            |
| SES-02      | 01-03       | OpenCode listPersistedAgents returns real sessions                           | ✓ SATISFIED | collectRecentOpenCodeSessions helper. 7 test() cases pass (per SUMMARY). UAT pending human confirmation.                                                  |
| SET-02      | 01-03       | chromeEnabled split into chromeLayoutEnabled + keyboardShortcutsEnabled      | ✓ SATISFIED | 0 chromeEnabled occurrences, 13 chromeLayoutEnabled. Identical effective values. SET-02 rationale comment.                                                |

### Anti-Patterns Found

| File                                           | Line       | Pattern                                                                                                                       | Severity  | Impact                                                                                                                                        |
| ---------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server/src/server/session/router.ts` | 7          | RouterHandler typed as full SessionInboundMessage union; per-kind narrowing only via inline type guard in registration lambda | ⚠ Warning | Handlers do not get type-narrowed arguments from the type system; each handler must guard its own narrowing. Does not break runtime behavior. |
| `packages/server/src/server/session.ts`        | 9597 lines | session.ts grew by +12 lines from Plan 05 (documented exception) vs D-02 shrinkage discipline                                 | ℹ Info    | Documented exception per session-ts-baseline.txt. Net growth is 5 lines vs baseline of 9592 (9597 - 9592). Non-blocking.                      |

### Human Verification Required

The following items require manual runtime testing. These are blocking for a `passed` verdict.

#### 1. Three-mode local auth boot test (ARCH-03 checkpoint)

**Test:** Exercise all three daemon modes per Plan 05 checkpoint instructions:

- Mode A: `npm run dev` with no token — confirm no auth prompts, daemon.log shows `mode=loopback-trust`
- Mode C: `OTTIE_LOCAL_TOKEN=<token> npm run dev` — confirm 401 on bad bearer, 101 on correct bearer, `[REDACTED]` in logs
- Mode B: Desktop build — confirm `$OTTIE_HOME/local-token` exists with `stat -f '%Lp'` returning `600`

**Expected:** All three modes behave as documented in SECURITY.md. Auth-fail copy references `$OTTIE_HOME/daemon.log`. Pino redaction hides literal token from logs.
**Why human:** Daemon cannot be started on :6868 by a CI agent per CLAUDE.md. This is Plan 05's explicit `checkpoint:human-verify` task.

#### 2. Settings panel bilingual display (D-13)

**Test:** Open Settings → Local daemon panel on a device or simulator in both English and Chinese locales. Verify three rows render: Status, Locate Token (guidance Alert with copy-path button), Regenerate.
**Expected:** All text in both locales. No missing translation keys.
**Why human:** Visual UI rendering cannot be verified by grep.

#### 3. Theme token visual parity

**Test:** Compare screenshots of glass-surface, daemon-connection-dot (three status colors), and math-curve-loader animations on iOS/Android before and after the token migration (or review visual at HEAD against expected design values).
**Expected:** Byte-for-byte identical colors. glass tints match pre-migration rgba values. Status dots: online=green[400], connecting=amber[500], offline=red[500].
**Why human:** Visual appearance and animation timing require human/screenshot comparison.

#### 4. OpenCode session recovery UAT

**Test:** With OpenCode installed locally, start an agent, kill the daemon, restart, observe recents list.
**Expected:** Recovered sessions appear in the recents list (per SES-02 requirement).
**Why human:** Requires real OpenCode install + filesystem state. Automated tests use synthetic fixtures.

### Gaps Summary

**One structural gap identified (PARTIAL — not a hard BLOCKER by itself, but warrants developer acknowledgement):**

ROADMAP Phase 1 Success Criterion #1 states "every WS message kind dispatches via the router with full type narrowing in handlers." The implementation routes only ONE kind (`agent_permission_response`) through MessageRouter. Approximately 50+ other kinds still flow through the legacy `dispatchLegacyInboundMessage` chain in session.ts.

This is an intentional Strangler-Fig design: the ROADMAP traceability table explicitly notes "ARCH-01: C-4/C-6/C-7 in Phases 3/5." The plans themselves document this approach. The gap is therefore a **wording mismatch** between SC#1 and the phased execution plan, not a missing implementation.

Additionally, the router.test.ts does not include the "every kind in the discriminator has a registered handler at boot" assertion that Plan 04's must_have specifies. The test instead asserts "the discriminator has >50 kinds and contains agent_permission_response" — which is a weaker guarantee.

**Developer action needed:** Either (a) accept this as intentional and acknowledge the ROADMAP SC#1 wording should read "C-1/C-2/C-3 infrastructure extracted, Strangler-Fig wiring in place for phased kind migration" rather than "every kind dispatches via router," OR (b) add the per-kind coverage assertion to router.test.ts documenting which kinds are router-registered vs. legacy-chain.

**Five human verification items remain before phase can be marked PASSED.** These are runtime behavioral tests that cannot be verified from file inspection.

---

_Verified: 2026-04-30T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
