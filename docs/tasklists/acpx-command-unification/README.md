# ACPX Command Unification Task List

Updated: 2026-08-11

This task list is based on the ACPX command discovery audit, Windows paths-with-spaces failures, and the requested CodeAgent/NGA/CodeGenie executable override support. It is the implementation and acceptance checklist for a cross-platform command resolution and launch path.

## Entrypoints

- [Design locks](00-design-locks.md)
- [Dependency and execution plan](implementation-order.md)
- [Current verification gaps](verification-gaps.md)
- [Recent verification](verification-log.md)
- [Out of scope](out-of-scope.md)

## Execution Ownership

- Coordinator: schedule, delegate, review, update this README, and report results.
- Child agents: implement only their assigned task boundaries and return changed files and verification evidence.

## Task Documents

- [Task 1: Establish the command contract](01-command-contract.md)
- [Task 2: Implement shared resolution and launch](02-shared-resolution-launch.md)
- [Task 3: Migrate ACPX consumers](03-acpx-consumers.md)
- [Task 4: Unify diagnostics and documentation](04-diagnostics-docs.md)
- [Task 5: Cross-platform integration verification](05-cross-platform-verification.md)
- [Task 6: Scope engine availability refreshes](06-engine-availability-refresh.md)

## Current Judgment

- ACPX 0.13 requires argv arrays on Windows; raw command strings are not a supported ACPX launch contract.
- Command discovery, availability probing, generic execution, ACPX adapter construction, and diagnostic scripts now converge on structured resolver output or ACPX argv registry overrides.
- Existing tests may be redesigned, but their behavioral scenarios must remain covered by equal or stronger tests.

## Overview

| Progress | Task | Status | Depends On | Execution | Notes |
|----------|------|--------|------------|-----------|-------|
| 100% | Task 1: Establish the command contract | Done | None | Serial | API, migration map, and legacy-test mapping reviewed. |
| 100% | Task 2: Implement shared resolution and launch | Done | Task 1 | Serial | Structured resolver and launcher reviewed with focused tests. |
| 100% | Task 3: Migrate ACPX consumers | Done | Task 2 | Wave 2 | Registry metadata and shared argv resolution now drive ACPX and availability. |
| 100% | Task 4: Unify diagnostics and documentation | Done | Task 2 | Wave 2 | Diagnostics delegate to the runtime resolver; README and environment-variable catalog document all three ACP overrides. |
| 100% | Task 5: Cross-platform integration verification | Done locally | Task 3, Task 4, Task 6 | Serial | Windows fixtures and CI matrix added; hosted Linux/macOS execution remains tracked. |
| 100% | Task 6: Scope engine availability refreshes | Done | Task 2 | Wave 2 | Initial page load is full; later card checks are per engine. |
