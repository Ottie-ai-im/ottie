# Phase 1: Architectural Foundations & Gating Bug Fixes - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Lay every seam, lint rule, and gating bug-fix that subsequent phases depend on. No feature work in this phase. Specifically delivers:

1. **Carve C-1/C-2/C-3** — `MessageRouter` extraction, Zod parse boundary, `PermissionHandler` carved out of `session.ts`. C-4..C-9 are out of scope (Phases 3 / 5).
2. **Schema-evolution discipline** — `RESERVED_FIELDS` registry, `@deprecated since= removeAfter=` annotation convention, frozen-fixture parse tests in CI for v1.8 / v1.9 / v1.10 schemas. CI lint runs warn-only this phase (promoted to error in Phase 5).
3. **Theme token skeleton** — `packages/app/src/styles/tokens/` (primitive → semantic → component) on top of Unistyles 3, hardcoded-color lint at warn-level on new files, counter-test guarantees warn count never increases. Surface migrations are Phase 4.
4. **Local-token auth (ARCH-03)** — three modes shipping behind a default-off flag for the non-loopback path: Mode A loopback-trust default unchanged, Mode B auto-token at `$OTTIE_HOME/local-token` (mode 0600) for Tauri-bundled daemon, Mode C explicit `OTTIE_LOCAL_TOKEN` env var.
5. **Four shipped regressions closed** — H13 chevron (`isHovered || isNative || isCompact` + lint), C12 pointer events (lint blocks `onPointerEnter`/`onPointerLeave` outside `.web.ts`), H4 OpenCode `listPersistedAgents` proper implementation, C11 `chromeEnabled` flag split with default preservation.

Requirements covered: ARCH-01, ARCH-02, ARCH-03, THM-01, NAV-A3, NAT-03, SES-02, SET-02 (8 of 36 v1).

</domain>

<decisions>
## Implementation Decisions

### Carve Safety Strategy (ARCH-01, C-1/C-2/C-3)

- **D-01:** Each carve step ships behind its own per-step env flag (e.g. `OTTIE_USE_NEW_ROUTER`, `OTTIE_USE_PERMISSION_HANDLER`). Default ON in CI/dev; can be flipped OFF in production via env var without a revert. All flags are removed in Phase 5 cleanup (per `.planning/research/ARCHITECTURE.md` §3.3 Strangler-Fig discipline).
- **D-02:** CI invariants that must stay green at every commit during the carve:
  - Frozen-fixture parse tests for v1.8 / v1.9 / v1.10 client schemas (CI-blocking).
  - Existing permission flow E2E (so C-3 is a behavior-preserving refactor, not a feature change).
  - `wc -l packages/server/src/server/session.ts` strictly less than the previous commit (forces real extraction; makes the ≤500-line target measurable).
- **D-03:** New code lives at `packages/server/src/server/session/` as a sibling subdirectory of the existing `session.ts` during the carve. Final C-9 collapses `session.ts` into `session/index.ts`. Diff stays domain-localized.
- **D-04:** CI runs a matrix on every PR for the carve duration: flag ON + flag OFF, both must pass. Adds ~30% CI time and is accepted; pays for itself the first time we need to flip back.

### `chromeEnabled` Split + Migration (SET-02 / CONCERNS C11)

- **D-05:** New flag names: `chromeLayoutEnabled` and `keyboardShortcutsEnabled`. Keeps the `chrome` prefix on the layout half for continuity; names the keyboard half by what it actually does.
- **D-06:** Migration rule: both new flags inherit the existing `chromeEnabled` value on first launch of v1.11. Zero behavior change for existing users; they can split the toggles later in the new Settings UI.
- **D-07:** Migration runs client-side on first read of the flag store. New flags are written if absent; the old `chromeEnabled` field is left in storage. No daemon involvement (these are client-only UI flags).
- **D-08:** Old `chromeEnabled` field is marked `@deprecated since=v1.11 removeAfter=v1.16` per ARCH-02 discipline. Schema keeps accepting writes (old clients keep working); daemon stops sending it. After v1.16 removal, the field name is added to `RESERVED_FIELDS` and never reused.

### Theme Token Migration Scope (THM-01)

