# Ottie

## What This Is

Ottie is a local-first system for monitoring and controlling AI coding agents from anywhere — your dev environment, in your pocket. A daemon runs on the developer's machine, owns the lifecycle of every agent (Claude Code, Codex, OpenCode, ACP), and exposes a single binary-multiplexed WebSocket API consumed by mobile, web, desktop (Tauri), and CLI clients. Remote access goes through an E2E-encrypted, zero-knowledge relay on Cloudflare Workers; agent code and credentials never leave the developer's machine.

The product is for working developers who want to keep agents running while away from the keyboard — review tool calls, approve permissions, send follow-up prompts, hand off work to another agent — without ever uploading their codebase to a third party.

## Core Value

**Controlling your local AI agents from your phone feels as immediate, trustworthy, and native as using the editor on your desktop — and stays out of the way the moment you don't need it.**

If everything else fails, this single property must hold: the developer trusts that the agent is doing what they think it's doing, and acting on it takes one or two taps, not five.

## Requirements

### Validated

<!-- Inferred from shipped v1.x code. Locked unless explicitly revisited. -->

- ✓ **CORE-01**: Local daemon owns all agent lifecycle and exposes a single binary-multiplexed WebSocket API — existing (`packages/server`)
- ✓ **CORE-02**: Cross-platform client (iOS / Android / web browser / Tauri desktop) bundled from one Expo codebase — existing (`packages/app`)
- ✓ **CORE-03**: Zero-knowledge E2E-encrypted relay on Cloudflare Workers; QR pairing transfers daemon public key — existing (`packages/relay`)
- ✓ **CORE-04**: Tauri v2 desktop shell that bundles the daemon, signed on macOS — existing (`packages/desktop`)
- ✓ **CORE-05**: Docker-style CLI (`ottie run/ls/logs/wait/daemon`) for power users — existing (`packages/cli`)
- ✓ **AGENT-01**: Claude Code provider via Anthropic Agent SDK — existing
- ✓ **AGENT-02**: Codex / pi-agent provider — existing
- ✓ **AGENT-03**: OpenCode provider — existing (with known persistence gap, see CONCERNS H4)
- ✓ **AGENT-04**: Generic ACP-protocol agents — existing
- ✓ **AGENT-05**: Per-provider mode selection (plan / default / full-access) — existing
- ✓ **AGENT-06**: Agent state machine (initializing → idle → running → idle / error / closed) with epoch-based timeline — existing
- ✓ **AGENT-07**: Tool-call permission requests routed through MCP → WebSocket → mobile approval UI — existing
- ✓ **TIMELINE-01**: SQLite-backed agent timeline persistence with JSONL import path — in flight (newly committed in v1.10 area)
- ✓ **VOICE-01**: Local STT/TTS via Sherpa-ONNX + bundled Silero VAD; two-way audio module on iOS/Android — existing
- ✓ **VOICE-02**: Voice-control pipeline (floating orb / push-to-talk pill / ghost cursor / router → agent action) — existing in `packages/app/src/voice-control/`
- ✓ **CHAT-01**: Persistent chat rooms; message thread per agent run; attachments (images, files, clipboard) — existing
- ✓ **TERM-01**: PTY-backed interactive terminal per agent (xterm.js + node-pty) with WebGL renderer — existing
- ✓ **NAV-01**: Sidebar (host → workspace → agent), command center (⌘K-style), mobile bottom tab bar, project picker — existing
- ✓ **SETUP-01**: QR scan + add-host modal flow for pairing a remote daemon — existing
- ✓ **PUSH-01**: Mobile push notification token registration (expo-notifications) — existing
- ✓ **I18N-01**: English + Simplified Chinese localization — existing
- ✓ **MCP-01**: Daemon exposes MCP server so external tools and sub-agents can interact with running agents — existing
- ✓ **DESKTOP-01**: Daemon auto-start, version-mismatch callout, app updates surfaced through Tauri bridge — existing

### Active

<!-- Milestone v1.11 — User Flow Polish. Open scope: app, daemon, schema, refactors, bug fixes — anything that delivers the UX improvement. -->

#### A. Onboarding & First-Run

- [ ] **ONB-01**: First launch → first running agent in ≤3 user-initiated steps (excluding pair scan when daemon is local)
- [ ] **ONB-02**: First-run flow detects local daemon presence and skips pair scan when running on desktop / same machine
- [ ] **ONB-03**: Pair-scan failures present a self-serve recovery path (regenerate code, manual key entry, switch to local daemon) without restarting the app
- [ ] **ONB-04**: Welcome screen explains what Ottie is and what one is about to do, in user's chosen language, with skip-for-power-users escape

#### B. Agent Switching & Invocation

