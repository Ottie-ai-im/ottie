---
phase: 02-onboarding-navigation-settings-theme-native-feel-polish
plan: 02d
type: execute
wave: 2
depends_on: [02a]
files_modified:
  - packages/app/src/utils/host-routes.ts
  - packages/app/src/utils/host-routes.test.ts
  - packages/app/src/components/settings/flat-list.tsx
  - packages/app/src/components/settings/group.tsx
  - packages/app/src/components/settings/row.tsx
  - packages/app/src/components/settings/labs-row.tsx
  - packages/app/src/components/settings/labs-badge.tsx
  - packages/app/src/screens/settings-screen.tsx
  - packages/app/src/screens/settings/labs-section.tsx
  - packages/app/src/actions/settings-actions.ts
  - packages/app/src/i18n/locales/en.json
  - packages/app/src/i18n/locales/zh.json
autonomous: true
requirements: [SET-01, SET-03, SET-04, NAV-A5]
tags: [phase-02, settings, labs, ia-reorg]
must_haves:
  truths:
    - "Settings root renders a 5-bucket flat scrolling list (Account / Agents / Voice / Appearance / Advanced) per D-09"
    - "Old setting paths (general / shortcuts / integrations / permissions / usage / labs / localDaemon / diagnostics / about) keep working — slug→bucket map resolves them additively (D-11)"
    - "ActionRegistry has settings.open.{bucket} entries deep-linked from cmd-K palette (SET-03 ≤2 taps from any screen)"
    - "Labs sub-page lives under Advanced; each row shows Experimental/Beta/Stable badge (filled/outline differentiation per UI-SPEC) + opt-in toggle"
    - "NAV-A5 reachability table documented: every setting bucket reaches every existing screen; no orphans"
  artifacts:
    - path: "packages/app/src/utils/host-routes.ts"
      provides: "SETTINGS_BUCKETS + SLUG_TO_BUCKET map + buildSettingsBucketRoute"
      exports: ["SETTINGS_BUCKETS", "SLUG_TO_BUCKET", "buildSettingsBucketRoute"]
    - path: "packages/app/src/components/settings/flat-list.tsx"
      provides: "<SettingsFlatList> — 5-group scrolling container"
    - path: "packages/app/src/components/settings/group.tsx"
      provides: "<SettingsGroup> — header + inset card"
    - path: "packages/app/src/components/settings/row.tsx"
      provides: "<SettingsRow> — Pressable that pushes a sub-page"
    - path: "packages/app/src/components/settings/labs-row.tsx"
      provides: "<LabsRow> — registry-driven labs entry with stability badge + toggle"
    - path: "packages/app/src/components/settings/labs-badge.tsx"
      provides: "<LabsBadge> — Experimental/Beta/Stable status pill"
    - path: "packages/app/src/actions/settings-actions.ts"
      provides: "Registers settings.open.{bucket} ActionIds for cmd-K deep-linking"
  key_links:
    - from: "packages/app/src/screens/settings-screen.tsx"
      to: "packages/app/src/components/settings/flat-list.tsx"
      via: "Renders <SettingsFlatList> at root view"
      pattern: "SettingsFlatList"
    - from: "packages/app/src/components/settings/row.tsx"
      to: "packages/app/src/utils/host-routes.ts"
      via: "router.push(buildSettingsBucketRoute(...))"
      pattern: "buildSettingsBucketRoute"
    - from: "packages/app/src/actions/settings-actions.ts"
      to: "packages/app/src/actions/registry.ts"
      via: "actionRegistry.register(defineAction('settings.open.{bucket}', ...))"
      pattern: "settings.open"
---

<objective>
Reorganize Settings into a WeChat-style flat scrolling list with 5 group headers (Account / Agents / Voice / Appearance / Advanced — D-09). Map every existing slug to one of the 5 buckets via a slug→bucket table so old paths keep working without a redirect-router refactor (D-11). Reshape the existing hand-rolled Labs section into a registry-driven `<LabsRow>` with status badges (Experimental / Beta / Stable per D-10). Register `settings.open.{bucket}` ActionIds in the registry so cmd-K deep-links satisfy SET-03 (≤2 taps from any screen). Document the NAV-A5 reachability table.

Purpose: SET-01 ("nothing removed; reorganized around user intent") + SET-03 ("≤2 taps via command-center") + SET-04 ("per-experiment opt-in with stability labels") all live in one screen tree. Without the slug→bucket map, the migration becomes a router refactor (high blast radius). The flat-list with the additive map ships in one plan without breaking deep links.

Output: 1 modified routes utility (additive: buckets + map + builder), 5 new component files (flat-list, group, row, labs-row, labs-badge), 1 modified screen (settings-screen.tsx — replace internals, keep filename), 1 modified labs section (refactor into registry-driven rows), 1 new actions module registering settings.open.{bucket}, en+zh strings for 5 group headers + 3 labs badges + reset-all label.
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
@CLAUDE.md

<interfaces>
<!-- Existing settings route slugs -->
<!-- Source: packages/app/src/utils/host-routes.ts:391-414 -->

```typescript
export const SETTINGS_SECTION_SLUGS = [
  "general",
  "shortcuts",
  "integrations",
  "permissions",
  "usage",
  "labs",
  "localDaemon",
  "diagnostics",
  "about",
] as const;
export type SettingsSectionSlug = (typeof SETTINGS_SECTION_SLUGS)[number];
export function isSettingsSectionSlug(value: string): value is SettingsSectionSlug;
export function buildSettingsRoute(): "/settings";
export function buildSettingsSectionRoute(
  section: SettingsSectionSlug,
): `/settings/${SettingsSectionSlug}`;
```

<!-- Existing settings-section analog (PATTERNS lines 442-475) -->
<!-- Source: packages/app/src/screens/settings/settings-section.tsx:1-51 -->

```typescript
interface SettingsSectionProps {
  title: string;
  trailing?: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}
export function SettingsSection(props): JSX.Element;
```

<!-- Existing labs section structure (REPLACE) -->
<!-- Source: packages/app/src/screens/settings/labs-section.tsx:118-237 -->
<!-- 937 lines, hand-rolled per-experiment row layout -->

<!-- Existing app settings hook (extend with labs opt-in map) -->
<!-- Source: packages/app/src/hooks/use-settings.ts:45-91 -->

```typescript
export interface BetaFeatureSettings { /* ... existing flags ... */ }
export interface AppSettings {
  /* ... */
  betaFeatures?: BetaFeatureSettings;
  haptics?: { enabled: boolean }; // added by Plan 02a
}
export function useAppSettings(): { settings: AppSettings; setSettings: ... };
```

