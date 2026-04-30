# Coding Conventions

_Last updated: 2026-04-29_

## Summary

Ottie follows strict TypeScript conventions defined in `docs/CODING_STANDARDS.md` and enforced via Biome (formatting + linting). The guiding philosophy is zero complexity budget: no abstraction without a specific benefit, no `any`, and functional/declarative style over OOP. Code is organized domain-first, not by technical type.

## TypeScript Type Hygiene

**Never hand-write types that can be inferred from Zod schemas:**

```typescript
// Bad
type RPCArgs = { procedure: string; args: Record<string, unknown> };
// Good
type RPCArgs = z.infer<typeof schema>;
```

**`interface` over `type` when possible.**

**`function` declarations over arrow function assignments.**

**Named types over inline types in public signatures:**

```typescript
// Bad
function enqueueJob(input: { userId: string; priority: "low" | "normal" | "high" }) {}
// Good
interface EnqueueJobInput {
  userId: string;
  priority: "low" | "normal" | "high";
}
function enqueueJob(input: EnqueueJobInput) {}
```

**Object parameters when >1 argument:**

```typescript
// Bad: positional args
function createToolCall(provider: string, toolName: string, payload: unknown) {}
// Good: object param
function createToolCall(input: CreateToolCallInput) {}
```

**One canonical type per concept** — no `RpcX` / `DbX` / `UiX` duplications. Use canonical + wrapper types.

**Validate at boundaries, trust internally** — parse external data once with Zod at the boundary, use typed values everywhere else.

**Compiler strictness:** `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` all set to `true`.

## State Design

**Discriminated unions over bags of booleans/optionals:**

```typescript
// Bad
interface FetchState {
  isLoading: boolean;
  error?: Error;
  data?: Data;
}
// Good
type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "success"; data: Data };
```

**Optionality is a design decision** — never mark fields optional to avoid migrations. Explicit `null` for intentionally empty values. Keep optionality at real boundaries (external input), then resolve it.

**State management stack:**

- **Zustand** for global client-side stores (`packages/app/src/stores/`)
- **React contexts** for session/stream lifecycle and sidebar state (`packages/app/src/contexts/`)
- **TanStack React Query** for server data fetching (inlined via Vitest server deps)
- Never mirror a source of truth into local state — always derive from it.

## Error Handling

**Fail explicitly** — throw rather than silently returning defaults when a requested resource is unavailable.

**Typed domain errors** — extend `Error` with structured metadata:

```typescript
class TimeoutError extends Error {
  constructor(
    public readonly operation: string,
    public readonly waitedMs: number,
  ) {
    super(`${operation} timed out after ${waitedMs}ms`);
    this.name = "TimeoutError";
  }
}
```

**Preserve error semantics** — never collapse typed errors into generic `Error`.

**Don't catch errors** unless there is a strong, explicit reason to do so.

**No fallback behavior by default** — prefer an explicit error over silent degradation.

## React Patterns

**Keep components dumb** — components render state and dispatch events; they do not compute transitions.

**Extract state machines/reducers** when a component has more than two interacting `useState` calls.

**`useRef` for mutable coordination state is a smell** — model states explicitly instead.

**Never mirror a source of truth into local state** — derive from it.

**Test state logic as pure functions** without rendering.

**Component co-location:** components in `packages/app/src/components/`, screens in `packages/app/src/screens/`, panels in `packages/app/src/panels/`, hooks in `packages/app/src/hooks/`.

## Platform Gating

Import gates from `@/constants/platform` (`packages/app/src/constants/platform.ts`) — never define them locally.

| Gate                       | Type      | When to use                                                                                    |
| -------------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `isWeb`                    | constant  | DOM APIs — `document`, `window`, `<div>`, `addEventListener`, `ResizeObserver`                 |
| `isNative`                 | constant  | Native-only APIs — Haptics, `StatusBar.currentHeight`, push tokens, camera, `expo-av`          |
| `getIsElectron()`          | cached fn | Desktop wrapper features — file dialogs, titlebar drag, daemon management, app updates         |
| `useIsCompactFormFactor()` | hook      | Layout decisions — sidebar overlay vs pinned, modal vs full screen (from `@/constants/layout`) |

