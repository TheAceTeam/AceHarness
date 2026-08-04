# Task 27: Lightweight Runtime Task Board And Agent View

Status: Done

## Execution Contract

- Depends on: Task 20 and Task 21 reviewed acceptance
- Unlocks: Task 8 static audit and Task 10 final gate
- Execution: two serial sub-phases after the runtime tasklist contract is settled; Phase A component/data work may run while Task 13 owns Workbench revalidation, and Phase B is the single Workbench integration lane after that review
- Delegated owner: Child agent
- Scope boundary: dedicated lightweight run components and their Workbench integration/tests. Do not alter state-machine Agent formation, state graph, or generic document layout behavior.

## Goal

Give a lightweight run a dedicated task-board experience that reflects actual tasklist/runtime execution rather than presenting it as a one-step state machine.

## Completed

- A dedicated `LightweightTaskBoard` and typed evidence adapter derive the primary Agent, actual child-Agent activity, task status, ownership, dependencies, serial/parallel grouping, and progress without treating the one-state workflow topology as task evidence.
- Lightweight overview and Agent sections render the dedicated task board instead of the ordinary Agent formation. Child activity renders the current task or a real runtime summary when available.
- Lightweight tasklist documents use a two-column file-list/content workspace. State-machine document presentation and source switching retain their existing behavior.
- Missing task or runtime evidence produces an explicit unavailable state; child Agents, task edges, ownership, grouping, and progress are not inferred from absent data.

## Acceptance

- A lightweight run no longer renders the ordinary Agent formation; it has a primary-Agent and child-Agent activity view.
- A lightweight tasklist view has two working columns and no generic third detail/metadata column.
- The board shows actual task list items and, where persisted/runtime data supplies them, serial/parallel relationships, owner, dependencies, and completion percentage.
- Child-Agent entries, task edges, grouping, ownership, and progress are never fabricated from absent data.
- State-machine runtime Agent and document UI behavior remains unchanged.
- Focused tests cover the lightweight and state-machine contracts.

## Verification Record

- 2026-08-01 Phase A: `npx vitest run tests/components/LightweightTaskBoard.test.tsx` passed `1 file / 5 tests`; scoped `git diff --check` passed. Coverage includes serial/parallel task evidence, actual child-Agent activity, excluded bare/idle roster roles, absent task evidence, actual progress, and state-machine isolation.
- 2026-08-01 Phase B: lightweight Workbench now loads run-owned tasklist evidence, uses the dedicated board for the overview/Agent sections, locks documents to the tasklist source, and selects two-column inline presentation. Focused child-agent verification passed `3 files / 9 tests`.
- 2026-08-01 coordinator acceptance: `npx vitest run tests/components/LightweightTaskBoard.test.tsx tests/components/lightweight-tasklist-evidence.test.ts tests/components/DocumentsPanel.layout.test.ts tests/components/DocumentsPanel.source-tabs.test.tsx` passed `4 files / 11 tests`; `npx vitest run tests/workbench-dynamic-import.test.ts tests/task8-config-documents.test.ts` passed `2 files / 4 tests`; `git diff --check -- src/client/pages/workbench/WorkbenchClient.tsx src/components/DocumentsPanel.tsx` passed (line-ending warnings only).
