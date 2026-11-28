# Task 06: 增加基于代码仓库的 Agent 市场

Status: Pending

## Execution Contract

- Depends on: Task 01
- Unlocks: Task 07
- Execution: Parallel / Wave 2
- Delegated owner: Future marketplace implementation agent; not assigned during this planning-only phase.
- Scope boundary: Agent market protocol, repository manifest, search/install/update/rollback APIs, provenance metadata and marketplace UI integration. Do not change workflow canvas runtime behavior.

## Goal

在 Agent 页面内增加一个可接入 GitHub/GitCode 等 HTTPS 代码仓的 Agent 市场，支持搜索、安装、更新、对比和回滚；技能市场继续只管理 Skill。

## Current State

- 现有 Skill marketplace 已有来源配置、Provider dispatch、分页、下载、校验、安装、回滚和自定义 HTTPS 来源。
- Agent 当前以 runtime YAML 管理，已有保存、删除、导入 ZIP、导出 ZIP 和选择性目录能力。
- 目前没有 Agent 市场资源类型、仓库 manifest、来源 provenance 或远程更新 diff。

## Follow-Up Work

- 扩展市场来源能力，增加 `resourceTypes` 和 `git-repo` 协议。
- 定义 `aceharness-market.yaml`、Agent 文件路径、版本、标签和 Skill 依赖规范。
- 增加公开 HTTPS 仓库的 shallow archive/文件下载和安全校验。
- 实现 Agent search/list/preview/install/update/rollback API。
- 写入来源 URL、ref、commit hash、manifest hash、版本和本地修改状态。
- 同名 Agent 安装前显示差异；本地修改的 Agent 不能静默覆盖。
- 在 Agent 页面增加“我的 Agent / Agent 市场”视图，复用技能市场后端的分页、来源管理、安装进度和错误呈现，但不增加技能市场的 Agent Tab。
- Agent 市场来源只展示声明支持 Agent 的仓库；Skill-only 来源继续留在技能市场。
- Agent 依赖 Skill 只做显式声明，不自动覆盖本地 Skill。

## Acceptance

- 一个公开 Git 仓库可以通过 manifest 被搜索并分页展示 Agent。
- 安装前可预览版本、来源、依赖和覆盖范围；安装失败可回滚。
- 更新能区分未修改、本地已修改和无 provenance 三种状态，并阻止静默覆盖。
- 仓库不执行任意 post-install 脚本，路径穿越、超大归档、schema 错误和非法 Agent 都会被拒绝。
- Skill 市场现有功能、入口和分页行为不受影响，且不会出现 Agent 搜索结果。

## Verification Record

- 尚未运行；可在 Task 01 完成后与画布任务并行实施。
