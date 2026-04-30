# Project Research Summary

**Project:** Ottie v1.11 — User Flow Polish
**Domain:** Cross-platform mobile/desktop control surface for local AI coding agents (Expo + React Native + Tauri v2 + Node.js daemon)
**Researched:** 2026-04-29
**Confidence:** HIGH overall; MEDIUM on two stack items (MMKV New-Arch dependency, FlashList v2 deferral)

---

## Executive Summary

Ottie v1.11 is a polish milestone on a shipped product, not a greenfield build. The primary risk is not "can we build the features?" but rather "will structural debt prevent safe parallel execution, and will polish work quietly expand into a redesign?" Two architectural moves gate almost everything else: carving `session.ts` (9,500 lines, ARCH-01) into domain-owned handlers via a Strangler-Fig approach, and formalizing schema-evolution discipline (ARCH-02) before any new fields land. Every phase that touches agent invocation, session management, or voice parity pays a merge-conflict tax until those moves happen. Both researchers and all four research dimensions independently converge on this sequencing: architecture first, then user-facing polish.

The recommended approach is a five-phase milestone: (1) architectural foundations — carve entry points + schema discipline + local auth + theme token skeleton; (2) fix gating bugs and wire the universal action surface; (3) complete the carve, ship optimistic agent creation and session recents; (4) full polish of sidebar/nav/settings/native-feel; (5) cleanup and audit. Stack additions are intentionally minimal — the Expo SDK 54 + Unistyles 3.2 + Reanimated 4 + TanStack Query baseline is healthy. The additions that matter are `cmdk` + `react-hotkeys-hook` (web/Tauri command surface), `burnt` (native toasts), `expo-glass-effect` + `expo-blur` (glass surfaces), `expo-symbols` (native icons), and `moti` (declarative state-change animation). All are additive and do not require architectural migration.

The top risks in order: (1) parallel phases colliding on `session.ts` before it is carved — solved by making C-1/C-2 (MessageRouter + Zod boundary extraction) the very first commits of Phase 1; (2) optimistic UI for agent creation lying to the user about side-effect actions — solved by tiered optimism (never show "approved" before daemon confirms a permission decision); (3) cross-platform regression blind spots, two of which are already shipped (CONCERNS H13/C12) — solved by lint enforcement of the `isHovered || isNative || isCompact` and `onPointerEnter`-in-.web-only rules before Phase 4 begins; (4) the theme retrofit stalling mid-migration — solved by a hardcoded-color lint rule landing at the start of the theme phase, not after.

---

## Key Findings

### Recommended Stack

The existing Expo 54 / RN 0.81 / Unistyles 3.2 / Reanimated 4 / gorhom-bottom-sheet / TanStack Query + Virtual / Zustand / expo-router 6 / expo-haptics / Tauri v2 stack is the right base. Do not replace any of it. The additions below are the only net-new dependencies v1.11 needs; everything else is pattern adoption, not library adoption.

**Core additions (in order of surface area):**

- `cmdk@1.1.1` — headless command-palette primitive for web/Tauri; replaces bespoke filter/select code in `command-center.tsx`. Web-only, guarded by `isWeb`, Metro-split from native bottom-sheet surface.
- `react-hotkeys-hook@5.2.4` — keyboard shortcuts with scopes and sequences for web/Tauri; powers the AGT-07/NAT-01/NAV-A4 tri-modal parity requirement. No-op on native.
- `burnt@0.13.0` — native iOS/Android/web-via-Sonner toast primitive; required by every "agent started / permission denied / host paired" transition that currently has no toast surface.
- `expo-glass-effect` (SDK 54) + `expo-blur@^15.0.x` — Liquid Glass on iOS 26+, blur fallback below; formalizes the in-flight `glass-surface.tsx` work onto the correct native API. Metro-split per platform.
- `expo-symbols@^55.0.7` (SDK-54-pinned) — SF Symbols / Material Symbols for native chrome icons; `lucide-react-native` remains the web/cross-platform fallback.
- `moti@^0.30.0` — declarative `<MotiView>` animation on top of Reanimated 4 for state-change transitions (modal-in, list-item-in, success-pulse); reduces `useAnimatedStyle` boilerplate across the polish pass.

