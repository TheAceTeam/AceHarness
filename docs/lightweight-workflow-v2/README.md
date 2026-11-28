# 轻量工作流与 Agent 市场升级计划

Updated: 2026-11-28

This document set is based on the current ACEHarness workflow implementation, the existing React Flow state-machine editor, the current marketplace/provider code, and the two pasted workflow canvas component examples. It is a design and implementation plan for extending lightweight workflows, unifying the workflow editors, and adding an Agent marketplace. No implementation work is included in this document set.

## Entrypoints

- [Detailed architecture design](architecture-design.md)
- [Design locks](00-design-locks.md)
- [Dependency and execution plan](implementation-order.md)
- [Current verification gaps](verification-gaps.md)
- [Recent verification](verification-log.md)
- [Out of scope](out-of-scope.md)

## Execution Ownership

- Coordinator: arrange tasks, review evidence, update this README, and report the implementation result.
- Future implementation agents: execute only the bounded task assigned to them after this plan is approved.
- No child-agent execution has started; all tasks below are pending design approval.

## Task Documents

- [Task 01: Freeze the graph contract and migration rules](01-graph-contract.md)
- [Task 02: Build the legacy adapters and graph compiler boundary](02-graph-compiler-boundary.md)
- [Task 03: Extend lightweight execution to multi-node workflows](03-lightweight-execution.md)
- [Task 04: Map state-machine states and steps onto the shared canvas](04-state-machine-canvas.md)
- [Task 05: Build the shared React Flow canvas editor](05-shared-canvas-editor.md)
- [Task 06: Add the Agent repository marketplace](06-agent-marketplace.md)
- [Task 07: Migration, compatibility, and end-to-end verification](07-integration-verification.md)
- [Task 08: 流程型 Skill 转工作流](08-skill-to-workflow.md)
- [Task 09: 轻量运行与看板联动](09-run-board.md)

## Current Judgment

- The current lightweight profile is intentionally constrained to one initial/final state and one Agent step with `aceharness-tasklist`; it is not a graph editor today.
- The current state-machine runtime already supports the execution primitives needed for multi-step, multi-agent, script, parallel, review, and transition behavior.
- The repository already uses the `reactflow` package and has React Flow state-machine panels. The pasted component uses `@xyflow/react`; its visual structure is reusable, but its dependency and component API should not be copied into the codebase as-is.
- The existing skill marketplace already provides source management, provider dispatch, pagination, download, validation, install, rollback, and custom HTTPS sources. Agent marketplace work should reuse these backend primitives, but its user entry point belongs on the Agent page alongside local Agent management.
- The recommended direction is one shared canvas model plus a compiler/adapter boundary, while retaining existing lightweight and state-machine runtime compatibility.
- Lightweight subworkflow nodes may call either a lightweight child or a state-machine child; the parent sees a versioned, bounded run unit rather than the child's internal graph.

## Overview

| Progress | Task | Status | Depends On | Execution | Notes |
|----------|------|--------|------------|-----------|-------|
| 0% | Task 01: Freeze the graph contract and migration rules | Pending | None | Serial / Wave 1 | Shared contract must be reviewed before consumers are implemented. |
| 0% | Task 02: Build the legacy adapters and graph compiler boundary | Pending | Task 01 | Parallel / Wave 2 | Owns the compatibility boundary between canvas data and existing YAML. |
| 0% | Task 03: Extend lightweight execution to multi-node workflows | Pending | Task 02 | Parallel / Wave 3 | Sequential DAG first; branch/join and parallel execution are later gates. |
| 0% | Task 04: Map state-machine states and steps onto the shared canvas | Pending | Task 02 | Parallel / Wave 3 | Preserves state-level review, transition, and concurrency semantics. |
| 0% | Task 05: Build the shared React Flow canvas editor | Pending | Task 02 | Parallel / Wave 3 | Uses the existing `reactflow` stack and adapts the pasted visual language. |
| 0% | Task 06: Add the Agent repository marketplace | Pending | Task 01 | Parallel / Wave 2 | Reuses the skill marketplace shell and adds repository manifests/provenance. |
| 0% | Task 08: 流程型 Skill 转工作流 | Pending | Tasks 02, 05 | Parallel / Wave 4 | 草案确认、来源追踪、变更预览。 |
| 0% | Task 09: 轻量运行与看板联动 | Pending | Tasks 03, 05 | Parallel / Wave 4 | 节点、任务、证据及子运行共用运行投影。 |
| 0% | Task 07: Migration, compatibility, and end-to-end verification | Pending | Tasks 03, 04, 05, 06, 08, 09 | Serial / Wave 5 | 负责工作台接线与端到端验收。 |
