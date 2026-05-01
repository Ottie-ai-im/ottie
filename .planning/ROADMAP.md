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
- [ ] **Phase 2: Action Surface & Session Foundations** - Land `ActionRegistry`, `cmdk` command-center split, keyboard shortcuts, last-used per-workspace defaults, recent-sessions sidebar.
- [ ] **Phase 3: Optimistic Flows & Permission UX** - Carve `AgentSessionHandler` (C-7) and `VoiceSessionHandler` (C-6); ship optimistic agent creation, rich permission UX, timeline partial-state, daemon connection state.
- [ ] **Phase 4: Onboarding, Navigation, Settings, Theme & Native-Feel Polish** - Sweep UX coherence: onboarding, sidebar/nav model, intent-organized settings, glass surfaces, voice/keyboard/long-press parity, haptics, smoothed text.
- [ ] **Phase 5: Carve Completion, Audit & Documentation** - Finish the carve (C-4 Terminal, C-9 shell delete), promote lints to error, write `SCHEMA_EVOLUTION.md` and `SECURITY.md` updates, run "looks-done-but-isn't" audit.

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

### Phase 2: Action Surface & Session Foundations

**Goal**: Establish the universal action registry that every modality dispatches through, and complete the daemon-side carves that enable cross-device recents. By phase end, voice / command-center / long-press / keyboard all dispatch by action ID, the `cmdk`-driven web command center has replaced the bespoke filter code, and recent sessions are computed daemon-side and surfaced in the sidebar with one-tap resume.
**Depends on**: Phase 1 (needs `MessageRouter`, theme tokens, schema discipline)
**Requirements**: AGT-06, AGT-01, AGT-02, AGT-03, SES-01, NAV-A4
**Success Criteria** (what must be TRUE):

1. A user can create a new agent via the command center, long-press on a workspace, voice command, or keyboard shortcut, and all four paths land them in the same destination with the same defaults — backed by a single `ActionRegistry` entry (`packages/app/src/actions/registry.ts`) plus a CI parity test that fails if any registered action is reachable from fewer modalities than declared.
2. On web/Tauri, `cmdk` powers the command center via Metro `.web.ts` (and a bottom-sheet equivalent on `.native.ts`); `react-hotkeys-hook` binds keyboard shortcuts read directly from `ActionRegistry` keybinding metadata.
3. Switching the active agent is one tap from the agent list and one ⌘-keystroke from any screen on web/Tauri; provider/model/mode is remembered per workspace via MMKV (version pinned conditional on the New Architecture verification spike) and surfaces inline in the new-agent flow rather than a multi-screen wizard.
4. The sidebar (or compact-form-factor equivalent) shows the most-recent N sessions with status indicators (running / awaiting input / failed), ordered by daemon-computed `lastUserInteractionAt`, and tapping one resumes the session in one tap.
   **Plans**: TBD
   **UI hint**: yes
   **AI hint**: yes

### Phase 3: Optimistic Flows & Permission UX

**Goal**: Deliver the two highest-impact user-visible wins of v1.11 — instant agent-creation feedback and rich permission approval — on the carve seams. By phase end, `AgentSessionHandler` (C-7) and `VoiceSessionHandler` (C-6) are carved, optimistic agent creation reconciles via client nonce, permission requests render full tool-call context with multi-device decision broadcast, timelines show partial state immediately, and the daemon connection dot suppresses optimistic side-effect UI when amber/red.
**Depends on**: Phase 2 (needs `ActionRegistry` for voice/keybinding dispatch; needs `ProjectsHandler` recents broadcast for cross-device continuity)
**Requirements**: AGT-04, AGT-05, SES-03, SES-04, SES-05, NAT-05
**Success Criteria** (what must be TRUE):

1. Sending the first message to a freshly created agent reaches the daemon in ≤2 user-visible taps with optimistic feedback rendered before the daemon's first `agent_update` event; the optimistic record reconciles by `clientNonce` echo or transitions to a visible-failure state on `AgentCreateRejected` or 60-second timeout, never silently aging out.
2. A permission request renders syntax-highlighted file diffs, command preview with cwd, and write-target paths, and a single tap approves / denies / opens an edit-then-approve sheet; the decision broadcasts to all connected clients so the same prompt cannot be approved twice from different devices, and low-risk allowlisted actions auto-approve with an audit trail while high-risk actions never auto-approve.
3. Opening a session shows partial timeline state immediately (no empty-state flash for known-non-empty sessions); backfill streams in via WebSocket without blocking interaction, and a 1,000-event timeline stays interactive on the iPhone 13 baseline with TanStack Virtual scrolling, content/tool search, and jump-to-tool-call.
4. Opening the same workspace on phone after desktop work resumes at the right point — daemon-broadcast `recent_sessions_update` carries last-viewed message + scroll position, and OpenCode sessions recovered in Phase 1 appear in the recents list across devices.
5. The daemon connection dot shows green / amber / red from every screen with a version-mismatch callout and an offline-recovery prompt; when amber/red, optimistic side-effect UI (permission approve, agent stop) is automatically suppressed and the user sees explicit pending states instead.
   **Plans**: TBD
   **UI hint**: yes
   **AI hint**: yes