- **D-09:** Phase 1 ships the skeleton plus targeted migration of in-flight files only:
  - **Skeleton:** `packages/app/src/styles/tokens/` with `primitives.ts`, `semantic.light.ts`, `semantic.dark.ts`, `component.ts`, `motion.ts`, `typography.ts`. Wired into Unistyles.
  - **Migrated files (this phase):** `theme.ts`, `glass-surface.tsx`, `daemon-connection-dot.tsx`, `math-curve-loader/*`. These are the in-flight files already touching colors/surfaces/motion.
  - **Out of scope (Phase 4):** every other surface migration (modals, sheets, popovers, callout cards, toasts).
- **D-10:** Hardcoded-color lint flags **new files** under `packages/app/src/` at warn-level (blocks merging if hardcoded `#xxx` / `rgb()` / `rgba()` introduced). Existing files emit warnings but don't fail. CI counter-test guarantees the warn count never increases (per REQUIREMENTS THM-01).
- **D-11:** Light/dark sets wired as two flat themes via `UnistylesRegistry.addThemes({ light, dark })`. `semanticLight` and `semanticDark` are pre-resolved at build time; components consume `theme.surface.background` etc. Matches `.planning/research/ARCHITECTURE.md` §8.3 verbatim.
- **D-12:** No W3C DTCG JSON export pipeline this milestone — TS-only. DTCG is a future-milestone export target with no v1.11 consumer.

### Local-Token Auth UX (ARCH-03)

- **D-13:** Token surfaces in **Settings → Advanced → Local daemon** panel (power-user surface). Panel shows: token status (auto-generated / present / absent), "View token" (revealed on tap with confirmation), "Regenerate token" (with warning that other clients will need re-pairing). Hidden behind Advanced so casual users never see it.
- **D-14:** Auth-fail handler: daemon returns HTTP 401 + `WWW-Authenticate: Bearer`. Client shows: _"This daemon requires a local token. If you're on the same machine, find it at `$OTTIE_HOME/local-token`. See `$OTTIE_HOME/daemon.log` for details."_ Aligns with the `daemon.log` canonical-debug-surface convention from PROJECT.md.
- **D-15:** Tauri shell writes the token file **before spawning the daemon subprocess** at startup; daemon reads on boot. No race (per `.planning/research/ARCHITECTURE.md` §13 mitigation row). File mode 0600, owner-only readable. Regenerated only on explicit user action.
- **D-16:** `SECURITY.md` is updated this phase to document all three modes (A loopback-trust default, B token-file Tauri auto, C env-var explicit) — file path, mode 0600, regeneration semantics, threat-model delta. Required by ROADMAP.md Phase 1 success criterion #3.

### Claude's Discretion

- Specific env-var names (`OTTIE_USE_NEW_ROUTER` vs `OTTIE_USE_MESSAGE_ROUTER` etc.) — planner picks consistent names.
- Internal naming of the new `session/` subdirectory files (e.g. `router.ts` vs `message-router.ts`).
- Token-file layout details inside `$OTTIE_HOME` (e.g. permission-check helper location).
- The exact wording of the Settings → Advanced "Local daemon" panel copy (must be bilingual en + zh per CLAUDE.md).

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & carve strategy

- `.planning/research/ARCHITECTURE.md` §3 — Strangler-Fig carve C-1..C-9 step ordering, what stays in `Session` shell, VS Code LSP industry parallel.
- `.planning/research/ARCHITECTURE.md` §13 — risk callouts and mitigations per architectural move (carve drift, optimistic-create leak, Tauri token race, etc.).
- `.planning/research/PITFALLS.md` — full pitfalls catalog; Phase 1 maps to pitfalls 2, 3, 5, 8, 9 (carve antipatterns, schema-deprecation traps, theme retrofit drift, cross-platform regression blind spots).
- `.planning/codebase/ARCHITECTURE.md` — current package layering, WebSocket protocol, agent lifecycle, MCP server, services inventory.
- `.planning/codebase/CONCERNS.md` — full inventory of H/M/L concerns; Phase 1 directly addresses CONCERNS H2 (ARCH-03), H3 (ARCH-01), H4 (SES-02), H7 (ARCH-02), H13 (NAV-A3), C11 (SET-02), C12 (NAT-03).

