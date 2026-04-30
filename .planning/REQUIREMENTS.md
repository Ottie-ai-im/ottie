# Requirements: Ottie v1.11 — User Flow Polish

**Defined:** 2026-04-30
**Core Value:** Controlling your local AI agents from your phone feels as immediate, trustworthy, and native as using the editor on your desktop — and stays out of the way the moment you don't need it.

> v1.x of Ottie is already shipped. This document defines requirements for the **v1.11 milestone only**. Capabilities the product already has are listed under "Validated" in `PROJECT.md`; the v1 list below is the v1.11 active scope.

---

## v1 Requirements

Requirements for the v1.11 milestone. Each maps to a roadmap phase. All shipped on top of v1.10 with backward-compat preserved for old clients.

### Architecture (gates everything else)

- [ ] **ARCH-01**: `packages/server/src/server/session.ts` is carved into a thin `MessageRouter` plus per-domain handlers (`AgentSessionHandler`, `PermissionHandler`, `VoiceSessionHandler`, `ChatSessionHandler`, `TerminalSessionHandler`, `FileExplorerHandler`, `ProjectsHandler`). Each carve step ships independently with CI green; final shell ≤500 lines (CONCERNS H3)
- [ ] **ARCH-02**: Schema-evolution discipline is in force — `RESERVED_FIELDS` registry, `@deprecated since=vX.Y removeAfter=vA.B` annotations, `docs/SCHEMA_EVOLUTION.md` removal calendar, CI lint blocks new shims without expiry. Frozen-fixture parse tests for v1.8 / v1.9 / v1.10 client schemas run in CI for any `messages.ts` change (CONCERNS H7)
- [ ] **ARCH-03**: Local daemon implements three-mode auth — loopback-trust default (unchanged for `npm run dev`), auto-token for Tauri-bundled daemon (`$OTTIE_HOME/local-token`, mode 0600), explicit env-var token for non-loopback. Documented in `SECURITY.md` (CONCERNS H2)

### A. Onboarding & First-Run

- [ ] **ONB-01**: First launch → first running agent in ≤3 user-initiated steps (excluding pair scan when daemon is local-bundled); measured end-to-end as a tappable count from cold app open
- [ ] **ONB-02**: First-run flow auto-detects local daemon presence and skips pair scan when running on desktop or same-machine; pair scan only requested when reaching out to a remote daemon
- [ ] **ONB-03**: Pair-scan failures present a self-serve recovery path inline (regenerate code, manual key entry, switch to local daemon) without restarting the app or losing typed input
- [ ] **ONB-04**: Welcome screen explains what Ottie is and what the user is about to do, in the user's chosen language (en / zh), with a "skip for power users" escape that lands them on the workspace screen

### B. Agent Switching & Invocation

- [ ] **AGT-01**: A single canonical "new agent" entry point is reachable via command-center, long-press on workspace, voice command, and keyboard shortcut. All four paths invoke the same `ActionRegistry` action with the same default provider/model/mode
- [ ] **AGT-02**: Provider / model / mode selection remembers last-used per workspace (MMKV-backed) and surfaces them inline in the new-agent flow rather than in a multi-screen wizard
- [ ] **AGT-03**: Switching the active agent is one tap from the agent list and one ⌘-keystroke from any screen on web/Tauri (`react-hotkeys-hook`-driven)
- [ ] **AGT-04**: Sending the first message to a freshly created agent reaches the daemon in ≤2 user-visible taps (target → prompt → send) with optimistic feedback before the daemon's first event. Implementation: `OptimisticAgentStore`, client-supplied `clientNonce` echoed by daemon on `agent_update`, new `AgentCreateRejected` message kind for explicit failures (60-second TTL, visible-failure on timeout)
- [ ] **AGT-05**: Permission requests render with full tool-call context (file diffs syntax-highlighted, command preview with cwd, write-target paths) and a single-tap approve / deny / edit-then-approve. Two-tier discipline: low-risk allowlisted actions auto-approve with audit trail; high-risk actions never auto-approve. Decision is broadcast to all connected clients so the same prompt cannot be approved twice from different devices
- [ ] **AGT-06**: Action surface is backed by a single `ActionRegistry` (`packages/app/src/actions/registry.ts`) — every voice intent, command-center entry, long-press menu item, and keybinding dispatches by action ID. CI parity test asserts every registry action reachable from ≥2 modalities (web/Tauri) or ≥1 modality (native)

