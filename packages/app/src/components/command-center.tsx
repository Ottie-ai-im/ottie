// This file exists for TypeScript resolution.
// The actual implementations are in:
// - command-center.web.tsx (Web/Tauri — cmdk palette wrapped in GlassSurface)
// - command-center.native.tsx (iOS/Android — bottom-sheet via @gorhom/bottom-sheet)
// Metro picks the right file at build time per platform extension.
export * from "./command-center.web";
