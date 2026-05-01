# Deferred items — Phase 02

Items observed but out of scope for the current plan. Track here so the next
phase / triage pass can pick them up.

| Item | Source | Reason | Owner / next-step |
|------|--------|--------|-------------------|
| `sidebar-workspace-list.test.tsx` fails to resolve `react-native` from `expo-constants/Constants.js` (vite import-analysis error) | Encountered while running Task 3 of Plan 02c | Pre-existing test infrastructure issue — independent of the haptic refactor (`Haptics → useHaptic`) and the workspace tap-to-switch change. Reproduces against HEAD before the plan landed. | Triage in a vitest/expo-constants compat pass; likely an alias/conditions config in `vitest.config.ts` |
