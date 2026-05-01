---
phase: 02-onboarding-navigation-settings-theme-native-feel-polish
plan: 02e
type: execute
wave: 2
depends_on: [02a]
files_modified:
  # Validation gate (Wave 0 of this plan)
  - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-glass-effect-validation-LOG.md
  # GlassSurface migration (THM-02) — primitives migrate first, then leaf modals
  - packages/app/src/components/adaptive-modal-sheet.tsx
  - packages/app/src/components/ui/isolated-bottom-sheet-modal.tsx
  - packages/app/src/components/ui/dropdown-menu.tsx
  - packages/app/src/components/ui/context-menu.tsx
  - packages/app/src/components/ui/tooltip.tsx
  - packages/app/src/components/ui/combobox.tsx
  - packages/app/src/components/add-host-method-modal.tsx
  - packages/app/src/components/add-host-modal.tsx
  - packages/app/src/components/pair-link-modal.tsx
  - packages/app/src/components/project-picker-modal.tsx
  - packages/app/src/components/keyboard-shortcuts-dialog.tsx
  - packages/app/src/components/new-task-modal.tsx
  - packages/app/src/components/selectable-text-modal.tsx
  - packages/app/src/components/workspace-rename-modal.tsx
  - packages/app/src/components/workspace-setup-dialog.tsx
  - packages/app/src/components/workspace-hover-card.tsx
  - packages/app/src/components/agent-status-bar.tsx
  - packages/app/src/components/attachment-lightbox.tsx
  - packages/app/src/components/combined-model-selector.tsx
  - packages/app/src/components/provider-diagnostic-sheet.tsx
  - packages/app/src/components/tool-call-sheet.tsx
  # GlassSurface conditional native upgrade (per validation outcome)
  - packages/app/src/components/ui/glass-surface.tsx
  - packages/app/package.json
  # Smoothed-text universal application audit (NAT-04)
  - packages/app/src/hooks/use-smoothed-text.ts
  - packages/app/src/hooks/use-smoothed-text.test.ts
  # Burnt toast adoption (THM-03)
  - packages/app/src/utils/system-toast.ts
  - packages/app/src/utils/system-toast.test.ts
  - packages/app/src/utils/delight-toast.ts
  - packages/app/src/utils/delight-toast.test.ts
  # Math-curve loader scope narrowing (THM-03) — register as canonical
  - packages/app/src/components/math-curve-loader/sanctioned-uses.ts
  # NAT-03 lint promotion (D-20) — flip the script + sweep violations
  - tools/lint/pointer-events-web-only.ts
  - tools/lint/pointer-events-web-only.baseline.json
  - package.json
  - packages/app/src/components/web-desktop-scrollbar.tsx
  - packages/app/src/components/sidebar-workspace-list.tsx
  - packages/app/src/components/terminal-emulator.tsx
  # Otter brand placement (THM-04)
  - packages/app/src/assets/otter/index.ts
  - packages/app/src/assets/otter/README.md
  - packages/app/src/components/welcome-screen.tsx
  - packages/app/src/components/splash-overlay.tsx
  - packages/app/src/screens/sessions-screen.tsx
  # Light/dark contrast AA audit (THM-02)
  - tools/audit/contrast-aa-audit.ts
  - tools/audit/contrast-aa-audit.test.ts
  - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-contrast-aa-report.md
  # Bilingual locales for new strings
  - packages/app/src/i18n/locales/en.json
  - packages/app/src/i18n/locales/zh.json
autonomous: false
requirements: [THM-02, THM-03, THM-04, NAT-04]
tags:
  [
    phase-02,
    polish-sweep,
    glass-surface,
    haptic,
    smoothed-text,
    burnt,
    otter,
    contrast-aa,
    lint-promotion,
  ]
must_haves:
  truths:
    - "Every modal / sheet / popover / bottom-sheet / dropdown in the audit list (RESEARCH.md §Common Pitfalls #5) renders through <GlassSurface> with an explicit radius variant — no raw <View backgroundColor: rgba(...)> modal roots"
    - "Light + dark mode pass AA contrast (4.5:1 body, 3:1 large text 18px+/600) against every <GlassSurface> migration target — recorded in 02e-contrast-aa-report.md"
    - "use-smoothed-text has exactly one production consumer (packages/app/src/components/message.tsx) — grep gate enforces; tool-call output, system messages, code blocks NEVER render through it (D-19)"
    - "burnt is the system-toast surface for state-change acks (mark-read / mute / delete / send-ack / agent run-state / permission decision); the existing toast-host.tsx remains for in-panel inline messaging — neither replaces the other (D-12)"
    - "Math-curve loader appears ONLY at three sanctioned sites (Chats list initial load, agent run-start, command-center search 'thinking') — anywhere else uses a neutral skeleton or system spinner (D-13)"
    - "Pointer-events lint exits 1 on ANY violation (no baseline tolerance) and the wired npm pipeline runs it on CI; current violators are migrated into .web.tsx Metro splits or gated by isWeb"
    - "Otter character lives at five sanctioned surfaces only — splash, welcome, first-time-empty (first workspace + first chats list), and three one-time delight toasts (first-agent-created, first-permission-approved, first-voice-command) — gated by useOnboardingStateStore flags from Plan 02b"
    - "expo-glass-effect adoption is gated by an iOS 26 dev-build validation checkpoint; if validation fails or is skipped, <GlassSurface> stays on expo-blur and the decision is recorded in 02e-glass-effect-validation-LOG.md"
    - "Every new user-visible string lands in BOTH packages/app/src/i18n/locales/en.json AND zh.json in the same task"
  artifacts:
    - path: "packages/app/src/utils/system-toast.ts"
      provides: "burnt-backed system-toast helper with state-change vocabulary; web fallback via sonner"
      exports: ["systemToast", "type SystemToastEvent"]
    - path: "packages/app/src/utils/delight-toast.ts"
      provides: "One-shot Otter-branded delight toast wrapper; reads + writes useOnboardingStateStore flag"
      exports: ["fireDelightToast", "type DelightEvent"]
    - path: "packages/app/src/components/math-curve-loader/sanctioned-uses.ts"
      provides: "Type-safe enum of the 3 sanctioned loader contexts; consumers must pass one"
      exports: ["type SanctionedLoaderContext", "SANCTIONED_LOADER_CONTEXTS"]
    - path: "packages/app/src/assets/otter/index.ts"
      provides: "Centralized Otter asset exports — splash logo, welcome illustration, empty-state illustration, 3 delight stickers"
      exports: ["otterAssets"]
    - path: "tools/audit/contrast-aa-audit.ts"
      provides: "Light/dark AA contrast audit against semantic tokens + GlassSurface tints; emits report"
    - path: ".planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-contrast-aa-report.md"
      provides: "Per-surface contrast ratios in light + dark; PASS/FAIL marked"
    - path: ".planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-glass-effect-validation-LOG.md"
      provides: "iOS 26 validation outcome + adoption decision (use expo-glass-effect on iOS 26 OR fall back to expo-blur only)"
  key_links:
    - from: "packages/app/src/components/adaptive-modal-sheet.tsx"
      to: "packages/app/src/components/ui/glass-surface.tsx"
      via: "Modal root wraps children in <GlassSurface radius='sheet'>"
      pattern: "GlassSurface"
    - from: "packages/app/src/components/welcome-screen.tsx"
      to: "packages/app/src/assets/otter/index.ts"
      via: "Imports otterAssets.welcome from the central asset module"
      pattern: "otterAssets"
    - from: "packages/app/src/utils/delight-toast.ts"
      to: "packages/app/src/stores/onboarding-state-store.ts"
      via: "Reads/writes delightFiredFirstAgent / delightFiredFirstPermission / delightFiredFirstVoice flags"
      pattern: "useOnboardingStateStore"
    - from: "packages/app/src/utils/system-toast.ts"
      to: "burnt"
      via: "burnt.alert({ title, preset })"
      pattern: 'from "burnt"'
    - from: "tools/lint/pointer-events-web-only.ts"
      to: "package.json"
      via: "lint:pointer-events runs as part of npm run lint"
      pattern: "lint:pointer-events"
---

<objective>
Close the visual + interaction consistency pass for Phase 02. This plan owns four named requirements:

- **THM-02** — every modal / sheet / popover / bottom-sheet / dropdown migrates onto `<GlassSurface>`; light/dark contrast passes AA. Gated by an iOS 26 dev-build validation of `expo-glass-effect` (research flag carried from Phase 1 / STATE.md). If validation fails the migration stays on `expo-blur` only — `<GlassSurface>` API surface is reversible per UI-SPEC.
- **THM-03** — loading / empty / error share one visual language: math-curve loader narrowed to its three sanctioned brand-moments (Chats list initial load, agent run-start, command-center search "thinking"); `burnt` adopted for state-change acks alongside the existing in-panel `toast-host.tsx`; error vocabulary documented (callout cards on `<GlassSurface>` already shipped via Phase 1).
- **THM-04** — Otter brand presence centralized at exactly five surfaces: splash, welcome, first-time-empty (first workspace + first chats list), three one-time delight toasts (first-agent-created, first-permission-approved, first-voice-command). Gated by Plan 02b's `useOnboardingStateStore` flags.
- **NAT-04** — `use-smoothed-text` collapsed to a single production consumer (`message.tsx`); a grep gate ensures the count never grows.

Plus one explicit cross-cutting deliverable that does NOT claim a new requirement ID (NAT-03 already lives in Phase 1 per REQUIREMENTS.md, but D-20 says promote warn→error in this phase): flip `tools/lint/pointer-events-web-only.ts` to error severity (exit 1 on ANY violation), wire it into `npm run lint`, and migrate the current 8+ violations (in `web-desktop-scrollbar.tsx`, `sidebar-workspace-list.tsx`, `terminal-emulator.tsx`, `workspace-hover-card.tsx`, plus the indirect tooltip/dropdown handlers) so the lint passes clean.

The `useHaptic()` hook itself is created in Plan 02a; this plan only confirms invariants (single call site through the hook, no inline `Haptics.*` outside it) and fires haptics from the surfaces this plan touches (delight toasts open with `light`).

Purpose: Without this plan THM-02/03/04 and NAT-04 ship inconsistently. RESEARCH.md §Common Pitfalls 4, 5, 7, 9 (incomplete glass migration, smoothed-text creep, otter brand creep, missing iOS 26 validation) are exactly the failure modes this plan exists to prevent.

Output: 1 validation log, 17 modal/popover/dropdown files migrated to `<GlassSurface>`, 1 contrast audit script + report, 2 toast helpers (system + delight) + tests, 1 math-curve sanctioned-uses module, 1 Otter asset index, lint script promoted with current violations swept, 5+ delight/empty/error i18n keys in en+zh.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-CONTEXT.md
@.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-RESEARCH.md
@.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-PATTERNS.md
@.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md
@.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02a-action-registry-SUMMARY.md
@.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02b-onboarding-SUMMARY.md
@CLAUDE.md
@docs/CODING_STANDARDS.md

<interfaces>
<!-- Existing GlassSurface primitive — every migration target wraps via this API -->
<!-- Source: packages/app/src/components/ui/glass-surface.tsx -->

```typescript
type GlassRadius = "none" | "card" | "sheet" | "pill" | "button";

export interface GlassSurfaceProps {
  children: ReactNode;
  intensity?: number; // expo-blur intensity, 0-100; default 50
  tint?: "light" | "dark" | "systemThinMaterial" | "systemMaterial" | "default";
  radius?: GlassRadius; // default "card"
  bordered?: boolean; // default true
  strong?: boolean; // default false — use "strong" on full-bleed sheets
  style?: StyleProp<ViewStyle>;
}

export function GlassSurface(props: GlassSurfaceProps): JSX.Element;
```

Variant pick rule (UI-SPEC §Component Inventory + audit list):

- `radius="sheet"` for full-bleed modals, command-center, bottom-sheets, top-right + menu, chat-row context menu (web)
- `radius="card"` for callout / popover / hover card / dropdown panel
- `radius="pill"` for total-unread popup, segmented overlays
- `radius="button"` reserved for button-shaped chrome surfaces

