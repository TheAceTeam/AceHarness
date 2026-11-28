# Task 03: 扩展轻量工作流为多节点执行

Status: Pending

## Execution Contract

- Depends on: Task 02
- Unlocks: Tasks 07, 09
- Execution: Parallel wave 3
- Delegated owner: Future lightweight-runtime implementation agent; not assigned during this planning-only phase.
- Scope boundary: Lightweight compiler/runtime path and its tests. Do not change state-machine semantics or marketplace provider code.

## Goal

让轻量工作流支持多个 Agent、顺序 Script、Subworkflow 和显式输入输出，同时保留任务清单能力和轻量模式的低配置特征。

## Current State

- 当前轻量只允许一个 Agent 步骤并自动注入 `aceharness-tasklist`。
- Script 和 Subworkflow 被轻量 schema 拒绝。
- 状态机已有 Script 配置、解释器、失败处理和 Agent 调用设施。

## Follow-Up Work

- 重构轻量校验、启动与恢复，把旧单步骤约束收敛到迁移层，将新轻量图交给共享执行设施。
- 为看板提供带 runId、nodeId、attemptId 的持久化节点状态、日志和产物引用。新版任务清单按运行节点与尝试隔离，旧运行仍按原路径读取。
- 支持多个 Agent 节点和节点间输出引用。
- 复用现有 Script 执行设施，第一阶段只允许顺序 Script。
- 支持 Subworkflow 节点引用轻量或 state-machine 工作流，并复用现有 `type: 'subworkflow'` 执行设施。
- 为 Subworkflow 固定版本/内容快照，显式映射输入输出，记录独立的 child run 标识和父子关系。
- 在保存和运行前检查子工作流依赖图无环，并限制最大嵌套深度。
- 保持任务清单技能作为可选或默认 Agent 能力，不把任务清单误认为完整拓扑。
- 增加轻量模式的运行节点状态、失败定位和快照日志。
- 首版校验只接受顺序链。Branch、Join 和轻量图并发留待后续交付。

## Acceptance

- 可以运行 Start → Agent → Script → Subworkflow → Agent → End 的轻量图。
- Subworkflow 可以分别引用轻量和状态机子流程，父流程能读取声明的输出并按节点策略处理子流程失败。
- 每个 Agent 节点可以指定不同 Agent；脚本节点沿用现有脚本失败策略。
- 节点输入输出引用错误在运行前被拒绝。
- 自引用、间接环引用、版本不存在和超过嵌套深度的 Subworkflow 在运行前被拒绝。
- 轻量工作流不会隐式出现状态级审核、并发或对抗配置。
- 旧的单 Agent 轻量工作流仍然通过同一套适配器运行。

## Verification Record

- 尚未运行；需在 Task 02 的编译边界完成后执行。
