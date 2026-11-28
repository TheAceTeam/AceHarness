# Task 01: 冻结统一画布契约与迁移规则

Status: Pending

## Execution Contract

- Depends on: None
- Unlocks: Tasks 02, 06
- Execution: Serial / Wave 1
- Delegated owner: Future workflow-contract implementation agent; not assigned during this planning-only phase.
- Scope boundary: Canvas IR types, schema/version rules, ID policy, legacy mapping decisions, and contract tests. Do not modify runtime execution or UI in this task.

## Goal

把统一画布、节点、边、状态 group、编辑元数据和旧配置映射规则冻结成一个可被 UI、编译器和市场任务共同使用的契约。

## Current State

- 当前 lightweight schema 强制单状态、单 Agent、无转移，并拒绝 Script/Subworkflow。
- state-machine 已有 Agent、Script、Subworkflow、并行组、转移和审核字段。
- 现有 React Flow 图使用 state/step 视图，没有统一的跨模式 Canvas IR。

## Follow-Up Work

- 确定 `WorkflowCanvasDocument`、节点、边、group、执行引用和版本字段。
- 冻结轻量 DAG 与状态机 group 的约束。
- 冻结 Subworkflow 节点的目标模式、版本/快照策略、输入输出映射、父子 run 关系和无环/最大深度规则。
- 冻结稳定 ID、旧 YAML 缺失画布时的合成规则、位置默认值和未知字段处理。
- 确定 `workflow.canvas.executionProfile` 与旧 `workflow.profile` 的兼容边界。
- 编写 schema/fixture 级契约测试，覆盖合法图、环路、悬空边、重复 ID 和旧配置。

## Acceptance

- 有一份版本化 Canvas IR 类型和运行时校验规则，能被后续 UI/编译任务直接引用。
- 旧 lightweight 和 state-machine 配置都有确定、可测试的一对一读取映射。
- 画布字段不会改变没有画布元数据的旧配置运行结果。
- 轻量 DAG、状态 group、Script/Agent 节点和运行快照边界都有负向约束。
- 轻量和状态机都能表达 Subworkflow，但子图不会被隐式展开，且自引用和间接环引用可被拒绝。

## Verification Record

- 尚未运行；本任务只在设计批准后执行。
