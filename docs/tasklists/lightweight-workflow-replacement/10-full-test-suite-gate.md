# Task 10: Full Test-Suite Gate

Status: Blocked

Updated: 2026-08-01 14:56:00 +08:00

## Execution Contract

- Depends on: Task 08.
- Unlocks: None known.
- Execution: Serial wave 5.
- Delegated owner: Child agent selected after Task 08 root review.
- Scope boundary: Run the documented Vitest, component-jsdom, and Playwright suites once all implementation and documentation work is integrated, collect failures, and report exact evidence. Do not change product code while the suite is running; delegate each failure cluster to a bounded corrective task, then rerun the full suite.

## Goal

Meet the user's release condition that every configured test passes before delivery.

## Current Gate Status

- The 2026-08-01 pre-Task-28 gate is not accepted: component tests passed `34 files / 159 tests` and E2E passed `5/5`, but full Vitest exceeded the 124 s command limit without a summary and TypeScript reported ten errors.
- Tasks 28 and 29 are accepted, but the fresh gate found two full-suite regressions. Task 30 owns the corrected lightweight preparation presentation and Task 31 owns the two regression root causes. The complete gate must rerun after both are accepted. The older completion record below remains historical evidence only.

## Current State

- The historical aggregate claims are superseded by the final command-level record below.
- Node `v24.13.1`, npm `11.8.0`, installed dependencies, current `dist`, and Playwright Chromium satisfied the configured prerequisites.
- Before E2E, port `5188` was confirmed free of a residual server and `PLAYWRIGHT_BASE_URL` was unset. Playwright therefore started the current production artifact through `start:start`, rather than reusing a stale service.

## Historical Completion

- The configured release gate completed without narrowing test selection or changing assertions.
- `npm test` includes the Git-baseline regression coverage: disabled isolated copies skip `.git`, enabled copies retain `.git`, and rerun refreshes a newly disabled baseline configuration.
- Component-jsdom and Playwright remain complementary configured release coverage; they do not directly assert the Git-baseline copy path.

## Acceptance

- `npm test`, `npm run test:components`, and `npm run test:e2e` each exit with status `0` after all final fixes.
- `npx tsc --noEmit` exits with status `0` after all final fixes.
- The verification log records the exact command, summary, and any failed-then-fixed reruns.
- No failure is hidden by narrowing the command, changing test selection, or weakening an existing assertion.

## Verification Record

- 2026-08-01 pre-Task-28 gate: `npm run test:components` **pass** (`34 files / 159 tests`); `npm run test:e2e` **pass** (`5/5`); `npm test -- --maxWorkers=1` **timeout** at 124 s without final summary; `npx tsc --noEmit` **fail** (ten errors). No source files were changed by the gate runner.
- 2026-08-01 fresh gate: `npm test -- --maxWorkers=1` **fail** after `503.89s` (`2 failed | 171 passed | 1 skipped`, `2 failed | 1120 passed | 7 skipped`). Failures are the unexpected `code-hunter` recommendation and model selector permanently showing `loading`. Components (`34 files / 159 tests`), TypeScript, and E2E (`5/5`) passed. Tasks 30 and 31 must close before rerun.
- `npm test`: **pass**, `160 files / 1047 passed / 6 skipped`.
- `npm run test:components`: **pass**, `29 files / 132 passed`.
- `npm run test:e2e`: **pass**, `5 passed`; port `5188` was free, `PLAYWRIGHT_BASE_URL` was unset, and the suite ran against current `dist` through `start:start`.
- `npx tsc --noEmit`: **pass**.
- `Scheduler restore skipped` was emitted as a scheduler restoration notice. It is not a failed test, skipped test, or release-gate failure.
