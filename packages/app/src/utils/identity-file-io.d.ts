// Type-only shim. Metro resolves `identity-file-io.web.ts` /
// `identity-file-io.native.ts` at build time; tsgo follows this `.d.ts`
// for type info so callers can `import { saveIdentityFile, ... } from
// "@/utils/identity-file-io"` without naming the platform.
export * from "./identity-file-io.native";