<!-- ActionRegistry from Plan 02a -->
<!-- Source: packages/app/src/actions/registry.ts -->

```typescript
export function defineAction(id, config): Action;
export const actionRegistry: { register; dispatch; ... };
```

<!-- Existing segmented-control / status-badge primitives (analog for LabsBadge) -->
<!-- Source: packages/app/src/components/ui/segmented-control.tsx + packages/app/src/components/ui/status-badge.tsx -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend host-routes.ts with SETTINGS_BUCKETS + SLUG_TO_BUCKET map + buildSettingsBucketRoute; register settings.open.{bucket} ActionIds; add 5 group-header + 3 labs-badge en+zh strings</name>
  <files>
    packages/app/src/utils/host-routes.ts,
    packages/app/src/utils/host-routes.test.ts,
    packages/app/src/actions/settings-actions.ts,
    packages/app/src/actions/ids.ts,
    packages/app/src/voice-control/voice-commands.ts,
    packages/app/src/i18n/locales/en.json,
    packages/app/src/i18n/locales/zh.json
  </files>
  <read_first>
    - packages/app/src/utils/host-routes.ts (FULL FILE — extend lines 391-423; PATTERNS lines 858-882)
    - packages/app/src/utils/host-routes.test.ts if it exists, else colocate new test
    - packages/app/src/app/settings/[section].tsx (existing slug-driven route — confirm it stays unchanged; bucket resolution happens inside the screen)
    - packages/app/src/actions/registry.ts (Plan 02a — defineAction shape)
    - packages/app/src/actions/ids.ts (Plan 02a — extend ActionId union)
    - packages/app/src/voice-control/voice-commands.ts (side-effect import location for actions registration)
    - packages/app/src/i18n/locales/en.json (existing settings.* keys to extend)
    - packages/app/src/i18n/locales/zh.json
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md "Copywriting Contract" lines 196-205
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-CONTEXT.md D-09, D-10, D-11, Q3 (NAV-A5 reachability audit)
  </read_first>
  <behavior>
    Test 1 (host-routes.test.ts): SETTINGS_BUCKETS contains exactly ["account","agents","voice","appearance","advanced"]
    Test 2: SLUG_TO_BUCKET maps every existing SettingsSectionSlug to exactly one bucket; no slug missing
    Test 3: buildSettingsBucketRoute("account") returns "/settings/bucket/account" (or whatever route shape is chosen — the path key)
    Test 4 (settings-actions.ts smoke): after import, actionRegistry has settings.open + 5 settings.open.{bucket} actions registered
    Test 5: actionRegistry.dispatch("settings.open.account") invokes router.push(buildSettingsBucketRoute("account"))
  </behavior>
  <action>
    Step 1 — Extend `packages/app/src/utils/host-routes.ts`. Add (do NOT remove or rename existing exports):

    ```typescript
    export const SETTINGS_BUCKETS = [
      "account", "agents", "voice", "appearance", "advanced",
    ] as const;
    export type SettingsBucket = (typeof SETTINGS_BUCKETS)[number];

    export function isSettingsBucket(value: string): value is SettingsBucket {
      return (SETTINGS_BUCKETS as readonly string[]).includes(value);
    }

    /**
     * Maps every existing SettingsSectionSlug to one of the 5 D-09 buckets.
     * Old paths (/settings/general, /settings/shortcuts, etc.) keep working — the
     * existing [section].tsx route looks up the bucket via this map and renders
     * the corresponding sub-page section. Nothing is removed (SET-01 / D-11).
     *
     * NAV-A5 reachability audit (CONTEXT Q3):
     * - account     ← (no current slug — new bucket; reachable from flat-list root)
     * - agents      ← integrations, permissions
     * - voice       ← (no current slug — new bucket; voice settings currently inline in general)
     * - appearance  ← general, shortcuts (theme + keyboard live in general today)
     * - advanced    ← labs, localDaemon, diagnostics, about, usage
     */
    export const SLUG_TO_BUCKET: Record<SettingsSectionSlug, SettingsBucket> = {
      general: "appearance",
      shortcuts: "advanced",
      integrations: "agents",
      permissions: "agents",
      usage: "advanced",
      labs: "advanced",
      localDaemon: "advanced",
      diagnostics: "advanced",
      about: "advanced",
    } as const;

    export function buildSettingsBucketRoute(bucket: SettingsBucket): `/settings/bucket/${SettingsBucket}` {
      return `/settings/bucket/${bucket}` as const;
    }

    export function resolveBucketForSlug(slug: SettingsSectionSlug): SettingsBucket {
      return SLUG_TO_BUCKET[slug];
    }
    ```

    Adjust the bucket assignments based on actual current settings inventory — read `packages/app/src/screens/settings/host-page.tsx` and `screens/settings/keyboard-shortcuts-section.tsx`, etc. to confirm what each slug currently exposes. The mapping above is the planner's recommendation; finalize during execution if any slug genuinely fits a different bucket.

    Step 2 — Create / extend `packages/app/src/utils/host-routes.test.ts` covering Tests 1-3. If a test file already exists, append the new describe block; do not duplicate existing tests.

    Step 3 — Extend `packages/app/src/actions/ids.ts` ActionId union with settings deep-link IDs:

    ```typescript
    // Append to ActionId union:
    | "settings.open.account"
    | "settings.open.agents"
    | "settings.open.voice"
    | "settings.open.appearance"
    | "settings.open.advanced"
    | "settings.open.labs"
    ```

    And update `ALL_ACTION_IDS` const list accordingly.

    Step 4 — Create `packages/app/src/actions/settings-actions.ts`:

    ```typescript
    import { z } from "zod";
    import { router } from "expo-router";
    import { actionRegistry, defineAction } from "@/actions/registry";
    import { buildSettingsBucketRoute, buildSettingsSectionRoute } from "@/utils/host-routes";

    const NoArgs = z.object({}).optional().default({});

    actionRegistry.register(defineAction("settings.open", {
      description: "Open settings",
      modalities: ["voice", "kbd", "cmdk", "menu"],
      schema: NoArgs,
      handler: () => { router.push("/settings"); },
    }));

    actionRegistry.register(defineAction("settings.open.account", {
      description: "Open Account settings",
      modalities: ["cmdk", "voice"],
      schema: NoArgs,
      handler: () => { router.push(buildSettingsBucketRoute("account")); },
    }));
    actionRegistry.register(defineAction("settings.open.agents", {
      description: "Open Agents settings",
      modalities: ["cmdk", "voice"],
      schema: NoArgs,
      handler: () => { router.push(buildSettingsBucketRoute("agents")); },
    }));
    actionRegistry.register(defineAction("settings.open.voice", {
      description: "Open Voice settings",
      modalities: ["cmdk", "voice"],
      schema: NoArgs,
      handler: () => { router.push(buildSettingsBucketRoute("voice")); },
    }));
    actionRegistry.register(defineAction("settings.open.appearance", {
      description: "Open Appearance settings",
      modalities: ["cmdk", "voice"],
      schema: NoArgs,
      handler: () => { router.push(buildSettingsBucketRoute("appearance")); },
    }));
    actionRegistry.register(defineAction("settings.open.advanced", {
      description: "Open Advanced settings",
      modalities: ["cmdk", "voice"],
      schema: NoArgs,
      handler: () => { router.push(buildSettingsBucketRoute("advanced")); },
    }));
    actionRegistry.register(defineAction("settings.open.labs", {
      description: "Open Labs settings",
      modalities: ["cmdk"],
      schema: NoArgs,
      handler: () => { router.push(buildSettingsSectionRoute("labs")); },
    }));
    ```

    Add side-effect import at the top of `packages/app/src/voice-control/voice-commands.ts`:

    ```typescript
    import "@/actions/settings-actions";
    ```

    Step 5 — Add i18n keys. en.json:

    ```json
    "settings.section.account": "Account",
    "settings.section.agents": "Agents",
    "settings.section.voice": "Voice",
    "settings.section.appearance": "Appearance",
    "settings.section.advanced": "Advanced",
    "settings.labs.experimental": "Experimental",
    "settings.labs.beta": "Beta",
    "settings.labs.stable": "Stable",
    "settings.labs.resetAll": "Reset all labs to default",
    "settings.labs.resetModalTitle": "Reset all Labs to default?",
    "settings.labs.resetModalBody": "Your individual experiment toggles will be cleared. Stable items keep their shipped defaults.",
    "settings.labs.resetConfirm": "Reset"
    ```

    zh.json:

    ```json
    "settings.section.account": "账户",
    "settings.section.agents": "Agents",
    "settings.section.voice": "语音",
    "settings.section.appearance": "外观",
    "settings.section.advanced": "高级",
    "settings.labs.experimental": "实验性",
    "settings.labs.beta": "公测",
    "settings.labs.stable": "稳定",
    "settings.labs.resetAll": "重置所有 Labs 为默认值",
    "settings.labs.resetModalTitle": "重置所有 Labs？",
    "settings.labs.resetModalBody": "所有实验项开关将被清除，Stable 项保留出厂默认。",
    "settings.labs.resetConfirm": "重置"
    ```

    Step 6 — Run `npm run format -- packages/app/src/utils/host-routes.ts packages/app/src/utils/host-routes.test.ts packages/app/src/actions/settings-actions.ts packages/app/src/actions/ids.ts packages/app/src/voice-control/voice-commands.ts packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/zh.json`.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q "SETTINGS_BUCKETS = \\[" packages/app/src/utils/host-routes.ts && \
      grep -q "\"account\"" packages/app/src/utils/host-routes.ts && \
      grep -q "\"agents\"" packages/app/src/utils/host-routes.ts && \
      grep -q "\"voice\"" packages/app/src/utils/host-routes.ts && \
      grep -q "\"appearance\"" packages/app/src/utils/host-routes.ts && \
      grep -q "\"advanced\"" packages/app/src/utils/host-routes.ts && \
      grep -q "SLUG_TO_BUCKET" packages/app/src/utils/host-routes.ts && \
      grep -q "buildSettingsBucketRoute" packages/app/src/utils/host-routes.ts && \
      grep -q "settings.open.account" packages/app/src/actions/settings-actions.ts && \
      grep -q "settings.open.advanced" packages/app/src/actions/settings-actions.ts && \
      grep -q "settings.open.labs" packages/app/src/actions/settings-actions.ts && \
      grep -q "import \"@/actions/settings-actions\"" packages/app/src/voice-control/voice-commands.ts && \
      grep -q "settings.section.account" packages/app/src/i18n/locales/en.json && \
      grep -q "settings.labs.experimental" packages/app/src/i18n/locales/en.json && \
      grep -q "settings.section.account" packages/app/src/i18n/locales/zh.json && \
      grep -q "账户" packages/app/src/i18n/locales/zh.json && \
      grep -q "外观" packages/app/src/i18n/locales/zh.json && \
      grep -q "实验性" packages/app/src/i18n/locales/zh.json && \
      npx vitest run packages/app/src/utils/host-routes.test.ts --bail=1 && \
      npm run typecheck && \
      npm run lint -- packages/app/src/utils/host-routes.ts packages/app/src/actions/settings-actions.ts packages/app/src/actions/ids.ts
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "SETTINGS_BUCKETS" packages/app/src/utils/host-routes.ts` returns ≥1
    - All 5 bucket strings present: account, agents, voice, appearance, advanced
    - `grep -c "SLUG_TO_BUCKET" packages/app/src/utils/host-routes.ts` returns ≥1
    - `grep -c "buildSettingsBucketRoute" packages/app/src/utils/host-routes.ts` returns ≥1
    - All 9 existing slugs present in SLUG_TO_BUCKET (general/shortcuts/integrations/permissions/usage/labs/localDaemon/diagnostics/about): each `grep -c "$slug:" packages/app/src/utils/host-routes.ts` returns ≥1
    - `grep -c "settings.open.account\\|settings.open.agents\\|settings.open.voice\\|settings.open.appearance\\|settings.open.advanced\\|settings.open.labs" packages/app/src/actions/settings-actions.ts` returns ≥6
    - Side-effect import wired in voice-commands.ts
    - All 5 settings.section.* keys + 3 labs badge keys + 3 labs-reset keys present in en.json AND zh.json
    - `npx vitest run packages/app/src/utils/host-routes.test.ts --bail=1` exits 0
    - `npm run typecheck` exits 0
    - Lint passes for changed files
  </acceptance_criteria>
  <done>SETTINGS_BUCKETS + slug→bucket map + cmd-K deep-link actions registered; en+zh parity for headers + labs badges</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build SettingsFlatList + SettingsGroup + SettingsRow + LabsRow + LabsBadge primitives; reorganize settings-screen.tsx into the 5-bucket flat list</name>
  <files>
    packages/app/src/components/settings/flat-list.tsx,
    packages/app/src/components/settings/group.tsx,
    packages/app/src/components/settings/row.tsx,
    packages/app/src/components/settings/labs-row.tsx,
    packages/app/src/components/settings/labs-badge.tsx,
    packages/app/src/screens/settings-screen.tsx,
    packages/app/src/i18n/locales/en.json,
    packages/app/src/i18n/locales/zh.json
  </files>
  <read_first>
    - packages/app/src/screens/settings/settings-section.tsx (analog: header + content shape, lines 1-51; PATTERNS lines 442-475)
    - packages/app/src/screens/settings-screen.tsx (FULL FILE — current shape; replace internals, keep the file)
    - packages/app/src/screens/settings/host-page.tsx (existing per-section sub-page — bucket sub-pages reuse this shape)
    - packages/app/src/components/ui/dropdown-menu.tsx (analog: DropdownMenuItem row pattern, lines 30-46)
    - packages/app/src/styles/settings.ts (existing settingsStyles.section / .card — reuse for visual rhythm)
    - packages/app/src/components/ui/status-badge.tsx (analog for LabsBadge — existing badge primitive)
    - packages/app/src/utils/host-routes.ts (just-added SETTINGS_BUCKETS + buildSettingsBucketRoute)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md "Component Inventory" lines 275-279 + "Color" lines 149-152 + "Typography" rules
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-CONTEXT.md D-09, D-10
  </read_first>
  <behavior>
    Test 1 (typecheck smoke): SettingsFlatList composes 5 SettingsGroup components, one per bucket
    Test 2: SettingsRow accepts a `bucket: SettingsBucket` + `slug: string` prop; onPress pushes via router.push(buildSettingsBucketRoute(bucket)) with section sub-route appended
    Test 3: LabsBadge renders 3 visual variants ('experimental' filled-warning, 'beta' outlined-warning, 'stable' filled-accent) per UI-SPEC line 149-152
    Test 4: settings-screen.tsx replaces its internals with <SettingsFlatList> at the root view
  </behavior>
  <action>
    Step 1 — Create `packages/app/src/components/settings/flat-list.tsx`:

    ```typescript
    import { useTranslation } from "react-i18next";
    import { ScrollView, View } from "react-native";
    import { StyleSheet } from "react-native-unistyles";
    import { SettingsGroup } from "@/components/settings/group";
    import { SettingsRow } from "@/components/settings/row";
    import { SETTINGS_BUCKETS } from "@/utils/host-routes";

    /**
     * <SettingsFlatList> — D-09 WeChat-style flat scrolling 5-bucket list.
     * Each bucket renders as <SettingsGroup> with N <SettingsRow> children.
     * The exact row inventory inside each bucket is sourced from the existing
     * settings screens — this component composes navigation entries only;
     * actual setting widgets live in the per-section sub-pages.
     */
    export function SettingsFlatList() {
      const { t } = useTranslation();
      return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <SettingsGroup title={t("settings.section.account")}>
            {/* Account-bucket rows: profile, identity, sign-out */}
            <SettingsRow bucket="account" slug="profile" label={t("settings.account.profile")} />
            <SettingsRow bucket="account" slug="identity" label={t("settings.account.identity")} />
          </SettingsGroup>

          <SettingsGroup title={t("settings.section.agents")}>
            {/* Agents-bucket rows: providers, permissions, integrations */}
            <SettingsRow bucket="agents" slug="integrations" label={t("settings.agents.integrations")} />
            <SettingsRow bucket="agents" slug="permissions" label={t("settings.agents.permissions")} />
          </SettingsGroup>

          <SettingsGroup title={t("settings.section.voice")}>
            <SettingsRow bucket="voice" slug="stt" label={t("settings.voice.stt")} />
            <SettingsRow bucket="voice" slug="tts" label={t("settings.voice.tts")} />
          </SettingsGroup>

          <SettingsGroup title={t("settings.section.appearance")}>
            <SettingsRow bucket="appearance" slug="theme" label={t("settings.appearance.theme")} />
            <SettingsRow bucket="appearance" slug="language" label={t("settings.appearance.language")} />
            <SettingsRow bucket="appearance" slug="general" label={t("settings.appearance.general")} />
            <SettingsRow bucket="appearance" slug="shortcuts" label={t("settings.appearance.shortcuts")} />
          </SettingsGroup>

          <SettingsGroup title={t("settings.section.advanced")}>
            <SettingsRow bucket="advanced" slug="labs" label={t("settings.labs.title")} />
            <SettingsRow bucket="advanced" slug="localDaemon" label={t("settings.advanced.localDaemon")} />
            <SettingsRow bucket="advanced" slug="diagnostics" label={t("settings.advanced.diagnostics")} />
            <SettingsRow bucket="advanced" slug="usage" label={t("settings.advanced.usage")} />
            <SettingsRow bucket="advanced" slug="about" label={t("settings.advanced.about")} />
          </SettingsGroup>
        </ScrollView>
      );
    }

    const styles = StyleSheet.create((theme) => ({
      container: { flex: 1, backgroundColor: theme.colors.surfaceBackground },
      content: { paddingVertical: theme.spacing[6], gap: theme.spacing[6] },
    }));
    ```

    Step 1b — Add the en+zh settings-row label keys IN THIS TASK ACTION (closes checker W3 — do NOT defer to executor). Append to `packages/app/src/i18n/locales/en.json`:

    ```json
    "settings.account.profile": "Profile",
    "settings.account.identity": "Identity",
    "settings.agents.integrations": "Integrations",
    "settings.agents.permissions": "Permissions",
    "settings.voice.stt": "Speech-to-text",
    "settings.voice.tts": "Text-to-speech",
    "settings.appearance.theme": "Theme",
    "settings.appearance.language": "Language",
    "settings.appearance.general": "General",
    "settings.appearance.shortcuts": "Keyboard shortcuts",
    "settings.advanced.localDaemon": "Local daemon",
    "settings.advanced.diagnostics": "Diagnostics",
    "settings.advanced.usage": "Usage",
    "settings.advanced.about": "About",
    "settings.labs.title": "Labs"
    ```

    Append the matching zh.json entries (CLAUDE.md hard rule — bilingual parity in the SAME task):

    ```json
    "settings.account.profile": "个人资料",
    "settings.account.identity": "身份",
    "settings.agents.integrations": "集成",
    "settings.agents.permissions": "权限",
    "settings.voice.stt": "语音识别",
    "settings.voice.tts": "语音合成",
    "settings.appearance.theme": "主题",
    "settings.appearance.language": "语言",
    "settings.appearance.general": "通用",
    "settings.appearance.shortcuts": "快捷键",
    "settings.advanced.localDaemon": "本地 daemon",
    "settings.advanced.diagnostics": "诊断",
    "settings.advanced.usage": "用量",
    "settings.advanced.about": "关于",
    "settings.labs.title": "Labs"
    ```

    If any of these keys are ALREADY present (e.g. legacy from Phase 1), do NOT duplicate — reuse the existing key. Search both files first via `grep -n "settings.account.profile" packages/app/src/i18n/locales/en.json` etc. Only add the missing ones. Bilingual parity is non-negotiable: every key landing in en.json MUST have a parallel value in zh.json before this task is considered complete.

    Step 2 — Create `packages/app/src/components/settings/group.tsx` (copy from settings-section.tsx analog with refined typography per UI-SPEC line 94 — group header is `theme.fontSize.sm` + `weight.semibold` + `theme.text.primary`):

    ```typescript
    import { type ReactNode } from "react";
    import { Text, View } from "react-native";
    import { StyleSheet, useUnistyles } from "react-native-unistyles";

    export interface SettingsGroupProps {
      title: string;
      children: ReactNode;
      testID?: string;
    }

    export function SettingsGroup({ title, children, testID }: SettingsGroupProps) {
      const { theme } = useUnistyles();
      return (
        <View style={styles.section} testID={testID}>
          <Text style={styles.header}>{title}</Text>
          <View style={styles.content}>{children}</View>
        </View>
      );
    }

    const styles = StyleSheet.create((theme) => ({
      section: { marginHorizontal: theme.spacing[4] },
      header: {
        fontSize: theme.fontSize.sm,
        fontWeight: theme.fontWeight.semibold,
        color: theme.colors.foreground,
        marginBottom: theme.spacing[2],
        marginLeft: theme.spacing[1],
      },
      content: {
        backgroundColor: theme.colors.surfaceElevated,
        borderRadius: theme.radius.card,
        overflow: "hidden",
      },
    }));
    ```

    Step 3 — Create `packages/app/src/components/settings/row.tsx`:

    ```typescript
    import { Pressable, Text, View } from "react-native";
    import { ChevronRight } from "lucide-react-native";
    import { StyleSheet, useUnistyles } from "react-native-unistyles";
    import { router } from "expo-router";
    import { buildSettingsBucketRoute, type SettingsBucket } from "@/utils/host-routes";

    export interface SettingsRowProps {
      bucket: SettingsBucket;
      slug: string;
      label: string;
      hint?: string;
      testID?: string;
      onPressOverride?(): void;
    }

    export function SettingsRow({ bucket, slug, label, hint, testID, onPressOverride }: SettingsRowProps) {
      const { theme } = useUnistyles();
      const handlePress = onPressOverride ?? (() => {
        // Sub-page route follows existing /settings/[section] convention but resolves bucket via SLUG_TO_BUCKET in [section].tsx
        router.push(`/settings/${slug}` as never);
      });
      return (
        <Pressable
          testID={testID ?? `settings-row-${slug}`}
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={handlePress}
          style={styles.row}
        >
          <View style={styles.body}>
            <Text style={styles.label}>{label}</Text>
            {hint != null ? <Text style={styles.hint}>{hint}</Text> : null}
          </View>
          <ChevronRight
            size={18}
            color={theme.colors.foregroundMuted}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </Pressable>
      );
    }

    const styles = StyleSheet.create((theme) => ({
      row: {
        flexDirection: "row", alignItems: "center", gap: theme.spacing[3],
        paddingVertical: theme.spacing[3], paddingHorizontal: theme.spacing[4],
        minHeight: 48,
      },
      body: { flex: 1 },
      label: { fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.normal, color: theme.colors.foreground },
      hint: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.normal, color: theme.colors.foregroundMuted, marginTop: theme.spacing[1] },
    }));
    ```

    Step 4 — Create `packages/app/src/components/settings/labs-badge.tsx`:

    ```typescript
    import { Text, View } from "react-native";
    import { StyleSheet, useUnistyles } from "react-native-unistyles";
    import { useTranslation } from "react-i18next";

    export type LabsStability = "experimental" | "beta" | "stable";

    export interface LabsBadgeProps { stability: LabsStability; testID?: string }

    export function LabsBadge({ stability, testID }: LabsBadgeProps) {
      const { t } = useTranslation();
      const { theme } = useUnistyles();
      // UI-SPEC lines 149-152:
      // Experimental — filled amber (statusWarning fill)
      // Beta         — outline amber (statusWarning border, no fill)
      // Stable       — filled accent green (statusSuccess fill)
      const styleVariant =
        stability === "experimental" ? styles.experimental :
        stability === "beta" ? styles.beta :
        styles.stable;
      const labelKey =
        stability === "experimental" ? "settings.labs.experimental" :
        stability === "beta" ? "settings.labs.beta" :
        "settings.labs.stable";
      return (
        <View testID={testID} style={[styles.base, styleVariant]}>
          <Text style={styles.label}>{t(labelKey)}</Text>
        </View>
      );
    }

    const styles = StyleSheet.create((theme) => ({
      base: {
        paddingHorizontal: theme.spacing[2],
        paddingVertical: theme.spacing[1],
        borderRadius: theme.radius.button,
      },
      experimental: { backgroundColor: theme.colors.statusWarning ?? theme.colors.warning },
      beta: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.colors.statusWarning ?? theme.colors.warning },
      stable: { backgroundColor: theme.colors.statusSuccess ?? theme.colors.accentBase },
      label: { fontSize: theme.fontSize.xs, fontWeight: theme.fontWeight.semibold, color: theme.colors.surfaceBackground },
    }));
    ```

    Step 5 — Create `packages/app/src/components/settings/labs-row.tsx`:

    ```typescript
    import { Pressable, Text, View } from "react-native";
    import { StyleSheet, useUnistyles } from "react-native-unistyles";
    import { LabsBadge, type LabsStability } from "@/components/settings/labs-badge";
    import { SegmentedControl } from "@/components/ui/segmented-control";

    export interface LabsRowProps {
      title: string;
      description: string;
      stability: LabsStability;
      enabled: boolean;
      onToggle(value: boolean): void;
      testID?: string;
    }

    export function LabsRow({ title, description, stability, enabled, onToggle, testID }: LabsRowProps) {
      const { theme } = useUnistyles();
      return (
        <View testID={testID} style={styles.row}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{title}</Text>
              <LabsBadge stability={stability} />
            </View>
            <Text style={styles.description}>{description}</Text>
          </View>
          <SegmentedControl
            size="sm"
            value={enabled ? "on" : "off"}
            onValueChange={(v) => onToggle(v === "on")}
            options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]}
          />
        </View>
      );
    }

    const styles = StyleSheet.create((theme) => ({
      row: { paddingVertical: theme.spacing[3], paddingHorizontal: theme.spacing[4], gap: theme.spacing[2] },
      header: { gap: theme.spacing[1] },
      titleRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
      title: { fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.normal, color: theme.colors.foreground },
      description: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.normal, color: theme.colors.foregroundMuted },
    }));
    ```

    Step 6 — Reorganize `packages/app/src/screens/settings-screen.tsx`. Replace the existing root render with `<SettingsFlatList>`:

    ```typescript
    import { View } from "react-native";
    import { StyleSheet, useUnistyles } from "react-native-unistyles";
    import { SettingsFlatList } from "@/components/settings/flat-list";
    import type { SettingsScreenView } from "./settings/host-page"; // existing per-section sub-page host

    export interface SettingsScreenProps {
      view: SettingsScreenView; // existing discriminated union
    }

    export function SettingsScreen({ view }: SettingsScreenProps) {
      const { theme } = useUnistyles();
      // The existing screen routes by `view.kind === "section" | "root"`. Render:
      // - root → SettingsFlatList
      // - section → existing sub-page renderer (preserve behavior — no breaking change)
      if (view.kind === "root") {
        return (
          <View style={styles.container}>
            <SettingsFlatList />
          </View>
        );
      }
      // Preserve existing section rendering verbatim (sub-pages keep using settings-section.tsx + per-section components)
      return /* existing section render path — keep as-is */;
    }
    ```

    Adapt to the existing `view` discriminator shape — read the file first to confirm the exact prop type; do not silently rename. The change is: when `view` represents the settings root, render `<SettingsFlatList>` instead of the legacy section list.

    Step 7 — Run `npm run format -- packages/app/src/components/settings/*.tsx packages/app/src/screens/settings-screen.tsx`.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q "SettingsFlatList" packages/app/src/components/settings/flat-list.tsx && \
      grep -q "SETTINGS_BUCKETS\\|settings.section.account" packages/app/src/components/settings/flat-list.tsx && \
      grep -q "SettingsGroup" packages/app/src/components/settings/group.tsx && \
      grep -q "fontWeight: theme.fontWeight.semibold" packages/app/src/components/settings/group.tsx && \
      grep -q "settings.account.profile" packages/app/src/i18n/locales/en.json && \
      grep -q "settings.account.profile" packages/app/src/i18n/locales/zh.json && \
      grep -q "settings.appearance.theme" packages/app/src/i18n/locales/zh.json && \
      grep -q "settings.advanced.localDaemon" packages/app/src/i18n/locales/zh.json && \
      grep -q "个人资料" packages/app/src/i18n/locales/zh.json && \
      grep -q "本地 daemon" packages/app/src/i18n/locales/zh.json && \
      grep -q "ChevronRight" packages/app/src/components/settings/row.tsx && \
      grep -q "buildSettingsBucketRoute\\|router.push" packages/app/src/components/settings/row.tsx && \
      grep -q "experimental\\|beta\\|stable" packages/app/src/components/settings/labs-badge.tsx && \
      grep -q "settings.labs.experimental" packages/app/src/components/settings/labs-badge.tsx && \
      grep -q "LabsBadge" packages/app/src/components/settings/labs-row.tsx && \
      grep -q "SegmentedControl" packages/app/src/components/settings/labs-row.tsx && \
      grep -q "SettingsFlatList" packages/app/src/screens/settings-screen.tsx && \
      npm run typecheck && \
      npm run lint -- packages/app/src/components/settings/flat-list.tsx packages/app/src/components/settings/group.tsx packages/app/src/components/settings/row.tsx packages/app/src/components/settings/labs-row.tsx packages/app/src/components/settings/labs-badge.tsx packages/app/src/screens/settings-screen.tsx
    </automated>
  </verify>
  <acceptance_criteria>
    - 5 new component files exist under `packages/app/src/components/settings/`
    - `grep -c "SettingsFlatList" packages/app/src/components/settings/flat-list.tsx` returns ≥1
    - All 5 settings.section.* keys referenced inside flat-list.tsx
    - `grep -c "fontWeight: theme.fontWeight.semibold" packages/app/src/components/settings/group.tsx` returns ≥1 (UI-SPEC line 94 group header)
    - `grep -c "ChevronRight" packages/app/src/components/settings/row.tsx` returns ≥1
    - `grep -c "accessibilityElementsHidden" packages/app/src/components/settings/row.tsx` returns ≥1 (chevron decorative)
    - `grep -c "experimental\\|beta\\|stable" packages/app/src/components/settings/labs-badge.tsx` returns ≥3
    - `grep -c "borderWidth: 1" packages/app/src/components/settings/labs-badge.tsx` returns ≥1 (Beta outline variant)
    - `grep -c "SegmentedControl" packages/app/src/components/settings/labs-row.tsx` returns ≥1
    - `grep -c "SettingsFlatList" packages/app/src/screens/settings-screen.tsx` returns ≥1
    - All 15 settings-row label keys present in EN AND ZH (W3 — bilingual parity inline): `for k in settings.account.profile settings.account.identity settings.agents.integrations settings.agents.permissions settings.voice.stt settings.voice.tts settings.appearance.theme settings.appearance.language settings.appearance.general settings.appearance.shortcuts settings.advanced.localDaemon settings.advanced.diagnostics settings.advanced.usage settings.advanced.about settings.labs.title; do grep -q "$k" packages/app/src/i18n/locales/en.json && grep -q "$k" packages/app/src/i18n/locales/zh.json || echo "MISS: $k"; done` returns no MISS lines
    - `npm run typecheck` exits 0
    - Lint passes for all 6 files
  </acceptance_criteria>
  <done>5 settings primitives + reshaped settings-screen exist; types/lint clean</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Refactor existing labs-section.tsx into a registry-driven LabsRow array; persist opt-in via existing useAppSettings BetaFeatureSettings extension</name>
  <files>
    packages/app/src/screens/settings/labs-section.tsx,
    packages/app/src/hooks/use-settings.ts
  </files>
  <read_first>
    - packages/app/src/screens/settings/labs-section.tsx (FULL FILE — currently 937 lines, hand-rolled rows; PATTERNS lines 491-512)
    - packages/app/src/hooks/use-settings.ts lines 1-91 (existing AppSettings + BetaFeatureSettings — extend, do not break compatibility)
    - packages/app/src/components/settings/labs-row.tsx (Task 2 sibling)
    - packages/app/src/components/settings/labs-badge.tsx (Task 2 sibling)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-CONTEXT.md D-10 (each row has stability + name + description + opt-in toggle; bottom "Reset all labs to default")
  </read_first>
  <behavior>
    Test 1 (typecheck smoke): labs-section.tsx exports a LABS_REGISTRY const array with stability + title + description + settings-key per entry
    Test 2: Each entry maps to an existing BetaFeatureSettings flag; toggling LabsRow updates AppSettings via setSettings
    Test 3: Reset button resets every flag to its shipped default
  </behavior>
  <action>
    Step 1 — Read the existing labs-section.tsx (937 lines). Identify each currently-wired experiment (Voice / Permission UX / Optimistic-UI / Math-Curve / etc.) — there are likely ~5-8 hand-rolled cards. Each card maps to a flag inside `BetaFeatureSettings` (`hooks/use-settings.ts` lines 45-47). Inventory them.

    Step 2 — Refactor `packages/app/src/screens/settings/labs-section.tsx` into a registry-driven shape. Replace the per-experiment hand-rolled `<View style={settingsStyles.card}>` blocks with a single `LABS_REGISTRY` array + `.map()` → `<LabsRow>`:

    ```typescript
    import { useTranslation } from "react-i18next";
    import { ScrollView, View, Pressable, Text } from "react-native";
    import { StyleSheet, useUnistyles } from "react-native-unistyles";
    import { LabsRow } from "@/components/settings/labs-row";
    import { type LabsStability } from "@/components/settings/labs-badge";
    import { useAppSettings } from "@/hooks/use-settings";

    interface LabsEntry {
      id: string;
      stability: LabsStability;
      titleKey: string;
      descriptionKey: string;
      // Maps to a path inside AppSettings.betaFeatures (e.g. "voice", "optimisticAgent")
      settingsKey: keyof NonNullable<import("@/hooks/use-settings").AppSettings["betaFeatures"]>;
      defaultEnabled: boolean;
    }

    /**
     * LABS_REGISTRY — author-set in code per CONTEXT D-10.
     * Adding a new experiment = adding a row here + extending BetaFeatureSettings.
     * Stability labels (Experimental / Beta / Stable) are author judgment, not daemon-driven.
     */
    const LABS_REGISTRY: readonly LabsEntry[] = [
      // Inventory pulled from existing labs-section.tsx — adapt to actual shipped flags:
      // { id: "voice", stability: "beta", titleKey: "settings.labsVoice.title", descriptionKey: "settings.labsVoice.description", settingsKey: "voice", defaultEnabled: false },
      // ...add one entry per existing card found during the file read.
    ];

    export function LabsSection() {
      const { t } = useTranslation();
      const { theme } = useUnistyles();
      const { settings, setSettings } = useAppSettings();

      const handleToggle = (entry: LabsEntry, value: boolean) => {
        setSettings({
          ...settings,
          betaFeatures: { ...(settings.betaFeatures ?? {}), [entry.settingsKey]: value },
        } as typeof settings);
      };

      const handleResetAll = () => {
        const reset = LABS_REGISTRY.reduce<Record<string, boolean>>((acc, entry) => {
          acc[entry.settingsKey] = entry.defaultEnabled;
          return acc;
        }, {});
        setSettings({ ...settings, betaFeatures: reset } as typeof settings);
      };

      return (
        <ScrollView contentContainerStyle={styles.content}>
          {LABS_REGISTRY.map((entry) => {
            const enabled = (settings.betaFeatures?.[entry.settingsKey as keyof typeof settings.betaFeatures] as boolean | undefined)
              ?? entry.defaultEnabled;
            return (
              <LabsRow
                key={entry.id}
                title={t(entry.titleKey)}
                description={t(entry.descriptionKey)}
                stability={entry.stability}
                enabled={enabled}
                onToggle={(v) => handleToggle(entry, v)}
                testID={`labs-row-${entry.id}`}
              />
            );
          })}
          <Pressable
            testID="labs-reset-all"
            accessibilityRole="button"
            accessibilityLabel={t("settings.labs.resetAll")}
            onPress={handleResetAll}
            style={styles.resetButton}
          >
            <Text style={styles.resetLabel}>{t("settings.labs.resetAll")}</Text>
          </Pressable>
        </ScrollView>
      );
    }

    const styles = StyleSheet.create((theme) => ({
      content: { paddingVertical: theme.spacing[4], gap: theme.spacing[2] },
      resetButton: { paddingVertical: theme.spacing[3], paddingHorizontal: theme.spacing[4], alignItems: "center", marginTop: theme.spacing[6] },
      resetLabel: { fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.normal, color: theme.colors.statusDestructive ?? theme.colors.danger },
    }));
    ```

    Step 3 — When inventorying existing experiments, populate `LABS_REGISTRY` with ALL of them. CRITICAL: the migration is **additive** (D-11 / SET-01 — nothing removed). Every existing flag in `BetaFeatureSettings` becomes a registry entry. If a flag's title/description key doesn't exist (the prior hand-rolled rows hardcoded copy), add the new keys to en+zh.json — preserve the user-visible copy verbatim.

    Step 4 — If `BetaFeatureSettings` doesn't yet contain entries for some experiments, extend the interface in `packages/app/src/hooks/use-settings.ts`:

    ```typescript
    export interface BetaFeatureSettings {
      voice?: boolean;
      // ...existing flags retained...
      // Optionally add new entries; ALL fields stay optional with default behavior preserved
    }
    ```

    Verify backward-compatibility: existing user persisted settings must continue to resolve to their previous behavior. Default values for new fields should mirror what the hand-rolled card defaulted to.

    Step 5 — Run `npm run format -- packages/app/src/screens/settings/labs-section.tsx packages/app/src/hooks/use-settings.ts`.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q "LABS_REGISTRY" packages/app/src/screens/settings/labs-section.tsx && \
      grep -q "LabsRow" packages/app/src/screens/settings/labs-section.tsx && \
      grep -q "stability:" packages/app/src/screens/settings/labs-section.tsx && \
      grep -q "settings.labs.resetAll" packages/app/src/screens/settings/labs-section.tsx && \
      grep -q "labs-reset-all" packages/app/src/screens/settings/labs-section.tsx && \
      grep -q "useAppSettings" packages/app/src/screens/settings/labs-section.tsx && \
      grep -q "BetaFeatureSettings" packages/app/src/hooks/use-settings.ts && \
      npm run typecheck && \
      npm run lint -- packages/app/src/screens/settings/labs-section.tsx packages/app/src/hooks/use-settings.ts
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "LABS_REGISTRY" packages/app/src/screens/settings/labs-section.tsx` returns ≥1
    - `grep -c "LabsRow" packages/app/src/screens/settings/labs-section.tsx` returns ≥1
    - `grep -c "stability:" packages/app/src/screens/settings/labs-section.tsx` returns ≥1 (registry entries with stability field)
    - `grep -c "labs-reset-all" packages/app/src/screens/settings/labs-section.tsx` returns 1
    - `grep -c "useAppSettings" packages/app/src/screens/settings/labs-section.tsx` returns ≥1
    - `wc -l < packages/app/src/screens/settings/labs-section.tsx` returns ≤300 (down from 937 — collapsed into registry)
    - `npm run typecheck` exits 0
    - Lint passes
    - Backward-compat: any user with prior `betaFeatures.X = true` in AsyncStorage still sees row toggled on
  </acceptance_criteria>
  <done>Labs section is registry-driven with reset-all button; hand-rolled rows replaced; existing flags preserved</done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary                                   | Description                                                   |
