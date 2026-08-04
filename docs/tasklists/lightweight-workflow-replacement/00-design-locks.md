# Design Locks

Updated: 2026-08-01

## Terms And Boundaries

- `legacy phase workflow` means the former `phase-based` schema, executor, UI, and creation path. It is removed without compatibility or migration.
- `legacy creation plugin` means the former `create-workflow` sidebar/plugin and its `/workflow` slash flow. Removing it does not remove the user-facing AI creation entry.
- `AI-guided workflow creation entry` means a UI-only planning entry from QuickActions, `starterAction`, ordinary homepage conversation, or the workflow page. It lets AI collect/refine workflow intent; confirmed output may create either a lightweight or a state-machine workflow.
- `lightweight workflow` means a state-machine configuration with `profile: lightweight`, exactly one initial/final state, exactly one agent step, and no transitions.
- `tasklist directory` means the run-owned tasklist location under ACEHarness runtime data. It is the lightweight workflow's task-document root and is never a user-workspace directory.
- `runtime output` means persisted files under `<runtimeRoot>/runs/<runId>/outputs` and stream files under the same run root. It is distinct from tasklist documents.

## Immutable Product Decisions

- Remove phase workflows completely. Do not parse, list, run, resume, migrate, or generate phase-based workflows.
- Remove the homepage `/workflow` slash flow and every legacy creation-plugin registration, intent, state, quick action, and persisted UI hint that exists solely for that flow.
- Preserve the AI-guided workflow planning entry after that removal. `QuickActions`, the homepage `starterAction` route, ordinary homepage conversation, and the workflow page must each retain a usable entry and open or resume the planning UI/session.
- Confirmed AI output must create exactly one supported persisted workflow kind: lightweight or state-machine. `ai-guided` is never persisted and must not route through the deleted plugin.
- Keep `/api/workflow/*` runtime APIs; they serve state-machine and lightweight runs and are not slash-command APIs.
- A lightweight workflow is not allowed to contain a `subworkflow` step. A normal state-machine `subworkflow` step may select a lightweight workflow as its child configuration.
- `aceharness-tasklist` is mandatory for the lightweight workflow's only step. It is locked in UI, required by validation, and injected by the runtime after inherited skills are resolved.
- Step-level skills remain supported for state-machine workflows. Lightweight workflows expose only workflow-level capability settings; their mandatory tasklist skill remains internal.
- A tasklist directory is required but is not user-configurable. It is derived within run-owned runtime data, created/resolved at run start, and persisted for resume and document access. It is not written to or displayed as a user workspace path.
- Do not read, write, display, rename, or delete `<projectRoot>/.ace-outputs/<runId>`. Existing files are not automatically removed from user workspaces.
- Remove the multi-Agent Agora chat tab and legacy workflow chatroom creation. Preserve human questions, workflow events, real-time output, documents, workspace, and child-run drill-down.
- Detailed process/runtime logs remain backend-visible; the UI only needs the operationally necessary log summary.
- The legacy `create-workflow` sidebar plugin is removed, not renamed. New lightweight workflow creation is a first-class workflow UI, not a replacement sidebar plugin.
- A genuine step execution exception is a hard failed checkpoint. It may be resumed only from the failed step; it must not evaluate ordinary transitions, circuit-breaker fallbacks, forced jumps, or downstream states until that retry succeeds.
- A stop request must terminate only processes conclusively attributed to the target run. ACPX session/process attribution may use an exact run identifier and recorded session metadata, but must never widen to a directory-wide or machine-wide agent sweep.

## UI Locks

