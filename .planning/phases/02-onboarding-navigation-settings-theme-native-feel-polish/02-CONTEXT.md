# Phase 2: Onboarding, Navigation, Settings, Theme & Native-Feel Polish - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Sweep the user-visible polish in one coherent pass on top of the seams Phase 1 landed. The phase is structured around a **WeChat-style navigation + interaction model** (mobile and desktop equivalent by intent, not by gesture), plus the universal `ActionRegistry` action surface, plus the surface migration onto `<GlassSurface>`, plus native-feel parity (haptics, smoothed text, voice/keyboard/long-press).

Specifically delivers:

1. **WeChat-style nav shell** — Tab + Stack Navigation (each tab has its own back stack); cold-open lands on **Chats tab** by default (not Welcome); chat list with long-press / right-click context menu, swipe-left / hover quick-actions, top-right `+` menu, pull-to-refresh / `⌘R`, infinite scroll for older sessions, unread / muted / pinned badges. Reference products: WeChat mobile + Telegram Desktop.
2. **`ActionRegistry` + `cmdk` (web/Tauri) + `react-hotkeys-hook`** — single source of truth for actions; voice / long-press / context-menu items / kebab / cmd-center / keyboard all dispatch by action ID. CI parity test asserts every named action reachable from ≥2 modalities (web/Tauri) or ≥1 (native). This was original Phase 2 scope, restored here.
3. **Settings IA** — WeChat-style flat scrolling list; the 5 buckets (Account / Agents / Voice / Appearance / Advanced) are section headers; each row pushes a sub-page. Labs is a sub-page under Advanced with row-level Experimental / Beta / Stable badges.
4. **Surface migration onto `<GlassSurface>`** — every modal / sheet / popover / bottom-sheet / dropdown migrates onto the primitive landed in Phase 1 (Liquid Glass on iOS 26 via `expo-glass-effect`, `expo-blur` fallback, web equivalent). Light/dark AA contrast audit.
5. **Visual language for loading / empty / error** — toast-led (`burnt`); `math-curve` loader limited to top-level loads (chat list initial load, agent run-start, command-center search); error flows on callout cards on `<GlassSurface>` with `daemon.log` hint copy; first-time empty states only carry Otter illustration.
6. **Otter brand placement (restrained)** — splash + welcome (skippable) + first-time empty (first workspace, first chat list open) + 3 delight-moment toasts (first-agent-created, first-permission-approved, first-voice-command), localStorage-flagged one-time. No fixed mascot, no brand chrome.
7. **Native-feel: `useHaptic()` semantic vocabulary** — WeChat 6-event mapping; debounce 200ms per event; respects low-power-mode and per-user haptic toggle. `use-smoothed-text` collapsed to a single source of truth: AI streaming message bubbles only.
8. **Pointer-event lint promoted from warn to error** before this phase ships (NAT-03 wording).
9. **Onboarding** (ONB-01..04) reconciled with WeChat-style cold-open: first launch shows Welcome with explicit Skip; Skip / "Don't show again" sets a flag; subsequent launches go straight to Chats. Pair-scan recovery surface stays inline per ROADMAP. Specifics deferred to research + planner.

Requirements covered: ONB-01, ONB-02, ONB-03, ONB-04, NAV-A1, NAV-A2, NAV-A5, SET-01, SET-03, SET-04, THM-02, THM-03, THM-04, NAT-01, NAT-02, NAT-04 (16 of 36 v1).

</domain>

<decisions>
## Implementation Decisions

### Navigation model (WeChat-style — applies globally to mobile + desktop)

