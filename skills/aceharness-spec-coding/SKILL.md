---
name: aceharness-spec-coding
description: ACEHarness Spec Coding skill for spec-first planning and implementation. Turns rough requirements into structured requirements, design, and implementation plans.
descriptionZH: ACEHarness 规范编码技能。将粗需求转化为可审查、可实现、可验证的需求、设计和任务制品。
tags:
  - ACEHarness Spec Coding
  - Requirements
  - Design
  - Tasks
  - Planning
---

# ACEHarness Spec Coding

将粗需求转化为可审查、可实现、可验证的正式规范制品，并在实现阶段按规范推进。机器输出格式由系统机制指定；本 skill 只提供制品质量标准和领域判断。

## 制品体系

| 制品 | 用途 | 质量标准 |
| --- | --- | --- |
| `requirements.md` | 术语表 + 用户故事 + 验收标准 | 每个需求有用户故事和 WHEN/THEN 验收标准，关键术语定义清楚 |
| `design.md` | 架构 + 数据模型 + 接口 + 伪代码 + 测试方案 | 包含架构图、核心组件、接口契约、关键决策、兼容策略和假设 |
| `tasks.md` | 可执行计划 | 多级 checkbox、精确需求/设计追踪、验证方式和检查点 |

## 需求访谈

- 先吸收用户已说过的内容和代码中能确认的事实。
- 只问会影响实现策略、验收标准、兼容策略或风险控制的问题。
- 问题要具体，最好给选项并允许补充。
- 每个问题说明它会影响哪类决策，例如范围、数据模型、兼容、验证或发布。
- 不重复询问已经能从上下文确认的信息。

## Requirements 标准

- 第一屏能看出背景、目标用户、价值和主要边界。
- 包含术语表，定义用户、业务对象、状态、数据对象或边界概念。
- 每个需求都有稳定编号、标题、用户故事和验收标准。
- 验收标准优先使用 WHEN/THEN 句式。
- 明确非目标、兼容要求和异常场景。
- 不把推测写成已确认事实；未确认内容放入假设或待确认项。

## Design 标准

- 说明总体架构、核心组件、数据流和接口契约。
- 明确关键数据模型、字段来源、生命周期或持久化影响。
- 对核心流程给出伪代码或关键代码片段，足够支持实现审查。
- 包含测试方案，覆盖主流程、异常路径、兼容/迁移和回归风险。
- 至少包含一张 Mermaid 或等价流程图，帮助审查依赖关系和控制流。
- 写清关键决策、选择理由和替代方案。
- 对旧数据、旧配置、权限、安全、性能或可靠性有影响时，必须显式说明。
- 设计内容要能追溯到 requirements，不引入无关范围。

## Tasks 标准

- 使用多级 checkbox 拆解，编号使用 T 前缀。
- 每个可执行子任务要写清目标、输入/依赖、具体动作、交付物和验证方式。
- 子任务要精确引用相关需求或设计决策；不要为了覆盖面把所有 R/D 都机械挂到每个任务上。
- 至少设置一个检查点任务，用于汇总验证证据、风险和剩余问题。
- 任务粒度要能被单个 Agent 接手，不写空泛动作。

## 执行循环

1. 阅读 requirements、design、tasks 和当前代码上下文。
2. 选择最小未完成任务。
3. 按需求边界实现，并保留验证证据。
4. 更新任务状态和必要的设计说明。
5. 如果发现需求或设计矛盾，先记录并反馈，不擅自扩大范围。

## 持久化 Spec 模式

当工作流配置 `specCoding.persistMode: 'repository'` 时：

- spec 制品位于 `specCoding.specRoot` 目录，默认 `<workingDirectory>/.spec`。
- `spec.md` 是 master 输入，`checklist.md` 是预存问题清单。
- 每次运行的 delta 快照位于 `specs/<workflowName>-<runId>/`。
- 审查时检查 `checklist.md`，所有未回答问题需要在审批时提出。
- 修订制品时直接更新 requirements/design/tasks artifacts 正文，保持术语、范围和需求追溯一致。
