---
status: partial
phase: 01-architectural-foundations-gating-bug-fixes
source: [01-VERIFICATION.md]
started: 2026-05-01T05:39:46Z
updated: 2026-05-01T05:39:46Z
---

## Current Test

[awaiting human testing — auth runtime checkpoint already deferred during execution]

## Tests

### 1. Three-mode auth boot test (Plan 01-05 checkpoint)

expected: Mode A boots without auth (`mode=loopback-trust`), Mode C with `OTTIE_LOCAL_TOKEN` rejects bearerless WS upgrade as `401 Unauthorized` with `WWW-Authenticate: Bearer realm="ottie-local"` header and accepts matching bearer with `101 Switching Protocols`, Mode B (Tauri-bundled) writes `$OTTIE_HOME/local-token` at `0600`.
result: [pending]

### 2. Settings panel bilingual display (Plan 01-05 D-14)

expected: Settings → Local daemon panel renders three rows in en (Status: "Token present", Action: "Locate token", Info link) and identical structure in zh ("令牌存在" etc.) when locale is switched.
result: [pending]

### 3. Theme token visual parity (Plan 01-02)

expected: glass-surface backdrop, daemon-connection-dot status color (green / amber / red), and math-curve-loader timing curves are visually identical to the pre-migration build. No regressions in any of the four migrated files.
result: [pending]

### 4. OpenCode session recovery UAT (Plan 01-03 SES-02)

expected: Run an OpenCode agent, kill the daemon, restart it, run `npm run cli -- ls -a -g`. The OpenCode session appears in the recents list, recovered via `collectRecentOpenCodeSessions`. The mobile app sidebar (recents) shows it after reconnect.
result: [pending]

### 5. Auth-fail copy + pino redaction (Plan 01-05 D-14, T-05-03)

expected: With Mode C using a known token, force a bearer mismatch. Client UI surfaces `errors.localTokenRequired` in current locale (en or zh). `grep -F "<known-token-value>" $OTTIE_HOME/daemon.log` returns zero matches. Daemon log shows the rejection warning.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps

### G-01: SC#1 wording-vs-delivery mismatch (acknowledged, non-blocking)

**Source:** 01-VERIFICATION.md SC#1 PARTIAL.
**Description:** ROADMAP success criterion #1 says "every WS message kind dispatches via the router with full type narrowing in handlers" — but only one kind (`agent_permission_response`) is registered on the new `MessageRouter`. All other 50+ kinds still flow through `dispatchLegacyInboundMessage`. This is the Strangler-Fig design per CONTEXT.md and the ROADMAP traceability table, which explicitly places C-4/C-6/C-7 in Phases 3/5.
**Disposition:** acknowledged. The wording in SC#1 is too strong for the actual phase scope; the planner intended "the router and parse boundary exist and accept their first handler" not "every kind is migrated". Future phases (3 and 5) close the gap by registering remaining handlers.
**Action:** none required this phase. If desired, a future phase can soften the ROADMAP wording or add a coverage assertion to `router.test.ts`. Not tracked as a Phase 01 gap.
status: acknowledged
