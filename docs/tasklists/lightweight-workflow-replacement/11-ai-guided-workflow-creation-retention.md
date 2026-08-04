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

Keep the AI-guided workflow planning entry available after legacy phase workflow and old creation-plugin removal. Every supported entry must reach the planning UI/session, whose confirmed output may create lightweight or state-machine.

## Current Code Evidence

- `QuickActions.tsx` retains both the `创建工作流` guide and `根据 Codespec 创建工作流` action; both invoke the canonical AI planning entry instead of ending as a prose prompt.
- `ChatPageContent.tsx` routes QuickActions, `starterAction=create_workflow`, and ordinary homepage workflow intent into the same AI planning handoff while preserving `create_agent` behavior.
- `WorkflowsPage.tsx` retains its AI planning action and opens the creator UI without making `ai-guided` a persisted mode.
- `NewConfigModal.tsx` and `/api/configs/create` provide valid lightweight/state-machine destinations, create/reuse creator sessions, validate ownership/mode, require `aceharness-tasklist` for lightweight output, and persist only the creation-session binding. Run startup owns the tasklist directory.
- The old `create-workflow` plugin directory is absent. This task must preserve that deletion while restoring the user entry through ordinary UI/session APIs.

## Completion Notes

- All retained workflow-intent sources use the canonical AI planning entry and session handoff.
- Creator sessions create/reuse/resume correctly, while the server validates session ownership and mode consistency.
- The final payload is either the validated lightweight fixed topology or a state-machine workflow. The tasklist directory is run-owned ACE runtime metadata, and `ai-guided` is never persisted. Legacy mode/plugin/runtime surfaces remain absent.

## Acceptance

- QuickActions workflow action opens or resumes the AI planning UI/session; confirmed output can create a valid `profile: lightweight` or state-machine config.
- `starterAction=create_workflow` opens or resumes the same AI planning path, while `create_agent` remains unaffected.
- An ordinary homepage conversation can trigger the same explicit creation transition with preserved session context.
- Confirmed AI output creates either a validated lightweight fixed topology with mandatory `aceharness-tasklist` or a state-machine workflow; tasklist documents are run-owned under ACE runtime data, and no `phase-based` or persisted `ai-guided` mode is emitted.
- Legacy `/workflow`, `create-workflow` plugin registration, and workflow-monitor behavior remain absent.
- Focused tests cover all three entry paths, resume/session binding, invalid lightweight input, and the negative legacy paths. A browser smoke test loads the route after a clean dev-server start and confirms no dynamic-import failure.

## Verification Record

- QuickActions intent present: **pass**; static source review found both workflow guide and Codespec action.
- AI-entry focused verification: **pass**; independent final review ran creator entry, mode selector, `NewConfigModal`, WorkflowsPage, config-create, validation, and template tests: `7 files / 58 passed`.
- Session/plugin integration verification: **pass**; sidebar-plugin, Codespec workflow-run flow, API Spec Coding, and store tests: `4 files / 42 passed`. Total independent evidence is `100/100` passing.
- `starterAction`, WorkflowsPage handoff, ordinary-chat handoff, session reuse/resume, and final lightweight payload: **independently reviewed pass**. Task 7's clean-server dynamic-import smoke covers route-load safety; no browser interaction test was run in this review.
- Lightweight destination contract: **pass by static evidence**; `NewConfigModal` and the config-create route contain the lightweight mode/profile path.
- Current focused acceptance: `npx vitest run tests/workflow-creation-items.test.ts tests/api-configs-create.test.ts tests/components/NewConfigModal.test.tsx tests/components/WorkflowModeSelector.test.tsx tests/components/LightweightWorkflowDesignPanel.test.tsx tests/components/WorkflowsPage.test.tsx tests/workflow-creator-entry.test.ts tests/sidebar-plugins.test.tsx tests/chat-workflow-loading.test.ts` passed `9 files / 63 tests`. This covers UI-only AI selection, deferred session creation, planning continuation, and lightweight/state-machine assembly.
- Browser interaction smoke remains tracked by Task 16; it is not a reason to describe the retained entry contract as absent or incomplete.
