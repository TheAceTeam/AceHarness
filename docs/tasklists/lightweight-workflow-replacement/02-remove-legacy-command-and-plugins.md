# Task 2: Remove Legacy Command And Creation Plugins

Status: Done

## Execution Contract

- Depends on: None.
- Unlocks: Tasks 5 and 6; retention handoff to Task 11.
- Execution: Parallel wave 1.
- Delegated owner: Child Agent B.
- Scope boundary: Own only the legacy home/chat creation flow and plugin registration: `src/plugins/create-workflow/`, sidebar-plugin registry and legacy home-sidebar state, `/workflow` slash handling, and plugin-specific creation items/normalizers/prompts. Do not remove the retained QuickActions, `starterAction`, or ordinary homepage conversation entry; Task 11 owns their lightweight handoff. Do not edit workflow schema/runtime, skill files, documents API, or Workbench runtime UI.

## Goal

Remove the old `/workflow` AI drafting pipeline and its dedicated sidebar plugin without removing workflow runtime APIs, generic workflow listing, or the user-facing AI-guided creation journey.

## Current State

- The legacy `src/plugins/create-workflow/` path is absent, and the current registry has no legacy `create-workflow` or `workflow-monitor` registration.
- The current source has no `/workflow` handler or old workflow-drafting state. Remaining `create-workflow` text is limited to a Codespec quick-action identifier or negative assertions that ensure the old intent is not dispatched.
- `src/components/chat/QuickActions.tsx` still exposes the `创建工作流` guide and a Codespec workflow action. These are retained user entry points, not the deleted plugin.
- The retention path is incomplete: `ChatPageContent.tsx` handles `starterAction=create_agent` only, `WorkflowsPage.tsx` has no separate `AI 创建` action, and `NewConfigModal.tsx` has no AI handoff mode. Task 11 owns this gap.

## Completed

- Deleted the legacy create-workflow plugin and its registry/runtime UI registration.
- Removed the old `/workflow` slash flow, plugin-specific persisted intents/state, and legacy workflow-drafting protocol references from executable source.
- Preserved ordinary workflow listing/navigation and `/api/workflow/*` runtime behavior.

## Follow-Up Work

- Do not delete or rename the retained `QuickActions`, `starterAction`, or ordinary-home-conversation entry while finishing legacy cleanup.
- Task 11 must connect those entries to the lightweight creation UI/session and ensure the final persisted config uses `profile: lightweight`; it must not restore a phase executor, `/workflow`, or the old plugin.
- Keep negative tests that assert the old plugin/intent cannot activate, but distinguish them from the retained AI entry in documentation and static scans.

## Acceptance

- No `/workflow` command or legacy `create-workflow` plugin registration remains in executable source.
- Existing ordinary chat and generic workflow list actions remain functional by static call-path review.
- No old `workflow-drafting`, `workflowDraft`, or plugin-only `create-workflow` intent remains as a live persisted UI contract.
- Runtime-only workflow bindings are not deleted merely because the creation plugin is removed.
- The task does not claim the overall creation experience is complete until Task 11 proves the retained AI entry reaches lightweight creation.

## Verification Record

- `Test-Path src/plugins/create-workflow`: **pass**; the legacy plugin directory is absent.
- `rg -n -i "phase-based|workflow\.phases|workflow\?\.phases" src tests`: **pass**; no active legacy phase identifiers were returned (exit code 1 means no matches).
- `rg -n -S "create-workflow|workflow-monitor" src`: **partial**; no legacy registration/path was found, while the Codespec action identifier remains intentionally and must not be mistaken for the deleted plugin.
- Retained AI entry reaching lightweight UI/session: **pending Task 11**.
