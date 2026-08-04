# Task 30: Lightweight Preparation Status Alignment

Status: Done

## Execution Contract

- Depends on: Task 28.
- Unlocks: the post-Task-30 Task 10 rerun.
- Execution: Serial Workbench presentation correction.
- Delegated owner: Child Agent.
- Scope boundary: lightweight overview preparation presentation and focused tests only. Preserve the restored Token metric, task board, documents layout, and all state-machine UI.

## Goal

Align lightweight preparation display with state-machine behavior: show the current preparation status only while the run is preparing, without persistent Skills/Git preparation cards in the overview.

## Current State

- Task 28 restored Token consumption and added two persistent preparation evidence cards.
- Product review rejects those cards: after preparation they duplicate transient information and make the lightweight overview heavier than the state-machine overview.
- State-machine behavior already represents preparation through the run status and current phase/step, such as `准备中` and `准备阶段 / 同步 Skills`.

## Acceptance

- Lightweight overview retains its evidence-backed Token metric.
- While status is `preparing`, lightweight overview shows the actual current preparation phase/step through the same run status/location presentation as state-machine runs.
- Once a run is no longer preparing, no standalone Skills synchronization or Git baseline/change-tracking preparation block remains in the lightweight overview.
- No preparation success/failure inference is rendered from stale events, configuration, or workspace Git state.
- State-machine overview remains unchanged and focused regression coverage passes.

## Verification Record

- 2026-08-01 coordinator implementation: removed the persistent Skills/Git preparation presentation from the lightweight overview and shared the state-machine location format so a live preparation run shows both phase and step (for example, `准备阶段 / 同步 Skills`). Reused lightweight execution surfaces now label the same status as `准备中`. Token consumption remains in the lightweight overview.
- Verification: `npx vitest run tests/workbench-lightweight-overview-observability.test.ts --reporter verbose` passed `1 file / 2 tests`; `npx tsc --noEmit --pretty false` passed; scoped `git diff --check` passed with line-ending warnings only.
