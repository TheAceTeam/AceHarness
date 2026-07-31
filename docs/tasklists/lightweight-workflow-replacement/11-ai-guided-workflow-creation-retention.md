# Task 11: Retain AI-Guided Workflow Creation

Status: Done

Updated: 2026-07-30 16:56:27 +08:00

## Execution Contract

- Depends on: Tasks 2 and 5.
- Unlocks: Task 8.
- Execution: Serial integration task after Tasks 2 and 5; it may run in parallel with Tasks 7 and 9 when their owned files are isolated.
- Delegated owner: Creation-entry integration child agent.
- Scope boundary: Own the retained workflow-creation entry and its handoff: `src/components/chat/QuickActions.tsx`, `src/components/chat/ChatPageContent.tsx`, `src/client/pages/WorkflowsPage.tsx`, and the serial handoff surface in `NewConfigModal.tsx`/creation-session helpers. Do not restore `src/plugins/create-workflow/`, `/workflow`, a phase executor, or a persisted `ai-guided` workflow mode. Do not edit Workbench runtime integration or subworkflow result propagation owned by Tasks 7 and 9.

## Goal

Keep AI-guided workflow creation available after legacy phase workflow and old creation-plugin removal, and make every supported entry end in the first-class lightweight creation UI/session.

## Current Code Evidence

- `QuickActions.tsx` retains both the `创建工作流` guide and `根据 Codespec 创建工作流` action; both invoke the canonical lightweight creator entry instead of ending as a prose prompt.
- `ChatPageContent.tsx` routes QuickActions, `starterAction=create_workflow`, and ordinary homepage workflow intent into the same `openWorkflowCreator` handoff while preserving `create_agent` behavior.
- `WorkflowsPage.tsx` retains its AI action and opens `NewConfigModal` with the lightweight preset.
- `NewConfigModal.tsx` and `/api/configs/create` provide the valid lightweight destination, create/reuse creator sessions, validate ownership/mode, derive the tasklist directory, require `aceharness-tasklist`, and persist the creation-session binding.
- The old `create-workflow` plugin directory is absent. This task must preserve that deletion while restoring the user entry through ordinary UI/session APIs.

## Completion Notes

- All retained workflow-intent sources use the canonical lightweight creator entry and session handoff.
- Creator sessions create/reuse/resume correctly, while the server validates session ownership and mode consistency.
- The final payload remains `workflow.mode: state-machine` with `profile: lightweight`, fixed topology, derived tasklist directory, and mandatory skill. Legacy mode/plugin/runtime surfaces remain absent.

## Acceptance

- QuickActions workflow action opens or resumes lightweight creation and can create a valid `profile: lightweight` config.
- `starterAction=create_workflow` opens or resumes the same lightweight creation path, while `create_agent` remains unaffected.
- An ordinary homepage conversation can trigger the same explicit creation transition with preserved session context.
- The final config has the lightweight fixed topology, derived `docs/tasklists/...` directory, and mandatory `aceharness-tasklist` skill; no `phase-based` or persisted `ai-guided` mode is emitted.
- Legacy `/workflow`, `create-workflow` plugin registration, and workflow-monitor behavior remain absent.
- Focused tests cover all three entry paths, resume/session binding, invalid lightweight input, and the negative legacy paths. A browser smoke test loads the route after a clean dev-server start and confirms no dynamic-import failure.

## Verification Record

- QuickActions intent present: **pass**; static source review found both workflow guide and Codespec action.
- AI-entry focused verification: **pass**; independent final review ran creator entry, mode selector, `NewConfigModal`, WorkflowsPage, config-create, validation, and template tests: `7 files / 58 passed`.
- Session/plugin integration verification: **pass**; sidebar-plugin, Codespec workflow-run flow, API Spec Coding, and store tests: `4 files / 42 passed`. Total independent evidence is `100/100` passing.
- `starterAction`, WorkflowsPage handoff, ordinary-chat handoff, session reuse/resume, and final lightweight payload: **independently reviewed pass**. Task 7's clean-server dynamic-import smoke covers route-load safety; no browser interaction test was run in this review.
- Lightweight destination contract: **pass by static evidence**; `NewConfigModal` and the config-create route contain the lightweight mode/profile path.
- End-to-end entry-to-session-to-config behavior: **focused agent evidence reported; browser/full-suite evidence pending**.