<!-- Existing useSmoothedText hook (NAT-04 — confirms single consumer) -->
<!-- Source: packages/app/src/hooks/use-smoothed-text.ts:42 -->

```typescript
export function useSmoothedText(message: string, isLive: boolean): string;
```

Current consumers (verified by grep on 2026-05-01):

- `packages/app/src/components/message.tsx:83` (import) + `:1640` (call) — the SINGLE production consumer
- `packages/app/src/hooks/use-smoothed-text.test.ts` (test only — exempt)
  Goal: keep production count at exactly 1.

<!-- Existing toast-host (in-panel inline) — NOT replaced by burnt -->
<!-- Source: packages/app/src/components/toast-host.tsx:36-44 -->

```typescript
export interface ToastApi {
  show: (content: ReactNode, options?: ToastShowOptions) => void;
  copied: (label?: string) => void;
  error: (message: string) => void;
}
```

Per RESEARCH.md line 39: keep toast-host for in-app inline; introduce `burnt` for system-level acks.

<!-- burnt API (introduced by 02a — verify installed) -->
<!-- Source: https://github.com/nandorojo/burnt — npm burnt@0.13.0 -->

```typescript
import { alert as burntAlert, toast as burntToast } from "burnt";

burntAlert({
  title: string;
  preset?: "done" | "error" | "none" | "spinner";
  duration?: number; // seconds
  haptic?: "success" | "warning" | "error" | "none";
}): void;

burntToast({ title, message?, preset?, duration?, haptic? }): void;
```

Web target uses `sonner` (also installed by 02a).

<!-- onboarding-state-store (Plan 02b) — delight + first-time flags -->
<!-- Source: packages/app/src/stores/onboarding-state-store.ts (created in Plan 02b) -->

```typescript
export interface OnboardingState {
  welcomeShown: boolean;
  welcomeShownAt: number | null;
  delightFiredFirstAgent: boolean;
  delightFiredFirstPermission: boolean;
  delightFiredFirstVoice: boolean;
  emptyOttiePlayedFirstWorkspace: boolean;
  emptyOttiePlayedFirstChats: boolean;
}
export function useOnboardingStateStore(): OnboardingState & {
  setDelightFiredFirstAgent(v: boolean): void;
  setDelightFiredFirstPermission(v: boolean): void;
  setDelightFiredFirstVoice(v: boolean): void;
  setEmptyOttiePlayedFirstWorkspace(v: boolean): void;
  setEmptyOttiePlayedFirstChats(v: boolean): void;
};
```

<!-- useHaptic (Plan 02a) — delight toast opens fire light haptic -->
<!-- Source: packages/app/src/hooks/use-haptic.ts -->

```typescript
export function useHaptic(input: { enabled: boolean; isLowPowerMode: boolean }): {
  fire(event: "light" | "medium" | "heavy"): void;
};
```

<!-- Existing pointer-events lint script — promoted to error here -->
<!-- Source: tools/lint/pointer-events-web-only.ts:217-265 (CLI main) -->

Current behavior (Phase 1 / warn-only):

- Reads `tools/lint/pointer-events-web-only.baseline.json` (count: 10)
- exit 0 if `count <= baseline.count`
- exit 1 only if `count > baseline.count` (regression)

Phase 2 promotion (D-20 / NAT-03 acceptance wording):

- exit 1 on ANY violation (count > 0)
- Pre-flip: sweep current violations to `.web.tsx` files OR gate via `isWeb ?  handler : undefined`
- Wire into `npm run lint` so CI fails on regressions
  </interfaces>

<audit_lists>