**Pattern adoptions (no new library):**

- `useOptimistic` + `useTransition` (React 19 — already pinned) for agent creation and command-palette filtering.
- TanStack Query WebSocket-as-invalidation-signal pattern (WS message triggers `queryClient.invalidateQueries`, not data carrier).
- Single `useHaptic()` hook backed by MMKV preference, with debounce + low-power-mode no-op.
- Metro `.web.ts` / `.native.ts` split for the command-center shell (palette vs bottom-sheet).

**Deferred (do not adopt in v1.11):**

- `@shopify/flash-list@2.3.1` — New Architecture only; defer until Ottie confirms New Arch is on.
- `react-native-mmkv@4.3.1` — same New Arch caveat; v2.x line is the safe pin if still on legacy arch. Verify before adopting.
- Native Tabs (Expo SDK 54 alpha) — too unstable for a shipped-product polish milestone.
- Tamagui, NativeWind, `valibot` — all conflict with the existing stack (Unistyles 3 / Zod 4.4); do not introduce.

**Open stack questions (block roadmapper decisions):**

1. Is the app currently running New Architecture? Determines MMKV v3+ and FlashList v2 availability.
2. Does the Tauri bridge already expose a global-shortcut API? Determines whether `Cmd+Shift+O`-summon requires Rust-side work.
3. Is `theme.ts` token-shape stable? If not, freeze tokens before any screen migrates to `<GlassSurface>`.

### Expected Features

The research mapped Ottie's v1.11 requirements against category-leader references (Linear, Things 3, Raycast, Superhuman, ChatGPT mobile, Cursor, Tailscale, Plex, Slack huddle). The findings below are the bar the milestone must clear.

**Must have — table stakes (blocking user trust or representing shipped regressions):**

- Fix CONCERNS H13 (message chevron invisible on native) and C12 (`onPointerEnter` crash on native) — shipped regressions, must land in Phase 1.
- Fix CONCERNS H4 (OpenCode `listPersistedAgents` stub returning `[]`) — silent data loss; blocks any session-resume UX.
- Fix CONCERNS C11 (`chromeEnabled` flag split into independent feature flags) — blocks honest settings UX.
- Single canonical "new agent" entry point (AGT-01) across command-center / long-press / voice / keyboard.
- Provider/model/mode last-used per workspace (AGT-02) and ≤2-tap path to first message with optimistic feedback (AGT-04).
- Recent N sessions surfaced in sidebar (SES-01) with one-tap resume and visible status indicators.
- Connection state visible from every screen — daemon dot + version-mismatch + offline recovery (NAT-05).
- Permission requests with full tool-call context and single-tap approve/deny/edit (AGT-05).
- Theme token system as single source of truth (THM-01) — all subsequent surface work depends on it.
- Settings organized by user intent, not internal architecture (SET-01).
- `isHovered || isNative || isCompact` pattern enforced by lint, not convention.

**Should have — differentiators:**

- `ActionRegistry` (`packages/app/src/actions/registry.ts`) modeled on VS Code `CommandRegistry` — the one table that voice, command-center, long-press, and keybindings all consume. Prevents NAT-01 parity rot permanently.
- Optimistic agent creation with client-supplied nonce (Discord MESSAGE_CREATE pattern) and reconcile-or-fail-visibly flow.
- Daemon-computed recent sessions broadcast via `recent_sessions_update` — cross-device continuity falls out automatically.
- Glass surface treatment (`<GlassSurface>` primitive) on command-center, sidebar, sheets — iOS-26 Liquid Glass, blur fallback.
- Haptic vocabulary mapped to semantic intent (NAT-02/DF-G7): light=info, medium=action-confirmed, heavy=permission-required.
- Pull-down gesture from any screen invokes command center (mobile, DF-D3).
- Two-tier permission prompts: auto-approve whitelisted low-risk actions with audit trail; full diff prompt for high-risk actions.
- Session search and status-at-a-glance indicators.

**Defer to v1.12+:**

