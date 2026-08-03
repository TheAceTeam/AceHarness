# Task 31: Full Gate Regression Repair

Status: In Review

## Execution Contract

- Depends on: Task 10's 2026-08-01 full-gate report.
- Unlocks: the post-Task-30/31 Task 10 rerun.
- Execution: Parallel corrective slice with Task 30; no shared Workbench ownership.
- Delegated owner: Child Agent.
- Scope boundary: only the two full-suite regressions in recommendations and model-selection loading. Diagnose product behavior before changing an assertion; do not weaken tests or edit WorkbenchClient.

## Goal

Repair the two genuine full-Vitest regressions so the release gate reflects the intended Agent recommendation and model-selection behavior.

## Current Failures

- `tests/config-recommendations.test.ts:76` receives unexpected `code-hunter` in the coding recommendation list.
- `tests/model-select.test.tsx:75` never receives the `GPT-5` option because the model selector stays disabled in `loading`.

## Acceptance

- Agent recommendations reflect the intended product role policy; the test expectation changes only when the policy itself is intentionally confirmed by source behavior and user-facing design.
- Model selection finishes loading and presents an available model rather than a permanent disabled loading control.
- Focused regressions, TypeScript, and the complete Task 10 suite pass after the repair.

## Verification Record

- 2026-08-01 Task 10 gate: `npm test -- --maxWorkers=1` failed after `503.89s` with `2 failed | 171 passed | 1 skipped` and `2 failed | 1120 passed | 7 skipped`; the two failures were the unexpected `code-hunter` recommendation and permanently-loading model selector.
- 2026-08-01 child-agent repair: corrected the recommendation policy and model-selector loading behavior in `src/lib/config/recommendations.ts`, `src/client/query/engines.ts`, and `src/components/ModelSelect.tsx`, with corresponding focused regression updates. Focused recommendation/model-selection tests passed and `npx tsc --noEmit --pretty false` passed. The complete Task 10 gate is still required.
