# 33. Lightweight Task Execution Graph

## Scope

- Add a Workbench top-level `状态图` tab for lightweight runs.
- Keep lightweight overview as the task board summary: progress, task list, primary Agent card, and child Agent activity card remain visible there.
- Keep the lightweight tasklist document entry as its own `任务清单` document panel.
- Remove the lightweight top-level `Agents` tab so lightweight runs do not show the normal Agent formation page.
- Do not change normal state-machine behavior.

## Product Contract

For lightweight workflow runs:

- `总览` shows `LightweightTaskBoard`, including:
  - tasklist/progress,
  - primary Agent evidence,
  - child Agent activity evidence.
- `状态图` is a separate Workbench-level tab.
- `状态图` renders a task execution graph, not the old workflow state graph.
- `任务清单` remains the tasklist document entry.
- `Agents` is not shown as an independent top-level tab.

For normal state-machine workflow runs:

- Existing `状态图` and `Agents` behavior remains unchanged.

## Graph Data Rules

`LightweightTaskExecutionGraph` uses only lightweight tasklist/runtime evidence:

- task nodes,
- explicit dependencies matched to existing task ids or titles,
- serial/parallel mode and parallel groups,
- owner,
- runtime status,
- progress.

Missing dependency references are shown as unmatched dependency counts on the task node. They do not create synthetic nodes or invented edges.

## UI Reuse

The graph reuses the established React Flow visual and interaction language from the existing state graph:

- ReactFlow canvas,
- zoom/pan controls,
- background grid,
- rounded bordered nodes,
- arrowed edges,
- compact legend panel,
- status-colored node/edge styling.

Only the visual shell is reused. The data model and semantics are task dependency based.

## Focused Verification

Focused tests cover:

- task-board evidence adaptation,
- overview task board still renders primary/child Agent cards,
- task graph builds nodes and dependency edges from explicit task evidence only,
- unmatched dependencies do not invent graph nodes,
- no task evidence produces no graph,
- Workbench lightweight runs expose top-level `状态图`,
- Workbench lightweight runs hide top-level `Agents`.
