// Type-only barrel so TypeScript can resolve `@/hooks/use-file-attachment-picker`.
// Metro picks the platform-specific implementation at bundle time:
//   - native (iOS/Android): use-file-attachment-picker.native.ts
//   - web (browser/Tauri):  use-file-attachment-picker.web.ts
// This file is never executed in production bundles.
export { useFileAttachmentPicker } from "./use-file-attachment-picker.web";
