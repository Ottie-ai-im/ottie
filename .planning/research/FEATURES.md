# Feature Research — v1.11 User Flow Polish

**Domain:** Mobile control surface for local AI coding agents (cross-platform Expo app + Tauri desktop + CLI; daemon owns lifecycle).
**Researched:** 2026-04-29
**Confidence:** HIGH for established categories (command palette, conversation list, pair-and-go, haptics), MEDIUM for AI-coding-agent mobile-specific patterns (this is partly category-defining work).

## How to Read This Document

This is a SUBSEQUENT-milestone feature landscape. Ottie already ships the breadth (see `PROJECT.md` Validated). The job here is to map every behavior the _category leaders_ deliver in the five focus areas of v1.11 so the team knows the bar to clear.

**Tag legend:**

| Tag | Meaning                      |
| --- | ---------------------------- |
| `A` | Onboarding & First-Run       |
| `B` | Agent switching & invocation |
| `C` | Sessions / conversations     |
| `D` | Sidebar / navigation         |
| `E` | Settings / preferences       |
| `F` | Theme / visual language      |
| `G` | Native-feel AI               |

**Surface legend:**

| Tag       | Meaning                                             |
| --------- | --------------------------------------------------- |
| `app`     | Lives entirely in `packages/app`                    |
| `daemon`  | Lives in `packages/server`                          |
| `both`    | Requires schema or coordinated work across surfaces |
| `desktop` | Requires Tauri shell (`packages/desktop`)           |

**Complexity legend:** `S` ≤ 1 day · `M` ≤ 1 week · `L` > 1 week or cross-package.

---

## A. Onboarding & First-Run

### Table Stakes (A)

