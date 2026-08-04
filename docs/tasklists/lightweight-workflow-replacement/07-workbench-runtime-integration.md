# Task 7: Workbench Runtime Integration

Status: Done

Updated: 2026-07-30 16:51:43 +08:00

## Execution Contract

- Depends on: Tasks 4, 5, and 6.
- Unlocks: Task 8.
- Execution: Parallel wave 3 with Task 09.
- Delegated owner: A child agent selected after Wave 2 review.
- Scope boundary: Own final runtime presentation and integration: `WorkbenchClient.tsx`, StateMachine execution surfaces, workflow runtime right rail/direct binding, and removal of workflow monitor/plugin UI identifiers. Do not rework schemas, creation/design components, documents API, or backend session logic.

## Goal

Deliver the requested lightweight runtime UI and remove the state-machine multi-Agent Agora tab without losing operational surfaces.

## Current State

- Dynamic Workbench loading is healthy through the dashboard import path; the focused import test and Vite build pass.
- Explicit active history runs keep scoped polling, SSE updates, and event reconciliation alive without reload.
- Lightweight root/child runs render through `LightweightWorkflowExecutionView`; state-machine runs retain `StateMachineExecutionView` and operational controls.
- Stop progress exposes only fixed product lifecycle phases. ACP/session diagnostics remain backend-only; obsolete Agora and `workflow-monitor` runtime identifiers are absent.

## Completion Notes

- The compact lightweight runtime surface, normal state-machine visualization, child drill-down, workspace, output, and human interaction surfaces are integrated.
- The legacy Agora/group-chat UI and plugin-style monitor identifiers are removed without removing normal operational controls.
- Task 13's accepted live-history and recovery integration is included in the final runtime evidence.

## Acceptance

- Lightweight run UI clearly exposes progress, tasklist documents, runtime output, and workspace with no state transition or Agora controls.
- Normal state-machine runtime has no multi-Agent Agora chat tab but retains all non-chat operational controls.
- Child lightweight runs can be opened from a parent state-machine run and display their own tasklist directory.
- No `workflow-monitor` plugin ID remains as a persisted UI dependency.

## Verification Record

- Final independent review: **pass**. `tests/workbench-dynamic-import.test.ts`, `tests/workbench-history-live-sync.test.ts`, `tests/components/SubworkflowUi.test.tsx`, and `tests/state-machine-diagram-step-matching.test.ts` reported `4 files / 19 passed`; the Task 13 integration set reported `5 files / 178 passed`. `npx vite build -c vite.start.config.mts` and `npx tsc --noEmit` passed. No concrete Task 7 runtime defect was found.
