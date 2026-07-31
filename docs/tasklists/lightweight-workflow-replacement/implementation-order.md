# Dependency And Execution Plan

Updated: 2026-07-30

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

## Execution Waves

| Wave | Tasks | Prerequisite | Execution Rule | Release Gate |
|------|-------|--------------|----------------|--------------|
| 1 | 01, 02, 03 | None | Run concurrently; each owns isolated core, legacy-removal, or skill paths. | Root reviews each task's changed files and static evidence. |
| 2 | 04, 05, 06 | Reviewed Wave 1 | Run concurrently; documents, creation/design UI, and runtime backend have no shared mutable files. | Root reviews all handoffs and confirms contract compatibility. |
| 3 | 07, 09, 11 | Reviewed Wave 2; Task 11 also requires Task 02 and Task 05 | Run concurrently with isolated ownership: Task 07 owns runtime UI, Task 09 owns result propagation/tests, and Task 11 owns retained creation-entry integration. | Root reviews all three handoffs and checks that Task 11 does not overlap Task 07/09 files. |
| 4 | 08 | Reviewed Tasks 07, 09, and 11 | Serial final audit/documentation task. | Root confirms both legacy removal and AI-entry retention evidence. |
| 5 | 10 | Reviewed Task 08 | Serial full test-suite gate. | All configured suites exit successfully with exact commands recorded. |
| 6 | 13A, 13B, 13C | None; isolated mutable scopes | Run concurrently: 13A owns run-scoped ACPX cleanup and server-only diagnostics; 13B owns state-machine failure gates and force-transition rejection; 13C owns Workbench live history sync and defensive progress rendering. | Root reviews all three handoffs, then reopens the static audit and full gate. |

## Scheduling Notes

- The root agent only schedules, reviews, records evidence, updates the README progress board, and reports outcomes. It must not treat the legacy-removal completion claim as completion of Task 11.
- Child agents must not run prohibited build/test/lint/tsc/formatter commands during isolated implementation tasks; Task 10 is the dedicated full-suite gate.
- Task 05 owns the first implementation of the lightweight form. Task 11 may edit the same creation surface only after Task 05 review; there is no concurrent mutable-file overlap.
- Task 02 removes only the old plugin, slash flow, and plugin-only state. It must leave QuickActions, `starterAction`, and ordinary homepage conversation available for Task 11. “Remove `/workflow`” means remove the legacy implementation, not the retained AI creation journey.
- Task 06 must not edit `WorkbenchClient.tsx`, `StateMachineExecutionView.tsx`, or creation/design files; Task 07 owns final runtime UI integration.
- Task 04 must not edit schema or manager ownership from Task 01; it may consume the exported lightweight contract and persisted fields after Task 01 is reviewed.
- Task 09 must not edit Task 07 Workbench/UI files; Task 07 must not edit subworkflow result propagation or its focused assertions.
- Task 11 must not introduce a persisted `ai-guided` mode as a shortcut. Its release gate is a proven path from each required entry to a valid lightweight creation UI/session.
- User-reported runtime issue is a separate release risk: with Git baseline/change tracking disabled, OpenCode/acpx may still back up the runtime directory before workflow start and consume high CPU. Route this to a bounded runtime-agent regression task; do not claim it fixed from documentation or static evidence.
- Frontend memory-handoff and Werewolf extension surfaces are intentionally removed. Preserve only backend-visible detailed logs and the minimal user-facing execution summary.
- Task 10 runs only after all implementation and static audit work is reviewed. It may reveal defects but must delegate each code fix to a bounded child task before rerunning the suite.
- Task 13 is a user-reproduced runtime correction. Its three work items must not overlap files; Task 8 and Task 10 cannot be closed from pre-Task-13 evidence.
