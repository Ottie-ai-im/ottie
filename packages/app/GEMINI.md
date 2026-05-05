# Gemini Instructions - Ottie App

This file provides guidance for the `@ottie/app` package (Expo/React Native/Web).

## 📱 Platform Gating

Import gates from `@/constants/platform`.

- `isWeb`: DOM APIs, `window`, `document`.
- `isNative`: Haptics, push tokens, `expo-av`.
- `getIsElectron()`: Desktop-specific bridge features.
- `useIsCompactFormFactor()`: Layout/breakpoint decisions.

### Rules

- **Prefer Metro file extensions** (`.web.ts` / `.native.ts`) over runtime `if` statements for platform-specific implementations.
- **Never use raw DOM APIs** without `isWeb` guard.
- **Hover only works on web.** Ensure controls are always visible on native.

## 🏗 State Management

- **Zustand:** Global client-side stores (`src/stores/`).
- **React Context:** Session/Stream lifecycle and UI state (`src/contexts/`).
- **TanStack Query:** Server data fetching.

## 🎨 UI & Layout

- **Style:** Use Vanilla CSS (mostly via React Native's `StyleSheet` or similar abstractions).
- **Virtualization:** Use TanStack Virtual for long timelines.
- **Forms:** Use `@gorhom/bottom-sheet` for adaptive mobile modals.

## 🧪 Testing

- **Unit/Integration:** `vitest`.
- **E2E:** `playwright` (primarily for browser/web).
- **Platform Variants:** Test both web and simulated native behaviors when possible.
