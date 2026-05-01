# Roadmap: Ottie v1.11 — User Flow Polish

**Defined:** 2026-04-30
**Milestone:** v1.11 (subsequent milestone on shipped product)
**Granularity:** standard (5 phases)
**Coverage:** 36 / 36 v1 requirements mapped

## Overview

v1.11 transforms cumulative UX friction into coherent flow without rebuilding any shipped subsystem. We carve `session.ts` first because every parallel phase touches it; we land schema discipline first because every new field needs it; we fix the four shipped regressions (H13, C12, H4, C11) first because polish work on top of broken foundations is dishonest. Then we wire the universal `ActionRegistry` that makes voice / command-center / long-press / keyboard one product instead of four. Then we deliver the two highest-impact user-visible wins — optimistic agent creation and rich permission approval — on the seams the carve created. Then we sweep navigation, settings, onboarding, and the otter theme into one consistent surface. Finally we close the carve, promote lints from warn to error, and audit every PROJECT.md acceptance criterion before declaring v1.11 done.

The five-phase ordering is dictated by three hard dependency chains: (1) the `session.ts` carve gates every feature that touches handlers; (2) the `ActionRegistry` gates every modality that dispatches user intent; (3) the theme tokens gate every surface migration. Skipping any chain forces double-rework downstream.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3, 4, 5): Planned milestone work
- Decimal phases (e.g. 2.1) reserved for urgent insertions only

- [x] **Phase 1: Architectural Foundations & Gating Bug Fixes** - Carve `session.ts` seams (C-1/C-2/C-3), schema discipline, local-token auth, theme token skeleton, fix four shipped regressions. _(complete 2026-05-01)_
- [ ] **Phase 2: Onboarding, Navigation, Settings, Theme & Native-Feel Polish** - Sweep UX coherence: onboarding, sidebar/nav model, intent-organized settings, glass surfaces, voice/keyboard/long-press parity, haptics, smoothed text.

## Phase Details

### Phase 1: Architectural Foundations & Gating Bug Fixes

**Goal**: Every seam, lint rule, and gating bug-fix that subsequent phases depend on is in place. No feature work until the router is carved (C-1/C-2/C-3), schema discipline is enforced (warn-only), the theme token skeleton exists, the local-token auth path is shipped behind a default-off flag, and the four shipped regressions are closed.
**Depends on**: Nothing (first phase of milestone, builds on shipped v1.10)
**Requirements**: ARCH-01, ARCH-02, ARCH-03, THM-01, NAV-A3, NAT-03, SES-02, SET-02
**Success Criteria** (what must be TRUE):

1. `MessageRouter` (C-1) and Zod parse boundary (C-2) are extracted from `session.ts`; every WS message kind dispatches via the router with full type narrowing in handlers, and `PermissionHandler` (C-3) is fully carved.
2. Old mobile clients (v1.8 / v1.9 / v1.10 frozen-fixture parse tests) still parse new daemon outbound messages in CI; `RESERVED_FIELDS` registry exists; `@deprecated since= removeAfter=` lint runs in warn-only mode; the in-flight `theme.ts` rewrite is consolidated into `packages/app/src/styles/tokens/` (primitive → semantic → component) with the hardcoded-color lint warning on every new file under `packages/app/src/`.
3. `LocalTokenAuth` (ARCH-03) ships in three modes: loopback-trust default unchanged for `npm run dev`, auto-token at `$OTTIE_HOME/local-token` (mode 0600) for the Tauri-bundled daemon, env-var token for non-loopback. `SECURITY.md` reflects all three modes.
4. Message chevron (CONCERNS H13) is visible on iOS / Android via the `isHovered || isNative || isCompact` pattern; the lint rule blocks `isHovered`-alone visibility gates going forward.
5. The resize handle no longer uses `onPointerEnter`/`onPointerLeave` outside `.web.ts` (CONCERNS C12); the lint rule is in place at warn-level (promoted to error in Phase 5). OpenCode `listPersistedAgents` (CONCERNS H4) returns recovered sessions after a daemon restart in a UAT cycle; `chromeEnabled` (CONCERNS C11) is split into independent layout / shortcut feature flags with existing-user values preserved.

