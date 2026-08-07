---
name: aceharness-workflow-creator
description: ACEHarness workflow creation skill. Helps choose lightweight or state-machine products, apply global adversarial intent, design per-state review modes, and produce safe workflow drafts.
descriptionZH: ACEHarness 工作流创建技能。用于选择轻量工作流或状态机、落实全局对抗意愿、判断状态级审查模式并生成安全草案。
tags:
  - ACEHarness
  - Workflow
  - State Machine
  - Planning
source: aceharness
---

# ACEHarness Workflow Creator

你负责帮助设计 ACEHarness 工作流的最终产品类型、流程结构、状态级审查模式、Agent 分工、检查点和失败恢复策略。机器输出格式由系统机制另行指定；本 skill 只提供领域判断和质量标准。

## 创建入口与最终产品

- 创建入口有三种：直接 `lightweight`、直接 `state-machine`、`ai-guided`。
- `ai-guided` 是创建旅程，不是持久化工作流类型；确认后只能保存为 `lightweight` 或 `state-machine`。
- `lightweight` 是任务清单驱动的固定产品：1 个同时 initial/final 的状态、1 个 Agent 步骤、0 个转移，必须使用内部 `aceharness-tasklist`。
- `state-machine` 才使用显式多状态、步骤和转移。状态集合必须最小充分，硬下限是 1 个可执行状态加 1 个终态，共 2 个状态。
- 不再使用 `lightweight/full` 表示 AI 编排预算。若需要控制说明细度，使用独立的 `compact/detailed` 规划深度，不能改变最终产品语义。

## 全局对抗意愿

- 创建前必须先取得 `disabled` 或 `on-demand`。
- `disabled` 是硬约束：AI 不判断对抗模式；lightweight 保持固定结构；普通 state-machine 的全部非终态由本地系统强制为 standard。
- `on-demand` 授权 AI 判断整体和状态风险，不代表所有状态都开启对抗。
- `lightweight` 不承载 defender → attacker → judge。只要整体判断需要对抗或置信度为 low，必须重新规划为普通 state-machine 并再次确认，不能静默降级为 standard。
- AI 引导首轮在同一次响应里返回最终产品类型、类型理由、整体风险判断和必要的状态机大纲；只有最终 state-machine 才继续逐状态生成步骤。

## 状态与并发

- 状态是串行推进的流程节点。不要把不同状态设计成并发关系。
- 并发只发生在同一状态的步骤里；需要并发时，多个步骤应表达为同一状态内的一组并行工作。
- 状态名要短、稳定、适合状态图展示。
- 终止状态只表达完成、汇总、交付或异常终止意图，不承担新的复杂工作。
- 非终止状态应有清晰的通过、带条件通过、失败重试或回退语义。

## 状态拆分

- 状态只在独立交付、独立验收/回退、人工审批、可见进度暂停、编队切换或单独重跑形成边界时新增。
- 不要为了达到 3～5 个而拆状态；极简状态机允许只有“执行 → 完成”。
- 状态名要短、稳定、适合状态图展示。终态只汇总结果、证据和剩余风险，不承担新执行、审查或裁决工作。

## 步骤设计

- 每个普通 state-machine 非终态必须有 `reviewPolicy={mode,source,locked,rationale,riskSignals,confidence}`；终态和 lightweight 固定状态不得有该字段。
- standard：1～N 个执行/验证步骤，不生成 attacker 或独立 judge；最后一个串行步骤在同一次输出里内联 `pass|conditional_pass|fail` 裁决。若最后是并行组，本地系统追加串行收口步骤。
- adversarial：严格按一个或多个 defender → 一个串行 attacker → 一个串行 judge 排列；judge 是最后执行段。
- 架构、接口、权限、安全、隐私、数据模型、跨模块影响、不可逆操作、高失败代价和明显不确定性优先 adversarial；机械、易验证、易回滚工作优先 standard。
- confidence=low 时不能保持 standard；本地系统保守升级为 adversarial。
- 步骤 task 要写清输入、动作、输出和验收证据。
- Agent 优先使用系统提供的可用 Agent、推荐 Agent 或模板中的既有 Agent。
- Supervisor 只放在 workflow.supervisor 中负责调度、审阅和检查点建议；不要把 supervisor/default-supervisor 编排为任何步骤的执行 Agent。
- 红蓝审查应放在同一状态内：执行者完成工作，审查者找问题，裁决者判断能否流转。
- Agent 配置允许复用，但 defender、attacker、judge 的运行实例必须彼此独立；模型不得生成 `id/agentInstanceId/provenance/baselineHash`。
- attacker 必须主动寻找反例、边界、遗漏和错误假设，不能只复述 defender；judge 必须基于双方证据独立裁决。
- 需要并发时，并发步骤必须共享同一业务目标，并且都能在当前状态内完成。

## 转移语义

- 非终止状态默认提供 `pass`、`conditional_pass`、`fail` 三条转移，条件读取当前状态最终裁决输出。
- `pass` 表示当前状态验收标准已满足，可以进入下一状态或完成。
- `conditional_pass` 通常表示“已有方向但仍需迭代”，默认留在当前状态继续补充、修正或扩展，不要把它当作无条件前进。
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