- [ ] **AGT-01**: Single canonical "new agent" entry point reachable via command-center, long-press, voice, and keyboard shortcut — same destination, same defaults
- [ ] **AGT-02**: Provider / model / mode selection remembers last-used per workspace and surfaces it inline rather than as a multi-screen wizard
- [ ] **AGT-03**: Switching the active agent is one tap from the agent list and one ⌘-keystroke from any screen
- [ ] **AGT-04**: Sending the first message to a freshly created agent reaches the daemon in ≤2 user-visible taps (target → prompt → send), with optimistic UI feedback before the agent emits its first event
- [ ] **AGT-05**: Permission requests surface with full tool-call context (file diffs, command preview) and a single-tap approve / deny / edit-then-approve

#### C. Session & Conversation Management

- [ ] **SES-01**: Most-recent N sessions surface in the sidebar (or equivalent on mobile) so resume is one tap, no second screen
- [ ] **SES-02**: OpenCode session recovery after daemon restart works (resolves CONCERNS H4 — `listPersistedAgents` stub)
- [ ] **SES-03**: Timeline rendering shows partial state immediately on session open; backfill streams in without blocking interaction
- [ ] **SES-04**: Long timelines remain interactive — search, jump-to-tool-call, virtualized scrolling, no jank past N=1000 events
- [ ] **SES-05**: Cross-device session continuity — opening the same workspace on phone after desktop work resumes at the right point

#### D. Sidebar & Navigation

- [ ] **NAV-A1**: Information hierarchy collapses cleanly — host → workspace → agent — with consistent affordances for each level
- [ ] **NAV-A2**: Compact form factor auto-collapses sidebar overlay; switching workspaces never requires two taps when one is sufficient
- [ ] **NAV-A3**: Hover-only controls (rename, settings, kebab menus) are always visible on native (resolves CONCERNS H13 — message chevron)
- [ ] **NAV-A4**: Command center is the universal action surface — workspace switch, agent create, settings jump, recent sessions, voice trigger
- [ ] **NAV-A5**: Mobile tab bar and sidebar share one navigation model — same destinations, no orphaned screens

#### E. Settings & Preferences

- [ ] **SET-01**: Settings reorganized around user intent (Account / Agents / Voice / Appearance / Advanced) instead of internal architecture
- [ ] **SET-02**: `chromeEnabled` flag split into independent feature flags (resolves CONCERNS C11)
- [ ] **SET-03**: Theme, language, and voice settings are reachable in ≤2 taps from any screen
- [ ] **SET-04**: Labs section clearly labels stability and lets users opt-in/out of individual experiments

#### F. Cross-Cutting — Otter Theme & Visual Language

- [ ] **THM-01**: Single source of truth for colors, surfaces, elevations, typography, motion curves — formalize the in-flight `theme.ts` + `glass-surface` work into a documented theme system
- [ ] **THM-02**: Every modal / sheet / popover uses the same surface treatment; light/dark parity audited
- [ ] **THM-03**: Loading, empty, and error states share a consistent visual language across the app (math-curve loader, callout cards, toasts)
- [ ] **THM-04**: Otter character / brand presence is consistent — splash, welcome, empty states, and key delight moments

#### G. Cross-Cutting — Native-Feel AI

- [ ] **NAT-01**: Voice, command-center, and long-press triggers reach the same actions with parity ≥80% (creating an agent, switching workspace, jumping to a session, approving a permission)
- [ ] **NAT-02**: Haptics on iOS / Android fire on every meaningful state transition (agent run-start, run-stop, permission-request, send-message)
- [ ] **NAT-03**: Pointer-event regressions on native fixed (resolves CONCERNS C12 — `onPointerEnter` on resize handle)
- [ ] **NAT-04**: AI-generated text in messages renders with a smoothed, typing-style animation (the new `use-smoothed-text` hook is wired everywhere)
- [ ] **NAT-05**: Daemon connection state is always visible and trustworthy — connection dot + version-mismatch callout + offline-recovery prompt

#### H. Architectural Cleanup Required for the Above

- [ ] **ARCH-01**: Carve `session.ts` god-file (≈9,500 lines) into focused services so new schema/UI work is safe (resolves CONCERNS H3)
- [ ] **ARCH-02**: Schema additions are backward-compatible (old clients keep working). Document a removal schedule for accumulated shims (CONCERNS H7)
- [ ] **ARCH-03**: Local daemon auth is no longer "any local process can control all agents" — minimum: opt-in token for non-loopback connections (CONCERNS H2)

### Out of Scope

- **Cloud-hosted agents** — agents stay on the developer's machine; we are not building a hosted execution backend. Local-first is the brand.
- **New agent providers in v1.11** — focus is polish; new providers (Cursor, Aider, etc.) are deferred to a later milestone.
- **Marketing website rebuild** — `packages/website` stub stays a stub; ottie.app rebuild is its own milestone (CONCERNS L14).
- **Schema-breaking changes** — every WS / config schema change in v1.11 stays backward-compatible. Old mobile clients must keep working against new daemons.
- **Replacing the relay protocol** — relay replay-protection (CONCERNS H1) deferred to a security-focused milestone unless it surfaces from research as a UX blocker.
- **`node-pty` major upgrade** — pinned beta stays pinned (CONCERNS M9); upgrade is a dedicated dependency milestone.
- **Test-coverage backfill outside touched code** — improving CONCERNS M6 (placeholder orchestration tests) only happens for code we modify in this milestone.

