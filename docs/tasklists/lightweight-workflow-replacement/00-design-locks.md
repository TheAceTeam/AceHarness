# Design Locks

Updated: 2026-07-30

## Terms And Boundaries

- `legacy phase workflow` means the former `phase-based` schema, executor, UI, and creation path. It is removed without compatibility or migration.
- `legacy creation plugin` means the former `create-workflow` sidebar/plugin and its `/workflow` slash flow. Removing it does not remove the user-facing AI creation entry.
- `AI-guided workflow creation entry` means a user-facing QuickActions action, `starterAction`, or ordinary homepage conversation that lets AI collect/refine workflow intent and then opens or resumes the lightweight creation UI/session.
- `lightweight workflow` means a state-machine configuration with `profile: lightweight`, exactly one initial/final state, exactly one agent step, and no transitions.
- `tasklist directory` means the system-derived `workflow.lightweight.tasklistDirectory`, resolved relative to the effective workspace for the run. It is the lightweight workflow's task-document root.
- `runtime output` means persisted files under `<runtimeRoot>/runs/<runId>/outputs` and stream files under the same run root. It is distinct from tasklist documents.

## Immutable Product Decisions

- Remove phase workflows completely. Do not parse, list, run, resume, migrate, or generate phase-based workflows.
- Remove the homepage `/workflow` slash flow and every legacy creation-plugin registration, intent, state, quick action, and persisted UI hint that exists solely for that flow.
- Preserve the AI-guided workflow creation user journey after that removal. `QuickActions`, the homepage `starterAction` route, and ordinary homepage conversation must each retain a usable entry and eventually open or resume lightweight creation.
- The retained AI journey must end at the lightweight creation UI/session and a validated `profile: lightweight` config. Do not reintroduce `ai-guided` as a persisted workflow mode and do not route through the deleted plugin.
- Keep `/api/workflow/*` runtime APIs; they serve state-machine and lightweight runs and are not slash-command APIs.
- A lightweight workflow is not allowed to contain a `subworkflow` step. A normal state-machine `subworkflow` step may select a lightweight workflow as its child configuration.
- `aceharness-tasklist` is mandatory for the lightweight workflow's only step. It is locked in UI, required by validation, and injected by the runtime after inherited skills are resolved.
- Step-level skills are a supported capability. Editing a step must write `step.skills`, not mutate the selected Agent's global skills.
- A tasklist directory is required but is not user-configurable. Creation derives it as `docs/tasklists/<config-relative-filename-without-extension>`; it is created/resolved at run start and persisted for resume and document access. It may be displayed read-only.
- Do not read, write, display, rename, or delete `<projectRoot>/.ace-outputs/<runId>`. Existing files are not automatically removed from user workspaces.
- Remove the multi-Agent Agora chat tab and legacy workflow chatroom creation. Preserve human questions, workflow events, real-time output, documents, workspace, and child-run drill-down.
- Detailed process/runtime logs remain backend-visible; the UI only needs the operationally necessary log summary.
- The legacy `create-workflow` sidebar plugin is removed, not renamed. New lightweight workflow creation is a first-class workflow UI, not a replacement sidebar plugin.
- A genuine step execution exception is a hard failed checkpoint. It may be resumed only from the failed step; it must not evaluate ordinary transitions, circuit-breaker fallbacks, forced jumps, or downstream states until that retry succeeds.
- A stop request must terminate only processes conclusively attributed to the target run. ACPX session/process attribution may use an exact run identifier and recorded session metadata, but must never widen to a directory-wide or machine-wide agent sweep.

## UI Locks

- The former phase-workflow entry becomes `轻量工作流`; state machines remain a separate workflow kind.
- Lightweight design is a constrained form plus a fixed one-step preview. It must not expose add/remove state, transition, parallel-group, or subworkflow controls.
- Lightweight copy explains tasklist-driven dynamic task collaboration, not its internal fixed topology. Do not visibly expose the locked `aceharness-tasklist` skill; it remains enforced by validation and runtime injection.
- AI-guided creation may collect requirements, task, agent, and workspace context, but its final form is the lightweight UI/session rather than an AI workflow mode selector.
- Lightweight runtime is a bound ordinary conversation with a compact execution side surface: progress, task documents, runtime output, and workspace.
- State-machine runtime removes the Agora/group-chat tab. Child lightweight runs are opened through existing child-run drill-down.
- Use the repository's existing workbench/shadcn conventions, accessible labels and tabs, stable dimensions, and no decorative marketing layout.
- A history URL with an explicit active `runId` is a live run view. Its status graph, overview, and event-backed output must continue updating without a browser reload.
- Stop progress presents user-facing lifecycle stages and final outcome only. ACP session resolution, zero-match cleanup, filtering, and similar implementation diagnostics are backend-only.

## Current Facts

- `src/lib/workflow/lightweight.ts` and `src/server/api-routes/configs/create/route.ts` provide the lightweight profile, derived tasklist directory, required tasklist skill, and creation API contract.
- `src/plugins/create-workflow/` is absent, and the current source registry has no legacy `create-workflow` or `workflow-monitor` registration.
- `src/components/chat/QuickActions.tsx` still contains the `创建工作流` guide and the Codespec workflow action, so the user-facing intent is present at the quick-action layer.
- `src/components/chat/ChatPageContent.tsx` dispatches quick-action text and reads `starterAction`, but its explicit starter branch currently handles `create_agent` only; no workflow starter branch is present.
- `src/client/pages/WorkflowsPage.tsx` currently opens `NewConfigModal` only through the generic `新建工作流` action; the former separate `AI 创建` action is absent.
- `src/components/NewConfigModal.tsx` currently accepts only `lightweight` and `state-machine` creation modes and submits valid lightweight input to the creation API; it has no AI-guided handoff entry of its own.
- A source scan found no active `phase-based`, `workflow.phases`, or `ai-guided` configuration identifier in `src`/`tests`; this is evidence that the legacy mode was removed, not evidence that the required AI entry is retained.

## Verification Constraints

- During isolated implementation tasks, use focused static inspection, type/reference searches, diff review, and `git diff --check`; do not run build, lint, TypeScript compilation, formatter, or package installation commands unless separately authorized.
- The AI-entry retention task must be verified through static call-path review, focused component/API tests, and a browser smoke path for QuickActions, `starterAction`, and ordinary homepage conversation before the final suite gate.
- Record reported or unrun checks as pending; do not turn historical claims into passes without a reproducible command and result.

## Do Not Add

- Do not create a third workflow executor or retain a phase compatibility adapter.
- Do not turn native child-agent behavior into a new ACEHarness subworkflow capability inside lightweight workflows.
- Do not silently append run IDs to tasklist directories. If concurrent use of one directory needs a policy, reject the conflict rather than merge artifacts invisibly.
- Do not revive workflow creation through the deleted sidebar plugin, `/workflow`, or a persisted `ai-guided` workflow mode.
- Do not satisfy the AI-entry requirement with a dead prompt-only action that never reaches the lightweight creation UI/session.
- Do not reinterpret a failed step as a business verdict that permits a downstream transition.
- Do not expose raw process-cleanup implementation details such as unresolved ACP sessions in Workbench progress messages.
