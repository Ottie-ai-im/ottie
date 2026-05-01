---
phase: 02
phase-slug: onboarding-navigation-settings-theme-native-feel-polish
artifact: research
date: 2026-05-01
---

# Phase 2: Onboarding, Navigation, Settings, Theme & Native-Feel Polish — Research

**Researched:** 2026-05-01
**Domain:** Cross-platform UX polish — Expo Router 6 + React 19 + Unistyles 3 on top of Phase-1 foundations
**Confidence:** HIGH on existing files / patterns / token tree (codebase grepped this session); HIGH on npm package versions (verified via `npm view` this session); MEDIUM on `expo-glass-effect` runtime behavior (carries open Phase 1 research flag); MEDIUM on the right native-side surface of `cmdk`/`react-hotkeys-hook` (versions verified, integration patterns inferred from research/STACK.md).

## Summary

Phase 2 is a cross-cutting polish sweep that lands seven concrete deliverables on top of the seams Phase 1 already shipped: **WeChat-style nav shell** (Tab + Stack), **`ActionRegistry` + `cmdk` + `react-hotkeys-hook`**, **5-bucket flat settings list**, **surface migration onto `<GlassSurface>`**, **toast-led visual language with `burnt`**, **single-source `useHaptic()` + smoothed-text collapse**, and **restrained Otter brand placement**. The heaviest lift is reshaping `sessions-screen.tsx` into the WeChat-style chat list (`<ChatRow>`, long-press menu, swipe-left, top-right `+`, total-unread popup) — that one screen drives most of the new components in `Component Inventory` of the UI-SPEC.

Every Phase-1 foundation needed for this phase is already on disk: `<GlassSurface>` at `packages/app/src/components/ui/glass-surface.tsx`, the three-tier token tree at `packages/app/src/styles/tokens/`, the `useIsCompactFormFactor()` + four-gate platform model at `packages/app/src/constants/{platform,layout}.ts`, the `<MobileTabBar>` and `<DesktopNavRail>` (already 4-tab: chats / devices / community / settings, both routing through `router.replace`), the `<MathCurveLoader>` with Metro `.web.tsx` / `.native.tsx` split, `expo-haptics@~15.0.7` already installed, and `@gorhom/bottom-sheet@^5.2.6` already installed for the native command-center variant. The keyboard infrastructure (`keyboard/keyboard-action-dispatcher.ts`) and voice intent registry (`voice-control/voice-commands.ts` with 10 commands) both exist as separate dispatch surfaces — the ActionRegistry seam unifies them.

**Persistence research-flag resolved:** the codebase has **AsyncStorage everywhere**, **MMKV is not installed** (`grep` returned nothing under `packages/`). New Architecture **is** enabled (`packages/app/app.config.js:58 — newArchEnabled: true`), so `react-native-mmkv@4.3.1` is technically available, but introducing MMKV mid-milestone forces a CNG / prebuild verification cycle and creates a second persistence surface alongside AsyncStorage (used by `use-settings.ts`, `draft-store.ts`, `i18n/init.ts`). **Recommendation:** stay on AsyncStorage for Phase 2 (welcome flag, delight-moment flags, labs opt-ins, last-used-per-workspace) — adopt MMKV in a future cleanup phase. This matches the **AGT-02 deferral** ("optimistic agent creation out of milestone scope" per ROADMAP) and removes the only blocker on Phase 2 starting.

**Primary recommendation:** Build five plans — (1) ActionRegistry foundation + cmdk web variant + bottom-sheet native variant + react-hotkeys-hook wiring + CI parity test; (2) Welcome screen extension + onboarding skip-flag + pair-scan inline-recovery; (3) Chats tab reshape: `<ChatRow>` + long-press menu + swipe-left + top-right `+` + total-unread popup + sidebar workspace tap-to-switch; (4) Settings IA reorg into 5-bucket flat list with redirect routes + Labs sub-page with stability badges; (5) Polish sweep: `<GlassSurface>` migration of every modal/sheet/popover, `useHaptic()` hook, smoothed-text collapse, NAT-03 lint promotion, `burnt` introduction, math-curve scope narrowing, Otter brand placement.

## Architectural Responsibility Map

| Capability                                          | Primary Tier                                                          | Secondary Tier                                          | Rationale                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Welcome screen + skip flag (ONB-04)                 | Browser/Native (App / Expo Router)                                    | —                                                       | Onboarding state is per-device; skip flag persists in AsyncStorage; no daemon round-trip.                                                                                                                                                                                   |
| Pair-scan inline recovery (ONB-03)                  | Browser/Native (App)                                                  | API/Backend (relay)                                     | UI flow lives in `app/pair-scan.tsx`; recovery actions call existing `connectToDaemon` + `upsertConnectionFromOfferUrl`. Schema unchanged.                                                                                                                                  |
| Local-bundled-daemon detection (ONB-02)             | Browser/Native (App via `getIsElectron()` + `shouldUseDesktopDaemon`) | —                                                       | Detection hook exists at `packages/app/src/desktop/daemon/desktop-daemon.ts:113`; Phase 2 only consumes it.                                                                                                                                                                 |
| Tab + Stack shell (NAV-A5)                          | Browser/Native (Expo Router)                                          | —                                                       | Lives in `app/_layout.tsx` + `<MobileTabBar>` + `<DesktopNavRail>`. Already implemented; Phase 2 does NOT redesign — only adds workspace-level back-stack discipline + WeChat interactions.                                                                                 |
| Workspace switching (NAV-A2)                        | Browser/Native (App, Zustand)                                         | —                                                       | `navigation-active-workspace-store.ts` + `panel-store.ts` already drive this. Sidebar row tap = immediate switch (D-07) is a UI-level change, no daemon round-trip.                                                                                                         |
| Chat-row pin/mute/archive/unread state (D-04, D-05) | API/Backend (daemon)                                                  | Browser/Native (TanStack Query + Zustand)               | **Open question** — see `Open Questions §1`. `archivedAt` already in schema; pin/mute/unread are new. Cross-device parity per CONTEXT `<code_context>` "if pin / mute / archive are daemon-managed (probably yes for cross-device parity), the schema additions land here". |
| ActionRegistry (NAV-A4 / NAT-01)                    | Browser/Native (new module `packages/app/src/actions/registry.ts`)    | —                                                       | Pure client-side dispatch table. Voice / keyboard / cmdk / context-menu / kebab call into the same registry. No daemon involvement.                                                                                                                                         |
| Settings IA (SET-01, SET-03, SET-04)                | Browser/Native (App routing + AsyncStorage)                           | —                                                       | `app/settings/[section].tsx` is already a slug-driven route. Phase 2 reorganizes `SETTINGS_SECTION_SLUGS` and adds redirect routes. No daemon involvement.                                                                                                                  |
| `<GlassSurface>` migration (THM-02)                 | Browser/Native (App component layer)                                  | —                                                       | `glass-surface.tsx` exists with iOS BlurView + web `backdrop-filter`. Phase 2 swaps every modal root onto it. No native-module change unless `expo-glass-effect` is adopted.                                                                                                |
| `useHaptic()` (NAT-02)                              | Native (App hook over `expo-haptics`)                                 | Browser/Native (settings toggle from `use-settings.ts`) | `expo-haptics` already installed; one site uses it today (`sidebar-workspace-list.tsx`). No web behavior — hook no-ops on web.                                                                                                                                              |
| Smoothed-text collapse (NAT-04)                     | Browser/Native (App hook)                                             | —                                                       | `use-smoothed-text.ts` exists; only `message.tsx` consumes it today. Phase 2 confirms the single call site and gates by `isLive`.                                                                                                                                           |
| `burnt` toast layer                                 | Browser/Native (App utility)                                          | —                                                       | Burnt wraps `ToastAndroid` on Android, native `SPIndicator/AlertKit` on iOS, Sonner on web. Existing `toast-host.tsx` is JS-rendered — keep it for in-app inline toasts; introduce `burnt` for system-level acks (state-change vocabulary).                                 |
| Pointer-event lint promotion (NAT-03 / D-20)        | Repo tooling (`tools/lint/pointer-events-web-only.ts`)                | —                                                       | Lint script already exists; Phase 2 changes it from baseline-mode to error-mode.                                                                                                                                                                                            |

## Phase Requirements

