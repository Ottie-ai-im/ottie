# Phase 1 — Deferred Items

Out-of-scope discoveries logged during plan execution. Per executor scope
boundary: only auto-fix issues DIRECTLY caused by the current task's
changes. Pre-existing warnings, linting errors, or failures in unrelated
files are out of scope.

## Pre-existing oxlint errors (touched but not introduced)

### `packages/app/src/app/_layout.tsx:2` — `eslint-plugin-import(no-unassigned-import)`

```
import "@/i18n/init";
```

Discovered during Plan 01-03 Task 3 (SET-02 chromeEnabled split). The
import is intentional — `@/i18n/init` runs side-effecting i18n setup.
Pre-existed at commit `e3ca0641` (the worktree base, prior to any
01-03 work). Not introduced by Task 3; not in scope for this plan.

**Suggested resolution:** add `// oxlint-disable-next-line` directive
or use the `// eslint-disable-line` comment supported by this
plugin — owner: future Phase 4 polish or a dedicated lint sweep.