## Context

**Codebase intel:** `.planning/codebase/{ARCHITECTURE,STACK,STRUCTURE,CONVENTIONS,INTEGRATIONS,TESTING,CONCERNS}.md` — analyzed 2026-04-29. Read these before planning any phase.

**In-flight work at milestone start (64 files modified, +2016 / −607 LOC):**

- Theme system rewrite (`styles/theme.ts`, new `glass-surface.tsx` UI primitive, `daemon-connection-dot.tsx`)
- Timeline cache split into `.web.ts` / `.native.ts` + shared module (platform correctness)
- SQLite agent-timeline-store landing + backup + JSONL import path
- Voice-control polish across the entire `voice-control/` directory
- Welcome / sidebar / workspace / project-picker / agent-list / message / message-input — UI tightening pass
- Bilingual i18n updates (en + zh) on the strings touched by the above
- Bootstrap and durable-timeline-store changes on the daemon side

**Current versioning:** v1.10.0 just shipped (bundled agent SDK CLI, signed macOS, fixed model picker). Recent releases v1.6 → v1.10 cadence is roughly weekly with substantive features per release. v1.11 is the first milestone framed around UX coherence rather than feature addition.

**Known regressions / bugs intersecting this milestone:**

- Message chevron invisible on native (CONCERNS H13) — direct UX blocker, must fix
- Resize handle `onPointerEnter` crashes native (CONCERNS C12) — direct UX blocker, must fix
- OpenCode session recovery returns `[]` (CONCERNS H4) — silent data-loss UX blocker
- `chromeEnabled` flag conflates layout + shortcuts (CONCERNS C11) — blocks honest settings UX

**Architectural debt with UX implications:**

- `session.ts` god-file (CONCERNS H3) — every cross-cutting change pays a tax in merge conflicts and review difficulty. ARCH-01 carves it before it blocks parallel phase work.
- Backward-compat shims accumulating without removal schedule (CONCERNS H7) — schema decisions in this milestone need a documented sunset path.

**User feedback themes (from in-flight commits and CLAUDE.md):**

- Desktop "stuck on Connecting…" was a recent papercut (fixed in v1.9) — implies bootstrap UX is fragile
- Model picker fix in v1.10 — implies agent-creation UX is also fragile
- Daemon log path is the canonical debug surface (`$OTTIE_HOME/daemon.log`) — UX errors should hint at this when surfaced

## Constraints

- **Tech stack** — TypeScript / Expo (React Native + Web) / Tauri v2 / Node.js daemon — _fixed for the milestone; no platform changes_
- **Compatibility** — old mobile clients must keep working against new daemons; every WS / config schema change must be backward-compatible per CLAUDE.md
- **Performance** — timeline must stay interactive past 1,000 events; touch responses ≤100ms; agent-creation feedback ≤200ms perceived latency
- **Privacy** — local-first invariant: agent code, credentials, and chat content never leave the developer's machine in plaintext. Relay stays zero-knowledge.
- **Security baseline** — local daemon auth (CORE-01) must not regress; ARCH-03 raises the floor without breaking same-machine flow
- **Build / test discipline** (per CLAUDE.md) — never restart the main daemon on :6868 without permission; never run the full test suite locally; always `npm run typecheck && npm run lint && npm run format` after every change
- **Cross-platform default** — code is cross-platform unless gated; gates come from `@/constants/platform`, never written locally
- **Bilingual** — every user-visible string change must update both `en.json` and `zh.json`

## Key Decisions

| Decision                                                           | Rationale                                                                                                                                              | Outcome              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| Milestone v1.11 framed as "User Flow Polish", not feature addition | Cumulative UX friction now exceeds the value of net-new features; one coherent pass beats N scattered improvements                                     | — Pending            |
| Open scope — app, daemon, schema, refactors all in-bounds          | UX wins often require touching the daemon and schema; artificially fencing the milestone to "app-only" would force suboptimal client workarounds       | — Pending            |
| Carve `session.ts` god-file inside this milestone (ARCH-01)        | Every parallel phase touches it; the cost of not carving it is paid repeatedly. Better to pay once.                                                    | — Pending            |
| Keep schema changes backward-compatible                            | Old mobile clients in the field; CLAUDE.md is explicit. We add fields and transform; we do not remove or narrow.                                       | ✓ Good (locked rule) |
| Run external research before requirements lock                     | Polish work has high risk of inventing patterns when industry-standard ones exist (mobile dev tools, voice-first UX, agent UX). Reference > invention. | — Pending            |
| Ship behind feature flags, not big-bang                            | High-velocity v1.x cadence means each phase merges to main; flag protects users from half-done flows                                                   | — Pending            |
| Bilingual parity (EN / 中文) maintained for every visible change   | Existing user base in both locales; one-locale shipping is a regression                                                                                | — Pending            |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):

1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):

1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---

_Last updated: 2026-04-29 after initialization (Milestone v1.11 — User Flow Polish)_
