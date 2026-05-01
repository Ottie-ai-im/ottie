// Metro shim — TypeScript resolution only.
//
// The real implementations live in:
//   - chat-row-context-menu.web.tsx  (right-click anchored Modal + GlassSurface)
//   - chat-row-context-menu.native.tsx (long-press → IsolatedBottomSheetModal)
//
// Metro's platform-specific extensions pick the right file at build time.
// We re-export from the native variant here because TypeScript only sees
// this barrel in editor / typecheck contexts.

export * from "./chat-row-context-menu.native";
