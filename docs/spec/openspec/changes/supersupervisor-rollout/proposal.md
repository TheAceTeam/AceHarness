# Proposal: SuperSupervisor rollout

## Intent

将 `docs/角色化Agent与全局Supervisor改造设计.md` 与 `docs/supersupervisor/*` 中定义的目标，收敛为一条可持续实现的产品主链：创建 workflow、形成 OpenSpec、启动 run、Supervisor 介入、Agent 持续协作、首页动态联动。

## Scope

Includes:

- 创建态 OpenSpec 与 creation session 的承载和继承
- 首页动态侧栏与会话绑定
- workflow 页面中的 OpenSpec、修订记录、final review 和 Agent 上下文对话
- Agent 体系与创建体验的统一收口
- 以后续实现基于 OpenSpec 变更制品推进

Excludes:

- phase-based workflow 的继续扩展
- power-gitcode skill 层改造
- 与本次 SuperSupervisor 主链无关的泛平台重构

## Approach

采用官方 OpenSpec 风格的 change 管理本次改造：

1. 在 `docs/spec/openspec/specs/` 中维护当前行为规范
2. 在 `docs/spec/openspec/changes/supersupervisor-rollout/` 中维护本次变更的 proposal、design、tasks 和增量规范
3. 运行时内部 `OpenSpecDocument` 继续作为项目状态对象存在，但不替代官方 OpenSpec 文档制品
