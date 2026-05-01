# Phase 2: Onboarding, Navigation, Settings, Theme & Native-Feel Polish - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-01
**Phase:** 2-Onboarding, Navigation, Settings, Theme & Native-Feel Polish
**Areas discussed:** Navigation model (action surface + workspace switch + sidebar/tab bar), Settings IA (bucket organization + Labs design), Look-and-feel layer (visual language + Otter brand + haptic + smoothed-text)
**Skipped (planner / research discretion):** Onboarding shape & first-agent experience

---

## Area 1 — Action surface (Q1)

| Option                                                         | Description                                                                                                          | Selected |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| Yes — build ActionRegistry + cmdk + react-hotkeys-hook         | Full registry; voice / long-press / kebab / cmd-center / keyboard dispatch by action ID; CI parity test; adds 3 deps | ✓        |
| Yes — ActionRegistry only, no cmdk migration yet               | TS module only; defer cmdk + Metro split                                                                             |          |
| No — enumerate named action set & write CI parity test by hand | Hand-written test covering 6 named actions; no registry abstraction                                                  |          |
| Skip parity test — surface coverage only                       | Manual audit at phase exit; no CI gate                                                                               |          |

**User's choice:** ActionRegistry + cmdk + react-hotkeys-hook (Recommended).
**Notes:** Registry is the keystone substrate; the parity test has nothing concrete to assert against without it. Original Phase 2 scope restored.

---

## Area 2 — Navigation model (free-text vision, not AskUserQuestion)

User volunteered a complete nav model after the first sidebar/tab-bar question was paused for clarification. The vision is "WeChat-style nav + interaction model, mobile + desktop equivalent by intent, not by gesture":

- Tab + Stack Navigation (each tab owns its stack); cold-open lands on Chats tab; Welcome only on first-ever launch with explicit Skip.
- Chat list interactions: long-press (mobile) / right-click (desktop) → 8-item context menu (置顶 / 取消置顶 / 标记未读 / 标记已读 / 静音 / 删除 / 重命名 / 归档); swipe-left (mobile) / hover quick-actions (desktop) → top-3 (标记已读 / 静音 / 删除); top-right `+` menu → 4 items (新建 chat / 扫一扫配对 / 加入 host / 创建 workspace); pull-to-refresh (mobile) / ⌘R + auto (desktop); infinite scroll (mobile pull-up / desktop scroll-bottom).
- Status indicators: unread red badge (numeric), muted = greyed badge, pinned = top of list with distinct background tint.
- Cold-open splash → if total unread > 0 surface a brief total-unread popup (WeChat-style).
- Reference products: WeChat mobile + Telegram Desktop. Desktop adapts gestures to native interactions (right-click, hover, keyboard).

**Selected:** the volunteered free-text vision; locked verbatim.
**Notes:** Cascades into onboarding (welcome becomes skippable, Chats is default), sidebar/tab bar (chat-first lists with right-click + hover quick-actions on desktop, no purely hierarchical drawer), long-press contract (every menu item is an ActionRegistry action — extends parity-test set naturally), visual language (unread / muted / pinned are token-driven theme variants).

---

## Area 2 — Workspace switch (Q2 within Navigation)

| Option                                                   | Description                                                                                                    | Selected |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------- |
| Tap workspace in sidebar list = immediately switch       | Slack pattern; sidebar row tap swaps active workspace; mobile compact = bottom-sheet switcher from header chip | ✓        |
| Long-press active workspace chip = switcher overlay      | Long-press / click on chip opens switcher overlay                                                              |          |
| Sidebar acts as switcher; mobile gets a 'Workspaces' tab | Dedicated tab on mobile; sidebar fills role on desktop                                                         |          |
| You decide — surfaces via cmd-center always work         | Punt to planner                                                                                                |          |

**User's choice:** Tap workspace in sidebar list = immediate switch (Recommended).
**Notes:** Cmd-K switch action is a given. Long-press / right-click on workspace row exposes the same context menu as the chat-row pattern (rename, etc.).