- **D-01:** Nav shell is **Tab + Stack Navigation**. Each tab owns its own navigation stack; back returns within the tab, never crosses tabs. On Tauri / wide web, the tab bar materializes as the sidebar's primary section list; on mobile narrow, it's the bottom tab bar. Both reach every destination (NAV-A5 parity).
- **D-02:** Default cold-open destination is the **Chats tab** (chat list visible immediately). Welcome screen only renders on first-ever launch with a visible "Skip" / "Don't show again" toggle. Subsequent launches skip Welcome.
- **D-03:** **Chats tab is THE primary surface.** Tab list confirmed: Chats; remaining tabs (e.g. Hosts / Settings / Voice / Recents) are planner / research discretion — see Deferred. The minimum constraint is that ≥1 of those tabs reaches every Settings IA bucket from D-09.
- **D-04:** Chat list interactions (mobile + desktop **equivalent by intent**, not by gesture):
  - **Long-press** (mobile) / **right-click** (desktop) → context menu: 置顶 / 取消置顶 / 标记未读 / 标记已读 / 静音 / 删除 / 重命名 / 归档 (8 items). Each menu item dispatches by ActionRegistry ID.
  - **Swipe-left** (mobile) / **hover** quick-action buttons (desktop) → top-3 most-used: 标记已读 / 静音 / 删除. Swipe past threshold = heavy haptic (warn) before commit.
  - **Top-right `+` menu** → 4 items: 新建 chat / 扫一扫配对 / 加入 host / 创建 workspace.
  - **Pull-to-refresh** (mobile) / **⌘R + auto-refresh** (desktop) → re-fetch daemon state.
  - **Infinite scroll** (mobile pull-up to load more, desktop scroll-to-bottom auto-load) → older sessions paginated.
- **D-05:** Chat row status indicators: **unread** = red numeric badge on the right; **muted** = same badge greyed (still numeric, de-emphasized); **pinned** = row pinned to list top with distinct background-tint. All three states are token-driven theme variants of a single `ChatRow` component.
- **D-06:** Cold-open splash → if total unread > 0, briefly surface a **total-unread popup** (WeChat-style) before the Chats list takes focus.
- **D-07:** Workspace switching: tapping any workspace row in the sidebar list = **immediate switch** (no two-tap workspace-then-confirm). Cmd-K "Switch workspace" lists all and switches on Enter. Long-press / right-click on workspace row exposes the context menu (rename / kebab equivalent).

### Action surface (ActionRegistry + cmdk + react-hotkeys-hook)

- **D-08:** Build `packages/app/src/actions/registry.ts` (the universal action map modelled on VS Code `CommandRegistry`); add `cmdk@1.1.1` for web/Tauri command-center palette via Metro `.web.ts`; native gets a bottom-sheet variant via `.native.ts`; add `react-hotkeys-hook@5.2.4` for keyboard. Voice intents, long-press menu items, swipe quick-actions, kebab menus, and command-center entries all dispatch by action ID. CI parity test asserts every registry action reachable from ≥2 modalities (web/Tauri) or ≥1 modality (native). The 6-action reference set from REQUIREMENTS NAT-01 (create agent, switch workspace, jump-to-recent, approve/deny pending permission, open settings, toggle theme) is the minimum coverage; the 8 chat-row context-menu items (D-04) extend the set naturally.

### Settings IA (WeChat-style flat list)

- **D-09:** Settings is a **flat scrolling list** with 5 group headers: `## Account / ## Agents / ## Voice / ## Appearance / ## Advanced`. Each row in a group pushes a sub-page. Cmd-K action `Open settings: <X>` deep-links to any sub-page (≤2 taps, satisfies SET-03). Phase 1's Local-daemon panel (D-13) lives under Advanced; legacy / power-user flags also collect under Advanced (preserved per SET-01 — nothing removed).
- **D-10:** **Labs** is a sub-page under Advanced. Each experiment row: status badge (Experimental 橙 / Beta 黄 / Stable 绿) + name + short description + opt-in toggle. Bottom button: "Reset all labs to default". Stability labels are author-set in code (not daemon-driven). Default toggle state derives from current shipped state per flag.
- **D-11:** Settings IA migration is **additive** — old setting paths keep working with redirect routes for the milestone duration. Schema rule per Phase 1 D-08 (`@deprecated since= removeAfter=`) applies to any settings field that gets relocated.

### Visual language (loading / empty / error)