| ------------------------------------------ | ------------------------------------------------------------- |
| URL deep-link → settings sub-page          | /settings/{slug} accepts a slug param; map resolves to bucket |
| Labs opt-in toggle → AppSettings           | Local flag mutation only; no daemon round-trip                |
| settings.open.{bucket} cmd-K → router.push | ActionRegistry dispatch path                                  |

## STRIDE Threat Register

| Threat ID | Category                   | Component                             | Disposition | Mitigation Plan                                                                                                                                                                                                                                                                                                                              |
| --------- | -------------------------- | ------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-02d-01  | E (Elevation of Privilege) | URL param-driven labs toggle          | mitigate    | Labs opt-in toggle is set via `setSettings({ ...settings, betaFeatures: { ...flag } })` — no URL-param or query-string code path can flip a labs flag. Deep-link `/settings/labs` only navigates; toggling requires user-initiated `<SegmentedControl>` interaction. AsyncStorage namespace is `@ottie:app-settings` (Phase 1 D-08 reserved) |
| T-02d-02  | I (Information Disclosure) | Settings sub-page route params        | mitigate    | Sub-page routes accept only `slug` (a string from `SettingsSectionSlug` union); `isSettingsSectionSlug` validates input. No setting _value_ is leaked via URL. Existing route's [section].tsx already enforces this; SLUG_TO_BUCKET resolution happens server-side in component code                                                         |
| T-02d-03  | T (Tampering)              | settings.open.{bucket} cmd-K dispatch | mitigate    | The dispatch handler is a fixed `router.push(buildSettingsBucketRoute(...))` — no user-supplied URL fragment is concatenated. Action payload schema is `NoArgs` so even if a malicious cmd-K input attempted to inject a URL, the schema would reject it                                                                                     |
| T-02d-04  | E (Elevation of Privilege) | Reset-all button                      | accept      | Reset writes default values to local AppSettings only. No privilege boundary; user-initiated                                                                                                                                                                                                                                                 |
| T-02d-05  | I (Information Disclosure) | Old settings paths still working      | accept      | Backward compat is the goal (D-11). Existing slugs route through the existing [section].tsx; SLUG_TO_BUCKET only adds a forward-mapping. No new disclosure surface                                                                                                                                                                           |

