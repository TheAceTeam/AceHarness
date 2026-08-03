# Task 29: Current TypeScript Gate Repair

Status: Done

## Execution Contract

- Depends on: current Task 10 gate report.
- Unlocks: Task 10 rerun.
- Execution: Parallel corrective slice, excluding Task 28's `WorkbenchClient.tsx` ownership.
- Delegated owner: Child Agent.
- Scope boundary: repair only the current TypeScript errors in agent catalog, document panel/API, and agent chat route types. Do not change workflow behavior or use unsafe broad casts.

## Goal

Return the current worktree to a clean TypeScript gate after the Task 10 report found ten compile errors.

## Current Errors

- `AgentsManager.tsx` category values are wider than the catalog category union.
- `DocumentsPanel.tsx` references `fileListVisible` before its declaration.
- Agent chat/session routes construct incomplete agent schema values.
- The run-document route passes `null` to an optional source type.
- Agent catalog test helper input does not model `team`.
- The related `WorkbenchClient.tsx` implicit parameter error is owned by Task 28 and is intentionally excluded from this task.

## Acceptance

- The listed files use existing domain types and preserve their runtime contracts.
- No unsafe `any` widening or behavior-changing workaround is introduced.
- Focused regressions pass and `npx tsc --noEmit` reaches a clean result once Task 28's parallel Workbench fix lands.

## Verification Record

- 2026-08-01 Task 10 pre-Task-28 gate: `npx tsc --noEmit` reported the listed errors.
- 2026-08-01 child-agent repair: catalog labels accept runtime pack IDs without weakening category types; document visibility ordering is initialized safely; temporary chat role configs are complete typed `RoleConfig` values; document source uses `undefined` for absence; catalog helper input reflects real agent shape.
- 2026-08-01 coordinator acceptance: `npx vitest run tests/workbench-lightweight-overview-observability.test.ts tests/agent-catalog.test.ts` passed `2 files / 5 tests`; `npx tsc --noEmit` passed; scoped `git diff --check` passed with line-ending warnings only.
