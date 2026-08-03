# Task 22: Lightweight Supervisor-Free Runtime

Status: Done

## Execution Contract

- Depends on: Task 19 semantic contract; implementation may prepare in parallel because its runtime files do not overlap Task 19.
- Unlocks: Task 20
- Execution: Parallel wave 11 runtime slice
- Delegated owner: Child agent
- Scope boundary: `src/lib/core/creator-validation.ts`, `src/lib/state-machine/workflow-manager.ts`, and `src/server/api-routes/workflow/start/route.ts`. Do not edit creation UI or tasklist storage code.

## Goal

Run a lightweight workflow with its selected execution Agent only. It must not synthesize, launch, persist, or display `default-supervisor` merely because the state-machine runtime uses that default for ordinary workflows.

## Current State

- `creator-validation.ts` resolves an omitted supervisor to `default-supervisor`.
- `workflow-manager.ts` guards supervisor behavior only with `workflow.supervisor?.enabled === false`, so an absent block still activates supervisor flow.
- `workflow/start/route.ts` persists and emits `default-supervisor` when the workflow has no explicit supervisor.

## Follow-Up Work

- Treat `profile: lightweight` as supervisor-free in validation, initialization, start/rehearsal persistence, recovery, and runtime events.
- Preserve the normal state-machine `default-supervisor` contract without compatibility aliases or global behavior changes.
- Ensure a lightweight failure/recovery path remains functional without supervisor review artifacts.

## Acceptance

- A lightweight run has no default-supervisor Agent session, supervisor review, or default-supervisor event/name in persisted state.
- An ordinary state-machine workflow still receives its default supervisor when one is not explicitly configured.
- Lightweight selected execution Agents continue to run normally.

## Verification Record

- `tests/creator-validation.test.ts`, `tests/api-workflow-start-flow.test.ts`, and `tests/state-machine-workflow-manager.test.ts`: passed, `3 files / 168 tests`.
- Coverage proves lightweight normalization removes `workflow.supervisor`; rehearsal and formal starts persist no supervisor identity or session and emit no `default-supervisor`; lightweight agent roster/prewarm and resume stay supervisor-free. Existing ordinary state-machine coverage retains default-supervisor behavior.
- `git diff --check` over Task 22 source and focused tests: passed (line-ending warnings only).
- Coordinator review: accepted. No browser test is required for this server/runtime contract.
