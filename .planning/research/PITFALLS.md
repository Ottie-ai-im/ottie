# Pitfalls Research

**Domain:** Mobile-first AI-agent control surface (Ottie v1.11 — User Flow Polish)
**Researched:** 2026-04-29
**Confidence:** HIGH on milestone-character pitfalls (1, 2, 3, 4, 6, 7, 8); MEDIUM on industry-citation specifics where vendor postmortems are private (5, 9); HIGH on AI-agent permission UX (10) — directly observed in shipping products.

> Scope discipline: this file deliberately excludes generic mobile / TypeScript / React advice. Every pitfall here is specific to:
>
> 1. Polish/coherence milestones on a shipped product with users in the field,
> 2. Carving a 9,500-line god-file (`session.ts`) while parallel UX phases run on the same package,
> 3. Schema evolution under a hard backward-compat constraint (CLAUDE.md),
> 4. Voice-first + command-palette + keyboard-shortcut feature parity across iOS / Android / Web / Tauri,
> 5. Theme-system formalization mid-stream,
> 6. AI-agent control UX where users must trust what the agent did.

---

## Critical Pitfalls

### Pitfall 1: The polish milestone quietly becomes a redesign

**What goes wrong:**
The milestone is framed as "polish" but, because scope is open (app + daemon + schema + refactor), individual phases keep finding "one more thing." Information architecture changes pull in iconography changes; iconography changes pull in typography; typography pulls in motion curves; motion curves pull in the navigation model. By week three the team is shipping a new app rather than tightening the existing one, the original "fix the message chevron" papercut is still open, and v1.11 ships late or splits.

**Why it happens:**

- Polish is psychologically rewarding work — every change feels obviously good in isolation.
- Open scope removes the "we can't touch X" reflex that normally pulls a team back.
- Sister-phase work creates legitimate-sounding excuses to widen scope ("the new sidebar IA needs new icons, the new icons need a new token system, the new token system needs a typography pass…").
- Polish phases lack the natural acceptance test that feature phases have ("did the feature work?"). "Is it polished enough?" has no fixed answer.
- The PROJECT.md constraint says "open scope" — taken literally, this can be read as "do whatever feels right."

**How to avoid:**

- **Per-phase Definition of Done in measurable user terms, not aesthetic ones.** Each phase ships against numeric or binary acceptance: "first-message latency ≤2 taps and ≤200 ms perceived" (AGT-04 already has this — the discipline must be applied to every phase). The success criteria already in PROJECT.md are good — bind them as gates, not aspirations.
- **"In-bounds, out-of-bounds" line per phase, written before the phase starts.** Example for Phase D (Sidebar & Navigation): in-bounds = collapse rules, hover→native fix, command-center bridge; out-of-bounds = sidebar visual redesign, new iconography, motion overhaul. Anything out-of-bounds gets a defer ticket, not a "while we're here" commit.
- **Change-control bar set at "would a user notice the regression?", not "would a designer notice?"**. This is a polish milestone for a tool people use every day; the rule is "do not introduce a learning tax."
- **Time-boxed phases.** Polish work tolerates a hard deadline better than feature work because the bottom of the polish queue is always lower-value than the top. Set the timebox; ship what's done; carry the rest.
- **Reference UX > invented UX** (already in Key Decisions). Every phase should cite a reference product before designing — Linear command-center, Superhuman shortcuts, Claude Code plan mode, etc. — to suppress the urge to invent novel patterns.

**Warning signs:**

- A phase's PR diff exceeds 2× the lines its acceptance criteria suggest.
- New design tokens or new component primitives appearing in commits where the phase scope did not require them.
- Phase reviews surfacing comments like "while we're here, can we also…".
- The original CONCERNS-listed bugs (chevron H13, resize handle C12, OpenCode H4) are still open after dependent phases have merged.
- Strings being added to `en.json` / `zh.json` for new screens that weren't in the requirements.

**Phase to address:** Cross-cutting — applies to every phase. Particularly **Theme/Visual (F)**, **Sidebar/Navigation (D)**, **Settings (E)** because each has natural redesign gravity.

**Confidence:** HIGH. The team has already shipped v1.6→v1.10 weekly, so velocity is real; the risk is that "polish" pattern-matches against "design freedom" rather than against "Slack/Linear papercut sweep."

---

### Pitfall 2: Parallel-phase contention on `session.ts` while it is being carved

**What goes wrong:**
ARCH-01 (carve `session.ts`) is happening in the same milestone as Phase B (agent invocation), Phase C (sessions), Phase E (settings flag split), and Phase G (native-feel AI). Every one of those phases needs to touch `session.ts`. Two failure modes ensue:

1. **Carve-then-merge thrash.** The carve PR sits open while feature phases keep editing the original file; rebase conflicts compound; the carve PR is rebased N times; eventually it is abandoned or merged with stale logic.
2. **Worse coupling after carving.** The file is split into `session-agent.ts`, `session-chat.ts`, `session-voice.ts`, `session-files.ts`, `session-permissions.ts`, but they all still call into a `SessionCore` that holds the same shared mutable state. Now there are 5 files with mutual recursion instead of 1 file with everything inline. Cognitive load is unchanged or worse, because the implicit coupling is now invisible.

**Why it happens:**

- Carving a god-file without first finding seams that exist in the runtime (not just textually) produces "split by topic" rather than "split by ownership," which is the worse-coupling failure mode.
- Treating the carve as a single big-bang PR forces it to compete with feature merges for a moving target.
- Underestimating how many cross-cutting features the file actually owns. `session.ts` per CONCERNS H3 holds: agent subscriptions, terminals, voice, chat, file explorer, permissions. That is ~6 sibling concerns sharing one event loop and one set of subscriptions — not naturally separable without first designing the seam.

**How to avoid:**

