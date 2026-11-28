# Task 04: 将状态机状态和步骤映射到统一画布

Status: Pending

## Execution Contract

- Depends on: Task 02
- Unlocks: Task 07
- Execution: Parallel wave 3
- Delegated owner: Future state-machine adapter implementation agent; not assigned during this planning-only phase.
- Scope boundary: State group projection, state/step selection, transitions, parallel lanes, review-policy display and round-trip tests. Do not simplify or replace the state-machine runtime.

## Goal

让状态机使用与轻量相同的 React Flow 画布外壳，同时保留状态级复杂性。

## Current State

- 状态机已有 React Flow 图，但轻量和状态机没有统一的节点/检查器视觉模型。
- 状态级 reviewPolicy、并发组、transition 和多步骤不能简单展平为普通节点。

## Follow-Up Work

- 将 state 映射成可折叠 group/container，将 steps 映射成子节点。
- 将状态转移渲染为 group 边，并保留条件、顺序和失败目标。
- 将 reviewPolicy、终态和并行组显示为 group 属性或内部泳道。
- 支持 group 与子节点的选择、检查器切换和错误定位。
- 验证现有 state-machine 配置 round-trip 不丢字段、不改变运行语义。
- 验证状态机作为轻量父流程的 Subworkflow 时，状态级审核、并发和终态仍由子流程内部负责。

## Acceptance

- 用户能在同一画布上看到状态、状态内步骤和状态转移。
- 状态级审核/对抗、并发和终态信息不会被误显示为普通 Agent 属性。
- 状态机作为 Subworkflow 被嵌入轻量流程时，父画布只显示摘要节点，不展开或复制子状态。
- 保存后再次打开，状态、步骤、转移和布局都能恢复。
- 旧状态机运行测试和新画布适配测试均通过。

## Verification Record

- 尚未运行；需在 Task 02 的节点引用和编译快照契约完成后执行。
