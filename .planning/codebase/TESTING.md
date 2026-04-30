# Testing Patterns

_Last updated: 2026-04-29_

## Summary

Ottie uses Vitest as the primary test runner across all packages, with Playwright for browser-based e2e tests in the app package and integration-style CLI tests in `packages/cli/tests/`. The philosophy centers on proving behavior over structure, vertical TDD slices, determinism, and real dependencies over mocks. Tests are co-located with implementation files.

## Test Framework

**Primary runner:** Vitest (across all packages)

**E2E runner (app package):** Playwright (`packages/app/playwright.config.ts`)

**Config files:**

- Root: `vitest.config.ts` (resolves `.web.*` extensions, aliased `@`, `@server`, `@ottie/relay`)
- App package: `packages/app/vitest.config.ts` (two projects: `unit` and `browser`)
- Server package: `packages/server/vitest.config.ts` (single-fork pool, 30s timeout, setup file)

## Test Types and Organization

### Unit / Integration (Vitest)

Tests are **co-located with implementation files**:

- `packages/app/src/stores/panel-store.ts` → `packages/app/src/stores/panel-store.test.ts`
- `packages/server/src/server/messages.ts` → `packages/server/src/server/messages.test.ts`
- `packages/server/src/tasks/task-store.ts` → `packages/server/src/tasks/task-store.test.ts`

Naming variants observed:

- `thing.test.ts` — standard unit test
- `thing.browser.test.ts` — runs in browser context (Playwright/Chromium via Vitest browser project)
- `thing.e2e.test.ts` — daemon e2e integration test (server package only)
- `thing.real.e2e.test.ts` — requires real API credentials
- `thing.local.e2e.test.ts` — local environment integration
- `thing.smoke.test.ts` — smoke-level integration
- `thing.primitive.test.ts` — primitive/foundational unit test

### CLI Tests

Located in `packages/cli/tests/` (separate directory, not co-located). Files are prefixed with a two-digit ordering number (`01-foundation.test.ts`, `02-output.test.ts`, etc.) reflecting execution order and scope.

### Browser Tests (App Package)

App unit tests that need a real browser DOM use the `browser` Vitest project:

- Include pattern: `src/**/*.browser.{test,spec}.{ts,tsx}`
- Browser: Chromium (headless), via Playwright provider
- Screenshots saved to `packages/app/.vitest-screenshots/` on failure

### E2E Tests (Playwright)

Located in `packages/app/e2e/`:

- Config: `packages/app/playwright.config.ts`
- Global setup: `packages/app/e2e/global-setup.ts` (starts Metro and a test daemon on dynamic ports)
- Fixtures: `packages/app/e2e/fixtures.ts` (extends Playwright base `test` with dynamic `baseURL`, console capture, and hard guardrails blocking the developer's port 6767 daemon)
- Helpers: `packages/app/e2e/helpers/`
- Specs: `packages/app/e2e/*.spec.ts`
- Runs sequentially (`fullyParallel: false`, `workers: 1`) — tests share a single daemon/relay/Metro stack
- CI retries: 1 retry on failure; traces, screenshots, and video retained on failure

## How to Run Tests

**NEVER run the full test suite locally** — it is heavy and will freeze the machine, especially with multiple parallel agents.

### Run a specific test file (preferred):

```bash
npx vitest run <file> --bail=1
# Example:
npx vitest run packages/app/src/stores/panel-store.test.ts --bail=1
```

### Pipe output to file for heavy suites:

```bash
npx vitest run <file> --bail=1 > /tmp/test-output.txt 2>&1
# Then read the file
```

### Server package commands:

```bash
# Single test file
npx vitest run src/server/agent/agent-manager.test.ts --reporter=verbose

# Single test by name
npx vitest run -t "returns timeout error when provider times out"

# Unit tests only (excludes e2e)
npm run test:unit          # in packages/server

# Integration tests (daemon e2e, specific files)
npm run test:integration   # in packages/server

# Watch mode
npm run test:watch         # in packages/server

# Vitest browser UI
npm run test:ui            # in packages/server — localhost:51204
```

### App package commands:

```bash
# All unit tests (from packages/app)
npx vitest run --project unit

# Browser tests
npx vitest run --project browser

# Playwright e2e
npx playwright test        # from packages/app
```

### Full suite (only for CI verification):

Push to CI and check GitHub Actions — never run `npm run test` for an entire workspace locally.

## Testing Philosophy

**Tests prove behavior, not structure.** Every test must answer: "what user-visible or API-visible behavior does this verify?"

**TDD — vertical slices:** One test, one implementation, repeat. Never write all tests before all implementations.

**Determinism first:**

- No conditional assertions or branching paths
- No reliance on timing, randomness, or network jitter
- No weak assertions (`toBeTruthy`, `toBeDefined`)
- Assert the full intended behavior

```typescript
// Bad
it("creates a tool call", async () => {
  const result = await createToolCall(input);
  if (result.ok) {
    expect(result.id).toBeDefined();
  }
});
// Good
it("returns timeout error when provider times out", async () => {
  const result = await createToolCall(input);
  expect(result).toEqual({ ok: false, error: { code: "PROVIDER_TIMEOUT", waitedMs: 30000 } });
});
```

**Flaky tests are a bug** — never remove a flaky test; find and fix the variance source.

## Real Dependencies Over Mocks

**Mocks are not the default.** Explicit decision required.

- **Database:** real test database, not a mock
- **APIs:** real APIs with test/sandbox credentials, not request mocks
- **File system:** temporary directory that gets cleaned up, not fs mocks

When isolation is needed, design for swappable adapters (injectable interfaces), not `vi.mock()`.

`vi.mock()` is used only for native platform modules that cannot run in Node (e.g., `@react-native-async-storage/async-storage` is mocked as an in-memory `Map` in store tests).

## Agent Auth in Tests

**Never add auth checks, environment variable gates, or conditional skips to tests.** Agent providers handle their own auth. If auth fails, report it.

## Server Test Setup

**Setup file:** `packages/server/src/test-utils/vitest-setup.ts`

- Loads `packages/server/.env.test` (integration/e2e credentials) then repo-root `.env`
- Sets `OTTIE_SUPERVISED=0`, `GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS`, and related env vars for deterministic git/SSH behavior

**Pool:** `forks` with `singleFork: true` (max 1 fork) — prevents parallel daemon side-effects.

**Timeouts:** `testTimeout: 30000ms`, `hookTimeout: 60000ms`.

## App Test Infrastructure

**Pool:** `forks` with `maxForks: 2` — Expo pulls in native tooling that requires `process.send` (not available in `worker_threads`).

**Inlined deps:** `zustand`, `@tanstack/react-query`, `react-native-web` — inlined by Vite to handle CJS/ESM interop.

**Extension resolution:** `.web.*` extensions are resolved before plain extensions so Metro-style platform files work correctly in tests.

**Test stubs:** `packages/app/test-stubs/xterm-addon-ligatures.ts` — stub for the xterm ligatures addon (avoids native rendering in tests).

**Vitest setup:** `packages/app/vitest.setup.ts` (referenced by the `unit` project).

## E2E Guardrails (Playwright)

The Playwright fixture in `packages/app/e2e/fixtures.ts` enforces hard isolation:

- Blocks all HTTP and WebSocket connections to port 6767 (developer's live daemon) via `page.route()` and `page.routeWebSocket()`
- Throws if `E2E_DAEMON_PORT` is not set or equals `6767`
- Throws if `E2E_METRO_PORT` or `E2E_SERVER_ID` are not set — all injected by `global-setup.ts`

## CI

Tests run via GitHub Actions. Push to CI for full suite verification rather than running `npm run test` locally. Playwright tests get 1 retry in CI (`retries: process.env.CI ? 1 : 0`).