### Phase 4: Onboarding, Navigation, Settings, Theme & Native-Feel Polish

**Goal**: Sweep the user-visible polish in one coherent pass on top of the seams that now exist. Onboarding feels obvious, navigation has one model across mobile and desktop, settings reorganize around user intent, every glass surface uses the same primitive, and native-feel interactions (haptics, voice/keyboard/long-press parity, smoothed AI text) are consistent across the app.
**Depends on**: Phase 3 (needs optimistic UI patterns proven; needs voice handler carved before voice parity refactor; needs theme token skeleton stable before surface migration)
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

### Phase 5: Carve Completion, Audit & Documentation

**Goal**: Close the carve, promote enforcement, and confirm that every PROJECT.md acceptance criterion was actually met — not just implemented. By phase end the `session.ts` shell is ≤500 lines, all schema lints are at error level, `docs/SCHEMA_EVOLUTION.md` and updated `SECURITY.md` are merged, ≥1 deprecated field has been removed per the new schedule, and the cross-platform / parity / hover-only / frozen-fixture / zh.json checklist is signed off.
**Depends on**: Phase 4 (final carve steps are safer once handlers are stable; lint promotion happens after the codebase is clean)
**Requirements**: (none — this phase verifies completion of all 36 v1 requirements; no new requirement is introduced here)
**Success Criteria** (what must be TRUE):

1. `TerminalSessionHandler` (C-4) is carved; the `session.ts` shell (C-9) is deleted down to a thin per-connection container ≤500 lines holding only handshake, lifecycle hooks, router instance, and handler graph; CI passes the carve smoke matrix.
2. The schema-discipline lint is promoted from warn-only to error; `docs/SCHEMA_EVOLUTION.md` documents `RESERVED_FIELDS`, the removal calendar, and the behavioral-contract per message kind; `SECURITY.md` reflects ARCH-03 three-mode auth in detail; ≥1 deprecated field has been removed per the calendar.
3. The "looks done but isn't" audit passes: cross-platform screenshots from web / iOS / Android / Tauri on every `packages/app/` surface change; the parity test enumerates every `ActionRegistry` action and asserts modality reachability; the hover-only-gate audit shows zero `isHovered`-alone gates outside grandfathered exemptions; v1.8 / v1.9 / v1.10 frozen-fixture parse tests run green; `en.json` / `zh.json` parity is at 100% for every string touched.
4. Performance audit confirms the hard targets from PROJECT.md: timeline interactive past N=1000 events on iPhone 13, touch responses ≤100ms, agent-creation feedback ≤200ms perceived latency.
   **Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase                                                           | Plans Complete | Status      | Completed  |
| --------------------------------------------------------------- | -------------- | ----------- | ---------- |
| 1. Architectural Foundations & Gating Bug Fixes                 | 5/5            | Complete    | 2026-05-01 |
| 2. Action Surface & Session Foundations                         | 0/TBD          | Not started | -          |
| 3. Optimistic Flows & Permission UX                             | 0/TBD          | Not started | -          |
| 4. Onboarding, Navigation, Settings, Theme & Native-Feel Polish | 0/TBD          | Not started | -          |
| 5. Carve Completion, Audit & Documentation                      | 0/TBD          | Not started | -          |

## Risk Callouts (per phase, sourced from PITFALLS.md)

**Phase 1** — Pitfalls 2, 3, 5, 8, 9 (carve antipatterns, schema-deprecation traps, theme retrofit drift, cross-platform regression blind spots). Mitigations are baked into the success criteria: ownership-based carving in commit-sized increments, frozen-fixture parse tests in CI, hardcoded-color lint at phase start, lint-enforced platform gates.

**Phase 2** — Pitfalls 1, 4 (polish becoming redesign, voice/command/keyboard parity rot). Mitigations: in-bounds/out-of-bounds line per phase, ActionRegistry as the only place actions are defined, CI parity test from day one of the registry's existence.

**Phase 3** — Pitfalls 6, 10 (optimistic UI lying about side-effect actions, permission UX failure modes). Mitigations: tiered optimism (side-effect actions never optimistic), distinct sent-vs-delivered visuals, action-frozen-at-prompt-time, multi-device decision broadcast, permission seam mapped in a planning spike before phase start.

**Phase 4** — Pitfalls 1, 4, 5, 8 (scope creep, parity rot, theme migration stalls, cross-platform blind spots). Mitigations: dense numeric acceptance criteria, surface-by-surface theme migration with screenshot review, `expo-glass-effect` validated on iOS 26 dev build before Liquid Glass commitments, three-platform screenshot requirement.

