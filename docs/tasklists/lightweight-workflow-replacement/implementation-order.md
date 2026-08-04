# Dependency And Execution Plan

Updated: 2026-08-01 18:34:00 +08:00

## Dependency Edges

- Task 01 -> Task 04
- Task 03 -> Task 04
- Task 01, Task 02, Task 03 -> Task 05
- Task 01, Task 02, Task 03 -> Task 06
- Task 02, Task 05 -> Task 11
- Task 04, Task 05, Task 06 -> Task 07
- Task 07, Task 09, Task 11 -> Task 08
- Task 08 -> Task 10
- Task 13 -> Task 08
- Task 13 -> Task 10
- Task 14 has no dependency on the archived task graph. Its coordinator acceptance precedes the next full test gate for this worktree.
- Task 15 has no dependency on the archived task graph. Its coordinator acceptance precedes the next full test gate for this worktree.
- Task 16 depends on the current Task 5/11 creation surfaces and must be reviewed after its focused AI-flow acceptance; the SSR blocker was user-confirmed resolved on 2026-08-01.
- Task 17 depends on the existing document-root contract, lightweight creation/design surfaces, and Workbench runtime integration. It adds source filtering and navigation without changing persisted tasklist metadata or Agent runtime instructions.
- Task 18 has no dependency and owns the current Workbench header-action and start-navigation regressions.
- Task 19 has no dependency and owns lightweight authoring fields plus the lightweight creation payload.
- Task 18, Task 19 -> Task 20 because Task 20 shares the Workbench navigation file and consumes the simplified lightweight contract.
- Task 19, Task 22 -> Task 21 because runtime tasklist storage consumes the final lightweight creation contract and shares startup/recovery files with Task 22.
- Task 19 -> Task 22 as a semantic dependency; Task 22 may implement in parallel because its runtime write scope is isolated from Task 19.
- Task 23 has no dependency and owns only reusable tool-group interaction behavior.
- Task 19 -> Task 24 because Task 24 closes the stale design-container and test contract left by the step-Skills removal.
- Task 23 -> Task 25 because the reusable debounce is ineffective while the Workbench virtual list remounts a trailing group on lifecycle updates. Task 25 shares `WorkbenchClient.tsx` with Task 20, so it uses the same owner lane but does not require Task 20 acceptance.
- Task 23 -> Task 26 because the product-selected trailing hold duration belongs to the reusable tool-group interaction contract.
- Task 20, Task 21 -> Task 27 because the dedicated lightweight task board consumes the finalized lightweight navigation and run-owned tasklist document contracts.
- Task 27 -> Task 08 so the final static audit covers the separate lightweight runtime surface.
- Task 27 -> Task 28 because the lightweight overview observability follow-up consumes the dedicated lightweight runtime surface.
- Task 10 gate report -> Task 29 because the catalog/document/API TypeScript errors must be repaired before the gate can be retried; Task 28 independently owns the related Workbench error.
- Task 28 -> Task 30 because preparation presentation must be corrected before Task 10's current gate can be accepted.
- Task 10 gate report -> Task 31 because the two full-suite regressions require root-cause repairs before the next gate; Tasks 30 and 31 then release Task 10 rerun.
- Task 14, Task 28 -> Task 32 because terminal ACPX usage recovery must preserve the same authoritative runtime evidence that Task 14 retains for terminal tool/output events and Task 28 presents in the lightweight overview.
- Task 27 -> Task 33 because the execution-relationship graph consumes the accepted lightweight task-board evidence contract and must not recreate a state-machine runtime surface.
- Task 19, Task 22 -> Task 34 because the design/save migration must consume the finalized lightweight authoring and supervisor-free runtime contract while preserving state-machine settings.
- Task 14, Task 27 -> Task 35 because opaque ACPX tool normalization must preserve the event metadata that Task 27 consumes as real child-Agent activity evidence.

## Execution Waves

