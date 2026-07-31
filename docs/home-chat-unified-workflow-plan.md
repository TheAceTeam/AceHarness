# 首页对话统一工作流与多 Agent 群聊十阶段计划（已归档）

> **状态：已废弃（2026-07-28）。** 本文描述的 `/workflow` slash 创建流程、`workflow-monitor` 侧边栏插件，以及将工作流运行绑定为 Agora 多 Agent 群聊的方案均已移除，不能作为当前行为或后续实现依据。

当前工作流只使用状态机运行时。轻量工作流是受约束的单步骤状态机配置，创建时必须使用 `aceharness-tasklist`，任务文档目录由配置指定，运行输出保存在 ACEHarness 持久化运行目录中。

现行设计、执行顺序和验收状态见 [轻量工作流替换任务清单](tasklists/lightweight-workflow-replacement/README.md)。保留本文仅供追溯已废弃方案。
