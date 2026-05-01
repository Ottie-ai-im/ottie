---
phase: 02-onboarding-navigation-settings-theme-native-feel-polish
plan: 02b
type: execute
wave: 2
depends_on: [02a]
files_modified:
  - packages/app/src/stores/onboarding-state-store.ts
  - packages/app/src/stores/onboarding-state-store.test.ts
  - packages/app/src/components/welcome-screen.tsx
  - packages/app/src/app/welcome.tsx
  - packages/app/src/app/pair-scan.tsx
  - packages/app/src/components/pair-scan-recovery-callout.tsx
  - packages/app/src/i18n/locales/en.json
  - packages/app/src/i18n/locales/zh.json
autonomous: true
requirements: [ONB-01, ONB-02, ONB-03, ONB-04]
tags: [phase-02, onboarding, welcome, pair-scan]
must_haves:
  truths:
    - "First-ever launch shows Welcome with Otter, en/zh, two CTAs ('Get started' + 'Skip for power users') and a 'Don't show this again' checkbox"
    - "Skip button (or Don't-show-again-then-Get-started) sets a persisted flag; subsequent launches go straight to Chats tab without rendering Welcome"
    - "Pair-scan failure renders inline <CalloutCard variant='error'> below the QR / manual-entry surface — no Alert.alert, no app restart"
    - "Pair-scan recovery actions (regenerate code, manual key entry, switch to local daemon) preserve the user's typed input across attempts"
    - "Local-bundled-daemon detection skips pair-scan entirely on desktop / same-machine paths (Tauri); on iOS/Android the 'switch to local daemon' option shows 'available on desktop only'"
  artifacts:
    - path: "packages/app/src/stores/onboarding-state-store.ts"
      provides: "Zustand + AsyncStorage persistence of welcomeShown / delight flags / first-time-empty flags"
      exports: ["useOnboardingStateStore", "ONBOARDING_STATE_STORAGE_KEY"]
    - path: "packages/app/src/components/welcome-screen.tsx"
      provides: "Extended welcome with Skip CTA + Don't show again checkbox"
      contains: "skipForPowerUsers"
    - path: "packages/app/src/app/welcome.tsx"
      provides: "Route that consults welcomeShown flag and redirects if true"
    - path: "packages/app/src/app/pair-scan.tsx"
      provides: "Modified pair-scan with inline CalloutCard recovery (no Alert.alert)"
    - path: "packages/app/src/components/pair-scan-recovery-callout.tsx"
      provides: "Recovery callout component with 3 inline actions"
  key_links:
    - from: "packages/app/src/components/welcome-screen.tsx"
      to: "packages/app/src/stores/onboarding-state-store.ts"
      via: "useOnboardingStateStore.getState().setWelcomeShown(true)"
      pattern: "setWelcomeShown\\(true\\)"
    - from: "packages/app/src/app/welcome.tsx"
      to: "packages/app/src/stores/onboarding-state-store.ts"
      via: "Reads welcomeShown — redirects to host-sessions or workspace if true"
      pattern: "welcomeShown"
    - from: "packages/app/src/app/pair-scan.tsx"
      to: "packages/app/src/components/pair-scan-recovery-callout.tsx"
      via: "Renders below scanner on error state with preserved input"
      pattern: "PairScanRecoveryCallout"
---

<objective>
Reconcile ONB-01..04 with the WeChat-style cold-open default. First-ever launch renders Welcome (en/zh, Otter, two paragraphs, two CTAs + a checkbox); subsequent launches go straight to the Chats tab. Pair-scan failures render inline self-serve recovery (regenerate / manual key / switch to local daemon) without Alert.alert and with typed-input preservation.

Purpose: Without persisted welcomeShown, the user sees Welcome on every launch — incompatible with D-02 cold-open. Without inline recovery, ONB-03's "no app restart, no lost input" cannot hold; the existing `Alert.alert` (line 193 of pair-scan.tsx) blocks the screen and discards typed manual-entry state.

Output: 1 new persisted Zustand store + test, extended Welcome screen, modified Welcome route, modified pair-scan route, 1 new recovery callout component, en+zh locale entries from UI-SPEC §Copywriting Contract.
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
<!-- Existing zustand persist + AsyncStorage pattern (analog) -->
<!-- Source: packages/app/src/stores/draft-store.ts:1-14 -->

```typescript
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DRAFT_STORE_VERSION = 4;
// ... persist middleware with name + storage + version
```

<!-- Existing welcome screen actions array (extend it) -->
<!-- Source: packages/app/src/components/welcome-screen.tsx:210-254 -->

