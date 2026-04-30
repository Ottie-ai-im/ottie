# CONCERNS

_Last updated: 2026-04-29_

## Summary

The codebase has several high-severity architectural and security concerns, most notably the 9,500-line `session.ts` god-file and two security gaps in the relay and local daemon auth. Medium-severity concerns are largely tech debt and test coverage gaps. These were identified via static analysis by automated agents on 2026-04-29.

## High Severity

### 1. Relay replay-protection not implemented

- **Location:** `packages/relay/src/crypto.ts`
- **Detail:** SECURITY.md documents that intra-session replay protection via message counters is absent. Random nonces are used but message counters that would prevent replay attacks within a session are not implemented.
- **Impact:** A compromised relay could replay messages within an active session.

### 2. Local daemon has no auth for direct connections

- **Location:** `packages/server/src/server/websocket-server.ts`
- **Detail:** Any local process that can reach port 6868 can control all agents with no authentication. The design is intentional (LAN trust model) but undocumented and unmitigated for multi-user systems.
- **Impact:** Local privilege escalation / agent hijack on shared machines.

### 3. `session.ts` is a ~9,500-line god-file

- **Location:** `packages/server/src/server/session.ts`
- **Detail:** Handles agent subscriptions, terminals, voice, chat, file explorer, and permissions in one class. High cognitive load, low testability, high merge conflict surface.
- **Impact:** Major maintenance burden; difficult to add features or fix bugs safely.

### 4. OpenCode `listPersistedAgents` always returns `[]`

- **Location:** `packages/server/src/server/agent/providers/opencode-agent.ts:1174`
- **Detail:** The method is a stub returning an empty array. OpenCode sessions cannot be recovered after daemon restart, unlike Claude Code and Codex.
- **Impact:** Users lose OpenCode session history on any daemon restart.

## Medium Severity

### 5. SQLite timeline store has no retention cap

- **Location:** `packages/server/src/server/` (timeline store)
- **Detail:** The timeline table grows unboundedly. No eviction, pruning, or retention policy.
- **Impact:** Disk growth over time; performance degradation on large histories.

### 6. Multi-agent orchestration tests are placeholders

- **Location:** Server test files for multi-agent coordination
- **Detail:** Tests contain `expect(true).toBe(true)` — no actual orchestration behavior is verified.
- **Impact:** No regression protection for agent coordination logic.

### 7. Backward-compat shims accumulating without removal schedule

- **Location:** `packages/server/src/server/session.ts`, shared message types
- **Detail:** Old field aliases and transform shims for deprecated WebSocket fields are accumulating with no documented removal timeline.
- **Impact:** Schema complexity grows; harder to reason about message shapes.

### 8. Provider modes hardcoded in static manifest

- **Location:** `packages/server/src/server/agent/` (provider manifests)
- **Detail:** ACP agents can report dynamic modes but the manifest is static — dynamic mode registration is not supported.
- **Impact:** ACP agent capabilities cannot be fully surfaced to the UI.

### 9. `node-pty` pinned to beta pre-release

- **Location:** `packages/server/package.json` — `"node-pty": "1.2.0-beta.11"`
- **Detail:** Using a pre-release beta in production. Stable `1.x` is not yet published.
- **Impact:** Potential breakage on rebuild; no SemVer stability guarantees.

### 10. Desktop package naming refers to "Electron" but uses Tauri v2

- **Location:** `packages/desktop/` (source comments, some variable names)
- **Detail:** Code was likely migrated from Electron to Tauri; residual naming creates confusion when debugging or onboarding.
- **Impact:** Developer confusion; wrong documentation cited.

### 11. `chromeEnabled` flag conflates unrelated concerns

- **Location:** `packages/app/src/` (settings/labs)
- **Detail:** A single flag controls multiple unrelated features (layout behavior + keyboard shortcuts). Should be split into dedicated flags.
- **Impact:** Unexpected coupling; disabling one feature silently disables another.

### 12. `onPointerEnter`/`onPointerLeave` used without `isWeb` guard

- **Location:** Resize handle component
- **Detail:** CLAUDE.md explicitly prohibits `onPointerEnter`/`onPointerLeave` — they crash on native iOS. The usage was not guarded.
- **Impact:** Native crash on resize handle interaction.

### 13. Chevron hidden on native due to hover-only guard

- **Location:** `packages/app/src/components/message.tsx`
- **Detail:** Chevron button is only shown when `isHovered` — no `|| isNative` fallback. Per CLAUDE.md, hover-to-show UI must always be visible on native.
- **Impact:** Message action chevron is invisible/inaccessible on iOS/Android.

## Low Severity

### 14. Marketing website is an unimplemented stub

- **Location:** `packages/website/`
- **Detail:** Renders `<div>TODO: Ottie</div>`. No content, no SEO, no landing page.
- **Impact:** No user-facing website at ottie.app.

### 15. JSONL timeline store dead code not cleaned up

- **Location:** `packages/server/src/` (old timeline store)
- **Detail:** Residual JSONL-based timeline code from before the SQLite migration was not fully removed.
- **Impact:** Dead code adds confusion; slightly inflated bundle if not tree-shaken.

### 16. Exact-version pins blocking patch updates

- **Location:** `packages/server/package.json` — `ai: 5.0.78`, `@opencode-ai/sdk: 1.2.6`
- **Detail:** Exact pins prevent patch-level security/bug fixes from being picked up automatically.
- **Impact:** Manual updates required; risk of running with known bugs.

### 17. `vitest.setup.ts` has `@ts-nocheck`

- **Location:** `packages/server/src/test-utils/vitest.setup.ts` (or similar)
- **Detail:** TypeScript checking disabled in test setup file. Type errors in setup code are silently ignored.
- **Impact:** Low — test-only, but reduces confidence in test infrastructure.

### 18. Git diff performance test gated by env var

- **Location:** Server performance tests
- **Detail:** Performance regression test for git diff only runs when a specific `OTTIE_PERF_TEST` env var is set — not included in standard CI run.
- **Impact:** Performance regressions in git diff path go undetected in CI.
