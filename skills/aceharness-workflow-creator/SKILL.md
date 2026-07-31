---
name: aceharness-workflow-creator
description: ACEHarness workflow creation skill. Helps reason about serial workflow states, per-state steps, parallel step groups, and scoped workflow patches.
descriptionZH: ACEHarness 工作流创建技能。用于判断状态拆分、步骤并发、Agent 分工、检查点和工作流补丁质量。
tags:
  - ACEHarness
  - Workflow
  - State Machine
  - Planning
source: aceharness
---

# ACEHarness Workflow Creator

你负责帮助设计 ACEHarness 工作流的流程结构、Agent 分工、检查点和失败恢复策略。机器输出格式由系统机制另行指定；本 skill 只提供领域判断和质量标准。

## 范围

- 只创建或修改普通 `mode: state-machine` 工作流配置。
- 不为其他工作流类型提供配置、模板、迁移或创建步骤。

## 状态与并发

- 状态是串行推进的流程节点。不要把不同状态设计成并发关系。
- 并发只发生在同一状态的步骤里；需要并发时，多个步骤应表达为同一状态内的一组并行工作。
- 状态名要短、稳定、适合状态图展示。
- 终止状态只表达完成、汇总、交付或异常终止意图，不承担新的复杂工作。
- 非终止状态应有清晰的通过、带条件通过、失败重试或回退语义。

## 状态拆分

优先用 3 到 5 个状态覆盖主流程：

- 准备/澄清：确认输入、范围、风险和验收口径。
- 设计/计划：形成方案、任务切片和检查点。
- 实现/执行：完成核心变更或交付动作。
- 验证/审查：运行检查、红蓝审查、裁决是否可进入下一步。
- 完成：汇总结果、证据和剩余风险。

只有当业务确实需要独立人工审批、独立失败回退或独立可视化进度时，才新增状态。

## 步骤设计

- 每个非终止状态默认采用 3 步红蓝裁决结构：蓝方/defender 产出当前状态交付物，红方/attacker 挑战漏洞、边界和反例，judge 汇总双方证据并给出 `pass|conditional_pass|fail`。
- 只有在极简状态、纯人工等待状态或用户明确要求简化时，才可少于红蓝 judge 三步；少于三步时仍必须保留 judge 作为流转出口。
- 每个状态通常 3 个步骤；确有并发执行或补充验证时可扩展到 4 个步骤。
- 步骤 task 要写清输入、动作、输出和验收证据。
- Agent 优先使用系统提供的可用 Agent、推荐 Agent 或模板中的既有 Agent。
- Supervisor 只放在 workflow.supervisor 中负责调度、审阅和检查点建议；不要把 supervisor/default-supervisor 编排为任何步骤的执行 Agent。
- 红蓝审查应放在同一状态内：执行者完成工作，审查者找问题，裁决者判断能否流转。
- judge 是状态出口。非终止状态的 transitions 应读取当前状态 judge 的 verdict，不要让 defender 或 attacker 直接决定状态流转。
- 需要并发时，并发步骤必须共享同一业务目标，并且都能在当前状态内完成。

## 转移语义

- 非终止状态默认提供 `pass`、`conditional_pass`、`fail` 三条转移，条件都来自当前状态的 judge 输出。
- `pass` 表示当前状态验收标准已满足，可以进入下一状态或完成。
- `conditional_pass` 通常表示“已有方向但仍需迭代”，默认回到当前状态继续补充、修正或扩展，不要把它当作无条件前进。
- `fail` 表示当前状态的前提、方向或证据不成立，应回到当前状态、上游恢复状态或异常终止；不要跳过必要验证。
- 转移条件应描述当前状态裁决结果，例如 `condition: { verdict: conditional_pass }`；转移 label 再说明为什么留在当前状态或回退。

## Spec 追踪

- 如果系统提供 SpecCoding 任务，步骤应绑定真实叶子任务。
- 一个步骤可绑定多个需求或任务，但不要绑定无关任务来“凑完整”。
- 验证、审查、交付类步骤应绑定 tasks 和相关 requirements/design 证据。

## 补丁质量

设计页优化时只修改目标范围：

- workflow 级：可以调整整体状态、步骤拆分、Agent 分工和转移。
- state 级：只调整当前状态的说明、步骤、审查和转移语义。
- step 级：只调整当前步骤的 agent、task、skills、检查命令和 spec 绑定。

补丁要保留运行时上下文、工作目录、workspaceMode、已有 skills/mcp 设置和用户未要求变更的配置。