- **D-12:** **Toast-led** state-change feedback via `burnt`: state transitions (已读 / 静音 / 创建成功 / 权限判定 / agent run-start/stop / send-message ack) → short toast. Toasts are non-blocking, debounced per event-type.
- **D-13:** **Math-curve loader** is reserved for top-level loads as a brand moment: Chats list initial load, agent run-start, command-center search "thinking". Everywhere else (form submit, button spinner, route transition) uses native skeleton screens or a plain neutral spinner — no math-curve.
- **D-14:** **Empty states** are 97% pure copy. Otter illustration appears only on first-time-empty contexts: first-ever workspace, first-ever Chats list open. Subsequent empty states (e.g. user has 0 chats but did before) are pure copy, no Otter.
- **D-15:** **Error states** are a callout card on `<GlassSurface>` (title + explanation + CTA), supplemented by a short `burnt` toast. Error copy explicitly references `$OTTIE_HOME/daemon.log` for diagnosis (per Phase 1 D-14 + PROJECT.md "User feedback themes"). Error vocabulary documented as part of THM-03 deliverable.
- **D-16:** **`<GlassSurface>` migration scope:** every modal, sheet, popover, bottom-sheet, dropdown that exists today (audit list owned by planner). iOS 26 `expo-glass-effect`, `expo-blur` fallback below, web-equivalent (CSS `backdrop-filter`) on browsers/Tauri. Light/dark contrast pass AA audit at phase exit. **Research flag (carried from Phase 1 deferred):** validate `expo-glass-effect` on iOS 26 dev build before committing.

### Otter brand placement (restrained)

- **D-17:** Otter character appears in: (1) splash logo, (2) Welcome screen illustration, (3) first-time-empty state for first workspace + first Chats list, (4) 3 one-time delight-moment toasts (first-agent-created, first-permission-approved, first-voice-command — flagged in localStorage, never repeat). **Not** in nav chrome, **not** as a fixed mascot, **not** in routine empty/loading/error states. Brand assets centralized in a single `packages/app/src/assets/otter/` directory (planner-named).

### Native-feel: haptic + smoothed text

- **D-18:** **`useHaptic()` semantic vocabulary** (WeChat 6-event mapping):
  - `light` (info / tick): swipe-left reaches threshold; agent run-start; agent run-stop; send-message ack; cmd-center result confirm.
  - `medium` (action confirmed): long-press menu opens; default destructive action (delete after confirm).
  - `heavy` (warn): swipe-left passes the delete-threshold (before commit); permission-prompt arrival.
  - **No haptic** on plain tap of chat row / tab / list item.
  - Hook debounces same event-type within 200ms; no-op when low-power-mode is on or the user-toggle in Settings is off.
- **D-19:** **`use-smoothed-text` rollout** is **collapsed to one source**: AI streaming message bubbles only (the text from the model as it arrives chunk-by-chunk). Tool-call output, completed messages, system messages, code blocks, and any non-streaming text **do not** go through smoothing. Existing scattered usages (the in-flight commits show ~6) get refactored to call from this single point.

### Lint promotions (NAT-03)

- **D-20:** Pointer-event lint (`onPointerEnter`/`onPointerLeave` outside `.web.ts`) is promoted from **warn → error** before this phase ships, per REQUIREMENTS NAT-03 acceptance wording. The other three lint rules from Phase 1 (schema-evolution, hardcoded-color, isHovered-alone) stay at warn-level until Phase 5 of the original plan was supposed to land — since Phase 5 is no longer scheduled, those are punted to a future cleanup milestone (see Deferred).

### Onboarding reconciliation (ONB-04 vs WeChat default-skip)

- **D-21:** **First-ever launch:** Welcome screen renders in user-locale (en/zh) with Otter illustration, two short paragraphs explaining what Ottie is and what's about to happen, and two buttons: **"Get started"** (continues into pair-scan or local-daemon detection) and **"Skip for power users"** (lands on Chats tab; flag set to never show Welcome again). **Subsequent launches:** go straight to Chats tab. Pair-scan failure recovery surface is **inline** (same screen, error renders below the QR / manual entry) per ROADMAP — regenerate code, manual key entry, switch to local daemon, no app restart, typed input preserved. Detail copy and screen layout are planner discretion.

### Claude's Discretion (planner-level)

