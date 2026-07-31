# Task 5: Lightweight Creation And Design UI

Status: Done

Updated: 2026-07-30 16:50:34 +08:00

## Execution Contract

- Depends on: Tasks 1, 2, and 3.
- Unlocks: Task 7 and Task 11.
- Execution: Parallel wave 2.
- Delegated owner: Child Agent B or a new child after Task 2 review.
- Scope boundary: Own workflow listing/new-config/design files such as `NewConfigModal`, `WorkflowModeSelector`, `app/workflows/page.tsx`, `StateMachineDesignPanel`, `EditNodeModal`, and focused lightweight design components. Task 11 may make a serial follow-up in these files after this task is reviewed to connect retained AI entry data; there must be no concurrent edits. Do not edit `WorkbenchClient.tsx`, runtime right rails, start routes, documents API, or the deleted plugin/chat-removal surface during this task.

## Goal

Replace the former phase-workflow creation location with a constrained, first-class lightweight workflow creation and design experience, while keeping AI-guided creation as an entry into that experience rather than as a third workflow mode.

## Current State

- `WorkflowModeSelector.tsx` exposes persisted `轻量工作流` and `状态机` choices only. AI guidance is a separate entry action and does not become a third persisted mode.
- `NewConfigModal.tsx` currently derives the read-only tasklist directory, validates the lightweight Agent/task input, preserves optional step Skills, and submits `mode: lightweight` to the config creation mutation.
- `src/server/api-routes/configs/create/route.ts` accepts the lightweight creation contract, derives the tasklist directory server-side, and enforces the required tasklist skill.
- `WorkflowsPage.tsx` retains a separate AI creation action using the lightweight preset.
- QuickActions, Codespec, `starterAction=create_workflow`, and ordinary homepage workflow intent all converge on `NewConfigModal(initialMode="lightweight")` with creator-session binding. No path revives `ai-guided` as a persisted mode.

## Completed

- The creation, list, and design surfaces distinguish `轻量工作流` from ordinary `状态机`.
- Lightweight creation validates a workspace-relative non-root tasklist directory and writes a fixed initial/final agent step with locked `aceharness-tasklist` plus optional `step.skills`.
- The lightweight editor exposes only its fixed step, while normal state-machine subworkflow selectors and drill-down labels identify lightweight children.
- Codespec remains a valid workflow-intent source; its action must be handed to the lightweight creation UI/session rather than the deleted plugin.

## Completion Notes

- The persisted mode union remains `lightweight | state-machine`; the server derives and validates the lightweight fixed topology, required skill, and tasklist directory.
- AI prefill/resume converges on the same lightweight creator session and form. `EditNodeModal` identifies lightweight child workflows before selection, while `LightweightWorkflowDesignPanel` enforces the fixed structure and required skill.
- The concise lightweight description is in the current UI. Runtime integration remains under Task 7/13 ownership; no Task 5 follow-up is required.

## Acceptance

- The workflow creation/list/design UI has no phase workflow or persisted `ai-guided` mode selector.
- Lightweight UI cannot create invalid topology or remove its required tasklist skill/directory.
- AI-guided entry from each Task 11 surface opens or resumes this lightweight UI/session and creates a validated `profile: lightweight` config; it is not a dead prompt-only response.
- Normal state-machine users can select a lightweight child workflow and understand its kind before selection.
- This task does not modify Workbench runtime integration files reserved for Task 7.

## Verification Record

- `rg -n -S "WorkflowCreationMode|mode: 'lightweight'|LIGHTWEIGHT_TASKLIST_SKILL|deriveLightweightTasklistDirectory" src/components/NewConfigModal.tsx src/server/api-routes/configs/create/route.ts src/lib/workflow/lightweight.ts`: **pass**; lightweight UI and API primitives are present.
- `rg -n -i "ai-guided|aiGuided" src/components/NewConfigModal.tsx src/client/pages/WorkflowsPage.tsx`: **pass for legacy-mode removal**, not proof of retention; no AI handoff is currently wired in these files.
- AI entry to lightweight UI/session: **pass**; all retained AI intent sources reach the same lightweight creator session without a persisted `ai-guided` mode.
- Final independent review: **pass**; `WorkflowModeSelector`, `NewConfigModal`, `LightweightWorkflowDesignPanel`, `WorkflowsPage`, `EditNodeModal`, config-create API, creator entry, and creator validation reported `8 files / 60 passed`. No concrete Task 5 acceptance gap was found.