- The former phase-workflow entry becomes `轻量工作流`; state machines remain a separate workflow kind.
- Lightweight design is a constrained form plus a fixed one-step preview. It must not expose add/remove state, transition, parallel-group, or subworkflow controls.
- Lightweight authoring does not expose optional step Skills, a maximum transition count, or a supervisor. Workflow-level Skills, MCP, and RAG settings remain available.
- Lightweight runtime is supervisor-free. It must not resolve an omitted supervisor to `default-supervisor`, launch a supervisor session, emit supervisor events, or persist a default-supervisor identity. This exception does not change normal state-machine supervisor behavior.
- Lightweight copy explains tasklist-driven dynamic task collaboration, not its internal fixed topology. Do not visibly expose the locked `aceharness-tasklist` skill; it remains enforced by validation and runtime injection.
- AI-guided creation may collect requirements, task, agent, and workspace context, but its final form is a planning UI/session whose confirmed output selects lightweight or state-machine rather than persisting an AI workflow mode.
- Lightweight runtime is a bound ordinary conversation with a compact execution side surface: progress, tasklist documents, runtime output, and workspace. It does not expose a state graph or generic step-document view.
- Lightweight runtime uses a dedicated task-board surface rather than the state-machine Agent formation. It presents the primary Agent and actual child-Agent activity, then tasklist items with their real owner, dependency, serial/parallel relationship, and progress evidence.
- Lightweight tasklist documents use a two-column working layout: task/document navigation and the selected document content. Do not retain a third generic metadata/detail column in that view.
- State-machine runtime removes the Agora/group-chat tab. Child lightweight runs are opened through existing child-run drill-down.
- Use the repository's existing workbench/shadcn conventions, accessible labels and tabs, stable dimensions, and no decorative marketing layout.
- A history URL with an explicit active `runId` is a live run view. Its status graph, overview, and event-backed output must continue updating without a browser reload.
- Stop progress presents user-facing lifecycle stages and final outcome only. ACP session resolution, zero-match cleanup, filtering, and similar implementation diagnostics are backend-only.

## Current Facts

- `src/lib/workflow/lightweight.ts` and `src/server/api-routes/configs/create/route.ts` provide the lightweight profile, required tasklist skill, and creation API contract; run startup owns the runtime tasklist directory.
- `src/plugins/create-workflow/` is absent, and the current source registry has no legacy `create-workflow` or `workflow-monitor` registration.
- `src/components/chat/QuickActions.tsx` still contains the `创建工作流` guide and the Codespec workflow action, so the user-facing intent is present at the quick-action layer.
- `src/components/chat/ChatPageContent.tsx`, `src/client/pages/WorkflowsPage.tsx`, and `src/components/NewConfigModal.tsx` retain the AI planning entry and route confirmed output to supported lightweight or state-machine creation.
- A source scan finds no active phase-workflow identifier or persisted `ai-guided` mode in `src`/`tests`; UI-only planning-entry references and negative rejection assertions are allowed.

## Verification Constraints

- During isolated implementation tasks, use focused static inspection, type/reference searches, diff review, and `git diff --check`; do not run build, lint, TypeScript compilation, formatter, or package installation commands unless separately authorized.
- The AI-entry retention task must be verified through static call-path review, focused component/API tests, and a browser smoke path for QuickActions, `starterAction`, and ordinary homepage conversation before the final suite gate.
- Record reported or unrun checks as pending; do not turn historical claims into passes without a reproducible command and result.

## Do Not Add

- Do not create a third workflow executor or retain a phase compatibility adapter.
- Do not turn native child-agent behavior into a new ACEHarness subworkflow capability inside lightweight workflows.
- Each lightweight run owns an isolated runtime-data tasklist directory. Use the run identity in that runtime root; never merge generated tasklists across runs or reserve a shared user-workspace directory.
- Do not create lightweight tasklist directories or generated tasklist documents in the configured project workspace.
- Do not manufacture child-agent rows, dependency edges, parallel groups, owners, or completion percentages when the run/tasklist has no corresponding runtime or persisted task evidence.
- Do not reuse the ordinary state-machine Agent formation or generic three-column document workspace for a lightweight run.
- Do not revive workflow creation through the deleted sidebar plugin, `/workflow`, or a persisted `ai-guided` workflow mode.
- Do not satisfy the AI-entry requirement with a dead prompt-only action that never reaches the AI planning UI/session.
- Do not reinterpret a failed step as a business verdict that permits a downstream transition.
- Do not expose raw process-cleanup implementation details such as unresolved ACP sessions in Workbench progress messages.