- Tab list beyond Chats (e.g. Hosts / Settings / Voice / Recents tab structure) — researcher should audit Telegram Desktop / WeChat tab compositions and propose; planner picks.
- Specific swipe-threshold pixel value for the swipe-left delete confirmation.
- Specific motion timing for math-curve loader entry / exit (Phase 1 motion tokens own the curves).
- The exact Otter sticker / emoji set used in delight-moment toasts (asset list).
- Settings sub-page layout per row (description copy, control widget choice).
- Pair-scan inline-recovery error vocabulary (en + zh).
- The exact welcome-screen copy (en + zh) and the "Don't show again" persistence key name.
- ActionRegistry implementation details (Map vs. Record, action-ID naming convention) — see VS Code CommandRegistry for prior art.
- cmdk filtering / ranking strategy (whether `fuse.js` is needed) — start without; add only if required.
- Native command-center bottom-sheet implementation (`@gorhom/bottom-sheet` is already in the stack).
- Per-action keybinding choices for `react-hotkeys-hook` (researcher should propose, planner finalizes; defer scope-conflict analysis).

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project planning context

- `.planning/ROADMAP.md` — Phase 2 entry: success criteria 1–5, requirement set, "depends on Phase 1" dependency line.
- `.planning/REQUIREMENTS.md` — full v1 list; Phase 2 owns ONB-01..04, NAV-A1, NAV-A2, NAV-A5, SET-01, SET-03, SET-04, THM-02, THM-03, THM-04, NAT-01, NAT-02, NAT-04.
- `.planning/PROJECT.md` — milestone framing, constraints (backward-compat, performance, privacy), key decisions table.
- `.planning/STATE.md` — open research flags carried from Phase 1: New Architecture status, Tauri global-shortcut bridge, `expo-glass-effect` iOS 26 validation.

### Phase 1 carry-forward (must not regress)

- `.planning/phases/01-architectural-foundations-gating-bug-fixes/01-CONTEXT.md` — full Phase 1 decision set; especially D-05/D-06 (`chromeLayoutEnabled` + `keyboardShortcutsEnabled` split), D-09..D-12 (theme tokens), D-13..D-16 (Local-daemon settings panel), D-01..D-04 (carve flags).
- `.planning/phases/01-architectural-foundations-gating-bug-fixes/01-VERIFICATION.md` — Phase 1 acceptance baseline.

### Research outputs (HIGH-confidence prior art)

- `.planning/research/SUMMARY.md` — milestone-level research synthesis; Phase 2 maps to original "Phase 2 + Phase 4" content (action surface + nav/settings/theme/native-feel sweep).
- `.planning/research/ARCHITECTURE.md` §5 — `ActionRegistry` design (VS Code CommandRegistry parallel), action-ID naming, modality-dispatch contract.
- `.planning/research/ARCHITECTURE.md` §8 — three-tier theme tokens; surface migration discipline.
- `.planning/research/STACK.md` — `cmdk@1.1.1`, `react-hotkeys-hook@5.2.4`, `burnt@0.13.0`, `expo-glass-effect`, `expo-blur@^15`, `expo-symbols@^55.0.7`, `moti@^0.30.0` recommended versions and rationale.
- `.planning/research/PITFALLS.md` #1 (polish-becomes-redesign), #6 (parity rot if registry is bypassed), #5 (theme retrofit stalling), #7 (cross-platform regression blind spots).

### Codebase intel (current state — read before touching code)

- `.planning/codebase/ARCHITECTURE.md` — current package layering, WebSocket protocol, where session/agent state lives.
- `.planning/codebase/STRUCTURE.md` — monorepo layout; "Where to add new code" table for new components / hooks / stores.
- `.planning/codebase/CONVENTIONS.md` — TypeScript hygiene, platform gating (`isWeb` / `isNative` / `getIsElectron()` / `useIsCompactFormFactor()`), file organization, import aliases.
- `.planning/codebase/CONCERNS.md` — full inventory; the Phase 2 surface area touches CONCERNS H13 (already fixed in Phase 1 — verify no regression) and CONCERNS C12 (already fixed; lint must promote to error here).

### Coding standards & platform discipline

- `CLAUDE.md` — repo-wide rules: bilingual en+zh parity for every visible string, `npm run typecheck && npm run lint && npm run format` after every change, never restart daemon on :6868 without permission, never run full test suite locally.
- `docs/CODING_STANDARDS.md` — type hygiene, error handling, state design, React patterns, file organization.
- `docs/CODING_STANDARDS.md` "Platform Gating" — `isHovered || isNative || isCompact` pattern; lint enforces from Phase 1.

### Bilingual i18n

- `packages/app/src/i18n/locales/en.json` — every visible string from this phase MUST land here.
- `packages/app/src/i18n/locales/zh.json` — Simplified Chinese parity (CLAUDE.md hard rule).