---

## Area 3 — Settings IA (Q1)

| Option                                                           | Description                                                                                                                      | Selected |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| WeChat-style flat scrolling list — 5 buckets are section headers | Flat list with `## Account / ## Agents / ## Voice / ## Appearance / ## Advanced` headers; each row pushes sub-page; ⌘K deep-link | ✓        |
| Tabbed: 5 chips at top, in-place switching                       | macOS System Settings sidebar style; mobile chips horizontally scrollable                                                        |          |
| Three-tier drill-down: bucket cards → row list → detail          | iOS Settings-app hierarchy; one extra layer                                                                                      |          |
| You decide — extend current settings-screen.tsx shape            | Audit and extend conservatively                                                                                                  |          |

**User's choice:** WeChat-style flat scrolling list (Recommended).
**Notes:** Matches the WeChat "我" tab layout; ⌘K can deep-link to any sub-page in ≤2 taps (satisfies SET-03).

---

## Area 3 — Labs section design (Q2)

| Option                                                  | Description                                                                                                                                                                | Selected |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Labs = sub-page under Advanced, row-level status badges | Each experiment a row: badge (Experimental 橙 / Beta 黄 / Stable 绿) + name + description + toggle; "Reset all labs" button at bottom; author-set stability labels in code | ✓        |
| Labs as a 6th top-level bucket                          | Higher visibility but breaks the SET-01 5-bucket constraint                                                                                                                |          |
| Labs = config.json hand-edit, no GUI                    | Lightest; doesn't satisfy SET-04's "opt-in/out individually" UI requirement                                                                                                |          |
| You decide labs flag manifest                           | Planner extracts from current shipped flags                                                                                                                                |          |

**User's choice:** Labs = Advanced sub-page, row-level status badges (Recommended).
**Notes:** Default toggle state derives from current shipped state per flag. Stability labels are author-set in code (not daemon-driven).

---

## Area 4 — Loading / empty / error visual language (Q1)

| Option                                                                          | Description                                                                                                                                                                                                                   | Selected |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Toast-led + math-curve loader limited to top-level (chat list, agent run-start) | Burnt toasts for state changes; math-curve only for top-level loads (Chats list initial, agent run-start, cmd-center search); Otter only on first-time empty; error = callout card on `<GlassSurface>` + daemon.log hint copy | ✓        |
| Math-curve loader EVERYWHERE — brand-exclusive loading language                 | All loading goes through math-curve; brand memory point but possibly exaggerated for quick interactions                                                                                                                       |          |
| Callout cards as primary; toast only for non-actionable info / warn             | Heavier; more judgment cost                                                                                                                                                                                                   |          |
| You decide based on WeChat / Telegram defaults                                  | Punt to planner / research                                                                                                                                                                                                    |          |

**User's choice:** Toast-led + math-curve loader limited to top-level (Recommended).
**Notes:** Error copy explicitly references `$OTTIE_HOME/daemon.log` per Phase 1 D-14 + PROJECT.md "User feedback themes".

---

## Area 4 — Otter brand placement (Q2)

| Option                                                              | Description                                                                                                                                                                                                   | Selected |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Restrained — splash + welcome + first-time empty + 3 delight toasts | Otter on splash, welcome illustration, first workspace empty, first Chats list empty, and 3 one-time delights (first-agent-created, first-permission-approved, first-voice-command) — flagged in localStorage | ✓        |
| Conservative — splash + welcome only                                | Otter only on cold-open path; misses ROADMAP's "key delight moments" wording                                                                                                                                  |          |
| Maximalist — fixed mascot in nav chrome                             | Telegram bot-chat-companion / Notion AI nav presence; risks brand fatigue and contradicts WeChat restraint                                                                                                    |          |
| You decide delight-moment expression                                | Locked surfaces but planner picks the exact sticker / emoji set                                                                                                                                               |          |