- Fork session (DF-C2) — depends on all providers persisting correctly; do not build on a broken foundation.
- "Hey Ottie" wake word (DF-G1) — genuinely category-defining but out of scope for a polish milestone.
- Apple Shortcuts integration (DF-G4), Live Activities / Dynamic Island (DF-G5) — large platform integrations; separate milestone.
- LAN auto-pair without QR (DF-A1) — requires ARCH-03 to land first, then daemon-side LAN discovery. ARCH-03 is in scope; full LAN-pair UX is v1.12.
- FlashList v2 / New Architecture adoption — deferred pending architecture confirmation.

### Architecture Approach

The three ARCH items are structural gates, not nice-to-haves. ARCH-01 (carve `session.ts`) uses a Router-first Strangler-Fig in nine independently-mergeable steps (C-1 through C-9), each leaving CI green. Build `MessageRouter` (C-1) and extract the Zod parse boundary (C-2) first, then carve domain handlers in dependency order — PermissionHandler first (smallest surface, critical path), then FileExplorer/Chat, VoiceHandler, AgentSessionHandler last (largest, unblocks AGT-04). ARCH-02 adopts Stripe's version-gating + Protobuf's reservation discipline with machine-readable `@deprecated since=vX.Y removeAfter=vA.B` annotations and a `deprecation-schedule.md` removal calendar. ARCH-03 adds a three-mode local auth (loopback-trust unchanged, auto-token for desktop-bundled, explicit env-var for non-loopback) — default `npm run dev` behavior is completely untouched.

**Major new components:**

1. `MessageRouter` + domain handlers (server) — carved from `session.ts`; dispatches by `msg.kind` to `AgentSessionHandler`, `PermissionHandler`, `VoiceSessionHandler`, `ChatSessionHandler`, `TerminalSessionHandler`, `FileExplorerHandler`, `ProjectsHandler`.
2. `ActionRegistry` (`packages/app/src/actions/registry.ts`) — single source of truth for user-invokable actions; consumed by command-center, voice router, long-press menus, keybindings.
3. `ThemeTokens` (`packages/app/src/styles/tokens/`) — primitive → semantic → component three-tier on top of Unistyles 3; platform splits for `glass-surface.{ios,native,web}.tsx`.
4. `OptimisticAgentStore` (Zustand) — pending agent records keyed by client nonce; reconcile on `agent_update` echo; 60s TTL + visible-failure on timeout.
5. `LocalTokenAuth` (server) — auto-generated 32-byte token for Tauri-bundled daemon; token file mode 0600 at `$OTTIE_HOME/local-token`.
6. Schema evolution infrastructure — `RESERVED_FIELDS` export, `deprecation-schedule.md`, CI lint that fails on `@deprecated` without `removeAfter`.

### Critical Pitfalls

1. **Polish milestone becomes a redesign** — bind each phase to measurable acceptance criteria (numeric or binary) from PROJECT.md; write in-bounds/out-of-bounds lines before each phase; use reference products rather than inventing patterns. Warning sign: PR diff exceeds 2× the lines its acceptance criteria imply.

2. **Parallel-phase contention on `session.ts`** — C-1 (MessageRouter) must land before any feature phase begins; carve by data ownership, not topic; no new features added to `session.ts` after carve begins; single-author windows per step. Warning sign: two PRs editing `session.ts` concurrently.

3. **Schema changes that look backward-compat but break old clients** — frozen-fixture parse tests for v1.8/v1.9/v1.10 client schemas run in CI before any `messages.ts` merge; behavioral-contract document next to `messages.ts`. Warning sign: `messages.ts` PR has no old-fixture test.

4. **Optimistic UI lying about side-effect actions** — tiered optimism: reversible feedback = always optimistic; sent/pending = clock not checkmark until ack; side-effect actions (permission approve, tool-call run, agent stop) = never optimistic. Warning sign: "Sent ✓" with no distinct "Delivered" state; permission approval shown before daemon ack.

5. **Theme retrofit stalling mid-migration** — hardcoded-color lint rule banning new hex/rgb/rgba in `packages/app/src/` lands at phase start; CI counter tracks that hardcoded-color count never increases. Warning sign: new components use `theme.ts`; bug-fix commits add `#hexcode`.