No HIGH severity threats. Per CONTEXT security guidance: "Labs opt-in flags must persist with the existing `@ottie:` AsyncStorage namespace and not be set from URL params" — confirmed: this plan reuses `@ottie:app-settings` via `useAppSettings`, never sets flags from URL.
</threat_model>

<verification>
- All 3 task verify blocks pass
- `npx vitest run packages/app/src/utils/host-routes.test.ts --bail=1` exits 0
- `npm run typecheck` exits 0
- `npm run lint -- packages/app/src/utils/host-routes.ts packages/app/src/components/settings/ packages/app/src/screens/settings-screen.tsx packages/app/src/screens/settings/labs-section.tsx packages/app/src/actions/settings-actions.ts packages/app/src/hooks/use-settings.ts packages/app/src/voice-control/voice-commands.ts` exits 0
- `npm run format:check -- packages/app/src/utils/host-routes.ts packages/app/src/components/settings/flat-list.tsx packages/app/src/components/settings/group.tsx packages/app/src/components/settings/row.tsx packages/app/src/components/settings/labs-row.tsx packages/app/src/components/settings/labs-badge.tsx packages/app/src/screens/settings-screen.tsx packages/app/src/screens/settings/labs-section.tsx packages/app/src/actions/settings-actions.ts packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/zh.json` exits 0
- NAV-A5 reachability table comment block exists in host-routes.ts (above SLUG_TO_BUCKET)
- All 9 existing settings slugs resolved to one of the 5 buckets in SLUG_TO_BUCKET
- Old setting paths still navigable (smoke: `router.push("/settings/general")` lands on the appearance bucket sub-page)
</verification>

