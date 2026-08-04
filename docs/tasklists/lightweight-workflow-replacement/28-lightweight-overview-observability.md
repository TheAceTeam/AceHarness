# Task 28: Lightweight Overview Observability

Status: Done

## Execution Contract

- Depends on: Task 27.
- Unlocks: the post-Task-28 final gate refresh.
- Execution: Serial Workbench follow-up after Task 27.
- Delegated owner: Child Agent.
- Scope boundary: lightweight run overview presentation and focused regression tests. Preserve the dedicated task board, two-column tasklist documents, and all state-machine overview behavior.

## Goal

Restore the operational information that a lightweight run overview needs: token consumption and preparation-stage evidence for Skills synchronization and Git baseline/change tracking.

## Current State

- The dedicated lightweight overview renders run identity, status, duration, workspace changes, and the task board.
- The lightweight branch no longer exposes the token analytics and preparation evidence that remain available to the state-machine overview.
- The runtime already carries token, workspace Git, and preparation/status evidence; the fix must project existing evidence without inventing values or dumping verbose logs.

## Acceptance

- Lightweight overview shows token consumption from actual runtime analytics, with an explicit unavailable state when no token evidence exists.
- Lightweight overview preparation is represented by the live run status and phase/step location, consistent with the state-machine overview.
- The overview does not retain standalone Skills synchronization or Git baseline/change-tracking cards after Task 30 alignment.
- State-machine overview retains its existing token and preparation presentation.
- Focused tests cover token evidence, preparation evidence, missing evidence, and state-machine non-regression.

## Verification Record

- 2026-08-01 child-agent implementation: lightweight overview projected `workflowTokenAnalytics` into a compact Token metric and initially added evidence cards for preparation details.
- 2026-08-01 coordinator acceptance: `npx vitest run tests/workbench-lightweight-overview-observability.test.ts tests/agent-catalog.test.ts` passed `2 files / 5 tests`; `npx tsc --noEmit` passed; scoped `git diff --check` passed with line-ending warnings only.
- 2026-08-01 Task 30 follow-up: the persistent preparation cards were superseded by live phase/step location presentation. Token observability remains accepted; preparation display is governed by `30-lightweight-preparation-status-alignment.md`.