6. **Voice/command/keyboard parity rot** — `ActionRegistry` is the only place actions are defined; voice intents are pure mappers to action IDs; CI parity test asserts every registry action reachable from ≥N modalities. Warning sign: voice handlers contain literal action logic rather than registry ID dispatch.

7. **Cross-platform regression blind spots** — `onPointerEnter`/`onPointerLeave` outside `.web.ts` = lint error; `isHovered` alone as visibility gate = lint warning; PR screenshots required from ≥3 platforms on any `packages/app/` change. Warning sign: screenshots always from one platform.

---

## Implications for Roadmap

### Hard Sequencing Rules

1. **C-1 and C-2 (MessageRouter + Zod boundary) must be the first commits of the entire milestone.** Every phase that touches daemon message handling depends on the router seam existing.
2. **ARCH-02 (schema discipline, lint, deprecation-schedule.md) must precede the first new schema field.** AGT-04 (optimistic nonce field), SES-05 (recents broadcast), and THM-01 (theme-version handshake) all add new fields.
3. **C-7 (AgentSessionHandler carve) must precede AGT-04 (optimistic agent creation).** The optimistic-create logic needs the handler seam.
4. **ActionRegistry must precede NAT-01 (voice parity refactor) and the command-center cmdk migration.** Building either before the registry means they will immediately drift.
5. **THM-01 (theme token skeleton + lint rule) must precede all surface migration work (THM-02/03/04).** No component should be migrated until tokens exist and the lint rule prevents regressions.
6. **CONCERNS H13, C12, H4, and C11 bug fixes belong in Phase 1**, not deferred. They are shipped regressions that undermine confidence in subsequent polish work.
7. **C-3 (PermissionHandler carve) must precede AGT-05 (permission UX).** The permission prompt requires the handler seam to add action-byte capture and multi-device decision broadcast.

### Phase 1: Architectural Foundations

**Rationale:** Creates the seams every subsequent phase depends on. No feature work until the router is in place, schema discipline is enforced, critical bugs are fixed, and the theme token skeleton exists. All four research dimensions agree this sequencing is load-bearing.

**Delivers:**

- `MessageRouter` (C-1) + Zod parse boundary (C-2)
- `PermissionHandler` carved (C-3) — unblocks Phase 3 permission UX
- ARCH-02 infrastructure: `deprecation-schedule.md`, `RESERVED_FIELDS`, CI lint (warn-only for one release)
- ARCH-03: `LocalTokenAuth`, three-mode auth, auto-token for Tauri-bundled daemon
- THM-01 skeleton: `packages/app/src/styles/tokens/` three-tier structure + Unistyles integration + hardcoded-color lint rule (warn-only)
- CONCERNS H13 (message chevron) + C12 (resize handle pointer events) + H4 (OpenCode session recovery) + C11 (`chromeEnabled` split) — all four gating bugs fixed

**Stack:** No new libraries; daemon-side and existing stack only.

**Avoids:** Pitfalls 2, 3, 5, 8, 9

**Research flags:** Standard patterns; execute directly from ARCHITECTURE.md step ordering.

### Phase 2: Action Surface + Session Foundation

**Rationale:** Builds the universal action surface that voice, command-center, keyboard, and long-press all depend on. Also lands the ProjectsHandler carve that provides daemon-computed recent sessions — a prerequisite for SES-01/SES-05 cross-device continuity.

**Delivers:**

- `ActionRegistry` with agent/workspace/session/permissions/settings catalogs
- `cmdk@1.1.1` + Metro `.web.ts` / `.native.ts` command-center split
- `react-hotkeys-hook@5.2.4` wired to registry keybindings for web/Tauri
- C-8 (`ProjectsHandler` + `recent_sessions_update` broadcast)
- C-5 (`FileExplorerHandler` + `ChatSessionHandler`)
- AGT-01 canonical "new agent" entry point via ActionRegistry
- AGT-02 last-used provider/model/mode per workspace (MMKV-backed, pending New Arch verification)
- SES-01 recent sessions surfacing in sidebar (one-tap resume, status indicators)

**Stack:** `cmdk`, `react-hotkeys-hook`, MMKV (version conditional on New Arch)