**Default is cross-platform** — gate only when you must.

**Prefer Metro file extensions over `if` statements** for fundamentally different platform implementations:

```
hooks/
  use-audio-recorder.web.ts    ← uses Web Audio API
  use-audio-recorder.native.ts ← uses expo-audio
```

Import as `@/hooks/use-audio-recorder` — Metro picks the right file automatically.

**Never use `onPointerEnter`/`onPointerLeave`** — they don't fire on native iOS.

**Hover only works on web** — for hover-to-show UI, use `isHovered || isNative || isCompact` pattern.

**Never use `Platform.OS` as a proxy for layout capabilities** — use breakpoints.

## File Organization

- Organize by domain first (`providers/claude/`), not by technical type (`tool-parsers/`)
- Name files after the main export: `create-tool-call.ts` (kebab-case)
- No `index.ts` barrel files that only re-export — they create unnecessary indirection
- Use `index.ts` as a real entry point only
- Collocate tests with implementation: `thing.ts` + `thing.test.ts`
- Platform-variant files: `timeline-cache-store.ts` / `timeline-cache-store.web.ts` / `timeline-cache-store.native.ts`

## Import Path Conventions

- App package: `@/` alias maps to `packages/app/src/`
- Server package: `@server/` alias maps to `packages/server/src/`
- Relay package: `@ottie/relay` and `@ottie/relay/e2ee` are workspace package imports
- Never use `../../../` relative paths when an alias is available

## Naming Conventions

- **Files:** `kebab-case.ts` named after the main export
- **Types/Interfaces:** PascalCase (`EnqueueJobInput`, `FetchState`)
- **Functions:** camelCase, `function` declarations preferred
- **Stores:** `use-X-store.ts`, exported as `useXStore`
- **Hooks:** `use-X.ts`, exported as `useX`
- **Constants:** camelCase for runtime values, SCREAMING_SNAKE for compile-time constants (rare)
- **Test files:** `thing.test.ts` or `thing.spec.ts` (Playwright e2e only)

## Formatting and Linting

**Formatter:** `oxfmt` (Biome-based), run via `npm run format`

**Linter:** `oxlint`, run via `npm run lint`

**Key formatting settings:**

- `indentStyle: "space"`, `indentWidth: 2`
- `lineWidth: 100`
- `quoteStyle: "double"`
- `trailingCommas: "all"`
- `semicolons: "always"`

**Always run both after every change:**

```bash
npm run typecheck
npm run lint
npm run format
```

Never run tools directly with `npx eslint`, `npx oxfmt`, or `npx oxlint`. Use npm scripts only. For targeted checks:

```bash
npm run lint -- packages/app/src/components/message.tsx
npm run format:files -- packages/app/src/components/message.tsx
```

## WebSocket / Message Schema Rules

**Never make breaking changes to WebSocket or message schemas.** All changes must be backward-compatible for old mobile app clients talking to new daemons:

- New fields: always `.optional()` with a sensible default or `.transform()` fallback
- Never change a field from optional to required
- Never remove a field — deprecate it (keep accepting it, stop sending it)
- Never narrow a field's type (e.g. `string` → `enum`, `nullable` → non-null)

## Logic Density

**Keep logic density low** — avoid nested ternaries and inline lookups. Use named steps, then assemble:

```typescript
// Bad: nested ternaries + inline lookups
const billing = shouldUseLegacy(account)
  ? getLegacy(account)
  : buildBilling(
      account,
      rates.find((r) => r.region === account.region),
    );

// Good: named steps
const rate = rates.find((r) => r.region === account.region);
if (!rate) throw new MissingRateError(account.region);
const billing = shouldUseLegacy(account) ? getLegacy(account) : buildBilling(account, rate);
```

## Centralize Policy

When the same discriminator (`plan`, `provider`, `kind`, `status`) is checked across multiple files, centralize it into a policy model. A new case should require editing one place, not many.