- **Strangler-fig the file, not the topic** ([Shopify on strangler-fig refactoring](https://shopify.engineering/refactoring-legacy-code-strangler-fig-pattern), [Microsoft strangler-fig pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig)). Each carve commit extracts ONE concern behind an interface that `session.ts` keeps consuming, and lands within ~1 day of being opened. Never start the next extraction until the previous one is merged.
- **Phase the carve before any feature phase that touches the same surface.** Carve sequence on the critical path, then let parallel phases consume the new modules. Concretely: Phase ordering should make ARCH-01 land at least one extraction ahead of every dependent feature phase, e.g. "extract permissions service" before AGT-05 begins, "extract session/chat boundary" before SES-01, "extract voice routing" before NAT-01.
- **Define the seam by data ownership, not by topic.** The right seam is "who owns this piece of mutable state?" — agent subscription set, terminal PTY handles, MCP permission queue, etc. Topic-based splits ("the chat one," "the voice one") tend to share state and re-import each other.
- **Forbid `SessionCore` god-objects.** If a carve introduces a new shared coordinator that all the new modules import, you have moved the god-file rather than carved it. Rule: every new module owns its state and exposes a narrow interface; the daemon's main entrypoint composes them.
- **Single-author windows on `session.ts` while the carve is in progress.** Two phases editing it the same day = one of them rebases against a moving target.
- **No new features added to `session.ts`.** New work goes into the carved-out modules, even if it means landing the carve for that concern first.

**Warning signs:**

- Carve PR open >48h with >3 rebases.
- Carved files importing each other in cycles.
- Diff stats: a carve PR claiming to "extract X" but `session.ts` is still touched in dozens of places after the PR.
- Two parallel PRs both editing `session.ts`.
- A `SessionCore` / `SessionContext` / `SessionShared` file appearing.
- The line count of `session.ts` has not gone down by more than ~25% per carve commit.

**Phase to address:** **Phase H (ARCH-01)** must lead, with a pre-flight extraction landing before each dependent feature phase. Specifically:

- Permissions service extraction → unblocks AGT-05.
- Subscription/timeline extraction → unblocks SES-01, SES-03.
- Voice routing extraction → unblocks NAT-01.

**Confidence:** HIGH. The pattern of "split by topic produces coupled modules" is consistently reported in monolith-decomposition retrospectives ([the distributed monolith trap](https://threedots.tech/episode/the-distributed-monolith-trap/), [we split our monolith into 47 microservices and made everything worse](https://medium.com/engineering-playbook/we-split-our-monolith-into-47-microservices-it-made-everything-worse-faa930a9411d)).

---

### Pitfall 3: Schema deprecation that _looks_ backward-compat but quietly breaks old clients

**What goes wrong:**
A schema change in `packages/server/src/shared/messages.ts` passes the literal CLAUDE.md rules — "added a new optional field, didn't remove anything" — but quietly breaks a 6-month-old mobile app in subtle ways:

- A field's _default_ is changed from `null` to `[]`; old clients that switch on `=== null` miss the new state and render an empty list as "loading forever."
- A `.transform()` is added to lossy-cast incoming data; old clients receive lossless data from a daemon that rounded-trip-changed it (e.g., a string ID that used to be a number on the wire is now a string, but the old client expects the number type discriminator).
- A field that _was_ always present is now sometimes omitted because the daemon "doesn't bother sending it when irrelevant"; old clients destructure expecting the field and crash.
- A field's enum gains a new variant — strictly an additive change — but old clients have a `switch` without a `default` branch and silently fall through.
- An "additive" tagged-union case is added; old client uses `z.discriminatedUnion` with strict parsing and rejects the whole message.
- An optional field that used to be sent on every message is now only sent on the first message of a session (an "optimization"); old client expects to refresh from each message.

**Why it happens:**

- The CLAUDE.md rules read as a checklist of _syntactic_ changes, but compatibility is a _semantic_ property. The semantically-equivalent change is "what an old client will do when it parses this and acts on it."
- Backward compat is intuitively framed as "old client receiving from new daemon," but the inverse — "old daemon receiving from new client that _thinks_ it's talking to a new daemon but isn't" — is also live in Ottie, because users update desktop+daemon at different cadences and may also have _another_ still-running daemon on a different machine they pair to. (Per PROJECT.md: "users update desktop and daemon first, then keep running the old app.")
- Zod's `.optional()` makes a field type-system-safe but says nothing about behavioral assumptions clients have built around its presence.
- Default-value drift — adding a default for a field that was previously required — passes typecheck but silently changes runtime behavior.

**How to avoid:**

- **A test fixture set of "frozen old client" message shapes.** Before merging any `messages.ts` change, run the new daemon's outbound messages through the schemas of v1.10, v1.9, v1.8 and assert each parses without error AND assert key derivations (e.g., "does v1.9's `agent.title || 'Untitled'` still produce a title?") still produce the same value class. Per [event-versioning best practices](https://oneuptime.com/blog/post/2026-01-30-event-driven-versioning-strategies/view), events outlive the code that emits them.
- **A "client behavior contract" document next to `messages.ts`** listing, per field, "what a client is allowed to assume." Example: `agent.epoch is monotonically non-decreasing per agent`, `permission_request.toolCall.command is always a non-empty string when present`. New schema changes have to preserve these behavioral contracts, not just the type signature.
- **Three-way matrix testing** in CI: new app ↔ new daemon, new app ↔ old daemon, old app ↔ new daemon. The third axis is the one that actually fails in production. This builds on Ottie's existing test infrastructure (Playwright e2e against a test daemon) — extend it to spin up a previous-version daemon binary.
- **Never change a default mid-flight.** If a field's default needs to change, ship a new field name; deprecate the old one with a removal schedule (next pitfall).
- **No "optimizations" that skip sending optional fields.** Optional means "the client tolerates absence"; it does not mean "the daemon may freely drop it for efficiency." If the client ever benefits from the field being present, send it.
- **Tag every schema change in `messages.ts` with a `// @added vX.Y.Z` comment.** Makes audit trivial and makes "is this a new field" a 1-second answer in review.

**Warning signs:**

- A `messages.ts` PR has no accompanying test that loads old fixtures.
- A field's default value is changed in the same PR that adds a new variant.
- A switch statement on a discriminated union doesn't have a `default: assertNever(x)` branch — it will silently miss new cases on old clients.
- The PR description says "this is backward-compatible because Zod accepts it" without naming the _behavioral_ compatibility argument.
- An old-client smoke test isn't part of CI.
- `transform()` is being added to coerce a type — coercion is silent and easy to misread.

**Phase to address:** **Phase H (ARCH-02)** owns the policy. Every other phase that touches schemas (B, C, E, G) is bound by it.

**Confidence:** HIGH. This is exactly the failure class CLAUDE.md tries to prevent, and the codebase already has CONCERNS H7 ("backward-compat shims accumulating without removal schedule") indicating the discipline has slipped before.

---

### Pitfall 4: Voice / command-center / keyboard parity rot

**What goes wrong:**
NAT-01 says voice, command-center, and long-press should reach the same actions with ≥80% parity. Six weeks after launch, parity has rotted:

- A new "switch workspace" was added to the command-center but not wired to voice.
- A new voice intent ("create a quick note for me") was added but doesn't exist as a command-center action.
- Keyboard shortcut for "approve permission" was added on web/Tauri but never expressed as a voice intent or long-press target.
- Three places define "what an action does" — a Zustand store action, a voice router intent handler, and a command-center entry — and they have drifted: the command-center version uses the latest provider default, the voice version uses a hardcoded provider, and the long-press version pops a wizard that the command-center version skips.

The product feels patchwork — each modality is "okay alone" but no single user can switch fluidly between them, which is the whole point.

**Why it happens:**

- Each modality has its own owner / phase / schema / file structure, so there is no single place that lists "the actions a user can take."
- Adding a new action requires N edits (one per modality); skipping any of them is the path of least resistance, and reviewers don't enforce the missing edits because they don't see the absent ones.
- Reference products survive this by treating commands as first-class data, not as code: [Superhuman built their command palette on top of a single command registry](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/), and Linear's Cmd+K reads from the same intent set as their voice and shortcut layers.
- The "command center" pattern's value is exactly that it forces a registry; if voice and shortcuts bypass it, the registry's value is lost.

**How to avoid:**

- **One canonical action registry.** A single `actions.ts` module describes every user-invocable action with: id, label (i18n key), default args, eligibility predicate, handler, voice phrasings, default keyboard shortcut. Command-center, voice router, long-press menus, and shortcut tables all _subscribe_ to this registry rather than defining actions themselves.
- **Parity test in CI.** Iterate the registry; for each action assert it is reachable from at least N modalities (configurable per action; some are voice-only or shortcut-only by design). Failing this test blocks merge.
- **Voice intents are derived from action ids, not invented.** A voice phrase like "switch to ottie workspace" maps onto an action id `workspace.switch` with arg `name="ottie"`; no voice handler can reference an action that does not exist.
- **One i18n key per action.** Both en.json and zh.json must have the key — already a Constraint in PROJECT.md, but binding it to the registry catches missing translations at build time.
- **Mobile long-press = compact-form-factor command center.** Treat long-press menus as "the visual form of the action registry on small screens" rather than as a separate menu authored by hand. Removes the third drift surface.

**Warning signs:**

- Voice intent handlers contain literal action logic (open a screen, mutate a store) instead of calling registry actions.
- New menu items being added without corresponding registry entries.
- Translation files mention strings that aren't anywhere in the action registry, or vice versa.
- A keyboard shortcut works but its action isn't in the command center.
- "We'll add it to voice later" comments accumulate.

**Phase to address:** **Phase B (AGT-01)** establishes the canonical-entry-point principle; **Phase D (NAV-A4)** wires the command center as the universal action surface; **Phase G (NAT-01)** is where parity gets enforced. The registry should land in Phase B before D and G consume it.

**Confidence:** HIGH. Multiple reference products document this exact registry pattern (Superhuman, Linear, Retool), and the failure mode is observed in any product where shortcuts/menus/voice grow independently.

---

### Pitfall 5: Retrofitting a theme system on an app already shipping

**What goes wrong:**
THM-01 formalizes `theme.ts` and `glass-surface.tsx`. Six new components consume the theme; 87 old components keep their hardcoded colors. The intermediate state is _worse_ than either pure state:

- Light/dark parity is partial — themed components track the toggle, hardcoded ones don't, so dark mode looks broken in patches.
- A theme edit (e.g., "tweak the surface elevation") moves themed components but not the hardcoded ones, drifting them visually.
- New components are written against the new theme; bug fixes to old components stay hardcoded, freezing the migration mid-stride.
- Designers update the token spec; engineers don't realize a token changed because their component never consumed it.
- Two parallel definitions of "primary surface color" emerge: one in `theme.ts`, one in `colors.ts`/inline; they drift, then someone "reconciles" them by picking the more recent one — breaking the other half of the app.

**Why it happens:**

- The cost of migrating each old component looks individually low (10 minutes), so it never gets prioritized over feature work.
- The app keeps shipping; designers tweak tokens for the new components; the old components fall further behind each tweak.
- Without a migration tool, every component is a manual edit with high carry cost ([Shopify Polaris specifically built `@shopify/polaris-migrator` to automate this](https://polaris-react.shopify.com/tools/polaris-migrator) — even with a tool, Polaris went through several major versions to finish).
- "Polaris before v9 had hard-to-reference tokens, which led many product teams to hard code their own values" ([Polaris v11 tokens](https://polaris-react.shopify.com/previous-releases/version-11-tokens)) — the same pattern Ottie has now with inline color values.

**How to avoid:**

- **Lint rule that bans new hardcoded color values once the theme lands.** A custom oxlint/Biome rule: in `packages/app/src/`, hex codes, `rgb()`, `rgba()`, and platform color literals are errors except inside `theme.ts` and palette files. New code can't add hardcoded values; old code is grandfathered with a deprecation comment until migrated.
- **Migration counter in CI.** Count the number of hardcoded color literals across `packages/app/src/` and fail if it goes up. Trends down over time; never up.
- **Migrate by surface, not by file.** A "surface" = modal sheet, popover, toast — define the visual primitive (`<GlassSurface>`, `<PopoverShell>`) and migrate all consumers of that surface in one PR. Half-migrated surfaces look broken; whole-migrated surfaces look intentional. THM-02 explicitly says "Every modal/sheet/popover uses the same surface treatment" — bind that to "no half-migrated surfaces."
- **Token review = visual review.** Token edits ship behind a PR that includes screenshots of every surface that consumes the token. If a token is consumed by N components but the PR only shows M screenshots, reviewer asks "where are the other N−M?"
- **One source of truth, no aliasing.** Per [Polaris v11](https://polaris-react.shopify.com/previous-releases/version-11-tokens): palette tokens are private; alias tokens are what consumers use. Ottie should adopt the same — palette never imported by components, only aliases. Prevents "this color was almost the right one, I'll just inline a tweak."
- **Theme system is a phase exit gate.** Before Phase F (THM) closes, define a list of components that must be migrated; Phase F doesn't ship until they are.

**Warning signs:**

- New components import `theme.ts`; bug fixes to old components add `#hexcode`.
- Designers complain "I changed the token but it didn't update everywhere."
- Light/dark mode looks fine on welcome/sidebar, broken on chat/terminal.
- The hardcoded-color count in a CI job ticks up rather than down.
- Two paths to the same color: `theme.surface.glass` and `glassColor` (a top-level export).

**Phase to address:** **Phase F (THM-01..04)**. The lint rule and migration counter should land at the _start_ of Phase F, before any new theme tokens are added, so that subsequent phases (D, E, G) can't add new hardcoded values.

**Confidence:** MEDIUM-HIGH. The Polaris precedent is well-documented; the specific friction with Ottie's intermediate state is plausible from the in-flight commits (theme.ts + glass-surface.tsx landing alongside untouched older components).

---

### Pitfall 6: Optimistic UI lying to users about what the agent did

**What goes wrong:**
AGT-04 promises optimistic UI feedback before the daemon emits its first event ("≤2 user-visible taps with optimistic UI feedback"). Failure modes:

- User sends "review my PR" → app shows "Sent ✓ — agent thinking…" → daemon never received it (network blip) → UI stays "thinking" forever.
- Permission prompt shown optimistically as "Approved ✓" → daemon's `PermitDecisionMessage` was lost → agent is actually blocked → user thinks the action ran and moves on.
- Tool-call diff shown to user → user approves → app says "Applied" → but the agent was actually mid-stream and applied something different by the time the approval arrived → diff shown to user did not match what was applied.
- App shows agent transitioning `idle → running` because user pressed Send, but the agent is still in `initializing` (per the lifecycle in ARCHITECTURE.md) → user sees a green dot and types follow-ups that get queued and reordered.
- Optimistic timeline event shown ("user said: …") with epoch N+1; when the real event arrives with a slightly different shape (server normalized text, attachment), the dedup logic accepts both → message appears twice.

This is a _trust_ failure. PROJECT.md's core value: "the developer trusts that the agent is doing what they think it's doing." Optimistic UI that lies destroys the core value.

**Why it happens:**

- "Optimistic" is mentally framed as "fast"; the rollback path is treated as an edge case.
- AI agent UX has unusually high consequences for being wrong: an "approved" tool-call may have written to the user's filesystem or made a network request. Wrong optimism = wrong belief about a side effect.
- Rollback design fails when responses come back out of order ([optimistic UI rollback divergence](https://frontendddlab.vercel.app/optimistic-ui-rollback-failure)) — Ottie's WebSocket has multiple message classes interleaving, especially under relay latency.
- Stream model (`packages/app/src/types/stream.ts`) already does sequence-based deduplication for real events; optimistic events have a different identity scheme; interaction between the two is subtle.

**How to avoid:**

- **Tier optimistic UI by reversibility.** Three levels:
  1. **Reversible UI feedback** (button press tactile response, keyboard echo) — always optimistic, no rollback needed.
  2. **Pending state** (sent, awaiting ack) — show "sent" with a subtle indicator (clock, dot, fade) that visually distinguishes from "delivered." Resolve to "delivered" on ack; resolve to "failed, retry" on timeout. Never show ✓ until ack.
  3. **Side-effect actions** (permission approval, tool-call run, agent stop) — _never_ optimistic. Show "approving…" until daemon confirms. The user is approving a side effect on their machine; lying about it is a category error.
- **Distinguish "sent" from "delivered" visually.** A subtle clock vs check is enough. Empirically, real-time chat has spent 15 years on this; copy the pattern.
- **Timeout + reconnect protocol.** Optimistic state that hasn't been confirmed within K seconds shows the user "we lost contact, retry?" — never silently ages out.
- **Use Stream's sequence numbers as the source of truth.** Optimistic events get a flag `isPending=true` and carry an "expect a real event with this correlation id"; when the real event arrives, the optimistic one is replaced (not merged). If no real event arrives within timeout, the optimistic one is removed and an error toast is shown.
- **Daemon connection state in the chrome.** NAT-05 already requires this — bind it strictly to optimistic UI behavior: when the daemon connection dot is amber/red, optimistic UI for side-effect actions is _disabled_; the user sees pending states explicitly.
- **Agent state machine respect.** AGT-04 specifies "first message reaches the daemon in ≤2 taps" but the agent state machine has `initializing → idle → running` (ARCHITECTURE.md). The UI must show "starting up" not "running" until `idle` is reached. Otherwise the user sends follow-ups that get queued before the agent is ready, and the perceived behavior is "agent ignored my second message."

**Warning signs:**

- An optimistic event in the timeline persists with no `pending` indicator.
- A permission request shows "approved" before the daemon emits its decision-acknowledgement event.
- "Sent ✓" appears with no distinct "delivered" state.
- Tests for AGT-04 prove the happy path only; no test for "first event never arrives, what does the user see at t=10s?"
- Telemetry (if any) shows dropped acks but no corresponding error toast events.

**Phase to address:** **Phase B (AGT-04, AGT-05)** owns this directly. **Phase G (NAT-05)** binds it to connection state. **Phase H** (carving permission service from `session.ts`) provides the seam to add a confirmation event.

**Confidence:** HIGH. AI-agent UX is uniquely vulnerable here because actions have side effects on the developer's machine.

---

### Pitfall 7: Backward-compat shims accumulating with no removal schedule

**What goes wrong:**
ARCH-02 calls for documented removal schedules. Without one, every schema change adds a transform/alias/fallback "for old clients" and never removes it. Six milestones from now:

- `messages.ts` has 40+ deprecated fields.
- Every new feature has to "consider the deprecated path" because nobody knows whether any old client still relies on it.
- A bug shows up in a deprecated-field path that was supposed to be unused; turns out one type of old desktop install actually still emits it.
- The compatibility matrix is implicit — engineers are guessing what the contract is.
- New engineers cannot tell live fields from zombie fields.

**Why it happens:**

- "Backward-compat" is a one-way ratchet by default — every change is purely additive, never subtractive.
- The path of least resistance is "leave it in"; the path that requires courage is "remove it after the sunset window."
- Telemetry to know "is anyone still using field X?" doesn't exist by default.
- The team optimizes for "no one breaks" rather than "the contract stays simple."

**How to avoid:**

- **Every new shim ships with an `@deprecated since=vX.Y removeAfter=vA.B` comment.** No exceptions. The `removeAfter` is a real version, not "TBD."
- **Removal schedule lives in a single file** (e.g., `packages/server/src/shared/deprecation-schedule.md`) listing fields, since-versions, remove-after-versions, and migration guidance. Anyone considering the deprecated path has one place to read.
- **Daemon emits a usage counter for deprecated fields.** When a deprecated field is accepted on the wire, a counter ticks up in `daemon.log`. Before removing, confirm the counter has been ≈0 for one milestone. Cheap, local, no telemetry-to-the-cloud needed (preserves local-first).
- **A removal happens every milestone.** Even if it's small. Builds the muscle. v1.11's exit criterion includes "removed ≥1 deprecated field this milestone."
- **Hard cap.** No more than N (start with N=10) live deprecation entries. Hitting the cap blocks new deprecations until something is removed. Forces hygiene.
- **Server version skew window stated in CLAUDE.md.** PROJECT.md / CLAUDE.md should say "old clients within ≤6 months are supported; older clients break by design." That gives `removeAfter` a default value.

**Warning signs:**

- `messages.ts` has more `// deprecated` comments than `// @added` comments.
- A schema change PR adds an alias without naming a removal version.
- Nobody can answer "when do we remove field X?".
- Deprecated-field call sites grow over time instead of shrinking.

**Phase to address:** **Phase H (ARCH-02)** owns the policy + tooling (deprecation-schedule file, daemon usage counter). All schema-touching phases are bound by it.

**Confidence:** HIGH. CONCERNS H7 already documents the failure mode in Ottie's codebase.

---

### Pitfall 8: Cross-platform regression blind spots (Expo → iOS / Android / Web / Tauri)

**What goes wrong:**
A polish change is "verified" by the implementer on one platform and silently breaks on another:

- Hover-only UI works on web; controls vanish on iOS/Android (CONCERNS H13 — chevron — _already shipped this regression_).
- `onPointerEnter` works on web and Tauri but crashes iOS (CONCERNS C12 — resize handle — _already shipped this_).
- DOM API leaks into a `.ts` file (no `.web.ts` extension) and ships; bundler doesn't catch it because tree-shaking is incomplete; native dies on first reference.
- A `.web.ts` / `.native.ts` split is added but the existing flat file is also still present and shadows it; Metro picks the wrong one; one platform silently runs stale code.
- `getIsElectron()` is called outside Tauri but treats `false` as "web browser" — fine until someone runs the same code path under Capacitor or a different webview.
- A breakpoint-driven layout change works on phone, breaks on iPad (which is `isNative` but compact in some orientations).
- Haptics fire on agent state transitions (NAT-02) but throw on web because the import resolved both platforms.
- Voice modules use `expo-av` paths that work on iOS, partially on Android, fail on web — voice phase ships with web parity broken.

The codebase has CLAUDE.md rules to prevent these, but the rules are advisory; only some are enforced by lint, and the recent regressions (C12, H13) prove enforcement is partial.

**Why it happens:**

- The polish milestone touches many surfaces; each surface has subtle platform behavior.
- "I tested it on my Mac, in Chrome, and in iOS sim" misses Android, Tauri-on-Linux, narrow-window-web, iPad split-screen.
- Lint catches `Platform.OS === "web"` but not `if (typeof window !== "undefined")` or DOM imports inside conditionally-rendered components.
- Metro's platform-extension resolution is silent — wrong file picked = nothing logged.
- Test infrastructure runs unit tests in a single environment; cross-platform behavior isn't tested at the integration layer.

**How to avoid:**

- **Lint rules promoted from advisory to enforced**:
  - `onPointerEnter` / `onPointerLeave` outside `.web.ts` files = error.
  - DOM identifiers (`window`, `document`, `HTMLElement`, `addEventListener`) outside `.web.ts` files OR outside `if (isWeb) { ... }` blocks = error.
  - `Platform.OS === "web"` literal = error (CLAUDE.md says use `isWeb`).
  - `isHovered` used as a sole gate (without `|| isNative` or `|| isCompact`) for visibility = warning that requires explicit override comment.
- **Pre-merge cross-platform smoke**: every PR in `packages/app/` has to attach screenshots from at least three platforms (web Chrome, iOS sim, one of Android/Tauri). Tedious; effective. Reviewer sees the absence.
- **Metro extension shadowing test**: a CI job that lists every `foo.web.ts` and asserts there is no flat `foo.ts` next to it (or vice versa) — prevents shadowing accidents.
- **Playwright e2e runs on multiple viewports**, not just desktop. Already runs in `packages/app/e2e/`; expand to phone/tablet viewports for compact-vs-expanded layout assertions.
- **Specific regression tests for prior CONCERNS**: a snapshot/visual test that the message chevron is visible on a native viewport; a unit test that the resize handle does not import `onPointerEnter`.
- **Audit for `useRef<HTMLElement>` and similar**: any cast to a DOM type in shared code is a red flag — find them in a one-time audit and either move them to `.web.ts` or guard them.
- **The "fourth platform" check.** When evaluating an interaction, ask explicitly: "How does this behave on Tauri? Tauri is web-runtime but desktop-form-factor and exposes `getIsElectron()`-only features." Tauri is the platform that eats the gap between `isWeb` and `isNative`.

**Warning signs:**

- A platform-specific bug is fixed by adding `if (isWeb)`; a week later, an analogous bug is filed by an Android user.
- `.web.ts` and a flat `.ts` of the same module both exist.
- Screenshots in PRs are always from one platform.
- A new component imports from `react-dom`, `react-native`, and `tauri` — three platforms in one file is suspicious.
- `useEffect` adds DOM event listeners without `isWeb`.
- A11y/native audio behavior diverges silently — voice phase looks fine on iOS, broken in subtle ways on Android.

**Phase to address:** Cross-cutting. The lint rules and shadowing-detection job should land **before Phase G (NAT)** — because NAT-03 explicitly fixes pointer-event regressions, and the _same_ category of bug must be prevented going forward. **Phase D (NAV-A3)** fixes the chevron and is a good place to enforce the `isHovered || isNative || isCompact` rule.

**Confidence:** HIGH. The codebase has shipped two of these regressions (C12, H13) already, so the failure mode is empirically real.

---

### Pitfall 9: The `session.ts` carve specifically — pattern that works vs. pattern that creates worse coupling

**What goes wrong:**
This is Pitfall 2's deeper companion. Specific carve antipatterns observed in industry monolith decompositions:

1. **"Topical split" antipattern.** Split by what the code is _about_ (chat, voice, files, permissions). Each new module imports a shared `SessionState` because every action mutates the same subscription set / agent registry / connection map. Cycles form. Net cognitive load: same.
2. **"Big bang" antipattern.** One PR that creates 6 new files and deletes 9000 lines from `session.ts`. Cannot be reviewed; cannot be rolled back; freezes the rest of the milestone for a week.
3. **"Aliasing" antipattern.** New modules just re-export everything `session.ts` already exposed. Files are smaller; calls are unchanged; nothing was actually carved.
4. **"Move code, not state" antipattern.** Functions move into new files but the mutable state stays as module-scope variables in `session.ts`, accessed through getters. The state is still global; the file is just smaller.
5. **"Keep the constructor" antipattern.** `Session` class stays; new "service" classes are just methods that take `Session` as a parameter. Coupling is identical.

**Why it happens:**

- Splitting code by topic feels like the obvious move because that's how humans index it.
- State ownership is harder to redesign than function ownership; the path of least resistance is "leave the state, move the code."
- Without a runtime seam (e.g., a queue, an event bus, a clear ownership boundary), splits stay textual.
- 9,500 lines is too big for one human to hold the dependency graph in their head; the carver underestimates coupling.

**How to avoid (the pattern that works):**

- **Find the seams that already exist at runtime.** `session.ts` per CONCERNS H3 owns: agent subscriptions, terminals, voice, chat, file explorer, permissions. These are NOT all sibling — some are _inputs to the WebSocket fan-out_ and some are _consumers of agent state_. The first carve is "extract the WebSocket multiplex layer," because that is a clean producer-consumer boundary and will reveal which features actually depend on which.
- **Ownership-based carving, not topical.** Each new module owns a piece of state and a set of operations on it; nothing else is allowed to touch that state. Communication between modules is via narrow async APIs or events. If two modules need to share state, that's a sign the boundary is wrong.
- **Strangler-fig in commit-sized increments.** Per [Shopify's strangler-fig guide](https://shopify.engineering/refactoring-legacy-code-strangler-fig-pattern): each step (a) keeps the system green, (b) reduces god-file size, (c) is reviewable as a single PR. If a carve step is "too big to review in one sitting," it's too big.
- **Tests grow with each step.** Carved modules get unit tests where `session.ts` had none. The carve is only valuable if testability improves.
- **Delete the old code path each step.** No "leave the old version in place for safety" — if the new module isn't a drop-in replacement, the carve isn't done.
- **Name the seams in terms of data flow**, not topic: "WebSocketBroker," "AgentSubscriptionRegistry," "PermissionRequestQueue," "TerminalPtyPool," "VoiceRoutingHub." Each name describes what state it _owns_, not what feature it serves.
- **Pattern that worked in industry**: Shopify's strangler-fig case study walks through identifying related variables → extracting them into a smaller class → only allowing modifications via the new class's interface. This is the discipline.

**Warning signs:**

- Carved files importing each other (cycle = wrong boundary).
- Carved files that all import the same `SessionState` module (state didn't actually move).
- Carve PR that doesn't reduce `session.ts`'s line count (re-export aliasing).
- Carve PR with no new tests.
- Two carves landing in the same week with overlapping responsibilities ("we ended up needing the same primitive in both, can we share?").
- After the carve, the next feature still requires editing `session.ts`.

**Phase to address:** **Phase H (ARCH-01)** is the entire pitfall. The phase itself must be sequenced as multiple incremental commits, not a single big-bang.

**Confidence:** HIGH on the principles (strangler-fig + ownership-based carving are well-documented). MEDIUM on which specific seam is best for `session.ts` — that requires the concrete dependency map of the file, which a researcher reading from outside cannot fully derive. The roadmap should sequence "map dependencies → identify first seam → extract → repeat" rather than committing to a specific seam upfront.

---

### Pitfall 10: AI-agent permission UX failure modes

**What goes wrong:**
AGT-05 wants permission requests with full tool-call context and single-tap approve/deny/edit. The classic failure modes shipped in production AI products:

1. **Approval fatigue.** Per Anthropic's published telemetry, users accept 93% of permission prompts in Claude Code; the prompt has stopped serving its purpose and is just friction ([Anthropic on auto mode and permission fatigue](https://www.anthropic.com/engineering/claude-code-auto-mode), [Medium: Claude Code Auto Mode escapes permission fatigue](https://medium.com/@richardhightower/claude-code-auto-mode-escape-permission-fatigue-guide-to-automated-permissions-a122568e1ed6)). A v1.11 release that adds _more_ prompts at the same vigilance level will degrade the same way.
2. **Spam-approval.** Users hit "approve" reflexively; the prompt didn't show the diff, or showed a diff so wall-of-text it couldn't be read on mobile.
3. **Diff-vs-action mismatch.** The diff shown at approval time doesn't match what actually ran — the agent re-decided after the user's eyes left the screen, or the diff was a stale preview, or the action interpolated values from current-state-when-applied rather than current-state-when-approved.
4. **No "approve later from somewhere else."** User approves on phone but the desktop also shows the same prompt and now both are racing.
5. **Notifications without context.** Push notification says "agent needs permission" but tapping it lands in the chat scroll, not on the prompt; user has to find it.
6. **Block on unrelated work.** A permission prompt for tool A blocks tool B from running concurrently — UX feels stuck.
7. **Silent dismissal.** User backgrounds the app; the permission prompt times out; the agent fails; user later sees only "agent error" with no signal that a permission was missed.
8. **Re-approval on resume.** Session resumes; permission was already granted; UI re-asks because it lost the decision in transit (CONCERNS H4 directly enables this for OpenCode).

**Why it happens:**

- Permission UX is the most-touched surface in AI-agent products and the most-dependent on getting trust right.
- Mobile real estate is small; the temptation to show "approve / deny" without context is high.
- Multi-device users hit synchronization edges that desktop-only products don't.
- The permission prompt is _also_ an audit trail; conflating "decision" and "record" forces UX compromises.

**How to avoid (production patterns from Claude Code, Cursor, Copilot Chat):**

- **Two-tier prompts, not one.** Low-risk actions (read a file, run a whitelisted command) auto-approve with a visible audit trail; high-risk actions (write, run arbitrary command, network call to an unknown host) prompt with context. Mirrors Claude Code's [auto mode](https://www.anthropic.com/engineering/claude-code-auto-mode) and Cursor's [per-file-pattern allow rules](https://cursor.com/blog/agent-best-practices). Default conservatively in v1.11; expose user-controlled rules later.
- **The diff is the prompt.** The approval surface IS the diff. No "details" link, no "view diff" expander. The diff is the prompt body; approve/deny are the buttons. Mobile-first design here means: scrollable diff that's always immediately readable.
- **Action freezes at prompt time.** When the agent emits a permission request, the action's exact bytes are captured and shown; approving runs _those exact bytes_, not "what the agent computes when approval comes back." Eliminates diff-vs-action drift.
- **"Edit then approve" as a primitive, not an afterthought.** AGT-05 already says this; bind it: every prompt has approve / deny / edit, and edit pre-fills with the action and lets the user mutate it before sending back.
- **Single source of truth for the prompt across devices.** The permission request is a daemon-side queue; first device to decide wins; other devices pull the decision and dismiss. Not "two devices each holding a copy."
- **Session-scoped allow rules.** "Approve all reads in this session" / "approve all bash commands matching `npm test`" — captures the spam-approval pattern correctly. Auto-expires when session ends. Per Cursor: "file edit approvals now persist for the entire agent session."
- **Push notification deep-link to the prompt.** Tapping the notification opens the prompt screen, not the agent chat scroll. NAV model should treat permission prompts as a top-level destination.
- **Timeout policy is explicit.** A permission prompt that ages out should be visible — agent state shows "blocked on permission since 14:32"; not a silent error.
- **Decision durability.** Once a user has decided, the decision survives daemon restart, app background, network blip. Builds on the agent timeline already being persisted (TIMELINE-01).
- **Audit trail is the timeline.** Approvals/denials appear as timeline events, so the user can scroll back and see exactly what was approved when, with the diff. Trust = "I can audit the agent's history."
- **Trust gradient.** First time the user sees a tool, full prompt with explanation. After N approvals of the same shape, prompt is more compact. Builds on the trust-earning pattern Cursor and Claude Code use.

**Warning signs:**

- Telemetry-equivalent (`daemon.log`) shows >90% approval rate on a prompt class — that prompt class should auto-approve.
- Diff rendering doesn't show on mobile (truncation, wrong font, off-screen).
- Approving on phone doesn't dismiss on desktop within seconds.
- Permission prompts are tested only on web; mobile prompt UI looks broken.
- A permission times out and the user receives a generic "agent error."
- Push notifications open chat instead of the prompt.

**Phase to address:** **Phase B (AGT-05)** owns the prompt. **Phase H** (carve permissions service from `session.ts`) provides the seam needed to add: action-byte capture at prompt time, decision durability, multi-device decision broadcast. **Phase D (NAV-A4)** for command-center entry "approve next pending permission." **Phase G** for haptics on permission events (NAT-02) and notification deep-link.

**Confidence:** HIGH. Permission UX is one of the most thoroughly-postmortemed surfaces in AI-agent tooling; the patterns above are convergent across Claude Code, Cursor, and Copilot Chat.

---

## Technical Debt Patterns

| Shortcut                                                                                  | Immediate Benefit                | Long-term Cost                                                                         | When Acceptable                                                                                |
| ----------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Add `optional()` field without test fixtures for old client shapes                        | Schema change ships in 5 minutes | Old clients silently break in production; regressions found by users                   | Never — even a one-line shape test prevents this                                               |
| Carve a `session.ts` topic by extracting code without extracting state                    | The file got smaller             | Worse coupling; module cycles; carve has to be redone                                  | Never                                                                                          |
| Hardcode a color "just for this component" while theme is mid-migration                   | Ships now                        | Adds another component to the migration backlog; light/dark drift                      | Only if the component is being deleted in the same milestone                                   |
| Show "Sent ✓" optimistically without a "Delivered" follow-up                              | Feels fast                       | Users believe a message was delivered when it wasn't; trust loss                       | Never for side-effect actions; tolerable for typing/echo                                       |
| Add a voice intent that bypasses the action registry                                      | One feature ships                | Parity rot; future intents drift; multi-modality value lost                            | Never if the registry exists                                                                   |
| Use `isHovered` alone as visibility gate                                                  | Cleaner web UX                   | Hidden controls on native (CONCERNS H13)                                               | Never per CLAUDE.md                                                                            |
| Skip cross-platform screenshots in a PR                                                   | PR moves faster                  | Platform regressions ship; the cost is paid by the next user, not the implementer      | Never on app-package PRs                                                                       |
| Defer removal of a deprecated schema field "until next milestone" without writing it down | Ships now                        | Removal schedule never gets honored; shim count grows                                  | Only if the deprecation entry has a concrete `removeAfter` version and is in the schedule file |
| Big-bang rewrite of `session.ts` in one PR                                                | One big commit, "done"           | Unreviewable; can't roll back; freezes parallel phases                                 | Never                                                                                          |
| Auto-approve all permission prompts in a "developer mode" without a visible audit trail   | Removes friction                 | Trust failure; user can't reconstruct what happened                                    | Never without an audit log surfacing in the timeline                                           |
| Prefix all carved files with `session-`                                                   | Looks coherent                   | Topic-based naming reinforces topic-based splitting; ownership-based names are clearer | Never — name modules after the data they own                                                   |

---

## Integration Gotchas

| Integration                                                   | Common Mistake                                                                                    | Correct Approach                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Old mobile app (v1.6–v1.10) ↔ new daemon (v1.11)              | Assume "added optional field = compat"; ship; old client misbehaves on default-value drift        | Run a frozen-fixture parse test using v1.6/v1.9/v1.10 schemas before merge                                                                                                |
| New mobile app ↔ old daemon (user has not updated daemon yet) | Send messages with new fields the old daemon doesn't recognize; old daemon errors on strict parse | Old daemon must passthrough-tolerate unknown fields (validate on ingress with strict=false at field-level for additive changes) — confirm and document this is the policy |
| Tauri desktop running bundled daemon                          | Assume Tauri webview behaves like Chrome desktop                                                  | Test in Tauri specifically — webview has subtle differences (`getIsElectron()` is the gate)                                                                               |
| Voice router → action registry                                | Voice intent handler executes side effects directly                                               | Voice intent maps to action registry id; registry handler executes                                                                                                        |
| Push notification → permission prompt                         | Notification opens chat scroll                                                                    | Deep-link to permission prompt screen via NAV model                                                                                                                       |
| Relay-routed connection ↔ direct LAN connection               | Test only one transport; assume the other works                                                   | Both transports go through the same WS protocol — Playwright e2e against both                                                                                             |
| MCP server tool-call permission                               | MCP request approved on phone; daemon doesn't broadcast decision to desktop                       | Decision is durable on daemon; broadcast to all subscribed clients                                                                                                        |
| OpenCode session resume                                       | `listPersistedAgents` returns `[]` (CONCERNS H4) — silent data loss                               | Implement actual persistence read; fail loudly if storage is missing                                                                                                      |

---

## Performance Traps

| Trap                                                         | Symptoms                                                               | Prevention                                                                                     | When It Breaks                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Timeline grows unbounded (CONCERNS M5) — UI loads everything | Open-session jank; memory grows; native app crashes on large histories | Virtualized rendering + paged backfill; SQLite query with LIMIT, not "load all"                | Past ~1000 events (PROJECT.md target); already broken at higher N    |
| Render whole timeline on every WS event                      | UI thread blocked during streaming agent                               | Memoize per-event nodes; use stable keys; React.memo on event row component                    | Streaming a fast-talking agent (Codex / Claude in plan mode)         |
| Subscribing every screen to every agent stream               | Mobile battery drain; unnecessary re-renders                           | Subscribe at session-context level; selectors push down state per-screen                       | Multi-agent users; manifests on iOS background-fetch budget          |
| Optimistic events accumulate without GC                      | Memory growth across long sessions                                     | Optimistic events removed after ack or timeout; never persisted                                | Long sessions (>1h continuous use)                                   |
| Theme tokens computed inline per render                      | Janky transitions, animation drops                                     | Tokens are constants outside render; theme switch swaps token set, not per-component recompute | When users toggle theme often (more common with formal theme system) |
| Running typecheck/lint during dev hot-reload                 | Slow Metro updates                                                     | Typecheck/lint are CI/local-pre-commit only; not on every file save                            | Always — but exacerbated when many files change in polish phase      |
| WebSocket reconnect storms when daemon restarts              | All clients hammer relay simultaneously                                | Exponential backoff with jitter on client; daemon-side connection cap                          | Many connected clients (multi-device users); during release upgrades |
| BinaryMux frame on a low-bandwidth relay                     | Terminal stutters under network pressure                               | Backpressure: pause PTY reads when WS buffer is high; reflect "agent paused" in UI             | Cellular links to relay                                              |
| Voice pipeline always-on (Silero VAD running)                | Battery drain on idle                                                  | VAD only runs when mic is gated open by user gesture; sleep otherwise                          | Always — voice phase has to handle the idle case                     |

---

## Security Mistakes

These are domain-specific to a local-first AI-agent control plane. General web security is out of scope here.

| Mistake                                                                                 | Risk                                                      | Prevention                                                                                                                  |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| ARCH-03: leaving local daemon auth as-is for non-loopback connections (CONCERNS H2)     | Any local process / LAN peer can hijack agents            | Loopback-only by default; opt-in token for non-loopback; documented in SECURITY.md                                          |
| Adding a new daemon endpoint without checking origin/auth                               | New endpoint bypasses ARCH-03                             | Endpoint registration goes through a single auth-aware factory; lint that direct `wss.on()` is forbidden                    |
| Logging tool-call payloads (file diffs, command bodies) in plaintext to `daemon.log`    | Sensitive code in plaintext on disk                       | Log truncation by default; full payload only at debug log level; no PII patterns checked into logs                          |
| Voice transcript stored unencrypted in timeline                                         | User's spoken intent persisted in plaintext               | Treat voice transcripts as sensitive timeline events; honor existing storage encryption posture                             |
| Push notification content exposes prompt body                                           | Notification preview leaks command/diff                   | Notification content = "agent X needs approval"; details revealed only after authentication into the app                    |
| MCP server exposed locally with no authentication                                       | Any local process can drive sub-agents                    | Same auth posture as the WebSocket API (ARCH-03)                                                                            |
| Backward-compat shim accepts unsigned/unauthenticated message variant for "old clients" | Auth bypass via legacy field                              | Auth applies to all variants; no "legacy mode" that drops auth                                                              |
| Relay replay window not enforced (CONCERNS H1)                                          | Compromised relay can replay messages within session      | Documented as deferred to a security milestone; do not regress while polishing                                              |
| Tauri bridge surface gains a new command without explicit allowlist                     | Web bundle can call native APIs the user didn't authorize | Tauri allowlist is exhaustively reviewed each milestone; new bridge commands require security note                          |
| Pairing QR code leaks via screenshot/zoom-share                                         | One-time key compromised                                  | Code rotation; pair UX shows "rotate" affordance and a lifetime; exists in current flow but verify ONB-03 doesn't weaken it |

---

## UX Pitfalls

| Pitfall                                                     | User Impact                                                                      | Better Approach                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| First-run pair-scan failure with no recovery path           | User stuck on splash; reinstall app                                              | ONB-03: regenerate code, manual key entry, switch to local daemon — without restarting app    |
| Sidebar collapse loses workspace context on mobile          | User taps to switch workspace, returns lost                                      | NAV-A2: collapse preserves context; reopening returns to same view                            |
| Permission prompt has no diff context, only "approve/deny"  | Spam-approval / fatigue / loss of trust                                          | AGT-05: full diff IS the prompt; edit-then-approve as primitive                               |
| Empty state with no guidance                                | User opens app, sees nothing, doesn't know what to do                            | THM-03: empty states share visual language with explicit next-action affordance               |
| Daemon offline shown only as a small dot                    | User types prompts that vanish                                                   | NAT-05: offline-recovery prompt; disable side-effect-optimistic UI                            |
| Voice trigger conflicts with system gesture                 | Random voice activation; users disable voice                                     | Distinct activation gesture; visible affordance; safe to dismiss                              |
| Settings reorganization changes labels users have memorized | Power users frustrated                                                           | SET-01: keep search; provide "what moved where" callout once on first launch after the change |
| Bilingual parity slips — new strings only in en.json        | zh users see English fallback strings; "the app feels unfinished in my language" | Build-time check that every visible string has both en + zh keys                              |
| Long-press menu actions diverge from command-center actions | Users learn one path; the other doesn't work the same way                        | NAT-01: parity test; both paths derive from action registry                                   |
| Push notification silently dismissed when app foregrounded  | User misses permission; agent fails                                              | In-app notification banner mirrors push state; persistent until decided                       |

---

## "Looks Done But Isn't" Checklist

Things that appear shipped but are missing critical pieces specific to this milestone:

- [ ] **Theme system formalized:** Often missing migration of older components — verify hardcoded-color count went down, not just that `theme.ts` exists.
- [ ] **`session.ts` carved:** Often missing actual ownership change — verify modules don't share a state object and don't import each other in cycles.
- [ ] **Optimistic UI for AGT-04:** Often missing the rollback path — verify what happens when the daemon never responds within timeout.
- [ ] **Schema field added compatibly:** Often missing test fixtures for older client shapes — verify v1.10 / v1.9 / v1.8 still parse new daemon output.
- [ ] **Permission prompt with diff (AGT-05):** Often missing on mobile (truncation) — verify diff is fully readable on a phone-sized viewport.
- [ ] **Hover-only fix (NAV-A3):** Often missing the audit — verify zero remaining `isHovered`-only gates in `packages/app/src/components/`.
- [ ] **Pointer-event fix (NAT-03):** Often missing the lint rule — verify ESLint/oxlint blocks `onPointerEnter` outside `.web.ts` files.
- [ ] **Command center as universal action surface (NAV-A4):** Often missing parity tests — verify each registry action is reachable from at least 2 modalities.
- [ ] **Action registry (Phase B):** Often missing voice integration — verify voice intent handlers are pure mappers to registry ids, not direct executors.
- [ ] **OpenCode session recovery (SES-02):** Often missing real persistence — verify `listPersistedAgents` returns actual persisted agents, not an empty array.
- [ ] **`chromeEnabled` split (SET-02):** Often missing migration of stored user prefs — verify users with `chromeEnabled=false` get the right combination of new flags.
- [ ] **Backward-compat shim (Phase H):** Often missing removal schedule — verify every `@deprecated` has `removeAfter=vX.Y`.
- [ ] **Bilingual strings (everywhere):** Often missing zh entries — verify CI fails when en has a key zh doesn't.
- [ ] **Daemon connection state (NAT-05):** Often missing version-mismatch case — verify the dot reflects amber/red when daemon-version < app-version-min, not just on connect failure.
- [ ] **Carve commit:** Often missing line-count reduction in `session.ts` — verify the file shrunk by >X% per commit.
- [ ] **Cross-platform PR:** Often missing screenshots from non-implementer's platform — verify PR has iOS + Android + web shots when touching `packages/app/src/components/`.
- [ ] **Action freezes at prompt time (AGT-05):** Often missing — verify approving runs the bytes shown at prompt time, not what the agent computes after approval.
- [ ] **Multi-device permission decision (AGT-05):** Often missing — verify approving on phone dismisses prompt on desktop and vice versa.

---

## Recovery Strategies

| Pitfall                                            | Recovery Cost                        | Recovery Steps                                                                                                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Polish became redesign (Pitfall 1)                 | MEDIUM                               | Pause; re-establish per-phase Done lines; carve out the redesign work into a separate future milestone; ship the original polish scope first                                                                                     |
| Carve created worse coupling (Pitfall 2, 9)        | HIGH                                 | Don't undo — extend: identify the shared state, push it into one of the modules as owner, narrow others' access. Worst case, revert the carve commit and redo with ownership-based seams                                         |
| Old client broken by schema change (Pitfall 3)     | HIGH if shipped, LOW if caught in CI | Daemon-side hotfix: revert the schema change or add a transform that emits the old shape for clients reporting old version. Add the missing frozen-fixture test                                                                  |
| Action registry parity rot (Pitfall 4)             | MEDIUM                               | Audit registry → identify gaps → build the parity test → fix gaps over a phase boundary. Cheap to recover early; expensive to recover after habits form                                                                          |
| Theme migration stalled (Pitfall 5)                | MEDIUM                               | Make the lint rule strict; declare a freeze on new components until backlog drains; or accept the intermediate state explicitly with documented exceptions                                                                       |
| Optimistic UI lied to user (Pitfall 6)             | HIGH (trust loss)                    | Hotfix: introduce explicit "pending/delivered" distinction; add timeout-error toast; communicate to users via release notes that "we found and fixed cases where the UI showed actions as completed before the daemon confirmed" |
| Shim count exploded (Pitfall 7)                    | MEDIUM                               | Pick the top-N shims by usage counter (≈0); remove them in a maintenance batch; institute the cap going forward                                                                                                                  |
| Cross-platform regression shipped (Pitfall 8)      | MEDIUM-HIGH                          | Hotfix the platform; add the lint rule that would have caught it; add the regression-specific test; run an audit pass for analogous patterns                                                                                     |
| Permission UX caused approval fatigue (Pitfall 10) | HIGH                                 | Introduce per-tool auto-approve rules with a clear audit trail; ship a "compact approval" mode for well-known tool shapes; do NOT default to "skip permissions" — preserve trust by making the safe path easy                    |

---

## Pitfall-to-Phase Mapping

This is the consumer-facing summary the roadmapper attaches to phases. Phases are by section in PROJECT.md (A onboarding, B agent invocation, C session, D nav, E settings, F theme, G native-feel, H architecture).

| Pitfall                                          | Primary Prevention Phase      | Secondary Phases                                                   | Verification                                                                                        |
| ------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **1. Polish-to-redesign trap**                   | Cross-cutting (every phase)   | Esp. F (theme), D (nav), E (settings)                              | Per-phase Done line is measurable; PR diff size matches scope                                       |
| **2. Parallel-phase contention on `session.ts`** | H (ARCH-01) — sequenced first | B, C, E, G consume carved modules                                  | `session.ts` line count shrinks per carve commit; no two PRs editing it concurrently                |
| **3. Schema deprecation breaks old clients**     | H (ARCH-02)                   | All schema-touching phases                                         | Frozen-fixture parse tests run in CI; three-way matrix tests pass                                   |
| **4. Voice/command/keyboard parity rot**         | B (AGT-01, action registry)   | D (NAV-A4), G (NAT-01)                                             | Parity test asserts every registry action reachable from ≥N modalities                              |
| **5. Theme retrofit stalls**                     | F (THM-01..04)                | All UI-touching phases bound by lint rule                          | Hardcoded-color count in CI trends down; light/dark visual parity audit                             |
| **6. Optimistic UI lies**                        | B (AGT-04, AGT-05)            | G (NAT-05 — connection state)                                      | Tests cover "daemon never responds" path; pending vs delivered visually distinct                    |
| **7. Backward-compat shim accumulation**         | H (ARCH-02)                   | All schema-touching phases                                         | Every `@deprecated` has `removeAfter=`; shim count capped; ≥1 removal per milestone                 |
| **8. Cross-platform regression blind spots**     | Cross-cutting                 | Esp. G (NAT-03 fix), D (NAV-A3 fix)                                | Lint rules enforced; PR screenshots from ≥3 platforms; regression-specific tests                    |
| **9. `session.ts` carve creates worse coupling** | H (ARCH-01)                   | —                                                                  | Carved files don't import in cycles; no shared SessionState module; new modules tested in isolation |
| **10. Permission UX failure modes**              | B (AGT-05)                    | H (permission service carve), D (NAV-A4 entry), G (NAT-02 haptics) | Diff readable on phone; approve-on-one-device dismisses elsewhere; action freezes at prompt time    |

---

## Sources

Real industry references for the patterns cited above:

- [Anthropic — Claude Code Auto Mode: a safer way to skip permissions](https://www.anthropic.com/engineering/claude-code-auto-mode) — empirical 93% approval rate; auto-mode pattern.
- [Claude Code Auto Mode: Escape Permission Fatigue (Medium)](https://medium.com/@richardhightower/claude-code-auto-mode-escape-permission-fatigue-guide-to-automated-permissions-a122568e1ed6) — fatigue pattern.
- [Cursor — Best practices for coding with agents](https://cursor.com/blog/agent-best-practices) — read-the-diff discipline; per-file-pattern allow rules.
- [Cursor changelog — file edit approvals persist for the entire agent session](https://cursor.com/changelog/2-4) — session-scoped allow rules.
- [Choose a permission mode — Claude Code Docs](https://code.claude.com/docs/en/permission-modes) — plan/default/full-access pattern Ottie already exposes.
- [Plan Mode — Armin Ronacher / lucumr](https://lucumr.pocoo.org/2025/12/17/what-is-plan-mode/) — plan-vs-execute separation.
- [How to build a remarkable command palette — Superhuman](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/) — registry-driven command palette.
- [Designing Retool's Command Palette](https://retool.com/blog/designing-the-command-palette) — registry pattern, parity discipline.
- [Command Palette: Past, present, and future (command.ai)](https://www.command.ai/blog/command-palette-past-present-and-future/) — Cmd+K convergence; multi-modality parity.
- [Refactoring Legacy Code with the Strangler Fig Pattern — Shopify Engineering](https://shopify.engineering/refactoring-legacy-code-strangler-fig-pattern) — incremental carving discipline.
- [Strangler Fig Pattern — Microsoft Learn](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig) — canonical pattern reference.
- [The Distributed Monolith Trap — Three Dots Labs](https://threedots.tech/episode/the-distributed-monolith-trap/) — topical-split antipattern, shared-state failure mode.
- [We Split Our Monolith Into 47 Microservices. It Made Everything Worse.](https://medium.com/engineering-playbook/we-split-our-monolith-into-47-microservices-it-made-everything-worse-faa930a9411d) — big-bang carve antipattern.
- [Polaris v11 Tokens — Shopify](https://polaris-react.shopify.com/previous-releases/version-11-tokens) — design-token retrofit on a shipped product; alias vs palette tokens.
- [Polaris Migrator — Shopify](https://polaris-react.shopify.com/tools/polaris-migrator) — automated migration tool; the existence of the tool is itself the lesson (manual migration doesn't finish).
- [GitHub Primer Migration Guides](https://primer.style/guides/rails/migration-guides/) — multi-version migration of design system on a shipped product.
- [Optimistic UI rollback failure — Frontend Lab](https://frontendddlab.vercel.app/optimistic-ui-rollback-failure) — out-of-order response divergence.
- [How to Implement Event Versioning Strategies — OneUptime](https://oneuptime.com/blog/post/2026-01-30-event-driven-versioning-strategies/view) — events outlive code; versioning discipline.
- [Zod release notes / metadata](https://zod.dev/v4) — `.optional()`, `.transform()`, deprecated metadata field.
- [Slack — rtm.start to stop changelog](https://docs.slack.dev/changelog/2021-10-rtm-start-to-stop/) — long deprecation window for a real-time API; example of disciplined removal schedule.

**Internal sources:**

- `/Users/a123456/Downloads/ottie-workspace/ottie/.planning/PROJECT.md` — milestone scope, success criteria, constraints, key decisions.
- `/Users/a123456/Downloads/ottie-workspace/ottie/.planning/codebase/CONCERNS.md` — H2, H3, H4, H7, C11, C12, H13, M5 — concrete failure-mode evidence already in the codebase.
- `/Users/a123456/Downloads/ottie-workspace/ottie/.planning/codebase/ARCHITECTURE.md` — agent lifecycle, WebSocket protocol, session-context layer, MCP permission flow.
- `/Users/a123456/Downloads/ottie-workspace/ottie/.planning/codebase/CONVENTIONS.md` — TypeScript hygiene; platform-gating rules; schema compatibility rules.
- `/Users/a123456/Downloads/ottie-workspace/ottie/.planning/codebase/TESTING.md` — Playwright e2e infra, vitest pool layout, real-dependencies-over-mocks discipline.
- `/Users/a123456/Downloads/ottie-workspace/ottie/CLAUDE.md` — schema backward-compat rules, platform-gating mandatory practice.

---

_Pitfalls research for: Ottie v1.11 — User Flow Polish (mobile-first AI-agent control surface)_
_Researched: 2026-04-29_