<success_criteria>

- SETTINGS_BUCKETS exports the 5-tuple: account / agents / voice / appearance / advanced
- SLUG_TO_BUCKET maps every existing SettingsSectionSlug to a bucket; nothing removed (SET-01)
- buildSettingsBucketRoute(bucket) returns a typed route string
- 6 new ActionIds registered: settings.open + settings.open.{account|agents|voice|appearance|advanced} + settings.open.labs (SET-03 ≤2 taps via cmd-K)
- 5 new settings primitives exist (flat-list / group / row / labs-row / labs-badge)
- Settings root renders <SettingsFlatList> with 5 group headers (D-09)
- Labs section is registry-driven with stability badges + per-row opt-in + reset-all (D-10 / SET-04)
- Backward compatibility: old paths (/settings/general etc.) keep working via SLUG_TO_BUCKET resolution
- en.json + zh.json contain 5 group headers + 3 labs badges + 3 labs-reset keys (with full Chinese parity)
- All acceptance criteria + verification commands pass
  </success_criteria>

<output>
Create `.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02d-settings-ia-SUMMARY.md`. Document: the SLUG_TO_BUCKET map (NAV-A5 reachability table — every legacy slug → bucket assignment with rationale), the 6 new settings.open.* ActionIds, and any deferred decisions (per-row settings copy that wasn't yet keyed).
</output>