### Theme + glass surface (foundations from Phase 1)

- `packages/app/src/styles/tokens/` — three-tier token tree (primitive → semantic → component) landed in Phase 1; Phase 2 consumes for every surface migration.
- `packages/app/src/components/glass-surface.tsx` — primitive landed in Phase 1; Phase 2 migrates every modal / sheet / popover / bottom-sheet / dropdown onto it.
- `packages/app/src/components/daemon-connection-dot.tsx` — already token-migrated in Phase 1; NAT-05 wiring is a future-phase concern.
- `packages/app/src/components/math-curve-loader/curves.ts` — motion curves; consumed for D-13 top-level loads.

### Schema discipline (Phase 1 foundation)

- `packages/server/src/shared/messages.ts` — Zod schemas at WS boundary; any new field added in this phase MUST follow `@deprecated since= removeAfter=` discipline (Phase 1 ARCH-02). Frozen-fixture parse tests for v1.8 / v1.9 / v1.10 must stay green.
- `CLAUDE.md` "WebSocket / Message Schema Rules" — never narrow, never remove, never optional → required. Hard rule.

### Reference products (UX prior art for the WeChat-style nav model)

- WeChat mobile (微信 9.x) — chat list interaction model; long-press menu vocabulary; swipe-left top-3 quick actions; tab + stack composition; unread / muted / pinned visual language.
- Telegram Desktop — desktop adaptation of the same model: right-click menu in lieu of long-press, hover-revealed action buttons in lieu of swipe-left, ⌘R refresh, keyboard-first navigation. Ottie's desktop side mirrors Telegram Desktop's translation rather than porting mobile gestures.

### Settings reorg (existing surface to absorb)

- `packages/app/src/screens/settings/` — current settings screens; Phase 2 reorganizes into the 5-bucket flat list (D-09).
- `packages/app/src/app/settings/` — current settings routes; redirects required during migration.

### Action registry (new code)

- `packages/app/src/actions/registry.ts` — to be created in Phase 2; the universal action map.
- `packages/app/src/keyboard/` — current keyboard-shortcut handling; Phase 2 wires to ActionRegistry.
- `packages/app/src/voice-control/` — current voice handlers; Phase 2 refactors voice intents to dispatch by action ID via the registry. Note: full voice-handler carve (C-6/C-7) is OUT of milestone scope per ROADMAP — registry-dispatch is a wrapping refactor only.
- `packages/app/src/components/command-center.tsx` — current command surface; Phase 2 migrates to `cmdk` (web/Tauri Metro `.web.ts`) + bottom-sheet variant (`.native.ts`).

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- **`packages/app/src/components/glass-surface.tsx`** + tokens at `packages/app/src/styles/tokens/` — Phase 1 foundations; Phase 2 consumes directly for every surface migration.
- **`packages/app/src/components/math-curve-loader/`** — already exists; Phase 2 narrows usage to top-level loads (D-13).
- **`packages/app/src/constants/platform.ts`** — `isWeb` / `isNative` / `getIsElectron()` / `useIsCompactFormFactor()` (the latter from `@/constants/layout`); WeChat-style mobile-vs-desktop branching consumes these.
- **`packages/app/src/components/message.tsx`** — chevron pattern fixed in Phase 1; the `isHovered || isNative || isCompact` pattern propagates to chat-row hover quick-actions on desktop.
- **`packages/app/src/keyboard/`** — existing keyboard infra; Phase 2 wires to ActionRegistry rather than rebuilding.
- **`packages/app/src/voice-control/`** — existing voice intents; Phase 2 refactors them into ActionRegistry dispatchers (no carve).
- **`packages/app/src/components/command-center.tsx`** — existing command surface; replaced by cmdk web variant + bottom-sheet native variant via Metro split.
- **`@gorhom/bottom-sheet@^5.2.6`** — already in the stack; reused for native command-center variant + native context-menu fallback for the chat-row long-press.
- **`packages/app/src/i18n/locales/{en,zh}.json`** — bilingual string store; every new copy in Phase 2 lands here in lockstep.
- **`packages/app/src/screens/settings/`** + `packages/app/src/app/settings/` — existing settings screens & routes; Phase 2 reorganizes around the 5-bucket flat list.

