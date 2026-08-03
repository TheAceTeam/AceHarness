# Task 8: Static Audit And Documentation Sync

Status: Done

Updated: 2026-08-01 14:30:26 +08:00

## Execution Contract

- Depends on: Tasks 7, 9, 11, 13, 16, and 27 reviewed acceptance.
- Unlocks: Task 10.
- Execution: Serial wave 4 after all Wave 3 tasks.
- Delegated owner: Static-audit child agent.
- Scope boundary: Own the final static audit, stale active source/test compatibility cleanup, focused documentation/API copy updates, and task-level evidence. Verify both sides of the contract: legacy phase/plugin removal and retained AI-guided entry. Do not redesign runtime UI or backend behavior here; Task 11 owns creation-entry implementation and Task 10 owns the full suite.

## Goal

Verify that phase workflow and old creation-plugin removal is complete without accidentally removing the user-facing AI workflow-planning entry. Every retained entry must reach the planning UI/session, whose confirmed draft may create either a lightweight or a state-machine workflow.

## Verified Static Facts

- `rg -n -i "phase-based|workflow\.phases|workflow\?\.phases" src tests` returned no matches; no active legacy phase schema/executor identifier was found in the current source/test tree.
- The scoped template contract is state-machine-only: template mode is a literal, registry/operations enumerate `workflow.states` only, and the browser has no phase-mode selector or phase-count fallback.
- The run output route enriches files from `workflow.states` and returns `stateName`; the existing `phaseName` display field is retained only as a compatibility alias derived from that state. Focused coverage verifies state, role, iteration, and max-iteration metadata.
- Valid template import/export paths remain covered: built-in instantiation produces a state-machine config, and saving an existing state-machine config preserves a portable template with task bindings stripped.
- `src/plugins/create-workflow/` is absent. No current sidebar registry entry for the old plugin or `workflow-monitor` was found.
- The lightweight contract is present in `src/lib/workflow/lightweight.ts`, the config-create route, and `NewConfigModal.tsx`: configs contain the lightweight profile and fixed tasklist skill, but no workspace tasklist-directory metadata. Tasklist storage is run-owned under the ACE runtime and is resolved from persisted run metadata.
- `QuickActions.tsx` still contains a `创建工作流` guide and the Codespec workflow action, so removing the legacy plugin did not require removing those intent sources.

## Current Retention Findings

- `ChatPageContent.tsx` routes `starterAction=create_workflow` and the ordinary homepage workflow-intent classifier to the same retained AI-guided creation journey used by QuickActions.
- `WorkflowsPage.tsx` retains the AI planning action; `ai-guided` is a UI entry only and is never persisted.
- `NewConfigModal.tsx` exposes the exclusive `lightweight | state-machine | ai-guided` UI choices. `ai-guided` is planning state only; confirmed structured output selects `lightweight` or `state-machine` before creation.
- QuickActions, starter action, ordinary homepage conversation, and the WorkflowsPage AI action all have a reviewed static call path to the planning UI/session. The radio selection creates no empty chat session.
- Task 7 independently verified the prior `WorkbenchClient.tsx` dynamic-import report with focused tests, Vite build, HTTP/module checks, and browser import. It is no longer an open runtime gap for this task.
- General `phase` terms belonging to Spec Coding, onboarding, or other independent product domains are not evidence of the removed phase-workflow executor and must not be deleted by a blanket search-and-replace.

## Handoff

- Task 11's historical focused entry-path evidence is superseded for current acceptance by Task 16 and its retained AI-guided recovery contract. Task 27 is now a Task 8 predecessor because its runtime task-board/document surface must be included in the final static audit.
- Task 8 must distinguish a legacy `ai-guided` persisted-mode identifier (forbidden) from the user-facing AI-guided creation journey (required).
- Task 10 owns the complete configured test-suite gate and must not be marked complete from a historical aggregate claim without command output.
- The disabled-baseline backup regression is repaired in application-owned paths: disabled `isolated-copy` excludes `.git` directories and worktree `.git` files, enabled baseline preserves the prior complete copy behavior, and `rerun-from-step` reloads current configuration and clears stale `workspaceGit` state. ACPX process-level `.git` access is not claimed as repaired and remains a runtime-tracing follow-up.

## Acceptance