| ID    | Feature                                                                                                                   | Reference                                                                                                                                                          | Why Expected                                                                                                                                                   | Surface | Cx  |
| ----- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --- |
| TS-A1 | Local daemon auto-detected when app and daemon are on same machine; pair flow skipped                                     | Plex GDM (G'Day Mate) auto-discovers servers on same LAN, mobile "tap Continue on local-network prompt and you're in"; Tailscale identifies same-tailnet on launch | Users on the desktop app already proved their identity by launching it. Forcing a QR scan is hostile.                                                          | both    | M   |
| TS-A2 | First-run welcome explains what the product does in 1–3 sentences before asking for any action                            | ChatGPT mobile, Linear mobile, Things 3 — all show a single-screen "what this is" before any data entry                                                            | Users who don't know what they just installed will bounce.                                                                                                     | app     | S   |
| TS-A3 | Welcome state is localized in user's chosen language from the OS locale (not hardcoded English)                           | Things 3, Tot, every Apple-tier app respects `NSLocale`                                                                                                            | Bilingual users (EN/中文) already exist in Ottie's base. Skipping zh on welcome is a regression.                                                               | app     | S   |
| TS-A4 | Pair scan failures present in-app recovery (regenerate code, manual key entry) without restarting the app                 | Tailscale: "input code" tab as fallback to QR; Plex: "sign in manually" link under QR                                                                              | A fragile QR flow that requires app restart is a category-1 churn moment.                                                                                      | both    | M   |
| TS-A5 | Connection state is live and self-explanatory ("Connecting…", "Connected", "Daemon offline — open desktop app")           | Tailscale dot, Plex "Server unavailable" banner, Slack offline pill                                                                                                | Without a trustable connection signal, users can't tell whether the agent or the network failed. v1.9 papercut ("stuck on Connecting…") confirms this is real. | app     | S   |
| TS-A6 | First running agent reachable in ≤3 user-initiated steps after install                                                    | Things 3 → "Add a To-Do" is the only thing the empty state suggests; ChatGPT mobile → empty state has the prompt input pre-focused                                 | If the user can't get to "agent is working" in <60s, retention collapses.                                                                                      | both    | M   |
| TS-A7 | Permission requests during onboarding (mic, notifications) are deferred until first contextual use, not requested upfront | Apple HIG; Slack defers mic until first huddle; Discord defers PTT permission until you join voice                                                                 | iOS will deny upfront prompts ~70% of the time; Android Material guidelines say the same.                                                                      | app     | S   |
| TS-A8 | Skip-for-power-users escape on every onboarding screen                                                                    | Linear "Skip tour", Cursor "Continue without sign-in", every modern dev tool                                                                                       | Power users (Ottie's primary audience) hate forced tours.                                                                                                      | app     | S   |

### Differentiators (A)

| ID    | Feature                                                                                                                                     | Reference                                                         | Why It Matters                                                                  | Surface | Cx  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------- | --- |
| DF-A1 | Desktop launch auto-pairs the bundled mobile app via local LAN handshake (no QR scan needed when phone is on same Wi-Fi as desktop)         | Plex pairs implicitly, Sonos S2 mobile pairs implicitly           | The "your phone, your machine" pitch should never need a QR for the happy path. | both    | L   |
| DF-A2 | Onboarding remembers where the user dropped off and resumes there if they relaunch                                                          | Linear, Notion mobile                                             | High-churn moment; resuming halfway is delight.                                 | app     | M   |
| DF-A3 | First-run walkthrough is itself an agent demo — show the user creating a real agent against a sandbox cwd, then they keep it                | Cursor's "tutorial repo" pattern; Replit's agent-first onboarding | Teaches by doing, not by reading.                                               | both    | L   |
| DF-A4 | Onboarding asks "what do you want to do today?" then routes to the right empty state (start coding / review yesterday's run / set up voice) | Superhuman onboarding does this for inbox triage                  | Surfaces value per user-intent; respects audience plurality.                    | app     | M   |

### Anti-Features (A)

| ID    | Pattern to AVOID                                                                | Why Avoid                                                                                                                                                                                | What to Do Instead                                                     |
| ----- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| AF-A1 | Forced sign-up before product value (account, email, password)                  | Ottie is local-first + zero-knowledge. Cloud accounts contradict the brand. ChatGPT and Cursor force this and it generates real friction; Aider and Claude Code don't and don't need it. | Daemon is the trust root. No cloud account at all in v1.11.            |
| AF-A2 | Modal walls explaining features the user hasn't asked for                       | Tot, Tabby, Things 3 all skip this; Cursor/VSCode have it and users skip-click.                                                                                                          | Empty states + tooltips + command-center hints.                        |
| AF-A3 | "Sync to cloud" as a checked-by-default first-run option                        | Direct contradiction of local-first. Plex Pass nags do this and users hate them.                                                                                                         | No cloud sync at all unless user explicitly opts in via relay pairing. |
| AF-A4 | Asking for notification + mic + camera permissions back-to-back on first launch | iOS will reject ~70% of these; Apple HIG explicitly forbids it.                                                                                                                          | Defer to contextual moment (e.g., "Tap to talk" → mic prompt).         |
| AF-A5 | Automated telemetry opt-in buried in first-run                                  | Privacy-first brand kills this. Tailscale does NOT collect; Plex's analytics is a known sore point.                                                                                      | No telemetry collection in v1.11. If added later, opt-in only.         |

---

## B. Agent Switching & Invocation

### Table Stakes (B)

| ID    | Feature                                                                                                                  | Reference                                                                                                                                       | Why Expected                                                                                                                                                                                | Surface | Cx  |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --- |
| TS-B1 | Single canonical "new agent" entry point reachable from command palette, long-press, voice, keyboard                     | Linear: `C` from anywhere creates an issue; Raycast: any command reachable via single text input                                                | Every feature that has more than one path to creation also needs that path to land in the same destination with the same defaults — otherwise users feel like they got a different product. | app     | M   |
| TS-B2 | Provider/model/mode last-used remembered per workspace                                                                   | Cursor remembers model per project; ChatGPT remembers model per conversation thread                                                             | Forcing the user to re-select per agent creation is a 3-tap regression.                                                                                                                     | both    | M   |
| TS-B3 | Agent switch is one tap from the agent list                                                                              | Cursor tabs (⌘T to switch); ChatGPT's recent-chat list — single tap resumes                                                                     | If switching requires 2+ taps, parallel agent users (Ottie's power audience) will revolt.                                                                                                   | app     | S   |
| TS-B4 | Sending first message reaches daemon in ≤2 user-visible taps after creation (target → prompt → send), with optimistic UI | Things 3 quick-entry: type → enter, item appears immediately; Linear: same pattern                                                              | The gap between "I created an agent" and "the agent is working" must feel atomic.                                                                                                           | both    | M   |
| TS-B5 | Tool-call permission requests show full context (file diff, command preview) inline                                      | Claude Code shows command + cwd before approval; Continue.dev shows file diff with edit/approve buttons; Codex shows command with arg breakdown | Approving blind is the source of every agent-runs-amok story. Users will refuse if they can't see what they're approving.                                                                   | both    | M   |
| TS-B6 | Permission approval is single-tap (approve / deny / edit-then-approve)                                                   | Continue.dev "ask" mode = approve/deny/auto-approve-this-tool; Cursor agent mode = single-tap diff approval                                     | Multi-step approval = users disable the safety entirely.                                                                                                                                    | both    | S   |
| TS-B7 | Keyboard shortcut to create new agent works on web/desktop, parity with sidebar button                                   | Linear `C`, Slack `⌘N`, Raycast — every modern productivity tool has this                                                                       | Existing keyboard users will complain if a button-only path appears for agent creation.                                                                                                     | app     | S   |
| TS-B8 | Long-press on agent list opens contextual actions (rename, duplicate, stop, delete)                                      | iOS native context menus; Linear mobile long-press; ChatGPT mobile long-press                                                                   | Native form factor expectation; missing it makes the list feel non-native.                                                                                                                  | app     | S   |

### Differentiators (B)

| ID    | Feature                                                                                                                                        | Reference                                                                                    | Why It Matters                                                                                   | Surface | Cx  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------- | --- |
| DF-B1 | Voice-trigger agent creation reaches the same destination as command-palette/long-press creation, with parity on prefilled prompt and provider | Slack huddle "raise to listen" parity; Apple Shortcuts voice parity                          | The "voice = first-class input" pitch only holds if voice creates the same agent as a tap.       | both    | L   |
| DF-B2 | Quick-switch agent switcher (⌘K-style picker scoped to running agents only, not full command palette)                                          | Cursor `⌘T` switches between live tabs only; iTerm cmd-shift-tab between sessions            | Power users running 3+ parallel agents need a switcher that doesn't require typing or scrolling. | app     | M   |
| DF-B3 | Parallel-agent dashboard view (live status of every running agent at once)                                                                     | Cursor multi-tab, but better — show waiting-for-permission, running, idle states at a glance | Mobile dev cockpit: at-a-glance status is the entire pitch.                                      | app     | M   |
| DF-B4 | Permission request prefetched and cached on the device before user surfaces UI (sub-100ms response)                                            | Things 3 prefetches drag previews, Cursor prefetches diff renders                            | Approving in <1s feels native; >1s feels web.                                                    | both    | M   |
| DF-B5 | "Continue this agent's last task" deep link from push notification → agent already running on tap                                              | Slack mobile push → deep link to thread; Linear push → deep link to issue                    | If a permission push notification doesn't deep-link, every approval requires re-navigation.      | both    | M   |
| DF-B6 | Edit-then-approve on permission requests (modify the proposed command before sending it back)                                                  | Cursor agent mode: edit the proposed file diff before applying; Continue.dev: edit-and-run   | Closes the gap between "approve" and "do it differently" without aborting.                       | both    | M   |

### Anti-Features (B)

| ID    | Pattern to AVOID                                                                   | Why Avoid                                                                                                                                         | What to Do Instead                                                                                                       |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| AF-B1 | Multi-screen agent creation wizard (provider → model → mode → cwd → prompt → send) | Existing Ottie pain (per CONCERNS papercut on model picker). Cursor/ChatGPT don't have this; they collapse model into an inline picker.           | Inline picker beneath the prompt input (provider chip, model chip, mode chip), all editable but never blocking the send. |
| AF-B2 | Auto-approve-all-tool-calls toggle exposed prominently                             | Single biggest source of "agent destroyed my repo" stories. Aider had to walk this back; Continue.dev hides it deep in settings.                  | Per-tool, per-project allowlist with explicit confirmation; never one global toggle.                                     |
| AF-B3 | Confirmation modal for every send ("Are you sure you want to send this prompt?")   | Defeats the speed pitch. No category leader does this.                                                                                            | Optimistic UI; undo only if a tool call has not yet executed.                                                            |
| AF-B4 | Provider-specific UI per provider (different chat for Claude vs Codex vs OpenCode) | Fragments the mental model. Continue.dev unified providers and got better; Cursor's IDE/CLI/ACP fragmentation is its own pain (per Cursor forum). | One unified chat surface; provider choice surfaces only as metadata + per-provider mode chips.                           |

---

## C. Session & Conversation Management

### Table Stakes (C)

| ID    | Feature                                                                                                         | Reference                                                                                                                                           | Why Expected                                                                                                                      | Surface | Cx  |
| ----- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------- | --- |
| TS-C1 | Recent N sessions in sidebar/equivalent — resume is one tap                                                     | ChatGPT mobile: hamburger → list, single tap resumes; Cursor: tabs persist; Claude Code CLI: `claude -c` resumes last in cwd                        | If resume requires "open list, scroll, find, tap", users lose their thread.                                                       | app     | S   |
| TS-C2 | Session list searchable by content, not just title                                                              | ChatGPT mobile sidebar search across content; Linear search; Superhuman search                                                                      | Auto-titled agents have non-discoverable titles; content search is the only way to find "the one where I asked about migrations". | both    | M   |
| TS-C3 | Session list shows status at a glance (running, awaiting permission, errored, idle)                             | Cursor multi-tab dot indicators; Slack channel unread dots                                                                                          | Without status indicators, users tap sessions blindly and waste taps.                                                             | app     | S   |
| TS-C4 | OpenCode session recovery works after daemon restart (CONCERNS H4 fix)                                          | Claude Code persists to `~/.claude/projects/{cwd}/{session}.jsonl`; Codex persists to `~/.codex/sessions/`; OpenCode currently silently loses state | Silent data loss is the worst kind of regression.                                                                                 | daemon  | M   |
| TS-C5 | Timeline shows partial state immediately on session open; backfill streams in without blocking                  | ChatGPT mobile streams older messages on scroll-up; Linear: list-then-detail                                                                        | Blocking the UI behind a fetch is a performance regression.                                                                       | both    | M   |
| TS-C6 | Long timelines stay interactive past 1000 events (virtualized scroll, no jank)                                  | Linear handles 10k+ issues smoothly; ChatGPT lazy-loads                                                                                             | Without virtualization, scroll jank kills the long-session use case.                                                              | app     | M   |
| TS-C7 | Pin / archive / star a session                                                                                  | ChatGPT mobile pin to top; Slack star; Linear star                                                                                                  | Power users have 5–50 sessions; without curation, recent-only is insufficient.                                                    | both    | M   |
| TS-C8 | Long-press on a session opens contextual actions (rename, archive, delete, share)                               | iOS native context menus; Slack mobile, ChatGPT mobile                                                                                              | Native form factor expectation.                                                                                                   | app     | S   |
| TS-C9 | Cross-device session continuity — opening same workspace on phone after desktop work resumes at the right point | Things 3 cross-device sync; ChatGPT cloud sync (we use the daemon as the source of truth instead)                                                   | Mobile users walk away from desktop and pick up phone — current-position handoff must work.                                       | both    | M   |

### Differentiators (C)

| ID    | Feature                                                                                                   | Reference                                                                              | Why It Matters                                                               | Surface | Cx  |
| ----- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------- | --- |
| DF-C1 | Jump-to-tool-call inside long timelines (visual anchor list of tool calls in a side rail)                 | Cursor agent mode "tool calls panel"; Linear sub-issue jump-list                       | A 1000-event timeline is unnavigable without anchor jumps.                   | app     | M   |
| DF-C2 | Fork session — branch a conversation at any point to try a different prompt                               | Cursor `--fork-session` (community-requested); ChatGPT "edit message" implicitly forks | When agents go down the wrong path, branching beats restarting.              | both    | L   |
| DF-C3 | Session search ranking is frecency-weighted (recent + frequent first)                                     | Raycast frecency ranking; Spotlight                                                    | Naive recent-only ranking is wrong for power users with many active threads. | app     | M   |
| DF-C4 | Session preview-on-hover (web/desktop) shows last few messages without opening                            | Linear sidebar hover preview; macOS Quick Look                                         | Reduces "open-then-leave" tap waste.                                         | app     | S   |
| DF-C5 | Compact / Comfortable / Cozy session list density toggle                                                  | Linear, Things 3 view modes; Slack density                                             | 50-session users want compact; new users want cozy.                          | app     | S   |
| DF-C6 | Inline diff/file-edit summary in session list ("3 files changed, +42 / −11")                              | GitHub PR list previews; Cursor session previews                                       | Lets users triage which session is "the big one" without opening.            | both    | M   |
| DF-C7 | Auto-titled sessions get re-titled when first user message clarifies scope (not stuck on the placeholder) | ChatGPT auto-titles after first turn and re-titles if topic shifts                     | "Untitled session" stuck for a week is a known bad pattern.                  | daemon  | M   |

### Anti-Features (C)

| ID    | Pattern to AVOID                                           | Why Avoid                                                                                                                                           | What to Do Instead                                                                                    |
| ----- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| AF-C1 | Cloud-sync session list across devices via Ottie's servers | Direct contradiction of local-first / zero-knowledge. Cursor's chat fragmentation is itself a forum complaint.                                      | Daemon-as-source-of-truth + relay-encrypted cross-device read; never our cloud.                       |
| AF-C2 | Auto-delete sessions older than N days                     | Users keep sessions for reference. ChatGPT initially had a 30-day delete and reverted.                                                              | Archive instead; user-explicit deletion only; SQLite retention policy with user opt-in (CONCERNS M5). |
| AF-C3 | Force-close session on daemon disconnect                   | Tailscale doesn't disconnect on bad LAN; Plex doesn't drop the player. The right model is "session is the durable record; connection is transient". | Connection state is independent of session state; reconnect resumes silently.                         |
| AF-C4 | Threading or replies inside a single agent session         | Agents are linear by nature; threading is a Slack metaphor that doesn't apply. Cursor tried this in early builds and dropped it.                    | Fork session (DF-C2) is the right primitive for branching.                                            |

---

## D. Sidebar & Navigation

### Table Stakes (D)

| ID    | Feature                                                                                                                                  | Reference                                                                                                         | Why Expected                                                                            | Surface | Cx  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------- | --- |
| TS-D1 | Sidebar information hierarchy is consistent at every level (host → workspace → agent) — same chevron, same indent, same kebab affordance | Linear three-level navigation; Slack workspace → channel → thread                                                 | Inconsistent affordances per level make users hunt for the action surface.              | app     | M   |
| TS-D2 | Compact form factor auto-collapses sidebar to overlay                                                                                    | Slack mobile, Linear mobile, ChatGPT mobile, Tot mobile — all collapse                                            | Pinned sidebar on phone wastes 30% of width.                                            | app     | S   |
| TS-D3 | Workspace switch is one tap from compact view                                                                                            | Slack mobile workspace switcher (long-press app icon); Discord server-list rail                                   | Two-tap switch with sidebar-collapsed-but-visible is a known wrist-strain UX.           | app     | S   |
| TS-D4 | Hover-only controls (rename, settings, kebab) are always visible on native (CONCERNS H13 fix)                                            | iOS native lists always show chevron; Android lists always show overflow menu; CLAUDE.md explicitly mandates this | Hover doesn't fire on native iOS/Android. Hidden controls = phantom controls.           | app     | S   |
| TS-D5 | Command center is universal (workspace switch, agent create, settings jump, recent sessions, voice trigger from one input)               | Raycast's `⌘K`; Linear's command bar; Superhuman `⌘K`                                                             | Single command surface is now category-table-stakes for any productivity app post-2022. | app     | M   |
| TS-D6 | Mobile tab bar and sidebar share one navigation model (no orphaned screens)                                                              | Linear mobile, Slack mobile — tab bar is a subset of sidebar                                                      | If a screen is reachable from sidebar but not tab bar, mobile users can't get to it.    | app     | M   |
| TS-D7 | Recent sessions surface in sidebar without a second screen                                                                               | ChatGPT mobile sidebar shows recent inline; Cursor tab bar shows recent inline                                    | "Open session list" → "find session" → "tap" is one tap too many.                       | app     | S   |
| TS-D8 | Active-state indicator (which workspace / which agent is currently selected) is visually unambiguous                                     | Linear's tinted active row; Slack's vertical bar indicator; Things 3's selected style                             | Without it, users second-guess every action.                                            | app     | S   |

### Differentiators (D)

| ID    | Feature                                                                                                                   | Reference                                                                                         | Why It Matters                                                   | Surface | Cx  |
| ----- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------- | --- |
| DF-D1 | Command center supports vim-style navigation (J/K up-down, Enter open)                                                    | Superhuman J/K; Raycast arrow + enter                                                             | Power users will use this 100x/day.                              | app     | S   |
| DF-D2 | Command center surfaces "what was I doing?" — the agent that fired the last permission, the workspace I was last in, etc. | Raycast's "Frequently Used"; Superhuman's "Resume"                                                | Resumability beats discoverability for return users.             | app     | M   |
| DF-D3 | Pull-down gesture from any screen invokes command center (mobile)                                                         | Superhuman mobile: pull-down + swipe-right opens Cmd palette; Things 3 pull to add                | Native gesture parity for the keyboard-first command center.     | app     | M   |
| DF-D4 | Sidebar drag-to-reorder workspaces and pinned sessions with haptic snap                                                   | Things 3 magic-plus drag; iOS Files drag; Linear drag-to-reorder issues                           | Tactile native-ness; `UIImpactFeedbackGenerator.medium` on drop. | app     | M   |
| DF-D5 | Persistent "voice orb" floating action button (mobile) for one-tap voice agent invocation                                 | Existing in voice-control/ but not consistently exposed; Apple voice control orb is the reference | Voice as first-class input is a brand pillar.                    | app     | M   |
| DF-D6 | Sidebar workspace hover-card preview (running agent count, last activity)                                                 | Linear sidebar hover; Notion sidebar hover                                                        | At-a-glance dashboard preview without committing a tap.          | app     | S   |

### Anti-Features (D)

| ID    | Pattern to AVOID                                                                                    | Why Avoid                                                                                 | What to Do Instead                                                                         |
| ----- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| AF-D1 | Three-level sidebar tree with infinite expand/collapse (host → workspace → agent → tool-call → ...) | Trees collapse to chaos at depth >3. Slack rebuilt this in 2023 to avoid it.              | Strictly three flat levels: host (top rail), workspace (sidebar), agent (list).            |
| AF-D2 | Tab bar with >5 destinations on mobile                                                              | iOS HIG limit; Android Material says "use bottom nav for 3–5 destinations".               | Pick the 4–5 most-used; everything else lives in command center.                           |
| AF-D3 | Floating pull-out menus that overlap content without scrim                                          | Cause mis-taps; iOS HIG explicitly warns against.                                         | Modal sheet with backdrop blur and tap-to-dismiss (already in `adaptive-modal-sheet.tsx`). |
| AF-D4 | Different navigation model on tablet/desktop than mobile                                            | Forces users to relearn. Slack tablet copies mobile; Linear desktop copies mobile + adds. | One model; mobile-collapsed sidebar reuses the same destinations as desktop.               |
| AF-D5 | Hover-to-show kebab on native (status quo bug — CONCERNS H13)                                       | Already documented as a CLAUDE.md violation.                                              | `isHovered \|\| isNative \|\| isCompact` pattern from CLAUDE.md.                           |

---

## E. Settings & Preferences

### Table Stakes (E)

| ID    | Feature                                                                                                              | Reference                                                                                          | Why Expected                                                                                                  | Surface | Cx  |
| ----- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------- | --- |
| TS-E1 | Settings organized around user intent (Account / Agents / Voice / Appearance / Advanced) — not internal architecture | iOS Settings app (intent-organized); Things 3 settings; Slack settings                             | Engineering-organized settings ("WebSocket Config", "MCP Server Settings") fail discoverability.              | app     | M   |
| TS-E2 | Theme / language / voice reachable in ≤2 taps from any screen                                                        | iOS Quick Settings; Slack appearance shortcut                                                      | Frequent settings hiding 4 taps deep is a known frustration.                                                  | app     | S   |
| TS-E3 | Each labs/experimental feature has its own toggle and stability label                                                | GitHub Labs feature flags; Discord Experiments; Linear Insiders                                    | One global "experiments" toggle (current `chromeEnabled` situation, CONCERNS C11) couples unrelated features. | app     | M   |
| TS-E4 | Settings respect OS-level appearance (auto light/dark from system theme)                                             | All Apple-tier apps; Material You on Android                                                       | Hardcoded theme in 2026 is unprofessional.                                                                    | app     | S   |
| TS-E5 | All settings persist immediately (no "Save" button)                                                                  | iOS Settings, macOS System Settings, Linear, Slack — every modern app                              | Save buttons feel like web forms.                                                                             | app     | S   |
| TS-E6 | Settings are searchable                                                                                              | macOS System Settings search; iOS Settings search                                                  | 100+ settings without search = users give up.                                                                 | app     | S   |
| TS-E7 | Reset-to-defaults exists and is discoverable                                                                         | macOS System Settings "Reset"; Cursor "Reset settings"; Slack "Reset"                              | Without reset, users break their app and reinstall.                                                           | app     | S   |
| TS-E8 | Settings sync between desktop and mobile (via daemon, not cloud)                                                     | Things 3 syncs settings; ChatGPT syncs settings; the daemon-as-source-of-truth model is novel here | Inconsistent theme between desktop and phone is a known UX mismatch.                                          | both    | M   |
| TS-E9 | Bilingual parity (en + zh) for every settings string                                                                 | Existing Ottie invariant per CLAUDE.md                                                             | Half-translated settings = visible ship-quality regression.                                                   | app     | S   |

### Differentiators (E)

| ID    | Feature                                                                                | Reference                                                                              | Why It Matters                                                                                                                                      | Surface | Cx  |
| ----- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --- |
| DF-E1 | Settings preview live as you change them (no "apply")                                  | macOS Wallpaper preview; Linear theme preview; Cursor settings preview                 | Confidence-building; reduces undo.                                                                                                                  | app     | S   |
| DF-E2 | Per-workspace settings overrides (e.g., dark theme for one project, light for another) | Cursor workspace settings; VSCode workspace settings                                   | Power users keep different visual contexts per project.                                                                                             | both    | M   |
| DF-E3 | "What's new" surfaced inline in settings on app version bump                           | Apple Notes "What's New"; Things 3 "What's New"                                        | Users miss feature changes; this is the canonical surface.                                                                                          | app     | S   |
| DF-E4 | Voice settings include sample-and-confirm flow ("Test microphone", "Test wake word")   | Apple Siri "Hey Siri" training; Discord mic test                                       | Voice setup is fragile; previewing avoids 90% of "voice doesn't work" tickets.                                                                      | both    | M   |
| DF-E5 | Connection diagnostics page surfaces daemon log path, version mismatch, relay status   | iOS Settings → Privacy → diagnostics; Tailscale → Bug Report; Plex → Settings → Status | When things break, the user needs a route to the debug surface. CLAUDE.md notes `$OTTIE_HOME/daemon.log` is canonical — settings should hint at it. | both    | S   |

### Anti-Features (E)

| ID    | Pattern to AVOID                                   | Why Avoid                                                                                              | What to Do Instead                                                                         |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| AF-E1 | Flat 50-item settings list                         | Cognitive overload; Cursor's settings UI is an example of what to avoid (its own community complaint). | Categorized + search (TS-E1, TS-E6).                                                       |
| AF-E2 | "Account" section that requires sign-in            | No cloud account in v1.11. Local-first invariant.                                                      | "Connections" section (daemon list) instead of "Account".                                  |
| AF-E3 | Mandatory "share usage data" toggle in settings UX | Privacy-first brand. Even opt-out by default is bad.                                                   | No telemetry in v1.11. If added, opt-in only.                                              |
| AF-E4 | Backup/restore via cloud account                   | Same as AF-E2.                                                                                         | Local export/import (file-based); already aligned with JSONL import path landing in v1.10. |
| AF-E5 | Settings A/B-tested without user knowledge         | Privacy + transparency invariants.                                                                     | Labs section with explicit opt-in (TS-E3).                                                 |

---

## F. Cross-Cutting — Theme & Visual Language

### Table Stakes (F)

| ID    | Feature                                                                                | Reference                                                            | Why Expected                                                                                                              | Surface | Cx  |
| ----- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------- | --- |
| TS-F1 | Single source of truth for color, surface, elevation, typography, motion               | Linear's design tokens; iOS HIG semantic colors; Material You tokens | Without tokens, every component invents its own value, drift is inevitable. The in-flight `theme.ts` rewrite is the path. | app     | M   |
| TS-F2 | Light/dark parity audited — every modal/sheet/popover passes both modes                | Apple HIG; every Apple-tier app                                      | Half-themed app = unfinished app.                                                                                         | app     | M   |
| TS-F3 | Loading, empty, error states share one visual language across the app                  | Linear's empty states; Things 3's empty states; Stripe Dashboard     | Inconsistent empty states = patchwork product feel.                                                                       | app     | M   |
| TS-F4 | Type ramp is consistent (display / heading / body / caption sizes)                     | iOS Dynamic Type; Material 3 type scale                              | Inconsistent type = amateur feel.                                                                                         | app     | S   |
| TS-F5 | Motion curves are consistent — same easing for sheet open, modal open, page transition | iOS UISpring; Material motion                                        | Mismatched curves feel jarring across the app.                                                                            | app     | S   |
| TS-F6 | Honors `prefers-reduced-motion`                                                        | iOS Reduce Motion accessibility; web `prefers-reduced-motion`        | Accessibility table-stakes; Apple App Store review checks this.                                                           | app     | S   |

### Differentiators (F)

| ID    | Feature                                                                                                     | Reference                                                      | Why It Matters                                                                                                 | Surface | Cx  |
| ----- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------- | --- |
| DF-F1 | Brand-character (Otter) shows up in delight moments — splash, empty state, key milestones                   | Linear's mascot; Duolingo's owl; Tot's icons                   | Brand recall + emotional anchor.                                                                               | app     | M   |
| DF-F2 | Glass surface treatment that adapts to the content beneath (e.g., command-center over a colorful workspace) | Apple Liquid Glass; Things 3's "touch of glass in the sidebar" | The in-flight `glass-surface.tsx` work is exactly this. Match category leaders.                                | app     | M   |
| DF-F3 | Subtle haptic cue on theme toggle and other "delightful" state changes                                      | iOS toggle haptic; Slack toggle haptic                         | Tactile native feel.                                                                                           | app     | S   |
| DF-F4 | Math-curve loader becomes brand-distinctive (versus generic spinner)                                        | Linear's loader; Stripe's loader; Notion's loader              | Loaders are seen 1000s of times — distinctive ones become brand assets. The math-curve work is the foundation. | app     | S   |
| DF-F5 | Cross-platform theme system supports iOS/Android/web/Tauri with one source                                  | React Native + web tokens; Material 3 cross-platform           | One token graph; Metro splits as needed.                                                                       | app     | M   |

### Anti-Features (F)

| ID    | Pattern to AVOID                                                    | Why Avoid                                                                   | What to Do Instead                                               |
| ----- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| AF-F1 | Per-component hardcoded color values                                | Inevitable drift, theme rewrite explosion. CONCERNS-style maintenance debt. | Tokens only; lint rule to forbid hex literals in component code. |
| AF-F2 | Multiple competing modal/sheet components                           | Causes inconsistency; current adaptive-modal-sheet should win.              | One sheet primitive used everywhere.                             |
| AF-F3 | Theme switch that requires app restart                              | Apple-tier apps switch live; restart-required is amateur.                   | Live token swap on toggle.                                       |
| AF-F4 | Heavy animation as decoration (e.g., parallax on every list scroll) | Drains battery, fights `prefers-reduced-motion`, and the user notices.      | Reserve motion for state transitions, not decoration.            |

---

## G. Cross-Cutting — Native-Feel AI

### Table Stakes (G)

| ID    | Feature                                                                                                                            | Reference                                                                             | Why Expected                                                                                                                                       | Surface | Cx  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --- |
| TS-G1 | Voice / command-center / long-press parity ≥80% on core actions (create agent, switch workspace, jump session, approve permission) | Apple Shortcuts/Siri parity; Slack: voice + command + click reach the same actions    | Mismatched parity tells users one input is "first-class" and others aren't.                                                                        | both    | L   |
| TS-G2 | Haptics on every meaningful state transition: agent run-start, run-stop, permission-request, send-message                          | Apple HIG (UIImpactFeedbackGenerator usage); Discord's haptic patterns; Slack haptics | Without haptics, mobile feels like a web wrapper.                                                                                                  | app     | S   |
| TS-G3 | Pointer/touch event handlers are platform-correct (no `onPointerEnter`/`onPointerLeave` on native — CONCERNS C12 fix)              | CLAUDE.md explicit rule                                                               | Native crash = product break.                                                                                                                      | app     | S   |
| TS-G4 | Daemon connection state visible from every screen (connection dot + version-mismatch callout + offline recovery prompt)            | Tailscale dot, Slack offline pill, Plex "server unavailable"                          | Trust signal; the v1.9 papercut showed users can't tell connection from agent state. The new `daemon-connection-dot.tsx` is the canonical surface. | both    | M   |
| TS-G5 | AI-generated text streams with a smoothed typing animation (not character-by-character flicker, not big chunks)                    | ChatGPT mobile streaming; Claude.ai streaming; the new `use-smoothed-text` hook       | Choppy streams feel broken; Claude/GPT have set the bar.                                                                                           | app     | S   |
| TS-G6 | Pull-to-refresh on the agent list (mobile)                                                                                         | iOS native pattern; Slack mobile, Linear mobile                                       | Native gesture; missing it feels like a web app in a webview.                                                                                      | app     | S   |
| TS-G7 | Swipe-to-archive / swipe-to-delete on session list                                                                                 | iOS Mail; Linear mobile; Things 3                                                     | Native gesture parity.                                                                                                                             | app     | S   |
| TS-G8 | Pinch / two-finger zoom on terminal and code blocks (mobile)                                                                       | Tabby mobile, Termius, iOS native                                                     | Mobile reading of dense content requires zoom.                                                                                                     | app     | M   |

### Differentiators (G)

| ID    | Feature                                                                                                                                    | Reference                                                                | Why It Matters                                                                                                          | Surface | Cx  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------- | --- |
| DF-G1 | Voice trigger word ("Hey Ottie") wakes the floating orb without unlocking the phone (when permission granted)                              | Apple "Hey Siri"; Google "Hey Google"                                    | Genuinely category-defining. The `expo-two-way-audio` + Silero VAD foundation already exists.                           | both    | L   |
| DF-G2 | Push-to-talk (long-press orb) is push-to-listen (orb shows live transcription) AND push-to-act (release sends to agent)                    | Slack huddle; Discord PTT; existing voice-control/ pipeline              | Combines voice input affordance with feedback that voice was understood.                                                | app     | M   |
| DF-G3 | Lift-to-listen (raise phone to ear) shifts agent output to earpiece + auto-mutes speaker                                                   | Slack huddle "raise to listen"; Apple Phone                              | Private mode for shared environments.                                                                                   | app     | M   |
| DF-G4 | Apple Shortcuts integration ("Run Ottie agent X with prompt Y")                                                                            | Things 3 Shortcuts; Slack Shortcuts; Linear Shortcuts                    | Power-user platform integration.                                                                                        | app     | M   |
| DF-G5 | Live activities + dynamic island for in-flight agent runs                                                                                  | iOS 17+ Live Activities (Uber, Lyft, sports apps); Slack call activities | If a user backgrounds the app while an agent is running, this is the only way to keep status visible. Genuinely native. | app     | L   |
| DF-G6 | Permission requests fire OS-level high-priority notification with action buttons (approve/deny without opening app)                        | iOS interactive notifications; Slack call notifications                  | Sub-tap approval from the lock screen.                                                                                  | both    | M   |
| DF-G7 | Haptics map to semantic intent: light=info, medium=action-confirmed, heavy=permission-required, success/error notifications for completion | Apple HIG; Discord PTT haptic request                                    | Distinguishable haptic vocabulary; users learn the language.                                                            | app     | S   |

### Anti-Features (G)

| ID    | Pattern to AVOID                                                            | Why Avoid                                                                     | What to Do Instead                                                          |
| ----- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| AF-G1 | Always-on background voice listening that streams audio to a remote service | Privacy invariant. Even Apple/Google process wake-word locally and disclose.  | All STT/TTS local-first via Sherpa-ONNX (already in place; do not regress). |
| AF-G2 | Constant haptic pulses (e.g., every streaming token)                        | Drains battery, fatigues the wrist, becomes meaningless.                      | Haptic only on semantic events (TS-G2, DF-G7).                              |
| AF-G3 | Generic web-style loading spinner everywhere                                | Breaks native feel; ChatGPT mobile uses native shimmer; Linear uses skeleton. | Use math-curve loader (DF-F4) consistently.                                 |
| AF-G4 | Modal dialogs that block agent output streaming                             | Streaming should never be blocked by UI overlay.                              | Sheets, callouts, toasts — never blocking modals over the timeline.         |
| AF-G5 | "Agent thinking..." spinner with no cancel                                  | Users get stuck. Cursor and Claude Code both let you abort.                   | Always-cancellable in-flight agent operations.                              |

---

## Where Ottie Is Setting the Bar (No Good Reference)

There are several flows where the AI-agent-control-on-mobile category has no established leader. v1.11 polish work in these areas is genuinely category-defining, not catch-up:

| Area                                                                        | Why no reference exists                                                                                                                                                                          | Implication for v1.11                                                                                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mobile-as-cockpit for local AI agents**                                   | Cursor/Aider/Continue are desktop-only. ChatGPT/Claude mobile are SaaS, not local-first. There is no other product where mobile controls processes running on your laptop.                       | We pick the patterns. Lean on Plex (server-pair) + Slack (mobile-as-secondary) + ChatGPT (conversation list) as the closest analogues; combine them. |
| **Permission approval from phone for an agent running on a remote machine** | Slack "approval workflows" are the closest, but the latency and stakes are different. No category leader has "agent wants to `rm -rf` — approve/deny in <1s from your phone in another country". | DF-B5 (push deep-link), DF-G6 (interactive notification), TS-B5 (full context inline) together set the bar.                                          |
| **Voice control of a coding agent**                                         | Apple Siri / Google Assistant don't ship with code-edit grammars. Cursor/Aider don't have voice. Ottie's voice-control router is novel territory.                                                | Ship the parity invariant (TS-G1) and the lift/PTT semantics (DF-G2/G3) cleanly; competitors will copy us, not vice versa.                           |
| **Cross-device session continuity without cloud sync**                      | ChatGPT/Cursor sync via cloud. Things 3 syncs personal data via iCloud. Nobody syncs "running agent state across phone↔desktop" without third-party servers.                                     | TS-C9 + TS-E8 — the daemon-as-source-of-truth + relay-encrypted handoff is the bar Ottie is setting.                                                 |
| **Local-first onboarding for a system with both local and remote modes**    | Tailscale is closest; Plex is closest; both are imperfect templates. The "you launched the desktop, now your phone just works" magic is unowned.                                                 | DF-A1 (LAN auto-pair) + TS-A1 (auto-detection) is genuinely original UX.                                                                             |
| **Multi-agent parallel monitoring**                                         | Cursor tabs are for concurrent chats, not concurrent autonomous agents. tmux is the closest analogue, and tmux isn't on mobile.                                                                  | DF-B3 (parallel dashboard) is the bar.                                                                                                               |

Where we set the bar, the right discipline is: **borrow the _pattern_ from the closest analogue, not the implementation.** Plex tells us what pair-and-go feels like; Slack tells us what huddle haptics feel like; Linear tells us what command palettes feel like. Combine — don't invent visual language from scratch.

---

## Feature Dependencies

```
TS-A1 (auto-detect local daemon)
    └──requires──> TS-G4 (connection state visible)
    └──requires──> daemon-side LAN discovery primitive (new daemon work)

DF-A1 (LAN auto-pair)
    └──requires──> TS-A1 (auto-detect)
    └──requires──> ARCH-03 (local daemon auth — no longer "any local process can control all agents")

TS-B1 (single canonical "new agent" entry point)
    └──requires──> TS-D5 (command center is universal)
    └──requires──> TS-D6 (tab bar and sidebar share one model)

TS-B4 (≤2 taps to first message)
    └──requires──> TS-B2 (last-used remembered per workspace)

DF-B1 (voice-trigger parity)
    └──requires──> TS-B1 (single canonical entry point)
    └──requires──> TS-G1 (voice / command-center / long-press parity)

TS-C1 (recent sessions in sidebar)
    └──requires──> TS-D7 (recent sessions surface inline)

TS-C4 (OpenCode session recovery)
    └──requires──> daemon-side fix to listPersistedAgents stub (CONCERNS H4)

DF-C2 (fork session)
    └──requires──> TS-C4 (sessions persist properly across providers)

TS-D4 (always-visible kebab on native — CONCERNS H13 fix)
    └──requires──> isHovered || isNative || isCompact pattern from CLAUDE.md

TS-E1 (intent-organized settings)
    └──requires──> TS-E3 (per-feature labs flags — resolves CONCERNS C11 chromeEnabled split)

TS-E8 (settings sync via daemon)
    └──requires──> ARCH-02 (backward-compat schema additions)

TS-F1 (single theme source of truth)
    └──enables──> TS-F2, TS-F3, TS-F4, TS-F5, DF-F2, DF-F4

TS-G1 (input parity ≥80%)
    └──requires──> TS-D5 (command center as universal action surface)
    └──requires──> TS-B1 (single canonical entry point)

TS-G3 (pointer event fix — CONCERNS C12)
    └──requires──> isWeb gate (CLAUDE.md mandate)

ARCH-01 (carve session.ts god-file)
    └──enables──> safe parallel work on TS-C4, TS-C9, TS-G4, daemon push deep-link DF-B5
```

### Critical-path dependency notes

- **`session.ts` carve (ARCH-01) is upstream of nearly everything in C and parts of B/G.** Multiple phases will touch the file; carving once early avoids merge-conflict tax compounded across the milestone.
- **Local daemon auth raise (ARCH-03) is upstream of DF-A1.** LAN auto-pair without auth raise is a security regression.
- **Theme tokens (TS-F1) are upstream of all of F.** Cannot ship F2/F3/F4/F5 in parallel without tokens landing first.
- **Command center upgrade (TS-D5) is upstream of B1, G1, and a chunk of D.** Build it once; every input modality consumes it.
- **CONCERNS H13/C12/H4 fixes are gating bug fixes** — they should land in the very first phase to unblock confident polish work in subsequent phases.

---

## Reference Product Index

For the team to study actual implementations:

| Reference                 | Best to Study For                                                                 | URL                                                                    |
| ------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Linear (web + mobile)     | Three-level navigation, command bar, keyboard shortcuts, type ramp, density modes | https://linear.app                                                     |
| Things 3 (iOS)            | Magic Plus quick entry, drag-and-drop, native gestures, Apple-tier polish         | https://culturedcode.com/things/                                       |
| Tot (iOS/macOS)           | Radical simplicity, swipe navigation with haptic, single-window paradigm          | https://tot.cool                                                       |
| Raycast (macOS)           | Command palette ranking (frecency), action panel, keyboard navigation             | https://manual.raycast.com/action-panel                                |
| Superhuman (web + mobile) | Command palette excellence, J/K nav, mobile pull-down-then-swipe gesture          | https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/ |
| Arc Search (iOS)          | Bottom-anchored controls, one-tap pinned items, minimal command bar               | https://arc.net/search                                                 |
| ChatGPT (mobile)          | Conversation list with pin/archive/search, long-press context menus               | https://help.openai.com/en/articles/8980299                            |
| Claude Code (CLI)         | `--continue` / `--resume` semantics, JSONL session storage per cwd                | https://code.claude.com/docs                                           |
| Cursor (desktop)          | Multi-tab parallel agents, fork-session pattern, summarization at context limits  | https://cursor.com/docs/agent/chat/summarization                       |
| Continue.dev              | Per-tool permission policies, ask/automatic mode                                  | https://docs.continue.dev/ide-extensions/agent/how-it-works            |
| Tailscale (mobile)        | Pair-and-go QR + manual code fallback, connection dot, tailnet-aware first-run    | https://tailscale.com/kb/1336/device-add-qr-code                       |
| Plex (mobile)             | GDM local-network auto-discovery, "tap Continue" simple onboarding, relay model   | https://support.plex.tv/articles/200430283-network/                    |
| Tabby                     | Cross-device terminal session resume, profile management                          | https://tabby.sh                                                       |
| Slack mobile              | Huddle UX, raise-to-listen, mobile haptics, workspace switcher long-press         | https://slack.com/features/huddles                                     |
| Discord mobile            | PTT button affordance (and its known pain points — what NOT to do), iOS haptics   | https://support.discord.com/hc/en-us/articles/211376518                |
| Aider                     | Terminal-native AI pair programming, atomic commit-per-edit pattern               | https://aider.chat                                                     |

---

## Sources

- [Tailscale: Add a device using a QR code](https://tailscale.com/kb/1336/device-add-qr-code)
- [Tailscale: Add a device](https://tailscale.com/kb/1316/device-add)
- [Raycast Action Panel manual](https://manual.raycast.com/action-panel)
- [Superhuman: How to build a remarkable command palette](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)
- [Superhuman Mobile Navigation](https://help.superhuman.com/hc/en-us/articles/38458290528531-Mobile-Navigation)
- [Linear Concepts (docs)](https://linear.app/docs/conceptual-model)
- [Linear shortcuts compendium](https://shortcuts.design/tools/toolspage-linear/)
- [Cursor: Chat overview](https://docs.cursor.com/chat/overview)
- [Cursor: Summarization](https://cursor.com/docs/agent/chat/summarization)
- [Cursor forum: unified chat store request (fragmentation pain point)](https://forum.cursor.com/t/unified-chat-store-across-ide-cli-acp-mode/159335)
- [Claude Code: Session Management](https://stevekinney.com/courses/ai-development/claude-code-session-management)
- [Claude Code: --continue and --resume guide](https://pasqualepillitteri.it/en/news/366/claude-code-continue-resume-guide)
- [Continue.dev: How Agent Mode Works](https://docs.continue.dev/ide-extensions/agent/how-it-works)
- [Aider documentation](https://aider.chat/docs/)
- [Things 3 — App Store](https://apps.apple.com/ca/app/things-3/id904237743)
- [Tot — Daring Fireball review](https://daringfireball.net/2020/02/tot)
- [Arc Search review (MacStories)](https://www.macstories.net/reviews/arc-search-for-iphone/)
- [Arc Search — features](https://resources.arc.net/hc/en-us/articles/20887042551831-Arc-for-iOS-Android-Arc-Search)
- [ChatGPT iOS conversation history](https://help.openai.com/en/articles/8980299-how-can-i-view-my-conversation-history-in-the-ios-app)
- [ChatGPT search history](https://help.openai.com/en/articles/10056348-how-do-i-search-my-chat-history-in-chatgpt)
- [Slack Huddles (mobile)](https://slack.com/help/articles/4402059015315-Use-huddles-in-Slack)
- [Slack Huddles preferences (raise-to-listen, haptics)](https://slack.com/help/articles/1500002037922-Adjust-your-huddles-preferences)
- [Discord: Voice Input Modes (PTT)](https://support.discord.com/hc/en-us/articles/211376518-Voice-Input-Modes-101-Push-to-Talk-Voice-Activated)
- [Discord: PTT haptic feature request (what users still want)](https://support.discord.com/hc/en-us/community/posts/360032266571-Add-haptic-feedback-to-PTT-button-in-iOS)
- [Plex: Network / GDM discovery](https://support.plex.tv/articles/200430283-network/)
- [Tabby (terminal) — homepage](https://tabby.sh)
- [Apple UIFeedbackGenerator docs](https://developer.apple.com/documentation/uikit/uifeedbackgenerator)
- [Hacking with Swift: UIFeedbackGenerator usage](https://www.hackingwithswift.com/example-code/uikit/how-to-generate-haptic-feedback-with-uifeedbackgenerator)
- [Codex agent approvals & security](https://developers.openai.com/codex/agent-approvals-security)

---

_Feature research for: Ottie v1.11 — User Flow Polish_
_Researched: 2026-04-29_