### Established Patterns

- **Metro `.web.ts` / `.native.ts` split** — used in Phase 1 (`timeline-cache-store`); Phase 2 follows for `command-center` (cmdk vs bottom-sheet), and platform-specific glass-surface implementations if needed.
- **`isHovered || isNative || isCompact` hover-fallback** — Phase 1 chevron fix; chat-row desktop hover quick-actions follow this exact pattern; on native they are always-visible behind a swipe gesture.
- **Zustand stores under `packages/app/src/stores/`** — chat-list state, unread counts, pin/mute flags live here; Phase 2 adds an `OnboardingStateStore` (welcome-shown, delight-moments-fired) and an `ActionRegistry` (read-only after init).
- **TanStack Query for server state, Zustand for UI state** — chat list / recents come from Query (driven by daemon WS invalidation), interaction state stays in Zustand.
- **`burnt` for native toasts (web via `sonner`)** — research-recommended; Phase 2 introduces if not yet present.

### Integration Points

- **Tab + Stack root** — likely `packages/app/src/app/_layout.tsx` (Expo Router). Phase 2 reshapes this into the WeChat tab+stack model.
- **`packages/app/src/actions/registry.ts`** — new file; import from voice / keyboard / cmd-center / chat-row context-menu / kebab call sites.
- **`packages/server/src/shared/messages.ts`** — any new chat-row field (pin / mute / archive flags) follows the Phase 1 schema discipline (`.optional()` + transform fallback + `@deprecated` annotations if a field gets renamed).
- **`packages/server/src/server/`** — daemon-side delivery of chat list state; if pin / mute / archive are daemon-managed (probably yes for cross-device parity), the schema additions land here. Researcher should confirm.
- **`packages/app/src/screens/workspace/`** — chat list (currently sessions-screen) is the keystone surface; the WeChat interaction model reshapes it.
- **`packages/desktop/src-tauri/src/`** — Tauri side; the global-shortcut bridge research-flag (Cmd+Shift+O summon) lives here. Defer if research says the bridge isn't ready.
- **`packages/app/src/components/glass-surface.tsx`** — every modal/sheet/popover migration goes through this primitive.

</code_context>

<specifics>
## Specific Ideas

- **Reference products are WeChat mobile + Telegram Desktop, by intent not gesture.** Desktop side adapts: long-press → right-click, swipe-left → hover quick-action buttons, pull-to-refresh → ⌘R + auto-refresh, infinite scroll → scroll-to-bottom auto-load.
- **Chat row context-menu vocabulary is a fixed 8-item set** (置顶 / 取消置顶 / 标记未读 / 标记已读 / 静音 / 删除 / 重命名 / 归档). Bilingual EN copy needs to be drafted in lockstep; researcher should propose the EN vocabulary and confirm against shipped WeChat / Telegram English clients for consistency.
- **Top-right `+` menu is fixed 4-item:** 新建 chat / 扫一扫配对 / 加入 host / 创建 workspace.
- **Cold-open Splash → unread popup is the WeChat "总未读数" surface.** One-shot, decays after ~1.5s or on first interaction. Skipped silently if total unread = 0.
- **Math-curve loader is a brand moment, not a busy-spinner replacement.** Reserved exclusively for: Chats list initial load, agent run-start, command-center search "thinking". Anywhere else is neutral skeleton or system spinner.
- **Otter is a restrained brand presence.** WeChat-equivalent — character lives at brand-entry surfaces only (splash + welcome + first-time-empty + 3 one-time delights). Never as a fixed mascot.
- **`useHaptic()` debounce is 200ms per event type.** Same event firing within the window is collapsed.
- **`use-smoothed-text` collapses to one usage point.** AI streaming message bubble only — the in-flight scattered usages (~6) refactor to call from a single source.
- **Settings deep-links via Cmd-K.** The path "Open settings: Voice → STT engine" lands in 2 taps from any screen, satisfying SET-03.
- **ActionRegistry is the parity test substrate.** CI parity test enumerates registry actions and asserts modality coverage. Without the registry the test has nothing to assert against — this is the keystone decision.
- **Pair-scan recovery is inline.** Errors render below the QR/manual-entry surface on the same screen; typed input is preserved across recovery attempts; no app restart.
- **Welcome screen "Skip for power users" sets a `welcomeShown` flag in MMKV/AsyncStorage** (depending on New-Arch status — researcher resolves). Subsequent launches go straight to Chats.