```typescript
const actions: WelcomeAction[] = isWeb
  ? [
      { key: "direct-connection", label: t("welcome.openOnDesktop"), testID: "welcome-direct-connection",
        primary: true, icon: Link2, onPress: handleOpenDirect },
      { key: "paste-pairing-link", label: t("welcome.pasteLink"), testID: "welcome-paste-pairing-link",
        primary: false, icon: ClipboardPaste, onPress: handleOpenPasteLink },
    ]
  : [
      { key: "scan-qr", label: t("welcome.scanQr"), ... },
    ];
```

<!-- CalloutCard primitive — already supports variant="error" -->
<!-- Source: packages/app/src/components/callout-card.tsx -->

```typescript
export interface CalloutCardProps {
  title: string;
  description?: string | ReactNode;
  icon?: ReactNode;
  variant?: "default" | "error" | "warning" | "success";
  actions?: CalloutAction[];
  onDismiss?: () => void;
  testID?: string;
}
export function CalloutCard(props: CalloutCardProps): JSX.Element;
```

<!-- Existing pair-scan failure path (REPLACE Alert.alert at line 193) -->
<!-- Source: packages/app/src/app/pair-scan.tsx:160-198 -->

```typescript
const handleScan = useCallback(async (result) => {
  // ...
  try {
    await pairing logic;
    navigateToPairedHost(profile.serverId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to pair host";
    Alert.alert("Error", message); // ← REPLACE with inline state + <PairScanRecoveryCallout>
  }
}, [...]);
```

<!-- Local-bundled-daemon detection (existing — Plan only consumes) -->
<!-- Source: packages/app/src/desktop/daemon/desktop-daemon.ts:113 -->

```typescript
export function shouldUseDesktopDaemon(): boolean; // returns getIsElectron()
```

<!-- Sessions route builder (Welcome redirect destination) -->
<!-- Source: packages/app/src/utils/host-routes.ts -->

```typescript
export function buildHostSessionsRoute(serverId: string): string;
```

<!-- useHaptic from Plan 02a — Welcome 'Get started' tap fires medium -->
<!-- Source: packages/app/src/hooks/use-haptic.ts -->

```typescript
export function useHaptic(input: { enabled: boolean; isLowPowerMode: boolean }): {
  fire: (e: HapticEvent) => void;
};
```