### C. Session & Conversation Management

- [ ] **SES-01**: Most-recent N sessions surface in the sidebar (or equivalent on mobile) with one-tap resume and inline status indicators (running / awaiting input / failed). Order: daemon-computed by `lastUserInteractionAt`
- [ ] **SES-02**: OpenCode `listPersistedAgents` returns recovered sessions after daemon restart (resolves CONCERNS H4 — current implementation always returns `[]`). UAT: kill daemon mid-session, restart, sessions appear in the recents list
- [ ] **SES-03**: Timeline rendering shows partial state immediately on session open; backfill streams in via WebSocket without blocking interaction. Empty list is never shown for known-non-empty sessions
- [ ] **SES-04**: Long timelines remain interactive — TanStack Virtual scrolling, search by content / tool name, jump-to-tool-call. Acceptance: no jank past N=1000 events on iPhone 13 baseline
- [ ] **SES-05**: Cross-device session continuity — opening the same workspace on phone after desktop work resumes at the right point (last viewed message + scroll position broadcast via daemon-computed `recent_sessions_update`)

### D. Sidebar & Navigation

- [ ] **NAV-A1**: Information hierarchy collapses cleanly — host → workspace → agent — with consistent affordances (kebab menu, hover/touch state, status indicator) at every level
- [ ] **NAV-A2**: Compact form factor (`useIsCompactFormFactor()` hook) auto-collapses sidebar overlay; switching workspaces is one tap when one is sufficient (no two-tap workspace-then-confirm)
- [ ] **NAV-A3**: Hover-only controls (rename, settings, kebab menus) are always visible on native via `isHovered || isNative || isCompact` pattern. CI lint enforces (resolves CONCERNS H13 — message chevron). No `onPointerEnter`/`onPointerLeave` outside `.web.ts` files (resolves CONCERNS C12)
- [ ] **NAV-A4**: Command center is the universal action surface — workspace switch, agent create, settings jump, recent sessions, voice trigger. Powered by `cmdk` on web/Tauri (Metro `.web.ts`) and a bottom-sheet variant on native (Metro `.native.ts`)
- [ ] **NAV-A5**: Mobile tab bar and sidebar share one navigation model — every destination reachable from both surfaces, no orphaned screens

### E. Settings & Preferences

- [ ] **SET-01**: Settings reorganized around user intent: Account / Agents / Voice / Appearance / Advanced. The Advanced section preserves access to legacy / power-user settings; nothing removed
- [ ] **SET-02**: `chromeEnabled` flag split into independent feature flags for layout and keyboard shortcuts (resolves CONCERNS C11). Migration: existing-user value preserved for both flags' defaults
- [ ] **SET-03**: Theme, language, and voice settings are reachable in ≤2 taps from any screen (typically: command-center → setting jump)
- [ ] **SET-04**: Labs section clearly labels stability per item (Experimental / Beta / Stable) and lets users opt-in/out of individual experiments rather than batch-toggling

### F. Cross-Cutting — Otter Theme & Visual Language

- [ ] **THM-01**: Single source of truth for design tokens — colors, surfaces, elevations, typography, motion curves — landed at `packages/app/src/styles/tokens/` as primitive → semantic → component three-tier on top of Unistyles 3. CI lint warns on hardcoded hex/rgb/rgba in `packages/app/src/`; counter-test in CI guarantees the count never increases (formalizes the in-flight `theme.ts` + `glass-surface` work)
- [ ] **THM-02**: Every modal / sheet / popover / bottom-sheet / dropdown uses the same `<GlassSurface>` treatment (Liquid Glass on iOS 26, `expo-blur` fallback below, web-equivalent on browsers/Tauri). Light/dark parity audited against AA contrast
- [ ] **THM-03**: Loading, empty, and error states share a consistent visual language — math-curve loader formalized, callout cards on `<GlassSurface>`, toasts via `burnt`, error vocabulary documented
- [ ] **THM-04**: Otter character / brand presence is consistent — splash, welcome, empty states, and key delight moments (first-agent-created, first-permission-approved, first-voice-command). Brand assets centralized