**Avoids:** Pitfalls 1, 4

**Research flags:** Verify New Architecture status before phase start (gates MMKV version). One-command check; not a research phase.

### Phase 3: Optimistic Flows + Agent/Session Polish

**Rationale:** Both highest-impact user-facing improvements (instant agent creation feedback and rich permission approval) depend on C-7 (AgentSessionHandler) existing. The nonce-based optimistic pattern is well-established; the primary risk is the rollback path — never show "approved" for side-effect actions before daemon ack.

**Delivers:**

- C-7 `AgentSessionHandler` (largest carve step; enables AGT-04)
- C-6 `VoiceSessionHandler` (unblocks NAT-01)
- AGT-04 optimistic agent creation: `OptimisticAgentStore`, client nonce, `CreateAgentRequestMessage.clientNonce`, `AgentCreateRejected` message type
- `useOptimistic` + `useTransition` wired to create-agent and command-palette filter paths
- AGT-05 permission UX: full tool-call context, diff-is-the-prompt, edit-then-approve, action-frozen-at-prompt-time, multi-device decision broadcast, two-tier auto-approve
- SES-02 OpenCode session recovery (proper `listPersistedAgents` implementation)
- SES-03/SES-04 timeline partial-state on open + virtualized scrolling
- NAT-05 daemon connection state: amber/red dot + version-mismatch + offline recovery; disables side-effect-optimistic UI when amber/red

**Stack:** React 19 `useOptimistic`/`useTransition` (already pinned), `burnt@0.13.0`

**Avoids:** Pitfall 6 (optimistic UI trust failure), Pitfall 10 (permission UX failure modes)

**Research flags:** Permission-decision durability and multi-device broadcast interaction with existing MCP queue needs a planning spike (not research) before Phase 3 starts. Budget a half-day seam-mapping session.

### Phase 4: Navigation, Settings, Native-Feel, Theme Surface

**Rationale:** Architectural seams exist; core flows are correct. This phase sweeps all user-facing polish. NAV work consumes ActionRegistry from Phase 2. Theme surface migration consumes tokens from Phase 1. Native-feel fixes consume pointer-event lint rules from Phase 1. Dense acceptance criteria required to prevent scope creep (Pitfall 1).

**Delivers:**

- NAV-A1..A5: sidebar hierarchy, compact-collapse, workspace-switch one-tap, always-visible kebab (pattern enforced across all surfaces), command-center fully wired
- NAT-01 voice/keyboard/long-press parity ≥80% via ActionRegistry dispatch; NAT-02 haptic vocabulary (`useHaptic()` hook); NAT-03 pointer-event lint promoted to error
- SET-01..04: settings organized by user intent; Labs section; theme/language/voice in ≤2 taps
- THM-02/03/04: every modal/sheet/popover on `<GlassSurface>`; light/dark parity audit; loading/empty/error visual language; math-curve loader formalized; Otter brand in delight moments
- ONB-01..04: local-daemon auto-detection, skip-for-power-users, pair-failure self-serve recovery, localized welcome
- `expo-symbols`, `moti`, `expo-glass-effect` / `expo-blur` fully integrated

**Stack:** `expo-glass-effect`, `expo-blur`, `expo-symbols`, `moti`, optionally `fuse.js` for command-center search ranking

**Avoids:** Pitfalls 1, 4, 5, 8

**Research flags:** `expo-glass-effect` requires a development build (not Expo Go). Validate on iOS 26 device/simulator before committing to Liquid Glass surfaces throughout Phase 4. Standard patterns otherwise.

### Phase 5: Cleanup, Audit, and Documentation

**Rationale:** Removes Strangler-Fig scaffolding, enforces full-strength lint rules, and confirms every PROJECT.md acceptance criterion was actually met — not just implemented.

**Delivers:**