**User's choice:** Restrained — splash + welcome + first-time empty + 3 delight toasts (Recommended).
**Notes:** Delight-moment toasts are one-time, flagged in localStorage. Brand assets centralized.

---

## Area 4 — Haptic vocabulary + smoothed-text rollout (Q3 — combined)

| Option                                                                             | Description                                                                                                                                                                                                                                                                                              | Selected |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| WeChat 6-event haptic vocabulary + smoothed-text only on AI streaming bubbles      | Long-press menu = medium; swipe-left threshold = light tick; delete-threshold = heavy warn; tap = no haptic; agent run-start/stop / send-message = light; permission-prompt = heavy. `useHaptic()` debounced 200ms; respects low-power and per-user toggle. Smoothed-text limited to AI streaming bubble | ✓        |
| Conservative haptic — only permission + agent state transitions; no gesture haptic | Avoids over-firing; lower than WeChat-equivalent feel                                                                                                                                                                                                                                                    |          |
| Default-on haptic including row taps                                               | Feels native but battery cost + over-engineered perception                                                                                                                                                                                                                                               |          |
| You decide haptic mapping + smoothed-text scope based on Phase 1 audit             | Planner audits existing call-sites                                                                                                                                                                                                                                                                       |          |

**User's choice:** WeChat 6-event haptic vocabulary + smoothed-text only on AI streaming bubbles (Recommended).
**Notes:** `useHaptic()` is a single source of truth; existing scattered `use-smoothed-text` usages (~6 from in-flight commits) refactor to call from one point.

---

## Wrap-up — Ready for context (Q5)

| Option                                                                  | Description                                                                                       | Selected |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------- |
| Ready — write CONTEXT.md, advance to plan-phase                         | Onboarding details / pair-scan recovery / tab list / swipe threshold all go to planner + research | ✓        |
| Lock 'Tab list beyond Chats' (Hosts / Settings / Voice / Recents …)     | Stronger steering for downstream IA                                                               |          |
| Lock 'Onboarding default-skip vs ONB-04 welcome screen' reconciliation  | Detail of first-launch vs subsequent-launch                                                       |          |
| Lock 'cmdk native bottom-sheet decision' (full palette vs bottom sheet) | Native cmd-center UX detail                                                                       |          |

**User's choice:** Ready — write CONTEXT.md (Recommended).
**Notes:** All deferred items captured in CONTEXT.md `<deferred>` section.

---

## Claude's Discretion

Areas captured under `<decisions>` "Claude's Discretion" in CONTEXT.md:

- Tab list beyond Chats — researcher proposes; planner picks.
- Swipe-threshold pixel value.
- Math-curve loader entry/exit motion timing.
- Otter sticker / emoji set for delight toasts.
- Settings sub-page row layouts.
- Pair-scan inline-recovery error vocabulary (en + zh).
- Welcome screen exact copy (en + zh) + "Don't show again" persistence key.
- ActionRegistry implementation details (Map vs Record, action-ID naming).
- cmdk filtering / ranking (whether `fuse.js` needed).
- Native cmd-center bottom-sheet implementation.
- Per-action keybinding choices.

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` section. Highlights:

- Optimistic agent creation (AGT-04) — explicitly out per ROADMAP.
- Voice-handler carve (C-6/C-7) — explicitly out per ROADMAP.
- Permission UX (AGT-05), SES-03/04/05, NAT-05 — out of Phase 2 success criteria.
- Tauri global-shortcut bridge — research-flag-dependent.
- MMKV pin / New-Arch status — research-flag-dependent.
- `expo-glass-effect` iOS 26 validation — research-flag-dependent.
- Lint promotions for schema-evolution / hardcoded-color / isHovered-alone — punted to future cleanup milestone (only NAT-03 promotes to error this phase per requirement wording).
- DTCG token export, `SCHEMA_EVOLUTION.md` doc, big-bang session.ts rewrite — explicitly out.