| ID     | Description (from REQUIREMENTS.md)                                                                                            | Research Support                                                                                                                                                                                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ONB-01 | First launch → first running agent ≤3 user-initiated steps when daemon is local-bundled                                       | Welcome screen (`app/welcome.tsx`) + skip flag; cold-open auto-routes via `app/index.tsx:55-87` to most-recent workspace if any host is online. Plan must verify the tap-count budget.                                                                                        |
| ONB-02 | Auto-detect local daemon, skip pair-scan on desktop / same-machine                                                            | `shouldUseDesktopDaemon()` already returns `getIsElectron()`; existing `_layout.tsx:HostRuntimeBootstrapProvider` already does desktop bootstrap. Only the welcome-screen branching needs to consume it.                                                                      |
| ONB-03 | Pair-scan failures self-serve recovery inline (regenerate / manual key / switch local), no app restart, typed input preserved | `app/pair-scan.tsx` currently surfaces errors via `Alert.alert(...)` (line 193). Phase 2 replaces with inline `<CalloutCard variant="error">` per UI-SPEC; manual key entry path is `<PairLinkModal>` at `packages/app/src/components/pair-link-modal.tsx`.                   |
| ONB-04 | Welcome explains Ottie, en/zh, "skip for power users" → workspace screen                                                      | `<WelcomeScreen>` exists at `packages/app/src/components/welcome-screen.tsx` (350 lines). Phase 2 adds Skip CTA + "Don't show again" + AsyncStorage flag (UI-SPEC §Component Inventory).                                                                                      |
| NAV-A1 | Host → workspace → agent hierarchy with consistent kebab / hover-touch / status affordances                                   | `<LeftSidebar>` (`packages/app/src/components/left-sidebar.tsx`) + `<SidebarWorkspaceList>` already render this hierarchy. Phase 2 wires the WeChat-style row interactions; `agent-status-dot.tsx` and `daemon-connection-dot.tsx` are token-migrated and reusable.           |
| NAV-A2 | Compact form factor auto-collapses sidebar overlay; workspace switch one tap                                                  | Existing `useIsCompactFormFactor()` + `SidebarAnimationProvider` (`packages/app/src/contexts/sidebar-animation-context.tsx`) handle the overlay. Tap-to-switch implementation: write to `navigation-active-workspace-store` + `router.replace(buildHostWorkspaceRoute(...))`. |
| NAV-A5 | Mobile tab bar + sidebar share one nav model, no orphans                                                                      | `<MobileTabBar>` + `<DesktopNavRail>` already share 4 tab IDs and route via `router.replace`. Audit needed: confirm settings / pair-scan / welcome / hosts subroutes all reachable from at least one tab. See `Open Questions §3`.                                            |
| SET-01 | Settings reorganized into Account / Agents / Voice / Appearance / Advanced; nothing removed                                   | `SETTINGS_SECTION_SLUGS` at `host-routes.ts:391` lists 9 current slugs (general / shortcuts / integrations / permissions / usage / labs / localDaemon / diagnostics / about). Plan must remap into 5 buckets with redirect routes; nothing removed.                           |
| SET-03 | Theme / language / voice ≤2 taps from any screen via command-center                                                           | cmdk palette + ActionRegistry "Open settings: <X>" actions registered; ⌘K / long-press tab dispatches them.                                                                                                                                                                   |
| SET-04 | Labs section with Experimental / Beta / Stable badges, individual opt-in                                                      | `<LabsSection>` exists at `packages/app/src/screens/settings/labs-section.tsx` (937 lines, hand-rolled). Phase 2 reshapes into `<LabsRow>` array driven by an authored `LABS_REGISTRY` constant + AsyncStorage opt-in map.                                                    |
| THM-02 | Every modal/sheet/popover/bottom-sheet/dropdown uses `<GlassSurface>`; AA contrast                                            | `<GlassSurface>` at `glass-surface.tsx` already supports `radius="card" \| "sheet" \| "pill" \| "button"` (lines 41-46). Audit list — at least 25 modal-using files identified by `grep` (see §Common Pitfalls #5).                                                           |
| THM-03 | Math-curve loader formalized; callout cards on `<GlassSurface>`; `burnt` toasts; error vocabulary                             | `<MathCurveLoader>` exists; `<CalloutCard>` exists at `callout-card.tsx`; `burnt` is a new dep; error vocabulary documented in UI-SPEC §Visual Language.                                                                                                                      |
| THM-04 | Otter brand consistent across splash / welcome / empty / 3 delight moments                                                    | `<OttieLogo>` exists at `components/icons/ottie-logo.tsx`; `assets/` directory exists. Delight-moment toasts wrap `burnt` with localStorage flag (UI-SPEC §Component Inventory `<DelightToast>`).                                                                             |
| NAT-01 | Voice / cmd-center / long-press / keyboard parity ≥80% on 6 named actions                                                     | Reference set: create agent, switch workspace, jump to recent, approve/deny permission, open settings, toggle theme. Backed by ActionRegistry + new CI parity test (`packages/app/src/actions/registry.parity.test.ts`).                                                      |
| NAT-02 | `useHaptic()` semantic vocabulary, debounced, low-power-aware                                                                 | New hook at `packages/app/src/hooks/use-haptic.ts` wrapping `expo-haptics`. Replaces 3 `Haptics.*` calls in `sidebar-workspace-list.tsx`.                                                                                                                                     |
| NAT-04 | AI-generated text via `use-smoothed-text` everywhere it appears                                                               | Hook exists at `hooks/use-smoothed-text.ts`. Today only `message.tsx` consumes it (verified by grep — see §Code Examples). Phase 2 confirms call site is the AI streaming bubble only (D-19); other surfaces explicitly do not adopt.                                         |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Navigation model (WeChat-style — applies globally to mobile + desktop)**

- **D-01:** Nav shell is **Tab + Stack Navigation**. Each tab owns its own navigation stack; back returns within the tab, never crosses tabs. On Tauri / wide web, the tab bar materializes as the sidebar's primary section list; on mobile narrow, it's the bottom tab bar.
- **D-02:** Default cold-open destination is the **Chats tab**. Welcome screen renders only on first-ever launch with visible "Skip" / "Don't show again" toggle.
- **D-03:** Chats is THE primary surface; remaining tabs are planner discretion (constraint: ≥1 tab reaches every Settings IA bucket).
- **D-04:** Chat-row interactions are **equivalent by intent**, not gesture: long-press (mobile) / right-click (desktop) → 8-item context menu (置顶 / 取消置顶 / 标记未读 / 标记已读 / 静音 / 删除 / 重命名 / 归档); swipe-left (mobile) / hover quick-actions (desktop) → top-3 (标记已读 / 静音 / 删除); top-right `+` menu → 4 items; pull-to-refresh / ⌘R; infinite scroll.
- **D-05:** Chat row status: unread = red numeric badge; muted = grey numeric; pinned = top of list with distinct background tint.
- **D-06:** Cold-open splash → if total unread > 0, brief total-unread popup before Chats list takes focus.
- **D-07:** Workspace tap in sidebar = immediate switch (no two-tap workspace-then-confirm).

**Action surface**

- **D-08:** Build `packages/app/src/actions/registry.ts`; add `cmdk@1.1.1` for web/Tauri palette via Metro `.web.ts`; native gets bottom-sheet via `.native.ts`; add `react-hotkeys-hook@5.2.4`. CI parity test asserts every action reachable from ≥2 modalities (web/Tauri) or ≥1 (native).

**Settings IA**

- **D-09:** WeChat-style **flat scrolling list** with 5 group headers: Account / Agents / Voice / Appearance / Advanced. Each row pushes a sub-page. ⌘K deep-link satisfies SET-03.
- **D-10:** **Labs** is sub-page under Advanced. Each experiment row: status badge (Experimental 橙 / Beta 黄 / Stable 绿) + name + description + opt-in toggle. Bottom: "Reset all labs to default". Labels author-set in code.
- **D-11:** Settings migration is **additive** — old paths keep working with redirect routes for the milestone duration.

**Visual language**

- **D-12:** Toast-led state-change feedback via `burnt`; debounced per event-type.
- **D-13:** Math-curve loader reserved for top-level loads ONLY (Chats list initial, agent run-start, cmd-center search). Everywhere else uses skeleton or neutral spinner.
- **D-14:** Empty states are 97% pure copy. Otter only on first-time-empty (first workspace + first Chats list).
- **D-15:** Errors = callout card on `<GlassSurface>` + short `burnt` toast. Copy references `$OTTIE_HOME/daemon.log`.
- **D-16:** **`<GlassSurface>` migration scope:** every modal / sheet / popover / bottom-sheet / dropdown. iOS 26 `expo-glass-effect`, `expo-blur` fallback, web CSS `backdrop-filter`. Light/dark AA contrast at phase exit. **Research flag carried from Phase 1:** validate `expo-glass-effect` on iOS 26 dev build.

**Otter brand**

- **D-17:** Otter appears in: splash, welcome, first-time-empty (first workspace + first chats), 3 one-time delight toasts (first-agent-created, first-permission-approved, first-voice-command). Brand assets centralized in `packages/app/src/assets/otter/`.

**Native-feel**

- **D-18:** `useHaptic()` semantic vocabulary, WeChat 6-event mapping; debounce 200ms per event; respects low-power-mode + per-user toggle.
- **D-19:** `use-smoothed-text` collapsed to AI streaming message bubbles only.

**Lint promotions**

- **D-20:** Pointer-event lint (`onPointerEnter`/`onPointerLeave` outside `.web.ts`) promoted **warn → error** before this phase ships. Other Phase 1 lint rules stay at warn-level.

**Onboarding reconciliation**

- **D-21:** First-ever launch shows Welcome (en/zh, Otter, two paragraphs, "Get started" + "Skip for power users"). Subsequent launches go straight to Chats. Pair-scan failure recovery is inline; typed input preserved across attempts.

### Claude's Discretion

- Tab list beyond Chats (Hosts / Settings / Voice / Recents — researcher proposes; planner picks).
- Specific swipe-threshold pixel value (UI-SPEC recommends 120px commit, 90px haptic warn).
- Math-curve loader entry/exit motion timing (Phase 1 motion tokens own the curves).
- Otter sticker / emoji set for delight-moment toasts.
- Settings sub-page layout per row.
- Pair-scan inline-recovery error vocabulary (en + zh).
- Welcome screen exact copy (en + zh) + "Don't show again" persistence key name.
- ActionRegistry implementation details (Map vs. Record, action-ID naming).
- cmdk filtering / ranking strategy (start without `fuse.js`).
- Native command-center bottom-sheet implementation.
- Per-action keybinding choices for `react-hotkeys-hook`.

### Deferred Ideas (OUT OF SCOPE)

- Optimistic agent creation (AGT-04) — explicitly out per ROADMAP.
- Voice-handler carve (C-6/C-7) — voice intents wrap into ActionRegistry but daemon-side `VoiceSessionHandler` carve is NOT in scope.
- Permission UX (AGT-05), SES-03/04/05, NAT-05 — out of Phase 2 success criteria.
- Tauri global-shortcut bridge for `Cmd+Shift+O` global-summon — research-flag-dependent.
- MMKV pin version vs AsyncStorage — research below resolves: stay on AsyncStorage.
- `expo-glass-effect` validation on iOS 26 dev build — research flag carried; `expo-blur` fallback is the safe default.
- DTCG JSON token export — explicit Phase 1 D-12 deferral.
- `SCHEMA_EVOLUTION.md` doc — original Phase 5; deferred to a future cleanup milestone.
- Big-bang `session.ts` rewrite — antipattern; carve continuation outside this milestone.
- Lint promotions for schema-evolution / hardcoded-color / isHovered-alone — only NAT-03 promotes to error this phase.

## Project Constraints (from CLAUDE.md)

The planner MUST honor every directive below. These supersede any general best-practice the research recommends.

- **Cross-platform default.** Gates only from `@/constants/platform`. NEVER write `const isWeb = Platform.OS === "web"` locally. The four gates are `isWeb`, `isNative`, `getIsElectron()`, `useIsCompactFormFactor()`.
- **Prefer Metro `.web.ts` / `.native.ts` over runtime `if (isWeb)` for non-trivial branches.** Reserve `if (isWeb)` for short inline cases (single line / few props). Large conditional blocks split into separate files. cmdk vs bottom-sheet command-center MUST split this way.
- **Hover only works on web.** Use `isHovered || isNative || isCompact` for hover-to-show controls (chat-row hover quick-actions, kebab buttons). NEVER `onPointerEnter` / `onPointerLeave` outside `.web.ts` (Phase 2 D-20 promotes the lint to error before phase ships).
- **Bilingual.** Every user-visible string change updates both `packages/app/src/i18n/locales/en.json` and `zh.json` in lockstep.
- **Schema backward compatibility** (CLAUDE.md hard rule): new fields `.optional()` with default/transform fallback; never narrow optional → required; never remove a field; never narrow type. Frozen-fixture v1.8 / v1.9 / v1.10 / v1.11 parse tests in CI must stay green.
- **Build / test discipline:** `npm run typecheck && npm run lint && npm run format` after every change. NEVER restart daemon on `:6868`. NEVER run full test suite locally.
- **Use npm scripts for lint/format.** `npm run lint -- <file>`, `npm run format:files -- <file>` — never `npx eslint`, `npx oxlint`, `npx oxfmt` directly.
- **Local-first invariant:** agent code, credentials, chat content never leave the developer's machine in plaintext. Relay stays zero-knowledge. New chat-row state (pin/mute/archive) MUST follow this.
- **Touch ≤100ms; agent-creation feedback ≤200ms; timeline interactive past 1k events.** Phase 2 changes MUST NOT regress these.
- **Package manager:** `pnpm@9.12.0` is the actual root manager (`pnpm-workspace.yaml` exists at repo root). Some root scripts use `pnpm --filter @ottie/<x>`; install commands for adds use `pnpm --filter @ottie/app add <pkg>` (see §Installation).

## Standard Stack

### Core (already in stack — Phase 2 consumes, does not introduce)

| Library                                     | Version (verified `npm view` 2026-05-01) | Purpose                           | Why Standard                                                                                                                           |
| ------------------------------------------- | ---------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `expo` / `expo-router`                      | `54.0.18` / `~6.0.13`                    | Routing, screen stack             | Already in stack; Phase 2 reshapes `app/_layout.tsx` minimally.                                                                        |
| `react` / `react-native`                    | `19.1.4` / `0.81.5`                      | UI runtime                        | Already pinned. React 19 enables `useOptimistic` / `useTransition` (deferred per AGT-04 — Phase 2 does not adopt).                     |
| `react-native-unistyles`                    | `^3.0.15`                                | Theme runtime + token consumption | Phase-1-landed token tree consumes via `useUnistyles()`.                                                                               |
| `expo-blur`                                 | `^15.0.8`                                | Glass blur fallback               | Already used by `<GlassSurface>` and `<MobileTabBar>`.                                                                                 |
| `expo-haptics`                              | `~15.0.7`                                | Native haptics                    | Used today only at `sidebar-workspace-list.tsx:13`. Phase 2 wraps via `useHaptic()`.                                                   |
| `@gorhom/bottom-sheet`                      | `^5.2.6`                                 | Native sheet primitive            | Already in stack. Phase 2 reuses for native command-center variant + native chat-row context-menu.                                     |
| `react-native-gesture-handler`              | `~2.28.0`                                | Gesture root + swipe primitive    | Already in stack. Phase 2 builds `<ChatRowSwipeActions>` on top of its `Swipeable` (currently no `Swipeable` usage in repo — net-new). |
| `lucide-react-native`                       | `^0.546.0`                               | Icon set                          | Already in stack; UI-SPEC pins this as canonical for Phase 2 (no `expo-symbols` adoption this phase).                                  |
| `i18next` / `react-i18next`                 | `^23` / `^15`                            | Bilingual                         | Loaded synchronously in `i18n/init.ts`; AsyncStorage-backed language persistence.                                                      |
| `@react-native-async-storage/async-storage` | `2.2.0`                                  | Persistence                       | **CONFIRMED via grep** as the active persistence layer (`use-settings.ts`, `draft-store.ts`, `i18n/init.ts`). Phase 2 stays on it.     |
| `@tanstack/react-query`                     | `^5.90.11`                               | Server state                      | Already in stack. Phase 2 uses for chat list invalidation triggered by `agent_update`.                                                 |
| `zustand`                                   | `^5.0.9`                                 | UI state                          | Already in stack. Phase 2 adds `OnboardingStateStore` + `LabsOptInStore` (or extends existing).                                        |

### New Additions (Phase 2 introduces)

| Library              | Version (verified)                                               | Purpose                                         | Why Standard                                                                                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cmdk`               | `1.1.1`                                                          | Headless command palette (web/Tauri only)       | De-facto standard for ⌘K palettes (Linear, Vercel, Raycast Web). Headless — composes with Unistyles. Removes hand-rolled filter logic in `command-center.tsx`. **Web-only** — guard with Metro `.web.tsx`.                                                     |
| `react-hotkeys-hook` | `5.3.0` (latest; CONTEXT D-08 said `5.2.4` — `5.3.0` is current) | Web/Tauri keyboard scopes / sequences           | v5 supports scopes (per-screen activation) + sequences. No-ops on native (web-only bundle path).                                                                                                                                                               |
| `burnt`              | `0.13.0`                                                         | Toast layer (system iOS/Android, Sonner on web) | Native-feel: iOS uses `SPIndicator` / `AlertKit`, Android uses `ToastAndroid`, web uses Sonner. Used for state-change acks (D-12) — not a replacement for the existing `toast-host.tsx`.                                                                       |
| `sonner`             | `2.0.7`                                                          | Web fallback for `burnt`                        | Burnt's web target; surfaces as toast on browsers/Tauri.                                                                                                                                                                                                       |
| `expo-glass-effect`  | `55.0.10`                                                        | iOS 26 Liquid Glass (only if validation passes) | **Research flag carried from Phase 1.** UI-SPEC `<GlassSurface>` upgrades to use this on iOS 26 if dev-build validation succeeds; falls back to `expo-blur` otherwise. Plan MUST keep the API surface of `<GlassSurface>` unchanged so adoption is reversible. |

### Supporting / Optional

| Library   | Version  | Purpose                                   | When to Use                                                                                                                                                    |
| --------- | -------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `moti`    | `0.30.0` | Declarative motion on top of Reanimated 4 | Optional. Useful for state-change motions (modal-in / list-row-in / success-pulse). UI-SPEC research notes "planner decides which animations get migrated".    |
| `fuse.js` | `^7.3.0` | Fuzzy search                              | Optional. cmdk has built-in score — start without; add only if comprehension issues arise on heterogeneous palette items. CONTEXT D-08 explicitly defers this. |

### Explicitly NOT Adopted in Phase 2

| Library               | Reason                                                                                                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-native-mmkv`   | New Architecture is on (`app.config.js:58`) so the path is open, but introducing MMKV mid-milestone forces CNG verification + dual persistence surface. Phase 2 stays on AsyncStorage. CONTEXT `<deferred>` punts this to a future phase. |
| `expo-symbols`        | UI-SPEC §Design System: "`expo-symbols` is **not** adopted in this phase". Lucide stays canonical.                                                                                                                                        |
| `@shopify/flash-list` | Out of Phase 2 scope (SES-04 belongs to a future phase).                                                                                                                                                                                  |
| `valibot`             | Anti-recommended in research/STACK.md — Ottie is fully Zod-standardized and CLAUDE.md schema rule makes mid-flight schema-library swaps dangerous.                                                                                        |
| `kbar`                | Anti-recommended — opinionated styling clashes with Unistyles. cmdk + custom shell wins.                                                                                                                                                  |

### Alternatives Considered

| Instead of           | Could Use                                 | Tradeoff                                                                                                                                                        |
| -------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cmdk`               | `kbar` (batteries-included palette)       | kbar enforces its own animation system — clashes with Reanimated/Unistyles. cmdk is headless.                                                                   |
| `burnt`              | `sonner-native` (JS-rendered)             | Sonner-Native is JS-rendered; burnt uses native iOS/Android primitives. UI-SPEC chose burnt for "native-feel" brand promise.                                    |
| `react-hotkeys-hook` | `tinykeys` (650B, no React deps)          | tinykeys wins for non-React contexts. For a React app, hotkeys-hook v5's scopes / sequences / focus integration is strictly better.                             |
| AsyncStorage         | `react-native-mmkv@4.3.1`                 | MMKV is JSI-backed and synchronous (better for hot paths), but introduces a second persistence surface. Phase 2 stays single-storage.                           |
| `expo-glass-effect`  | `expo-blur` only (no native Liquid Glass) | Validation flag carried from Phase 1. `expo-blur` is the safe default; `expo-glass-effect` is the iOS-26-native upgrade. `<GlassSurface>` API hides the choice. |

### Installation (Phase 2 additions only)

```bash
# Core (web/Tauri command surface + keyboard + toast layer)
pnpm --filter @ottie/app add cmdk@1.1.1 react-hotkeys-hook@5.3.0 burnt@0.13.0 sonner@2.0.7

# Optional, only if iOS-26 dev-build validation succeeds for D-16
pnpm --filter @ottie/app add expo-glass-effect@55.0.10

# Optional, planner discretion (state-change motions)
pnpm --filter @ottie/app add moti@0.30.0
```

**Version verification (`npm view` run 2026-05-01):**

- `cmdk` 1.1.1 [VERIFIED: npm registry]
- `react-hotkeys-hook` 5.3.0 [VERIFIED: npm registry] — CONTEXT D-08 cites `5.2.4`; `5.3.0` is the current release. Either pins fine for v5.
- `burnt` 0.13.0 [VERIFIED: npm registry] — matches CONTEXT.
- `sonner` 2.0.7 [VERIFIED: npm registry] — pulled in transitively by `burnt` on web.
- `moti` 0.30.0 [VERIFIED: npm registry] — matches research/STACK.md.
- `react-native-mmkv` 4.3.1 [VERIFIED: npm registry] — NOT adopted in Phase 2.
- `expo-glass-effect` 55.0.10 [VERIFIED: npm registry] — adoption pending iOS 26 dev-build validation.
- `expo-symbols` 55.0.7 [VERIFIED: npm registry] — NOT adopted in Phase 2.

## Architecture Patterns

### System Architecture — Phase 2 wiring

```
                     ┌────────────────────────────────────────────────────────────┐
                     │                  RootLayout (app/_layout.tsx)              │
                     │ Providers → AppContainer (Tab+Stack) → MobileGestureWrap   │
                     └─────────┬──────────────────────────────┬───────────────────┘
                               │                              │
              ┌────────────────┴────────┐         ┌───────────┴──────────────┐
              │ DesktopNavRail (≥md)    │         │ MobileTabBar (xs/sm)     │
              │ chats / devices /       │         │ chats / devices /        │
              │ community / settings    │         │ community / settings     │
              └────────────────┬────────┘         └───────────┬──────────────┘
                               │                              │
                               └──────────────┬───────────────┘
                                              ▼
                       ┌──────────────────────────────────────────────┐
                       │ Active tab → Stack screens                    │
                       │  chats →  app/h/[serverId]/sessions/...       │
                       │  devices →  app/h/[serverId]/index            │
                       │  community → app/h/[serverId]/community       │
                       │  settings → app/settings/index, [section]      │
                       └────────────┬─────────────────────────────────┘
                                    │
                                    ▼
                       ┌──────────────────────────────────────┐
                       │ Chats list (sessions-screen.tsx)      │
                       │  reshape → <ChatRow> + long-press +   │
                       │            swipe-left + +-menu +      │
                       │            pull-refresh + infinite    │
                       │            scroll + total-unread popup│
                       └────────────┬─────────────────────────┘
                                    │
                                    ▼
              ┌──────────────────────────────────────────────────┐
              │ ActionRegistry (packages/app/src/actions/         │
              │ registry.ts) — single dispatch surface            │
              │                                                  │
              │  register("agent.create", ...) ───┐              │
              │  register("workspace.switch", ...)│              │
              │  register("session.jump", ...)   ┼──┐            │
              │  register("permission.approve",..│  │            │
              │  register("settings.open", ...)  │  │            │
              │  register("theme.cycle", ...)    │  │            │
              │  register("chat.menu.pin", ...)  │  │            │
              │  ... (8 chat-row + 4 add-menu)   │  │            │
              └──────────────────┬───────────────┘  │            │
                                 │                  │            │
                ┌────────────────┼────────┬─────────┴───┬────────┴────────┐
                ▼                ▼        ▼             ▼                 ▼
         ┌────────────┐  ┌────────────┐ ┌────────┐ ┌─────────────┐ ┌───────────────┐
         │ cmdk panel │  │ react-     │ │ Long-  │ │ Voice       │ │ kebab / hover │
         │ (.web.tsx) │  │ hotkeys-   │ │ press  │ │ controller  │ │ quick-actions │
         │            │  │ hook       │ │ menu   │ │ → intent    │ │               │
         │ Bottom-    │  │ (web/Tauri │ │ (chat- │ │   router    │ │               │
         │ sheet      │  │  only)     │ │ row)   │ │ → registry  │ │               │
         │ (.native.  │  │            │ │        │ │   dispatch  │ │               │
         │  tsx)      │  │            │ │        │ │             │ │               │
         └────────────┘  └────────────┘ └────────┘ └─────────────┘ └───────────────┘
                                              │
                                              ▼
                       ┌──────────────────────────────────────┐
                       │ <GlassSurface> rebrand                │
                       │  every modal / sheet / popover /      │
                       │  bottom-sheet / dropdown migrates onto │
                       │  it. iOS 26 → expo-glass-effect (if   │
                       │  validated); else expo-blur.          │
                       └──────────────────────────────────────┘
```

### Recommended Project Structure (additions only — do NOT relocate existing files)

```
packages/app/src/
├── actions/                                      ← NEW
│   ├── registry.ts                               ← Universal action map (D-08)
│   ├── registry.test.ts                          ← Unit tests
│   ├── registry.parity.test.ts                   ← CI parity test (NAT-01 gate)
│   ├── ids.ts                                    ← Action ID enum / constants
│   └── modalities.ts                             ← Modality registration helpers
├── components/
│   ├── chat-row.tsx                              ← NEW (D-04 host)
│   ├── chat-row-context-menu.web.tsx             ← NEW (right-click menu)
│   ├── chat-row-context-menu.native.tsx          ← NEW (long-press → bottom sheet)
│   ├── chat-row-swipe-actions.tsx                ← NEW (native swipe-left, .native or shared)
│   ├── chat-row-hover-actions.web.tsx            ← NEW (web hover quick actions)
│   ├── unread-badge.tsx                          ← NEW (numeric badge component)
│   ├── top-right-add-menu.tsx                    ← NEW (4-item +-menu)
│   ├── total-unread-popup.tsx                    ← NEW (D-06)
│   ├── command-center.web.tsx                    ← REPLACES current command-center.tsx (cmdk)
│   ├── command-center.native.tsx                 ← REPLACES current command-center.tsx (sheet)
│   ├── settings/
│   │   ├── flat-list.tsx                         ← NEW (5-bucket WeChat list — D-09)
│   │   ├── group.tsx                             ← NEW (header + card)
│   │   ├── row.tsx                               ← NEW (Pressable row → sub-page)
│   │   ├── labs-row.tsx                          ← NEW (D-10)
│   │   └── labs-badge.tsx                        ← NEW (D-10)
│   └── delight-toast.ts                          ← NEW (singleton helper, D-17)
├── hooks/
│   └── use-haptic.ts                             ← NEW (D-18)
└── assets/
    └── otter/                                    ← NEW (D-17 brand assets)
```

### Pattern 1: Metro `.web.tsx` / `.native.tsx` split for command center

**What:** Use Metro's platform-extension resolution to ship two structurally-different command surfaces from one import.
**When to use:** Any time the UX shape (not just look) differs between platforms. Command center is palette-modal on web/Tauri but bottom-sheet on native.
**Existing precedent in repo:**

```typescript
// Source: packages/app/src/components/math-curve-loader/index.tsx
// Public entry point for the math-curve loader.
//
// Metro / Expo bundles `.native.tsx` for iOS+Android and `.web.tsx` for web,
// so the platform-specific renderer is selected at build time. Keep this
// shim thin — anything you add here runs on every platform.
```

```typescript
// Source: packages/app/src/stores/timeline-cache-store.{web,native}.ts (Phase 1)
// Same pattern — shared types in timeline-cache-store-shared.ts,
// platform implementations in .web.ts / .native.ts.
```

**Phase 2 application:**

- `command-center.tsx` → split into `.web.tsx` (cmdk) + `.native.tsx` (`@gorhom/bottom-sheet`).
- `chat-row-context-menu.tsx` → split into `.web.tsx` (anchored sheet near cursor) + `.native.tsx` (bottom sheet).
- `chat-row-hover-actions.web.tsx` → web-only file (no `.native` counterpart — native uses swipe).

### Pattern 2: `isHovered || isNative || isCompact` for hover-fallback affordances

**What:** Hover-only-on-web controls (kebab menus, action buttons) become always-visible on native and compact form factors.
**Existing precedent (Phase 1 chevron fix):**

```typescript
// Source: packages/app/src/components/message.tsx:2606
const isActive = isHovered || isExpanded || isNative || isCompact;
// ...
// Source: packages/app/src/components/message.tsx:2696
{isInteractive && (isHovered || isNative || isCompact) ? (
  // render kebab / quick-action
) : null}
```

**Phase 2 application:** every chat-row hover quick-action button group on web uses this pattern. CI lint (`is-hovered-alone`) blocks regressions to plain `isHovered`.

### Pattern 3: Tab + Stack with `router.replace` (no history pile-up on tab switch)

**Existing precedent:**

```typescript
// Source: packages/app/src/components/mobile-tab-host.tsx:31-49
const handleSelect = useCallback(
  (tab: MobileTab) => {
    if (tab === activeTab) return;
    switch (tab) {
      case "chats":
        router.replace(buildHostSessionsRoute(serverId));
        return;
      // ...
    }
  },
  [activeTab, serverId],
);
```

**Phase 2 application:** confirm every tab destination uses `router.replace`, not `router.push`. The 4 tabs already do this. Workspace switching (D-07) MUST also use `router.replace` to satisfy the "≤100ms tab switch" budget (UI-SPEC §Performance Budgets).

### Pattern 4: Token-driven theme variants for chat-row state (unread / muted / pinned)

**Existing precedent:** `daemon-connection-dot.tsx` and `agent-status-dot.tsx` already render the same component with token-driven state colors (online / connecting / offline). The Phase 1 token migration removed every hardcoded hex.
**Phase 2 application:** `<ChatRow>` is one component with three states resolved via `theme.status.*` + `theme.surface.*`. Reuse the same theme-key naming as the connection dot triad — no new tokens needed.

### Anti-Patterns to Avoid

- **Hand-rolling fuzzy filter logic.** cmdk has it built in; only add `fuse.js` if comprehension issues surface in UAT.
- **Sprinkling `Haptics.*` calls across components.** Today's repo has 3 such calls in `sidebar-workspace-list.tsx` (lines 1053, 1076, 1089). Phase 2 collapses them through `useHaptic()`. New code MUST go through the hook (lint or convention enforcement is planner discretion).
- **Bypassing the ActionRegistry from a new modality.** If a chat-row context-menu item dispatches a registry action but a kebab in the same row dispatches the same action via direct function call, the parity test will pass but the surface area is divergent — exactly the "parity rot" pitfall from research/PITFALLS.md #6.
- **Adopting `expo-glass-effect` without first validating on iOS 26 dev build.** UI-SPEC explicitly carries this research flag. The `<GlassSurface>` API surface MUST hide the choice (callers don't import `expo-glass-effect` directly).
- **Inventing new spacing or font-size tokens at call sites.** UI-SPEC pins 4 sizes (12 / 14 / 16 / 20) and 2 weights (400 / 600). The hardcoded-spacing lint warning (introduced this phase, planner discretion) prevents drift.
- **Big-bang `<GlassSurface>` migration.** Audit list owned by planner; migrate per-modal with screenshots before/after. THM-02 contrast audit is a phase-exit gate, not a per-PR check.

## Don't Hand-Roll

| Problem                                            | Don't Build                                               | Use Instead                                                                                                                                                     | Why                                                                                                                                                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⌘K command palette filtering / ARIA / keyboard nav | A bespoke `useFilteredItems` hook                         | `cmdk@1.1.1`                                                                                                                                                    | The current `command-center.tsx` is 492 lines of hand-rolled filter, scroll, keyboard-nav, ARIA. cmdk handles all of it correctly.                                                                                                      |
| Cross-platform hotkey scopes / sequences           | Hand-roll on top of `keydown` listeners                   | `react-hotkeys-hook@5.3.0`                                                                                                                                      | Scopes (per-screen activation), key sequences (`g i`), focus-aware suppression, and hotkey deactivation under text input are all in v5. The existing keyboard infra (`keyboard/keyboard-shortcuts.ts`) is web-targeted and predates v5. |
| System-native toasts                               | A JS-rendered toast (`toast-host.tsx` already exists)     | `burnt@0.13.0` for state-change acks; **keep `toast-host.tsx`** for inline contextual toasts                                                                    | Burnt's API is imperative + JSI-backed — no React tree mount. Use it for "已读" / "静音" / "首条 agent 创建" acks. The existing `toast-host.tsx` stays for the cases where the toast must appear inside a panel layout.                 |
| Fuzzy search ranking                               | Hand-roll Levenshtein / Jaccard                           | `fuse.js@^7.3.0` (only if needed)                                                                                                                               | cmdk's built-in score is sufficient until UAT shows comprehension issues. Adding Fuse is one line of code.                                                                                                                              |
| Haptic debounce + low-power-mode + user-toggle     | Inline `Haptics.impactAsync(...)` calls                   | `useHaptic()` hook (new)                                                                                                                                        | Three current call sites already exist; collapsing them through one hook is the polish-correct shape.                                                                                                                                   |
| Glass / blur surface for modal backgrounds         | Hand-roll `<View style={{ backgroundColor: rgba(...) }}>` | `<GlassSurface radius="sheet">` (already exists at `packages/app/src/components/ui/glass-surface.tsx`)                                                          | The primitive Phase 1 shipped. THM-02 acceptance gate requires every modal/sheet uses this, not a one-off.                                                                                                                              |
| Onboarding skip flag                               | A `Math.random()` keyed AsyncStorage key                  | A typed Zustand `OnboardingStateStore` with explicit fields (`welcomeShown`, `firstAgentDelightShown`, `firstPermissionDelightShown`, `firstVoiceDelightShown`) | Type safety + single-place rebroadcast on flag change. Existing precedent: `panel-store.ts`, `keyboard-shortcuts-store.ts`.                                                                                                             |
| Native swipe-left action panel                     | Hand-roll on raw `PanResponder` / `Animated`              | `Swipeable` from `react-native-gesture-handler` (already a dep — `~2.28.0`)                                                                                     | RN-GH's `Swipeable` is the standard, supports left/right actions + threshold callbacks + Reanimated integration. **No `Swipeable` usage in repo today** — Phase 2 introduces it for `<ChatRowSwipeActions>` only.                       |

**Key insight:** the polish-correct posture is to lean on the four well-known libraries (cmdk / react-hotkeys-hook / burnt / Swipeable from RN-GH) plus the in-house primitives Phase 1 already shipped. Net new code in Phase 2 is composition + token plumbing, not algorithm work.

## Runtime State Inventory

> N/A — Phase 2 is greenfield UI work + small additive schema fields; no rename/refactor/migration. The existing settings IA reorg is **additive** (D-11 — old paths stay live with redirects), so no stored data needs migration.

If chat-row pin/mute/archive end up daemon-managed (per `Open Questions §1`), the daemon will own the new fields fresh — no historical state migration. Existing `archivedAt` is already in schema (`packages/server/src/shared/messages.ts:638`); pin/mute would join it with the same `.optional()` discipline.

## Common Pitfalls

### Pitfall 1: Polish becomes redesign

**What goes wrong:** the WeChat-style nav is a substantial UX shift; the team starts redesigning the host registry, sidebar, and workspace screen alongside.
**Why it happens:** WeChat-pattern thinking creeps from chat list into adjacent screens.
**How to avoid:** **Plan boundary** — the WeChat interactions land at `<ChatRow>` and the top-right `+` menu and the sidebar workspace tap. Devices / community / settings tabs keep their current shells; only the Chats tab is reshaped this phase.
**Warning signs:** PR diff touches `<DesktopNavRail>` structurally, or any tab beyond chats gets a long-press / right-click menu.

### Pitfall 2: ActionRegistry is bypassed by one or more modalities

**What goes wrong:** a chat-row context-menu item registers correctly but a separate kebab-button on the same row dispatches the same operation via direct function call. Parity test passes but the action surface diverges.
**Why it happens:** the registry is a wrapping refactor — call sites that already work are easy to leave alone.
**How to avoid:** the parity test asserts every named action ID is reachable from ≥2 modalities (web/Tauri) or ≥1 (native). A second test (planner discretion) should grep for direct invocations of handlers that are also registered, and fail if both paths exist.
**Warning signs:** a function `handleDeleteChat(...)` is called both via `ActionRegistry.dispatch("chat.menu.delete")` and via direct import.

### Pitfall 3: Settings IA migration breaks deep links

**What goes wrong:** `app/settings/[section].tsx` slugs change names (e.g. `localDaemon` → `advanced/localDaemon`) without redirect routes. Existing in-app deep links and any external `ottie://settings/localDaemon` URLs 404.
**Why it happens:** D-11 says "additive — old paths keep working with redirect routes", but the redirect routes are easy to forget.
**How to avoid:** for every relocated section, add a redirect route file under the old slug that calls `<Redirect href={buildSettingsSectionRoute("<new-bucket>")} />`. The 9 current slugs are listed at `host-routes.ts:391-401`.
**Warning signs:** a tester opens an old in-app link to a settings deep route and gets the index screen instead.

### Pitfall 4: `expo-glass-effect` validation fails after migration is complete

**What goes wrong:** `<GlassSurface>` is rebranded to use `expo-glass-effect` on iOS 26 before validation; iOS 25 falls back to `expo-blur` correctly but iOS 26 dev build crashes or renders incorrectly.
**Why it happens:** the validation flag is carried but easy to defer indefinitely.
**How to avoid:** validation gate as a Wave 0 task in the polish-sweep plan: spin up an iOS 26 dev build, render `<GlassSurface>` with both `expo-blur` (current) and `expo-glass-effect` (proposed), confirm parity. Only proceed with adoption if validation passes.
**Warning signs:** plan tasks reference `expo-glass-effect` without a preceding validation task.

### Pitfall 5: Modal migration audit list is incomplete

**What goes wrong:** THM-02 acceptance ("every modal/sheet/popover/bottom-sheet/dropdown uses `<GlassSurface>`") is asserted as done but a few surfaces remain on raw `<Modal>` + `BlurView`.
**Why it happens:** the audit is by `grep`, but `<Modal>`-using files are not the only candidates — `BottomSheetModal`, `Dropdown`, `Popover` and custom modal components exist.
**How to avoid:** run the suggested grep heuristic from UI-SPEC and document each match in the plan as either (a) migrated, or (b) explicitly out of scope with a written reason.

**Audit list (from `grep -rln "<Modal\|adaptive-modal-sheet\|BottomSheet" packages/app/src/components/` 2026-05-01):**

```
packages/app/src/components/
├── add-host-method-modal.tsx
├── add-host-modal.tsx
├── adaptive-modal-sheet.tsx                ← shared sheet primitive — migrate first
├── agent-list.tsx                          ← reuses BottomSheet
├── agent-status-bar.tsx                    ← inline modal
├── attachment-lightbox.tsx
├── combined-model-selector.tsx
├── command-center.tsx                      ← REPLACED by cmdk web variant + bottom-sheet native variant
├── keyboard-shortcuts-dialog.tsx
├── new-task-modal.tsx
├── pair-link-modal.tsx
├── project-picker-modal.tsx
├── provider-diagnostic-sheet.tsx
├── selectable-text-modal.tsx
├── tool-call-sheet.tsx
├── workspace-hover-card.tsx
├── workspace-rename-modal.tsx
├── workspace-setup-dialog.tsx
└── ui/
    ├── combobox.tsx
    ├── context-menu.tsx
    ├── dropdown-menu.tsx
    ├── isolated-bottom-sheet-modal.tsx     ← shared sheet primitive — migrate alongside adaptive-modal-sheet.tsx
    ├── tooltip.tsx
    └── (any future popover)
```

**Warning signs:** a phase-exit verification finds a modal still rendering on raw `<View style={{ backgroundColor: rgba(...) }}>`.

### Pitfall 6: Schema break from chat-row state

**What goes wrong:** new `pinnedAt` / `mutedAt` / `unreadCount` fields are added to `AgentSnapshotPayloadSchema` without `.optional()`, breaking old clients.
**Why it happens:** D-11's "additive" thinking is settings-only — the schema rule (CLAUDE.md hard rule) still applies regardless.
**How to avoid:** every new field MUST be `.optional()` with sensible default; frozen-fixture v1.8 / v1.9 / v1.10 / v1.11 parse tests stay green; a v1.12 fixture is added if the daemon emits new fields. Phase 1's `RESERVED_FIELDS` registry is the gate.
**Warning signs:** a frozen-fixture test fails on parse.

### Pitfall 7: Smoothed-text expansion creep

**What goes wrong:** D-19 says smoothed-text is "AI streaming message bubbles only" but a developer adds it to tool-call output or system messages because "they animate similarly".
**Why it happens:** `use-smoothed-text` is a one-import hook — easy to spread.
**How to avoid:** today's repo has exactly one consumer (`message.tsx`). Phase 2 confirms via grep that the count stays at 1. Test: `grep -rln "useSmoothedText" packages/app/src/` returns ≤2 (the hook file + `message.tsx`).
**Warning signs:** grep shows ≥3 consumers.

### Pitfall 8: Haptic over-fire on iOS Taptic Engine

**What goes wrong:** missing or insufficient debounce in `useHaptic()` causes visible / felt latency or system throttling under rapid swipes.
**Why it happens:** D-18 specifies 200ms-per-event-type debounce; easy to drop or miscompute.
**How to avoid:** the debounce key is `event-type` (light / medium / heavy), not call site. A single state-change emitting two `light` haptics within 200ms collapses; a `light` then `heavy` does not.
**Warning signs:** rapid swipe-left without committing fires multiple `light` haptics within 200ms in test.

### Pitfall 9: Otter brand creep

**What goes wrong:** the Otter illustration shows up in a "subsequent empty Chats list" or in routine error toasts, violating D-14 / D-17.
**Why it happens:** Otter assets are easy to drop into any empty-state view.
**How to avoid:** `assets/otter/` directory is the single brand source; consumers MUST gate on a "first-time" flag from the `OnboardingStateStore`. A test asserts the flag is read before render.
**Warning signs:** any non-first-time empty-state route imports from `@/assets/otter/...`.

### Pitfall 10: Workspace tap-to-switch races on slow networks

**What goes wrong:** D-07 mandates "immediate switch", but if the workspace data hasn't loaded yet (TanStack Query miss), the user sees a brief blank state.
**Why it happens:** the active-workspace store updates synchronously but the rendered chat list depends on TanStack Query data.
**How to avoid:** show a `<MathCurveLoader>` (D-13 — top-level load) for the first ≤200ms while query resolves; if cached, no loader. Optimistic-style: route `replace` immediately, store updates immediately, query revalidates in the background.
**Warning signs:** workspace switch on a slow network shows a 500ms blank pane.

## Code Examples

Verified patterns (live in this repo as of 2026-05-01).

### `<GlassSurface>` consumption

```typescript
// Source: packages/app/src/components/ui/glass-surface.tsx (Phase 1)
// — already token-driven, supports radius variants, web + native paths
import { GlassSurface } from "@/components/ui/glass-surface";

// In a modal root:
<GlassSurface radius="sheet" strong>
  {children}
</GlassSurface>

// In a popover anchored to a row:
<GlassSurface radius="card">
  {menuItems}
</GlassSurface>
```

### Tab + Stack switch with `router.replace`

```typescript
// Source: packages/app/src/components/mobile-tab-host.tsx:31-49
const handleSelect = useCallback(
  (tab: MobileTab) => {
    if (tab === activeTab) return;
    switch (tab) {
      case "chats":
        router.replace(buildHostSessionsRoute(serverId));
        return;
      case "settings":
        router.replace("/settings");
        return;
      // ... no router.push — switching tabs never piles up history
    }
  },
  [activeTab, serverId],
);
```

### `isHovered || isNative || isCompact` for hover-fallback (Phase 1 chevron fix)

```typescript
// Source: packages/app/src/components/message.tsx:2604-2606
// works on web"). Combine isHovered with isNative + isCompact so the
// controls are always visible on native and hover-to-show on web.
const isActive = isHovered || isExpanded || isNative || isCompact;
```

### Haptic call site (today — to be wrapped by `useHaptic()`)

```typescript
// Source: packages/app/src/components/sidebar-workspace-list.tsx:1053, 1076, 1089
import * as Haptics from "expo-haptics";
// ...
void Haptics.selectionAsync().catch(() => {});
// ...
void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
```

Phase 2 collapses these into `useHaptic().fire("light" | "medium" | "heavy")` per D-18.

### Smoothed-text consumption (today's single call site)

```typescript
// Source: packages/app/src/components/message.tsx (only consumer of useSmoothedText)
// `grep -rln "useSmoothedText" packages/app/src/` returns 2 files:
//   - hooks/use-smoothed-text.ts (the hook)
//   - components/message.tsx (the only consumer)
//
// D-19 confirms this is correct — Phase 2 should NOT add new consumers.
```

### AsyncStorage settings persistence pattern

```typescript
// Source: packages/app/src/hooks/use-settings.ts:185-220
export async function loadSettingsFromStorage(): Promise<AppSettings> {
  // ...
  const stored = await AsyncStorage.getItem(APP_SETTINGS_KEY);
  if (stored) {
    const parsed = JSON.parse(stored) as Partial<AppSettings>;
    // ...
  }
  // ...
}

// Phase 2 follows this pattern for OnboardingStateStore + LabsOptInStore.
```

### Existing voice intent registry (12 commands today)

```typescript
// Source: packages/app/src/voice-control/voice-commands.ts:294-305
export const VOICE_COMMANDS: VoiceCommand[] = [
  openFileExplorer,
  closeFileExplorer,
  toggleFocusMode,
  findWorkspace,
  switchToWorkspace,
  switchToAgent,
  sendToActiveAgent,
  interruptActiveAgent,
  listAgents,
  openSettings,
] as unknown as VoiceCommand[];

// Phase 2 wraps each command's handler to dispatch via ActionRegistry.dispatch(actionId, ...)
// — voice intents become "registry-dispatchers" without a daemon-side carve.
```

### Existing keyboard action dispatcher (Phase 1 seam)

```typescript
// Source: packages/app/src/keyboard/keyboard-action-dispatcher.ts:74-115
// — existing dispatcher with handlers / scopes / priority. Phase 2 wires
// keyboardActionDispatcher.dispatch(...) to ActionRegistry.dispatch(...) so
// every keyboard action is also a registry action.
export function createKeyboardActionDispatcher() {
  /* ... */
}
export const keyboardActionDispatcher = createKeyboardActionDispatcher();
```

### Bilingual i18n init (already shipped)

```typescript
// Source: packages/app/src/i18n/init.ts (Phase 1)
import en from "./locales/en.json";
import zh from "./locales/zh.json";
// ...
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, zh: { translation: zh } },
  lng: detectDeviceLanguage(),
  fallbackLng: "en",
  // ...
});
```

Phase 2 adds keys per UI-SPEC §Copywriting Contract — no infra change needed.

## State of the Art

| Old Approach                                                | Current Approach                                    | When Changed                                   | Impact                                                                                                                |
| ----------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Hand-rolled command palette filtering / ARIA / keyboard-nav | `cmdk@1.1.1` (headless)                             | 2023+ — adopted by Linear, Vercel, Raycast Web | Removes ~hundreds of LOC of bespoke filter logic.                                                                     |
| Hand-rolled keyboard shortcuts via raw `keydown` listeners  | `react-hotkeys-hook@5.x` (scopes / sequences)       | v5 (2024) added scopes + sequences             | Per-screen activation, focus suppression, vim-style chords.                                                           |
| JS-rendered toasts                                          | `burnt@0.13.0` (system iOS/Android, Sonner on web)  | 2023+ — Burnt 0.13 stable                      | iOS / Android system look. JS-rendered toasts feel non-native on iOS.                                                 |
| Liquid Glass via `BlurView` only                            | iOS 26 native `<GlassView>` via `expo-glass-effect` | iOS 26 (2025)                                  | Indistinguishable from system surfaces on iOS 26; falls back to `expo-blur` below. **Carries Phase 1 research flag.** |
| AsyncStorage for hot-path preferences                       | `react-native-mmkv@4.x` (synchronous, JSI-backed)   | New Architecture stable (2024+)                | NOT adopted in Phase 2 — defer to a future cleanup phase.                                                             |
| Reanimated `useAnimatedStyle` for state-change motions      | `moti@0.30.0` (declarative on top of Reanimated)    | 2024 — moti 0.30 stable                        | Optional. Reanimated 4 is still the primitive; moti is a sugar layer.                                                 |

**Deprecated / outdated:**

- **`onPointerEnter` / `onPointerLeave` outside `.web.ts`** — silently no-op or crash on iOS / Android (CLAUDE.md hard rule; lint already in place at warn-level; D-20 promotes to error before this phase ships).
- **`<FlatList>` for lists past ~200 items** — TanStack Virtual is preferred on web; FlashList v2 is preferred on native (deferred — Phase 2 SES-04 not in scope).
- **Hand-rolled `Haptics.*` calls scattered through components** — collapsed into `useHaptic()` hook this phase.

## Assumptions Log

> Claims tagged `[ASSUMED]` need user confirmation before locking in plans.

| #   | Claim                                                                                                                                                                                                                                                                                                                                                     | Section                          | Risk if Wrong                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | The 5-bucket Settings IA reorg should keep the existing 9 slugs reachable via redirect routes from the old paths (D-11). The exact mapping (e.g. which slugs land under "Account" vs "Advanced") is the planner's call.                                                                                                                                   | Settings IA                      | Low — additive migration; no data loss. Wrong mapping is reversible.                                                                                                                                                                |
| A2  | Pin / mute / archive / unread are **client-side state** for v0.7 unless the planner confirms they need cross-device parity (then they become daemon-managed, schema additions follow). The CONTEXT `<code_context>` flags this open: "if pin / mute / archive are daemon-managed (probably yes for cross-device parity), the schema additions land here". | Architectural Responsibility Map | Medium — client-only is faster to ship but loses cross-device parity. Daemon-managed adds a schema migration but matches the milestone's "as immediate as your editor" promise. **Recommendation:** ask the user during plan-phase. |
| A3  | The `welcomeShown` AsyncStorage key is named `@ottie/onboarding/welcome-shown` (or planner choice). Existing pattern at `i18n/init.ts:LANGUAGE_STORAGE_KEY`.                                                                                                                                                                                              | Code Examples                    | Low — naming is conventional; planner can rename freely.                                                                                                                                                                            |
| A4  | Light / medium / heavy haptic mapping per D-18 maps to `Haptics.ImpactFeedbackStyle.Light` / `.Medium` / `Haptics.NotificationFeedbackType.Warning` (UI-SPEC §Interaction Contract — Haptics).                                                                                                                                                            | Code Examples                    | Low — `expo-haptics` API is stable; mapping is conventional.                                                                                                                                                                        |
| A5  | The CI parity test for ActionRegistry uses Vitest (existing test framework — `packages/app/package.json:25`). The test reads the registry, asserts each ID is registered with ≥2 (web/Tauri) or ≥1 (native) modality. Implementation file: `packages/app/src/actions/registry.parity.test.ts`.                                                            | Validation Architecture          | Low — Vitest is the de facto test runner in this repo.                                                                                                                                                                              |
| A6  | `<DelightToast>` localStorage flags use AsyncStorage on native and `localStorage` on web (D-17 says "localStorage-flagged"). On native, use AsyncStorage with the same key prefix; the abstraction lives in the helper at `packages/app/src/utils/delight-toast.ts`.                                                                                      | Component Inventory              | Low — already a common pattern in this repo.                                                                                                                                                                                        |
| A7  | The 6 named NAT-01 actions (create agent / switch workspace / jump to recent / approve-deny permission / open settings / toggle theme) extend naturally to include the 8 chat-row context-menu items (D-04) and the 4 add-menu items (D-04), giving a registry of 18+ actions for the parity test to assert against.                                      | ActionRegistry                   | Low — additive; the parity test asserts coverage, not a count.                                                                                                                                                                      |
| A8  | `react-hotkeys-hook@5.3.0` is preferred over the CONTEXT-cited `5.2.4`. Both are v5; `5.3.0` is the current latest (`npm view react-hotkeys-hook version` returned 5.3.0 on 2026-05-01). The version bump is patch-level and API-compatible.                                                                                                              | Standard Stack                   | Low — patch-level bump; planner can pin either.                                                                                                                                                                                     |

## Open Questions

1. **Pin / mute / archive / unread state — daemon-managed or client-only?**
   - What we know: `archivedAt` is already in `AgentSnapshotPayloadSchema` (`packages/server/src/shared/messages.ts:638`) as `.nullable().optional()`. Pin / mute / unread are NOT in the schema. CONTEXT `<code_context>` flags this open.
   - What's unclear: whether the milestone wants cross-device parity for these states.
   - Recommendation: **discuss-phase or planner confirms with user**. If yes → schema additions follow Phase 1 D-08 discipline (`.optional()`, `RESERVED_FIELDS`, `@deprecated` if anything renames). If no → client-only Zustand store with AsyncStorage persistence per device.

2. **Which 4 tabs go beyond "Chats"?**
   - What we know: `<MobileTabBar>` and `<DesktopNavRail>` already share 4 IDs: `chats / devices / community / settings`. CONTEXT D-03 says only Chats is locked; the rest is planner discretion. NAV-A5 requires every destination reach from at least one tab.
   - What's unclear: whether to keep current 4-tab list or restructure (e.g. Chats / Recents / Hosts / Settings). Adding Voice / Recents tab beyond 4 risks tab bar overflow on narrow phones.
   - Recommendation: **keep the current 4-tab list as-is** unless Cmd-K and command-center jumps fail to reach a destination. The simplest answer also means the LEAST refactor.

3. **NAV-A5 audit — orphaned screens?**
   - What we know: routes registered in `app/_layout.tsx:RootStack` (lines 882-906): `welcome`, `pair-scan`, `settings/index`, `settings/[section]`, `settings/hosts/[serverId]`, `h/[serverId]/{workspace, agent, index, sessions, open-project, settings}`.
   - What's unclear: whether all these are reachable from the 4 tabs + cmd-K. `pair-scan?source=onboarding` only reaches via Welcome; `pair-scan?source=settings` only via Settings → Add Host.
   - Recommendation: planner adds an explicit reachability table in their PLAN.md and asserts every route is either tab-reachable, cmd-K-reachable, or explicitly out-of-band (deep link only — e.g. `pair-scan` from welcome is intentionally out-of-tab).

4. **`expo-glass-effect` validation — when?**
   - What we know: Phase 1 STATE.md flags this for Phase 2 start. UI-SPEC §FLAGs deferred carries it. iOS 26 dev build is required.
   - What's unclear: whether the team has an iOS 26 device available before this phase ships.
   - Recommendation: planner adds a Wave 0 task to validate on an iOS 26 device. If validation cannot be performed inside the milestone window, plans pin `<GlassSurface>` to `expo-blur` for Phase 2 and queue the upgrade for a follow-up.

5. **Pair-scan recovery — does "switch to local daemon" mean adding a manual host or using `manageBuiltInDaemon`?**
   - What we know: `app/pair-scan.tsx` is QR-only on native, renders a "Not available on web" card on web. `<AddHostModal>` is the manual-direct-entry path. `<PairLinkModal>` accepts pasted offer URLs.
   - What's unclear: "switch to local daemon" likely means "set `manageBuiltInDaemon=true`" + bootstrap the bundled daemon — but only on Tauri desktop. On mobile, "switch to local daemon" doesn't apply.
   - Recommendation: planner clarifies copy + behavior: on Tauri = enable bundled daemon; on iOS/Android = unavailable, show explanatory copy.

6. **CI parity test — which test runner asserts modality coverage?**
   - What we know: Vitest is the runner in `packages/app/package.json` (`vitest run`).
   - What's unclear: whether the parity test should also assert that every registry action has at least one EN + ZH localized label. UI-SPEC §Copywriting Contract suggests yes; CONTEXT D-08 doesn't.
   - Recommendation: include i18n parity in the CI test (cheap to add, prevents the most common bilingual omission).

## Environment Availability

| Dependency                         | Required By                            | Available        | Version                             | Fallback                                               |
| ---------------------------------- | -------------------------------------- | ---------------- | ----------------------------------- | ------------------------------------------------------ |
| Node.js ≥20                        | All packages                           | ✓                | — (CI default)                      | —                                                      |
| pnpm@9.12.0                        | Root package manager                   | ✓                | 9.12.0 (per `package.json` engines) | —                                                      |
| iOS 26 dev build                   | `expo-glass-effect` validation         | ?                | unknown                             | `expo-blur` only — UI-SPEC accepts as the safe default |
| Android API 31+                    | `expo-blur` `dimezisBlurView`          | ✓                | per existing config                 | —                                                      |
| Tauri v2 build                     | Desktop shell + global-shortcut bridge | ✓                | per `packages/desktop`              | —                                                      |
| Anthropic / OpenAI / OpenCode keys | Runtime — agent providers              | provider-managed | —                                   | — (Ottie does not own these)                           |
| `$OTTIE_HOME/daemon.log`           | Error copy hint per D-15               | ✓                | runtime path                        | —                                                      |

**Missing dependencies with no fallback:**

- iOS 26 dev build for `expo-glass-effect` validation — **research flag carried**. If unavailable, fallback to `expo-blur` only is the safe default; THM-02 contrast audit still needed.

**Missing dependencies with fallback:**

- (none — every Phase 2 path has a fallback or is already on disk)

## Validation Architecture

### Test Framework

| Property           | Value                                                                        |
| ------------------ | ---------------------------------------------------------------------------- |
| Framework          | Vitest `^3.2.4` (already configured)                                         |
| Config file        | `packages/app/vitest.config.ts` (root) + `packages/app` package.json scripts |
| Quick run command  | `npx vitest run <file> --bail=1` (per CLAUDE.md — never run full suite)      |
| Full suite command | `pnpm --filter @ottie/app test` (only via CI; never local)                   |

### Phase Requirements → Test Map

| Req ID                       | Behavior                                                            | Test Type                             | Automated Command                                                                                                                          | File Exists?                                                                                             |
| ---------------------------- | ------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| ONB-01                       | First-launch ≤3-tap flow when daemon is local-bundled               | unit + manual UAT                     | `npx vitest run packages/app/src/app/index.test.tsx --bail=1`                                                                              | ❌ Wave 0                                                                                                |
| ONB-02                       | `shouldUseDesktopDaemon()` true → skip pair-scan                    | unit                                  | `npx vitest run packages/app/src/desktop/daemon/desktop-daemon.test.ts --bail=1`                                                           | ❌ Wave 0                                                                                                |
| ONB-03                       | Pair-scan inline recovery preserves typed input across attempts     | unit + manual UAT                     | `npx vitest run packages/app/src/app/pair-scan.test.tsx --bail=1`                                                                          | ❌ Wave 0                                                                                                |
| ONB-04                       | Welcome screen renders Skip CTA + "Don't show again" + sets flag    | unit                                  | `npx vitest run packages/app/src/components/welcome-screen.test.tsx --bail=1`                                                              | ❌ Wave 0 (existing render test only)                                                                    |
| NAV-A1                       | Host → workspace → agent affordances consistent                     | manual UAT                            | —                                                                                                                                          | manual                                                                                                   |
| NAV-A2                       | Sidebar overlay auto-collapses on compact; workspace one-tap switch | unit (store + nav)                    | `npx vitest run packages/app/src/stores/navigation-active-workspace-store.test.ts --bail=1`                                                | ✓                                                                                                        |
| NAV-A5                       | Mobile tab bar + sidebar reach every destination                    | reachability table assertion          | `npx vitest run packages/app/src/actions/registry.parity.test.ts --bail=1`                                                                 | ❌ Wave 0                                                                                                |
| SET-01                       | 5 buckets present; old slugs redirect                               | unit                                  | `npx vitest run packages/app/src/utils/host-routes.test.ts --bail=1` (extend)                                                              | ✓ (extend)                                                                                               |
| SET-03                       | Cmd-K → setting jump in 2 taps                                      | unit (palette items include settings) | `npx vitest run packages/app/src/hooks/use-command-center.test.ts --bail=1`                                                                | ❌ Wave 0                                                                                                |
| SET-04                       | Labs row stability badges + opt-in toggle                           | unit                                  | `npx vitest run packages/app/src/components/settings/labs-row.test.tsx --bail=1`                                                           | ❌ Wave 0                                                                                                |
| THM-02                       | Every modal/sheet uses `<GlassSurface>`; AA contrast                | grep audit + manual visual            | `grep -rln "<Modal\|BottomSheet" packages/app/src/components/ \| while read f; do grep -q "<GlassSurface" "$f" \|\| echo "MISS: $f"; done` | tooling sufficient                                                                                       |
| THM-03                       | Math-curve loader appears only at top-level loads                   | grep audit                            | `grep -rln "<MathCurveLoader" packages/app/src/` (count must equal D-13's 3 surfaces)                                                      | tooling sufficient                                                                                       |
| THM-04                       | Otter brand placement                                               | manual UAT + asset audit              | `ls packages/app/src/assets/otter/ \| wc -l`                                                                                               | manual                                                                                                   |
| NAT-01                       | Voice / cmd-center / long-press / keyboard parity ≥80%              | unit (parity test)                    | `npx vitest run packages/app/src/actions/registry.parity.test.ts --bail=1`                                                                 | ❌ Wave 0                                                                                                |
| NAT-02                       | `useHaptic()` debounce + low-power-aware                            | unit                                  | `npx vitest run packages/app/src/hooks/use-haptic.test.ts --bail=1`                                                                        | ❌ Wave 0                                                                                                |
| NAT-03 (lint promotion D-20) | Pointer-event lint promoted to error                                | tooling                               | `npm run lint:pointer-events` (planner adds script) → exits 1 on any violation                                                             | ✓ (script logic exists at `tools/lint/pointer-events-web-only.ts`; needs to be wired as `--strict` flag) |
| NAT-04                       | Smoothed-text appears only in AI streaming bubble                   | grep audit                            | `grep -rln "useSmoothedText" packages/app/src/` returns ≤2 paths (the hook + message.tsx)                                                  | tooling sufficient                                                                                       |

### Sampling Rate

- **Per task commit:** `npx vitest run <touched file> --bail=1` + `npm run typecheck` + `npm run lint -- <touched file>` + `npm run format:files -- <touched file>` (CLAUDE.md hard rule).
- **Per wave merge:** sampled `pnpm --filter @ottie/app test` of touched-area test files only. NEVER full suite locally.
- **Phase gate:** CI runs `pnpm -r test` (full suite) — `/gsd-verify-work` confirms green.

### Wave 0 Gaps

- [ ] `packages/app/src/actions/registry.ts` — new module (D-08)
- [ ] `packages/app/src/actions/registry.test.ts` — covers register / dispatch / unregister
- [ ] `packages/app/src/actions/registry.parity.test.ts` — covers NAT-01 + NAV-A4 + NAV-A5
- [ ] `packages/app/src/hooks/use-haptic.ts` + `use-haptic.test.ts` — covers NAT-02
- [ ] `packages/app/src/components/welcome-screen.test.tsx` — covers ONB-04 (extend if exists)
- [ ] `packages/app/src/components/settings/labs-row.test.tsx` — covers SET-04
- [ ] `packages/app/src/components/settings/flat-list.test.tsx` — covers SET-01
- [ ] Wave 0 task: validate `expo-glass-effect` on iOS 26 dev build before THM-02 migration begins
- [ ] Wave 0 task: extend NAT-03 lint script with `--strict` flag (or equivalent) so D-20 can flip on at phase exit

_(All other test infrastructure exists from Phase 1 — Vitest, frozen-fixture pattern, lint scripts, test-collocation convention.)_

## Security Domain

> `security_enforcement` not explicitly set in `.planning/config.json`; treated as enabled per default.

### Applicable ASVS Categories

| ASVS Category               | Applies                                   | Standard Control                                                                                                                                                                                                               |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V2 Authentication           | yes (read-only)                           | Phase 2 does NOT touch auth — `LocalTokenAuth` (Phase 1 ARCH-03) MUST not regress. New "switch to local daemon" recovery action consumes existing modes only.                                                                  |
| V3 Session Management       | no                                        | No new session model in Phase 2.                                                                                                                                                                                               |
| V4 Access Control           | yes (UI surfacing of pending permissions) | UI-only; daemon-side AGT-05 is deferred.                                                                                                                                                                                       |
| V5 Input Validation         | yes                                       | Welcome / pair-scan / labs inputs MUST be Zod-validated at parse boundary. Existing `connection-offer.ts` schema covers pair-scan. New chat-row pin/mute fields go through `messages.ts` Zod schemas.                          |
| V6 Cryptography             | no                                        | Relay E2EE unchanged; no new crypto in Phase 2.                                                                                                                                                                                |
| V7 Error Handling / Logging | yes                                       | Error copy references `$OTTIE_HOME/daemon.log` (D-15). Logged values MUST NOT include local tokens (Phase 1 already redacts via `[REDACTED]` per `01-VERIFICATION.md`).                                                        |
| V8 Data Protection          | yes                                       | AsyncStorage values are device-local — onboarding flag + delight flags + labs opt-ins do NOT contain PII. New chat-row state, IF daemon-managed, follows the local-first invariant — never sent to relay servers in plaintext. |
| V14 Configuration           | yes                                       | Settings IA reorg adds NO new feature flags that bypass auth or schema.                                                                                                                                                        |

### Known Threat Patterns for Ottie's stack

| Pattern                                                                      | STRIDE                  | Standard Mitigation                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cross-device chat-row state inconsistency leading to "approved twice" replay | Tampering / Repudiation | If pin/mute/archive become daemon-managed, a single source of truth on the daemon prevents diverged client state. AGT-05's "decision broadcast to all connected clients" is the precedent. |
| WebSocket schema drift breaking old clients                                  | DoS (effective)         | CLAUDE.md hard rule + Phase 1 RESERVED_FIELDS + frozen-fixture v1.8 / v1.9 / v1.10 / v1.11 parse tests. Adding v1.12 fixture if Phase 2 introduces new fields.                             |
| Settings IA migration leaks deep-link information                            | Information Disclosure  | Redirect routes are server-side-equivalent — they don't expose path internals to remote actors. AsyncStorage values are device-local.                                                      |
| `expo-glass-effect` malformed on iOS 26 leading to UI crash                  | DoS                     | `<GlassSurface>` API surface absorbs the choice; if `expo-glass-effect` import fails / errors, the safe path is `expo-blur`.                                                               |
| Hand-rolled action dispatch from one modality bypasses validation in others  | Spoofing                | ActionRegistry enforces a single dispatch path; the parity test asserts that no modality has its own private path.                                                                         |

## Sources

### Primary (HIGH confidence — verified this session)

- `packages/app/src/components/ui/glass-surface.tsx` — Phase 1 primitive; supports `radius` variants, web + native paths.
- `packages/app/src/components/{welcome-screen, mobile-tab-bar, mobile-tab-host, desktop-nav-rail, command-center, message, sidebar-workspace-list}.tsx` — concrete, read-this-session.
- `packages/app/src/screens/{sessions-screen, settings-screen}.tsx` — concrete, read.
- `packages/app/src/screens/settings/labs-section.tsx` — current Labs UI (937 lines, hand-rolled).
- `packages/app/src/styles/tokens/{primitives, typography}.ts` — Phase 1 token tree.
- `packages/app/src/keyboard/{keyboard-action-dispatcher, actions}.ts` — Phase 1 keyboard seam.
- `packages/app/src/voice-control/{voice-router, voice-commands}.ts` — voice intent registry.
- `packages/app/src/hooks/{use-smoothed-text, use-command-center, use-settings}.ts` — Phase-1-shipped hooks.
- `packages/app/src/contexts/toast-context.tsx` + `components/toast-host.tsx` — existing in-app toast layer.
- `packages/app/src/i18n/{init.ts, locales/{en,zh}.json}` — bilingual setup.
- `packages/app/src/utils/host-routes.ts:391-415` — `SETTINGS_SECTION_SLUGS` + builders.
- `packages/server/src/shared/messages.ts:630-664, 2295-2326` — `AgentSnapshotPayloadSchema` + `agent_update`.
- `packages/app/src/desktop/daemon/desktop-daemon.ts:113` — `shouldUseDesktopDaemon()`.
- `packages/app/src/constants/{platform, layout}.ts` — four-gate model + `useIsCompactFormFactor()`.
- `packages/app/app.config.js:58` — `newArchEnabled: true` (verified).
- `packages/app/package.json` — full dep list verified; cmdk / react-hotkeys-hook / burnt / mmkv / glass-effect NOT yet installed.
- `tools/lint/pointer-events-web-only.ts` — existing NAT-03 lint script.
- `.planning/research/STACK.md` — milestone-level research with version recommendations.
- `.planning/phases/01-architectural-foundations-gating-bug-fixes/01-VERIFICATION.md` — Phase 1 status (4/5 truths verified).
- `npm view <pkg> version` for `cmdk`, `react-hotkeys-hook`, `burnt`, `sonner`, `moti`, `react-native-mmkv`, `expo-glass-effect`, `expo-symbols` (run 2026-05-01).

### Secondary (MEDIUM confidence)

- CONTEXT.md, DISCUSSION-LOG.md, UI-SPEC.md (verbatim — locked decisions).
- ROADMAP.md Phase 2 SC#1–5.
- REQUIREMENTS.md ONB-01..04 / NAV-A1, A2, A5 / SET-01, 03, 04 / THM-02, 03, 04 / NAT-01, 02, 04.

### Tertiary (LOW confidence — flagged for validation)

- `expo-glass-effect@55.0.10` runtime behavior on iOS 26 dev build — not validated this session; carried as a research flag for Phase 2 plan.
- The exact tab partition beyond Chats — locked decision is "Chats only", remainder is planner discretion (CONTEXT D-03). Recommendation in `Open Questions §2`.

## Metadata

**Confidence breakdown:**

- Standard stack: **HIGH** — every existing dep verified by reading `packages/app/package.json` this session; every new dep version verified via `npm view` this session.
- Architecture: **HIGH** — Tab + Stack model already shipped; ActionRegistry pattern matches research/ARCHITECTURE.md §5; existing precedents grepped this session.
- Pitfalls: **MEDIUM-HIGH** — derived from `.planning/research/PITFALLS.md` + concrete codebase observations (e.g. exact modal audit list, `useSmoothedText` consumer count, `Haptics.*` call-site count, missing `Swipeable` adoption).
- Code examples: **HIGH** — every snippet pasted from the live codebase with line references.
- Open questions: **MEDIUM** — Q1 (chat-row state ownership) is the most consequential; user confirmation reduces risk.

**Research date:** 2026-05-01
**Valid until:** 2026-05-31 (30 days; npm versions and `expo-glass-effect` may shift faster — re-verify if Phase 2 plans land beyond this window).

## RESEARCH COMPLETE
