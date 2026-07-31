# Current Verification Gaps

Updated: 2026-07-30 17:10:27 +08:00

## Closed In This Tasklist

- Task 7 Workbench dynamic-import verification is independently accepted.
- Task 11 retained AI-guided creation entry/session/payload verification is independently accepted.
- Task 13 normal failed-step gating, explicit rerun/force recovery, active-history live synchronization, cleanup response filtering, and superseded-attempt audit retention are independently accepted. Its focused evidence is `11 files / 225 passed` and `npx tsc --noEmit` passed.
- Task 8 Git-baseline-disabled application behavior is independently accepted. Disabled isolated-copy excludes `.git` directories and worktree `.git` files; enabled baseline remains compatible; rerun reloads current configuration and clears stale `workspaceGit`. Focused evidence is `2 files / 131 passed`, TypeScript passed, and the real temporary-directory copy probe passed.

## Remaining Follow-ups

- **Linux process-tree integration:** run a real Linux-host integration proving run-scoped cleanup handles live ACPX parent/child process trees without touching another run. Current source and mocked-platform coverage does not substitute for this host-level proof.
- **ACPX all-process lifecycle and real tracing:** establish a reproducible matrix for every ACPX-routed process type covering start, streaming, stop, crash cleanup, and backend-visible diagnostics. Detailed lifecycle diagnostics remain backend-visible only.
- **ACPX Git self-behavior:** Task 8 repairs ACEHarness-owned isolated-copy and Git-baseline paths only. ACPX itself may stat or access `.git` for session discovery; capture a real OpenCode/ACPX filesystem trace with Git baseline/change tracking disabled before making any broader CPU/IO claim.
- **Configuration-change recovery regressions:** add direct regression coverage for baseline configuration changing to disabled before `resume` and before a stopped-run `force jump`. The implementation refreshes the gate in these paths, but Task 8's direct regression covers rerun-after-disable.

## Task 10 Gate

Task 10 is **Done (100%)**. The final configured gate passed: `npm test` `160 files / 1047 passed / 6 skipped`, `npm run test:components` `29 files / 132 passed`, `npm run test:e2e` `5 passed`, and `npx tsc --noEmit` passed. E2E used current `dist` through `start:start` with port `5188` clear and `PLAYWRIGHT_BASE_URL` unset. `Scheduler restore skipped` is a non-failure runtime notice.