- C-4 `TerminalSessionHandler` (held back due to binary-mux finickiness; safer after all other handlers are stable)
- C-9 `session.ts` shell deletion — target ≤500 lines for the remaining thin container
- ARCH-02 lint promoted from warn-only to error; schema lint at full enforcement
- `docs/SCHEMA_EVOLUTION.md` — removal calendar, `RESERVED_FIELDS`, behavioral-contract document
- `SECURITY.md` update for ARCH-03
- "Looks done but isn't" checklist pass (cross-platform screenshots, parity test for every ActionRegistry action, hover-only gate audit, frozen-fixture parse test confirmation, zh.json parity)
- ≥1 deprecated schema field removed per removal schedule
- Performance audit: timeline virtualization past N=1000, touch ≤100ms, agent-creation ≤200ms perceived

**Avoids:** Pitfalls 2, 3, 7, 9

**Research flags:** Standard cleanup. No additional research needed.

### Phase Ordering Rationale

The ordering is dictated by three dependency chains:

**Chain 1 — Carve gates features:** `MessageRouter` (Phase 1) → `PermissionHandler` (Phase 1) → `ProjectsHandler` (Phase 2) → `VoiceHandler` / `AgentSessionHandler` (Phase 3) → `TerminalHandler` (Phase 5). No feature phase can safely touch `session.ts` without the prior carve step.

**Chain 2 — Registry gates parity:** `ActionRegistry` (Phase 2) → command-center cmdk migration (Phase 2) → voice router refactor (Phase 3) → NAT-01 full parity enforcement (Phase 4). Building any surface before the registry means it will immediately drift.

**Chain 3 — Tokens gate surfaces:** `ThemeTokens` skeleton + lint rule (Phase 1) → glass-surface primitive (Phase 1/2 boundary) → surface migration sweep (Phase 4). Components migrated before tokens exist create double-rework.

**Why gating bugs go in Phase 1:** H13, C12, H4, C11 are active shipped regressions. Leaving them open while building polish on top creates a false sense of completeness and makes it impossible to evaluate whether subsequent polish work is actually working.

**Why Theme surface migration is Phase 4, not Phase 1:** THM-01 (token skeleton + lint rule) is Phase 1. The actual surface migration (THM-02/03/04) is Phase 4. Migrating surfaces before the navigation model is stable (Phase 2/3 work) would require migrating them twice.

### Contradictions Between Research Files

No material contradictions found. All four researchers reached consistent conclusions on sequencing, stack additions, and pitfall priorities. Three minor reconciliations:

- STACK.md flags MMKV and FlashList v2 as "MEDIUM confidence, verify New Arch" — a caveat ARCHITECTURE.md does not address. Treat New Arch status as a pre-Phase-2 open question.
- FEATURES.md treats DF-A1 (LAN auto-pair) as a Phase-2 differentiator; ARCHITECTURE.md notes ARCH-03 is a prerequisite. Resolution: ARCH-03 in Phase 1; LAN auto-pair UX is v1.12 per PROJECT.md Out of Scope.
- PITFALLS.md suggests permission UX in Phase B; ARCHITECTURE.md puts C-3 (PermissionHandler carve) in Phase A. Synthesized: C-3 in Phase 1, permission UX polish in Phase 3. Consistent with both.

### Research Flags

**Needs validation before phase starts:**

- **Phase 2 start:** Confirm New Architecture status — check `android/gradle.properties` for `newArchEnabled=true` and iOS `Podfile` for `new_arch_enabled`. Gates MMKV version.
- **Phase 3 start:** Planning spike for permission-decision durability seam (action-byte capture at prompt time, multi-device broadcast) — half-day session, not a research phase.
- **Phase 4 start:** Validate `expo-glass-effect` in a development build on iOS 26 before committing to Liquid Glass surfaces throughout Phase 4. `expo-blur` fallback is ready.

**Standard patterns — skip research phase:**

- **Phase 1:** Carve strategy, schema discipline, local auth all have direct industry analogues documented in ARCHITECTURE.md. Execute directly.
- **Phase 2:** ActionRegistry (VS Code model), cmdk (production-verified). Execute directly.
- **Phase 3:** Discord nonce pattern, React 19 `useOptimistic`. Execute directly after permission seam spike.
- **Phase 5:** Standard cleanup throughout.

---

## Confidence Assessment