</specifics>

<deferred>
## Deferred Ideas

- **Tab list beyond Chats** — exact composition (Hosts / Recents / Settings / Voice as additional tabs?) is research + planner territory. ROADMAP's NAV-A5 just requires "every destination reachable from both surfaces"; the tab partition itself is implementation detail.
- **Pair-scan inline-recovery error copy** — en + zh wording is planner discretion within the constraint that recovery covers (regenerate code / manual key entry / switch to local daemon).
- **Welcome screen exact copy** — en + zh first-launch narrative; planner discretion within the constraint that it explains "what Ottie is and what one is about to do" and offers a clear Skip.
- **Otter sticker / emoji set** — exact assets used in delight-moment toasts; planner pulls from the brand asset library (or initiates a small art ask if missing).
- **`fuse.js` for cmdk ranking** — research-flagged as optional; start without, add only if cmdk's default fuzzy matching is insufficient.
- **`expo-symbols` adoption beyond chrome icons** — planner's call where to use SF Symbols vs `lucide-react-native` per surface.
- **`moti` adoption scope** — research recommends for state-change transitions (modal-in, list-item-in, success-pulse); planner decides which animations get migrated and which stay on raw Reanimated 4.
- **Lint promotion timing for the other three Phase 1 lint rules** (schema-evolution, hardcoded-color, isHovered-alone). Original plan promoted them in Phase 5 of the un-collapsed roadmap; Phase 5 is no longer scheduled, so these stay at warn-level until a future cleanup milestone. NAT-03 (pointer events) is the only one that lands as **error** in this phase per REQUIREMENTS wording.
- **Optimistic agent creation (AGT-04)** — explicitly deferred per ROADMAP "depends on Phase 1, optimistic UI / voice handler carve out of milestone scope". Stays out.
- **Voice-handler carve (C-6/C-7)** — explicitly deferred per ROADMAP. Voice intents wrap into ActionRegistry but the daemon-side `VoiceSessionHandler` carve is not in scope.
- **Permission UX (AGT-05)** — covered by REQUIREMENTS but not in this phase's ROADMAP success-criteria list. Stays in v1.11 backlog as a future phase or carries into a follow-on milestone.
- **Cross-device session continuity (SES-05)** + **SES-03/04 timeline performance** — not in Phase 2 success criteria. Future phase.
- **`recent_sessions_update` daemon-computed broadcast** — would be needed for SES-01 cross-device order; planner / research determines if a minimal shim lands here or the requirement gets marked explicitly deferred.
- **Tauri global-shortcut bridge for `Cmd+Shift+O` global summon** — research flag from Phase 1 STATE.md. If the bridge isn't ready, defer the global-summon shortcut; in-app `Cmd+K` still works without bridge changes.
- **MMKV pin version vs AsyncStorage** — research flag (New-Arch status). If New-Arch is on, MMKV v3+; if not, MMKV v2.x or AsyncStorage. Researcher resolves before planner finalizes the welcome / labs / per-workspace last-used state stores.
- **`expo-glass-effect` validation on iOS 26 dev build** — research flag carried from Phase 1. Must validate before committing every modal/sheet/popover to Liquid Glass; `expo-blur` fallback is the safe default if validation fails.
- **DTCG JSON token export** — explicitly out per Phase 1 D-12 (no v1.11 consumer). Future-milestone export target.
- **`SCHEMA_EVOLUTION.md` doc** — was scheduled for original Phase 5; Phase 5 is no longer scheduled. Documentation deferred to a future cleanup milestone; the runtime discipline (RESERVED_FIELDS, frozen fixtures, lint rule) shipped in Phase 1 and is sufficient for Phase 2 schema additions.
- **Big-bang `session.ts` rewrite** — universally rejected antipattern; carve continuation (C-4..C-9) is deferred outside this milestone.

### Reviewed Todos (not folded)

None — no todos matched Phase 2 scope at discussion time.

</deferred>

---

_Phase: 2-Onboarding, Navigation, Settings, Theme & Native-Feel Polish_
_Context gathered: 2026-05-01_