### G. Cross-Cutting — Native-Feel AI

- [ ] **NAT-01**: Voice / command-center / long-press / keyboard parity ≥80% — at least the following are reachable from voice + ≥1 other modality: create agent, switch workspace, jump to recent session, approve/deny pending permission, open settings, toggle theme. Enforced by CI parity test
- [ ] **NAT-02**: Haptics fire on every meaningful state transition — single `useHaptic()` hook with semantic vocabulary (light=info, medium=action-confirmed, heavy=permission-required). Debounced; respects low-power-mode and the user's haptic toggle in settings
- [ ] **NAT-03**: Pointer-event regressions on native fixed (resolves CONCERNS C12) — lint enforces `onPointerEnter`/`onPointerLeave` only inside `.web.ts` files. Promoted from warn to error before Phase 4 ships
- [ ] **NAT-04**: AI-generated text in messages renders with a smoothed, typing-style animation — the in-flight `use-smoothed-text` hook is wired everywhere (current usage scattered)
- [ ] **NAT-05**: Daemon connection state is always visible and trustworthy — `daemon-connection-dot` (green/amber/red) + version-mismatch callout + offline-recovery prompt. Optimistic side-effect UI is automatically suppressed when amber/red

---

## v2 Requirements

Acknowledged for future milestones. Not in v1.11 scope.

### v1.12+ — Differentiator Features

- **DF-A1**: LAN auto-pair without QR (depends on ARCH-03 landing first)
- **DF-B3**: Parallel-agent dashboard (split-view of N running agents)
- **DF-C2**: Fork session from any timeline point (depends on all providers persisting correctly first)
- **DF-D2**: Frecency ranking for command-center entries
- **DF-D3**: Pull-down gesture from any screen invokes command center on native
- **DF-G1**: "Hey Ottie" wake-word voice activation
- **DF-G3**: Lift-to-listen gesture
- **DF-G4**: Apple Shortcuts integration (Siri intents)
- **DF-G5**: Live Activities / Dynamic Island for running agents

### v1.13+ — Architectural Modernization

- **ARC-V12-01**: Migrate to React Native New Architecture (Fabric + TurboModules); gates MMKV v3+, FlashList v2, Native Tabs
- **ARC-V12-02**: FlashList v2 adoption (`@shopify/flash-list@^2.3.1`) for agent lists and timelines (depends on New Arch)
- **ARC-V12-03**: Native Tabs adoption (Expo Router) once stable

### v1.14+ — Security & Infrastructure

- **SEC-01**: Relay intra-session replay protection via message counters (CONCERNS H1)
- **SEC-02**: SQLite timeline retention policy / pruning (CONCERNS M5)
- **TST-01**: Multi-agent orchestration tests beyond placeholders (CONCERNS M6)
- **DEP-01**: `node-pty` upgrade off `1.2.0-beta.11` (CONCERNS M9)

---

## Out of Scope

Explicitly excluded from v1.11 to prevent scope creep.

