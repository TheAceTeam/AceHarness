# Task 07: 迁移、兼容与端到端验证

Status: Pending

## Execution Contract

- Depends on: Tasks 03, 04, 05, 06, 08, 09
- Unlocks: None
- Execution: Serial integration / Wave 5
- Delegated owner: Future integration and verification agent; not assigned during this planning-only phase.
- Scope boundary: Cross-feature fixtures, migrations, end-to-end tests, accessibility/responsive checks, documentation sync and release checklist. Do not introduce new product behavior outside the preceding tasks.

## Goal

证明旧配置、新画布、轻量运行、状态机运行和 Agent 市场可以在同一版本中稳定协作。

## Current State

- 当前没有统一 Canvas IR，也没有 Agent market provenance 数据。
- 轻量和状态机的 UI、schema 和运行验证分散在不同路径。
- 本设计阶段没有实现或验证结果。

## Follow-Up Work

- 准备旧 lightweight、旧 state-machine、轻量多节点、轻量嵌套 lightweight、轻量嵌套 state-machine、状态机 group、非法图和 Agent market repo fixtures。
- 验证 legacy → canvas → config round-trip，并验证旧运行历史与恢复。
- 从已安装流程型 Skill 生成草案，确认后运行 Agent、Script 和子工作流，验证画布与看板卡片一致、日志和产物可追溯、历史可重开。
- 更新来源 Skill 后检查差异，验证人工编辑和已启动运行保持原样。
- 验证运行快照隔离：编辑配置、删除记录或刷新页面不会改变已启动 run 的节点映射。
- 验证轻量顺序 Agent/Script、状态机并发/审核/转移和错误定位。
- 验证 Subworkflow 的输入输出映射、父子 run 关联、版本快照、自引用/间接环检测和嵌套深度限制。
- 验证 Agent market 安装、同名冲突、diff、更新、回滚和 Skill 依赖声明。
- 运行单元、集成、UI、无障碍和窄屏检查，记录真实命令和结果。
- 同步用户文档、迁移说明、Agent 仓库模板和发布检查清单。

## Acceptance

- 旧配置可继续打开和运行，新画布可保存和恢复。
- 轻量和状态机都能通过共享画布完成编辑，且各自复杂能力边界清晰。
- Agent 市场安装/更新失败不会破坏已有本地 Agent 或 Skill。
- 关键验证命令、通过结果和未解决缺口全部记录在 tasklist verification 文件中。
- 未通过的环境依赖或功能不被标记为完成。

## Verification Record

- 尚未运行，等待 Tasks 03–06、08、09 的实现和评审证据。