**Plans:** 5 plans

Plans:

- [x] 01-01-PLAN.md — Schema-evolution discipline: RESERVED_FIELDS export, frozen-fixture v1.8/v1.9/v1.10 parse tests, warn-level @deprecated annotation lint (ARCH-02)
- [x] 01-02-PLAN.md — Theme token skeleton + targeted migration (theme.ts/glass-surface/daemon-connection-dot/curves) + warn-level hardcoded-color lint with counter-baseline (THM-01)
- [x] 01-03-PLAN.md — Bug fixes bundle (atomic-per-bug): chevron + isHovered-alone lint (NAV-A3), resize-handle pointer-events + lint (NAT-03), OpenCode listPersistedAgents (SES-02), chromeEnabled split (SET-02)
- [x] 01-04-PLAN.md — Carve C-1/C-2/C-3: MessageRouter, Zod parse boundary, PermissionHandler with Strangler-Fig env flags (ARCH-01)
- [x] 01-05-PLAN.md — Local-token auth three modes (loopback-trust / Tauri token-file / env var) + Settings panel (en+zh) + SECURITY.md update + log redaction (ARCH-03)

### Phase 2: Onboarding, Navigation, Settings, Theme & Native-Feel Polish

**Goal**: Sweep the user-visible polish in one coherent pass on top of the seams that now exist. Onboarding feels obvious, navigation has one model across mobile and desktop, settings reorganize around user intent, every glass surface uses the same primitive, and native-feel interactions (haptics, voice/keyboard/long-press parity, smoothed AI text) are consistent across the app.
**Depends on**: Phase 2 (needs optimistic UI patterns proven; needs voice handler carved before voice parity refactor; needs theme token skeleton stable before surface migration)
**Requirements**: ONB-01, ONB-02, ONB-03, ONB-04, NAV-A1, NAV-A2, NAV-A5, SET-01, SET-03, SET-04, THM-02, THM-03, THM-04, NAT-01, NAT-02, NAT-04
**Success Criteria** (what must be TRUE):

1. From cold app open, a new user reaches their first running agent in ≤3 user-initiated taps when the daemon is local-bundled (pair-scan auto-skipped on desktop / same-machine); pair-scan failures surface inline self-serve recovery (regenerate code, manual key entry, switch to local daemon) without restarting the app or losing typed input; the welcome screen renders in en/zh with a "skip for power users" escape that lands on the workspace screen.
2. The host → workspace → agent hierarchy uses consistent kebab / hover-or-touch / status affordances at every level; the sidebar overlay auto-collapses on compact form factors; switching workspaces is one tap (no two-tap workspace-then-confirm); the mobile tab bar and sidebar reach every destination with no orphaned screens.
3. Settings are organized as Account / Agents / Voice / Appearance / Advanced (Advanced preserves all legacy / power-user settings — nothing removed); theme, language, and voice settings are reachable in ≤2 taps from any screen via command-center jumps; the Labs section labels each item Experimental / Beta / Stable and lets users opt-in/out individually.
4. Every modal, sheet, popover, bottom-sheet, and dropdown uses `<GlassSurface>` (Liquid Glass on iOS 26, `expo-blur` fallback below, web-equivalent on browsers/Tauri); light/dark contrast passes AA audit; loading / empty / error states share one visual language (math-curve loader formalized, callout cards on `<GlassSurface>`, `burnt` toasts); otter brand presence is consistent across splash, welcome, empty states, and the first-agent-created / first-permission-approved / first-voice-command delight moments.
5. Voice / command-center / long-press / keyboard parity ≥80% on the named action set (create agent, switch workspace, jump to recent session, approve/deny pending permission, open settings, toggle theme), enforced by the CI parity test from Phase 2; the `useHaptic()` hook fires light/medium/heavy haptics on every meaningful state transition (debounced, low-power-mode aware, settings-respecting); AI-generated text in messages renders via `use-smoothed-text` everywhere it appears.
   **Plans**: TBD
   **UI hint**: yes
   **AI hint**: yes
