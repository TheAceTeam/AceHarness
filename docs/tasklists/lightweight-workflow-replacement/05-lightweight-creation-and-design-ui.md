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

Replace the former phase-workflow creation location with a constrained, first-class lightweight workflow creation and design experience. Keep AI-guided creation as a UI planning entry whose confirmed output may choose lightweight or state-machine rather than a third persisted mode.

## Current State

- `WorkflowModeSelector.tsx` exposes persisted `轻量工作流` and `状态机` choices only. AI guidance is a separate entry action and does not become a third persisted mode.
- `NewConfigModal.tsx` validates the lightweight Agent/task input and submits the supported creation payload; optional step Skills remain a state-machine capability, and the modal does not own a tasklist filesystem path.
- `src/server/api-routes/configs/create/route.ts` accepts the lightweight creation contract and enforces the required tasklist skill. Run startup owns the tasklist directory under ACE runtime data.
- `WorkflowsPage.tsx` retains a separate AI planning action; confirmed AI output may use either supported workflow kind.
- QuickActions, Codespec, `starterAction=create_workflow`, and ordinary homepage workflow intent all converge on the AI planning UI/session with creator-session binding. Confirmed output selects `lightweight` or `state-machine`; no path revives `ai-guided` as a persisted mode.

## Completed

- The creation, list, and design surfaces distinguish `轻量工作流` from ordinary `状态机`.
- Lightweight creation writes a fixed initial/final agent step with locked `aceharness-tasklist`; generated tasklist documents are run-owned under ACE runtime data.
- The lightweight editor exposes only its fixed step, while normal state-machine subworkflow selectors and drill-down labels identify lightweight children.
- Codespec remains a valid workflow-intent source; its action must be handed to the AI planning UI/session rather than the deleted plugin.

## Completion Notes

- The persisted mode union remains `lightweight | state-machine`; the server validates the lightweight fixed topology and required skill, while run startup resolves and persists the run-owned tasklist directory.
- AI prefill/resume converges on the AI planning UI/session. Confirmed lightweight output uses the lightweight creator form; `EditNodeModal` identifies lightweight child workflows before selection, while `LightweightWorkflowDesignPanel` enforces the fixed structure and required skill.
- The concise lightweight description is in the current UI. Runtime integration remains under Task 7/13 ownership; no Task 5 follow-up is required.

## Acceptance

- The workflow creation/list/design UI has no phase workflow or persisted `ai-guided` mode selector.
- Lightweight UI cannot create invalid topology or alter its internal required tasklist skill or run-owned directory contract.
- AI-guided entry from each Task 11 surface opens or resumes the planning UI/session; confirmed output creates a validated lightweight or state-machine config and is not a dead prompt-only response.
- Normal state-machine users can select a lightweight child workflow and understand its kind before selection.
- This task does not modify Workbench runtime integration files reserved for Task 7.

## Verification Record

- `rg -n -S "WorkflowCreationMode|mode: 'lightweight'|LIGHTWEIGHT_TASKLIST_SKILL|deriveLightweightTasklistDirectory" src/components/NewConfigModal.tsx src/server/api-routes/configs/create/route.ts src/lib/workflow/lightweight.ts`: **pass**; lightweight UI and API primitives are present.
- `rg -n -i "ai-guided|aiGuided" src/components/NewConfigModal.tsx src/client/pages/WorkflowsPage.tsx`: **pass**; matches are UI-entry handling only and no persisted AI mode is emitted.
- AI planning entry and confirmed output: **pass by focused evidence**; retained intent sources reach the planning UI/session, which supports lightweight or state-machine output.
- Final independent review: **pass**; `WorkflowModeSelector`, `NewConfigModal`, `LightweightWorkflowDesignPanel`, `WorkflowsPage`, `EditNodeModal`, config-create API, creator entry, and creator validation reported `8 files / 60 passed`. No concrete Task 5 acceptance gap was found.
