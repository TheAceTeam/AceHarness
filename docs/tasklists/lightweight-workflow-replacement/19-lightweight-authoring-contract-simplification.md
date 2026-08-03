# Task 19: Lightweight Authoring Contract Simplification

Status: In Review

## Execution Contract

- Depends on: None
- Unlocks: Tasks 20 and 21
- Execution: Parallel wave 11, with Task 18
- Delegated owner: Child agent
- Scope boundary: `src/components/NewConfigModal.tsx`, `src/components/LightweightWorkflowDesignPanel.tsx`, and the lightweight branch of `src/server/api-routes/configs/create/route.ts`. Do not edit Workbench navigation or runtime document-root code.

## Goal

Keep lightweight workflows as one directly executable task with workflow-level capability settings, without exposing configuration that has no meaning for a fixed one-step, no-transition workflow.

## Current State

- Creation and design currently expose optional `step.skills` controls.
- The execution-configuration page exposes `maxTransitions` even for a lightweight workflow.
- Lightweight creation spreads the default state-machine governance block, including `default-supervisor`.
- The lightweight direct-create button calls the submit path outside React Hook Form's submitting lifecycle, so it currently has no reliable loading state or same-tick re-entry guard.

## Follow-Up Work

- Remove the user-configurable step Skills control from lightweight creation and design while retaining the mandatory internal tasklist skill.
- Remove the maximum-transition field from lightweight execution configuration.
- Create lightweight configurations without a supervisor block or `default-supervisor` reference.
- Add a create-in-progress state and synchronous re-entry guard for lightweight direct creation.
- Preserve workflow-level Skills, MCP server, and RAG configuration.

## Acceptance

- New and edited lightweight workflows cannot configure optional step Skills in the UI.
- A generated lightweight configuration contains no supervisor/default-supervisor configuration and no user-configurable maximum-transition setting.
- While a lightweight configuration request is in flight, its create button is visibly loading and cannot submit a second request.
- State-machine workflows retain their existing supervisor, step Skills, and transition-cap behavior.

## Verification Record

- `git diff --check`: passed.
- Static review: accepted. Lightweight creation/design no longer expose step Skills; generated lightweight configs strip `supervisor` and `maxTransitions` after schema normalization; direct creation uses a synchronous re-entry lock and a visible loading state.
- `npx vitest run tests/components/NewConfigModal.test.tsx`: passed `1 file / 11 tests`. The new in-flight test proves the visible `创建中...` state, disabled Agent selector and goal input, and single mutation call after repeated interaction. The resumed-session fixture retains no `tasklistDirectory`.
- Coordinator review: `isDirectCreationPending` unifies local state, mutation state, and form submission state; it is passed to the real `SingleCombobox`, goal input, and direct-create action. State-machine-only governance remains outside the lightweight branch.
- Browser verification: pending user manual confirmation.
