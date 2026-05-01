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

### `packages/server/src/server/session.ts:2018` — `eslint(complexity)` 23 > 20

```
private dispatchChatScheduleLoopMessage(msg: SessionInboundMessage): Promise<void> | undefined {
  switch (msg.type) {
    case "chat/create": ...
    // ~24 cases
  }
}
```

Discovered during Plan 01-05 Task 2b lint pass. The cyclomatic complexity
of `dispatchChatScheduleLoopMessage` is 23, which exceeds the rule's
default of 20. Pre-existing — verified by stashing my changes and
re-running `npm run lint -- packages/server/src/server/session.ts`
(same single error remains).

**Suggested resolution:** split the switch into per-domain helpers
(`dispatchChatMessage`, `dispatchScheduleMessage`, `dispatchLoopMessage`)
or migrate the dispatch table off session.ts entirely as part of the
Phase 3 / Phase 5 carve continuation (the existing Strangler-Fig
infrastructure from Plan 01-04 is well-positioned for this).
Out of scope for Plan 01-05 (which is the local-token auth plan).