| Wave | Tasks | Prerequisite | Execution Rule | Release Gate |
|------|-------|--------------|----------------|--------------|
| 1 | 01, 02, 03 | None | Run concurrently; each owns isolated core, legacy-removal, or skill paths. | Root reviews each task's changed files and static evidence. |
| 2 | 04, 05, 06 | Reviewed Wave 1 | Run concurrently; documents, creation/design UI, and runtime backend have no shared mutable files. | Root reviews all handoffs and confirms contract compatibility. |
| 3 | 07, 09, 11 | Reviewed Wave 2; Task 11 also requires Task 02 and Task 05 | Run concurrently with isolated ownership: Task 07 owns runtime UI, Task 09 owns result propagation/tests, and Task 11 owns retained AI planning-entry integration. | Root reviews all three handoffs and checks that Task 11 does not overlap Task 07/09 files. |
| 4 | 08 | Reviewed Tasks 07, 09, and 11 | Serial final audit/documentation task. | Root confirms both legacy removal and AI planning-entry evidence. |
| 5 | 10 | Reviewed Task 08 | Serial full test-suite gate. | All configured suites exit successfully with exact commands recorded. |
| 6 | 13A, 13B, 13C | None; isolated mutable scopes | Run concurrently: 13A owns run-scoped ACPX cleanup and server-only diagnostics; 13B owns state-machine failure gates and force-transition rejection; 13C owns Workbench live history sync and defensive progress rendering. | Root reviews all three handoffs, then reopens the static audit and full gate. |
| 7 | 14A, 14B | None; isolated adapter vs. projection/UI scopes | Run concurrently: 14A owns status-only ACPX terminal updates and persisted `tool_results` recovery; 14B owns shared result projection, tool-card rendering, and component regressions. | Root reviews both handoffs, resolves integration findings, then runs the focused and full gates. |
| 8 | 15 | None; isolated homepage send and chat-stream route scopes | One child owns the model-selection send contract, server route validation, and focused regression coverage. | Root verifies both rejected and accepted model send paths, then runs the full gate. |
| 9 | 16 | Current Task 5/11 source state | Restore the existing AI planning flow, remove legacy phase-mode UI/configuration references, and add the no-empty-session acceptance path. | Root reviews focused behavior and only then schedules the final gate. |
| 10 | 17 | Tasks 4, 5, 7 | Serial integration of the run-owned runtime tasklist contract, source-aware document API, and Workbench viewer entry. | Root reviews focused document and UI evidence; the full gate remains governed by Task 10. |
| 11 | 18, 19, 22, 23 | None for code ownership; Task 22 consumes Task 19's declared contract | Run concurrently: Task 18 owns the Workbench header/start navigation path; Task 19 owns lightweight creation/design and creation-route fields; Task 22 owns lightweight runtime supervisor suppression; Task 23 owns reusable tool-group collapse timing. | Root reviews each handoff before releasing Tasks 20 and 21. |
| 12 | 20 | Reviewed Tasks 18 and 19 | Serial: shares the Workbench navigation surface with Task 18. | Lightweight navigation has no state graph or generic step-document entry, while state-machine navigation is unchanged. |
| 13 | 21 | Reviewed Tasks 19 and 22 | Serial: runtime metadata and document roots must be changed as one contract after the shared supervisor-free startup/recovery changes land. | Generated tasklists reside only in run-owned runtime data, including on resume. |
| 14 | 24 | Reviewed Task 19 | Focused integration follow-up: strict panel props, design-container call, and focused panel test share one contract. | No stale Skills prop, no permissive prop type, and focused UI test passes. |
| 15 | 25 | Reviewed Task 23; coordinate with Task 20 owner | Serial Workbench-owner follow-up: stabilize the timeline key for a contiguous tool group across status changes and appended calls. | A streaming group remains mounted through terminal updates; focused regression covers completion and next-tool arrival. |
| 16 | 26 | Reviewed Task 23 | Serial UI timing follow-up: change the streaming terminal hold to 3 seconds without changing its reset or stream-end semantics. | The focused component test proves the group stays open before 3 seconds, closes after inactivity, and closes immediately when streaming ends. |
| 17 | 27A, 27B | Reviewed Tasks 20 and 21; 27B also waits for Task 13 Workbench review | Completed: 27A created the isolated lightweight task-board evidence/component contract; 27B integrated it into Workbench and DocumentsPanel. | Accepted: a lightweight run shows actual primary/child Agent activity and task execution relationships without reintroducing state-machine formation or a third document column. |
| 18 | 28 | Reviewed Task 27 | Completed serial Workbench follow-up: restored lightweight overview token analytics while preserving state-machine presentation. Its initial preparation evidence cards were superseded by Task 30's live phase/step display. | Accepted: evidence-backed token consumption remains in the lightweight overview; preparation is represented by the live run location. |
| 19 | 29 | Task 10 pre-Task-28 gate report | Completed parallel corrective slice: repaired catalog, document-panel/API, and agent-chat TypeScript errors while Task 28 owned `WorkbenchClient.tsx`. | Accepted: `npx tsc --noEmit` is clean; Task 10 can rerun. |
| 20 | 30 | Reviewed Task 28 | Serial Workbench presentation correction: remove persistent preparation cards and retain only live status/location while preparing. | Lightweight and state-machine preparation presentation are aligned; Token metric remains. |
| 21 | 31 | Task 10 fresh gate report | Parallel corrective slice: repair recommendation policy and model-selector loading without weakening assertions. | Both focused regressions pass and Task 10 can rerun after Task 30. |
| 22 | 32A, 32B | Reviewed Task 14/28 implementation state | Completed: terminal ACPX usage survives cancellation/failure through persisted request/cumulative records and failed-step persistence; terminal live-output sources remain selectable. | Focused acceptance passed `3 files / 182 tests`: a completed or failed run can still select its persisted stream, and reported ACPX token usage reaches the run summary, Agent state, and failed/cancelled step log. |
| 23 | 33 | Reviewed Task 27 | Completed: added a standalone lightweight `状态图` navigation entry using the established graph visual language with tasklist dependencies, serial/parallel groups, runtime status, owners, and progress. | Focused acceptance passed `1 file / 9 tests`; the Workbench keeps state-machine semantics unchanged, avoids invented dependencies, and removes the duplicate lightweight `Agents` navigation item. |
| 24 | 34 | Reviewed Tasks 19, 22 | Completed: directly migrated the reported historical config, normalized legacy supervisor data at read/save/validate boundaries, and made the Workbench policy roster profile-aware. | A lightweight design saves without a supervisor validation error and never displays/persists `default-supervisor` as an engine-policy Agent; state-machine supervisors remain unchanged. Focused acceptance: `3 files / 19 tests`, TypeScript passed. |
| 25 | 35 | Reviewed Task 14/27 contracts | Repair shared ACPX opaque ToolUse normalization for provider-private `spawnAgent` and `wait`, then validate runtime projection and lightweight child-Agent evidence. | Live cards use canonical subagent labels rather than `other`, terminal updates retain their identity/input, and the task board shows evidence-backed child-Agent activity. |