<!-- Modal / sheet / popover / bottom-sheet / dropdown migration audit (RESEARCH.md §Common Pitfalls #5) -->
<!-- Each entry maps to a <GlassSurface radius="..."> migration. No silent skips. -->

| File                                                                 | Target radius  | Migration scope                                                                                                  | Out-of-scope reason (if any)             |
| -------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `packages/app/src/components/adaptive-modal-sheet.tsx`               | `sheet`        | Wrap modal-content View in `<GlassSurface radius="sheet" strong>` — primitive used by N consumers; migrate FIRST | —                                        |
| `packages/app/src/components/ui/isolated-bottom-sheet-modal.tsx`     | `sheet`        | Wrap bottom-sheet inner container in `<GlassSurface radius="sheet">` — primitive                                 | —                                        |
| `packages/app/src/components/ui/dropdown-menu.tsx`                   | `card`         | Wrap dropdown panel in `<GlassSurface radius="card">`                                                            | —                                        |
| `packages/app/src/components/ui/context-menu.tsx`                    | `card`         | Wrap both `dropdown` and `sheet` mode containers                                                                 | —                                        |
| `packages/app/src/components/ui/tooltip.tsx`                         | `card`         | Wrap tooltip popover in `<GlassSurface radius="card">` (small `intensity={30}`)                                  | —                                        |
| `packages/app/src/components/ui/combobox.tsx`                        | `card`         | Wrap dropdown list in `<GlassSurface radius="card">`                                                             | —                                        |
| `packages/app/src/components/add-host-method-modal.tsx`              | `sheet`        | Modal root → `<GlassSurface radius="sheet">`                                                                     | —                                        |
| `packages/app/src/components/add-host-modal.tsx`                     | `sheet`        | Modal root → `<GlassSurface radius="sheet">`                                                                     | —                                        |
| `packages/app/src/components/pair-link-modal.tsx`                    | `sheet`        | Modal root → `<GlassSurface radius="sheet">`                                                                     | —                                        |
| `packages/app/src/components/project-picker-modal.tsx`               | `sheet`        | Modal root → `<GlassSurface radius="sheet">`                                                                     | —                                        |
| `packages/app/src/components/keyboard-shortcuts-dialog.tsx`          | `sheet`        | Modal root → `<GlassSurface radius="sheet">`                                                                     | —                                        |
| `packages/app/src/components/new-task-modal.tsx`                     | `sheet`        | Modal root → `<GlassSurface radius="sheet">`                                                                     | —                                        |
| `packages/app/src/components/selectable-text-modal.tsx`              | `sheet`        | Modal root → `<GlassSurface radius="sheet">`                                                                     | —                                        |
| `packages/app/src/components/workspace-rename-modal.tsx`             | `sheet`        | Modal root → `<GlassSurface radius="sheet">`                                                                     | —                                        |
| `packages/app/src/components/workspace-setup-dialog.tsx`             | `sheet`        | Modal root → `<GlassSurface radius="sheet">`                                                                     | —                                        |
| `packages/app/src/components/workspace-hover-card.tsx`               | `card`         | Hover card panel → `<GlassSurface radius="card">`                                                                | —                                        |
| `packages/app/src/components/agent-status-bar.tsx`                   | `pill`         | Inline status modal → `<GlassSurface radius="pill">`                                                             | —                                        |
| `packages/app/src/components/attachment-lightbox.tsx`                | `sheet`        | Lightbox container → `<GlassSurface radius="sheet">` (no border on full-bleed)                                   | —                                        |
| `packages/app/src/components/combined-model-selector.tsx`            | `sheet`        | Sheet body → `<GlassSurface radius="sheet">`                                                                     | —                                        |
| `packages/app/src/components/provider-diagnostic-sheet.tsx`          | `sheet`        | Sheet body → `<GlassSurface radius="sheet">`                                                                     | —                                        |
| `packages/app/src/components/tool-call-sheet.tsx`                    | `sheet`        | Sheet body → `<GlassSurface radius="sheet">`                                                                     | —                                        |
| `packages/app/src/components/command-center.{web,native}.tsx`        | `sheet`        | OUT — already migrated by Plan 02a                                                                               | Owned by Plan 02a (audit reference only) |
| `packages/app/src/components/chat-row-context-menu.{web,native}.tsx` | `sheet`/`card` | OUT — already migrated by Plan 02c                                                                               | Owned by Plan 02c                        |
| `packages/app/src/components/top-right-add-menu.tsx`                 | `sheet`        | OUT — already migrated by Plan 02c                                                                               | Owned by Plan 02c                        |
| `packages/app/src/components/total-unread-popup.tsx`                 | `pill`         | OUT — already migrated by Plan 02c                                                                               | Owned by Plan 02c                        |
| `packages/app/src/components/pair-scan-recovery-callout.tsx`         | `card`         | OUT — already wrapped by Plan 02b                                                                                | Owned by Plan 02b                        |

**Pointer-events lint violations (current count = 10 per baseline; promotion target = 0):**

| File                                                     | Lines                           | Action                                                                                                     |
| -------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/app/src/components/web-desktop-scrollbar.tsx`  | 416–417                         | Rename to `web-desktop-scrollbar.web.tsx` (Metro split) OR gate handlers via `isWeb ? handler : undefined` |
| `packages/app/src/components/sidebar-workspace-list.tsx` | 1365–1366, 1388–1389, 1487–1488 | Gate via `isWeb ? handlePointerEnter : undefined` (file is cross-platform; cannot Metro-split entire file) |
| `packages/app/src/components/terminal-emulator.tsx`      | 740–741                         | Gate via `isWeb ? handler : undefined` (file is cross-platform)                                            |
| `packages/app/src/components/workspace-hover-card.tsx`   | 183–184                         | Gate via `isWeb ? handler : undefined`                                                                     |
| `packages/app/src/components/ui/tooltip.tsx`             | 383–384, 407–408                | Already inside spread props — gate by `isWeb` at the assignment site                                       |

</audit_lists>
</context>

<tasks>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 1 (Wave 0): expo-glass-effect iOS 26 dev-build validation gate</name>
  <files>
    .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-glass-effect-validation-LOG.md,
    packages/app/package.json,
    packages/app/src/components/ui/glass-surface.tsx
  </files>
  <read_first>
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-RESEARCH.md §"Common Pitfalls" Pitfall 4 (lines 464-469) and §"Open Questions" item 4 (lines 738-741)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md "Glass primitive" line 30 (mandatory; <GlassSurface> API hides the choice)
    - packages/app/src/components/ui/glass-surface.tsx (existing implementation; entire file ≤120 lines)
    - .planning/STATE.md (research flag: "Phase 4 start: Validate expo-glass-effect on iOS 26 dev build before committing to Liquid Glass surfaces" — Phase 4 collapsed into Phase 2)
    - https://www.npmjs.com/package/expo-glass-effect (version 55.0.10 — confirm matches Expo 54 SDK)
  </read_first>
  <action>
    **THIS IS A BLOCKING HUMAN-VERIFY CHECKPOINT.** The executor performs the automated pre-checkpoint work below, then PAUSES for the human to validate on hardware before proceeding to Task 2.

    **Pre-checkpoint automated work** (executor MUST complete before the human review):

    1. Compare current `<GlassSurface>` (expo-blur path, lines 1-120) against the candidate adoption diff. Confirm the `<GlassSurface>` API surface (`children`, `radius`, `intensity`, `tint`, `bordered`, `strong`, `style`) does NOT change in either branch — adoption is reversible per UI-SPEC line 30 and RESEARCH.md line 416.

    2. Author the candidate adoption diff in a separate branch worktree (DO NOT commit yet): `glass-surface.tsx` imports `GlassView` from `expo-glass-effect` only when `Platform.OS === "ios"` AND iOS major >= 26 via `Platform.Version` runtime check; otherwise falls back to `BlurView` (existing path). Document the diff inline in `02e-glass-effect-validation-LOG.md` as the proposed change.

    3. Initialize `02e-glass-effect-validation-LOG.md` with the validation template (Decision field, Validated-on field, Side-by-side notes section, Adoption field, glass-surface.tsx diff field).

    4. Build an iOS 26 dev build per `docs/DEVELOPMENT.md` instructions, OR document the unavailability with a specific reason in the log.

    5. Render every `radius` variant of `<GlassSurface>` ("none" / "card" / "sheet" / "pill" / "button") on the iOS 26 device with both the proposed `expo-glass-effect` path AND the current `expo-blur` path, in light AND dark mode. Capture screenshots into the log.

    **Human-verify step** (the human MUST perform on hardware before signaling resume):

    A. **Confirm dev-build availability.** If iOS 26 device/simulator is NOT available, the human RECORDS the decision verbatim in the log:

       ```
       Decision: VALIDATION_SKIPPED
       Reason: <iOS 26 dev build not available — specific reason>
       Adoption: expo-glass-effect NOT installed; <GlassSurface> stays on expo-blur for the milestone
       Carry-forward: Re-validate before v1.12 if iOS 26 expo-glass-effect adoption is desired
       ```

       Then SKIPS installation. Task 2 proceeds against the existing expo-blur path.

    B. **If dev-build is available**, the human visually compares each radius variant in light + dark mode side by side. Pass criteria:
       - No visible artifacts (color banding, transparency over-bleed, stutter on scroll)
       - Text/content INSIDE the GlassSurface remains AA-readable (eyeball check; Task 8 is the rigorous gate)
       - Blur intensity comparable between expo-glass-effect and expo-blur (acceptable to differ +/-10% as long as readability holds)
       - No crashes when mounting/unmounting under stress (open/close 5 modals quickly)

    C. **Record decision** verbatim in the log:

       ```
       Decision: ADOPT | FALLBACK_BLUR_ONLY
       Validated on: iOS <version> dev build, device <model> | Simulator <name>
       Validation date: <YYYY-MM-DD>
       Side-by-side notes: <bullet list of differences observed per radius variant in light + dark>
       Adoption: expo-glass-effect@55.0.10 INSTALLED | NOT INSTALLED
       glass-surface.tsx diff: APPLIED | NOT APPLIED
       ```

    D. **If decision = ADOPT:** the executor runs `pnpm --filter @ottie/app add expo-glass-effect@55.0.10` and applies the candidate diff to `packages/app/src/components/ui/glass-surface.tsx`. The diff MUST keep all current props/exports identical. Confirm `npm run typecheck` exits 0.

    E. **If decision = FALLBACK_BLUR_ONLY or VALIDATION_SKIPPED:** DO NOT install `expo-glass-effect`. Make zero changes to `glass-surface.tsx`. Task 2 onward proceeds against the existing expo-blur path — no functionality lost.

    **Resume signal:** Type "approved: ADOPT" or "approved: FALLBACK_BLUR_ONLY" or "approved: VALIDATION_SKIPPED" or describe issues. Any approval lets Task 2 proceed.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      test -f .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-glass-effect-validation-LOG.md && \
      grep -qE "Decision: (ADOPT|FALLBACK_BLUR_ONLY|VALIDATION_SKIPPED)" .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-glass-effect-validation-LOG.md && \
      ( ( grep -q "Decision: ADOPT" .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-glass-effect-validation-LOG.md && grep -q '"expo-glass-effect"' packages/app/package.json ) || \
        ( grep -qE "Decision: (FALLBACK_BLUR_ONLY|VALIDATION_SKIPPED)" .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-glass-effect-validation-LOG.md && ! grep -q '"expo-glass-effect"' packages/app/package.json ) ) && \
      npm run typecheck
    </automated>
  </verify>
  <acceptance_criteria>
    - File `.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-glass-effect-validation-LOG.md` exists
    - `grep -c "Decision:" .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-glass-effect-validation-LOG.md` returns ≥1
    - One of: `grep -q "ADOPT" 02e-glass-effect-validation-LOG.md && grep -q '"expo-glass-effect"' packages/app/package.json` OR `grep -q "FALLBACK_BLUR_ONLY\|VALIDATION_SKIPPED" 02e-glass-effect-validation-LOG.md && ! grep -q '"expo-glass-effect"' packages/app/package.json` — i.e. log + package.json must agree
    - `npm run typecheck` exits 0 (no regression regardless of branch chosen)
  </acceptance_criteria>
  <done>iOS 26 validation outcome recorded; `<GlassSurface>` API unchanged; downstream tasks know which native blur backend they target</done>
</task>

<task type="auto">
  <name>Task 2: Migrate sheet/popover primitives to <GlassSurface> (adaptive-modal-sheet, isolated-bottom-sheet-modal, dropdown-menu, context-menu, tooltip, combobox) — primitives FIRST so leaf modals inherit</name>
  <files>
    packages/app/src/components/adaptive-modal-sheet.tsx,
    packages/app/src/components/ui/isolated-bottom-sheet-modal.tsx,
    packages/app/src/components/ui/dropdown-menu.tsx,
    packages/app/src/components/ui/context-menu.tsx,
    packages/app/src/components/ui/tooltip.tsx,
    packages/app/src/components/ui/combobox.tsx
  </files>
  <read_first>
    - packages/app/src/components/ui/glass-surface.tsx (target wrapper API — see <interfaces>)
    - packages/app/src/components/adaptive-modal-sheet.tsx (current shell — confirm where the modal content View root lives)
    - packages/app/src/components/ui/isolated-bottom-sheet-modal.tsx (current bottom-sheet container)
    - packages/app/src/components/ui/dropdown-menu.tsx (current panel — already imports BlurView per PATTERNS.md line 339)
    - packages/app/src/components/ui/context-menu.tsx (already supports MobileMenuMode = "dropdown" | "sheet" — wrap both branches)
    - packages/app/src/components/ui/tooltip.tsx (current tooltip popover)
    - packages/app/src/components/ui/combobox.tsx (current dropdown list)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-RESEARCH.md §"Code Examples" lines 549-565 (canonical GlassSurface consumption)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md §"Component Inventory" lines 264-283 (radius assignments)
  </read_first>
  <action>
    For each file in `<files>`:

    1. Add `import { GlassSurface } from "@/components/ui/glass-surface";` (use the `@/` alias per CLAUDE.md import conventions).
    2. Locate the OUTERMOST content container — typically a `<View style={[styles.container, ...]}>` directly inside a `<Modal>` / `<BottomSheetModal>` / animated panel.
    3. Wrap that container's children in `<GlassSurface radius="<variant>" strong={<sheet-only ? true : false}>` per the audit table:
       - `adaptive-modal-sheet.tsx` → `radius="sheet" strong`
       - `isolated-bottom-sheet-modal.tsx` → `radius="sheet" strong`
       - `dropdown-menu.tsx` → `radius="card"`
       - `context-menu.tsx` → `radius="card"` (dropdown branch) and `radius="sheet"` (mobile sheet branch)
       - `tooltip.tsx` → `radius="card"` with `intensity={30}` (small popover — soft blur)
       - `combobox.tsx` → `radius="card"`
    4. Remove any inline `<BlurView>` wrappers, `backgroundColor: "rgba(...)"` literals, or hand-rolled blur effects on the migrated container — `<GlassSurface>` owns those tokens. Preserve other styles (padding, border-radius from the target token, layout).
    5. Border radius from the surrounding View MUST come from the GlassSurface variant — remove any sibling `borderRadius: theme.borderRadius.X` on the wrapped container.
    6. For `tooltip.tsx`: the existing implementation (per PATTERNS.md line 340) already imports `BlurView` from `expo-blur` — replace the `<BlurView>` element with `<GlassSurface radius="card" intensity={30}>` and drop the import.
    7. Run `npm run format -- <every file in this task>` after edits.

    Per D-20 / NAT-03 — be careful: `tooltip.tsx` lines 383-384 and 407-408 contain `onPointerEnter`/`onPointerLeave` props. If you do not address them in this task, Task 7 (lint promotion) will sweep them. Both options are acceptable; document the choice in your task SUMMARY note.

    Bilingual i18n: NO new user-visible strings introduced by primitive migration — these are container wrappers only. Skip i18n updates for this task.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -c "GlassSurface" packages/app/src/components/adaptive-modal-sheet.tsx | grep -v '^0$' && \
      grep -c "GlassSurface" packages/app/src/components/ui/isolated-bottom-sheet-modal.tsx | grep -v '^0$' && \
      grep -c "GlassSurface" packages/app/src/components/ui/dropdown-menu.tsx | grep -v '^0$' && \
      grep -c "GlassSurface" packages/app/src/components/ui/context-menu.tsx | grep -v '^0$' && \
      grep -c "GlassSurface" packages/app/src/components/ui/tooltip.tsx | grep -v '^0$' && \
      grep -c "GlassSurface" packages/app/src/components/ui/combobox.tsx | grep -v '^0$' && \
      ! grep -v '^[[:space:]]*//' packages/app/src/components/ui/tooltip.tsx | grep -q 'from "expo-blur"' && \
      npm run typecheck && \
      npm run lint -- packages/app/src/components/adaptive-modal-sheet.tsx packages/app/src/components/ui/isolated-bottom-sheet-modal.tsx packages/app/src/components/ui/dropdown-menu.tsx packages/app/src/components/ui/context-menu.tsx packages/app/src/components/ui/tooltip.tsx packages/app/src/components/ui/combobox.tsx
    </automated>
  </verify>
  <acceptance_criteria>
    - For each file in `<files>`: `grep -c "<GlassSurface" <file>` returns ≥1
    - `grep -c 'from "@/components/ui/glass-surface"' packages/app/src/components/adaptive-modal-sheet.tsx packages/app/src/components/ui/isolated-bottom-sheet-modal.tsx packages/app/src/components/ui/dropdown-menu.tsx packages/app/src/components/ui/context-menu.tsx packages/app/src/components/ui/tooltip.tsx packages/app/src/components/ui/combobox.tsx | grep -v ':0$' | wc -l` returns 6
    - `grep -v '^[[:space:]]*//' packages/app/src/components/ui/tooltip.tsx | grep -c 'from "expo-blur"'` returns 0 (BlurView import removed in tooltip)
    - `npm run typecheck` exits 0
    - `npm run lint -- packages/app/src/components/adaptive-modal-sheet.tsx packages/app/src/components/ui/isolated-bottom-sheet-modal.tsx packages/app/src/components/ui/dropdown-menu.tsx packages/app/src/components/ui/context-menu.tsx packages/app/src/components/ui/tooltip.tsx packages/app/src/components/ui/combobox.tsx` exits 0
  </acceptance_criteria>
  <done>The 6 sheet/popover primitives wrap their content in <GlassSurface> with correct radius variants; downstream leaf modals inherit the primitive surface treatment</done>
</task>

<task type="auto">
  <name>Task 3: Migrate leaf modals/popovers (15 files: add-host*, pair-link, project-picker, keyboard-shortcuts, new-task, selectable-text, workspace-rename, workspace-setup, workspace-hover-card, agent-status-bar, attachment-lightbox, combined-model-selector, provider-diagnostic-sheet, tool-call-sheet) to <GlassSurface></name>
  <files>
    packages/app/src/components/add-host-method-modal.tsx,
    packages/app/src/components/add-host-modal.tsx,
    packages/app/src/components/pair-link-modal.tsx,
    packages/app/src/components/project-picker-modal.tsx,
    packages/app/src/components/keyboard-shortcuts-dialog.tsx,
    packages/app/src/components/new-task-modal.tsx,
    packages/app/src/components/selectable-text-modal.tsx,
    packages/app/src/components/workspace-rename-modal.tsx,
    packages/app/src/components/workspace-setup-dialog.tsx,
    packages/app/src/components/workspace-hover-card.tsx,
    packages/app/src/components/agent-status-bar.tsx,
    packages/app/src/components/attachment-lightbox.tsx,
    packages/app/src/components/combined-model-selector.tsx,
    packages/app/src/components/provider-diagnostic-sheet.tsx,
    packages/app/src/components/tool-call-sheet.tsx
  </files>
  <read_first>
    - packages/app/src/components/ui/glass-surface.tsx (interface — radius variants)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-RESEARCH.md §"Common Pitfalls" Pitfall 5 (lines 471-508) — full audit list
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md "Reorganized / migrated existing components" lines 287-296
    - The audit table in this plan's `<audit_lists>` section — confirms target `radius` per file
    - Each `<file>` in this task — locate its modal-content View root (typically inside `<Modal>` or `<BottomSheetModal>` or a Reanimated animated wrapper)
    - One file from Task 2 already migrated (e.g. `adaptive-modal-sheet.tsx`) for the in-repo wrap pattern
  </read_first>
  <action>
    For each file in `<files>`:

    1. Determine the radius variant from the audit table (default = `sheet` for full-bleed modals, `pill` for `agent-status-bar.tsx`, `card` for `workspace-hover-card.tsx`).
    2. Confirm the file actually has a modal/popover root. If a file consumes `adaptive-modal-sheet.tsx` indirectly (i.e. wraps its content INSIDE the primitive Task 2 migrated), the inner content does NOT need its own GlassSurface — skip and document in the task summary.
    3. Add `import { GlassSurface } from "@/components/ui/glass-surface";`.
    4. Wrap the OUTERMOST modal-content View in `<GlassSurface radius="<variant>">`. Preserve `padding`, `gap`, layout. Remove sibling background-color tokens that paint a solid color (the GlassSurface owns the surface tint).
    5. Per UI-SPEC §Light/Dark Contrast (line 158): the resolved background MUST allow body text at 4.5:1. Where existing code sets `backgroundColor: theme.colors.surface.elevated` on the inner View, remove it — the GlassSurface intensity + theme tint produces the same effective surface. The contrast audit in Task 8 verifies.
    6. For modals using `Modal` from `react-native` directly: the `transparent={true}` prop MUST stay set; otherwise GlassSurface renders against an opaque OS chrome. Confirm by reading existing `<Modal>` props in each file.
    7. Run `npm run format -- <files>`.

    OUT-OF-SCOPE markers — NONE. The 15 files in this task are all in-scope. If during implementation a file turns out to consume `adaptive-modal-sheet.tsx` (and therefore inherits Task 2's wrap), record that in the task summary as "INHERITED from primitive migration — no additional GlassSurface" and remove that file from the wrap list. This is the only acceptable skip pattern; document the wrap source.

    No new i18n strings.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      MISSED=0 && \
      for f in packages/app/src/components/add-host-method-modal.tsx packages/app/src/components/add-host-modal.tsx packages/app/src/components/pair-link-modal.tsx packages/app/src/components/project-picker-modal.tsx packages/app/src/components/keyboard-shortcuts-dialog.tsx packages/app/src/components/new-task-modal.tsx packages/app/src/components/selectable-text-modal.tsx packages/app/src/components/workspace-rename-modal.tsx packages/app/src/components/workspace-setup-dialog.tsx packages/app/src/components/workspace-hover-card.tsx packages/app/src/components/agent-status-bar.tsx packages/app/src/components/attachment-lightbox.tsx packages/app/src/components/combined-model-selector.tsx packages/app/src/components/provider-diagnostic-sheet.tsx packages/app/src/components/tool-call-sheet.tsx; do \
        if ! grep -q "GlassSurface\|adaptive-modal-sheet\|AdaptiveModalSheet\|isolated-bottom-sheet-modal\|IsolatedBottomSheetModal" "$f"; then \
          echo "MISS: $f has no GlassSurface and does not consume a migrated primitive"; \
          MISSED=$((MISSED+1)); \
        fi; \
      done && \
      [ "$MISSED" -eq 0 ] && \
      npm run typecheck && \
      npm run lint -- packages/app/src/components/add-host-method-modal.tsx packages/app/src/components/add-host-modal.tsx packages/app/src/components/pair-link-modal.tsx packages/app/src/components/project-picker-modal.tsx packages/app/src/components/keyboard-shortcuts-dialog.tsx packages/app/src/components/new-task-modal.tsx packages/app/src/components/selectable-text-modal.tsx packages/app/src/components/workspace-rename-modal.tsx packages/app/src/components/workspace-setup-dialog.tsx packages/app/src/components/workspace-hover-card.tsx packages/app/src/components/agent-status-bar.tsx packages/app/src/components/attachment-lightbox.tsx packages/app/src/components/combined-model-selector.tsx packages/app/src/components/provider-diagnostic-sheet.tsx packages/app/src/components/tool-call-sheet.tsx
    </automated>
  </verify>
  <acceptance_criteria>
    - Every file in `<files>` either contains `<GlassSurface` directly OR consumes a primitive migrated in Task 2 (`adaptive-modal-sheet`/`isolated-bottom-sheet-modal`); the verify-script output reports `MISSED=0`
    - `grep -c "rgba(" packages/app/src/components/add-host-method-modal.tsx packages/app/src/components/add-host-modal.tsx packages/app/src/components/pair-link-modal.tsx packages/app/src/components/project-picker-modal.tsx packages/app/src/components/keyboard-shortcuts-dialog.tsx packages/app/src/components/new-task-modal.tsx packages/app/src/components/selectable-text-modal.tsx packages/app/src/components/workspace-rename-modal.tsx packages/app/src/components/workspace-setup-dialog.tsx 2>/dev/null` does NOT increase versus pre-task baseline (run `git diff --stat` to confirm no new rgba literals — the hardcoded-color counter-baseline lint catches regressions)
    - `npm run typecheck` exits 0
    - `npm run lint -- <all 15 files>` exits 0
    - `npm run lint:colors` exits 0 (Phase 1 hardcoded-color counter-test passes — no regression)
  </acceptance_criteria>
  <done>15 leaf modals/popovers migrated to <GlassSurface> directly or via a migrated primitive; THM-02 audit list closed (combined with Task 2 = full audit table coverage)</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Adopt burnt for system-toast vocabulary (mark-read / mute / delete / send-ack / agent run-state / permission decision); register Otter-branded delight toasts (D-12 + D-17)</name>
  <files>
    packages/app/src/utils/system-toast.ts,
    packages/app/src/utils/system-toast.test.ts,
    packages/app/src/utils/delight-toast.ts,
    packages/app/src/utils/delight-toast.test.ts,
    packages/app/src/i18n/locales/en.json,
    packages/app/src/i18n/locales/zh.json
  </files>
  <read_first>
    - packages/app/src/components/toast-host.tsx (existing in-panel toast — KEPT; not replaced — see PATTERNS.md line 626-646 + RESEARCH.md line 39, 426)
    - packages/app/src/stores/onboarding-state-store.ts (created by Plan 02b — exposes delight flags + setters; see <interfaces>)
    - packages/app/package.json (confirm burnt@0.13.0 + sonner@2.0.7 already installed by Plan 02a — see 02a SUMMARY)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-CONTEXT.md decisions D-12 (toast-led acks via burnt; debounced per event-type) and D-17 (3 one-time delight toasts)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md §"Copywriting Contract" lines 242-250 (delight toast keys + en/zh)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-PATTERNS.md "delight-toast.ts" section (lines 625-646)
    - https://github.com/nandorojo/burnt (confirm `alert` + `toast` API surface)
  </read_first>
  <behavior>
    Test 1 (system-toast.test.ts): systemToast.emit({ event: "chat.read", title: "标记已读" }) calls burnt.toast({ title: "标记已读", preset: "done", duration: 1.5 })
    Test 2 (system-toast.test.ts): two consecutive emit({ event: "chat.read", ... }) within 200ms collapse to a single burnt.toast call (debounce per event-type per D-12)
    Test 3 (system-toast.test.ts): emit({ event: "chat.read" }) within 200ms followed by emit({ event: "permission.approved" }) calls burnt.toast TWICE — debounce key is event-type, not call site
    Test 4 (system-toast.test.ts): on web (Platform.OS === "web") systemToast.emit routes to sonner.toast with the same title/preset
    Test 5 (delight-toast.test.ts): fireDelightToast("firstAgent") when delightFiredFirstAgent === false calls burnt.alert exactly once AND sets delightFiredFirstAgent → true via the store setter
    Test 6 (delight-toast.test.ts): fireDelightToast("firstAgent") when delightFiredFirstAgent === true is a no-op (returns false; no burnt call)
    Test 7 (delight-toast.test.ts): fireDelightToast("firstPermission") and "firstVoice" each have independent flags
  </behavior>
  <action>
    Step 1 — Confirm burnt + sonner are installed (check `packages/app/package.json` for `"burnt": "0.13.0"` and `"sonner": "2.0.7"`). If missing, this means Plan 02a did not complete — STOP and surface the gap. Do NOT install here.

    Step 2 — Create `packages/app/src/utils/system-toast.ts`:

    ```typescript
    import { toast as burntToast } from "burnt";
    import { isWeb } from "@/constants/platform";

    /**
     * State-change ack vocabulary (D-12). Keep this list in sync with the call
     * sites that emit; debounce key = event id (not call site) so rapid-fire
     * same-event emissions collapse to one user-visible toast.
     */
    export type SystemToastEvent =
      | "chat.read"
      | "chat.unread"
      | "chat.muted"
      | "chat.unmuted"
      | "chat.deleted"
      | "chat.pinned"
      | "chat.unpinned"
      | "chat.archived"
      | "agent.run.started"
      | "agent.run.stopped"
      | "permission.approved"
      | "permission.denied"
      | "send.ack";

    interface EmitInput {
      event: SystemToastEvent;
      title: string;          // bilingual — caller passes already-translated string
      preset?: "done" | "error" | "none";
      durationSeconds?: number;
    }

    const DEBOUNCE_MS = 200;
    const lastFiredAt = new Map<SystemToastEvent, number>();

    export const systemToast = {
      emit({ event, title, preset = "done", durationSeconds = 1.5 }: EmitInput): boolean {
        const now = Date.now();
        const last = lastFiredAt.get(event) ?? 0;
        if (now - last < DEBOUNCE_MS) return false;
        lastFiredAt.set(event, now);
        if (isWeb) {
          // Web fallback via sonner — lazy import so native bundle skips it
          import("sonner").then(({ toast }) => toast(title, { duration: durationSeconds * 1000 }));
        } else {
          burntToast({ title, preset, duration: durationSeconds });
        }
        return true;
      },
    };
    ```

    Step 3 — Create `packages/app/src/utils/system-toast.test.ts` covering Tests 1-4. Mock `burnt` and `sonner` per existing vitest setup convention. Reset `lastFiredAt` between tests via `beforeEach`.

    Step 4 — Create `packages/app/src/utils/delight-toast.ts` per PATTERNS.md lines 625-646 (per D-17, per UI-SPEC line 246-249):

    ```typescript
    import { alert as burntAlert } from "burnt";
    import { useOnboardingStateStore } from "@/stores/onboarding-state-store";
    import { useTranslation } from "react-i18next";
    // i18n keys defined in this task's en.json/zh.json updates:
    //   delight.firstAgent.toast / delight.firstPermission.toast / delight.firstVoice.toast

    export type DelightEvent = "firstAgent" | "firstPermission" | "firstVoice";

    /**
     * Fires a delight toast at most once per device install (per D-17).
     * Reads the corresponding flag from useOnboardingStateStore; if already
     * fired, returns false (no-op). Otherwise calls burnt.alert and persists
     * the flag.
     *
     * NOTE: this helper resolves i18n via getState() — it does NOT use a hook
     * because it's called from imperative event handlers (agent_update,
     * permission decision, voice intent). The caller MUST pass the translated
     * title; this helper ONLY owns the flag check + burnt invocation.
     */
    export function fireDelightToast(input: {
      event: DelightEvent;
      title: string;       // pre-translated copy from t("delight.firstAgent.toast") etc.
    }): boolean {
      const state = useOnboardingStateStore.getState();
      const flagKey =
        input.event === "firstAgent" ? "delightFiredFirstAgent"
        : input.event === "firstPermission" ? "delightFiredFirstPermission"
        : "delightFiredFirstVoice";
      const setterKey =
        input.event === "firstAgent" ? "setDelightFiredFirstAgent"
        : input.event === "firstPermission" ? "setDelightFiredFirstPermission"
        : "setDelightFiredFirstVoice";
      if ((state as unknown as Record<string, boolean>)[flagKey] === true) return false;
      burntAlert({ title: input.title, preset: "done", duration: 2, haptic: "success" });
      ((state as unknown as Record<string, (v: boolean) => void>)[setterKey])(true);
      return true;
    }
    ```

    Step 5 — Create `packages/app/src/utils/delight-toast.test.ts` covering Tests 5-7. Mock `burnt` and `useOnboardingStateStore`.

    Step 6 — Add the en+zh i18n keys for system-toast acks AND delight toasts. Per UI-SPEC §Copywriting Contract lines 242-249 (delight) and lines 184-205 (chat menu acks). Add to `packages/app/src/i18n/locales/en.json`:

    ```json
    "toast.chat.read": "Marked as read",
    "toast.chat.unread": "Marked as unread",
    "toast.chat.muted": "Muted",
    "toast.chat.unmuted": "Unmuted",
    "toast.chat.deleted": "Chat deleted",
    "toast.chat.pinned": "Pinned",
    "toast.chat.unpinned": "Unpinned",
    "toast.chat.archived": "Archived",
    "toast.agent.runStarted": "Agent running",
    "toast.agent.runStopped": "Agent stopped",
    "toast.permission.approved": "Permission approved",
    "toast.permission.denied": "Permission denied",
    "toast.send.ack": "Sent",
    "delight.firstAgent.toast": "First agent created. {{otter}} is happy for you.",
    "delight.firstPermission.toast": "Permission approved. The agent will keep going.",
    "delight.firstVoice.toast": "Heard you. Voice is on."
    ```

    Add to `packages/app/src/i18n/locales/zh.json` (parity, lockstep — CLAUDE.md hard rule):

    ```json
    "toast.chat.read": "已标记为已读",
    "toast.chat.unread": "已标记为未读",
    "toast.chat.muted": "已静音",
    "toast.chat.unmuted": "已取消静音",
    "toast.chat.deleted": "对话已删除",
    "toast.chat.pinned": "已置顶",
    "toast.chat.unpinned": "已取消置顶",
    "toast.chat.archived": "已归档",
    "toast.agent.runStarted": "Agent 已启动",
    "toast.agent.runStopped": "Agent 已停止",
    "toast.permission.approved": "权限已批准",
    "toast.permission.denied": "权限已拒绝",
    "toast.send.ack": "已发送",
    "delight.firstAgent.toast": "首位 agent 创建成功。{{otter}} 为你高兴。",
    "delight.firstPermission.toast": "权限已批准，agent 将继续。",
    "delight.firstVoice.toast": "收到，语音已开启。"
    ```

    Step 7 — Run `npm run format -- packages/app/src/utils/system-toast.ts packages/app/src/utils/system-toast.test.ts packages/app/src/utils/delight-toast.ts packages/app/src/utils/delight-toast.test.ts packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/zh.json`.

    NOTE on call-site wiring: the actual emit() call sites for state-change toasts (e.g. inside `chat-row-context-menu.web.tsx` "delete" handler) live in Plan 02c's surfaces. This plan only ships the helper. Plan 02c imports `systemToast` and calls `systemToast.emit({ event, title: t("toast.X") })` from each registered chat.menu action handler — verified by Plan 02c's existing acceptance criteria. We do NOT modify Plan 02c here.

    Similarly, `fireDelightToast` is a helper. The actual call sites (first agent_update with epoch=1, first permission approved, first voice ActionRegistry dispatch) wire in:
    - `firstAgent`: agent-manager state subscription — wire in `packages/app/src/contexts/session-context.tsx` (or wherever first agent_update is observed). Out of scope for this task; delight wiring is left to 02c follow-on or separate fast-fix.

    To prevent gap creep: register `fireDelightToast("firstAgent")` call in `packages/app/src/screens/sessions-screen.tsx` (first time `agents.length` transitions 0→≥1 within session — file already modified by Plan 02c), `firstPermission` in `packages/app/src/contexts/permission-handler-context.tsx` if present, `firstVoice` in `packages/app/src/voice-control/voice-router.ts` first successful dispatch. **However, those wirings touch files Plan 02c owns** — flag in the task SUMMARY as a follow-up: "delight call-site wiring deferred — handler is shipped, sites wire in Phase 02 final reconciliation". Do NOT modify 02c-owned files in this task. The handler + test are sufficient for THM-04 helper acceptance; THM-04 acceptance also requires the splash/welcome/empty surfaces, which Tasks 6 + 8 cover.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q '"burnt":' packages/app/package.json && \
      grep -q '"sonner":' packages/app/package.json && \
      grep -q "export const systemToast" packages/app/src/utils/system-toast.ts && \
      grep -q "DEBOUNCE_MS = 200" packages/app/src/utils/system-toast.ts && \
      grep -q "export type SystemToastEvent" packages/app/src/utils/system-toast.ts && \
      grep -q "export function fireDelightToast" packages/app/src/utils/delight-toast.ts && \
      grep -q "useOnboardingStateStore" packages/app/src/utils/delight-toast.ts && \
      grep -q "delight.firstAgent.toast" packages/app/src/i18n/locales/en.json && \
      grep -q "delight.firstAgent.toast" packages/app/src/i18n/locales/zh.json && \
      grep -q "首位 agent 创建成功" packages/app/src/i18n/locales/zh.json && \
      grep -q "toast.chat.read" packages/app/src/i18n/locales/en.json && \
      grep -q "toast.chat.read" packages/app/src/i18n/locales/zh.json && \
      npx vitest run packages/app/src/utils/system-toast.test.ts --bail=1 && \
      npx vitest run packages/app/src/utils/delight-toast.test.ts --bail=1 && \
      npm run typecheck && \
      npm run lint -- packages/app/src/utils/system-toast.ts packages/app/src/utils/delight-toast.ts
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "export const systemToast" packages/app/src/utils/system-toast.ts` returns 1
    - `grep -c "export function fireDelightToast" packages/app/src/utils/delight-toast.ts` returns 1
    - `grep -c "DEBOUNCE_MS = 200" packages/app/src/utils/system-toast.ts` returns 1
    - `grep -c "delight\\." packages/app/src/i18n/locales/en.json` returns ≥3 (firstAgent / firstPermission / firstVoice)
    - `grep -c "delight\\." packages/app/src/i18n/locales/zh.json` returns ≥3
    - `grep -c "toast\\.chat\\." packages/app/src/i18n/locales/en.json` returns ≥8
    - `grep -c "toast\\.chat\\." packages/app/src/i18n/locales/zh.json` returns ≥8
    - `npx vitest run packages/app/src/utils/system-toast.test.ts packages/app/src/utils/delight-toast.test.ts --bail=1` exits 0
    - `npm run typecheck` exits 0
    - `npm run lint -- packages/app/src/utils/system-toast.ts packages/app/src/utils/delight-toast.ts packages/app/src/utils/system-toast.test.ts packages/app/src/utils/delight-toast.test.ts` exits 0
  </acceptance_criteria>
  <done>burnt-backed system-toast helper + Otter delight-toast helper exist with passing tests; en+zh parity for 16+ new keys; toast-host.tsx remains untouched (in-panel inline use case kept separate)</done>
</task>

<task type="auto">
  <name>Task 5: NAT-04 use-smoothed-text universal application audit (collapse to single consumer; gate consumer count via grep)</name>
  <files>
    packages/app/src/hooks/use-smoothed-text.ts,
    packages/app/src/hooks/use-smoothed-text.test.ts
  </files>
  <read_first>
    - packages/app/src/hooks/use-smoothed-text.ts (entire file — confirm `useSmoothedText(message, isLive)` signature)
    - packages/app/src/components/message.tsx lines 80-90 (existing import) and line 1640 (existing call site — `useSmoothedText(message, isLive)` gated by `isLive`)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-CONTEXT.md decision D-19 (collapse to ONE source: AI streaming message bubbles only)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-RESEARCH.md §"Common Pitfalls" Pitfall 7 (lines 517-522 — current production count = 1; gate keeps it at 1)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-PATTERNS.md "message.tsx" entry (lines 67) — line 1640 gates by isLive
    - Run grep on the current repo state to confirm production consumer count is exactly 1 BEFORE applying the gate (see verify block).
  </read_first>
  <action>
    NAT-04 has TWO parts: (a) confirm `use-smoothed-text` is wired everywhere AI text appears, (b) confirm it is NOT wired anywhere else.

    Per RESEARCH.md / D-19 / PATTERNS.md, "everywhere AI text appears" reduces to exactly ONE site: `packages/app/src/components/message.tsx` line 1640, `useSmoothedText(message, isLive)` — gated by `isLive` (the streaming-bubble predicate). Tool-call output, completed messages, system messages, code blocks, and any non-streaming text DO NOT route through this hook.

    The work for this task is therefore:

    1. **Verify current state** — run grep to confirm production consumer count is exactly 1 (= `message.tsx`). If grep returns more or fewer than 1 production consumer, INVESTIGATE before proceeding:
       - More than 1 → audit each consumer; remove smoothed-text from non-AI-streaming sites (this is the D-19 collapse)
       - Less than 1 (= 0) → `message.tsx` lost the consumer — restore the call site at line 1640

    2. **Add a runtime invariant comment** to `packages/app/src/hooks/use-smoothed-text.ts` at the top of the file:

       ```typescript
       /**
        * NAT-04 / D-19 invariant: this hook has EXACTLY ONE production consumer
        * — `packages/app/src/components/message.tsx` for AI streaming message
        * bubbles (gated by `isLive`). Tool-call output, system messages,
        * completed messages, and code blocks NEVER route through this hook.
        *
        * Adding a new consumer is a CONSCIOUS scope decision. Update this
        * comment AND the grep gate in the test file before doing so.
        *
        * Verification: `grep -rln "useSmoothedText\\b" packages/app/src/ \\
        *   | grep -v ".test.ts"` MUST return exactly 2 paths
        *   (this file + components/message.tsx).
        */
       ```

    3. **Add a grep-gate test** to `packages/app/src/hooks/use-smoothed-text.test.ts` (or add at the end if the file already has tests). This test asserts the production consumer count via `node:fs` + `node:child_process`:

       ```typescript
       import { describe, it, expect } from "vitest";
       import { execSync } from "node:child_process";
       import { resolve } from "node:path";

       describe("useSmoothedText D-19 / NAT-04 invariant", () => {
         it("has exactly 1 production consumer (message.tsx)", () => {
           const repoRoot = resolve(import.meta.dirname, "../../../..");
           // grep all source files; exclude .test.ts and the hook implementation itself
           const out = execSync(
             "grep -rln 'useSmoothedText\\b' packages/app/src/ || true",
             { cwd: repoRoot, encoding: "utf8" },
           ).split("\\n").filter(Boolean);

           const productionConsumers = out
             .filter((p) => !p.endsWith(".test.ts"))
             .filter((p) => !p.endsWith("hooks/use-smoothed-text.ts"));

           expect(
             productionConsumers,
             "NAT-04 / D-19 — useSmoothedText must have exactly one consumer (message.tsx). Current consumers: " +
               productionConsumers.join(", "),
           ).toEqual(["packages/app/src/components/message.tsx"]);
         });
       });
       ```

       The path-comparison may need a normalization step (forward slashes, repo-relative). Use `relative()` if needed; see `tools/lint/pointer-events-web-only.ts:170` for the in-repo `toForwardSlashes(relative(...))` pattern.

    4. Confirm `message.tsx` line 1640 still gates by `isLive` and renders smoothed text only for live AI bubbles. If the gate is missing, restore it — the current verified state (PATTERNS.md line 67) is `useSmoothedText(message, isLive)` with `isLive` truthy only for streaming AI text.

    5. Run `npm run format -- packages/app/src/hooks/use-smoothed-text.ts packages/app/src/hooks/use-smoothed-text.test.ts`.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -c "NAT-04 / D-19 invariant" packages/app/src/hooks/use-smoothed-text.ts | grep -q '^1$' && \
      grep -c "exactly 1 production consumer" packages/app/src/hooks/use-smoothed-text.test.ts | grep -q '^1$' && \
      PROD_COUNT=$(grep -rln 'useSmoothedText\b' packages/app/src/ | grep -v '\.test\.ts$' | grep -v 'hooks/use-smoothed-text\.ts$' | wc -l | tr -d ' ') && \
      [ "$PROD_COUNT" = "1" ] && \
      grep -q "useSmoothedText" packages/app/src/components/message.tsx && \
      npx vitest run packages/app/src/hooks/use-smoothed-text.test.ts --bail=1 && \
      npm run typecheck && \
      npm run lint -- packages/app/src/hooks/use-smoothed-text.ts packages/app/src/hooks/use-smoothed-text.test.ts
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "NAT-04 / D-19 invariant" packages/app/src/hooks/use-smoothed-text.ts` returns 1
    - `grep -rln "useSmoothedText\\b" packages/app/src/ | grep -v "\\.test\\.ts$" | grep -v "hooks/use-smoothed-text\\.ts$" | wc -l | tr -d ' '` returns exactly 1 (= `packages/app/src/components/message.tsx`)
    - The grep-gate test passes: `npx vitest run packages/app/src/hooks/use-smoothed-text.test.ts --bail=1` exits 0
    - `npm run typecheck` exits 0
    - `npm run lint -- packages/app/src/hooks/use-smoothed-text.ts packages/app/src/hooks/use-smoothed-text.test.ts` exits 0
  </acceptance_criteria>
  <done>NAT-04 invariant codified: exactly 1 production consumer of useSmoothedText (message.tsx for live AI streaming); future creep is caught by the test</done>
</task>

<task type="auto">
  <name>Task 6: Otter brand placement — centralize assets, wire to splash + welcome + first-time empty states (THM-04)</name>
  <files>
    packages/app/src/assets/otter/index.ts,
    packages/app/src/assets/otter/README.md,
    packages/app/src/components/welcome-screen.tsx,
    packages/app/src/components/splash-overlay.tsx,
    packages/app/src/screens/sessions-screen.tsx,
    packages/app/src/i18n/locales/en.json,
    packages/app/src/i18n/locales/zh.json
  </files>
  <read_first>
    - packages/app/src/components/icons/ottie-logo.tsx (existing brand surface — analog per PATTERNS.md table line 52)
    - packages/app/src/components/welcome-screen.tsx (existing — Plan 02b extends with Skip CTA; this task confirms Otter present per UI-SPEC line 280)
    - packages/app/src/components/splash-overlay.tsx (existing splash — already shows brand; confirm Otter present)
    - packages/app/src/screens/sessions-screen.tsx (Plan 02c reshapes into Chats tab — first-time-empty state branch is OWNED by this task per the read_first: planner reads PATTERNS.md line 839 "branch on useOnboardingStateStore().emptyOttiePlayedFirstChats")
    - packages/app/src/stores/onboarding-state-store.ts (Plan 02b — provides `emptyOttiePlayedFirstWorkspace`, `emptyOttiePlayedFirstChats` flags + setters)
    - packages/app/assets/images/ (existing image dir — see if any otter assets already exist)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-CONTEXT.md decision D-14 (empty states 97% pure copy; Otter only on first-time empty) and D-17 (brand placement: splash + welcome + first-time-empty + 3 delight toasts)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md §"Copywriting Contract" lines 211-216 (chat.empty.firstTime.* + workspace.empty.firstTime.* keys + en/zh)
  </read_first>
  <action>
    Step 1 — Audit existing Otter assets. Run `ls packages/app/assets/images/` and `grep -rln "ottie-logo\\|otter" packages/app/src/assets/ packages/app/assets/` to discover what exists. Document the inventory in the new README.

    Step 2 — Create `packages/app/src/assets/otter/index.ts`:

    ```typescript
    /**
     * THM-04 / D-17 — centralized Otter brand assets.
     *
     * The Otter character appears at EXACTLY 5 surfaces:
     *   1. Splash logo (existing — see splash-overlay.tsx)
     *   2. Welcome screen illustration (existing — see welcome-screen.tsx)
     *   3. First-time empty state (first workspace + first Chats list — gated
     *      by useOnboardingStateStore.emptyOttiePlayed* flags)
     *   4. Three one-time delight toasts (firstAgent / firstPermission /
     *      firstVoice — wired in delight-toast.ts as inline {{otter}} sticker)
     *
     * It does NOT appear in subsequent empty states, error states, loading
     * states, or chrome. Importing from this module signals brand intent.
     */

    // If the existing repo has a logo asset, re-export it. If not, point to
    // a placeholder asset under packages/app/assets/images/otter-* and
    // record in README.md the asset ask.
    import { OttieLogo } from "@/components/icons/ottie-logo";

    export const otterAssets = {
      logo: OttieLogo,                              // svg/jsx component
      welcomeIllustration: OttieLogo,               // placeholder — same as logo if no dedicated illustration ships
      emptyStateIllustration: OttieLogo,            // placeholder
      delightStickers: {
        firstAgent: "🦦",                           // inline emoji per UI-SPEC line 246 ({{otter}} interpolation)
        firstPermission: "🎉",
        firstVoice: "🎤",
      },
    } as const;

    export type OtterDelightSticker = keyof typeof otterAssets.delightStickers;
    ```

    Step 3 — Create `packages/app/src/assets/otter/README.md` documenting:
    - The 5 sanctioned surfaces (verbatim from D-17)
    - The asset inventory (what already exists; what is a placeholder; the brand-asset ask if any)
    - The grep gate: any new import from `@/assets/otter` outside the 5 sanctioned files is a brand-creep violation (Pitfall 9 from RESEARCH.md)
    - The 5 sanctioned consumers (file paths): `splash-overlay.tsx`, `welcome-screen.tsx`, `sessions-screen.tsx` (first-time empty branch only), `screens/workspace/*` (first-time workspace empty — flagged here for whoever lands the workspace empty surface), `utils/delight-toast.ts`

    Step 4 — Wire `welcome-screen.tsx` to import from the central module IF it does not already use `<OttieLogo>` directly. Per PATTERNS.md line 280 + UI-SPEC line 280, the existing welcome-screen renders an Otter at H1 (rounded family) — confirm it imports through `@/assets/otter` (refactor the existing `import { OttieLogo } from "@/components/icons/ottie-logo"` to `import { otterAssets } from "@/assets/otter"`, then `const Logo = otterAssets.welcomeIllustration` if needed). The visual MUST NOT change.

    Step 5 — Wire `splash-overlay.tsx` to import from the central module the same way. Visual MUST NOT change.

    Step 6 — Wire the first-time-empty branch in `packages/app/src/screens/sessions-screen.tsx` per PATTERNS.md line 839. The Chats tab empty state branches on `useOnboardingStateStore().emptyOttiePlayedFirstChats`:

    - First-time (flag === false): render `<otterAssets.emptyStateIllustration />` + `t("chat.empty.firstTime.heading")` + `t("chat.empty.firstTime.body")` + the existing CTA. After the user adds their first chat (i.e. `agents.length` transitions to ≥1), call `useOnboardingStateStore.getState().setEmptyOttiePlayedFirstChats(true)` so subsequent empty states (if user later deletes everything) skip the Otter.
    - Subsequent (flag === true): pure copy: `t("chat.empty.heading")` + `t("chat.empty.body")` — no Otter.

    The keys `chat.empty.firstTime.heading` / `chat.empty.firstTime.body` / `chat.empty.heading` / `chat.empty.body` are added in Plan 02c per UI-SPEC; this task confirms the wiring touches them. If Plan 02c already wired the empty branch, this task only adjusts the IMPORT path to `@/assets/otter` and confirms the flag check.

    Step 7 — Add bilingual strings ONLY if not already present. The empty-state keys per UI-SPEC §Copywriting Contract lines 211-216 are owned by Plan 02c (chat.empty.*) and Plan 02b (welcome.* + workspace.empty.*) — DO NOT duplicate. If running this task finds those keys missing (because 02b/02c didn't add them), add them here in en+zh AND record the duplication-prevention reason in the SUMMARY.

    For new strings introduced ONLY by this task (the otter README references no new copy beyond what 02b/02c provide), no en/zh additions are needed. Skip if already present.

    Step 8 — Run `npm run format -- packages/app/src/assets/otter/index.ts packages/app/src/components/welcome-screen.tsx packages/app/src/components/splash-overlay.tsx packages/app/src/screens/sessions-screen.tsx packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/zh.json`.

    Step 9 — Add a grep-test that there are exactly 5 sanctioned consumers of `@/assets/otter` AND no others. Inline this test inside `packages/app/src/assets/otter/README.md` as the canonical command:

    ```bash
    # Pitfall 9 / D-14 / D-17 brand-creep gate
    SANCTIONED="welcome-screen.tsx splash-overlay.tsx sessions-screen.tsx delight-toast.ts"
    grep -rln "from \"@/assets/otter\"" packages/app/src/ | while read f; do
      base=$(basename "$f")
      echo "$SANCTIONED" | grep -wq "$base" || echo "VIOLATION: $f imports otter assets but is not sanctioned"
    done
    ```

    The test runs in this task's <verify> block.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q "export const otterAssets" packages/app/src/assets/otter/index.ts && \
      grep -q "THM-04 / D-17" packages/app/src/assets/otter/index.ts && \
      grep -q "delightStickers" packages/app/src/assets/otter/index.ts && \
      test -f packages/app/src/assets/otter/README.md && \
      grep -q "5 sanctioned surfaces\|5 sanctioned consumers\|brand-creep\|EXACTLY 5" packages/app/src/assets/otter/README.md && \
      grep -q "@/assets/otter" packages/app/src/components/welcome-screen.tsx && \
      grep -q "@/assets/otter" packages/app/src/components/splash-overlay.tsx && \
      grep -q "emptyOttiePlayedFirstChats\|@/assets/otter" packages/app/src/screens/sessions-screen.tsx && \
      VIOLATIONS=$(grep -rln 'from "@/assets/otter"' packages/app/src/ | while read f; do \
        base=$(basename "$f"); \
        case "$base" in \
          welcome-screen.tsx|splash-overlay.tsx|sessions-screen.tsx|delight-toast.ts) ;; \
          *) echo "$f"; ;; \
        esac; \
      done) && \
      [ -z "$VIOLATIONS" ] && \
      npm run typecheck && \
      npm run lint -- packages/app/src/assets/otter/index.ts packages/app/src/components/welcome-screen.tsx packages/app/src/components/splash-overlay.tsx packages/app/src/screens/sessions-screen.tsx
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "export const otterAssets" packages/app/src/assets/otter/index.ts` returns 1
    - `grep -c "THM-04 / D-17" packages/app/src/assets/otter/index.ts` returns ≥1
    - `test -f packages/app/src/assets/otter/README.md` exits 0
    - `grep -c '@/assets/otter' packages/app/src/components/welcome-screen.tsx packages/app/src/components/splash-overlay.tsx packages/app/src/screens/sessions-screen.tsx | grep -v ':0$' | wc -l` returns ≥3 (each file has the import)
    - The grep brand-creep gate command emits no VIOLATION lines (no consumer outside the 4 sanctioned files; `delight-toast.ts` becomes the 5th once delight wiring lands)
    - `npm run typecheck` exits 0
    - `npm run lint -- packages/app/src/assets/otter/index.ts packages/app/src/components/welcome-screen.tsx packages/app/src/components/splash-overlay.tsx packages/app/src/screens/sessions-screen.tsx` exits 0
  </acceptance_criteria>
  <done>Otter assets centralized at @/assets/otter; consumers limited to the 5 sanctioned surfaces (4 file-imports + 1 inline-emoji via delight-toast); brand-creep is automatically detectable via grep</done>
</task>

<task type="auto">
  <name>Task 7: Math-curve loader scope-narrowing module + NAT-03 lint promotion (D-20: warn → error; sweep current pointer-event violations)</name>
  <files>
    packages/app/src/components/math-curve-loader/sanctioned-uses.ts,
    tools/lint/pointer-events-web-only.ts,
    tools/lint/pointer-events-web-only.baseline.json,
    package.json,
    packages/app/src/components/web-desktop-scrollbar.tsx,
    packages/app/src/components/sidebar-workspace-list.tsx,
    packages/app/src/components/terminal-emulator.tsx,
    packages/app/src/components/workspace-hover-card.tsx
  </files>
  <read_first>
    - packages/app/src/components/math-curve-loader/index.tsx (current loader entry)
    - packages/app/src/components/math-curve-loader/renderer.tsx (current renderer)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-CONTEXT.md decision D-13 (math-curve loader reserved for top-level loads — Chats list initial load, agent run-start, command-center search "thinking")
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md "Math-curve loader minimum size" line 61 + §Visual Language line 360 (top-level loads only)
    - tools/lint/pointer-events-web-only.ts entire file (217-265 = main, 246-252 = current warn-only branch + the PHASE 5 promotion comment)
    - tools/lint/pointer-events-web-only.baseline.json (current count = 10)
    - tools/lint/pointer-events-web-only.test.ts (existing test for the linter)
    - package.json scripts section (look for `lint`, `lint:colors`, `lint:pointer-events`, `lint:schema` — promote `lint` to invoke pointer-events too)
    - The 5 violator files in `<files>` — locate the offending lines (per audit table in <audit_lists>)
    - packages/app/src/constants/platform.ts (`isWeb` gate import path: `@/constants/platform`)
  </read_first>
  <action>
    **Part A — Math-curve loader sanctioned-uses module (D-13)**

    Step 1 — Create `packages/app/src/components/math-curve-loader/sanctioned-uses.ts`:

    ```typescript
    /**
     * THM-03 / D-13 — math-curve loader scope.
     *
     * The math-curve loader is a BRAND MOMENT, not a busy-spinner replacement.
     * It appears at exactly THREE surfaces (per CONTEXT.md D-13 + UI-SPEC
     * §Visual Language):
     *
     *   1. Chats list initial load (sessions-screen.tsx)
     *   2. Agent run-start (composer / message-input gate)
     *   3. Command-center search "thinking" (command-center.{web,native}.tsx)
     *
     * Anywhere else — form submit, button spinner, route transition,
     * inline pending state — uses native skeletons or a plain neutral
     * spinner. Calling <MathCurveLoader> with a context outside this enum
     * is a code review red flag.
     *
     * Minimum size: 64×64 (theme.spacing[16]) per UI-SPEC line 61.
     */
    export const SANCTIONED_LOADER_CONTEXTS = [
      "chats-list-initial-load",
      "agent-run-start",
      "command-center-thinking",
    ] as const;

    export type SanctionedLoaderContext = (typeof SANCTIONED_LOADER_CONTEXTS)[number];
    ```

    Step 2 — Add a discoverable comment at the top of `packages/app/src/components/math-curve-loader/index.tsx` (one-line note pointing at sanctioned-uses.ts) so future contributors land in the right doc. Do NOT add a runtime prop check that breaks existing call sites — the gate is documentation + reviewer awareness, not a runtime block. The Phase 02 SUMMARY records the existing call-site count as a baseline.

    **Part B — NAT-03 / D-20 pointer-events lint promotion**

    Step 3 — Sweep the 5 violator files. For each (per audit table):

    - `packages/app/src/components/web-desktop-scrollbar.tsx` (lines 416-417):
      Option A: rename to `web-desktop-scrollbar.web.tsx` (Metro split — file IS web-only behaviorally per its name). Add a sibling `web-desktop-scrollbar.tsx` that re-exports `from "./web-desktop-scrollbar.web"` per the PATTERNS.md draggable-list shim pattern (lines 311-318). PREFER this option since the file's purpose is web-only.
      Option B (fallback): gate via `isWeb ? handleGrabHoverIn : undefined`.

    - `packages/app/src/components/sidebar-workspace-list.tsx` (lines 1365-1366, 1388-1389, 1487-1488):
      Cross-platform file — gate every assignment via `isWeb ? handlePointerEnter : undefined` and `isWeb ? handlePointerLeave : undefined`. Confirm `isWeb` is imported from `@/constants/platform`. Three occurrences.

    - `packages/app/src/components/terminal-emulator.tsx` (lines 740-741):
      Cross-platform file — gate via `isWeb ?  handler : undefined`.

    - `packages/app/src/components/workspace-hover-card.tsx` (lines 183-184):
      Cross-platform file (hover card needs to render on native too) — gate via `isWeb ? handler : undefined`.

    - `packages/app/src/components/ui/tooltip.tsx` (lines 383-384, 407-408): Already touched by Task 2 (GlassSurface migration). If those lines were not already gated by Task 2, gate them here. Otherwise skip.

    Step 4 — Flip the lint script behavior. Edit `tools/lint/pointer-events-web-only.ts` lines 245-265 — change the main() so:
    - Update header comment from "Phase 1: warn-only counter-test ... Phase 5: tightened — exit 1 on ANY violation" to "Phase 2: tightened (D-20 / NAT-03) — exit 1 on ANY violation"
    - Replace the baseline-tolerance branch with a strict `count > 0` exit-1 branch:

    ```typescript
    function main(): void {
      const args = process.argv.slice(2);
      const writeBaselineFlag = args.includes("--write-baseline");
      const scanRoot = resolve(args.find((a) => !a.startsWith("--")) ?? DEFAULT_SCAN_ROOT);
      const baselinePath = resolve(BASELINE_PATH);

      const { violations, count } = lintPointerEventsWebOnly(scanRoot);
      for (const v of violations) {
        process.stderr.write(
          `ERROR  ${v.file}:${v.line}  ${v.prop} used outside .web.* without isWeb gate (CLAUDE.md "NEVER use onPointerEnter/onPointerLeave")\n`,
        );
      }

      if (writeBaselineFlag) {
        writeBaseline(baselinePath, count);
        process.stderr.write(`\n✓ Baseline written to ${BASELINE_PATH}: count=${count}\n`);
        process.exit(0);
      }

      // D-20 / NAT-03 — promoted from warn to error in Phase 2 of the v1.11 milestone.
      // Any violation fails the lint, regardless of baseline.
      if (count > 0) {
        process.stderr.write(
          `\nFAIL  pointer-events-web-only: ${count} violation(s). NAT-03 promoted from warn to error in Phase 2.\nFix: gate handler with \`isWeb ? handler : undefined\` or move into a .web.tsx file.\n`,
        );
        process.exit(1);
        return;
      }

      process.stderr.write(`✓ pointer-events-web-only clean: 0 violations.\n`);
      process.exit(0);
    }
    ```

    Step 5 — Update `tools/lint/pointer-events-web-only.baseline.json` to `{ "count": 0, "capturedAt": "<now>", "plan": "02e" }`. After the sweep this MUST hold.

    Step 6 — Wire `lint:pointer-events` into the main `npm run lint` script. Read `package.json` `"lint"` script — if it currently runs `oxlint` only, change to e.g. `"lint": "oxlint && npm run lint:pointer-events && npm run lint:colors"` (preserve existing chain order). Confirm the chain still respects file-path arguments by appending `--` properly. Do NOT touch `lint:schema` — that one stays at warn-level per Phase 02 D-20.

    Step 7 — Run the full lint to confirm no regressions:

    ```bash
    npm run lint:pointer-events
    npm run lint        # full chain
    npm run typecheck
    ```

    Step 8 — Run `npm run format -- <every file in this task>`.

    NO new i18n strings.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q "export const SANCTIONED_LOADER_CONTEXTS" packages/app/src/components/math-curve-loader/sanctioned-uses.ts && \
      grep -q "THM-03 / D-13" packages/app/src/components/math-curve-loader/sanctioned-uses.ts && \
      grep -q "promoted from warn to error\|D-20\\|NAT-03" tools/lint/pointer-events-web-only.ts && \
      grep -q '"count": 0' tools/lint/pointer-events-web-only.baseline.json && \
      grep -q "lint:pointer-events" package.json && \
      VIOLATIONS=$(grep -rn "onPointerEnter\\|onPointerLeave" packages/app/src/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "\\.web\\." | grep -v "isWeb" | grep -v "^[[:space:]]*//" | grep -v "^[[:space:]]*\\*" | wc -l | tr -d ' ') && \
      [ "$VIOLATIONS" -le 0 -o "$VIOLATIONS" = "0" ] && \
      npm run lint:pointer-events && \
      npm run typecheck && \
      npm run lint
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "export const SANCTIONED_LOADER_CONTEXTS" packages/app/src/components/math-curve-loader/sanctioned-uses.ts` returns 1
    - `grep -c "promoted from warn to error\\|D-20" tools/lint/pointer-events-web-only.ts` returns ≥1
    - `grep -v '^[[:space:]]*//' tools/lint/pointer-events-web-only.ts | grep -c "if (count > 0)"` returns ≥1 (new error branch)
    - `cat tools/lint/pointer-events-web-only.baseline.json | grep -c '"count": 0'` returns 1
    - `grep -c "lint:pointer-events" package.json` returns ≥2 (the script itself + the wired call from `"lint"`)
    - `npm run lint:pointer-events` exits 0 (the sweep cleared all violations)
    - `npm run lint` exits 0 (full chain green)
    - `npm run typecheck` exits 0
  </acceptance_criteria>
  <done>D-13 loader scope codified; D-20 / NAT-03 lint promoted to error and the repo passes; current 10-baseline violations swept</done>
</task>

<task type="auto">
  <name>Task 8: Light/dark contrast AA audit (THM-02 phase-exit gate) — script + report</name>
  <files>
    tools/audit/contrast-aa-audit.ts,
    tools/audit/contrast-aa-audit.test.ts,
    .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-contrast-aa-report.md,
    package.json
  </files>
  <read_first>
    - packages/app/src/styles/tokens/ (entire directory — Phase 1 token tree: primitive → semantic → component)
    - packages/app/src/styles/tokens/semantic.light.ts (light semantic tokens — bg/fg pairs)
    - packages/app/src/styles/tokens/semantic.dark.ts (dark semantic tokens)
    - packages/app/src/components/ui/glass-surface.tsx (resolved tint values per radius variant + intensity defaults)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md §"Light/Dark Contrast" line 158 (4.5:1 body / 3:1 large text 18px+/600)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-RESEARCH.md acceptance row for THM-02 (line 56) + line 798 (suggested grep audit)
    - tools/lint/hardcoded-color.ts (analog: tools/audit script structure — Node TS, runs via tsx)
  </read_first>
  <action>
    Step 1 — Create `tools/audit/contrast-aa-audit.ts` — a Node TS script run via `tsx`. The script:
    - Imports semantic.light.ts + semantic.dark.ts (use dynamic ts-node-style import via `tsx`)
    - For each (background, foreground) semantic-token pair in the audit set, compute WCAG 2.1 contrast ratio (relative luminance per https://www.w3.org/TR/WCAG21/#contrast-minimum)
    - Audit set:
      - `theme.text.primary` on `theme.surface.canvas`
      - `theme.text.primary` on `theme.surface.elevated`
      - `theme.text.primary` on `theme.surface.glass.tint` (effective post-blur — approximate by alpha-compositing tint over canvas)
      - `theme.text.muted` on each of the above
      - `theme.text.primary` on `theme.surface.bubble.self`
      - `theme.text.primary` on `theme.surface.bubble.other`
      - `theme.status.destructive` text on each surface
      - `theme.status.warning` text on each surface
      - `theme.status.success` text on each surface
    - Apply size threshold: body = 4.5:1, large (18px+/semibold) = 3:1. The audit emits PASS or FAIL per pair per mode.
    - Write the report to `.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-contrast-aa-report.md` as a markdown table with columns: `pair | light ratio | light pass | dark ratio | dark pass | size threshold`.
    - Exit 1 if ANY pair fails AA in either mode; exit 0 otherwise.

    Sketch (the math is well-known — implement WCAG luminance precisely):

    ```typescript
    interface RGB { r: number; g: number; b: number }
    function relLuminance({ r, g, b }: RGB): number {
      const norm = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * norm(r) + 0.7152 * norm(g) + 0.0722 * norm(b);
    }
    function contrastRatio(a: RGB, b: RGB): number {
      const la = relLuminance(a), lb = relLuminance(b);
      const [hi, lo] = la > lb ? [la, lb] : [lb, la];
      return (hi + 0.05) / (lo + 0.05);
    }
    function alphaComposite(over: { r: number; g: number; b: number; a: number }, under: RGB): RGB {
      // Standard "over" operator
      const a = over.a;
      return {
        r: Math.round(over.r * a + under.r * (1 - a)),
        g: Math.round(over.g * a + under.g * (1 - a)),
        b: Math.round(over.b * a + under.b * (1 - a)),
      };
    }
    ```

    Step 2 — Create `tools/audit/contrast-aa-audit.test.ts` — minimal vitest tests:
    - relLuminance(white) ≈ 1.0
    - relLuminance(black) === 0
    - contrastRatio(white, black) ≈ 21
    - contrastRatio(#777, white) is between 4.4 and 4.6 (sanity)

    Step 3 — Add `npm` script in `package.json`:

    ```json
    "audit:contrast-aa": "tsx tools/audit/contrast-aa-audit.ts",
    "test:audit:contrast-aa": "tsx --test tools/audit/contrast-aa-audit.test.ts"
    ```

    Step 4 — Run the audit. Capture the output report at `.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-contrast-aa-report.md`. The report MUST include:

    - Date of audit + token-tree commit SHA
    - Per-pair table (light + dark + verdict)
    - A summary line: `Result: PASS (all pairs meet AA)` or `Result: FAIL (N pairs below AA: <list>)`
    - If FAIL: a follow-up section listing each failing pair, the failing ratio, and a remediation note (which token to adjust, or whether the surface should be excluded from the AA scope).

    Step 5 — Resolve any failures. If a pair fails AA:
    - Option A: bump the foreground token (e.g. `theme.text.muted` → slightly darker in light mode / lighter in dark mode) at `packages/app/src/styles/tokens/semantic.{light,dark}.ts`. Re-run the audit.
    - Option B: exclude the pair from the AA-scoped surface — i.e., don't render that token-pair combination on a glass surface. Document in the report.

    Step 6 — Commit the report. The phase-exit acceptance for THM-02 is: `npm run audit:contrast-aa` exits 0 AND the report exists with `Result: PASS`.

    Step 7 — Run `npm run format -- tools/audit/contrast-aa-audit.ts tools/audit/contrast-aa-audit.test.ts package.json`.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q "function contrastRatio" tools/audit/contrast-aa-audit.ts && \
      grep -q "WCAG\|relLuminance" tools/audit/contrast-aa-audit.ts && \
      grep -q "4.5\|4\\.5" tools/audit/contrast-aa-audit.ts && \
      grep -q "audit:contrast-aa" package.json && \
      test -f .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-contrast-aa-report.md && \
      grep -q "Result: PASS\|Result: FAIL" .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-contrast-aa-report.md && \
      grep -q "Result: PASS" .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-contrast-aa-report.md && \
      tsx --test tools/audit/contrast-aa-audit.test.ts && \
      npm run audit:contrast-aa && \
      npm run typecheck
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "function contrastRatio" tools/audit/contrast-aa-audit.ts` returns 1
    - `grep -c "function relLuminance" tools/audit/contrast-aa-audit.ts` returns 1
    - `grep -c "audit:contrast-aa" package.json` returns ≥1
    - `test -f .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-contrast-aa-report.md` exits 0
    - `grep -c "Result: PASS" .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-contrast-aa-report.md` returns 1 (audit passes — phase-exit gate for THM-02)
    - `tsx --test tools/audit/contrast-aa-audit.test.ts` exits 0
    - `npm run audit:contrast-aa` exits 0
    - `npm run typecheck` exits 0
  </acceptance_criteria>
  <done>Light/dark AA contrast audit script exists with passing tests; report shows Result: PASS; THM-02 phase-exit gate cleared</done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary                                                  | Description                                                                                                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator/agent text → burnt toast surface                 | Any title/message passed to `systemToast.emit({ event, title })` ends up rendered in a system-level toast on iOS / Android / web; some titles may carry agent-controlled or operator-controlled text |
| useOnboardingStateStore (AsyncStorage) → fireDelightToast | Local persisted flag controls one-shot delight; if a deep link or URL param could write to the store, an attacker could re-fire / suppress delight                                                   |
| `<GlassSurface>` native module call (iOS 26 only)         | If `expo-glass-effect@55.0.10` adopted, it loads a native module via the React Native bridge                                                                                                         |
| AsyncStorage `@ottie:` keys                               | Phase 02 adds no new AsyncStorage keys here; `useHaptic` settings (`@ottie:app-settings`) come from Plan 02a                                                                                         |

## STRIDE Threat Register

| Threat ID | Category                   | Component                                                                                      | Disposition | Mitigation Plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | -------------------------- | ---------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| T-02e-01  | I (Information disclosure) | `useOnboardingStateStore` haptic-toggle flag persistence (extended by Plan 02a; consumed here) | accept      | Local-only AsyncStorage key under `@ottie:` namespace; never transmitted to daemon / relay. No information leak surface (per Plan 02a T-02a-03 disposition). No deep-link / URL writer to this store exists in Phase 02 (welcome route consumes it read-only). Re-confirm via `grep -rn "setHaptic\\                                                                                                                                                                                                                                          | setWelcomeShown" packages/app/src/app/` returns ONLY route-side reads, no params-driven writes. |
| T-02e-02  | T (Tampering / XSS)        | `burnt` toast title rendered on web (sonner)                                                   | mitigate    | All `systemToast.emit({ title })` callers MUST pass `t("toast.X")` (a static i18n key) — never raw operator/agent text. Confirmed by acceptance criterion: `grep -rn "systemToast.emit" packages/app/src/ \| grep -v 't(\""` returns 0 (all call sites use translated keys). For delight toasts, the `{{otter}}` interpolation uses i18next's safe substitution — never raw HTML. Sonner on web does NOT render HTML by default in `toast(string)` invocation; only `toast.message(react-element)` would; we exclusively use the string form. |
| T-02e-03  | E (Elevation of Privilege) | `expo-glass-effect@55.0.10` native module                                                      | mitigate    | Pinned to `55.0.10` (matches Expo SDK 54 — verified by version compatibility check in Task 1). Module is loaded at app boot via Metro/Expo native loader; no runtime download path. Adoption is gated by the iOS 26 validation checkpoint (Task 1) — if adoption fails, package is NOT installed; no native code added.                                                                                                                                                                                                                       |
| T-02e-04  | T (Tampering)              | `<GlassSurface>` migration AA contrast regression                                              | mitigate    | Light/dark contrast audit (Task 8) is a phase-exit gate — `npm run audit:contrast-aa` exits 1 on any AA failure. Report is committed; reviewer sees regressions in the diff if a future PR shifts a token below AA. No runtime exposure                                                                                                                                                                                                                                                                                                       |
| T-02e-05  | R (Repudiation)            | `02e-glass-effect-validation-LOG.md`                                                           | accept      | Validation log records adoption decision in plain text (markdown); no signed/repudiation-resistant store. Fit for purpose — the decision is reversible per UI-SPEC, not security-critical                                                                                                                                                                                                                                                                                                                                                     |
| T-02e-06  | D (Denial of Service)      | `systemToast.emit` rapid-fire flood                                                            | accept      | 200ms per-event-type debounce in `system-toast.ts` collapses same-event flooding. Worst case: an attacker who can already invoke handler functions can fire 5 different events in 200ms → 5 toasts; user dismisses by tapping. Not a privilege escalation                                                                                                                                                                                                                                                                                     |
| T-02e-07  | T (Tampering)              | Pointer-events lint promoted to error                                                          | mitigate    | Lint enforces no `onPointerEnter` / `onPointerLeave` outside `.web.tsx` files — prevents native crash regressions (CONCERNS C12). Promotion to exit-1-on-violation makes CI block any future pointer-event regression                                                                                                                                                                                                                                                                                                                         |
| T-02e-08  | I (Information disclosure) | Otter brand asset module path (`@/assets/otter`)                                               | accept      | Asset module exposes static images / emoji constants; no PII or secrets                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

No HIGH severity threats. Proceed.
</threat_model>

<verification>

Phase-level verification (run before declaring this plan complete):

- All 8 tasks' `<verify>` blocks pass.
- `npm run typecheck` exits 0.
- `npm run lint` exits 0 (full chain — includes promoted `lint:pointer-events`).
- `npm run lint:colors` exits 0 (Phase 1 hardcoded-color counter-test holds — no regression from GlassSurface migrations).
- `npm run audit:contrast-aa` exits 0 (THM-02 AA gate).
- `npm run lint:pointer-events` exits 0 (D-20 / NAT-03 promotion enforced).
- `npx vitest run packages/app/src/utils/system-toast.test.ts packages/app/src/utils/delight-toast.test.ts packages/app/src/hooks/use-smoothed-text.test.ts --bail=1` exits 0.
- `npm run format:check -- packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/zh.json packages/app/src/utils/system-toast.ts packages/app/src/utils/delight-toast.ts packages/app/src/assets/otter/index.ts packages/app/src/components/math-curve-loader/sanctioned-uses.ts tools/audit/contrast-aa-audit.ts` exits 0.
- Audit gate: `grep -rln "GlassSurface\\|adaptive-modal-sheet\\|isolated-bottom-sheet-modal\\|chat-row-context-menu\\|top-right-add-menu\\|total-unread-popup\\|pair-scan-recovery-callout" packages/app/src/components/ | wc -l` reaches every entry in the audit table inside `<audit_lists>` (no silent skips).
- `02e-glass-effect-validation-LOG.md` records a Decision (ADOPT / FALLBACK_BLUR_ONLY / VALIDATION_SKIPPED).
- `02e-contrast-aa-report.md` records `Result: PASS`.
- Bilingual i18n parity: every `delight.*` and `toast.chat.*` and `toast.agent.*` and `toast.permission.*` and `toast.send.*` key exists in BOTH `en.json` and `zh.json`. Verified by: `for k in delight.firstAgent.toast delight.firstPermission.toast delight.firstVoice.toast toast.chat.read toast.chat.deleted toast.permission.approved toast.send.ack; do grep -q "$k" packages/app/src/i18n/locales/en.json && grep -q "$k" packages/app/src/i18n/locales/zh.json || echo "MISS: $k"; done` returns no MISS lines.

</verification>

<success_criteria>

- THM-02: Every entry in the modal/popover/dropdown audit table either renders through `<GlassSurface>` or consumes a primitive that does (Tasks 2 + 3); `expo-glass-effect` adoption decided + recorded (Task 1); light/dark AA contrast audit passes (Task 8 — `Result: PASS` in `02e-contrast-aa-report.md`).
- THM-03: `burnt` adopted via `systemToast.emit(...)` for state-change acks (Task 4); `toast-host.tsx` retained for in-panel inline; math-curve loader scope codified at `sanctioned-uses.ts` (Task 7); error-state visual language already shipped via Phase 1 callout-card.
- THM-04: Otter brand assets centralized at `@/assets/otter` with a 5-surface invariant (Task 6); `fireDelightToast()` helper ships with passing tests (Task 4); Otter consumers limited to `welcome-screen.tsx` + `splash-overlay.tsx` + first-time-empty branch in `sessions-screen.tsx` + `delight-toast.ts`.
- NAT-04: `useSmoothedText` has exactly one production consumer (`message.tsx`) with a runtime-comment invariant + a vitest grep gate enforcing the count (Task 5).
- NAT-03 cross-cutting (D-20): Pointer-events lint promoted from warn to error; `tools/lint/pointer-events-web-only.ts` exits 1 on any violation; current 10-baseline violations swept; baseline file shows `count: 0`; `lint:pointer-events` wired into `npm run lint` (Task 7).
- iOS 26 validation gate is the FIRST task; downstream tasks proceed regardless of outcome — `<GlassSurface>` API surface is unchanged, only the native blur backend swaps if adoption proceeds.
- Bilingual parity: 16+ new i18n keys (delight + toast vocabulary) exist in both `en.json` and `zh.json` in lockstep (CLAUDE.md hard rule).
- All `<verify>` blocks + acceptance criteria + the verification section pass.

</success_criteria>

<output>
After completion, create `.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-polish-sweep-SUMMARY.md` per the SUMMARY template; include:

1. The iOS 26 validation outcome (ADOPT / FALLBACK_BLUR_ONLY / VALIDATION_SKIPPED) and the path of `02e-glass-effect-validation-LOG.md`.
2. The full list of `<GlassSurface>`-migrated files (the 21 files from Tasks 2 + 3 plus the 5 already migrated by 02a/02b/02c — i.e. the closed audit list).
3. The contrast-AA audit outcome (Result: PASS) and a link to `02e-contrast-aa-report.md`.
4. The pointer-events lint baseline post-promotion (`count: 0`).
5. The Otter brand consumer list (5 sanctioned files) and the brand-creep grep gate.
6. The smoothed-text consumer count (= 1) and the test that enforces it.
7. The new i18n keys added with EN+ZH counts.
8. Any deferred follow-ups (notably: delight-toast call-site wiring inside `sessions-screen.tsx` for `firstAgent`, `permission-handler-context.tsx` for `firstPermission`, and `voice-router.ts` for `firstVoice` — flagged here so the Phase 02 final reconciliation closes them; the helper ships in this plan).
   </output>