| Area         | Confidence                      | Notes                                                                                                                                                                                  |
| ------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack        | HIGH (core), MEDIUM (two items) | All Expo/RN additions are production-verified. MMKV and FlashList v2 are MEDIUM pending New Architecture confirmation.                                                                 |
| Features     | HIGH                            | Category leaders well-studied. AI-agent-specific patterns supported by Anthropic/Cursor postmortems.                                                                                   |
| Architecture | HIGH                            | ARCH-01 carve has step-by-step ordering verified against LSP server, Discord gateway, Shopify strangler-fig precedents. ARCH-02 from Stripe + Protobuf. ARCH-03 from Docker/Tailscale. |
| Pitfalls     | HIGH                            | Top pitfalls corroborated by Ottie's own shipped CONCERNS (H3, H7, C12, H13) and industry postmortems. Not speculative.                                                                |

**Overall confidence:** HIGH

### Gaps to Address

- **New Architecture status:** Must confirm before Phase 2 planning. Affects MMKV pin version.
- **Tauri global-shortcut API surface:** Unknown whether existing bridge exposes it. If not, `Cmd+Shift+O`-summon requires Rust-side addition; budget for Phase 2 or defer to v1.12.
- **`theme.ts` token stability:** In-flight commits show rewrite in progress. Token-freeze decision should be an explicit Phase 1 exit gate.
- **`session.ts` shared-state map:** Ownership-based carving requires reading the actual file dependency graph. Phase 1 pre-work: map which mutable state is accessed by which handler groups before committing to carve boundaries.
- **OpenCode persistence format:** SES-02 fix requires confirming OpenCode's persistence path before Phase 3 implementation.

---

## Sources

### Primary (HIGH confidence)

- `.planning/research/STACK.md` — stack additions, version compatibility, anti-recommendations
- `.planning/research/FEATURES.md` — table stakes, differentiators, feature dependencies, reference product index
- `.planning/research/ARCHITECTURE.md` — carve step ordering (C-1..C-9), optimistic nonce pattern, ActionRegistry design, theme token architecture, local auth modes
- `.planning/research/PITFALLS.md` — 10 pitfalls with prevention strategies and "looks done but isn't" checklist
- `.planning/PROJECT.md` — milestone scope, validated requirements, constraints, key decisions
- [Microsoft LSP spec 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) — router-first handler dispatch
- [Shopify: Strangler Fig refactoring](https://shopify.engineering/refactoring-legacy-code-strangler-fig-pattern) — incremental carve discipline
- [Stripe API versioning](https://docs.stripe.com/api/versioning) + [Protobuf Best Practices](https://protobuf.dev/best-practices/dos-donts/) — schema evolution
- [VS Code Commands API](https://code.visualstudio.com/api/extension-guides/command) — ActionRegistry pattern
- [Discord nonce pattern](https://github.com/discord/discord-api-docs/discussions/3396) — optimistic agent creation
- [Anthropic: Claude Code Auto Mode](https://www.anthropic.com/engineering/claude-code-auto-mode) — permission fatigue / two-tier approval
- [Superhuman: Command palette](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/) — registry-driven parity
- [Polaris v11 Tokens](https://polaris-react.shopify.com/previous-releases/version-11-tokens) + [Polaris Migrator](https://polaris-react.shopify.com/tools/polaris-migrator) — theme retrofit on shipped product

### Secondary (MEDIUM confidence)

- [expo-glass-effect docs](https://docs.expo.dev/versions/latest/sdk/glass-effect/) — iOS 26 Liquid Glass (HIGH for API; MEDIUM for production behavior given recency)
- [react-native-mmkv](https://github.com/mrousavy/react-native-mmkv) — MMKV v3/v4 New Arch requirement (MEDIUM — requires CNG prebuild verification)
- [Linear sync engine](https://www.fujimon.com/blog/linear-sync-engine) — server-canonical recent sessions pattern (MEDIUM — implementation not public)

### Tertiary (LOW confidence)

- [Tailscale LocalAPI socket](https://tailscale.com/docs/features/containers/docker/docker-params) — local daemon auth analogue (MEDIUM; TCP vs Unix socket is a meaningful difference for ARCH-03)

---

_Research completed: 2026-04-29_
_Ready for roadmap: yes_