## Scheduling Notes

- The root agent only schedules, reviews, records evidence, updates the README progress board, and reports outcomes. It must not treat the legacy-removal completion claim as completion of Task 11.
- Child agents must not run prohibited build/test/lint/tsc/formatter commands during isolated implementation tasks; Task 10 is the dedicated full-suite gate.
- Task 05 owns the first implementation of the lightweight form. Task 11 may edit the same creation surface only after Task 05 review; there is no concurrent mutable-file overlap.
- Task 02 removes only the old plugin, slash flow, and plugin-only state. It must leave QuickActions, `starterAction`, and ordinary homepage conversation available for Task 11. “Remove `/workflow`” means remove the legacy implementation, not the retained AI creation journey.
- Task 06 must not edit `WorkbenchClient.tsx`, `StateMachineExecutionView.tsx`, or creation/design files; Task 07 owns final runtime UI integration.
- Task 04 must not edit schema or manager ownership from Task 01; it may consume the exported lightweight contract and persisted fields after Task 01 is reviewed.
- Task 09 must not edit Task 07 Workbench/UI files; Task 07 must not edit subworkflow result propagation or its focused assertions.
- Task 11 must not introduce a persisted `ai-guided` mode as a shortcut. Its release gate is a proven path from each required entry to the AI planning UI/session and confirmed output for either valid lightweight or state-machine creation.
- User-reported runtime issue is a separate release risk: with Git baseline/change tracking disabled, OpenCode/acpx may still back up the runtime directory before workflow start and consume high CPU. Route this to a bounded runtime-agent regression task; do not claim it fixed from documentation or static evidence.
- Frontend memory-handoff and Werewolf extension surfaces are intentionally removed. Preserve only backend-visible detailed logs and the minimal user-facing execution summary.
- Task 10 runs only after all implementation and static audit work is reviewed. It may reveal defects but must delegate each code fix to a bounded child task before rerunning the suite.
- Task 13 is a user-reproduced runtime correction. Its three work items must not overlap files; Task 8 and Task 10 cannot be closed from pre-Task-13 evidence.
- Task 14 must fix the shared ACPX lifecycle path for every routed engine. It may suppress large file bodies for UI performance, but it must never suppress the corresponding tool event, terminal status, error, or command/search output.
- Task 15 must not silently return after clearing a homepage composer. A missing, inactive, incompatible, or runtime-unavailable selected model must create a visible error and leave the application ready for the user to choose another model and retry.
- Waves 7 and 8 completed on 2026-07-31: ACPX status-only tool recovery, in-body tool transcript projection, and homepage invalid-model failure visibility passed the current coordinator gate.
- The prior coordinator gate is historical because the current worktree contains additional creation/runtime changes. Task 16 remains active; the SSR startup/module-loading blocker was user-confirmed resolved on 2026-08-01.
- Task 27 must derive task ownership, dependency, serial/parallel grouping, and progress from persisted tasklist/runtime evidence. It must show an explicit unavailable/unknown state where evidence is not available, rather than inventing a task graph.
- Task 34 must delete legacy `workflow.supervisor` only from lightweight configuration records. It must not normalize, remove, or replace state-machine supervisor values.
- Task 35 must normalize ACPX private orchestration calls before shared runtime projection. It must not add a Codex-only UI fallback or infer child-Agent activity without persisted/runtime evidence.