- Static evidence shows no active legacy phase runtime, phase compatibility default/type, old creation-plugin registration, legacy `/workflow` slash configuration, or forbidden `.ace-outputs` reader.
- `QuickActions`, `starterAction`, ordinary homepage conversation, and WorkflowsPage each have a reviewed call path to the retained AI planning UI/session; no path is merely a prompt with no creation transition.
- The persisted workflow contract is `lightweight | state-machine`; no phase executor, old plugin, persisted `ai-guided` mode, or workspace tasklist-directory metadata is revived.
- Public documentation distinguishes runtime output from configured tasklist documents.
- Remaining verification limitations are explicitly recorded rather than represented as passes. Task 16 owns browser creation-journey evidence, and Task 10 owns the fresh full-suite gate; neither is a completed Task 8 verification claim.

## Verification Record

- 2026-08-01 current static reconciliation: Task 8's former `Done (100%)` claim predated Tasks 13, 16, 21, and 27, and its AI/lightweight and tasklist-directory wording was corrected to the current contract.
- 2026-08-01 coordinator acceptance: static source scans found no active phase-mode or workspace tasklist-directory regression in the creation surface. `npx vitest run tests/components/LightweightTaskBoard.test.tsx tests/components/lightweight-tasklist-evidence.test.ts tests/components/DocumentsPanel.layout.test.ts tests/components/DocumentsPanel.source-tabs.test.tsx tests/workbench-dynamic-import.test.ts tests/task8-config-documents.test.ts` passed `6 files / 15 tests`; the current AI creation set passed `9 files / 63 tests`. Task 10's full gate remains separately owned.

- Current phase-mode scan: **pass**; `rg -n -i "phase-based|workflow\\.phases|workflow\\?\\.phases|阶段模式|线性流程"` over the creation entry/source set returned no matches.
- Current creation-contract scan: **pass**; the target creation sources contain no `tasklistDirectory` or `docs/tasklists` references. Such references in focused tests are legacy-input negative assertions only.
- Current dependency reconciliation: **pass**; Task 27 is accepted and explicitly unlocks Task 8; `implementation-order.md` records `Task 27 -> Task 08`.
- Current AI assembly coverage: **pass**; focused creation tests prove AI can select lightweight or state-machine, lightweight assembly has no supervisor/transition-governance leakage, and create rejects persisted `ai-guided`/`phase-based` modes.

- Historical Task 8 acceptance below is retained as archival Git-baseline evidence only; it is not the status of this current audit.

- Legacy phase scan: **pass**; no matches for `phase-based`, `workflow.phases`, or `workflow?.phases` in `src`/`tests`.
- Focused template/output tests: **pass**; `npx vitest run tests/workflow-templates.test.ts tests/api-runs-outputs-route.test.ts` completed with 2 files and 6 tests passed.
- Focused template UI test: **pass**; `npx vitest run tests/components/WorkflowTemplatesPanel.test.tsx --environment jsdom` completed with 1 test passed.
- Legacy plugin path check: **pass**; `src/plugins/create-workflow/` is absent and the registry has no old registration.
- AI-entry retention audit: **static pass independently reviewed**; QuickActions, `starterAction=create_workflow`, ordinary homepage workflow intent, and WorkflowsPage AI action all route into the AI planning UI/session, whose confirmed output supports lightweight or state-machine without a persisted `ai-guided` mode.
- Static focused verification: **pass**; workflow creator entry, `NewConfigModal`, `WorkflowsPage`, `WorkflowModeSelector`, templates, and run-output tests reported `6 files / 23 passed`.
- Task 7 dynamic-import evidence: **reviewed pass**; focused import test, Vite build, HTTP/module checks, and browser import are recorded in the shared README.
- Git-baseline disabled path: **independent verification pass**. Disabled `isolated-copy` excludes `.git` directories and worktree `.git` files; enabled baseline retains both forms of Git metadata. `rerun-from-step` reloads the latest gate and clears stale enabled `workspaceGit` state after configuration disables baseline. Focused verification: `npx vitest run tests/state-machine-workflow-manager.test.ts tests/api-workflow-recovery-routes.test.ts` completed with `2 files / 131 passed`; `npx tsc --noEmit` passed; a real temporary-directory probe confirmed disabled directory/worktree exclusion, enabled compatibility, and ordinary source-file copying.
- Scope limit: this acceptance covers ACEHarness-owned copy and baseline paths only. ACPX may still stat or otherwise access `.git` for its own session behavior; that needs a separate real runtime trace. Dedicated regressions for configuration changes before `resume` and stopped `force jump` are also retained as follow-up coverage.
- TypeScript: **pass for this focused Task 8 repair**. Build, lint, and the configured full-suite gate remain Task 10 scope.