**Phase 5** — Pitfalls 2, 3, 7, 9 (carve completion drift, deprecation accumulation, ownership boundaries that aren't real). Mitigations: hard ≤500-line target on `session.ts` shell, ≥1 deprecated-field removal per milestone exit criterion, post-carve audit asserting no carved files import each other in cycles.

## Research Flags (per phase entry)

- **Phase 2 start:** Verify New Architecture status (`android/gradle.properties` `newArchEnabled`, iOS `Podfile` `new_arch_enabled`). Gates MMKV pin version (v2.x on legacy arch, v3+ on New Arch).
- **Phase 2 start:** Confirm Tauri global-shortcut bridge surface; if not exposed, scope `Cmd+Shift+O`-summon to in-window only and defer global-summon to v1.12.
- **Phase 3 start:** Half-day permission-decision-durability spike — action-byte capture at prompt time, multi-device broadcast interaction with the existing MCP queue. Not a research phase; a seam-mapping session before plans land.
- **Phase 4 start:** Validate `expo-glass-effect` in a development build on iOS 26 before committing to Liquid Glass surfaces; `expo-blur` fallback path is the safe default if validation fails.

## Traceability

| Requirement | Phase | Notes                                                                                          |
| ----------- | ----- | ---------------------------------------------------------------------------------------------- |
| ARCH-01     | 1     | C-1, C-2, C-3 in Phase 1; C-4 / C-6 / C-7 in Phases 3 / 5; C-9 shell delete in Phase 5         |
| ARCH-02     | 1     | Skeleton + warn lint in Phase 1; promoted to error in Phase 5                                  |
| ARCH-03     | 1     | Three-mode auth + SECURITY.md detail update in Phase 5                                         |
| THM-01      | 1     | Token skeleton + hardcoded-color lint warn-only                                                |
| NAV-A3      | 1     | Resolves CONCERNS H13 (chevron) + lint enforcement of `isHovered \|\| isNative \|\| isCompact` |
| NAT-03      | 1     | Resolves CONCERNS C12; lint promotion to error happens in Phase 5                              |
| SES-02      | 1     | Resolves CONCERNS H4 — OpenCode `listPersistedAgents` proper implementation                    |
| SET-02      | 1     | Resolves CONCERNS C11 — `chromeEnabled` flag split with default preservation                   |
| AGT-06      | 2     | `ActionRegistry` lands first within Phase 2 to gate AGT-01..03, NAV-A4                         |
| AGT-01      | 2     | Canonical "new agent" entry point dispatched via ActionRegistry                                |
| AGT-02      | 2     | MMKV-backed last-used per workspace (version conditional on New Arch verification)             |
| AGT-03      | 2     | `react-hotkeys-hook` keybindings read from ActionRegistry                                      |
| SES-01      | 2     | Daemon-computed recents via C-8 ProjectsHandler broadcast                                      |
| NAV-A4      | 2     | `cmdk` web/Tauri + bottom-sheet native via Metro `.web.ts` / `.native.ts`                      |
| AGT-04      | 3     | Optimistic create with client nonce; depends on C-7 carve in same phase                        |
| AGT-05      | 3     | Permission UX with multi-device broadcast; depends on C-3 from Phase 1                         |
| SES-03      | 3     | Partial timeline state on session open                                                         |
| SES-04      | 3     | TanStack Virtual + search + jump-to-tool-call past N=1000                                      |
| SES-05      | 3     | `recent_sessions_update` broadcast carries last-viewed + scroll position                       |
| NAT-05      | 3     | Daemon connection dot suppresses optimistic side-effect UI when amber/red                      |
| ONB-01      | 4     | ≤3 taps cold-open → first running agent (local-bundled)                                        |
| ONB-02      | 4     | Auto-detect local daemon, skip pair scan                                                       |
| ONB-03      | 4     | Inline pair-failure recovery without app restart                                               |
| ONB-04      | 4     | Localized welcome + skip-for-power-users                                                       |
| NAV-A1      | 4     | Host → workspace → agent hierarchy with consistent affordances                                 |
| NAV-A2      | 4     | Compact form factor auto-collapse, one-tap workspace switch                                    |
| NAV-A5      | 4     | Tab bar + sidebar share one navigation model                                                   |
| SET-01      | 4     | Account / Agents / Voice / Appearance / Advanced reorganization                                |
| SET-03      | 4     | Theme / language / voice ≤2 taps from any screen                                               |
| SET-04      | 4     | Labs section per-item stability labels                                                         |
| THM-02      | 4     | Glass surface treatment on every modal / sheet / popover                                       |
| THM-03      | 4     | Loading / empty / error visual language consistency                                            |
| THM-04      | 4     | Otter brand presence in splash / welcome / delight moments                                     |
| NAT-01      | 4     | Voice / command-center / long-press / keyboard parity ≥80%                                     |
| NAT-02      | 4     | `useHaptic()` semantic vocabulary, debounced + settings-aware                                  |
| NAT-04      | 4     | `use-smoothed-text` wired everywhere AI text appears                                           |

**Coverage:** 36 / 36 v1 requirements mapped (8 in Phase 1, 6 in Phase 2, 6 in Phase 3, 16 in Phase 4, 0 net-new in Phase 5). No orphans, no duplicates.

---

_Roadmap defined: 2026-04-30 (v1.11 milestone — User Flow Polish)_
