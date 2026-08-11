# Dependency And Execution Plan

## Dependency Edges

- Task 01 -> Task 02
- Task 02 -> Task 03
- Task 02 -> Task 04
- Task 03, Task 04 -> Task 05
- Task 02 -> Task 06
- Task 03, Task 04, Task 06 -> Task 05

## Execution Waves

| Wave | Tasks | Prerequisite | Execution Rule | Release Gate |
|------|-------|--------------|----------------|--------------|
| 1 | Task 01 | None | Serial | Coordinator reviews API and legacy-test mapping. |
| 2 | Task 02 | Task 01 | Serial | Coordinator reviews common contract and focused tests. |
| 3 | Task 03, Task 04, Task 06 | Task 02 | Concurrent with non-overlapping files | Coordinator reviews all completion reports. |
| 4 | Task 05 | Task 03, Task 04, and Task 06 | Serial | Focused tests, CI evidence, and legacy-path scan pass. |

## Scheduling Notes

- Task 03 owns runtime consumers; Task 04 owns scripts and docs; Task 06 owns engine-page/query behavior. Shared API changes after Task 02 require a new explicit predecessor.
- Task 05 may replace obsolete tests only after recording the preserved scenario mapping.