| Feature                                             | Reason                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Cloud-hosted agent execution                        | Local-first is the brand; building a hosted backend would invalidate the privacy story              |
| New agent providers (Cursor, Aider, etc.)           | v1.11 is polish, not feature addition                                                               |
| Marketing website rebuild (`packages/website` stub) | Separate milestone; doesn't intersect with the user-flow polish goal                                |
| Schema-breaking changes                             | All v1.11 schema changes must be backward-compatible; old mobile clients keep working               |
| Relay protocol replacement                          | Defer to a security-focused milestone unless research surfaces a UX blocker                         |
| `node-pty` major upgrade                            | Pinned beta stays pinned in v1.11; dedicated dependency milestone owns this                         |
| Test-coverage backfill outside touched code         | Improving test coverage on code v1.11 doesn't modify is out of scope                                |
| "Hey Ottie" wake word                               | Genuinely category-defining but too large for a polish milestone — v1.12+                           |
| Live Activities / Dynamic Island                    | Large iOS platform integration; separate milestone — v1.12+                                         |
| Apple Shortcuts integration                         | Depends on ActionRegistry stability + Siri intents work — v1.12+                                    |
| Big-bang `session.ts` rewrite                       | The carve is incremental; rewrite in one PR would be high-risk                                      |
| Tamagui / NativeWind / valibot adoption             | Conflicts with existing stack (Unistyles 3 / Zod 4.4); pattern adoption preferred over library swap |
| LAN auto-pair UX                                    | ARCH-03 lands the daemon-side foundation; full UX is v1.12                                          |
| FlashList v2 / MMKV v3+ adoption                    | Depends on New Architecture being on; verify before any phase can plan against these                |

---

## Traceability

Filled by the gsd-roadmapper after roadmap creation (2026-04-30).

| Requirement | Phase | Status  |
| ----------- | ----- | ------- |
| ARCH-01     | 1     | Pending |
| ARCH-02     | 1     | Pending |
| ARCH-03     | 1     | Pending |
| ONB-01      | 4     | Pending |
| ONB-02      | 4     | Pending |
| ONB-03      | 4     | Pending |
| ONB-04      | 4     | Pending |
| AGT-01      | 2     | Pending |
| AGT-02      | 2     | Pending |
| AGT-03      | 2     | Pending |
| AGT-04      | 3     | Pending |
| AGT-05      | 3     | Pending |
| AGT-06      | 2     | Pending |
| SES-01      | 2     | Pending |
| SES-02      | 1     | Pending |
| SES-03      | 3     | Pending |
| SES-04      | 3     | Pending |
| SES-05      | 3     | Pending |
| NAV-A1      | 4     | Pending |
| NAV-A2      | 4     | Pending |
| NAV-A3      | 1     | Pending |
| NAV-A4      | 2     | Pending |
| NAV-A5      | 4     | Pending |
| SET-01      | 4     | Pending |
| SET-02      | 1     | Pending |
| SET-03      | 4     | Pending |
| SET-04      | 4     | Pending |
| THM-01      | 1     | Pending |
| THM-02      | 4     | Pending |
| THM-03      | 4     | Pending |
| THM-04      | 4     | Pending |
| NAT-01      | 4     | Pending |
| NAT-02      | 4     | Pending |
| NAT-03      | 1     | Pending |
| NAT-04      | 4     | Pending |
| NAT-05      | 3     | Pending |

**Coverage:**

- v1 requirements: 36 total (3 ARCH + 4 ONB + 6 AGT + 5 SES + 5 NAV + 4 SET + 4 THM + 5 NAT)
- Mapped to phases: 36 / 36 ✓
- Unmapped: 0
- Per-phase distribution: Phase 1 = 8 (ARCH-01, ARCH-02, ARCH-03, THM-01, NAV-A3, NAT-03, SES-02, SET-02); Phase 2 = 6 (AGT-01, AGT-02, AGT-03, AGT-06, SES-01, NAV-A4); Phase 3 = 6 (AGT-04, AGT-05, SES-03, SES-04, SES-05, NAT-05); Phase 4 = 16 (ONB-01..04, NAV-A1, NAV-A2, NAV-A5, SET-01, SET-03, SET-04, THM-02, THM-03, THM-04, NAT-01, NAT-02, NAT-04); Phase 5 = 0 net-new (verifies completion of all 36).

---

_Requirements defined: 2026-04-30_
_Last updated: 2026-04-30 — Traceability filled by roadmapper (5 phases, 36/36 mapped)_