</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create persisted OnboardingStateStore (Zustand + AsyncStorage)</name>
  <files>
    packages/app/src/stores/onboarding-state-store.ts,
    packages/app/src/stores/onboarding-state-store.test.ts
  </files>
  <read_first>
    - packages/app/src/stores/draft-store.ts (analog: persist + AsyncStorage + version pattern, full file)
    - packages/app/src/stores/mobile-quick-action-store.ts (analog: simple zustand shape, lines 1-26)
    - packages/app/src/hooks/use-settings.ts lines 1-7 (existing `@ottie:` storage key convention)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-PATTERNS.md section "packages/app/src/stores/onboarding-state-store.ts"
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-CONTEXT.md D-17 + D-21
  </read_first>
  <behavior>
    Test 1: Initial state — welcomeShown=false, all delight flags=false, all empty-Ottie flags=false
    Test 2: setWelcomeShown(true) updates welcomeShown to true and welcomeShownAt to a number
    Test 3: setDelightFiredFirstAgent(true) is idempotent (calling twice still resolves to true with no error)
    Test 4: After hydration from AsyncStorage with prior value, welcomeShown reflects persisted value
    Test 5: Persistence key is exactly "@ottie:onboarding-state"
  </behavior>
  <action>
    Create `packages/app/src/stores/onboarding-state-store.ts` per PATTERNS lines 568-621:

    ```typescript
    import { create } from "zustand";
    import { createJSONStorage, persist } from "zustand/middleware";
    import AsyncStorage from "@react-native-async-storage/async-storage";

    export const ONBOARDING_STATE_STORAGE_KEY = "@ottie:onboarding-state";
    const ONBOARDING_STORE_VERSION = 1;

    interface OnboardingState {
      welcomeShown: boolean;
      welcomeShownAt: number | null;
      delightFiredFirstAgent: boolean;
      delightFiredFirstPermission: boolean;
      delightFiredFirstVoice: boolean;
      emptyOttiePlayedFirstWorkspace: boolean;
      emptyOttiePlayedFirstChats: boolean;
    }

    interface OnboardingActions {
      setWelcomeShown(value: boolean): void;
      setDelightFiredFirstAgent(value: boolean): void;
      setDelightFiredFirstPermission(value: boolean): void;
      setDelightFiredFirstVoice(value: boolean): void;
      setEmptyOttiePlayedFirstWorkspace(value: boolean): void;
      setEmptyOttiePlayedFirstChats(value: boolean): void;
      reset(): void;
    }

    const INITIAL: OnboardingState = {
      welcomeShown: false,
      welcomeShownAt: null,
      delightFiredFirstAgent: false,
      delightFiredFirstPermission: false,
      delightFiredFirstVoice: false,
      emptyOttiePlayedFirstWorkspace: false,
      emptyOttiePlayedFirstChats: false,
    };

    export const useOnboardingStateStore = create<OnboardingState & OnboardingActions>()(
      persist(
        (set) => ({
          ...INITIAL,
          setWelcomeShown: (value) => set({ welcomeShown: value, welcomeShownAt: value ? Date.now() : null }),
          setDelightFiredFirstAgent: (value) => set({ delightFiredFirstAgent: value }),
          setDelightFiredFirstPermission: (value) => set({ delightFiredFirstPermission: value }),
          setDelightFiredFirstVoice: (value) => set({ delightFiredFirstVoice: value }),
          setEmptyOttiePlayedFirstWorkspace: (value) => set({ emptyOttiePlayedFirstWorkspace: value }),
          setEmptyOttiePlayedFirstChats: (value) => set({ emptyOttiePlayedFirstChats: value }),
          reset: () => set({ ...INITIAL }),
        }),
        {
          name: ONBOARDING_STATE_STORAGE_KEY,
          storage: createJSONStorage(() => AsyncStorage),
          version: ONBOARDING_STORE_VERSION,
        },
      ),
    );
    ```

    Create `packages/app/src/stores/onboarding-state-store.test.ts` covering Tests 1-5. Mock `@react-native-async-storage/async-storage` per existing vitest setup convention.

    Run `npm run format -- packages/app/src/stores/onboarding-state-store.ts packages/app/src/stores/onboarding-state-store.test.ts`.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q "ONBOARDING_STATE_STORAGE_KEY = \"@ottie:onboarding-state\"" packages/app/src/stores/onboarding-state-store.ts && \
      grep -q "useOnboardingStateStore" packages/app/src/stores/onboarding-state-store.ts && \
      grep -q "delightFiredFirstAgent" packages/app/src/stores/onboarding-state-store.ts && \
      grep -q "delightFiredFirstPermission" packages/app/src/stores/onboarding-state-store.ts && \
      grep -q "delightFiredFirstVoice" packages/app/src/stores/onboarding-state-store.ts && \
      npx vitest run packages/app/src/stores/onboarding-state-store.test.ts --bail=1 && \
      npm run typecheck && \
      npm run lint -- packages/app/src/stores/onboarding-state-store.ts
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "@ottie:onboarding-state" packages/app/src/stores/onboarding-state-store.ts` returns 1
    - `grep -c "useOnboardingStateStore" packages/app/src/stores/onboarding-state-store.ts` returns ≥1
    - All 7 state fields present (welcomeShown, welcomeShownAt, 3 delight flags, 2 empty-Ottie flags)
    - `grep -c "createJSONStorage" packages/app/src/stores/onboarding-state-store.ts` returns 1
    - `npx vitest run packages/app/src/stores/onboarding-state-store.test.ts --bail=1` exits 0
    - `npm run typecheck` exits 0
    - `npm run lint -- packages/app/src/stores/onboarding-state-store.ts` exits 0
  </acceptance_criteria>
  <done>OnboardingStateStore persists welcome + delight + empty-Ottie flags via AsyncStorage; tests green</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend welcome screen with Skip CTA + 'Don't show again' checkbox; route consults welcomeShown flag</name>
  <files>
    packages/app/src/components/welcome-screen.tsx,
    packages/app/src/app/welcome.tsx,
    packages/app/src/i18n/locales/en.json,
    packages/app/src/i18n/locales/zh.json
  </files>
  <read_first>
    - packages/app/src/components/welcome-screen.tsx (FULL FILE — extend the existing actions[] array, lines 210-254 + surrounding handlers; PATTERNS lines 656-678)
    - packages/app/src/app/welcome.tsx (FULL FILE — currently 6 lines, redirect logic added here)
    - packages/app/src/app/index.tsx lines 55-87 (existing cold-open routing — Welcome should defer to it when welcomeShown=true)
    - packages/app/src/utils/host-routes.ts (buildHostSessionsRoute signature)
    - packages/app/src/stores/onboarding-state-store.ts (just-created store)
    - packages/app/src/i18n/locales/en.json (existing welcome.* keys to extend)
    - packages/app/src/i18n/locales/zh.json (parity)
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md "Copywriting Contract" lines 168-174 + "Otter Brand Placement" lines 376-396
  </read_first>
  <behavior>
    Test 1 (manual smoke via running typecheck): welcome-screen.tsx imports useOnboardingStateStore
    Test 2: Welcome action array includes a "skip" entry with testID="welcome-skip"
    Test 3: app/welcome.tsx redirects to buildHostSessionsRoute or "/" when welcomeShown is true
  </behavior>
  <action>
    Step 1 — Add new i18n keys to `packages/app/src/i18n/locales/en.json` (verify key paths don't collide with existing — search first):

    ```json
    "welcome.getStarted": "Get started",
    "welcome.skipForPowerUsers": "Skip for power users",
    "welcome.dontShowAgain": "Don't show this again"
    ```

    And matching `packages/app/src/i18n/locales/zh.json`:

    ```json
    "welcome.getStarted": "开始使用",
    "welcome.skipForPowerUsers": "跳过（高阶用户）",
    "welcome.dontShowAgain": "不再显示"
    ```

    Maintain alphabetical / existing-grouping convention of the locale file. If `welcome.title` and `welcome.subtitle` already exist (per UI-SPEC line 170-171), reuse them as-is — do NOT duplicate.

    Step 2 — Modify `packages/app/src/components/welcome-screen.tsx`:

    - Import `useOnboardingStateStore` from `@/stores/onboarding-state-store`
    - Import `router` from `expo-router` and `buildHostSessionsRoute` from `@/utils/host-routes` (if not already imported — verify with grep first)
    - Above the existing `actions` array (line 210), declare:
      ```typescript
      const setWelcomeShown = useOnboardingStateStore((s) => s.setWelcomeShown);
      const [dontShowAgain, setDontShowAgain] = useState(false);
      const handleSkip = useCallback(() => {
        setWelcomeShown(true);
        // Navigate to chats — if any host online, go to its sessions route; else fall through to root
        const activeServerId = getActiveServerId(); // existing helper or via store getState() — adapt to actual API
        if (activeServerId) router.replace(buildHostSessionsRoute(activeServerId));
        else router.replace("/" );
      }, [setWelcomeShown]);
      const handleGetStarted = useCallback(() => {
        if (dontShowAgain) setWelcomeShown(true);
        // proceed with existing primary handler (handleOpenDirect / handleScanQr) — wire whichever the existing primary action used
      }, [dontShowAgain, setWelcomeShown]);
      ```
    - Add a new entry to the `actions` array after the existing primary action with:
      ```typescript
      {
        key: "skip",
        label: t("welcome.skipForPowerUsers"),
        testID: "welcome-skip",
        primary: false,
        icon: undefined, // text-only secondary
        onPress: handleSkip,
      }
      ```
    - Above the actions stack, add an inline `<Pressable accessibilityRole="checkbox">` for `welcome.dontShowAgain`:
      ```tsx
      <Pressable
        testID="welcome-dont-show-again"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: dontShowAgain }}
        accessibilityLabel={t("welcome.dontShowAgain")}
        onPress={() => setDontShowAgain((v) => !v)}
        style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], paddingVertical: theme.spacing[2] }}
      >
        <Check size={18} color={dontShowAgain ? theme.colors.foreground : theme.colors.borderSubtle} />
        <Text style={{ fontSize: theme.fontSize.sm, color: theme.text?.muted ?? theme.colors.foreground }}>
          {t("welcome.dontShowAgain")}
        </Text>
      </Pressable>
      ```
    - Replace the existing primary CTA's label to use `t("welcome.getStarted")` if a more action-oriented label is appropriate (verify against existing copy first — UI-SPEC line 172 names this key; if the existing primary already uses `welcome.openOnDesktop` / `welcome.scanQr`, keep platform-specific labels and add `welcome.getStarted` as the unified label only on the new "skip" sibling — DO NOT remove existing keys).
    - Use `theme.fontFamily.rounded` + `letterSpacing: -0.4` on the H1 (UI-SPEC lines 89-90 — Heading/Display Display variant). Verify if H1 styling already matches; if not, update only the title style.

    Step 3 — Modify `packages/app/src/app/welcome.tsx` to consult the flag:

    ```typescript
    import { useEffect } from "react";
    import { router, Redirect } from "expo-router";
    import { WelcomeScreen } from "@/components/welcome-screen";
    import { useOnboardingStateStore } from "@/stores/onboarding-state-store";
    import { buildHostSessionsRoute } from "@/utils/host-routes";
    // ...other imports for active-server-id source

    export default function WelcomeRoute() {
      const welcomeShown = useOnboardingStateStore((s) => s.welcomeShown);
      const activeServerId = /* read from existing source — daemon-registry-store or similar */;
      if (welcomeShown) {
        if (activeServerId) return <Redirect href={buildHostSessionsRoute(activeServerId)} />;
        return <Redirect href="/" />;
      }
      return <WelcomeScreen />;
    }
    ```

    Adapt to the actual existing route signature — the existing welcome.tsx is 6 lines; preserve any existing import shape (default export pattern, etc.).

    Step 4 — Run `npm run format -- packages/app/src/components/welcome-screen.tsx packages/app/src/app/welcome.tsx packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/zh.json`.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      grep -q "useOnboardingStateStore" packages/app/src/components/welcome-screen.tsx && \
      grep -q "welcome.skipForPowerUsers" packages/app/src/components/welcome-screen.tsx && \
      grep -q "welcome.dontShowAgain" packages/app/src/components/welcome-screen.tsx && \
      grep -q "testID=\"welcome-skip\"" packages/app/src/components/welcome-screen.tsx && \
      grep -q "testID=\"welcome-dont-show-again\"" packages/app/src/components/welcome-screen.tsx && \
      grep -q "useOnboardingStateStore" packages/app/src/app/welcome.tsx && \
      grep -q "Redirect\\|router.replace" packages/app/src/app/welcome.tsx && \
      grep -q "\"welcome.getStarted\":" packages/app/src/i18n/locales/en.json && \
      grep -q "\"welcome.skipForPowerUsers\":" packages/app/src/i18n/locales/en.json && \
      grep -q "\"welcome.dontShowAgain\":" packages/app/src/i18n/locales/en.json && \
      grep -q "开始使用" packages/app/src/i18n/locales/zh.json && \
      grep -q "跳过" packages/app/src/i18n/locales/zh.json && \
      grep -q "不再显示" packages/app/src/i18n/locales/zh.json && \
      npm run typecheck && \
      npm run lint -- packages/app/src/components/welcome-screen.tsx packages/app/src/app/welcome.tsx
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "useOnboardingStateStore" packages/app/src/components/welcome-screen.tsx` returns ≥1
    - `grep -c "welcome.skipForPowerUsers" packages/app/src/components/welcome-screen.tsx` returns ≥1
    - `grep -c "welcome.dontShowAgain" packages/app/src/components/welcome-screen.tsx` returns ≥1
    - `grep -c "testID=\"welcome-skip\"" packages/app/src/components/welcome-screen.tsx` returns 1
    - `grep -c "testID=\"welcome-dont-show-again\"" packages/app/src/components/welcome-screen.tsx` returns 1
    - `grep -c "accessibilityRole=\"checkbox\"" packages/app/src/components/welcome-screen.tsx` returns ≥1
    - `grep -c "useOnboardingStateStore" packages/app/src/app/welcome.tsx` returns 1
    - `grep -c "welcome.getStarted" packages/app/src/i18n/locales/en.json` returns 1
    - `grep -c "welcome.skipForPowerUsers" packages/app/src/i18n/locales/en.json` returns 1
    - `grep -c "welcome.dontShowAgain" packages/app/src/i18n/locales/en.json` returns 1
    - `grep -c "welcome.getStarted" packages/app/src/i18n/locales/zh.json` returns 1
    - `grep -c "welcome.skipForPowerUsers" packages/app/src/i18n/locales/zh.json` returns 1
    - `grep -c "welcome.dontShowAgain" packages/app/src/i18n/locales/zh.json` returns 1
    - `grep -c "开始使用" packages/app/src/i18n/locales/zh.json` returns 1
    - `npm run typecheck` exits 0
    - `npm run lint -- packages/app/src/components/welcome-screen.tsx packages/app/src/app/welcome.tsx` exits 0
  </acceptance_criteria>
  <done>Welcome screen has Skip + Don't-show-again; route honors persisted welcomeShown flag; en+zh keys present</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Replace pair-scan Alert.alert with inline CalloutCard recovery (regenerate / manual key / switch to local daemon) preserving typed input</name>
  <files>
    packages/app/src/app/pair-scan.tsx,
    packages/app/src/components/pair-scan-recovery-callout.tsx,
    packages/app/src/i18n/locales/en.json,
    packages/app/src/i18n/locales/zh.json
  </files>
  <read_first>
    - packages/app/src/app/pair-scan.tsx (FULL FILE — locate Alert.alert at line 193 and the surrounding try/catch; identify the existing manual-entry input state location)
    - packages/app/src/components/callout-card.tsx (existing variant="error" shape; PATTERNS lines 715-727)
    - packages/app/src/components/pair-link-modal.tsx (existing manual-entry surface — its key-format validator is reused for the recovery callout)
    - packages/app/src/components/ui/glass-surface.tsx (radius="card" wrapper for callout)
    - packages/app/src/desktop/daemon/desktop-daemon.ts:113 (shouldUseDesktopDaemon — returns getIsElectron())
    - packages/app/src/constants/platform.ts (getIsElectron gate for "switch to local daemon")
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-CONTEXT.md D-21 + Q5 (Tauri-only "switch to local daemon")
    - .planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02-UI-SPEC.md lines 224-228 (errors.pairScanFailed.* keys)
  </read_first>
  <behavior>
    Test 1: pair-scan.tsx no longer references Alert.alert
    Test 2: PairScanRecoveryCallout renders three actions: regenerate / manualEntry / useLocal
    Test 3: "Switch to local daemon" action is gated by getIsElectron() — non-Tauri shows "available on desktop only" copy
    Test 4: Typed input on manual-entry surface persists across error -> recovery -> retry cycles (state hoisted above the recovery callout)
  </behavior>
  <action>
    Step 1 — Add new i18n keys to en.json (alphabetical / errors group per existing convention):

    ```json
    "errors.pairScanFailed.heading": "Couldn't pair",
    "errors.pairScanFailed.body": "The pairing code didn't match. Try regenerating the code, entering it manually, or switching to a local daemon. Your input is preserved.",
    "errors.pairScanFailed.regenerate": "Regenerate code",
    "errors.pairScanFailed.manualEntry": "Enter key manually",
    "errors.pairScanFailed.useLocal": "Use local daemon",
    "errors.pairScanFailed.useLocalDesktopOnly": "Available on desktop only"
    ```

    Matching zh.json (parity):

    ```json
    "errors.pairScanFailed.heading": "配对失败",
    "errors.pairScanFailed.body": "配对码不匹配。可以重新生成、手动输入，或切换到本机 daemon。输入内容已保留。",
    "errors.pairScanFailed.regenerate": "重新生成",
    "errors.pairScanFailed.manualEntry": "手动输入",
    "errors.pairScanFailed.useLocal": "切换本机 daemon",
    "errors.pairScanFailed.useLocalDesktopOnly": "仅桌面端可用"
    ```

    Step 2 — Create `packages/app/src/components/pair-scan-recovery-callout.tsx`:

    ```typescript
    import { useTranslation } from "react-i18next";
    import { CalloutCard } from "@/components/callout-card";
    import { GlassSurface } from "@/components/ui/glass-surface";
    import { getIsElectron } from "@/constants/platform";

    export interface PairScanRecoveryCalloutProps {
      onRegenerate(): void;
      onManualEntry(): void;
      onUseLocal(): void;
      onDismiss?(): void;
      testID?: string;
    }

    export function PairScanRecoveryCallout({
      onRegenerate, onManualEntry, onUseLocal, onDismiss, testID,
    }: PairScanRecoveryCalloutProps) {
      const { t } = useTranslation();
      const canUseLocal = getIsElectron();
      return (
        <GlassSurface radius="card">
          <CalloutCard
            testID={testID ?? "pair-scan-recovery-callout"}
            variant="error"
            title={t("errors.pairScanFailed.heading")}
            description={t("errors.pairScanFailed.body")}
            onDismiss={onDismiss}
            actions={[
              { key: "regenerate", label: t("errors.pairScanFailed.regenerate"), onPress: onRegenerate, testID: "pair-scan-recovery-regenerate" },
              { key: "manualEntry", label: t("errors.pairScanFailed.manualEntry"), onPress: onManualEntry, testID: "pair-scan-recovery-manual" },
              {
                key: "useLocal",
                label: canUseLocal
                  ? t("errors.pairScanFailed.useLocal")
                  : `${t("errors.pairScanFailed.useLocal")} — ${t("errors.pairScanFailed.useLocalDesktopOnly")}`,
                onPress: canUseLocal ? onUseLocal : () => {},
                disabled: !canUseLocal,
                testID: "pair-scan-recovery-use-local",
              },
            ]}
          />
        </GlassSurface>
      );
    }
    ```

    Adapt to the actual `CalloutAction` shape exported by `callout-card.tsx` — read first to confirm `actions[]` field names (`key`/`label`/`onPress`/`disabled` vs. `id`/`title`/`handler`).

    Step 3 — Modify `packages/app/src/app/pair-scan.tsx`:

    - Add state at the component top level (NOT inside `<PairLinkModal>`):
      ```typescript
      const [pairError, setPairError] = useState<string | null>(null);
      const [manualEntryDraft, setManualEntryDraft] = useState(""); // hoist typed input
      ```
    - Replace the `Alert.alert("Error", message)` block with `setPairError(message)`. Reset `pairError` to `null` on every new scan attempt at the top of `handleScan`.
    - Below the QR scanner / manual entry surface, conditionally render `<PairScanRecoveryCallout>` when `pairError != null`:
      ```tsx
      {pairError != null && (
        <PairScanRecoveryCallout
          onRegenerate={handleRegenerateCode}
          onManualEntry={() => {/* open <PairLinkModal> with manualEntryDraft as initial value */}}
          onUseLocal={handleSwitchToLocalDaemon}
          onDismiss={() => setPairError(null)}
        />
      )}
      ```
    - Implement `handleRegenerateCode` by reusing the existing pairing-code generation hook (search the file for `useOfferUrl` / `useDaemonRegistration` / similar — re-fire the existing code-generation entry point).
    - Implement `handleSwitchToLocalDaemon` by calling `shouldUseDesktopDaemon()` first; if true, route via `router.replace` to whatever sessions route the local daemon would land on; if false, the callout already renders the disabled label, so this handler is unreachable.
    - Wire the existing `<PairLinkModal>` to receive `manualEntryDraft` as initial state and to emit changes back to the hoisted `setManualEntryDraft`. This satisfies "typed input preserved across attempts" (CONTEXT D-21).
    - Remove the now-unused `Alert.alert` import if no other call sites remain in this file.

    Step 4 — Run `npm run format -- packages/app/src/app/pair-scan.tsx packages/app/src/components/pair-scan-recovery-callout.tsx packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/zh.json`.

  </action>
  <verify>
    <automated>
      cd /Users/a123456/Downloads/ottie-workspace/ottie && \
      ! grep -q "Alert.alert" packages/app/src/app/pair-scan.tsx && \
      grep -q "PairScanRecoveryCallout" packages/app/src/app/pair-scan.tsx && \
      grep -q "manualEntryDraft" packages/app/src/app/pair-scan.tsx && \
      grep -q "setPairError" packages/app/src/app/pair-scan.tsx && \
      grep -q "getIsElectron" packages/app/src/components/pair-scan-recovery-callout.tsx && \
      grep -q "errors.pairScanFailed.regenerate" packages/app/src/components/pair-scan-recovery-callout.tsx && \
      grep -q "errors.pairScanFailed.manualEntry" packages/app/src/components/pair-scan-recovery-callout.tsx && \
      grep -q "errors.pairScanFailed.useLocal" packages/app/src/components/pair-scan-recovery-callout.tsx && \
      grep -q "GlassSurface" packages/app/src/components/pair-scan-recovery-callout.tsx && \
      grep -q "errors.pairScanFailed.heading" packages/app/src/i18n/locales/en.json && \
      grep -q "errors.pairScanFailed.heading" packages/app/src/i18n/locales/zh.json && \
      grep -q "配对失败" packages/app/src/i18n/locales/zh.json && \
      grep -q "重新生成" packages/app/src/i18n/locales/zh.json && \
      npm run typecheck && \
      npm run lint -- packages/app/src/app/pair-scan.tsx packages/app/src/components/pair-scan-recovery-callout.tsx
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "Alert.alert" packages/app/src/app/pair-scan.tsx` returns 0 (replaced with inline state)
    - `grep -c "PairScanRecoveryCallout" packages/app/src/app/pair-scan.tsx` returns ≥1
    - `grep -c "manualEntryDraft" packages/app/src/app/pair-scan.tsx` returns ≥2 (state declaration + consumer)
    - `grep -c "setPairError" packages/app/src/app/pair-scan.tsx` returns ≥1
    - `grep -c "getIsElectron" packages/app/src/components/pair-scan-recovery-callout.tsx` returns ≥1
    - `grep -c "GlassSurface" packages/app/src/components/pair-scan-recovery-callout.tsx` returns ≥1
    - `grep -c "errors.pairScanFailed.regenerate" packages/app/src/components/pair-scan-recovery-callout.tsx` returns ≥1
    - `grep -c "errors.pairScanFailed.manualEntry" packages/app/src/components/pair-scan-recovery-callout.tsx` returns ≥1
    - `grep -c "errors.pairScanFailed.useLocal" packages/app/src/components/pair-scan-recovery-callout.tsx` returns ≥1
    - en.json contains all 6 new errors.pairScanFailed.* keys (heading/body/regenerate/manualEntry/useLocal/useLocalDesktopOnly)
    - zh.json contains all 6 new errors.pairScanFailed.* keys (with Chinese values "配对失败", "重新生成", "手动输入", "切换本机 daemon", "仅桌面端可用", body text)
    - `npm run typecheck` exits 0
    - `npm run lint -- packages/app/src/app/pair-scan.tsx packages/app/src/components/pair-scan-recovery-callout.tsx` exits 0
  </acceptance_criteria>
  <done>Pair-scan failures render inline error callout with 3 actions; typed input persists; Tauri-gated 'use local'; Alert.alert removed; en+zh parity</done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary                                | Description                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| pair-scan input → daemon registration   | Untrusted scanned QR / manually-entered key crosses into daemon-registry persistence |
| Welcome skip → AsyncStorage             | Single-bit flag, no untrusted input                                                  |
| getIsElectron() → "switch local daemon" | Branch decision based on platform context                                            |

## STRIDE Threat Register

| Threat ID | Category                   | Component                  | Disposition | Mitigation Plan                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | -------------------------- | -------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-02b-01  | T (Tampering)              | Manual-entry recovery path | mitigate    | Manual key entry continues to flow through the existing `<PairLinkModal>` validator (`upsertConnectionFromOfferUrl` performs offer-URL parsing + signature check); the recovery callout never bypasses validation. Hoisting `manualEntryDraft` is UI state only — submission still goes through the existing entry point                                                                                                                |
| T-02b-02  | E (Elevation of Privilege) | "Switch to local daemon"   | mitigate    | `handleSwitchToLocalDaemon` only fires when `getIsElectron()` returns true (Tauri context) AND `shouldUseDesktopDaemon()` is true; on iOS/Android the action is rendered disabled with copy "available on desktop only" — there is no code path that lets a non-Tauri client silently fall back to an unauthenticated daemon. The local daemon's auth path is the same Phase-1 LocalTokenAuth machinery — no new auth bypass introduced |
| T-02b-03  | T (Tampering)              | "Regenerate code"          | mitigate    | Regenerate re-invokes the existing daemon-side code generation entry point; the daemon retains its auth handshake. No URL-param or deep-link-driven regeneration path exists                                                                                                                                                                                                                                                            |
| T-02b-04  | I (Information Disclosure) | welcomeShown flag          | accept      | Single boolean in AsyncStorage with no PII; not transmitted off-device                                                                                                                                                                                                                                                                                                                                                                  |
| T-02b-05  | E (Elevation of Privilege) | Welcome route deep-link    | mitigate    | Welcome route only consults the local store flag — there is no URL param that can set `welcomeShown=true`. `useOnboardingStateStore` exposes `setWelcomeShown` only via the React tree, not via deep-link query params                                                                                                                                                                                                                  |

No HIGH severity threats. Proceed.
</threat_model>

<verification>
- All 3 task verify blocks pass
- `npx vitest run packages/app/src/stores/onboarding-state-store.test.ts --bail=1` exits 0
- `npm run typecheck` exits 0
- `npm run lint -- packages/app/src/stores/onboarding-state-store.ts packages/app/src/components/welcome-screen.tsx packages/app/src/app/welcome.tsx packages/app/src/app/pair-scan.tsx packages/app/src/components/pair-scan-recovery-callout.tsx` exits 0
- Manual smoke: cold launch on a fresh install lands on Welcome; tapping Skip lands on Chats; restart goes straight to Chats; pair-scan with bad code shows inline callout, typed manual entry survives an attempt cycle (Plan 02e checker may verify visually)
</verification>

<success_criteria>

- OnboardingStateStore persists welcomeShown / 3 delight flags / 2 first-time-empty flags in AsyncStorage at key `@ottie:onboarding-state`
- Welcome screen renders Skip CTA + "Don't show again" checkbox; pressing Skip sets the flag and navigates to Chats
- app/welcome.tsx redirects to host sessions / root when welcomeShown=true on subsequent launches
- pair-scan.tsx no longer uses Alert.alert; failures render inline `<PairScanRecoveryCallout>` with 3 actions
- "Switch to local daemon" action is Tauri-only via getIsElectron() guard; iOS/Android show disabled "available on desktop only" copy
- Typed manual-entry input is hoisted above the recovery callout and survives error → recovery → retry cycles (D-21)
- en.json + zh.json contain all welcome._ + errors.pairScanFailed._ keys per UI-SPEC §Copywriting Contract
- All acceptance criteria + verification commands pass
  </success_criteria>

<output>
Create `.planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02b-onboarding-SUMMARY.md`. Document: the OnboardingStateStore schema, where welcomeShown is read on cold-open, the Tauri gating behavior for "switch to local daemon", and the exact i18n keys added.
</output>
