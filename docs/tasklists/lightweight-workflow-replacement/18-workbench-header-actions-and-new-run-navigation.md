# Task 18: Workbench Header Actions And New-Run Navigation

Status: In Review

## Execution Contract

- Depends on: None
- Unlocks: Task 20
- Execution: Parallel wave 11, with Task 19
- Delegated owner: Child agent
- Scope boundary: `src/client/pages/workbench/WorkbenchClient.tsx` only. Fix the design-header name action and the successful start-run navigation without changing workflow runtime semantics.

## Goal

Make the design-page name action visibly enter editing, persist the new name through the existing configuration save path, and switch to the newly created run after a successful workflow start.

## Current State

- The header action uses `editingName` and `saveWorkflowName`, but the user reports clicking the upper-right name action has no visible effect.
- A run started from `workflow-20260801-1159-pbh1.yaml` completed start without selecting or navigating to `run-1785557101652-43901ee6`.

## Follow-Up Work

- Trace the dashboard-shell and inline-header action path; ensure the rename action updates the visible header state and its save path uses the current editing draft.
- Trace the successful start response through selected-run state, URL update, and run-detail navigation.
- Do not change failure/retry semantics or add route compatibility behavior.

## Acceptance

- Clicking the design-page name action renders an editable name input; Enter or blur persists the new value and exits edit mode.
- After a successful start, the UI selects the returned run ID and opens its run overview without a manual refresh.
- Existing history navigation and explicit `runId` URLs remain functional.

## Verification Record

- `git diff --check`: passed.
- `npx vitest run tests/workbench-history-live-sync.test.ts`: passed `9/9`. Coverage verifies immutable current-draft name construction and retention of a newly started local run while an older history request is in flight.
- Coordinator review: `saveWorkflowName` uses the latest editing draft, de-duplicates Enter/blur saves, and calls the existing save path. Successful formal starts upsert and select the returned run before replacing the URL with its overview route.
- Browser verification: pending. User requested implementation first and will manually verify rename persistence and automatic navigation to a newly started run.