### Schema evolution

- `.planning/research/ARCHITECTURE.md` §4 — Stripe + Protobuf hybrid pattern, `@deprecated since= removeAfter=` annotation, `RESERVED_FIELDS` registry, ≥6-minor-release horizon rule.
- `CLAUDE.md` "WebSocket / Message Schema Rules" — never narrow, never remove, never change optional → required. Hard rule.
- `packages/server/src/shared/messages.ts` — current Zod schemas; the lint and `RESERVED_FIELDS` discipline lives here.
- `docs/SCHEMA_EVOLUTION.md` — to be created in Phase 5 (final discipline doc); Phase 1 lays the foundation per requirement ARCH-02.

### Theme tokens

- `.planning/research/ARCHITECTURE.md` §8 — three-tier token layering (primitive → semantic → component), Unistyles 3 wiring, motion curves, why Tamagui/Vanilla Extract were rejected.
- `packages/app/src/styles/theme.ts` — current in-flight file; Phase 1 migrates this.
- `packages/app/src/components/glass-surface.tsx` — current in-flight UI primitive; Phase 1 migrates this.
- `packages/app/src/components/daemon-connection-dot.tsx` — current in-flight component; Phase 1 migrates this.
- `packages/app/src/components/math-curve-loader/curves.ts` — motion curves source; Phase 1 lifts into `motion.ts` token.

### Local-daemon auth (ARCH-03)

- `.planning/research/ARCHITECTURE.md` §9 — three-mode auth design, file semantics (mode 0600, base64url 32-byte token), Tauri-startup token-write ordering, why TCP-loopback rules out SO_PEERCRED.
- `SECURITY.md` (repo root) — current trust model; Phase 1 updates this with all three modes.
- `packages/server/src/server/websocket-server.ts` — WS upgrade handler; Phase 1 adds the bearer-token gate (skipped in Mode A).
- `packages/desktop/src-tauri/src/daemon.rs` — Tauri daemon spawn site; Phase 1 writes the token file before subprocess spawn.

### Coding standards & platform discipline

- `CLAUDE.md` — repo-wide rules: never restart daemon on :6868 without permission, never run full test suite locally, always run `npm run typecheck && npm run lint && npm run format` after every change, bilingual en+zh parity for every visible string.
- `docs/CODING_STANDARDS.md` — type hygiene, error handling, state design, React patterns, file organization.
- `.planning/codebase/CONVENTIONS.md` — TypeScript hygiene, platform gating (`isWeb` / `isNative` / `getIsElectron()` / `useIsCompactFormFactor()`), file organization (kebab-case, no barrel `index.ts`), import aliases (`@/`, `@server/`).
- `docs/CODING_STANDARDS.md` "Platform Gating" — `isHovered || isNative || isCompact` pattern documented; NAV-A3 fix applies here. Hover only works on web.

### Bilingual i18n

- `packages/app/src/i18n/locales/en.json` — English strings (must update for any new copy in this phase: settings panel, auth-fail prompt, recovery toasts).
- `packages/app/src/i18n/locales/zh.json` — Simplified Chinese parity (CLAUDE.md hard rule).

### Testing

- `.planning/codebase/TESTING.md` — TDD workflow, real dependencies over mocks, test organization. Frozen-fixture parse tests live alongside `messages.ts` per this convention.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- **`packages/app/src/styles/theme.ts` + `glass-surface.tsx`** — already in flight; the token skeleton consolidates these into the three-tier structure rather than starting from scratch.
- **`packages/app/src/components/daemon-connection-dot.tsx`** — already exists; Phase 1 only migrates its color references to semantic tokens (NAT-05 wiring is Phase 3).
- **`packages/app/src/components/math-curve-loader/curves.ts`** — existing motion curves; lifted directly into `motion.ts`.
- **`packages/app/src/constants/platform.ts`** — `isWeb` / `isNative` already exported; NAV-A3 + NAT-03 fixes consume these directly.
- **`packages/server/src/shared/messages.ts`** — Zod schemas already at the WS boundary; ARCH-02 annotates them in place rather than rewriting.
- **`packages/server/src/server/agent/providers/opencode-agent.ts:1174`** — `listPersistedAgents` stub location; SES-02 fix replaces the stub.

### Established Patterns

- **`.web.ts` / `.native.ts` Metro split** — already used (e.g. `timeline-cache-store`); NAT-03 lint enforcement and the future glass-surface platform variants follow this pattern.
- **Zustand stores under `packages/app/src/stores/`** — flag store lives here; `chromeEnabled` migration runs at first store read.
- **React contexts under `packages/app/src/contexts/`** — `session-context.tsx` etc.; not modified in Phase 1 but referenced by handlers post-carve.
- **Per-connection state in `session.ts`** — current god-class state model; the carve splits this into per-handler state slices that own their subscriptions/debouncers/in-flight ids.

### Integration Points

- **`packages/server/src/server/session.ts`** — primary carve target. C-1 wraps with router, C-2 lifts Zod parse, C-3 extracts PermissionHandler.
- **`packages/server/src/server/websocket-server.ts`** — WS upgrade gate; ARCH-03 adds the bearer-token check before delegating to session/router.
- **`packages/desktop/src-tauri/src/daemon.rs`** — Tauri startup; writes `$OTTIE_HOME/local-token` before spawning daemon.
- **`packages/server/src/shared/messages.ts`** — ARCH-02 annotation site + `RESERVED_FIELDS` export; lint hooks here.
- **`packages/app/src/screens/settings/`** — new Settings → Advanced → Local daemon panel for D-13 lands here. Settings reorganization (Account / Agents / Voice / Appearance / Advanced) is Phase 4 — Phase 1 only adds the panel content, not the IA shuffle.
- **`packages/app/src/components/message.tsx`** — H13 chevron fix (`isHovered || isNative || isCompact`).
- **Resize-handle component** — C12 pointer-events fix; move pointer handlers behind `.web.ts` extension.

</code_context>

<specifics>
## Specific Ideas

- **`isHovered || isNative || isCompact` is the canonical hover-fallback expression** — explicitly documented in `CLAUDE.md` and `docs/CODING_STANDARDS.md`; the lint rule introduced in NAV-A3 looks for any `isHovered`-alone visibility gate and warns. Promoted from warn to error in Phase 5.
- **Daemon log path is the canonical debug surface** — auth-fail user copy explicitly references `$OTTIE_HOME/daemon.log` (PROJECT.md "User feedback themes").
- **`OTTIE_USE_NEW_ROUTER`-style flag naming** — research §13 mitigation row uses this exact spelling; planner should preserve it for grep continuity.
- **Tokens are TS, not DTCG JSON** — research §0 flags DTCG as an export target, never a build dependency. Phase 1 ships TS only.
- **No big-bang `session.ts` rewrite** — Anti-pattern §12.1 in research; lint or human reviewer should reject any PR that rewrites the file in one go.

</specifics>

<deferred>
## Deferred Ideas

- **Bug-fix PR shape (one bundle vs four)** — raised as a candidate gray area but user opted not to discuss; planner picks atomic-per-bug for clean blame, can revisit.
- **OpenCode recovery UX banner** ("Recovered N OpenCode sessions" toast) — SES-02 fix only requires the daemon-side method to work; any user-facing banner is Phase 4 polish.
- **Lint enforcement levels per rule** — all four lints (schema-evolution, hardcoded-color, isHovered-alone, onPointerEnter outside `.web.ts`) ship at warn-level in Phase 1 per ROADMAP.md; promoted to error in Phase 5. No mid-phase mixed-level discussion.
- **MessageRouter dispatch table format** (Map vs Record vs match-statement) — planner-level choice, not a user-vision question.
- **DTCG JSON export pipeline** — explicitly deferred to a future milestone (D-12).
- **Settings IA reorganization** (Account / Agents / Voice / Appearance / Advanced) — Phase 4 (SET-01). Phase 1 only adds the Local-daemon panel content under whatever the current settings shape is.
- **`SCHEMA_EVOLUTION.md` document** — written in Phase 5; Phase 1 only lays the annotation + `RESERVED_FIELDS` foundation.

</deferred>

---

_Phase: 1-Architectural Foundations & Gating Bug Fixes_
_Context gathered: 2026-04-30_
